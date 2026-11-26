import { useState } from 'react';
import { TopBar } from './TopBar';
import { Watchlist } from './Watchlist';
import { PriceChart } from './PriceChart';
import { OrderTicket } from './OrderTicket';
import { Portfolio } from './Portfolio';
import { Leaderboard } from './Leaderboard';
import { BreakingPopup, NewsFeed, NewsTicker } from './News';
import { Recap } from './Recap';

export function GameScreen() {
  const [side, setSide] = useState<'news'>('news');
  return (
    <div className="game">
      <TopBar />
      <div className="main">
        <div className="col">
          <Watchlist />
        </div>
        <div className="col">
          <PriceChart />
          <OrderTicket />
        </div>
        <div className="col">
          <Leaderboard />
          <Portfolio />
          <div className="panel" style={{ flex: 1 }}>
            <div className="tabs">
              <button className={`tab ${side === 'news' ? 'on' : ''}`} onClick={() => setSide('news')}>
                News
              </button>
            </div>
            <NewsFeed />
          </div>
        </div>
      </div>
      <NewsTicker />
      <BreakingPopup />
      <Recap />
    </div>
  );
}
