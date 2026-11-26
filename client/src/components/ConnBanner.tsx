import { useStore } from '../state/store';

export function ConnBanner() {
  const conn = useStore((s) => s.conn);
  const session = useStore((s) => s.session);
  if (conn === 'connected') return null;
  if (conn === 'connecting' && !session)
    return (
      <div className="conn-banner">
        <span className="dot" />
        Connecting to server… (a sleeping free server can take up to a minute to wake)
      </div>
    );
  return (
    <div className="conn-banner">
      <span className="dot" />
      Reconnecting… your seat is held — you will rejoin automatically
    </div>
  );
}
