import { CONFIG, fmtClock, fmtMoney } from '@warmarket/shared';
import { useNow } from '../hooks';
import { useStore } from '../state/store';

export function TopBar() {
  const now = useNow(200);
  const st = useStore((s) => s.static);
  const nextTickAt = useStore((s) => s.nextTickAt);
  const account = useStore((s) => s.account);
  const view = useStore((s) => s.view);
  const tick = useStore((s) => s.tick);
  const me = view?.me;
  if (!st) return null;
  const toTick = Math.max(0, nextTickAt - now);
  const frac = 1 - toTick / CONFIG.clocks.marketTickMs;
  const rank = view ? view.leaderboard.findIndex((r) => r.playerId === st.playerId) + 1 : 0;
  const myNation = st.nations.find((n) => n.playerId === st.playerId);

  return (
    <div className="topbar">
      <div className="tb-cell tb-brand">
        <span>
          WAR<b>/</b>MKT<i>_</i>
        </span>
      </div>
      <div className="tb-cell">
        <span className="k">Room</span>
        <span className="v amber">{st.code}</span>
      </div>
      {myNation && (
        <div className="tb-cell">
          <span className="k">Nation</span>
          <span className="v" style={{ color: myNation.color, fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600 }}>
            {myNation.name}
          </span>
        </div>
      )}
      <div className="tb-cell">
        <span className="k">Session</span>
        <span className={`v ${st.endsAt - now < 60_000 ? 'down' : ''}`}>{fmtClock(st.endsAt - now)}</span>
      </div>
      <div className="tb-cell">
        <span className="k">Next clear · #{tick + 1}</span>
        <span className={`v ${toTick < 4000 ? 'down' : 'amber'}`}>{(toTick / 1000).toFixed(1)}s</span>
        <div className={`tick-meter ${toTick < 4000 ? 'hot' : ''}`}>
          <div style={{ width: `${Math.min(100, frac * 100)}%` }} />
        </div>
      </div>
      <div className="tb-sp" />
      {me && st.nations.length > 0 && (
        <div className="tb-cell">
          <span className="k">Stability</span>
          <span className={`v ${me.stability < CONFIG.stability.protestThreshold ? 'down' : me.stability > 60 ? 'up' : 'amber'}`}>
            {me.stability.toFixed(0)}
            {me.protesting && <span className="tag red" style={{ marginLeft: 6 }}>protests</span>}
          </span>
        </div>
      )}
      {account && (
        <>
          <div className="tb-cell">
            <span className="k">Treasury (free)</span>
            <span className={`v ${account.cash < 0 ? 'down' : ''}`}>{fmtMoney(account.cash - account.reserved)}</span>
          </div>
          <div className="tb-cell">
            <span className="k">Net worth</span>
            <span className="v up">{fmtMoney(account.netWorth)}</span>
          </div>
        </>
      )}
      <div className="tb-cell">
        <span className="k">Rank</span>
        <span className="v">
          {rank || '-'}/{view?.leaderboard.length ?? '-'}
        </span>
      </div>
    </div>
  );
}
