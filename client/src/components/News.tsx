import type { NewsItem } from '@warmarket/shared';
import { useStore } from '../state/store';

function Src({ s }: { s: NewsItem['source'] }) {
  const cls = s === 'Rumour Mill' ? 'src rumour' : s === 'Regulator' ? 'src reg' : 'src';
  return <span className={cls}>{s.toUpperCase()}</span>;
}

export function NewsTicker() {
  const news = useStore((s) => s.news);
  const items = news.slice(0, 12);
  const duration = Math.max(30, items.reduce((s, n) => s + n.headline.length, 0) * 0.16);
  return (
    <div className="ticker">
      <div className="ticker-label">LIVE</div>
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div className="ticker-track" style={{ animationDuration: `${duration}s` }} key={items[0]?.id}>
          {items.map((n) => (
            <span key={n.id}>
              <Src s={n.source} />
              <span className={n.tone === 'good' ? 'up' : n.tone === 'bad' ? 'down' : ''}>{n.headline}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NewsFeed() {
  const news = useStore((s) => s.news);
  return (
    <div className="panel-b">
      {news.length === 0 && <div className="empty">Quiet. For now.</div>}
      {news.map((n) => (
        <div key={n.id} style={{ padding: '6px 9px', borderBottom: '1px solid #141b23' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
            <Src s={n.source} />
            {n.breaking && <span className="halt">BREAKING</span>}
            <span className="faint mono" style={{ fontSize: 10, marginLeft: 'auto' }}>
              {new Date(n.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          <div className={n.tone === 'good' ? 'up' : n.tone === 'bad' ? 'down' : ''} style={{ fontSize: 12.5 }}>
            {n.headline}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BreakingPopup() {
  const b = useStore((s) => s.breaking);
  if (!b) return null;
  return (
    <div className="breaking">
      <div className="bh">
        BREAKING · <span style={{ fontWeight: 400 }}>{b.source}</span>
      </div>
      <div className="bt">{b.headline}</div>
    </div>
  );
}
