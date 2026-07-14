// ─── Defs Generator (Gradients, Filters, ClipPaths) ───────────────────────────
// Genera gradienti, filtri e clip paths per SVG

import { REEL, ROWS, COLS } from '../game.js';
import { LANGUAGES, buildSymbolDefs } from '../languages.js';
import { CW, CH, GAP, FRAME_PAD } from './constants.js';
import { DUR, NM_DUR_EXTRA_LAST } from './constants.js';
import { PT_H as PT_H_CONST } from './constants.js';
import { getMX, getGY } from './coordinates.js';

export function generateDefs(uid, winningLang) {
  let defs = '';
  defs += `<radialGradient id="bg${uid}" cx="50%" cy="0%" r="120%"><stop offset="0%" stop-color="#2a2754"/><stop offset="55%" stop-color="#171530"/><stop offset="100%" stop-color="#0b0a1f"/></radialGradient>`;
  defs += `<linearGradient id="hdr${uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="33%" stop-color="#ffd700"/><stop offset="66%" stop-color="#4ecdc4"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>`;
  defs += `<linearGradient id="reelbg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0b0b1f"/><stop offset="100%" stop-color="#1a1a35"/></linearGradient>`;
  defs += `<filter id="glow${uid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  
  // Cabinet gradients
  defs += `<linearGradient id="cab${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#e8331f"/>` +
    `<stop offset="50%" stop-color="#c41e1e"/>` +
    `<stop offset="100%" stop-color="#7a0f0f"/>` +
    `</linearGradient>`;
  defs += `<linearGradient id="cabHi${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ff6a4a" stop-opacity=".55"/>` +
    `<stop offset="100%" stop-color="#ff6a4a" stop-opacity="0"/>` +
    `</linearGradient>`;
  
  // Frame gradients
  defs += `<linearGradient id="frame${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffd84a"/>` +
    `<stop offset="50%" stop-color="#f5a623"/>` +
    `<stop offset="100%" stop-color="#c47a07"/>` +
    `</linearGradient>`;
  
  // Bulb gradients
  defs += `<radialGradient id="bulbOn${uid}" cx="35%" cy="30%" r="70%">` +
    `<stop offset="0%" stop-color="#fffbe6"/>` +
    `<stop offset="40%" stop-color="#ffd84a"/>` +
    `<stop offset="100%" stop-color="#a85a00"/>` +
    `</radialGradient>`;
  defs += `<radialGradient id="bulbRed${uid}" cx="35%" cy="30%" r="70%">` +
    `<stop offset="0%" stop-color="#ffd0d0"/>` +
    `<stop offset="40%" stop-color="#ff4040"/>` +
    `<stop offset="100%" stop-color="#7a0707"/>` +
    `</radialGradient>`;
  
  // Special gradients
  defs += `<linearGradient id="goldBar${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffe066"/>` +
    `<stop offset="55%" stop-color="#f5a623"/>` +
    `<stop offset="100%" stop-color="#a86610"/>` +
    `</linearGradient>`;
  defs += `<linearGradient id="banner${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#fff4a8"/>` +
    `<stop offset="30%" stop-color="#ffd84a"/>` +
    `<stop offset="70%" stop-color="#f5a623"/>` +
    `<stop offset="100%" stop-color="#a85a00"/>` +
    `</linearGradient>`;
  defs += `<linearGradient id="red7${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ff5a5a"/>` +
    `<stop offset="50%" stop-color="#e11d1d"/>` +
    `<stop offset="100%" stop-color="#7a0707"/>` +
    `</linearGradient>`;
  defs += `<linearGradient id="darkPanel${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#0a0612"/>` +
    `<stop offset="100%" stop-color="#1a0d2a"/>` +
    `</linearGradient>`;
  defs += `<radialGradient id="scrGlow${uid}" cx="50%" cy="50%" r="60%">` +
    `<stop offset="0%" stop-color="#a855f7" stop-opacity="0.55"/>` +
    `<stop offset="60%" stop-color="#4338ca" stop-opacity="0.25"/>` +
    `<stop offset="100%" stop-color="#0a0612" stop-opacity="0"/>` +
    `</radialGradient>`;
  defs += `<linearGradient id="shg${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffd700" stop-opacity="0"/>` +
    `<stop offset="50%" stop-color="#ffd700" stop-opacity=".55"/>` +
    `<stop offset="100%" stop-color="#ffd700" stop-opacity="0"/>` +
    `</linearGradient>`;
  
  // Clip paths per column
  const GY = getGY();
  const MX = getMX();
  for (let c = 0; c < COLS; c++) {
    defs += `<clipPath id="cp${uid}c${c}"><rect x="${MX + c * (CW + GAP)}" y="${GY}" width="${CW}" height="${ROWS * CH}"/></clipPath>`;
  }
  
  defs += buildSymbolDefs(uid);
  return defs;
}
