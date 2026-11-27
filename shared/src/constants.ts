/** Player colours, assigned in join order. Picked to stay distinct on a dark background. */
export const PLAYER_COLORS = ['#4fc3f7', '#ff7043', '#aed581', '#ba68c8', '#ffd54f', '#4db6ac', '#f06292', '#90a4ae'];

export const SECTOR_LABEL: Record<string, string> = {
  energy: 'Energy',
  tech: 'Tech',
  food: 'Food',
  defence: 'Defence',
};

export const CORPORATE_LABEL: Record<string, string> = {
  rnd: 'Invest in R&D',
  marketing: 'Marketing blitz',
  dividend: 'Pay dividend',
  fraud: 'Cook the books',
};

/** Shown on the home screen, in-game top bar and /health. Bump this when you ship an update. */
export const GAME_VERSION = 'v3';
