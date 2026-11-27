import { fmtPct, fmtPrice, type AssetInfo } from '@warmarket/shared';
import { setState, useStore } from '../state/store';

export function PressureBar({ v }: { v: number }) {
  const w = Math.min(50, Math.abs(v) * 50);
  return (
    <span className="pbar" title={`Order pressure ${v > 0 ? 'BUY' : v < 0 ? 'SELL' : 'flat'} (fuzzy, delayed)`}>
      <div style={v >= 0 ? { left: '50%', width: `${w}%`, background: 'var(--green)' } : { right: '50%', width: `${w}%`, background: 'var(--red)' }} />
    </span>
  );
}

export function Watchlist() {
  const st = useStore((s) => s.static);
  const quotes = useStore((s) => s.quotes);
  const pressure = useStore((s) => s.pressure);
  const selected = useStore((s) => s.selectedAsset);
  const account = useStore((s) => s.account);
  if (!st) return null;

  const held = new Set(account?.positions.map((p) => p.assetId) ?? []);
  const groups: { title: string; assets: AssetInfo[] }[] = [
    { title: 'Player companies', assets: st.assets.filter((a) => a.kind === 'company' && a.ownerId) },
    { title: 'Commodities', assets: st.assets.filter((a) => a.kind === 'commodity') },
    { title: 'Market companies', assets: st.assets.filter((a) => a.kind === 'company' && !a.ownerId) },
    { title: 'Crypto (lol)', assets: st.assets.filter((a) => a.kind === 'memecoin') },
  ].filter((g) => g.assets.length);
  const colorOf = (a: AssetInfo) => (a.ownerId ? st.players.find((p) => p.id === a.ownerId)?.color : undefined);

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-h">
        Exchange<span className="sp" />
        <span className="faint" style={{ letterSpacing: 0 }}>
          {pressure?.exact ? 'LIVE BOOK' : 'pressure ~4s delayed'}
        </span>
      </div>
      <div className="panel-b">
        <table className="grid">
          <tbody>
            {groups.map((g) => (
              <Group key={g.title} title={g.title}>
                {g.assets.map((a) => {
                  const q = quotes[a.id];
                  const nationColor = colorOf(a);
                  return (
                    <tr key={a.id} className={`click wl-row ${selected === a.id ? 'sel' : ''}`} onClick={() => setState({ selectedAsset: a.id })}>
                      <td>
                        <div className="wl-sym" style={nationColor ? { color: nationColor } : undefined}>
                          {a.id}
                          {held.has(a.id) && <span className="amber"> •</span>}
                          {q?.halted && <span className="halt">HALT</span>}
                        </div>
                        <div className="wl-name">{a.name}</div>
                      </td>
                      <td className="r">
                        <div className="num">{q ? fmtPrice(q.price) : '-'}</div>
                        <div className={`num ${q && q.change >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                          {q ? fmtPct(q.change) : ''}
                        </div>
                      </td>
                      <td className="r" style={{ paddingLeft: 0 }}>
                        <PressureBar v={pressure?.bars[a.id] ?? 0} />
                      </td>
                    </tr>
                  );
                })}
              </Group>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="wl-group">
        <td colSpan={3}>{title}</td>
      </tr>
      {children}
    </>
  );
}
