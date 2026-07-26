// ─── Reels Generator ────────────────────────────────────────────────────────────
// Genera le colonne e i simboli della slot machine (near-miss rimosso: i rulli
// girano normalmente per ogni colonna).

import { COLS, ROWS, REEL } from '../game.js';
import { CW } from './constants.js';
import { CH, GAP, FILLERS } from './constants.js';
import { symbolUse } from '../languages.js';
import { getMX, getGY } from './coordinates.js';
import { DUR } from './constants.js';

export function generateReels(uid, grid) {
  const GY = getGY();
  const MX = getMX();
  const GH = ROWS * CH;

  let colBGs = '',
    reelsSvg = '',
    colBordersSvg = '';

  for (let c = 0; c < COLS; c++) {
    const x = MX + c * (CW + GAP);
    colBGs += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="url(#reelbg${uid})"/>`;

    let cells = '';
    for (let r = 0; r < ROWS; r++) {
      cells += symbolUse(uid, grid[c][r], x, GY + r * CH);
    }

    // Rulli normali: nessun near-miss, nessun filler extra.
    const fillerCount = FILLERS;
    for (let f = 0; f < fillerCount; f++) {
      const y = GY + (ROWS + f) * CH;
      const fid = REEL[Math.floor(Math.random() * REEL.length)];
      cells += symbolUse(uid, fid, x, y);
    }

    const dur = DUR[c];
    reelsSvg += `<g clip-path="url(#cp${uid}c${c})"><g style="animation:rs${uid}c${c} ${dur}s cubic-bezier(.1,.7,.3,1) forwards">${cells}</g></g>`;
    colBordersSvg += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="none" stroke="#e94560" stroke-width="1.4" opacity="0.55"/>`;
  }

  return { colBGs, reelsSvg, colBordersSvg };
}
