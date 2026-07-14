// ─── CSS/Animations Generator ──────────────────────────────────────────────────
// Genera le animazioni CSS per slot machine

import { COLS, ROWS, FILLERS, NM_FILLERS_EXTRA } from '../game.js';
import { DUR, CH, NM_DUR_EXTRA_LAST } from './constants.js';

export function generateCSS(uid, result) {
  const { isWin, ED, nearMissCol } = result;
  let css = '';
  const bln = `bl${uid}`;
  css += isWin
    ? `@keyframes ${bln}{0%,100%{opacity:1}50%{opacity:.35}}`
    : `@keyframes ${bln}{0%,18%{opacity:1}30%,100%{opacity:.32}}`;
  
  for (let c = 0; c < COLS; c++) {
    const a = `rs${uid}c${c}`;
    if (c === nearMissCol) {
      const nmScroll = FILLERS * CH + NM_FILLERS_EXTRA * CH;
      css += `@keyframes ${a}{0%{transform:translateY(-${nmScroll}px)}` +
        `70%{transform:translateY(-${Math.round(FILLERS * CH * 0.10)}px)}` +
        `80%{transform:translateY(28px)}87%{transform:translateY(-20px)}` +
        `93%{transform:translateY(11px)}97%{transform:translateY(-5px)}100%{transform:translateY(0)}}`;
    } else {
      const scroll = FILLERS * CH;
      css += `@keyframes ${a}{0%{transform:translateY(-${scroll}px)}` +
        `85%{transform:translateY(12px)}94%{transform:translateY(-4px)}100%{transform:translateY(0)}}`;
    }
  }
  
  css += `@keyframes wp${uid}{0%,100%{opacity:0}50%{opacity:.55}}`;
  css += `@keyframes ov${uid}{from{opacity:0}to{opacity:.92}}`;
  css += `@keyframes ot${uid}{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}`;
  css += `@keyframes fi${uid}{from{opacity:0}to{opacity:1}}`;
  css += `@keyframes jb${uid}{0%,100%{stroke:#ffd700}50%{stroke:#e94560}}`;
  css += `@keyframes nm${uid}{0%,100%{opacity:0}30%{opacity:.4}60%{opacity:0}}`;
  css += `@keyframes cf${uid}{0%{transform:translateY(-20px);opacity:1}100%{transform:translateY(220px);opacity:0}}`;
  
  // Near-miss shine
  if (nearMissCol >= 0) {
    css += `@keyframes sh${uid}{0%{opacity:0;stroke-width:1}` +
      `8%{opacity:1;stroke-width:5}` +
      `50%{opacity:1;stroke-width:4}` +
      `90%{opacity:1;stroke-width:6}` +
      `96%{opacity:1;stroke-width:4}` +
      `100%{opacity:0;stroke-width:0}}`;
    css += `@keyframes shp${uid}{0%{opacity:0}10%{opacity:.45}50%{opacity:.55}` +
      `90%{opacity:.65}97%{opacity:.55}100%{opacity:0}}`;
    css += `@keyframes shm${uid}{0%{transform:translateY(-100%)}100%{transform:translateY(${ROWS * CH + 20}px)}}`;
  }
  
  return css;
}
