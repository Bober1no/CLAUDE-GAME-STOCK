/**
 * WARMARKET balance config.
 *
 * Every tunable number in the game lives here. The server imports this for logic,
 * the client imports it for display (costs, timers). Change a number, restart, done.
 */

export type CommodityId =
  | 'OIL'
  | 'GOLD'
  | 'WHEAT'
  | 'COFFEE'
  | 'LITHIUM'
  | 'LUMBER'
  | 'RICE'
  | 'ELEC';

export type Sector = 'energy' | 'defence' | 'tech' | 'shipping' | 'food' | 'pharma';
export type ResourceKind = 'oil' | 'food' | 'metals' | 'tech';
export type Terrain = 'plains' | 'forest' | 'mountain' | 'desert' | 'coast' | 'urban';
export type BuildingKind = 'farm' | 'mine' | 'well' | 'lab' | 'fort' | 'port';

export interface CommodityDef {
  id: CommodityId;
  name: string;
  basePrice: number;
  /** Market depth in currency. Bigger = harder to move, less slippage. */
  depth: number;
  /** Per-tick noise standard deviation (fraction, e.g. 0.01 = 1%). */
  volatility: number;
  /** Which nation resource drives this commodity's global supply. */
  supplyResource: ResourceKind;
  /** Elasticity of fundamental price to supply shortfall. */
  supplyElasticity: number;
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
    /** How often per-player world views are pushed (ms). */
    viewBroadcastMs: 250,
    /** How often fuzzy pressure bars are pushed (ms). */
    pressureBroadcastMs: 2_000,
    /** Pressure bars show the order book as it was this long ago. */
    pressureDelayMs: 4_000,
  },

  // ---------------------------------------------------------------- economy start
  start: {
    treasury: 10_000,
    resources: { oil: 60, food: 120, metals: 60, tech: 30 } as Record<ResourceKind, number>,
    stability: 70,
    provincesPerNation: 4,
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
    /** Leverage options. 1 = none. Phase 4 unlocks > 1. */
    leverageOptions: [1, 2, 3, 5],
    maxLeverage: 5,
    /** Position equity / notional below which a position is force-closed. */
    maintenanceMargin: 0.07,
    /** Below this ratio the player gets a margin-call warning. */
    marginWarning: 0.12,
    /** Limit orders that do not fill on their tick are cancelled. */
    limitOrderTicks: 1,
  },

  commodities: [
    { id: 'OIL', name: 'Crude Oil', basePrice: 80, depth: 30_000, volatility: 0.012, supplyResource: 'oil', supplyElasticity: 0.8 },
    { id: 'GOLD', name: 'Gold', basePrice: 1900, depth: 45_000, volatility: 0.006, supplyResource: 'metals', supplyElasticity: 0.2 },
    { id: 'WHEAT', name: 'Wheat', basePrice: 7, depth: 20_000, volatility: 0.01, supplyResource: 'food', supplyElasticity: 0.7 },
    { id: 'COFFEE', name: 'Coffee', basePrice: 2.4, depth: 15_000, volatility: 0.014, supplyResource: 'food', supplyElasticity: 0.5 },
    { id: 'LITHIUM', name: 'Lithium', basePrice: 24, depth: 18_000, volatility: 0.016, supplyResource: 'metals', supplyElasticity: 0.9 },
    { id: 'LUMBER', name: 'Lumber', basePrice: 520, depth: 16_000, volatility: 0.012, supplyResource: 'metals', supplyElasticity: 0.4 },
    { id: 'RICE', name: 'Rice', basePrice: 17, depth: 18_000, volatility: 0.009, supplyResource: 'food', supplyElasticity: 0.6 },
    { id: 'ELEC', name: 'Electronics', basePrice: 140, depth: 25_000, volatility: 0.011, supplyResource: 'tech', supplyElasticity: 0.6 },
  ] as CommodityDef[],

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
    perNation: 3,
    basePriceMin: 20,
    basePriceMax: 120,
    depth: 14_000,
    volatility: 0.012,
    /** Weights of the company fundamental model. */
    stabilityWeight: 0.6,
    territoryWeight: 0.5,
    productionWeight: 0.35,
  },

  /**
   * Sector links: when a driver asset moves r% in a tick, assets in the linked sector
   * move coef × r% on the NEXT tick (lagged so tick clearing stays order-independent).
   */
  sectorLinks: [
    { driver: 'OIL', sector: 'energy', coef: 0.55 },
    { driver: 'OIL', sector: 'shipping', coef: -0.4 },
    { driver: 'LITHIUM', sector: 'tech', coef: 0.35 },
    { driver: 'ELEC', sector: 'tech', coef: 0.3 },
    { driver: 'WHEAT', sector: 'food', coef: 0.3 },
    { driver: 'RICE', sector: 'food', coef: 0.25 },
    { driver: 'COFFEE', sector: 'food', coef: 0.15 },
    { driver: 'GOLD', sector: 'defence', coef: 0.1 },
    { driver: 'LUMBER', sector: 'shipping', coef: 0.1 },
  ] as { driver: CommodityId; sector: Sector; coef: number }[],

  /** Commodities also correlate with each other (lagged, same rule). */
  commodityLinks: [
    { driver: 'OIL', target: 'GOLD', coef: 0.1 },
    { driver: 'LITHIUM', target: 'ELEC', coef: 0.3 },
    { driver: 'WHEAT', target: 'RICE', coef: 0.3 },
  ] as { driver: CommodityId; target: CommodityId; coef: number }[],

  // ---------------------------------------------------------------- world / nations
  world: {
    mapWidth: 1000,
    mapHeight: 620,
    totalCells: 70,
    landProvinces: 38,
    /** Per-second base production of a province by terrain. */
    terrainYield: {
      plains: { oil: 0, food: 0.6, metals: 0.1, tech: 0.05 },
      forest: { oil: 0, food: 0.3, metals: 0.35, tech: 0.05 },
      mountain: { oil: 0.05, food: 0.1, metals: 0.6, tech: 0.05 },
      desert: { oil: 0.6, food: 0.05, metals: 0.15, tech: 0.05 },
      coast: { oil: 0.15, food: 0.4, metals: 0.1, tech: 0.15 },
      urban: { oil: 0, food: 0.15, metals: 0.1, tech: 0.5 },
    } as Record<Terrain, Record<ResourceKind, number>>,
    /** Cash income per province per second. */
    taxPerProvince: 4,
    capitalTaxBonus: 6,
    /** Value of a province for net worth. */
    provinceValue: 900,
    capitalValue: 2500,
    buildingValueFactor: 0.6,
    /** Resources are valued at this many cash each for net worth. */
    resourceValue: { oil: 6, food: 3, metals: 5, tech: 10 } as Record<ResourceKind, number>,
    /** Export: sell nation resources for cash at the linked commodity price × this. */
    exportPriceFactor: 0.08,
    exportCommodity: { oil: 'OIL', food: 'WHEAT', metals: 'LITHIUM', tech: 'ELEC' } as Record<ResourceKind, CommodityId>,
    /** Food eaten per province per second (population). */
    foodUpkeepPerProvince: 0.18,
    resourceCap: 2_000,
  },

  terrainDefence: {
    plains: 1.0,
    forest: 1.25,
    mountain: 1.6,
    desert: 1.1,
    coast: 1.05,
    urban: 1.35,
  } as Record<Terrain, number>,

  /** Travel time multiplier entering a province of this terrain. */
  terrainTravel: {
    plains: 1.0,
    forest: 1.3,
    mountain: 1.8,
    desert: 1.4,
    coast: 1.1,
    urban: 1.0,
  } as Record<Terrain, number>,

  buildings: {
    farm: { cost: 900, resources: { metals: 10 }, buildSec: 25, yield: { food: 0.6 }, defence: 0 },
    mine: { cost: 1100, resources: { oil: 10 }, buildSec: 30, yield: { metals: 0.5 }, defence: 0 },
    well: { cost: 1300, resources: { metals: 20 }, buildSec: 30, yield: { oil: 0.5 }, defence: 0 },
    lab: { cost: 1800, resources: { metals: 20, oil: 10 }, buildSec: 40, yield: { tech: 0.35 }, defence: 0 },
    fort: { cost: 1500, resources: { metals: 40 }, buildSec: 35, yield: {}, defence: 0.5 },
    port: { cost: 1400, resources: { metals: 25 }, buildSec: 30, yield: {}, defence: 0, tax: 5 },
  } as Record<
    BuildingKind,
    {
      cost: number;
      resources: Partial<Record<ResourceKind, number>>;
      buildSec: number;
      yield: Partial<Record<ResourceKind, number>>;
      defence: number;
      tax?: number;
    }
  >,
  maxBuildingsPerProvince: 2,

  stability: {
    max: 100,
    /** Drifts toward this baseline when nothing bad is happening. */
    baseline: 70,
    regenPerSec: 0.08,
    warPerSec: 0.05,
    sanctionPerSec: 0.04,
    starvationPerSec: 0.4,
    /** Applied once when you declare war. */
    declareWarHit: 10,
    provinceLostHit: 6,
    provinceWonBoost: 3,
    /** Company crash: if avg company price < this × listing price, lose stability. */
    crashThreshold: 0.6,
    crashPerSec: 0.08,
    protestThreshold: 30,
    protestProductionMult: 0.6,
    /** At 0: coup. The nation splits; these fractions of provinces revolt to neutral. */
    coupSplitFraction: 0.4,
    coupTreasuryLoss: 0.3,
    coupResetStability: 40,
  },

  // ---------------------------------------------------------------- military
  military: {
    /** Strength of one recruited army. */
    armyStrength: 10,
    armyCost: 600,
    armyResources: { metals: 12, oil: 6, food: 10 } as Partial<Record<ResourceKind, number>>,
    armyBuildSec: 20,
    maxArmiesPerPlayer: 30,
    /** Base travel seconds between adjacent provinces, scaled by terrainTravel. Clamped to [min,max]. */
    travelBaseSec: 32,
    travelMinSec: 30,
    travelMaxSec: 90,
    /** Food upkeep per point of strength per second. */
    foodUpkeepPerStrength: 0.004,
    /** Neutral provinces start with this garrison strength (random 0.6..1.4 ×). */
    neutralGarrison: 14,
    /** Owned provinces have this passive garrison. */
    ownedGarrison: 6,
    /** Battle randomness: each side rolls a multiplier in [1-r, 1+r]. */
    battleRandomness: 0.2,
    warDeclareCooldownSec: 60,
    /** Must wait this long after declaring war before your armies may enter target land. */
    warMobilisationSec: 10,
    peaceCooldownSec: 60,
    /** Fog of war: provinces within this many hops of yours are visible. */
    visionRange: 1,
  },

  // ---------------------------------------------------------------- market shocks from war
  shocks: {
    warDeclared: { defence: 0.1, oil: 0.06, targetCompanies: -0.12, aggressorCompanies: -0.04, durationTicks: 2 },
    provinceCaptured: { loserCompanies: -0.06, winnerCompanies: 0.03, durationTicks: 1 },
    oilProvinceCaptured: { oil: 0.04 },
    sanction: { targetCompanies: -0.08, durationTicks: 2 },
    embargo: { targetCompanies: -0.12, durationTicks: 3 },
    coup: { companies: -0.25, durationTicks: 2 },
  },

  // ---------------------------------------------------------------- news + events
  events: {
    /** Probability per market tick of a world event at the start / end of the game. */
    chanceStart: 0.18,
    chanceEnd: 0.55,
    /** Magnitude multiplier at the start / end of the game. */
    intensityStart: 0.8,
    intensityEnd: 2.0,
    /** Rumour Mill headlines are false this often. */
    rumourFalseRate: 0.4,
    /** Chance an event is pre-announced by a rumour a tick before it fires. */
    rumourLeadChance: 0.35,
    /** Chance an event triggers a private insider tip shortly before. */
    insiderTipChance: 0.45,
    insiderTipWrongRate: 0.25,
    insiderTipLeadMs: 25_000,
    newsHistory: 80,
  },

  // ---------------------------------------------------------------- diplomacy
  diplomacy: {
    chatMaxLength: 240,
    chatHistory: 100,
    chatRateMs: 600,
    maxDealDurationSec: 600,
    breakDealReputationHit: 20,
    breakDealStabilityHit: 4,
    startingReputation: 100,
    sanctionStabilityPerSec: 0.04,
    /** A target sanctioned by this many players is under embargo: no exports, no deals. */
    embargoThreshold: 2,
    allianceBreakReputationHit: 15,
    proposalTtlMs: 60_000,
  },

  // ---------------------------------------------------------------- espionage
  espionage: {
    spyCost: 1200,
    spyTech: 15,
    spyTrainSec: 30,
    maxSpies: 4,
    missionSec: { vision: 8, orderflow: 8, stealTech: 15, fakeNews: 10 } as Record<string, number>,
    successChance: { vision: 0.85, orderflow: 0.75, stealTech: 0.6, fakeNews: 0.7 } as Record<string, number>,
    visionDurationSec: 120,
    orderflowDurationSec: 90,
    stealTechFraction: 0.3,
    fakeNewsImpact: -0.08,
    caughtReputationHit: 10,
    cooldownSec: 20,
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

  roles: {
    whaleCashMultiplier: 2.5,
    /** Analysts see pressure bars with less noise and no delay. */
    analystNoise: 0.03,
    journalistHeadlineCooldownSec: 90,
  },

  modes: {
    dominationShare: 0.45,
    hegemonyHoldSec: 60,
  },

  net: {
    /** Token bucket: max messages per second per socket. */
    rateLimitPerSec: 25,
    rateLimitBurst: 40,
  },
};

export type GameConfig = typeof CONFIG;
