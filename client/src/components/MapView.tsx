import { useMemo } from 'react';
import type { ArmyView, ProvinceStatic } from '@warmarket/shared';
import { act } from '../net/socket';
import { localNotice, setState, useStore } from '../state/store';
import { useNow } from '../hooks';

const TERRAIN_GLYPH: Record<string, string> = { plains: '', forest: '♣', mountain: '▲', desert: '∴', coast: '≈', urban: '▦' };

/** Position of an army: at its province, or interpolated along its route while moving. */
export function armyPos(a: ArmyView, provs: ProvinceStatic[], now: number): { x: number; y: number } {
  if (!a.move) {
    const p = provs[a.provinceId];
    return { x: p.cx, y: p.cy };
  }
  const f = Math.max(0, Math.min(1, (now - a.move.departAt) / (a.move.arriveAt - a.move.departAt)));
  const A = provs[a.move.from];
  const B = provs[a.move.to];
  return { x: A.cx + (B.cx - A.cx) * f, y: A.cy + (B.cy - A.cy) * f };
}

export function MapView() {
  const st = useStore((s) => s.static);
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.selectedProvince);
  const selArmy = useStore((s) => s.selectedArmy);
  const now = useNow(100);

  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of st?.nations ?? []) m.set(n.id, n.color);
    return m;
  }, [st]);

  if (!st || !view) return null;
  const provs = st.map.provinces;
  const myId = view.me.id;
  const capitals = new Map(st.nations.map((n) => [n.capital, n]));
  const selectedArmy = view.armies.find((a) => a.id === selArmy && a.ownerId === myId);
  const moveTargets = new Set(selectedArmy && !selectedArmy.move ? provs[selectedArmy.provinceId].neighbors : []);

  async function clickProvince(id: number) {
    if (selectedArmy && !selectedArmy.move && moveTargets.has(id)) {
      const r = await act({ type: 'move', armyId: selectedArmy.id, to: id });
      if (r.ok) {
        localNotice('info', `Army marching to ${provs[id].name}`);
        setState({ selectedArmy: null, selectedProvince: id });
      }
      return;
    }
    setState({ selectedProvince: id, selectedArmy: null });
  }

  // Group stationary armies per province so stacks render as one marker.
  const stacks = new Map<string, { x: number; y: number; strength: number; ownerId: string; ids: string[]; provinceId: number }>();
  const movers: ArmyView[] = [];
  for (const a of view.armies) {
    if (a.move) {
      movers.push(a);
      continue;
    }
    const key = `${a.provinceId}:${a.ownerId}`;
    const s = stacks.get(key);
    if (s) {
      s.strength += a.strength;
      s.ids.push(a.id);
    } else {
      const p = provs[a.provinceId];
      stacks.set(key, { x: p.cx, y: p.cy + 14, strength: a.strength, ownerId: a.ownerId, ids: [a.id], provinceId: a.provinceId });
    }
  }

  return (
    <svg className="map" viewBox={`0 0 ${st.map.width} ${st.map.height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="fog" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#0b0f14" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#1a222c" strokeWidth="2" />
        </pattern>
        <radialGradient id="sea" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#0b1622" />
          <stop offset="100%" stopColor="#05080c" />
        </radialGradient>
      </defs>
      <rect width={st.map.width} height={st.map.height} fill="url(#sea)" />
      {st.map.oceanPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#0d1b28" strokeWidth={1} />
      ))}
      {st.map.seaLanes.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={provs[a].cx} y1={provs[a].cy} x2={provs[b].cx} y2={provs[b].cy} stroke="#2d5476" strokeWidth={1.5} strokeDasharray="5 5" />
      ))}

      {provs.map((p) => {
        const pv = view.provinces[p.id];
        const owner = pv?.ownerId ? colorOf.get(pv.ownerId) : undefined;
        const vis = pv?.visible;
        const fill = owner ?? (vis ? '#2a323c' : '#181d24');
        return (
          <g key={p.id} className="prov" onClick={() => clickProvince(p.id)}>
            <path d={p.path} fill={vis ? fill : 'url(#fog)'} fillOpacity={owner ? (vis ? 0.42 : 1) : 1} stroke="#06080b" strokeWidth={1.4} />
            {!vis && owner && <path d={p.path} fill={owner} fillOpacity={0.16} stroke="none" pointerEvents="none" />}
            {pv?.effect && <path d={p.path} fill="none" stroke="#ff9a3c" strokeWidth={2} strokeDasharray="3 3" pointerEvents="none" />}
            {moveTargets.has(p.id) && <path d={p.path} fill="#ffb000" fillOpacity={0.14} stroke="#ffb000" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />}
          </g>
        );
      })}
      {provs.map((p) => {
        const pv = view.provinces[p.id];
        const cap = capitals.get(p.id);
        const isCap = cap && pv?.ownerId === cap.id;
        return (
          <g key={`l${p.id}`} pointerEvents="none" className="prov-label">
            <text x={p.cx} y={p.cy - 6} textAnchor="middle" className="pname" opacity={pv?.visible ? 0.95 : 0.45}>
              {isCap ? '★ ' : ''}
              {p.name}
            </text>
            <text x={p.cx} y={p.cy + 5} textAnchor="middle" className="pglyph">
              {TERRAIN_GLYPH[p.terrain]}
              {pv?.visible && pv.buildings && pv.buildings.length > 0 ? ` ${'■'.repeat(pv.buildings.length)}` : ''}
              {pv?.visible && pv.construction ? ' ◌' : ''}
            </text>
            {pv?.visible && pv.garrison !== undefined && pv.garrison > 0 && (
              <text x={p.cx + 18} y={p.cy + 5} className="pgar">
                {pv.garrison}
              </text>
            )}
          </g>
        );
      })}
      {selected !== null && provs[selected] && <path d={provs[selected].path} fill="none" stroke="#ffb000" strokeWidth={2.5} pointerEvents="none" />}

      {/* moving armies: route + marker */}
      {movers.map((a) => {
        const pos = armyPos(a, provs, now);
        const to = provs[a.move!.to];
        const c = colorOf.get(a.ownerId) ?? '#fff';
        const mine = a.ownerId === myId;
        return (
          <g key={a.id} pointerEvents="none">
            <line x1={pos.x} y1={pos.y} x2={to.cx} y2={to.cy} stroke={c} strokeWidth={1.5} strokeDasharray="2 4" opacity={0.9} />
            <circle cx={to.cx} cy={to.cy} r={4} fill="none" stroke={c} strokeWidth={1.5} />
            <g transform={`translate(${pos.x},${pos.y})`}>
              <rect x={-13} y={-8} width={26} height={16} rx={2} fill="#05070a" stroke={c} strokeWidth={mine ? 2 : 1.2} />
              <text y={4} textAnchor="middle" className="army-txt" fill={c}>
                {Math.round(a.strength)}
              </text>
            </g>
          </g>
        );
      })}
      {[...stacks.values()].map((s) => {
        const c = colorOf.get(s.ownerId) ?? '#fff';
        const mine = s.ownerId === myId;
        const sel = selArmy && s.ids.includes(selArmy);
        return (
          <g
            key={`${s.provinceId}:${s.ownerId}`}
            transform={`translate(${s.x},${s.y})`}
            className={mine ? 'army mine' : 'army'}
            onClick={(e) => {
              e.stopPropagation();
              if (mine) setState({ selectedArmy: sel ? null : s.ids[0], selectedProvince: s.provinceId });
              else clickProvince(s.provinceId);
            }}
          >
            <rect x={-14} y={-8} width={28} height={16} rx={2} fill={sel ? c : '#05070a'} stroke={c} strokeWidth={sel ? 2.5 : 1.5} />
            <text y={4} textAnchor="middle" className="army-txt" fill={sel ? '#000' : c}>
              {Math.round(s.strength)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
