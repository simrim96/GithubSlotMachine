// ─── CSS/Animations Generator ──────────────────────────────────────────────────
// Genera le animazioni CSS per slot machine

import { COLS, ROWS } from '../game.js';
import { FILLERS, CH } from './constants.js';

export function generateCSS(uid, result) {
  const { isWin } = result;
  let css = '';
  const bln = `bl${uid}`;
  css += isWin
    ? `@keyframes ${bln}{0%,100%{opacity:1}50%{opacity:.35}}`
    : `@keyframes ${bln}{0%,18%{opacity:1}30%,100%{opacity:.32}}`;

  for (let c = 0; c < COLS; c++) {
    const a = `rs${uid}c${c}`;
    // Rulli normali: nessun near-miss, nessun jackpot.
    const scroll = FILLERS * CH;
    css +=
      `@keyframes ${a}{0%{transform:translateY(-${scroll}px)}` +
      `85%{transform:translateY(12px)}94%{transform:translateY(-4px)}100%{transform:translateY(0)}}`;
  }

  css += `@keyframes wp${uid}{0%,100%{opacity:0}50%{opacity:.55}}`;
  css += `@keyframes ov${uid}{from{opacity:0}to{opacity:.92}}`;
  css += `@keyframes ot${uid}{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}`;
  css += `@keyframes fi${uid}{from{opacity:0}to{opacity:1}}`;
  css += `@keyframes cf${uid}{0%{transform:translateY(-20px);opacity:1}100%{transform:translateY(220px);opacity:0}}`;

  // Accessibility: prefers-reduced-motion support
  css += `@media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }`;

  return css;
}
