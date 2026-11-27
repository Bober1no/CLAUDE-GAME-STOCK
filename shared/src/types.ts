import type { BuildingKind, CommodityId, ResourceKind, Sector, Terrain } from './config.js';

// =====================================================================================
// Lobby
// =====================================================================================

export type GameMode = 'networth' | 'domination' | 'hegemony' | 'lastStanding';
export type Role = 'none' | 'analyst' | 'whale' | 'journalist';
export type RoomPhase = 'lobby' | 'running' | 'ended';

export interface LobbySettings {
  sessionMinutes: number;
  mode: GameMode;
  rolesEnabled: boolean;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  color: string;
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
// Map / world (static per game)
// =====================================================================================

export interface ProvinceStatic {
  id: number;
  name: string;
  /** SVG path data for the province polygon. */
  path: string;
  cx: number;
  cy: number;
  terrain: Terrain;
  neighbors: number[];
  /** Commodity specialty (affects global supply of that commodity). */
  specialty: CommodityId;
  coastal: boolean;
}

export interface MapStatic {
  width: number;
  height: number;
  provinces: ProvinceStatic[];
  /** Pairs of province ids connected by sea lanes (drawn dashed). */
  seaLanes: [number, number][];
  /** Decorative ocean cells (SVG paths). */
  oceanPaths: string[];
}

export interface NationStatic {
  id: string;
  playerId: string;
  name: string;
  color: string;
  capital: number;
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
  nationId?: string;
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
  /** Borrowed cash on leveraged longs. */
  loan: number;
  /** Cash locked as collateral on shorts. */
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
  /** True if this player is seeing the real, undelayed book (spy / analyst). */
  exact: boolean;
}

// =====================================================================================
// Nations / world view (per-player filtered)
// =====================================================================================

export type Resources = Record<ResourceKind, number>;

export interface ConstructionView {
  kind: BuildingKind;
  doneAt: number;
}

export interface ProvinceView {
  id: number;
  ownerId: string | null;
  /** False = fogged: only ownership is known. */
  visible: boolean;
  garrison?: number;
  buildings?: BuildingKind[];
  construction?: ConstructionView | null;
  /** Active world event effect on this province (drought etc.). */
  effect?: string | null;
}

export interface ArmyMoveView {
  from: number;
  to: number;
  departAt: number;
  arriveAt: number;
}

export interface ArmyView {
  id: string;
  ownerId: string;
  provinceId: number;
  strength: number;
  move: ArmyMoveView | null;
}

export interface RecruitView {
  provinceId: number;
  doneAt: number;
}

export interface SpyView {
  id: string;
  /** idle | training | on mission */
  status: 'training' | 'idle' | 'mission';
  readyAt: number;
  mission?: SpyMission;
  targetId?: string;
}

export type SpyMission = 'vision' | 'orderflow' | 'stealTech' | 'fakeNews';

export interface NationPrivateView {
  id: string;
  treasury: number;
  resources: Resources;
  /** Net per-second rates (after upkeep). */
  rates: Resources & { cash: number };
  stability: number;
  protesting: boolean;
  recruiting: RecruitView[];
  spies: SpyView[];
  /** Nations whose provinces you currently see via spies. */
  spyVisionOn: string[];
  /** Nations whose order flow you currently see via spies. */
  orderflowOn: string[];
  warCooldownUntil: number;
  role: Role;
  journalistReadyAt: number;
}

export interface NationPublicView {
  id: string;
  playerId: string;
  name: string;
  color: string;
  provinces: number;
  stability: number;
  reputation: number;
  connected: boolean;
  eliminated: boolean;
  atWarWith: string[];
  allies: string[];
  sanctionedBy: string[];
  embargoed: boolean;
}

export interface WarView {
  a: string;
  b: string;
  since: number;
  /** When the aggressor may start entering target land. */
  mobilisedAt: number;
  casualties: number;
}

export interface DealTerms {
  /** Per-minute flows from proposer to target (positive) — the target gives `receive`. */
  give: Partial<Resources & { cash: number }>;
  receive: Partial<Resources & { cash: number }>;
  durationSec: number;
}

export interface DealView {
  id: string;
  from: string;
  to: string;
  terms: DealTerms;
  status: 'proposed' | 'active' | 'broken' | 'done' | 'rejected' | 'expired';
  startedAt?: number;
  endsAt?: number;
  createdAt: number;
}

export interface ProposalView {
  id: string;
  kind: 'alliance' | 'peace';
  from: string;
  to: string;
  createdAt: number;
}

export interface LeaderboardRow {
  playerId: string;
  name: string;
  color: string;
  netWorth: number;
  connected: boolean;
}

export interface WorldView {
  serverNow: number;
  leaderboard: LeaderboardRow[];
  endsAt: number;
  provinces: ProvinceView[];
  armies: ArmyView[];
  me: NationPrivateView;
  nations: NationPublicView[];
  wars: WarView[];
  deals: DealView[];
  proposals: ProposalView[];
  /** Mode-specific progress line, e.g. domination share. */
  objective: string;
  /** Visible orders of rivals (only via orderflow spies). */
  spiedOrders: { nationId: string; orders: OrderView[] }[];
}

// =====================================================================================
// News / chat
// =====================================================================================

export type NewsSource = 'Global Wire' | 'Market Desk' | 'War Correspondent' | 'Rumour Mill' | 'Regulator' | 'Citizen Journal';

export interface NewsItem {
  id: string;
  t: number;
  source: NewsSource;
  headline: string;
  breaking: boolean;
  /** Tone helps the ticker colour the item. */
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
  provinces: number;
  rank: number;
}

export interface GameRecap {
  mode: GameMode;
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
  map: MapStatic;
  nations: NationStatic[];
  assets: AssetInfo[];
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
  | { type: 'build'; provinceId: number; kind: BuildingKind }
  | { type: 'export'; resource: ResourceKind; amount: number }
  | { type: 'recruit'; provinceId: number }
  | { type: 'move'; armyId: string; to: number }
  | { type: 'declareWar'; targetId: string }
  | { type: 'proposePeace'; targetId: string }
  | { type: 'respondProposal'; proposalId: string; accept: boolean }
  | { type: 'chat'; text: string; toId: string | null }
  | { type: 'proposeDeal'; targetId: string; terms: DealTerms }
  | { type: 'respondDeal'; dealId: string; accept: boolean }
  | { type: 'breakDeal'; dealId: string }
  | { type: 'proposeAlliance'; targetId: string }
  | { type: 'breakAlliance'; targetId: string }
  | { type: 'sanction'; targetId: string; on: boolean }
  | { type: 'trainSpy' }
  | { type: 'spyMission'; spyId: string; targetId: string; mission: SpyMission; assetId?: string }
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
  'game:view': (v: WorldView) => void;
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
  act: (a: Action, ack: (r: Ack) => void) => void;
}
