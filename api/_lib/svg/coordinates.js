// ─── Coordinate Helpers ─────────────────────────────────────────────────────────
// Funzioni helper per coordinate e posizioni

import { CW, CH, GAP, PT_Y, PT_H, FRAME_PAD, ROWS, SVG_W } from './constants.js';
import { COLS } from '../game.js';

// Helper functions per coordinate
export function getMX() {
  return Math.floor((SVG_W - (COLS * CW + (COLS - 1) * GAP)) / 2);
}
export const colL = (c) => getMX() + c * (CW + GAP);
export const cellY = (r, GY) => GY + r * CH;
export const cellCY = (r, GY) => GY + r * CH + CH / 2;
export function getGY() {
  return PT_Y + PT_H + 18;
}
