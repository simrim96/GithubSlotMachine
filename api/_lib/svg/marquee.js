// ─── Marquee Bulbs Generator ───────────────────────────────────────────────────
// Genera le luci del marquee attorno allo schermo. I puntini sono centrati sul
// frame giallo attorno all'area dei rulli (screen.js): la corona segue la linea
// mediana della banda dorata e gli angoli seguono l'arco arrotondato del frame.

import { COLS, ROWS } from '../game.js';
import { CW, CH, FRAME_PAD, GAP } from './constants.js';
import { getMX, getGY } from './coordinates.js';

export function generateMarqueeBulbs(uid, isWin, ED) {
  const bulbR = 5.5;
  const bulbStep = 26;
  const SCR_X = getMX() - FRAME_PAD;
  const GY = getGY();
  const SCR_Y = GY - FRAME_PAD;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const SCR_W = GW + 2 * FRAME_PAD;
  const SCR_H = GH + 2 * FRAME_PAD;

  // Geometria del frame dorato (screen.js): bordo esterno a SCR_X/SCR_Y, bezel
  // nero interno a MX-8/GY-8 (rx=6) e angoli del frame arrotondati con rx=12.
  const BEZEL_INSET = 8;
  const FRAME_RX = 12;
  const BEZEL_RX = 6;

  // Linea mediana della banda dorata: margine di (FRAME_PAD - BEZEL_INSET)/2.
  const bandInset = (FRAME_PAD - BEZEL_INSET) / 2;
  const RING_X = SCR_X + bandInset;
  const RING_Y = SCR_Y + bandInset;
  const RING_W = SCR_W - 2 * bandInset;
  const RING_H = SCR_H - 2 * bandInset;

  const bulbs = [];
  const cols_count = Math.max(2, Math.round(RING_W / bulbStep));
  const colDx = RING_W / cols_count;
  for (let i = 0; i <= cols_count; i++) {
    const x = RING_X + i * colDx;
    bulbs.push({ x, y: RING_Y });
    bulbs.push({ x, y: RING_Y + RING_H });
  }
  const rows_count = Math.max(2, Math.round(RING_H / bulbStep));
  const rowDy = RING_H / rows_count;
  for (let i = 1; i < rows_count; i++) {
    const y = RING_Y + i * rowDy;
    bulbs.push({ x: RING_X, y });
    bulbs.push({ x: RING_X + RING_W, y });
  }

  // Angoli: i puntini stanno sull'arco mediano della banda dorata (a 45°)
  // invece che sugli spigoli vivi del rettangolo del frame.
  const m = (FRAME_RX + (FRAME_PAD - BEZEL_INSET) + BEZEL_RX) / 2;
  const cornerD = ((FRAME_RX + BEZEL_RX) / 2) * Math.SQRT1_2;
  bulbs[0] = { x: SCR_X + m - cornerD, y: SCR_Y + m - cornerD };
  bulbs[1] = {
    x: SCR_X + m - cornerD,
    y: SCR_Y + SCR_H - m + cornerD,
  };
  bulbs[2 * cols_count] = {
    x: SCR_X + SCR_W - m + cornerD,
    y: SCR_Y + m - cornerD,
  };
  bulbs[2 * cols_count + 1] = {
    x: SCR_X + SCR_W - m + cornerD,
    y: SCR_Y + SCR_H - m + cornerD,
  };

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
