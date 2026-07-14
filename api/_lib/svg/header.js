// ─── Header Generator ────────────────────────────────────────────────────────────
// Genera l'header della slot machine

import { SVG_W, HDR_H, HDR_TOP } from './constants.js';

export function generateHeader(uid, state) {
  const total = (state.totalSpins || 0).toLocaleString('en-US');
  const wonTotal = (state.totalWins || 0).toLocaleString('en-US');
  
  return `<rect x="32" y="${HDR_TOP}" width="${SVG_W - 64}" height="${HDR_H - 6}" rx="14" fill="#13122d" opacity="0.92" stroke="#7a4400" stroke-width="1.2"/>
<text x="${SVG_W / 2}" y="${HDR_TOP + 22}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="19" font-weight="800" fill="url(#hdr${uid})" filter="url(#glow${uid})">DEV STACK SLOT MACHINE</text>
<text x="${SVG_W / 2}" y="${HDR_TOP + 36}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="8.5" fill="#8b8baf" letter-spacing="2.6">SPIN · LEARN · DISCOVER MY PROJECTS</text>
<g font-family="'Segoe UI',sans-serif">
  <text x="50" y="${HDR_TOP + 53}" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">COMMUNITY SPINS</text>
  <text x="50" y="${HDR_TOP + 68}" font-size="14" font-weight="800" fill="#ffd700">${total}</text>
  <text x="${SVG_W - 50}" y="${HDR_TOP + 53}" text-anchor="end" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">WINS</text>
  <text x="${SVG_W - 50}" y="${HDR_TOP + 68}" text-anchor="end" font-size="14" font-weight="800" fill="#4ade80">${wonTotal}</text>
</g>`;
}
