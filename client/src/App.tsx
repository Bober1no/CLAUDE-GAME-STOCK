import { useStore } from './state/store';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';
import { ConnBanner } from './components/ConnBanner';
import { Toasts } from './components/Toasts';

export function App() {
  const session = useStore((s) => s.session);
  const phase = useStore((s) => s.lobby?.phase);
  const hasStatic = useStore((s) => !!s.static);

  let screen;
  if (!session) screen = <Home />;
  else if (phase === 'lobby' || !hasStatic) screen = <Lobby />;
  else screen = <GameScreen />;

  return (
    <>
      <ConnBanner />
      {screen}
      <Toasts />
    </>
  );
}
