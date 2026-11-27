import type { Sector } from './config.js';

// =====================================================================================
// Lobby
// =====================================================================================

export type Role = 'none' | 'analyst' | 'whale' | 'journalist';
export type RoomPhase = 'lobby' | 'running' | 'ended';

export interface LobbySettings {
  sessionMinutes: number;
  rolesEnabled: boolean;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  color: string;
  companyName: string;
  sector: Sector;
}

export interface LobbyState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: LobbyPlayer[];
  settings: LobbySettings;
}

/** Sent to a client after create/join/rejoin; stored in localStorage for reconnects. */
export interface SessionInfo {
  code: string;
  playerId: string;
  token: string;
}

// =====================================================================================
// Market
// =====================================================================================

export type AssetKind = 'commodity' | 'company' | 'memecoin';

export interface AssetInfo {
  id: string;
  name: string;
  kind: AssetKind;
  sector?: Sector;
  /** Player who runs this company (null/undefined = computer-run). */
  ownerId?: string | null;
  basePrice: number;
}

export interface Candle {
  /** Unix seconds (synthetic: game start + tick × tick length). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  id: string;
  price: number;
  prevPrice: number;
  /** Change over the last tick. */
  change: number;
  /** Change since game start. */
  changeTotal: number;
  halted: boolean;
  volume: number;
}

export type OrderSide = 'buy' | 'sell' | 'short' | 'cover';
export type OrderType = 'market' | 'limit';

export interface OrderView {
  id: string;
  assetId: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  leverage: number;
  placedAt: number;
}

export interface PositionView {
  assetId: string;
  /** Signed: >0 long, <0 short. */
  qty: number;
  avgPrice: number;
  loan: number;
  collateral: number;
  /** Current equity of this position (what you would get closing it at market). */
  value: number;
  pnl: number;
  /** Equity / notional. Low = close to a margin call. */
  marginRatio: number;
}

export interface FillView {
  id: string;
  tick: number;
  assetId: string;
  side: OrderSide;
  qty: number;
  price: number;
  slippage: number;
  realisedPnl: number;
  note?: string;
}

export interface AccountView {
  cash: number;
  /** Cash held back for open buy/short orders. */
  reserved: number;
  positions: PositionView[];
  orders: OrderView[];
  fills: FillView[];
  netWorth: number;
  portfolioValue: number;
  marginCall: boolean;
}

export interface MarketTickPayload {
  tick: number;
  serverNow: number;
  nextTickAt: number;
  quotes: Quote[];
  /** The candle produced by this tick, per asset. */
  candles: Record<string, Candle>;
}

export interface MarketHistoryPayload {
  tick: number;
  nextTickAt: number;
  quotes: Quote[];
  history: Record<string, Candle[]>;
}

/** Fuzzy, delayed BUY/SELL pressure, -1 (all sell) .. +1 (all buy). */
export interface PressurePayload {
  bars: Record<string, number>;
  /** True if this player is seeing the real, undelayed book (analyst role). */
  exact: boolean;
}

// =====================================================================================
// Player view (per-player filtered)
// =====================================================================================

export type CorporateAction = 'rnd' | 'marketing' | 'dividend' | 'fraud';
export type InfluenceAction = 'story' | 'lobby' | 'spy';

export interface MyView {
  /** Your company's ticker. */
  companyId: string;
  /** Your company's fundamental health multiplier (1 = IPO). Only you see the true figure. */
  health: number;
  /** True while you have cooked books that haven't been discovered yet. */
  fraudActive: boolean;
  /** action → time it's available again */
  cooldowns: Partial<Record<CorporateAction | InfluenceAction, number>>;
  /** Rivals whose trading desk you're reading, and until when. */
  spying: { playerId: string; until: number }[];
  reputation: number;
  role: Role;
  journalistReadyAt: number;
  /** R&D investments still maturing. */
  pendingRnd: number;
}

export interface CompanyPublic {
  assetId: string;
  ownerId: string | null;
  name: string;
  sector: Sector;
  /** Public corporate history for this company (counts only — the details are in the news). */
  dividendsPaid: number;
}

export interface LeaderboardRow {
  playerId: string;
  name: string;
  color: string;
  netWorth: number;
  connected: boolean;
  reputation: number;
  companyId: string;
}

export interface PlayerView {
  serverNow: number;
  endsAt: number;
  leaderboard: LeaderboardRow[];
  me: MyView;
  companies: CompanyPublic[];
  /** Rivals' queued orders (only while you're spying on them). */
  spiedOrders: { playerId: string; orders: OrderView[] }[];
}

// =====================================================================================
// News / chat
// =====================================================================================

export type NewsSource = 'Global Wire' | 'Market Desk' | 'Rumour Mill' | 'Regulator' | 'Citizen Journal' | 'Press Release';

export interface NewsItem {
  id: string;
  t: number;
  source: NewsSource;
  headline: string;
  breaking: boolean;
  tone: 'good' | 'bad' | 'neutral';
  tickers?: string[];
}

export interface ChatMessage {
  id: string;
  t: number;
  fromId: string;
  fromName: string;
  /** null = global */
  toId: string | null;
  text: string;
}

export interface Notice {
  id: string;
  t: number;
  kind: 'info' | 'good' | 'bad' | 'tip' | 'warn';
  text: string;
}

// =====================================================================================
// Recap
// =====================================================================================

export interface RecapEntry {
  playerId: string;
  name: string;
  color: string;
  netWorth: number;
  companyId: string;
  companyChange: number;
  rank: number;
}

export interface GameRecap {
  winnerId: string | null;
  reason: string;
  standings: RecapEntry[];
  awards: { title: string; who: string; detail: string }[];
}

// =====================================================================================
// Static game payload (sent once on start / rejoin)
// =====================================================================================

export interface GameStatic {
  code: string;
  assets: AssetInfo[];
  players: { id: string; name: string; color: string; companyId: string }[];
  startedAt: number;
  endsAt: number;
  marketTickMs: number;
  settings: LobbySettings;
  playerId: string;
}

// =====================================================================================
// Client → server actions
// =====================================================================================

export type Action =
  | { type: 'order'; assetId: string; side: OrderSide; orderType: OrderType; qty: number; limitPrice?: number; leverage?: number }
  | { type: 'cancelOrder'; orderId: string }
  | { type: 'corporate'; action: CorporateAction; amount?: number }
  | { type: 'story'; assetId: string; positive: boolean }
  | { type: 'lobby'; assetId: string; up: boolean }
  | { type: 'spy'; targetId: string }
  | { type: 'chat'; text: string; toId: string | null }
  | { type: 'publish'; headline: string };

export interface Ack {
  ok: boolean;
  error?: string;
}

export interface ServerToClient {
  'lobby:state': (s: LobbyState) => void;
  session: (s: SessionInfo) => void;
  'game:static': (s: GameStatic) => void;
  'game:history': (h: MarketHistoryPayload) => void;
  'game:market': (m: MarketTickPayload) => void;
  'game:pressure': (p: PressurePayload) => void;
  'game:account': (a: AccountView) => void;
  'game:view': (v: PlayerView) => void;
  'game:ended': (r: GameRecap) => void;
  news: (n: NewsItem) => void;
  'news:backlog': (n: NewsItem[]) => void;
  chat: (c: ChatMessage) => void;
  'chat:backlog': (c: ChatMessage[]) => void;
  notice: (n: Notice) => void;
  kicked: (reason: string) => void;
}

export interface ClientToServer {
  'lobby:create': (p: { name: string }, ack: (r: Ack & { session?: SessionInfo }) => void) => void;
  'lobby:join': (p: { code: string; name: string }, ack: (r: Ack & { session?: SessionInfo }) => void) => void;
  'lobby:rejoin': (p: { code: string; token: string }, ack: (r: Ack & { session?: SessionInfo }) => void) => void;
  'lobby:settings': (p: Partial<LobbySettings>, ack: (r: Ack) => void) => void;
  'lobby:start': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'lobby:leave': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'lobby:rename': (p: { name: string }, ack: (r: Ack) => void) => void;
  'lobby:company': (p: { companyName?: string; sector?: Sector }, ack: (r: Ack) => void) => void;
  act: (a: Action, ack: (r: Ack) => void) => void;
}
