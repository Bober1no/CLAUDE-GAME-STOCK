/**
 * Tiny external store (no Redux). The socket layer writes, React reads via useStore().
 * Everything here is what the SERVER told us — the client never computes game outcomes.
 */
import { useSyncExternalStore } from 'react';
import type {
  AccountView,
  Candle,
  ChatMessage,
  GameRecap,
  GameStatic,
  LobbyState,
  NewsItem,
  Notice,
  PressurePayload,
  Quote,
  SessionInfo,
  PlayerView,
} from '@warmarket/shared';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface State {
  conn: ConnState;
  /** Set when a reconnect could not restore the game (server restarted). */
  fatal: string | null;
  session: SessionInfo | null;
  lobby: LobbyState | null;
  static: GameStatic | null;
  quotes: Record<string, Quote>;
  history: Record<string, Candle[]>;
  tick: number;
  nextTickAt: number;
  /** serverTime - localTime, ms. */
  clockOffset: number;
  pressure: PressurePayload | null;
  account: AccountView | null;
  view: PlayerView | null;
  news: NewsItem[];
  breaking: NewsItem | null;
  chat: ChatMessage[];
  notices: Notice[];
  /** Private tips & intel kept for the Intel tab. */
  tips: Notice[];
  recap: GameRecap | null;
  selectedAsset: string;
}

const initial: State = {
  conn: 'connecting',
  fatal: null,
  session: null,
  lobby: null,
  static: null,
  quotes: {},
  history: {},
  tick: 0,
  nextTickAt: 0,
  clockOffset: 0,
  pressure: null,
  account: null,
  view: null,
  news: [],
  breaking: null,
  chat: [],
  notices: [],
  tips: [],
  recap: null,
  selectedAsset: 'OIL',
};

let state: State = initial;
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

export function resetGameState(): void {
  setState({
    lobby: null,
    static: null,
    quotes: {},
    history: {},
    tick: 0,
    nextTickAt: 0,
    pressure: null,
    account: null,
    view: null,
    news: [],
    breaking: null,
    chat: [],
    notices: [],
    tips: [],
    recap: null,
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

export function serverNow(): number {
  return Date.now() + state.clockOffset;
}

export function pushNotice(n: Notice): void {
  setState((s) => ({ notices: [...s.notices.slice(-5), n], tips: n.kind === 'tip' ? [n, ...s.tips].slice(0, 20) : s.tips }));
  setTimeout(() => setState((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) })), n.kind === 'tip' ? 12_000 : 6_000);
}

let localNoticeId = 0;
export function localNotice(kind: Notice['kind'], text: string): void {
  pushNotice({ id: `local${++localNoticeId}`, t: Date.now(), kind, text });
}
