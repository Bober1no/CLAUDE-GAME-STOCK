import { fmtMoney } from '@warmarket/shared';
import { setState, useStore } from '../state/store';

export function Leaderboard() {
  const rows = useStore((s) => s.view?.leaderboard);
  const me = useStore((s) => s.static?.playerId);
  if (!rows) return null;
  return (
    <div className="panel">
      <div className="panel-h">
        Leaderboard<span className="sp" />
        <span className="faint" style={{ letterSpacing: 0 }}>net worth</span>
      </div>
      <table className="grid">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className={`click ${r.playerId === me ? 'sel' : ''}`} onClick={() => setState({ selectedAsset: r.companyId })} title={`Trade ${r.companyId}`}>
              <td className="mono faint" style={{ width: 18 }}>
                {i + 1}
              </td>
              <td>
                <span className="swatch" style={{ background: r.color, marginRight: 6 }} />
                <span style={{ fontWeight: r.playerId === me ? 700 : 400, opacity: r.connected ? 1 : 0.5 }}>{r.name}</span>
                <span className="faint mono" style={{ fontSize: 10.5 }}> {r.companyId}</span>
                {r.reputation < 60 && (
                  <span className="tag red" style={{ marginLeft: 4 }} title="Low reputation: the regulator is watching">
                    shady
                  </span>
                )}
              </td>
              <td className="r num">{fmtMoney(r.netWorth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="faint" style={{ padding: '5px 9px', fontSize: 11 }}>
        Highest net worth (cash + every position, including your own stock) at the closing bell wins.
      </div>
    </div>
  );
}
