import { useEffect, useState } from 'react';
import { serverNow } from './state/store';

/** Re-render every `ms` and return the current server-synced time. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
