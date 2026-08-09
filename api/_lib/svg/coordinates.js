// ─── Coordinate Helpers ─────────────────────────────────────────────────────────
// Funzioni helper per coordinate e posizioni

import { CW, CH, GAP, PT_Y, PT_H, SVG_W } from './constants.js';
import { COLS } from '../game.js';

// Helper functions per coordinate
export function getMX() {
  return Math.floor((SVG_W - (COLS * CW + (COLS - 1) * GAP)) / 2);
}
export const colL = (c) => getMX() + c * (CW + GAP);
export const cellY = (r, GY) => GY + r * CH;
export function getGY() {
  // Lascia molto spazio rosso sotto la paytable prima dei rulli:
  // il bordo del frame parte a getGY() - FRAME_PAD - 4, quindi con +52
  // c'è ~18px di rosso pulito tra il pannello paytable (che ora parte a
  // PT_PANEL_Y = PT_Y + 8, finisce a 170) e il frame.
  return PT_Y + PT_H + 52;
}
