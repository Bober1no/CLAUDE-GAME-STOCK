/** Nation colours, assigned in join order. Picked to stay distinct on a dark map. */
export const NATION_COLORS = ['#4fc3f7', '#ff7043', '#aed581', '#ba68c8', '#ffd54f', '#4db6ac', '#f06292', '#90a4ae'];

/** Parody nation names, shuffled per game. */
export const NATION_NAMES = [
  'Republic of Oilvania',
  'Grand Duchy of Bananaria',
  'United Bytes of Silicania',
  'Kingdom of Wheatshire',
  'Federation of Coffeeland',
  'Peoples Republic of Lithia',
  'Commonwealth of Lumberjackia',
  'Sultanate of Ricebowl',
];

export const SECTOR_LABEL: Record<string, string> = {
  energy: 'Energy',
  defence: 'Defence',
  tech: 'Tech',
  shipping: 'Shipping',
  food: 'Food',
  pharma: 'Pharma',
};

export const RESOURCE_LABEL: Record<string, string> = { oil: 'Oil', food: 'Food', metals: 'Metals', tech: 'Tech' };

export const BUILDING_LABEL: Record<string, string> = {
  farm: 'Farm',
  mine: 'Mine',
  well: 'Oil Well',
  lab: 'Research Lab',
  fort: 'Fort',
  port: 'Port',
};
