import { useState } from 'react';
import { CONFIG, CORPORATE_LABEL, SECTOR_LABEL, fmtMoney, fmtPct, fmtPrice, type CorporateAction } from '@warmarket/shared';
import { act } from '../net/socket';
import { setState, useStore } from '../state/store';
import { useNow } from '../hooks';
import { RenameBox } from './RenameBox';

const K = CONFIG.corporate;

const ACTIONS: { id: CorporateAction; cost: string; desc: string; amount?: boolean; danger?: boolean }[] = [
  { id: 'rnd', cost: fmtMoney(K.rnd.cost), desc: `Raises long-term value in ~${K.rnd.delayTicks} clears (80% chance it pays off).` },
  { id: 'marketing', cost: fmtMoney(K.marketing.cost), desc: `+${Math.round(K.marketing.hype * 100)}% hype now, small hangover later.` },
  { id: 'buyback', cost: 'you choose', desc: 'Your cash buys your own stock: price up, value up a little.', amount: true },
  { id: 'dividend', cost: 'you choose', desc: 'Pay every holder pro rata. People shorting you have to pay it.', amount: true },
  { id: 'issue', cost: `+${fmtMoney(K.issue.cash)}`, desc: `Instant cash, but dilution: price ${Math.round(K.issue.impact * 100)}%, value down.` },
  { id: 'fraud', cost: 'free…', desc: `+${Math.round(K.fraud.hype * 100)}% fake pump. Each clear, ~${Math.round(K.fraud.discoverChancePerTick * 100)}% chance the regulator finds out: crash, ${fmtMoney(K.fraud.fineFlat)} fine.`, danger: true },
];

export function CompanyPanel() {
  const view = useStore((s) => s.view);
  const st = useStore((s) => s.static);
  const quotes = useStore((s) => s.quotes);
  const account = useStore((s) => s.account);
  const now = useNow(500);
  const [amount, setAmount] = useState<Record<string, string>>({ buyback: '2000', dividend: '1000' });
  if (!view || !st) return null;
  const me = view.me;
  const info = st.assets.find((a) => a.id === me.companyId)!;
  const q = quotes[me.companyId];
  const pub = view.companies.find((c) => c.assetId === me.companyId);
  const pos = account?.positions.find((p) => p.assetId === me.companyId);

  return (
    <div className="panel-b" style={{ padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <b style={{ fontSize: 14, cursor: 'pointer' }} onClick={() => setState({ selectedAsset: me.companyId })}>
          {info.name}
        </b>
        <span className="tag">{me.companyId}</span>
        <span className="tag">{SECTOR_LABEL[info.sector!]}</span>
        <span style={{ flex: 1 }} />
        {me.role !== 'none' && <span className="tag host">{me.role}</span>}
        <RenameBox />
      </div>
      <div className="co-stats">
        <div>
          <span className="k">Price</span>
          <span className="num">{q ? fmtPrice(q.price) : '-'}</span>
        </div>
        <div>
          <span className="k">Since IPO</span>
          <span className={`num ${q && q.changeTotal >= 0 ? 'up' : 'down'}`}>{q ? fmtPct(q.changeTotal) : '-'}</span>
        </div>
        <div title="Your company's true underlying value multiplier. Only you can see this.">
          <span className="k">Fundamentals</span>
          <span className={`num ${me.health >= 1 ? 'up' : 'down'}`}>×{me.health.toFixed(2)}</span>
        </div>
        <div>
          <span className="k">Your stake</span>
          <span className="num">{pos ? `${pos.qty} sh` : 'none'}</span>
        </div>
      </div>
      {me.fraudActive && <div className="fraud-warn">You are cooking the books. Every clear, the regulator might notice.</div>}
      {me.pendingRnd > 0 && <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>{me.pendingRnd} R&D programme(s) maturing…</div>}

      <div className="label" style={{ marginTop: 8 }}>
        CEO actions
      </div>
      {ACTIONS.map((a) => {
        const cd = me.cooldowns[a.id] ?? 0;
        const waiting = cd > now;
        const cfg = (K as unknown as Record<string, { minAmount?: number; maxAmount?: number }>)[a.id];
        return (
          <div key={a.id} className={`co-action ${a.danger ? 'danger' : ''}`}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>
                <b>{CORPORATE_LABEL[a.id]}</b> <span className="faint">{a.cost}</span>
              </div>
              <div className="faint" style={{ fontSize: 11 }}>
                {a.desc}
              </div>
            </div>
            {a.amount && (
              <input
                className="input num"
                style={{ width: 74, padding: '4px 6px' }}
                value={amount[a.id] ?? ''}
                onChange={(e) => setAmount({ ...amount, [a.id]: e.target.value.replace(/[^0-9]/g, '') })}
                title={`$${cfg.minAmount}–$${cfg.maxAmount}`}
              />
            )}
            <button
              className={`btn sm ${a.danger ? 'sell' : ''}`}
              disabled={waiting}
              onClick={() => {
                if (a.id === 'fraud' && !confirm('Cook the books? If the regulator finds out, your stock crashes and you get fined.')) return;
                if (a.id === 'issue' && !confirm('Issue new shares? You get cash, but your stock (and your stake) drops.')) return;
                act({ type: 'corporate', action: a.id, amount: a.amount ? Number(amount[a.id]) || 0 : undefined });
              }}
            >
              {waiting ? `${Math.ceil((cd - now) / 1000)}s` : 'Go'}
            </button>
          </div>
        );
      })}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
        Your stock is part of your net worth, so rivals will short it and smear it. Paying dividends makes shorting you expensive.
        {pub && (pub.dividendsPaid > 0 || pub.sharesIssued > 0) && ` So far: ${pub.dividendsPaid} dividend(s), ${pub.sharesIssued} share issue(s).`}
      </div>
    </div>
  );
}
