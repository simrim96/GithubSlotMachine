// ─── Win Effects Generator ──────────────────────────────────────────────────────
// Genera effetti visivi per vincite e near-miss

import { COLS, ROWS, REEL } from '../game.js';
import { CW, CH } from './constants.js';
import { GAP } from './constants.js';
import { generateWinGlowSVG, generateNearMissSVG, generateCoinsSVG } from './effects-helpers.js';
import { getMX, getGY, colL, cellY } from './coordinates.js';
import { DUR, NM_DUR_EXTRA_LAST, FILLERS } from './constants.js';

export function generateWinEffects(uid, winCells, nearMissCol, ED, isBigWin, isJackpot) {
  const winGlowSvg = generateWinGlowSVG(uid, winCells, ED);
  const nearMissSvg = generateNearMissSVG(uid, nearMissCol, ED);
  const coinsSvg = generateCoinsSVG(uid, isBigWin, isJackpot, ED);
  
  return { winGlowSvg, nearMissSvg, coinsSvg };
}
