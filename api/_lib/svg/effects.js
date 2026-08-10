// ─── Win Effects Generator ──────────────────────────────────────────────────────
// Genera effetti visivi per vincite (near-miss disattivato).

import { generateWinGlowSVG, generateCoinsSVG } from './effects-helpers.js';

export function generateWinEffects(uid, winCells, ED, isBigWin = false) {
  const winGlowSvg = generateWinGlowSVG(uid, winCells, ED);
  const coinsSvg = generateCoinsSVG(uid, isBigWin, ED);

  return { winGlowSvg, coinsSvg };
}
