import { CONFIG, GAME_VERSION, fmtClock, fmtMoney, fmtPct, fmtPrice } from '@warmarket/shared';
import { useNow } from '../hooks';
import { setState, useStore } from '../state/store';

export function TopBar() {
  const now = useNow(200);
  const st = useStore((s) => s.static);
  const nextTickAt = useStore((s) => s.nextTickAt);
  const account = useStore((s) => s.account);
  const view = useStore((s) => s.view);
  const tick = useStore((s) => s.tick);
  const myQuote = useStore((s) => (s.view ? s.quotes[s.view.me.companyId] : undefined));
  if (!st) return null;
  const toTick = Math.max(0, nextTickAt - now);
  const frac = 1 - toTick / CONFIG.clocks.marketTickMs;
  const rank = view ? view.leaderboard.findIndex((r) => r.playerId === st.playerId) + 1 : 0;
  const me = view?.me;

  return (
    <div className="topbar">
      <div className="tb-cell tb-brand">
        <span>
          WAR<b>/</b>MKT<i>_</i> <span className="ver">{GAME_VERSION}</span>
        </span>
      </div>
      <div className="tb-cell">
        <span className="k">Room</span>
        <span className="v amber">{st.code}</span>
      </div>
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
      {me && myQuote && (
        <div className="tb-cell" style={{ cursor: 'pointer' }} onClick={() => setState({ selectedAsset: me.companyId })} title="Your company">
          <span className="k">Your stock</span>
          <span className="v">
            {me.companyId} {fmtPrice(myQuote.price)} <span className={myQuote.changeTotal >= 0 ? 'up' : 'down'} style={{ fontSize: 12 }}>{fmtPct(myQuote.changeTotal, 0)}</span>
          </span>
        </div>
      )}
      <div className="tb-sp" />
      {me && (
        <div className="tb-cell">
          <span className="k">Reputation</span>
          <span className={`v ${me.reputation < 60 ? 'down' : me.reputation < 90 ? 'amber' : 'up'}`}>{me.reputation}</span>
        </div>
      )}
      {account && (
        <>
          <div className="tb-cell">
            <span className="k">Cash (free)</span>
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
