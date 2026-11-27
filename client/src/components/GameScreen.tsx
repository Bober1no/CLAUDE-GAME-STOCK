import { useEffect, useState } from 'react';
import { TopBar } from './TopBar';
import { Watchlist } from './Watchlist';
import { PriceChart } from './PriceChart';
import { OrderTicket } from './OrderTicket';
import { Portfolio } from './Portfolio';
import { Leaderboard } from './Leaderboard';
import { BreakingPopup, NewsFeed, NewsTicker } from './News';
import { Recap } from './Recap';
import { CompanyPanel } from './CompanyPanel';
import { InfluencePanel } from './InfluencePanel';
import { ChatPanel } from './ChatPanel';
import { useStore } from '../state/store';

type Side = 'company' | 'influence' | 'chat' | 'news';

export function GameScreen() {
  const [side, setSide] = useState<Side>('company');
  const chatCount = useStore((s) => s.chat.length);
  const [seenChat, setSeenChat] = useState(0);
  useEffect(() => {
    if (side === 'chat') setSeenChat(chatCount);
  }, [side, chatCount]);
  const unread = Math.max(0, chatCount - seenChat);

  return (
    <div className="game">
      <TopBar />
      <div className="main">
        <div className="col">
          <Watchlist />
        </div>
        <div className="col">
          <PriceChart />
          <div className="trade-row">
            <OrderTicket />
            <Portfolio />
          </div>
        </div>
        <div className="col">
          <Leaderboard />
          <div className="panel" style={{ flex: 1 }}>
            <div className="tabs">
              <button className={`tab ${side === 'company' ? 'on' : ''}`} onClick={() => setSide('company')}>
                Company
              </button>
              <button className={`tab ${side === 'influence' ? 'on' : ''}`} onClick={() => setSide('influence')}>
                Influence
              </button>
              <button className={`tab ${side === 'chat' ? 'on' : ''}`} onClick={() => setSide('chat')}>
                Chat{unread > 0 && side !== 'chat' && <span className="badge">{unread}</span>}
              </button>
              <button className={`tab ${side === 'news' ? 'on' : ''}`} onClick={() => setSide('news')}>
                News
              </button>
            </div>
            {side === 'company' && <CompanyPanel />}
            {side === 'influence' && <InfluencePanel />}
            {side === 'chat' && <ChatPanel />}
            {side === 'news' && <NewsFeed />}
          </div>
        </div>
      </div>
      <NewsTicker />
      <BreakingPopup />
      <Recap />
    </div>
  );
}
