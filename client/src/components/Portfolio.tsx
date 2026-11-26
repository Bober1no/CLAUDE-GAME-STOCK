import { useState } from 'react';
import { fmtMoney, fmtPrice } from '@warmarket/shared';
import { act } from '../net/socket';
import { setState, useStore } from '../state/store';

export function Portfolio() {
  const account = useStore((s) => s.account);
  const [tab, setTab] = useState<'pos' | 'orders' | 'fills'>('pos');
  if (!account) return null;
  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="tabs">
        <button className={`tab ${tab === 'pos' ? 'on' : ''}`} onClick={() => setTab('pos')}>
          Positions ({account.positions.length})
        </button>
        <button className={`tab ${tab === 'orders' ? 'on' : ''}`} onClick={() => setTab('orders')}>
          Queued ({account.orders.length})
        </button>
        <button className={`tab ${tab === 'fills' ? 'on' : ''}`} onClick={() => setTab('fills')}>
          Fills
        </button>
      </div>
      {account.marginCall && (
        <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '4px 9px', fontSize: 11.5, fontWeight: 600 }}>
          MARGIN WARNING — a leveraged position is close to liquidation
        </div>
      )}
      <div className="panel-b">
        {tab === 'pos' &&
          (account.positions.length ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="r">Qty</th>
                  <th className="r">Avg</th>
                  <th className="r">Value</th>
                  <th className="r">P&L</th>
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p) => (
                  <tr key={p.assetId} className="click" onClick={() => setState({ selectedAsset: p.assetId })}>
                    <td className="mono">
                      {p.assetId}
                      {(p.loan > 0 || p.marginRatio < 0.5) && (
                        <span className={`tag ${p.marginRatio < 0.12 ? 'red' : ''}`} style={{ marginLeft: 4 }} title="Margin ratio">
                          {(p.marginRatio * 100).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className={`r num ${p.qty > 0 ? 'up' : 'down'}`}>{p.qty}</td>
                    <td className="r num dim">{fmtPrice(p.avgPrice)}</td>
                    <td className="r num">{fmtMoney(p.value)}</td>
                    <td className={`r num ${p.pnl >= 0 ? 'up' : 'down'}`}>{fmtMoney(p.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No positions. Pick an asset and place an order.</div>
          ))}
        {tab === 'orders' &&
          (account.orders.length ? (
            <table className="grid">
              <tbody>
                {account.orders.map((o) => (
                  <tr key={o.id}>
                    <td className={o.side === 'buy' || o.side === 'cover' ? 'up' : 'down'} style={{ fontWeight: 600 }}>
                      {o.side.toUpperCase()}
                    </td>
                    <td className="mono">
                      {o.qty} {o.assetId}
                      {o.leverage > 1 && <span className="amber"> {o.leverage}x</span>}
                    </td>
                    <td className="dim">{o.type === 'limit' ? `@ ${fmtPrice(o.limitPrice!)}` : 'MKT'}</td>
                    <td className="r">
                      <button className="btn sm ghost" onClick={() => act({ type: 'cancelOrder', orderId: o.id })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Nothing queued for this clear.</div>
          ))}
        {tab === 'fills' &&
          (account.fills.length ? (
            <table className="grid">
              <tbody>
                {account.fills.map((f) => (
                  <tr key={f.id}>
                    <td className="faint mono">#{f.tick}</td>
                    <td className={f.side === 'buy' || f.side === 'cover' ? 'up' : 'down'}>{f.side.toUpperCase()}</td>
                    <td className="mono">
                      {f.qty} {f.assetId}
                    </td>
                    <td className="r num">{f.qty ? fmtPrice(f.price) : ''}</td>
                    <td className={`r num ${f.realisedPnl >= 0 ? 'up' : 'down'}`}>{f.realisedPnl ? fmtMoney(f.realisedPnl) : f.note ? <span className="faint">{f.note}</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No fills yet.</div>
          ))}
      </div>
    </div>
  );
}
