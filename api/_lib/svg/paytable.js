// ─── Paytable Generator ──────────────────────────────────────────────────────────
// Genera la paytable in alto, subito sotto il titolo.
// Mostra le icone dei simboli vincenti con pallini verdi: più pallini = vincita maggiore.

import { COLS, ROWS } from '../game.js';
import { CW, CH, FRAME_PAD, PT_H, PT_Y } from './constants.js';
import { GAP } from './constants.js';
import { getMX, getGY } from './coordinates.js';
import { DUR, NM_DUR_EXTRA_LAST } from './constants.js';

// Metadati dei simboli: colore bordo/accento e numero di "competenza" (pallini massimi)
const SYMBOLS = {
  cpp:        { accent: '#9FD3F0', text: '#ffffff', short: 'C++' },
  c:           { accent: '#A8B9CC', text: '#ffffff', short: 'C' },
  glsl:        { accent: '#F5B642', text: '#ffffff', short: 'GLSL' },
  react:       { accent: '#61DAFB', text: '#61DAFB', short: 'React' },
  javascript:  { accent: '#61DAFB', text: '#1a1a1a', short: 'JS' },
  python:      { accent: '#FFD43B', text: '#ffffff', short: 'Py' },
  typescript:  { accent: '#235A97', text: '#ffffff', short: 'TS' },
  qt:          { accent: '#41CD52', text: '#ffffff', short: 'Qt' },
  wild:        { accent: '#a16207', text: '#1a1a2e', short: 'WILD' },
  scatter:     { accent: '#f0abfc', text: '#ffffff', short: 'BONUS' },
};

const DOT = '#41CD52';

// Disegna un'icona compatta del simbolo (riquadro gradiente + glifo)
function renderIcon(uid, symbolId, x, y, size) {
  const info = SYMBOLS[symbolId] || { accent: '#61DAFB', text: '#61DAFB', short: symbolId.slice(0, 3) };
  const p = 2;
  const inner = size - p * 2;
  let s = '';
  s += `<rect x="${x + p}" y="${y + p}" width="${inner}" height="${inner}" rx="6" fill="url(#grad_${uid}_${symbolId})" opacity="0.95"/>`;
  s += `<rect x="${x + p}" y="${y + p}" width="${inner}" height="${inner}" rx="6" fill="none" stroke="${info.accent}" stroke-width="1.6" opacity="0.85"/>`;
  // Glifo testuale al centro
  s += `<text x="${x + size / 2}" y="${y + size / 2 + 3}" font-family="'Segoe UI',sans-serif" font-size="7" font-weight="800" fill="${info.text}" text-anchor="middle">${info.short}</text>`;
  return s;
}

// Disegna N pallini verdi in fila, ombreggiati se oltre il "livello"
function renderDots(x, y, count, max = 7) {
  let s = '';
  const r = 2.2;
  const sp = 5.4;
  for (let i = 0; i < max; i++) {
    const on = i < count;
    const op = on ? (0.5 + (count - i) * 0.07) : 0.08;
    s += `<circle cx="${x + i * sp}" cy="${y}" r="${r}" fill="${DOT}" opacity="${op.toFixed(2)}"/>`;
  }
  return s;
}

export function generatePaytable(uid, winningLang, gridSymbols) {
  // Area visibile: x 120..480, y PT_Y..(PT_Y+PT_H) — clip-path in defs.js
  // PT_Y = subito sotto l'header (y=70), PT_H = 66 -> finisce a 136,
  // PRIMA del frame schermo che inizia a y=140 (margine 4px)
  let paytable = '';

  // ─── PANNELLO ──────────────────────────────────────────────
  paytable += `<rect x="120" y="${PT_Y}" width="360" height="${PT_H}" rx="12" fill="#13122d" stroke="#4ecdc4" stroke-width="1.5"/>`;

  // ─── TITOLO ────────────────────────────────────────────────
  paytable += `<text x="300" y="${PT_Y + 18}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#4ecdc4" letter-spacing="1.5">PAYTABLE</text>`;
  paytable += `<text x="300" y="${PT_Y + 30}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf">More dots = more mastery</text>`;

  // ─── ICONE VINCENTI + PALLINI ─────────────────────────────
  // Scegli fino a 3 simboli da mostrare (il linguaggio vincente in testa)
  const list = [];
  if (winningLang && winningLang.id) list.push(winningLang.id);
  if (gridSymbols && gridSymbols.length) {
    for (const sym of gridSymbols) {
      if (sym !== 'wild' && sym !== 'scatter' && !list.includes(sym)) list.push(sym);
      if (list.length >= 3) break;
    }
  }
  // fallback se non c'è nulla
  if (list.length === 0) list.push('javascript', 'python', 'react');

  const cardW = 116;
  const startX = 132;
  const iconSize = 22;
  const iconY = PT_Y + 28;
  const dotsY = PT_Y + 52;
  const combos = [
    { match: 3, dots: 3 },
    { match: 4, dots: 5 },
    { match: 5, dots: 7 },
  ];

  list.slice(0, 3).forEach((sym, idx) => {
    const cx = startX + idx * cardW;
    // Icona centrata nella card
    const ix = cx + (cardW - iconSize) / 2;
    paytable += renderIcon(uid, sym, ix, iconY, iconSize);

    // Tre livelli di pallini (3/4/5 match) sotto l'icona, centrati
    const maxDots = 7;
    const rowW = (maxDots - 1) * 5.4 + 4.4;
    combos.forEach((c, ri) => {
      const dy = dotsY + ri * 9;
      const dx = cx + (cardW - rowW) / 2;
      paytable += renderDots(dx, dy, c.dots, maxDots);
    });
  });

  return paytable;
}
