import { useState } from 'react';
import { CONFIG, fmtMoney, fmtPrice } from '@warmarket/shared';
import { act } from '../net/socket';
import { useStore } from '../state/store';
import { useNow } from '../hooks';

const I = CONFIG.influence;

const ROLE_TEXT: Record<string, string> = {
  analyst: 'ANALYST — your pressure bars always show the live, exact order book.',
  whale: 'WHALE — you started rich. Move markets, but the regulator watches round trips.',
  journalist: 'JOURNALIST — you can publish headlines to everyone under "Citizen Journal".',
};

export function InfluencePanel() {
  const view = useStore((s) => s.view);
  const st = useStore((s) => s.static);
  const tips = useStore((s) => s.tips);
  const selected = useStore((s) => s.selectedAsset);
  const now = useNow(500);
  const [storyAsset, setStoryAsset] = useState('');
  const [lobbyAsset, setLobbyAsset] = useState('OIL');
  const [spyTarget, setSpyTarget] = useState('');
  const [headline, setHeadline] = useState('');
  if (!view || !st) return null;
  const me = view.me;
  const cd = (k: keyof typeof me.cooldowns) => Math.max(0, Math.ceil(((me.cooldowns[k] ?? 0) - now) / 1000));
  const targetAsset = storyAsset || (st.assets.find((a) => a.id === selected && a.kind !== 'memecoin') ? selected : 'OIL');
  const storyable = st.assets.filter((a) => a.kind !== 'memecoin');
  const commodities = st.assets.filter((a) => a.kind === 'commodity');
  const rivals = st.players.filter((p) => p.id !== st.playerId);
  const nameOf = (pid: string) => view.leaderboard.find((r) => r.playerId === pid)?.name ?? '?';

  return (
    <div className="panel-b" style={{ padding: '8px 10px' }}>
      {me.role !== 'none' && (
        <div className="info-card" style={{ borderColor: 'var(--amber)' }}>
          <div className="label" style={{ color: 'var(--amber)' }}>
            Secret role
          </div>
          {ROLE_TEXT[me.role]}
        </div>
      )}

      <div className="inf-block">
        <div className="inf-h">
          <b>Plant a story</b> <span className="faint">{fmtMoney(I.story.cost)}</span>
        </div>
        <div className="faint inf-d">
          ±{Math.round(I.story.impact * 100)}% on any company or commodity. {Math.round((1 - I.story.successChance) * 100)}% chance it gets traced to you ({fmtMoney(I.story.fine)} fine, public shame).
        </div>
        <div className="inf-row">
          <select className="input" value={targetAsset} onChange={(e) => setStoryAsset(e.target.value)}>
            {storyable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} — {a.name}
              </option>
            ))}
          </select>
          <button className="btn sm buy" disabled={cd('story') > 0} onClick={() => act({ type: 'story', assetId: targetAsset, positive: true })}>
            {cd('story') ? `${cd('story')}s` : 'Pump'}
          </button>
          <button className="btn sm sell" disabled={cd('story') > 0} onClick={() => act({ type: 'story', assetId: targetAsset, positive: false })}>
            {cd('story') ? `${cd('story')}s` : 'Smear'}
          </button>
        </div>
      </div>

      <div className="inf-block">
        <div className="inf-h">
          <b>Lobby the government</b> <span className="faint">{fmtMoney(I.lobby.cost)}</span>
        </div>
        <div className="faint inf-d">
          Push a commodity ±{Math.round(I.lobby.impact * 100)}% over {I.lobby.ticks} clears with subsidies, tariffs or reserve releases. Legal. Mostly.
        </div>
        <div className="inf-row">
          <select className="input" value={lobbyAsset} onChange={(e) => setLobbyAsset(e.target.value)}>
            {commodities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} — {a.name}
              </option>
            ))}
          </select>
          <button className="btn sm buy" disabled={cd('lobby') > 0} onClick={() => act({ type: 'lobby', assetId: lobbyAsset, up: true })}>
            {cd('lobby') ? `${cd('lobby')}s` : 'Up'}
          </button>
          <button className="btn sm sell" disabled={cd('lobby') > 0} onClick={() => act({ type: 'lobby', assetId: lobbyAsset, up: false })}>
            {cd('lobby') ? `${cd('lobby')}s` : 'Down'}
          </button>
        </div>
      </div>

      <div className="inf-block">
        <div className="inf-h">
          <b>Plant a mole</b> <span className="faint">{fmtMoney(I.spy.cost)}</span>
        </div>
        <div className="faint inf-d">
          See a rival’s queued orders for {I.spy.durationSec}s. {Math.round(I.spy.caughtChance * 100)}% chance the mole gets caught.
        </div>
        <div className="inf-row">
          <select className="input" value={spyTarget} onChange={(e) => setSpyTarget(e.target.value)}>
            <option value="">Pick a rival…</option>
            {rivals.map((p) => (
              <option key={p.id} value={p.id}>
                {nameOf(p.id)}
              </option>
            ))}
          </select>
          <button className="btn sm primary" disabled={!spyTarget || cd('spy') > 0} onClick={() => act({ type: 'spy', targetId: spyTarget })}>
            {cd('spy') ? `${cd('spy')}s` : 'Send'}
          </button>
        </div>
      </div>

      <div className="inf-block">
        <div className="inf-h">
          <b>Research subscription</b> <span className="faint">{fmtMoney(I.research.cost)}</span>
        </div>
        <div className="faint inf-d">See the live, exact order book for {I.research.durationSec}s instead of the fuzzy delayed bars.</div>
        <button className="btn sm" disabled={cd('research') > 0} onClick={() => act({ type: 'research' })}>
          {me.researchUntil > now ? `Active ${Math.ceil((me.researchUntil - now) / 1000)}s — extend` : 'Subscribe'}
        </button>
      </div>

      {me.role === 'journalist' && (
        <div className="inf-block">
          <div className="inf-h">
            <b>Publish a headline</b> <span className="faint">free</span>
          </div>
          <input className="input" maxLength={120} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="EXCLUSIVE: …" />
          <button
            className="btn sm primary"
            style={{ marginTop: 5 }}
            disabled={now < me.journalistReadyAt || headline.trim().length < 5}
            onClick={async () => {
              const r = await act({ type: 'publish', headline });
              if (r.ok) setHeadline('');
            }}
          >
            {now < me.journalistReadyAt ? `Editor says wait ${Math.ceil((me.journalistReadyAt - now) / 1000)}s` : 'Publish'}
          </button>
        </div>
      )}

      {view.spiedOrders.length > 0 && (
        <div className="info-card" style={{ borderColor: '#a06cff' }}>
          <div className="label" style={{ color: '#b991ff' }}>
            Mole reports
          </div>
          {view.spiedOrders.map((so) => {
            const until = me.spying.find((s) => s.playerId === so.playerId)?.until ?? 0;
            return (
              <div key={so.playerId} style={{ marginBottom: 4 }}>
                <div>
                  {nameOf(so.playerId)}’s desk <span className="faint">({Math.max(0, Math.ceil((until - now) / 1000))}s left)</span>
                </div>
                {so.orders.length === 0 && <div className="faint">nothing queued</div>}
                {so.orders.map((o) => (
                  <div key={o.id} className="mono" style={{ fontSize: 11.5 }}>
                    <span className={o.side === 'buy' || o.side === 'cover' ? 'up' : 'down'}>{o.side.toUpperCase()}</span> {o.qty} {o.assetId}
                    {o.leverage > 1 ? ` ${o.leverage}x` : ''}
                    {o.type === 'limit' ? ` @${fmtPrice(o.limitPrice!)}` : ''}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="label" style={{ marginTop: 10 }}>
        Insider tips you received
      </div>
      {tips.length === 0 && <div className="faint">Nobody has whispered anything to you. Yet.</div>}
      {tips.map((t) => (
        <div key={t.id} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #141b23' }}>
          <span className="faint mono" style={{ fontSize: 10 }}>
            {new Date(t.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}{' '}
          </span>
          {t.text}
        </div>
      ))}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        Tips are sometimes wrong. Rumour Mill headlines are false about {Math.round(CONFIG.events.rumourFalseRate * 100)}% of the time. Getting caught lowers your reputation, and low reputation makes the regulator twitchier.
      </div>
    </div>
  );
}
