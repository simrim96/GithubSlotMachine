// ─── Win Effects Generator ──────────────────────────────────────────────────────
// Genera effetti visivi per vincite e near-miss

import {
  generateWinGlowSVG,
  generateNearMissSVG,
  generateCoinsSVG,
} from './effects-helpers.js';

export function generateWinEffects(
  uid,
  winCells,
  nearMissCol,
  ED,
  isBigWin,
  isJackpot
) {
  const winGlowSvg = generateWinGlowSVG(uid, winCells, ED);
  const nearMissSvg = generateNearMissSVG(uid, nearMissCol, ED);
  const coinsSvg = generateCoinsSVG(uid, isBigWin, isJackpot);

  return { winGlowSvg, nearMissSvg, coinsSvg };
}
