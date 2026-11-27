/**
 * WARMARKET balance config.
 *
 * Every tunable number in the game lives here. The server imports this for logic,
 * the client imports it for display (costs, timers). Change a number, redeploy, done.
 */

export type CommodityId = 'OIL' | 'GOLD' | 'WHEAT' | 'LITHIUM';

/** Each sector is tied to one commodity: energy↔oil, tech↔lithium, food↔wheat, defence↔gold. */
export type Sector = 'energy' | 'tech' | 'food' | 'defence';
export const SECTORS: Sector[] = ['energy', 'tech', 'food', 'defence'];

export interface CommodityDef {
  id: CommodityId;
  name: string;
  basePrice: number;
  /** Market depth in currency. Bigger = harder to move, less slippage. */
  depth: number;
  /** Per-tick noise standard deviation (fraction, e.g. 0.01 = 1%). */
  volatility: number;
}

export interface NpcCompanyDef {
  id: string;
  name: string;
  sector: Sector;
  basePrice: number;
}

export const CONFIG = {
  // ---------------------------------------------------------------- lobby / session
  lobby: {
    codeLength: 5,
    /** No 0/O/1/I/L to avoid reading mistakes when someone shouts the code across the room. */
    codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    minPlayers: 1,
    maxPlayers: 8,
    maxNameLength: 16,
    maxCompanyNameLength: 24,
    sessionMinutesOptions: [10, 20, 30, 35, 45],
    defaultSessionMinutes: 35,
    /** Rooms with no connected players are deleted after this long. */
    emptyRoomTtlMs: 10 * 60_000,
    /** Finished games are kept around for the recap screen for this long. */
    finishedRoomTtlMs: 20 * 60_000,
  },

  // ---------------------------------------------------------------- clocks
  clocks: {
    worldTickMs: 100,
    marketTickMs: 20_000,
    /** How often per-player views are pushed (ms). */
    viewBroadcastMs: 500,
    /** How often fuzzy pressure bars are pushed (ms). */
    pressureBroadcastMs: 2_000,
    /** Pressure bars show the order book as it was this long ago. */
    pressureDelayMs: 4_000,
  },

  // ---------------------------------------------------------------- start
  start: {
    cash: 10_000,
    /** Founder shares each player holds in their own company at the opening bell. */
    founderShares: 150,
    /** IPO price of player companies. */
    ipoPrice: 40,
  },

  // ---------------------------------------------------------------- market
  market: {
    /** Max price move per tick, either direction. */
    priceCap: 0.15,
    /** Raw (pre-cap) drop beyond this halts the asset for the next tick. */
    circuitBreakerDrop: 0.2,
    /** Price impact of a fully one-sided book (imbalance = ±1). */
    pressureImpact: 0.22,
    /** Slippage = slippageK × (order notional / depth), capped at maxSlippage. */
    slippageK: 0.12,
    maxSlippage: 0.1,
    /** Fraction of the gap to fundamental value closed per tick (log space). */
    meanReversion: 0.12,
    /** Extra reserve held on buy/short orders to cover cap moves + slippage. */
    reserveBuffer: 0.27,
    minPrice: 0.01,
    maxOrderNotional: 1_000_000,
    maxOpenOrdersPerPlayer: 20,
    /** Each tick's candle gets fake intra-tick wicks of this size × volatility for readability. */
    wickFactor: 0.6,
    historyLength: 200,
    leverageOptions: [1, 2, 3, 5],
    maxLeverage: 5,
    /** Position equity / notional below which a position is force-closed. */
    maintenanceMargin: 0.07,
    /** Below this ratio the player gets a margin-call warning. */
    marginWarning: 0.12,
  },

  commodities: [
    { id: 'OIL', name: 'Crude Oil', basePrice: 80, depth: 30_000, volatility: 0.012 },
    { id: 'GOLD', name: 'Gold', basePrice: 1900, depth: 45_000, volatility: 0.006 },
    { id: 'WHEAT', name: 'Wheat', basePrice: 7, depth: 20_000, volatility: 0.01 },
    { id: 'LITHIUM', name: 'Lithium', basePrice: 24, depth: 18_000, volatility: 0.016 },
  ] as CommodityDef[],

  /** Computer-run listed companies, so there's always plenty to trade. */
  npcCompanies: [
    { id: 'HOTA', name: 'Hot Air Petroleum', sector: 'energy', basePrice: 62 },
    { id: 'VAPR', name: 'Quantum Vapourware', sector: 'tech', basePrice: 115 },
    { id: 'SNAK', name: 'Big Snack Foods', sector: 'food', basePrice: 45 },
  ] as NpcCompanyDef[],

  memecoin: {
    id: 'DOGE2',
    name: 'WarDoge Coin',
    basePrice: 1,
    depth: 6_000,
    volatility: 0.07,
    /** Chance per tick of a random pump. */
    pumpChance: 0.06,
    pumpSize: 0.35,
    /** Chance per tick of a rug pull (only once price is above rugThreshold × base). */
    rugChance: 0.08,
    rugThreshold: 2.5,
    rugSize: 0.6,
  },

  companies: {
    depth: 14_000,
    volatility: 0.012,
    /** Fundamental shifts from events/actions decay back toward 1 by this fraction per tick. */
    shiftDecay: 0.04,
  },

  /**
   * Sector links: when a driver commodity moves r% in a tick, companies in the linked sector
   * move coef × r% on the NEXT tick (lagged so tick clearing stays order-independent).
   */
  sectorLinks: [
    { driver: 'OIL', sector: 'energy', coef: 0.55 },
    { driver: 'LITHIUM', sector: 'tech', coef: 0.45 },
    { driver: 'WHEAT', sector: 'food', coef: 0.4 },
    { driver: 'GOLD', sector: 'defence', coef: 0.35 },
  ] as { driver: CommodityId; sector: Sector; coef: number }[],

  /** Commodities also correlate with each other (lagged, same rule). */
  commodityLinks: [
    { driver: 'OIL', target: 'GOLD', coef: 0.1 },
    { driver: 'OIL', target: 'WHEAT', coef: 0.1 },
  ] as { driver: CommodityId; target: CommodityId; coef: number }[],

  // ---------------------------------------------------------------- running your company
  corporate: {
    /** Invest in R&D: costs cash now, raises the company's fundamental value after a delay. */
    rnd: { cost: 1500, healthGain: 0.08, delayTicks: 2, cooldownSec: 40 },
    /** Marketing blitz: short-term hype, followed by a small hangover. */
    marketing: { cost: 800, hype: 0.07, ticks: 2, hangover: -0.03, cooldownSec: 30 },
    /** Dividend: pay cash to every holder (pro rata). Investors love it. */
    dividend: { minAmount: 300, maxAmount: 20_000, hype: 0.03, healthGain: 0.02, cooldownSec: 45 },
    /** Cook the books: a big fake pump. Each tick there's a chance the regulator finds out. */
    fraud: { hype: 0.16, ticks: 2, discoverChancePerTick: 0.12, crash: -0.32, fineFlat: 3000, reputationHit: 25, cooldownSec: 90 },
    minHealth: 0.2,
    maxHealth: 4,
  },

  // ---------------------------------------------------------------- influencing the market
  influence: {
    /** Plant a story (pump or smear) about any company or commodity. */
    story: { cost: 1000, impact: 0.08, successChance: 0.75, fine: 1500, reputationHit: 15, cooldownSec: 30 },
    /** Lobby the government to push a commodity up or down over a few ticks. */
    lobby: { cost: 2500, impact: 0.06, ticks: 3, cooldownSec: 45 },
    /** Spy on a rival's trading desk: see their queued orders. */
    spy: { cost: 1200, durationSec: 90, caughtChance: 0.25, reputationHit: 10, cooldownSec: 30 },
  },

  // ---------------------------------------------------------------- news + events
  events: {
    /** Probability per market tick of a world event at the start / end of the game. */
    chanceStart: 0.25,
    chanceEnd: 0.6,
    /** Magnitude multiplier at the start / end of the game. */
    intensityStart: 0.8,
    intensityEnd: 2.0,
    /** Rumour Mill headlines are false this often. */
    rumourFalseRate: 0.4,
    /** Chance an event is pre-announced by a rumour before it fires. */
    rumourLeadChance: 0.35,
    /** Chance an event triggers a private insider tip shortly before. */
    insiderTipChance: 0.45,
    insiderTipWrongRate: 0.25,
    insiderTipLeadMs: 25_000,
    newsHistory: 80,
  },

  chat: {
    maxLength: 240,
    history: 100,
    rateMs: 600,
  },

  regulator: {
    /** A buy then sell of the same asset within this many ticks counts as a round trip. */
    windowTicks: 3,
    /** Player's share of buy-side notional in the pump tick must exceed this. */
    minBuyShare: 0.5,
    /** Price must have risen this much between buy and sell. */
    minPriceRise: 0.12,
    minNotional: 3_000,
    investigateChance: 0.65,
    /** Fine = flat + fraction of the realised profit. */
    fineFlat: 500,
    fineProfitFraction: 0.6,
  },

  reputation: {
    start: 100,
    /** Low reputation makes every regulator check more likely to bite (up to ×this at 0). */
    maxSuspicionMult: 1.8,
  },

  roles: {
    whaleCashMultiplier: 2.5,
    /** Analysts see pressure bars with little noise and no delay. */
    analystNoise: 0.03,
    journalistHeadlineCooldownSec: 90,
  },

  net: {
    /** Token bucket: max messages per second per socket. */
    rateLimitPerSec: 25,
    rateLimitBurst: 40,
  },
};

export type GameConfig = typeof CONFIG;
