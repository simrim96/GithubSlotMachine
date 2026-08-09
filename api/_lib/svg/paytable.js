// ─── Paytable Generator ──────────────────────────────────────────────────────────
// Genera la paytable in alto, subito sotto il titolo.
// Mostra SOLO i linguaggi reali della slot (wild e scatter NON compaiono:
// lo scatter non è mai sui rulli, il wild non può vincere da solo).
// Ogni linguaggio ha un numero di pallini (1-5) pari alla competenza
// (campo `competence` in languages.js: più pallini = più padronanza).
// Il simbolo vincente viene evidenziato con un anello dorato che compare
// (con animazione) SOLO dopo che la rotazione dei rulli è terminata
// (delay = ED), così i giocatori non possono prevedere la vincita
// prima della fine dello spin.

import { PT_H, PT_PANEL_Y } from './constants.js';
import { ALL_SYMBOLS, WILD_ID, SCATTER_ID, symbolUse } from '../languages.js';

const DOT = '#41CD52';
const WIN_RING = '#ffd700';

// Solo i linguaggi: wild (non vince mai da solo) e scatter (mai sui rulli)
// sono esclusi dalla paytable.
const PAY_SYMBOLS = ALL_SYMBOLS.filter(
  (s) => s.id !== WILD_ID && s.id !== SCATTER_ID
);

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

export function generatePaytable(uid, winningLang, ED = 0) {
  // Area visibile: x 80..520 (pannello allargato), y PT_PANEL_Y..(PT_PANEL_Y+PT_H)
  // — clip-path in defs.js. PT_PANEL_Y = PT_Y + 8 (PT_Y = subito sotto
  // l'header, y=70): il pannello è spostato 8px in basso per non
  // sovrapporsi ai valori dei contatori SPINS/WINS (bbox ~57..73).
  // PT_H = 92 -> finisce a 170, PRIMA del frame schermo (margine ~18px).
  const PANEL_X = 80;
  const PANEL_W = 440;
  const CELL_W = 52;
  const ICON_SIZE = 38;
  const ICON_TOP = PT_PANEL_Y + 38;
  const ROW_X = PANEL_X + (PANEL_W - PAY_SYMBOLS.length * CELL_W) / 2;

  let paytable = '';

  // ─── PANNELLO ──────────────────────────────────────────────
  paytable += `<rect x="${PANEL_X}" y="${PT_PANEL_Y}" width="${PANEL_W}" height="${PT_H}" rx="12" fill="#13122d" stroke="#4ecdc4" stroke-width="1.5"/>`;

  // ─── TITOLO ────────────────────────────────────────────────
  paytable += `<text x="300" y="${PT_PANEL_Y + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#4ecdc4" letter-spacing="1.5">PAYTABLE</text>`;
  paytable += `<text x="300" y="${PT_PANEL_Y + 25}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="7.5" fill="#8b8baf">More dots = more mastery</text>`;

  // ─── SOLO LINGUAGGI + PALLINI (competenza 1-5) ─────────────
  const dotsY = ICON_TOP + ICON_SIZE + 6;
  const maxDots = 5;
  const rowW = (maxDots - 1) * 5.4 + 4.2;
  const winningId = winningLang && winningLang.id ? winningLang.id : null;

  PAY_SYMBOLS.forEach((sym, idx) => {
    const cx = ROW_X + CELL_W * idx + CELL_W / 2;
    const ix = cx - ICON_SIZE / 2;
    const competence = Math.max(0, Math.min(5, sym.competence || 0));

    if (sym.id === winningId) {
      // Anello dorato attorno al simbolo vincente: parte invisibile
      // (opacity:0) e compare con animazione SOLO dopo la fine della
      // rotazione dei rulli (delay = ED). Keyframes `wr` in css.js.
      paytable += `<rect x="${ix - 2}" y="${ICON_TOP - 2}" width="${ICON_SIZE + 4}" height="${ICON_SIZE + 4}" rx="10" fill="none" stroke="${WIN_RING}" stroke-width="1.8" style="animation:wr${uid} 1.4s ${ED}s forwards;opacity:0"/>`;
    }

    // Icona reale della slot (stesso <symbol> usato sui rulli)
    paytable += symbolUse(uid, sym.id, ix, ICON_TOP, ICON_SIZE, ICON_SIZE);
    paytable += renderDots(cx - rowW / 2, dotsY, competence, maxDots);
  });

  return paytable;
}
