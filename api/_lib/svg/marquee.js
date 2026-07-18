// ─── Marquee Bulbs Generator ───────────────────────────────────────────────────
// Genera le luci del marquee attorno allo schermo

import { COLS, ROWS } from '../game.js';
import { CW, CH, FRAME_PAD, GAP } from './constants.js';
import { getMX, getGY } from './coordinates.js';

export function generateMarqueeBulbs(uid, isWin, ED) {
  const bulbR = 5.5;
  const bulbStep = 26;
  const bulbInset = FRAME_PAD / 2;
  const SCR_X = getMX() - FRAME_PAD;
  const GY = getGY();
  const SCR_Y = GY - FRAME_PAD;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const SCR_W = GW + 2 * FRAME_PAD;
  const SCR_H = GH + 2 * FRAME_PAD;

  const bulbs = [];
  const cols_count = Math.max(
    2,
    Math.round((SCR_W - 2 * bulbInset) / bulbStep)
  );
  const colDx = (SCR_W - 2 * bulbInset) / cols_count;
  for (let i = 0; i <= cols_count; i++) {
    const x = SCR_X + bulbInset + i * colDx;
    bulbs.push({ x, y: SCR_Y + bulbInset });
    bulbs.push({ x, y: SCR_Y + SCR_H - bulbInset });
  }
  const rows_count = Math.max(
    2,
    Math.round((SCR_H - 2 * bulbInset) / bulbStep)
  );
  const rowDy = (SCR_H - 2 * bulbInset) / rows_count;
  for (let i = 1; i < rows_count; i++) {
    const y = SCR_Y + bulbInset + i * rowDy;
    bulbs.push({ x: SCR_X + bulbInset, y });
    bulbs.push({ x: SCR_X + SCR_W - bulbInset, y });
  }

  let svg = '';
  for (const [i, b] of bulbs.entries()) {
    const dur = isWin ? 0.45 : 1.4;
    const dl = isWin ? ED + (i % 4) * 0.09 : (i * 0.06) % 1.4;
    const isRed = i % 2 === 0;
    const fillRef = isRed ? 'bulbRed' : 'bulbOn';
    const haloC = isRed ? '#ff4040' : '#ffd84a';
    const ringC = isRed ? '#5a0606' : '#7a3a00';
    svg +=
      `<g style="animation:bl${uid} ${dur}s ${dl.toFixed(2)}s infinite">` +
      `<circle cx="${b.x}" cy="${b.y}" r="${bulbR + 2.2}" fill="${haloC}" opacity="0.22"/>` +
      `<circle cx="${b.x}" cy="${b.y}" r="${bulbR}" fill="url(#${fillRef}${uid})" stroke="${ringC}" stroke-width="0.9"/>` +
      `<circle cx="${b.x - 1.6}" cy="${b.y - 1.8}" r="1.4" fill="#ffffff" opacity="0.9"/>` +
      `</g>`;
  }
  return svg;
}
