// ─── Reels Generator ────────────────────────────────────────────────────────────
// Genera le colonne e i simboli della slot machine

import { COLS, ROWS, REEL } from '../game.js';
import { CW } from './constants.js';
import { CH, GAP } from './constants.js';
import { symbolUse } from '../languages.js';
import { getMX, getGY } from './coordinates.js';
import {
  DUR,
  NM_DUR_EXTRA_LAST,
  FILLERS,
  NM_FILLERS_EXTRA,
} from './constants.js';

export function generateReels(uid, grid, nearMissCol) {
  const GY = getGY();
  const MX = getMX();
  const GH = ROWS * CH;

  let colBGs = '',
    reelsSvg = '',
    colBordersSvg = '',
    nmShineSvg = '';

  for (let c = 0; c < COLS; c++) {
    const x = MX + c * (CW + GAP);
    const isNm = c === nearMissCol;
    colBGs += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="url(#reelbg${uid})"/>`;

    let cells = '';
    for (let r = 0; r < ROWS; r++) {
      cells += symbolUse(uid, grid[c][r], x, GY + r * CH);
    }

    const fillerCount = isNm ? FILLERS + NM_FILLERS_EXTRA : FILLERS;
    for (let f = 0; f < fillerCount; f++) {
      const y = GY + (ROWS + f) * CH;
      const fid = REEL[Math.floor(Math.random() * REEL.length)];
      cells += symbolUse(uid, fid, x, y);
    }

    const dur = isNm && c === COLS - 1 ? DUR[c] + NM_DUR_EXTRA_LAST : DUR[c];
    reelsSvg += `<g clip-path="url(#cp${uid}c${c})"><g style="animation:rs${uid}c${c} ${dur}s cubic-bezier(.1,.7,.3,1) forwards">${cells}</g></g>`;
    colBordersSvg += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="none" stroke="#e94560" stroke-width="1.4" opacity="0.55"/>`;

    if (isNm) {
      nmShineSvg +=
        `<rect x="${x - 6}" y="${GY - 6}" width="${CW + 12}" height="${GH + 12}" rx="15"` +
        ` fill="#ffd700" filter="url(#glow${uid})"` +
        ` style="animation:shp${uid} ${dur}s ease-in-out forwards;opacity:0"/>` +
        `<rect x="${x - 2}" y="${GY - 2}" width="${CW + 4}" height="${GH + 4}" rx="13" fill="none"` +
        ` stroke="#ffd700" filter="url(#glow${uid})"` +
        ` style="animation:sh${uid} ${dur}s ease-in-out forwards;opacity:0"/>` +
        `<g clip-path="url(#cp${uid}c${c})">` +
        `<rect x="${x}" y="${GY}" width="${CW}" height="${Math.round(CH * 1.2)}"` +
        ` fill="url(#shg${uid})" opacity=".9"` +
        ` style="animation:shm${uid} ${(dur / 2.5).toFixed(2)}s linear infinite"/>` +
        `</g>`;
    }
  }

  return { colBGs, reelsSvg, colBordersSvg, nmShineSvg };
}
