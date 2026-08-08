// ─── Paytable Generator ──────────────────────────────────────────────────────────
// Genera la paytable in alto, subito sotto il titolo.
// Mostra TUTTE le icone presenti nella slot (linguaggi + wild + scatter),
// ognuna con un numero di pallini (1-5) pari alla competenza del linguaggio
// (campo `competence` in languages.js: più pallini = più padronanza).
// Il simbolo vincente viene evidenziato con un anello dorato.

import { PT_H, PT_Y } from './constants.js';
import { ALL_SYMBOLS, symbolUse } from '../languages.js';

const DOT = '#41CD52';
const WIN_RING = '#ffd700';

// Disegna N pallini verdi in fila (max 5), ombreggiati se oltre il livello
function renderDots(x, y, count, max = 5) {
  let s = '';
  const r = 2.1;
  const sp = 5.4;
  for (let i = 0; i < max; i++) {
    const on = i < count;
    const op = on ? 0.5 + (count - i) * 0.09 : 0.08;
    s += `<circle cx="${x + i * sp}" cy="${y}" r="${r}" fill="${DOT}" opacity="${op.toFixed(2)}"/>`;
  }
  return s;
}

export function generatePaytable(uid, winningLang) {
  // Area visibile: x 120..480, y PT_Y..(PT_Y+PT_H) — clip-path in defs.js
  // PT_Y = subito sotto l'header (y=70), PT_H = 92 -> finisce a 162,
  // PRIMA del frame schermo che inizia a y=214 (margine ampio).
  let paytable = '';

  // ─── PANNELLO ──────────────────────────────────────────────
  paytable += `<rect x="120" y="${PT_Y}" width="360" height="${PT_H}" rx="12" fill="#13122d" stroke="#4ecdc4" stroke-width="1.5"/>`;

  // ─── TITOLO ────────────────────────────────────────────────
  paytable += `<text x="300" y="${PT_Y + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#4ecdc4" letter-spacing="1.5">PAYTABLE</text>`;
  paytable += `<text x="300" y="${PT_Y + 25}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#8b8baf">More dots = more mastery</text>`;

  // ─── TUTTE LE ICONE DELLA SLOT + PALLINI (competenza 1-5) ──
  const cellW = 36; // 10 icone su 360px di larghezza
  const iconSize = 28;
  const iconTop = PT_Y + 38;
  const dotsY = iconTop + iconSize + 6;
  const maxDots = 5;
  const rowW = (maxDots - 1) * 5.4 + 4.2;
  const winningId = winningLang && winningLang.id ? winningLang.id : null;

  ALL_SYMBOLS.forEach((sym, idx) => {
    const cx = 120 + cellW * idx + cellW / 2;
    const ix = cx - iconSize / 2;
    // Wild/scatter non hanno competenza: 0 pallini (simboli speciali)
    const competence = Math.max(0, Math.min(5, sym.competence || 0));

    if (sym.id === winningId) {
      // Anello dorato attorno al simbolo vincente
      paytable += `<rect x="${ix - 2}" y="${iconTop - 2}" width="${iconSize + 4}" height="${iconSize + 4}" rx="9" fill="none" stroke="${WIN_RING}" stroke-width="1.8" opacity="0.9"/>`;
    }

    // Icona reale della slot (stesso <symbol> usato sui rulli)
    paytable += symbolUse(uid, sym.id, ix, iconTop, iconSize, iconSize);
    paytable += renderDots(cx - rowW / 2, dotsY, competence, maxDots);
  });

  return paytable;
}
