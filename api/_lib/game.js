// ─── Game logic pura (estratta da spin.js) ───────────────────────────────────
// Tutto qui è deterministico a parte Math.random() dentro generateGrid/engineer*,
// quindi è il posto giusto per i test. Nessuna dipendenza da GitHub, KV, OWNER.
import { LANGUAGES, WILD_ID, SCATTER_ID } from './languages.js';
export { WILD_ID, SCATTER_ID };

// ─── Slot config (pubblica per i test) ───────────────────────────────────────
export const SYMBOL_IDS = LANGUAGES.map((l) => l.id);
export const REEL = [
  ...LANGUAGES.flatMap((l) => Array(5).fill(l.id)),
  WILD_ID,
  WILD_ID,
  WILD_ID,
  WILD_ID,
];
export const FORCED_WIN_PROB = 0.35;
export const COLS = 5;
export const ROWS = 3;
export const PAYLINES = [
  [1, 1, 1, 1, 1], // center
  [0, 0, 0, 0, 0], // top
  [2, 2, 2, 2, 2], // bottom
  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2], // Λ
];
export const PL_COLORS = [
  '#ffd700',
  '#ff6b6b',
  '#4ecdc4',
  '#a855f7',
  '#fb923c',
];

// ─── Grid generation ─────────────────────────────────────────────────────────
export function generateGrid() {
  const grid = [];
  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[c][r] = REEL[Math.floor(Math.random() * REEL.length)];
    }
  }
  let wins = checkWins(grid);
  const scatCnt = countScatters(grid).length;

  // Forza una vincita con probabilità configurabile, per non frustrare i recruiter.
  if (wins.length === 0 && scatCnt < 3 && Math.random() < FORCED_WIN_PROB) {
    engineerWin(grid);
    wins = checkWins(grid);
  }

  // (RIMOSSO) Near-miss disattivato su richiesta: il rullo gira normalmente,
  // senza effetti "quasi vinto". Non viene più né generato né rilevato.

  // Prevenzione jackpot: se una payline ha chiuso un 5-in-a-row (jackpot
  // organico), lo rompiamo a 4 così la vincita resta "normale" (mai jackpot).
  if (wins.some((w) => w.count >= 5)) {
    breakJackpot(grid);
    wins = checkWins(grid);
  }
  return grid;
}

// Rompe eventuali 5-in-a-row (jackpot) riducendoli a 4, così la vincita
// resta sempre "normale". Scansiona tutte le paylines: se una ha count >= 5
// a partire dalla prima colonna, rompe le colonne 3 e 4 di quella payline.
export function breakJackpot(grid) {
  for (const pl of PAYLINES) {
    let anchor = null;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s !== WILD_ID && s !== SCATTER_ID) {
        anchor = s;
        break;
      }
    }
    if (!anchor) continue;
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s === anchor || s === WILD_ID) count++;
      else break;
    }
    if (count >= 5) {
      const breaker = SYMBOL_IDS.find((i) => i !== anchor) || anchor;
      grid[3][pl[3]] = breaker;
      grid[4][pl[4]] = breaker;
    }
  }
}

// Forza 3-4 simboli uguali sulla payline centrale per garantire una win.
export function engineerWin(grid) {
  const pl = PAYLINES[0];
  const lang = SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
  // 3 di base sulle prime 3 colonne della payline centrale (count=3).
  for (let c = 0; c <= 2; c++) grid[c][pl[c]] = lang;
  // Spezza esplicitamente le colonne 3-4 sulla payline centrale con un simbolo
  // DIVERSO: altrimenti un valore già presente nella griglia di partenza
  // potrebbe allinearsi e chiudere un 5-in-a-row (jackpot involontario).
  const breaker = SYMBOL_IDS.find((i) => i !== lang) || lang;
  grid[3][pl[3]] = breaker;
  grid[4][pl[4]] = breaker;
}

// ─── Game logic ──────────────────────────────────────────────────────────────
export function checkWins(grid) {
  const wins = [];
  for (let p = 0; p < PAYLINES.length; p++) {
    const pl = PAYLINES[p];

    // SCATTER in qualsiasi posizione sulla payline: nessuna win possibile
    for (let c = 0; c < COLS; c++) {
      if (grid[c][pl[c]] === SCATTER_ID) {
        continue;
      }
    }

    // Trova l'anchor: primo simbolo non-WILD e non-SCATTER
    let anchor = null;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s !== WILD_ID && s !== SCATTER_ID) {
        anchor = s;
        break;
      }
    }

    // Se non c'è anchor e il primo è WILD, usiamo WILD come anchor
    if (!anchor) {
      if (grid[0][pl[0]] === WILD_ID) anchor = WILD_ID;
      else continue; // Tutti WILD/SCATTER o vuoto → nessuna win
    }

    // Conta simboli che sono anchor O WILD (se anchor è SCATTER, WILD non conta)
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];

      // Se l'anchor è WILD, conta solo WILD (non simboli reali)
      if (anchor === WILD_ID && s === WILD_ID) {
        count++;
      }
      // Se l'anchor è un simbolo reale, conta anchor O WILD
      else if (anchor !== WILD_ID && anchor !== SCATTER_ID && anchor !== null) {
        if (s === anchor || s === WILD_ID) {
          count++;
        } else {
          // Simbolo che non è anchor né WILD → interrompi
          break;
        }
      }
      // Se l'anchor è SCATTER o null, o incontra SCATTER → interrompi
      else {
        break;
      }
    }

    if (count >= 3) {
      wins.push({
        payline: p,
        count,
        symbol: anchor,
        positions: Array.from({ length: count }, (_, c) => ({ c, r: pl[c] })),
        color: PL_COLORS[p],
      });
    }
  }
  return wins;
}

export function countScatters(grid) {
  const pos = [];
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      if (grid[c][r] === SCATTER_ID) pos.push({ c, r });
  return pos;
}

export function winningLangId(wins) {
  let best = null;
  for (const w of wins) {
    if (w.symbol === WILD_ID || w.symbol === SCATTER_ID) continue;
    if (!best || w.count > best.count) best = w;
  }
  if (best) return best.symbol;
  for (const w of wins) if (w.symbol !== SCATTER_ID) return w.symbol;
  return null;
}

// ─── Word wrap ───────────────────────────────────────────────────────────────
export function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur ? cur + ' ' : '') + w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
