import { useState } from 'react';
import { CONFIG, RESOURCE_LABEL, fmtMoney, fmtPct, fmtPrice, type ResourceKind } from '@warmarket/shared';
import { act } from '../net/socket';
import { setState, useStore } from '../state/store';

const RES: ResourceKind[] = ['oil', 'food', 'metals', 'tech'];

export function NationPanel() {
  const st = useStore((s) => s.static);
  const view = useStore((s) => s.view);
  const quotes = useStore((s) => s.quotes);
  const [exp, setExp] = useState<ResourceKind>('oil');
  const [amt, setAmt] = useState('20');
  if (!st || !view) return null;
  const me = view.me;
  const myNation = st.nations.find((n) => n.id === me.id)!;
  const pub = view.nations.find((n) => n.id === me.id);
  const companies = st.assets.filter((a) => a.nationId === me.id);
  const expAsset = st.assets.find((a) => a.id === CONFIG.world.exportCommodity[exp]);
  const expQuote = expAsset && quotes[expAsset.id];
  const unit = expAsset && expQuote ? CONFIG.world.resourceValue[exp] * (expQuote.price / expAsset.basePrice) : 0;

  return (
    <div className="panel-b" style={{ padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="swatch" style={{ background: myNation.color, width: 12, height: 12 }} />
        <b style={{ fontSize: 14 }}>{myNation.name}</b>
        <span style={{ flex: 1 }} />
        {me.role !== 'none' && <span className="tag host">{me.role}</span>}
      </div>
      <div className="label">Stability {me.protesting && <span className="down">· PROTESTS (production ×{CONFIG.stability.protestProductionMult})</span>}</div>
      <div className="stab">
        <div style={{ width: `${me.stability}%`, background: me.stability < CONFIG.stability.protestThreshold ? 'var(--red)' : me.stability < 55 ? 'var(--amber)' : 'var(--green)' }} />
        <span style={{ left: `${CONFIG.stability.protestThreshold}%` }} />
      </div>
      <div className="faint" style={{ fontSize: 10.5, margin: '3px 0 10px' }}>
        War, sanctions, starvation and crashing company stocks drain it. At 0: coup.
      </div>

      <table className="grid" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th>Resource</th>
            <th className="r">Stock</th>
            <th className="r">/sec</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cash</td>
            <td className="r num">{fmtMoney(me.treasury)}</td>
            <td className={`r num ${me.rates.cash >= 0 ? 'up' : 'down'}`}>{me.rates.cash >= 0 ? '+' : ''}{me.rates.cash.toFixed(1)}</td>
          </tr>
          {RES.map((r) => (
            <tr key={r}>
              <td>{RESOURCE_LABEL[r]}</td>
              <td className={`r num ${r === 'food' && me.resources.food <= 0 ? 'down' : ''}`}>{me.resources[r].toFixed(0)}</td>
              <td className={`r num ${me.rates[r] >= 0 ? 'up' : 'down'}`}>
                {me.rates[r] >= 0 ? '+' : ''}
                {me.rates[r].toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="label">Export resources for cash</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px auto', gap: 6, marginBottom: 4 }}>
        <select className="input" value={exp} onChange={(e) => setExp(e.target.value as ResourceKind)}>
          {RES.map((r) => (
            <option key={r} value={r}>
              {RESOURCE_LABEL[r]} → {CONFIG.world.exportCommodity[r]}
            </option>
          ))}
        </select>
        <input className="input num" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9]/g, ''))} />
        <button className="btn" disabled={pub?.embargoed} onClick={() => act({ type: 'export', resource: exp, amount: Number(amt) || 0 })}>
          Sell
        </button>
      </div>
      <div className="faint" style={{ fontSize: 10.5, marginBottom: 12 }}>
        ≈ {fmtMoney(unit, 2)}/unit, tracks {CONFIG.world.exportCommodity[exp]}. Dumping pushes that commodity down.
        {pub?.embargoed && <span className="down"> You are under EMBARGO.</span>}
      </div>

      <div className="label">Your listed companies</div>
      <table className="grid">
        <tbody>
          {companies.map((a) => {
            const q = quotes[a.id];
            return (
              <tr key={a.id} className="click" onClick={() => setState({ selectedAsset: a.id })}>
                <td className="mono" style={{ color: myNation.color }}>{a.id}</td>
                <td className="dim" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</td>
                <td className="r num">{q ? fmtPrice(q.price) : ''}</td>
                <td className={`r num ${q && q.changeTotal >= 0 ? 'up' : 'down'}`}>{q ? fmtPct(q.changeTotal, 0) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        Your stocks follow your stability, territory and output. Anyone can buy — or short — them.
      </div>
    </div>
  );
}
