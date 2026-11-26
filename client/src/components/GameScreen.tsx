import { useEffect, useState } from 'react';
import { TopBar } from './TopBar';
import { Watchlist } from './Watchlist';
import { PriceChart } from './PriceChart';
import { OrderTicket } from './OrderTicket';
import { Portfolio } from './Portfolio';
import { Leaderboard } from './Leaderboard';
import { BreakingPopup, NewsFeed, NewsTicker } from './News';
import { Recap } from './Recap';
import { MapView } from './MapView';
import { ProvincePanel } from './ProvincePanel';
import { NationPanel } from './NationPanel';
import { DiplomacyPanel } from './DiplomacyPanel';
import { IntelPanel } from './IntelPanel';
import { getState, setState, useStore } from '../state/store';

type Center = 'world' | 'market';
type Side = 'nation' | 'news' | 'diplo' | 'intel';

export function GameScreen() {
  const [center, setCenter] = useState<Center>('world');
  const [side, setSide] = useState<Side>('nation');
  const selectedAsset = useStore((s) => s.selectedAsset);
  const chatCount = useStore((s) => s.chat.length);
  const proposals = useStore((s) => (s.view ? s.view.proposals.filter((p) => p.to === s.view!.me.id).length + s.view.deals.filter((d) => d.status === 'proposed' && d.to === s.view!.me.id).length : 0));
  const [seenChat, setSeenChat] = useState(0);

  // Picking an asset in the watchlist jumps to the market view.
  const [lastAsset, setLastAsset] = useState(selectedAsset);
  useEffect(() => {
    if (selectedAsset !== lastAsset) {
      setLastAsset(selectedAsset);
      setCenter('market');
    }
  }, [selectedAsset, lastAsset]);

  useEffect(() => {
    if (side === 'diplo') setSeenChat(chatCount);
  }, [side, chatCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'w' || e.key === 'W') setCenter('world');
      if (e.key === 'm' || e.key === 'M') setCenter('market');
      if (e.key === 'Escape') setState({ selectedArmy: null });
      if (e.key === 'Tab') {
        e.preventDefault();
        setCenter((c) => (c === 'world' ? 'market' : 'world'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unread = Math.max(0, chatCount - seenChat) + proposals;

  return (
    <div className="game">
      <TopBar />
      <div className="main">
        <div className="col">
          <Watchlist />
        </div>
        <div className="col">
          <div className="panel" style={{ flex: 1 }}>
            <div className="tabs">
              <button className={`tab ${center === 'world' ? 'on' : ''}`} onClick={() => setCenter('world')}>
                World map <span className="faint">[W]</span>
              </button>
              <button className={`tab ${center === 'market' ? 'on' : ''}`} onClick={() => setCenter('market')}>
                Market · {selectedAsset} <span className="faint">[M]</span>
              </button>
              <span style={{ flex: 1 }} />
              {center === 'world' && (
                <button className="tab" onClick={() => setState({ selectedProvince: getState().view?.me ? getState().static?.nations.find((n) => n.id === getState().view!.me.id)?.capital ?? null : null })}>
                  ★ capital
                </button>
              )}
            </div>
            {center === 'world' ? (
              <div className="world-wrap">
                <div className="map-box">
                  <MapView />
                </div>
                <ProvincePanel />
              </div>
            ) : (
              <div className="market-wrap">
                <PriceChart />
                <OrderTicket />
              </div>
            )}
          </div>
        </div>
        <div className="col">
          <Leaderboard />
          <Portfolio />
          <div className="panel" style={{ flex: 1.3 }}>
            <div className="tabs">
              <button className={`tab ${side === 'nation' ? 'on' : ''}`} onClick={() => setSide('nation')}>
                Nation
              </button>
              <button className={`tab ${side === 'diplo' ? 'on' : ''}`} onClick={() => setSide('diplo')}>
                Diplomacy{unread > 0 && side !== 'diplo' && <span className="badge">{unread}</span>}
              </button>
              <button className={`tab ${side === 'intel' ? 'on' : ''}`} onClick={() => setSide('intel')}>
                Intel
              </button>
              <button className={`tab ${side === 'news' ? 'on' : ''}`} onClick={() => setSide('news')}>
                News
              </button>
            </div>
            {side === 'nation' && <NationPanel />}
            {side === 'news' && <NewsFeed />}
            {side === 'diplo' && <DiplomacyPanel />}
            {side === 'intel' && <IntelPanel />}
          </div>
        </div>
      </div>
      <NewsTicker />
      <BreakingPopup />
      <Recap />
    </div>
  );
}
