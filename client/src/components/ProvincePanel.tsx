import { BUILDING_LABEL, CONFIG, RESOURCE_LABEL, fmtMoney, type BuildingKind } from '@warmarket/shared';
import { act } from '../net/socket';
import { setState, useStore } from '../state/store';
import { useNow } from '../hooks';

const BUILD_ORDER: BuildingKind[] = ['farm', 'mine', 'well', 'lab', 'fort', 'port'];

function costText(k: BuildingKind): string {
  const b = CONFIG.buildings[k];
  const res = Object.entries(b.resources)
    .map(([r, v]) => `${v} ${RESOURCE_LABEL[r].toLowerCase()}`)
    .join(', ');
  const y = Object.entries(b.yield)
    .map(([r, v]) => `+${v}/s ${RESOURCE_LABEL[r].toLowerCase()}`)
    .join(', ');
  const extra = b.defence ? `+${b.defence * 100}% defence` : b.tax ? `+$${b.tax}/s tax` : '';
  return `${fmtMoney(b.cost)}${res ? ' + ' + res : ''} · ${b.buildSec}s · ${[y, extra].filter(Boolean).join(', ')}`;
}

export function ProvincePanel() {
  const st = useStore((s) => s.static);
  const view = useStore((s) => s.view);
  const sel = useStore((s) => s.selectedProvince);
  const selArmy = useStore((s) => s.selectedArmy);
  const now = useNow(250);
  if (!st || !view) return null;
  if (sel === null || !st.map.provinces[sel]) {
    return (
      <div className="pp">
        <div className="pp-empty">
          Click a province. Click one of your army markers, then a highlighted neighbour, to march.
        </div>
      </div>
    );
  }
  const p = st.map.provinces[sel];
  const pv = view.provinces[sel];
  const owner = st.nations.find((n) => n.id === pv.ownerId);
  const ownerPub = view.nations.find((n) => n.id === pv.ownerId);
  const mine = pv.ownerId === view.me.id;
  const myArmiesHere = view.armies.filter((a) => a.ownerId === view.me.id && a.provinceId === sel && !a.move);
  const foreignHere = view.armies.filter((a) => a.ownerId !== view.me.id && a.provinceId === sel && !a.move);
  const recruiting = view.me.recruiting.filter((r) => r.provinceId === sel);
  const atWarWithOwner = ownerPub && view.nations.find((n) => n.id === view.me.id)?.atWarWith.includes(ownerPub.id);
  const isAlly = ownerPub && view.nations.find((n) => n.id === view.me.id)?.allies.includes(ownerPub.id);
  const m = CONFIG.military;

  return (
    <div className="pp">
      <div className="pp-head">
        <span className="swatch" style={{ background: owner?.color ?? '#3a4450' }} />
        <b>{p.name}</b>
        <span className="tag">{p.terrain}</span>
        {p.coastal && <span className="tag">coastal</span>}
        <span className="tag" title="This province's commodity specialty">{p.specialty}</span>
        <span style={{ flex: 1 }} />
        <span className="dim">{owner ? owner.name : 'Neutral'}</span>
      </div>
      <div className="pp-body">
        <div className="pp-stats">
          <div>
            <span className="k">Garrison</span>
            <span className="num">{pv.visible ? pv.garrison ?? 0 : '?'}</span>
          </div>
          <div>
            <span className="k">Defence</span>
            <span className="num">×{(CONFIG.terrainDefence[p.terrain] + (pv.buildings?.includes('fort') ? CONFIG.buildings.fort.defence : 0)).toFixed(2)}</span>
          </div>
          <div>
            <span className="k">Buildings</span>
            <span>{pv.visible ? (pv.buildings?.length ? pv.buildings.map((b) => BUILDING_LABEL[b]).join(', ') : 'none') : '?'}</span>
          </div>
          {pv.effect && (
            <div>
              <span className="k">Status</span>
              <span style={{ color: '#ff9a3c' }}>{pv.effect}</span>
            </div>
          )}
          {pv.construction && (
            <div>
              <span className="k">Building</span>
              <span>
                {BUILDING_LABEL[pv.construction.kind]}
                {pv.construction.doneAt > 0 && <span className="amber"> {Math.max(0, Math.ceil((pv.construction.doneAt - now) / 1000))}s</span>}
              </span>
            </div>
          )}
          {foreignHere.length > 0 && (
            <div>
              <span className="k">Foreign troops</span>
              <span className="down">{foreignHere.reduce((s, a) => s + a.strength, 0).toFixed(0)}</span>
            </div>
          )}
        </div>

        {mine && (
          <>
            <div className="label" style={{ marginTop: 8 }}>
              Construct ({pv.buildings?.length ?? 0}/{CONFIG.maxBuildingsPerProvince})
            </div>
            <div className="build-grid">
              {BUILD_ORDER.filter((k) => k !== 'port' || p.coastal).map((k) => (
                <button
                  key={k}
                  className="btn sm"
                  title={costText(k)}
                  disabled={!!pv.construction || (pv.buildings?.length ?? 0) >= CONFIG.maxBuildingsPerProvince || pv.buildings?.includes(k)}
                  onClick={() => act({ type: 'build', provinceId: sel, kind: k })}
                >
                  {BUILDING_LABEL[k]}
                  <span className="faint"> {fmtMoney(CONFIG.buildings[k].cost)}</span>
                </button>
              ))}
            </div>
            <div className="label" style={{ marginTop: 10 }}>
              Military
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn sm" onClick={() => act({ type: 'recruit', provinceId: sel })} title={`${fmtMoney(m.armyCost)} + ${Object.entries(m.armyResources).map(([r, v]) => `${v} ${r}`).join(', ')} · ${m.armyBuildSec}s`}>
                Recruit army (+{m.armyStrength}) <span className="faint">{fmtMoney(m.armyCost)}</span>
              </button>
              {recruiting.map((r, i) => (
                <span key={i} className="tag">
                  training {Math.max(0, Math.ceil((r.doneAt - now) / 1000))}s
                </span>
              ))}
            </div>
          </>
        )}
        {myArmiesHere.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="dim">Your army here: {myArmiesHere.reduce((s, a) => s + a.strength, 0).toFixed(0)} strength</span>
            <button className={`btn sm ${selArmy === myArmiesHere[0].id ? 'primary' : ''}`} onClick={() => setState({ selectedArmy: selArmy === myArmiesHere[0].id ? null : myArmiesHere[0].id })}>
              {selArmy === myArmiesHere[0].id ? 'Pick destination on map…' : 'Move'}
            </button>
          </div>
        )}
        {owner && !mine && ownerPub && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {atWarWithOwner ? (
              <>
                <span className="tag red">at war</span>
                <button className="btn sm" onClick={() => act({ type: 'proposePeace', targetId: ownerPub.id })}>
                  Offer peace
                </button>
              </>
            ) : isAlly ? (
              <span className="tag green">ally</span>
            ) : (
              <button
                className="btn sm sell"
                disabled={now < view.me.warCooldownUntil}
                onClick={() => {
                  if (confirm(`Declare war on ${ownerPub.name}? Your stability drops ${CONFIG.stability.declareWarHit} and markets will react.`))
                    act({ type: 'declareWar', targetId: ownerPub.id });
                }}
              >
                Declare war on {ownerPub.name}
                {now < view.me.warCooldownUntil && ` (${Math.ceil((view.me.warCooldownUntil - now) / 1000)}s)`}
              </button>
            )}
          </div>
        )}
        {!owner && (
          <div className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>
            Neutral land. March an army in to take it — no war declaration needed. Beat the garrison.
          </div>
        )}
      </div>
    </div>
  );
}
