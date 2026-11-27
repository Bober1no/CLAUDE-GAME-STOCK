import { useEffect, useState } from 'react';
import { CONFIG, fmtMoney, fmtPrice, type OrderSide, type OrderType } from '@warmarket/shared';
import { act } from '../net/socket';
import { localNotice, useStore } from '../state/store';

const SIDES: { id: OrderSide; label: string; cls: string; hint: string }[] = [
  { id: 'buy', label: 'Buy', cls: 'buy', hint: 'Open/add to a long position' },
  { id: 'sell', label: 'Sell', cls: 'sell', hint: 'Close (part of) a long position' },
  { id: 'short', label: 'Short', cls: 'sell', hint: 'Bet on the price falling' },
  { id: 'cover', label: 'Cover', cls: 'buy', hint: 'Close (part of) a short position' },
];

export function OrderTicket() {
  const assetId = useStore((s) => s.selectedAsset);
  const quote = useStore((s) => s.quotes[s.selectedAsset]);
  const account = useStore((s) => s.account);
  const [side, setSide] = useState<OrderSide>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [qty, setQty] = useState('');
  const [limit, setLimit] = useState('');
  const [lev, setLev] = useState(1);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const pos = account?.positions.find((p) => p.assetId === assetId);
  const held = pos?.qty ?? 0;

  // Pick a sensible default side when switching assets.
  useEffect(() => {
    setSide(held > 0 ? 'sell' : held < 0 ? 'cover' : 'buy');
    setQty('');
    setLimit('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  if (!quote || !account) return null;
  const price = quote.price;
  const free = account.cash - account.reserved;
  const opening = side === 'buy' || side === 'short';
  const L = opening && advanced ? lev : 1;
  const maxQty = opening ? Math.max(0, Math.floor((free * L) / (price * (1 + CONFIG.market.reserveBuffer)))) : Math.abs(held);
  const n = Math.floor(Number(qty) || 0);
  const notional = n * price;
  const estSlip = Math.min(CONFIG.market.maxSlippage, (CONFIG.market.slippageK * notional) / 20_000);

  async function submit() {
    if (n <= 0) return localNotice('warn', 'Enter a quantity');
    setBusy(true);
    const r = await act({
      type: 'order',
      assetId,
      side,
      orderType: advanced ? type : 'market',
      qty: n,
      limitPrice: advanced && type === 'limit' ? Number(limit) : undefined,
      leverage: L,
    });
    setBusy(false);
    if (r.ok) {
      localNotice('info', `Queued: ${side.toUpperCase()} ${n} ${assetId} — fills at the next clear`);
      setQty('');
    }
  }

  return (
    <div className="panel">
      <div className="panel-h">
        Order ticket · {assetId}
        <span className="sp" />
        <span className="faint" style={{ letterSpacing: 0 }}>
          held: <span className={held > 0 ? 'up' : held < 0 ? 'down' : ''}>{held}</span>
        </span>
        <button className={`btn sm ${advanced ? 'primary' : 'ghost'}`} style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => setAdvanced(!advanced)} title="Limit orders and leverage">
          Advanced
        </button>
      </div>
      <div className="ticket">
        <div className="side-row">
          {SIDES.map((s) => (
            <button key={s.id} title={s.hint} className={`btn sm ${s.cls} ${side === s.id ? 'on' : ''}`} onClick={() => setSide(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div>
          <input className="input num qty-big" inputMode="numeric" value={qty} placeholder="Quantity" onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <div className="qty-quick">
            {[0.1, 0.25, 0.5, 1].map((f) => (
              <button key={f} className="btn sm ghost" onClick={() => setQty(String(Math.floor(maxQty * f)))}>
                {f === 1 ? 'MAX' : `${f * 100}%`}
              </button>
            ))}
          </div>
        </div>
        {advanced && (
          <div className="ticket-row">
            <div>
              <label className="label">Type</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
              {type === 'limit' && (
                <input className="input num" style={{ marginTop: 4 }} value={limit} placeholder={`${side === 'buy' || side === 'cover' ? 'max' : 'min'} ${fmtPrice(price)}`} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ''))} />
              )}
            </div>
            {opening && (
              <div>
                <label className="label">Leverage</label>
                <div className="qty-quick" style={{ marginTop: 0 }}>
                  {CONFIG.market.leverageOptions.map((l) => (
                    <button key={l} className={`btn sm ${lev === l ? 'primary' : 'ghost'}`} onClick={() => setLev(l)} title={l > 1 ? 'Bigger position, margin call if it goes wrong' : 'No leverage'}>
                      {l}x
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="est">
          <span>
            {fmtMoney(opening && L > 1 ? notional / L : notional)}
            {opening && L > 1 ? ` margin (${L}x)` : ''}
            {estSlip >= 0.005 ? ` · ~${(estSlip * 100).toFixed(1)}% slippage` : ''}
          </span>
          <span>free {fmtMoney(free)}</span>
        </div>
        <button className={`btn submit ${side === 'buy' || side === 'cover' ? 'buy on' : 'sell on'}`} disabled={busy || n <= 0} onClick={submit}>
          {side.toUpperCase()} {n || ''} {assetId}
        </button>
      </div>
    </div>
  );
}
