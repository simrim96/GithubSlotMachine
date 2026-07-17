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
  
  // HEADER FISSO - SEMPRE VISIBILE
  paytable += `<g transform="translate(0,${PT_Y + 58})">
<text x="60" y="0" font-family="'Segoe UI',sans-serif" font-size="9" fill="#8b8baf">PAYTABLE</text>
<text x="60" y="14" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#8b8baf">Combinazioni vincenti:</text>
`;
  
  // Paytable dinamico se vincente
  if (winningLang) {
    paytable += `<text x="60" y="30" font-family="'Segoe UI',sans-serif" font-size="10" fill="#${winningLang.accent}" font-weight="700">${winningLang.name}</text>
<text x="60" y="42" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">5 ● ● ● ● ● = 20x</text>
<text x="60" y="54" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">4 ● ● ● ● = 10x</text>
<text x="60" y="66" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">3 ● ● ● = 5x</text>
`;
  } else {
    // Esempi generici quando non c'è vincita
    paytable += `<text x="60" y="30" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">Python: 5 ● ● ● ● ● = 20x</text>
<text x="60" y="42" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">JavaScript: 4 ● ● ● ● = 10x</text>
<text x="60" y="54" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#b8b8d0">TypeScript: 3 ● ● ● = 5x</text>
`;
  }
  
  paytable += `</g>`;
  
  return paytable;
}
