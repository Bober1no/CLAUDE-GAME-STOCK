import { fmtMoney, fmtPct } from '@warmarket/shared';
import { leaveRoom } from '../net/socket';
import { setState, useStore } from '../state/store';

export function Recap() {
  const recap = useStore((s) => s.recap);
  const me = useStore((s) => s.static?.playerId);
  if (!recap) return null;
  const winner = recap.standings.find((s) => s.playerId === recap.winnerId);
  return (
    <div className="overlay">
      <div className="recap">
        <div className="recap-hero">
          <div className="label" style={{ color: 'var(--amber)' }}>Closing bell</div>
          <div className="w" style={{ color: winner?.color }}>
            {winner ? `${winner.name} wins` : 'No winner'}
            {winner?.playerId === me && ' — that’s you'}
          </div>
          <div className="dim">{recap.reason}</div>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="r">Company</th>
              <th className="r">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {recap.standings.map((s) => (
              <tr key={s.playerId} className={s.playerId === me ? 'sel' : ''}>
                <td className="mono">{s.rank}</td>
                <td>
                  <span className="swatch" style={{ background: s.color, marginRight: 6 }} />
                  {s.name}
                </td>
                <td className="r num">
                  {s.companyId} <span className={s.companyChange >= 0 ? 'up' : 'down'}>{fmtPct(s.companyChange, 0)}</span>
                </td>
                <td className="r num">{fmtMoney(s.netWorth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recap.awards.length > 0 && (
          <div className="awards" style={{ borderTop: '1px solid var(--line)' }}>
            {recap.awards.map((a) => (
              <div className="award" key={a.title}>
                <div className="t">{a.title}</div>
                <div className="w">{a.who}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {a.detail}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ padding: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setState({ recap: null })}>
            Look at the wreckage
          </button>
          <button className="btn primary" onClick={() => leaveRoom()}>
            New game
          </button>
        </div>
      </div>
    </div>
  );
}
