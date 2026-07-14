// ─── Win Effects Helpers ────────────────────────────────────────────────────────
// Helper functions per effetti visivi (win glow, near miss, coins)

import { COLS, ROWS, CW, CH, GAP, REEL } from '../game.js';
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

export function generateNearMissSVG(uid, nearMissCol, ED) {
  if (nearMissCol < 0) return '';
  const x = colL(nearMissCol);
  const GY = getGY();
  const GH = ROWS * CH;
  return `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="#f59e0b" style="animation:nm${uid} 1.2s ${ED}s 2;opacity:0"/>`;
}

export function generateCoinsSVG(uid, isBigWin, isJackpot, ED) {
  if (!isBigWin && !isJackpot) return '';
  const GH = ROWS * CH;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const MX = getMX();
  const GY = getGY();
  const coinCount = isJackpot ? 16 : 9;
  let svg = '';
  for (let i = 0; i < coinCount; i++) {
    const cx = MX + 24 + Math.floor(Math.random() * (GW - 48));
    const dl = ED + 0.2 + i * 0.12;
    svg += `<text x="${cx}" y="${GY}" font-size="24" font-family="sans-serif" style="animation:cf${uid} 1.6s ${dl}s forwards;opacity:0">🪙</text>`;
  }
  return svg;
}
