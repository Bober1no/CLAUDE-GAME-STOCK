/**
 * Socket layer. Same-origin io() — in dev Vite proxies /socket.io, in production the
 * Node server serves this page. Handles reconnects: on every (re)connect, if we have a
 * stored session we ask the server to put us back in our seat.
 */
import { io, type Socket } from 'socket.io-client';
import type { Ack, Action, ClientToServer, LobbySettings, ServerToClient, SessionInfo } from '@warmarket/shared';
import { getState, localNotice, pushNotice, resetGameState, setState } from '../state/store';

const SESSION_KEY = 'warmarket.session';

export const socket: Socket<ServerToClient, ClientToServer> = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 800,
  reconnectionDelayMax: 5000,
  // Render free tier can take ~1 min to wake up; keep trying forever.
  reconnectionAttempts: Infinity,
  timeout: 20_000,
});

export function loadSession(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionInfo;
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

function saveSession(s: SessionInfo | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode etc. — reconnect just won't survive a reload */
  }
}

function tryRejoin(): void {
  const s = loadSession();
  if (!s) return;
  socket.emit('lobby:rejoin', { code: s.code, token: s.token }, (r) => {
    if (!r.ok) {
      saveSession(null);
      resetGameState();
      setState({ session: null, fatal: r.error ?? 'Could not rejoin' });
    }
  });
}

socket.on('connect', () => {
  setState({ conn: 'connected' });
  tryRejoin();
});
socket.on('disconnect', () => setState({ conn: 'reconnecting' }));
socket.io.on('reconnect_attempt', () => setState({ conn: 'reconnecting' }));
socket.on('connect_error', () => setState((s) => ({ conn: s.session ? 'reconnecting' : 'connecting' })));

socket.on('session', (s) => {
  saveSession(s);
  setState({ session: s, fatal: null });
});
socket.on('lobby:state', (lobby) => setState({ lobby }));
socket.on('game:static', (st) =>
  setState((s) => ({ static: st, selectedAsset: st.assets.some((a) => a.id === s.selectedAsset) ? s.selectedAsset : st.assets[0]?.id ?? 'OIL' })),
);
socket.on('game:history', (h) => {
  const quotes: Record<string, (typeof h.quotes)[number]> = {};
  for (const q of h.quotes) quotes[q.id] = q;
  setState({ history: h.history, quotes, tick: h.tick, nextTickAt: h.nextTickAt });
});
socket.on('game:market', (m) => {
  setState((s) => {
    const quotes = { ...s.quotes };
    for (const q of m.quotes) quotes[q.id] = q;
    const history = { ...s.history };
    for (const [id, c] of Object.entries(m.candles)) {
      const arr = (history[id] ?? []).slice(-199);
      arr.push(c);
      history[id] = arr;
    }
    return { quotes, history, tick: m.tick, nextTickAt: m.nextTickAt, clockOffset: m.serverNow - Date.now() };
  });
});
socket.on('game:pressure', (pressure) => setState({ pressure }));
socket.on('game:account', (account) => setState({ account }));
socket.on('game:view', (view) => setState({ view, clockOffset: view.serverNow - Date.now() }));
socket.on('game:ended', (recap) => setState({ recap }));
socket.on('news', (n) => {
  setState((s) => ({ news: [n, ...s.news].slice(0, 80), breaking: n.breaking ? n : s.breaking }));
  if (n.breaking) setTimeout(() => setState((s) => (s.breaking?.id === n.id ? { breaking: null } : {})), 6000);
});
socket.on('news:backlog', (news) => setState({ news }));
socket.on('chat', (c) => setState((s) => ({ chat: [...s.chat, c].slice(-150) })));
socket.on('chat:backlog', (chat) => setState({ chat }));
socket.on('notice', (n) => pushNotice(n));
socket.on('kicked', (reason) => {
  saveSession(null);
  resetGameState();
  setState({ session: null, fatal: reason });
});

// ------------------------------------------------------------------ commands

function withAck<T extends Ack>(fn: (cb: (r: T) => void) => void): Promise<T> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'Not connected' } as T);
    const t = setTimeout(() => resolve({ ok: false, error: 'Server did not respond' } as T), 8000);
    fn((r) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

export function createRoom(name: string) {
  return withAck<Ack & { session?: SessionInfo }>((cb) => socket.emit('lobby:create', { name }, cb));
}
export function joinRoom(code: string, name: string) {
  return withAck<Ack & { session?: SessionInfo }>((cb) => socket.emit('lobby:join', { code, name }, cb));
}
export function updateSettings(p: Partial<LobbySettings>) {
  return withAck<Ack>((cb) => socket.emit('lobby:settings', p, cb));
}
export function startGame() {
  return withAck<Ack>((cb) => socket.emit('lobby:start', {}, cb));
}
export async function renameMe(name: string) {
  const r = await withAck<Ack>((cb) => socket.emit('lobby:rename', { name }, cb));
  if (r.ok) {
    try {
      localStorage.setItem('warmarket.name', name.trim());
    } catch {
      /* ignore */
    }
  }
  return r;
}

export async function leaveRoom() {
  await withAck<Ack>((cb) => socket.emit('lobby:leave', {}, cb));
  saveSession(null);
  resetGameState();
  setState({ session: null });
}

/** Send an intent. Shows the server's error as a toast unless `quiet`. */
export async function act(a: Action, quiet = false): Promise<Ack> {
  const r = await withAck<Ack>((cb) => socket.emit('act', a, cb));
  if (!r.ok && !quiet) localNotice('warn', r.error ?? 'Rejected');
  return r;
}

export function hasStoredSession(): boolean {
  return !!loadSession() && !getState().session;
}
