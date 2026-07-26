// ─── Win Effects Helpers ────────────────────────────────────────────────────────
// Helper functions per effetti visivi (win glow, coins). Near-miss rimosso.

import { COLS, ROWS } from '../game.js';
import { CW, CH } from './constants.js';
import { GAP } from './constants.js';
import { colL, cellY, getMX, getGY } from './coordinates.js';

export function generateWinGlowSVG(uid, winCells, ED) {
  let svg = '';
  for (const key of winCells) {
    const [c, r] = key.split(',').map(Number);
    const x = colL(c);
    const y = cellY(r, getGY());
    svg += `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="11" fill="#ffd700" style="animation:wp${uid} .7s ${ED}s infinite;opacity:0"/>`;
  }
  return svg;
}

export function generateCoinsSVG(uid, isBigWin, ED) {
  if (!isBigWin) return '';
  const GW = COLS * CW + (COLS - 1) * GAP;
  const MX = getMX();
  const GY = getGY();
  const coinCount = 9;
  let svg = '';
  for (let i = 0; i < coinCount; i++) {
    const cx = MX + 24 + Math.floor(Math.random() * (GW - 48));
    const dl = ED + 0.2 + i * 0.12;
    svg += `<text x="${cx}" y="${GY}" font-size="24" font-family="sans-serif" style="animation:cf${uid} 1.6s ${dl}s forwards;opacity:0">🪙</text>`;
  }
  return svg;
}
