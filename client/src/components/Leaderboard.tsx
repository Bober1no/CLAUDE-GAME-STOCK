import { CONFIG, fmtMoney } from '@warmarket/shared';
import { useStore } from '../state/store';

export function Leaderboard() {
  const rows = useStore((s) => s.view?.leaderboard);
  const me = useStore((s) => s.static?.playerId);
  const objective = useStore((s) => s.view?.objective);
  const nations = useStore((s) => s.view?.nations);
  if (!rows) return null;
  const start = CONFIG.start.treasury;
  return (
    <div className="panel">
      <div className="panel-h">
        Leaderboard<span className="sp" />
        <span className="faint" style={{ letterSpacing: 0 }}>net worth</span>
      </div>
      <table className="grid">
        <tbody>
          {rows.map((r, i) => {
            const n = nations?.find((x) => x.playerId === r.playerId);
            return (
              <tr key={r.playerId} className={r.playerId === me ? 'sel' : ''}>
                <td className="mono faint" style={{ width: 18 }}>
                  {i + 1}
                </td>
                <td>
                  <span className="swatch" style={{ background: r.color, marginRight: 6 }} />
                  <span style={{ fontWeight: r.playerId === me ? 700 : 400, opacity: r.connected ? 1 : 0.5 }}>{r.name}</span>
                  {n?.eliminated && <span className="tag red" style={{ marginLeft: 4 }}>out</span>}
                  {n && n.atWarWith.length > 0 && <span className="tag red" style={{ marginLeft: 4 }}>war</span>}
                </td>
                <td className="r num">{fmtMoney(r.netWorth)}</td>
                <td className={`r num ${r.netWorth >= start ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                  {nations?.length ? '' : `${r.netWorth >= start ? '+' : ''}${(((r.netWorth - start) / start) * 100).toFixed(0)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {objective && <div className="faint" style={{ padding: '5px 9px', fontSize: 11 }}>{objective}</div>}
    </div>
  );
}
