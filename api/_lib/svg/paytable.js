// ─── Paytable Generator ──────────────────────────────────────────────────────────
// Genera la paytable in basso a sinistra

import { COLS, ROWS } from '../game.js';
import { CW, CH, FRAME_PAD, PT_H, PT_Y } from './constants.js';
import { GAP } from './constants.js';
import { getMX, getGY } from './coordinates.js';
import { DUR, NM_DUR_EXTRA_LAST } from './constants.js';

export function generatePaytable(uid, winningLang) {
  const GY = PT_Y + PT_H + 18;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const MX = getMX();
  
  let paytable = '';
  if (winningLang) {
    // Spostato a x=120 per allinearsi col rettangolo del paytable
    paytable += `<g transform="translate(120,${PT_Y + 58})">
<text x="0" y="0" font-family="'Segoe UI',sans-serif" font-size="9" fill="#8b8baf">LEVEL KNOWLEDGE</text>
<text x="0" y="16" font-family="'Segoe UI',sans-serif" font-size="10" fill="#${winningLang.accent}" font-weight="700">${winningLang.name}</text>
<text x="0" y="30" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">5 ● ● ● ● ● ● ● = 20x</text>
<text x="0" y="42" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">4 ● ● ● ● ● ● = 10x</text>
<text x="0" y="54" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">3 ● ● ● ● = 5x</text>
</g>`;
  } else {
    // Placeholder quando non c'è vincita
    paytable += `<g transform="translate(120,${PT_Y + 58})">
<text x="0" y="0" font-family="'Segoe UI',sans-serif" font-size="9" fill="#8b8baf">LEVEL KNOWLEDGE</text>
<text x="0" y="16" font-family="'Segoe UI',sans-serif" font-size="8" fill="#61DAFB">Spin to see symbols...</text>
</g>`;
  }
  
  return paytable;
}
