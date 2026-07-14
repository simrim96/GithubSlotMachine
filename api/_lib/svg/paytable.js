// ─── Paytable Generator ──────────────────────────────────────────────────────────
// Genera la paytable in basso a sinistra

import { COLS, ROWS, CW, CH, GAP, PT_Y, PT_H, FRAME_PAD } from '../game.js';
import { getMX, getGY } from './coordinates.js';

export function generatePaytable(uid, winningLang) {
  const GY = PT_Y + PT_H + 18;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const MX = getMX();
  
  let paytable = '';
  if (winningLang) {
    paytable += `<g transform="translate(0,${PT_Y + 58})">
<text x="60" y="0" font-family="'Segoe UI',sans-serif" font-size="9" fill="#8b8baf">PYTHON</text>
<text x="60" y="16" font-family="'Segoe UI',sans-serif" font-size="10" fill="#${winningLang.accent}" font-weight="700">${winningLang.name}</text>
<text x="60" y="30" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">5 ● ● ● ● ● ● ●</text>
<text x="60" y="42" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">4 ● ● ● ● ● ●</text>
<text x="60" y="54" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">3 ● ● ● ●</text>
</g>`;
  }
  
  return paytable;
}
