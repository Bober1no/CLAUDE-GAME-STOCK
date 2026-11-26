import { useEffect, useRef, useState } from 'react';
import { CONFIG, fmtClock, type DealTerms } from '@warmarket/shared';
import { act } from '../net/socket';
import { useStore } from '../state/store';
import { useNow } from '../hooks';

const FLOW_KEYS = ['cash', 'oil', 'food', 'metals', 'tech'] as const;

function termsText(t: DealTerms['give']): string {
  const parts = FLOW_KEYS.filter((k) => (t[k] ?? 0) > 0).map((k) => `${t[k]} ${k}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

export function DiplomacyPanel() {
  const [tab, setTab] = useState<'chat' | 'nations' | 'deals'>('chat');
  const view = useStore((s) => s.view);
  const pending = useStore((s) => (s.view ? s.view.proposals.filter((p) => p.to === s.view!.me.id).length + s.view.deals.filter((d) => d.status === 'proposed' && d.to === s.view!.me.id).length : 0));
  if (!view) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="subtabs">
        {(['chat', 'nations', 'deals'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : 'ghost'}`} onClick={() => setTab(t)}>
            {t}
            {t === 'deals' && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </div>
      {tab === 'chat' && <Chat />}
      {tab === 'nations' && <Nations />}
      {tab === 'deals' && <Deals />}
    </div>
  );
}

function Chat() {
  const chat = useStore((s) => s.chat);
  const st = useStore((s) => s.static);
  const lb = useStore((s) => s.view?.leaderboard);
  const [to, setTo] = useState<string>('');
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [chat.length]);
  if (!st || !lb) return null;
  const me = st.playerId;
  const colorOf = (pid: string) => lb.find((r) => r.playerId === pid)?.color ?? '#aaa';
  const nameOf = (pid: string) => lb.find((r) => r.playerId === pid)?.name ?? '?';

  async function send() {
    const t = text.trim();
    if (!t) return;
    const r = await act({ type: 'chat', text: t, toId: to || null });
    if (r.ok) setText('');
  }

  return (
    <>
      <div className="panel-b chat" ref={box}>
        {chat.length === 0 && <div className="empty">Say something threatening.</div>}
        {chat.map((c) => (
          <div key={c.id} className={`chat-line ${c.toId ? 'dm' : ''}`}>
            <span style={{ color: colorOf(c.fromId), fontWeight: 600 }}>{c.fromName}</span>
            {c.toId && <span className="faint"> → {c.toId === me ? 'you' : nameOf(c.toId)}</span>}
            <span className="faint">: </span>
            <span>{c.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-in">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 92 }}>
          <option value="">All</option>
          {lb
            .filter((r) => r.playerId !== me)
            .map((r) => (
              <option key={r.playerId} value={r.playerId}>
                @{r.name}
              </option>
            ))}
        </select>
        <input className="input" maxLength={CONFIG.diplomacy.chatMaxLength} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={to ? 'Private message…' : 'Message everyone…'} />
      </div>
    </>
  );
}

function Nations() {
  const view = useStore((s) => s.view)!;
  const st = useStore((s) => s.static)!;
  const now = useNow(500);
  const me = view.nations.find((n) => n.id === view.me.id)!;
  return (
    <div className="panel-b" style={{ padding: '6px 10px' }}>
      {view.nations
        .filter((n) => n.id !== me.id)
        .map((n) => {
          const atWar = me.atWarWith.includes(n.id);
          const allied = me.allies.includes(n.id);
          const sanctioning = n.sanctionedBy.includes(me.id);
          const name = st.nations.find((x) => x.id === n.id)?.name ?? n.name;
          return (
            <div key={n.id} className="nation-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="swatch" style={{ background: n.color }} />
                <b style={{ opacity: n.connected ? 1 : 0.5 }}>{name}</b>
                <span style={{ flex: 1 }} />
                {atWar && <span className="tag red">war</span>}
                {allied && <span className="tag green">ally</span>}
                {n.embargoed && <span className="tag red">embargo</span>}
                {n.eliminated && <span className="tag red">fallen</span>}
              </div>
              <div className="faint" style={{ fontSize: 11, margin: '3px 0 5px' }}>
                {n.provinces} provinces · stability {n.stability} · reputation <span className={n.reputation < 70 ? 'down' : ''}>{n.reputation}</span>
                {n.sanctionedBy.length > 0 && ` · sanctioned by ${n.sanctionedBy.length}`}
                {n.atWarWith.length > 0 && ` · at war with ${n.atWarWith.map((x) => st.nations.find((y) => y.id === x)?.name.split(' ').pop()).join(', ')}`}
              </div>
              {!n.eliminated && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {atWar ? (
                    <button className="btn sm" onClick={() => act({ type: 'proposePeace', targetId: n.id })}>
                      Offer peace
                    </button>
                  ) : allied ? (
                    <button className="btn sm ghost" onClick={() => confirm(`Break your alliance with ${name}? Reputation -${CONFIG.diplomacy.allianceBreakReputationHit}.`) && act({ type: 'breakAlliance', targetId: n.id })}>
                      Break alliance
                    </button>
                  ) : (
                    <>
                      <button className="btn sm" onClick={() => act({ type: 'proposeAlliance', targetId: n.id })}>
                        Propose alliance
                      </button>
                      <button
                        className="btn sm sell"
                        disabled={now < view.me.warCooldownUntil}
                        onClick={() => confirm(`Declare war on ${name}?`) && act({ type: 'declareWar', targetId: n.id })}
                      >
                        Declare war
                      </button>
                    </>
                  )}
                  {!allied && (
                    <button className={`btn sm ${sanctioning ? 'primary' : 'ghost'}`} onClick={() => act({ type: 'sanction', targetId: n.id, on: !sanctioning })}>
                      {sanctioning ? 'Lift sanctions' : 'Sanction'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      <div className="label" style={{ marginTop: 10 }}>
        Wars
      </div>
      {view.wars.length === 0 && <div className="faint">The world is at peace. For now.</div>}
      {view.wars.map((w) => (
        <div key={`${w.a}${w.b}`} className="down" style={{ fontSize: 12 }}>
          {st.nations.find((x) => x.id === w.a)?.name} ⚔ {st.nations.find((x) => x.id === w.b)?.name}
          <span className="faint"> · {w.casualties} casualties · {fmtClock(now - w.since)}</span>
        </div>
      ))}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 10 }}>
        Allies share vision and can cross each other’s land. Sanctions hit the target’s stocks and stability; {CONFIG.diplomacy.embargoThreshold}+ sanctioners make an embargo (no exports, no deals).
      </div>
    </div>
  );
}

function Deals() {
  const view = useStore((s) => s.view)!;
  const st = useStore((s) => s.static)!;
  const now = useNow(1000);
  const [target, setTarget] = useState('');
  const [give, setGive] = useState<Record<string, string>>({});
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [dur, setDur] = useState('180');
  const name = (id: string) => st.nations.find((n) => n.id === id)?.name ?? id;
  const others = view.nations.filter((n) => n.id !== view.me.id && !n.eliminated);
  const toFlow = (r: Record<string, string>) => {
    const o: Record<string, number> = {};
    for (const k of FLOW_KEYS) if (Number(r[k]) > 0) o[k] = Math.floor(Number(r[k]));
    return o;
  };

  return (
    <div className="panel-b" style={{ padding: '6px 10px' }}>
      {view.proposals
        .filter((p) => p.to === view.me.id)
        .map((p) => (
          <div key={p.id} className="nation-card" style={{ borderColor: 'var(--amber)' }}>
            <div>
              <b>{name(p.from)}</b> proposes <b className="amber">{p.kind.toUpperCase()}</b>
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
              <button className="btn sm buy" onClick={() => act({ type: 'respondProposal', proposalId: p.id, accept: true })}>
                Accept
              </button>
              <button className="btn sm sell" onClick={() => act({ type: 'respondProposal', proposalId: p.id, accept: false })}>
                Reject
              </button>
            </div>
          </div>
        ))}

      <div className="label">Trade deals</div>
      {view.deals.length === 0 && <div className="faint" style={{ marginBottom: 8 }}>No deals yet.</div>}
      {[...view.deals].reverse().map((d) => {
        const mineFrom = d.from === view.me.id;
        const partner = name(mineFrom ? d.to : d.from);
        const youGive = mineFrom ? d.terms.give : d.terms.receive;
        const youGet = mineFrom ? d.terms.receive : d.terms.give;
        return (
          <div key={d.id} className="nation-card">
            <div style={{ display: 'flex', gap: 6 }}>
              <b>{partner}</b>
              <span style={{ flex: 1 }} />
              <span className={`tag ${d.status === 'active' ? 'green' : d.status === 'broken' ? 'red' : ''}`}>{d.status}</span>
            </div>
            <div style={{ fontSize: 11.5 }}>
              You give <span className="down">{termsText(youGive)}</span>/min · you get <span className="up">{termsText(youGet)}</span>/min
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              {d.status === 'active' && d.endsAt ? `${fmtClock(d.endsAt - now)} left` : `${Math.round(d.terms.durationSec / 60)} min`}
            </div>
            {d.status === 'proposed' && d.to === view.me.id && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className="btn sm buy" onClick={() => act({ type: 'respondDeal', dealId: d.id, accept: true })}>
                  Accept
                </button>
                <button className="btn sm sell" onClick={() => act({ type: 'respondDeal', dealId: d.id, accept: false })}>
                  Reject
                </button>
              </div>
            )}
            {d.status === 'active' && (
              <button
                className="btn sm ghost"
                style={{ marginTop: 4 }}
                onClick={() => confirm(`Break this deal? Reputation -${CONFIG.diplomacy.breakDealReputationHit}, stability -${CONFIG.diplomacy.breakDealStabilityHit}.`) && act({ type: 'breakDeal', dealId: d.id })}
              >
                Break deal
              </button>
            )}
          </div>
        );
      })}

      <div className="label" style={{ marginTop: 10 }}>
        Propose a deal (amounts per minute)
      </div>
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ marginBottom: 6 }}>
        <option value="">Choose a partner…</option>
        {others.map((n) => (
          <option key={n.id} value={n.id}>
            {name(n.id)}
          </option>
        ))}
      </select>
      <div className="deal-grid">
        <span />
        <span className="faint">You give</span>
        <span className="faint">You get</span>
        {FLOW_KEYS.map((k) => (
          <FlowRow key={k} k={k} give={give[k] ?? ''} recv={recv[k] ?? ''} setGive={(v) => setGive({ ...give, [k]: v })} setRecv={(v) => setRecv({ ...recv, [k]: v })} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <select className="input" value={dur} onChange={(e) => setDur(e.target.value)}>
          {[60, 120, 180, 300, 600].map((s) => (
            <option key={s} value={s}>
              {s / 60} min
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={!target}
          onClick={async () => {
            const r = await act({ type: 'proposeDeal', targetId: target, terms: { give: toFlow(give), receive: toFlow(recv), durationSec: Number(dur) } });
            if (r.ok) {
              setGive({});
              setRecv({});
            }
          }}
        >
          Offer
        </button>
      </div>
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        If either side can’t pay, they default: the deal breaks and they lose reputation.
      </div>
    </div>
  );
}

function FlowRow({ k, give, recv, setGive, setRecv }: { k: string; give: string; recv: string; setGive: (v: string) => void; setRecv: (v: string) => void }) {
  return (
    <>
      <span style={{ textTransform: 'capitalize' }}>{k}</span>
      <input className="input num" value={give} placeholder="0" onChange={(e) => setGive(e.target.value.replace(/[^0-9]/g, ''))} />
      <input className="input num" value={recv} placeholder="0" onChange={(e) => setRecv(e.target.value.replace(/[^0-9]/g, ''))} />
    </>
  );
}
