import { useState } from 'react';
import { CONFIG, fmtMoney, fmtPrice, type SpyMission } from '@warmarket/shared';
import { act } from '../net/socket';
import { useStore } from '../state/store';
import { useNow } from '../hooks';

const MISSIONS: { id: SpyMission; label: string; desc: string }[] = [
  { id: 'vision', label: 'Surveil', desc: `See their land and armies for ${CONFIG.espionage.visionDurationSec}s` },
  { id: 'orderflow', label: 'Read their desk', desc: `See their queued orders + the live order book for ${CONFIG.espionage.orderflowDurationSec}s` },
  { id: 'stealTech', label: 'Steal tech', desc: `Take ${CONFIG.espionage.stealTechFraction * 100}% of their tech stockpile` },
  { id: 'fakeNews', label: 'Plant story', desc: 'Publish a damaging fake headline about one of their companies' },
];

const ROLE_TEXT: Record<string, string> = {
  analyst: 'ANALYST — your pressure bars show the live, exact order book.',
  whale: 'WHALE — you started rich. Move markets, but the regulator watches round trips.',
  journalist: 'JOURNALIST — you can publish headlines to everyone under "Citizen Journal".',
};

export function IntelPanel() {
  const view = useStore((s) => s.view);
  const st = useStore((s) => s.static);
  const tips = useStore((s) => s.tips);
  const now = useNow(500);
  const [target, setTarget] = useState('');
  const [mission, setMission] = useState<SpyMission>('vision');
  const [asset, setAsset] = useState('');
  const [headline, setHeadline] = useState('');
  if (!view || !st) return null;
  const me = view.me;
  const e = CONFIG.espionage;
  const others = view.nations.filter((n) => n.id !== me.id && !n.eliminated);
  const nameOf = (id: string) => st.nations.find((n) => n.id === id)?.name ?? id;
  const targetCompanies = st.assets.filter((a) => a.nationId === target);

  return (
    <div className="panel-b" style={{ padding: '8px 10px' }}>
      {me.role !== 'none' && (
        <div className="nation-card" style={{ borderColor: 'var(--amber)' }}>
          <div className="label" style={{ color: 'var(--amber)' }}>
            Secret role
          </div>
          {ROLE_TEXT[me.role]}
        </div>
      )}

      {me.role === 'journalist' && (
        <div className="nation-card">
          <div className="label">Publish a headline</div>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="label" style={{ margin: 0, flex: 1 }}>
          Spies ({me.spies.length}/{e.maxSpies})
        </div>
        <button className="btn sm" disabled={me.spies.length >= e.maxSpies} onClick={() => act({ type: 'trainSpy' })} title={`${e.spyTrainSec}s to train`}>
          Train spy <span className="faint">{fmtMoney(e.spyCost)} + {e.spyTech} tech</span>
        </button>
      </div>
      <div style={{ margin: '6px 0 10px' }}>
        {me.spies.length === 0 && <div className="faint">No agents. Every nation needs a few.</div>}
        {me.spies.map((s, i) => {
          const busy = s.readyAt > now;
          return (
            <div key={s.id} className="spy-row">
              <span className="mono">Agent 00{i + 1}</span>
              <span className="dim" style={{ flex: 1 }}>
                {s.status === 'training' ? 'in training' : s.status === 'mission' ? `${s.mission} → ${nameOf(s.targetId!)}` : busy ? 'lying low' : 'ready'}
              </span>
              {busy && <span className="amber mono">{Math.ceil((s.readyAt - now) / 1000)}s</span>}
              {!busy && s.status === 'idle' && (
                <button
                  className="btn sm primary"
                  disabled={!target || (mission === 'fakeNews' && !asset)}
                  onClick={() => act({ type: 'spyMission', spyId: s.id, targetId: target, mission, assetId: mission === 'fakeNews' ? asset : undefined })}
                >
                  Send
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="label">Mission</div>
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ marginBottom: 4 }}>
        <option value="">Target nation…</option>
        {others.map((n) => (
          <option key={n.id} value={n.id}>
            {nameOf(n.id)}
          </option>
        ))}
      </select>
      <div className="mission-grid">
        {MISSIONS.map((m) => (
          <button key={m.id} className={`btn sm ${mission === m.id ? 'primary' : 'ghost'}`} title={`${m.desc} · ${Math.round((e.successChance[m.id] ?? 0) * 100)}% success`} onClick={() => setMission(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mission === 'fakeNews' && (
        <select className="input" value={asset} onChange={(e) => setAsset(e.target.value)} style={{ marginTop: 4 }}>
          <option value="">Which company?</option>
          {targetCompanies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} — {a.name}
            </option>
          ))}
        </select>
      )}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        {MISSIONS.find((m) => m.id === mission)?.desc}. {Math.round((e.successChance[mission] ?? 0) * 100)}% success. Caught = spy lost, reputation −{e.caughtReputationHit}, public scandal.
      </div>

      {(me.spyVisionOn.length > 0 || me.orderflowOn.length > 0) && (
        <div className="nation-card" style={{ marginTop: 10, borderColor: '#a06cff' }}>
          <div className="label" style={{ color: '#b991ff' }}>
            Active intel
          </div>
          {me.spyVisionOn.map((n) => (
            <div key={n}>Watching {nameOf(n)}</div>
          ))}
          {view.spiedOrders.map((so) => (
            <div key={so.nationId} style={{ marginTop: 4 }}>
              <div>{nameOf(so.nationId)}’s queued orders:</div>
              {so.orders.length === 0 && <div className="faint">nothing queued</div>}
              {so.orders.map((o) => (
                <div key={o.id} className="mono" style={{ fontSize: 11.5 }}>
                  <span className={o.side === 'buy' || o.side === 'cover' ? 'up' : 'down'}>{o.side.toUpperCase()}</span> {o.qty} {o.assetId}
                  {o.leverage > 1 ? ` ${o.leverage}x` : ''}
                  {o.type === 'limit' ? ` @${fmtPrice(o.limitPrice!)}` : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="label" style={{ marginTop: 12 }}>
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
        Tips are sometimes wrong. Rumour Mill headlines are false about {Math.round(CONFIG.events.rumourFalseRate * 100)}% of the time.
      </div>
    </div>
  );
}
