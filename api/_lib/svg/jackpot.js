// ─── Jackpot Overlay Generator ──────────────────────────────────────────────────
// Genera l'overlay per jackpot

import { COLS, ROWS, CW, CH, GAP } from '../game.js';
import { wrap } from './utils-extended.js';
import { colL, getMX, getGY } from './coordinates.js';

export function generateJackpotOverlay(uid, winningLang, ED) {
  const GY = getGY();
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const MX = getMX();
  
  const langName = winningLang?.name || '';
  
  return `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="11" fill="#1a1a2e" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>
<rect x="${MX + 2}" y="${GY + 2}" width="${GW - 4}" height="${GH - 4}" rx="10" fill="none" stroke="#ffd700" stroke-width="2" style="animation:jb${uid} .3s ${ED}s infinite;opacity:0"/>
<text x="${600 / 2}" y="${GY + GH / 2 - 8}" text-anchor="middle" font-size="38" font-weight="800" fill="#ffd700" font-family="'Segoe UI',sans-serif" filter="url(#glow${uid})" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">🏆 JACKPOT 🏆</text>
<text x="${600 / 2}" y="${GY + GH / 2 + 16}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffd700" font-family="'Segoe UI',sans-serif" style="animation:ot${uid} .5s ${ED + 0.3}s forwards;opacity:0">Discover ALL my ${wrap(langName, 40).join(' ')} projects →</text>
<text x="${600 / 2}" y="${GY + GH / 2 + 34}" text-anchor="middle" font-size="11" fill="#ffe88a" font-family="'Segoe UI',sans-serif" font-style="italic" style="animation:ot${uid} .5s ${ED + 0.4}s forwards;opacity:0">Scopri TUTTI i miei progetti ${wrap(langName, 35).join(' ')}</text>`;
}
