// ─── Screen Frame Generator ──────────────────────────────────────────────────────
// Genera il frame dello schermo della slot machine

import { COLS, ROWS } from '../game.js';
import { CW, CH, FRAME_PAD } from './constants.js';
import { GAP } from './constants.js';
import { getMX, getGY, colL } from './coordinates.js';
import { DUR, NM_DUR_EXTRA_LAST } from './constants.js';

export function generateScreenFrame(uid, isWin, ED, nearMissCol) {
  const MX = getMX();
  const GY = getGY();
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const SCR_X = MX - FRAME_PAD;
  const SCR_Y = GY - FRAME_PAD;
  const SCR_W = GW + 2 * FRAME_PAD;
  const SCR_H = GH + 2 * FRAME_PAD;
  
  // Striscia LED sopra
  const screenFrameSvg =
    `<rect x="${SCR_X + 8}" y="${SCR_Y - 9}" width="${SCR_W - 16}" height="2" rx="1"
         fill="#ffd84a" opacity="0.7"/>` +
    `<rect x="${SCR_X - 4}" y="${SCR_Y - 4}" width="${SCR_W + 8}" height="${SCR_H + 8}" rx="14"
         fill="#7a4400"/>` +
    `<rect x="${SCR_X}" y="${SCR_Y}" width="${SCR_W}" height="${SCR_H}" rx="12"
         fill="url(#frame${uid})"/>` +
    // Inner black bezel
    `<rect x="${MX - 8}" y="${GY - 8}" width="${GW + 16}" height="${GH + 16}" rx="6"
         fill="#0a0612"/>` +
    // Glow interno
    `<rect x="${MX - 7}" y="${GY - 7}" width="${GW + 14}" height="${GH + 14}" rx="6"
         fill="url(#scrGlow${uid})" opacity="0.35"/>` +
    `<rect x="${MX - 6}" y="${GY - 6}" width="${GW + 12}" height="${GH + 12}" rx="5"
         fill="none" stroke="#3a1a05" stroke-width="1.4" opacity="0.9"/>` +
    // Striscia LED sotto
    `<rect x="${SCR_X + 8}" y="${SCR_Y + SCR_H + 7}" width="${SCR_W - 16}" height="2" rx="1"
         fill="#ffd84a" opacity="0.7"/>`;
  
  return screenFrameSvg;
}
