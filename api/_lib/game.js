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

  // Near-miss organico: probabilità alta perché il rilevatore ora scansiona
  // tutte le paylines, ma forziamo comunque la geometria sulla payline centrale
  // per garantire visibilità.
  if (wins.length === 0 && scatCnt < 3 && Math.random() < 0.55) {
    engineerNearMiss(grid);
  }
  return grid;
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

// Unifica la generazione del near-miss con il rilevamento: dopo aver creato
// la geometria, verifichiamo che detectNearMiss la riconosca. Se no,
// rigeneriamo con un'ancora diversa. Questo elimina la fragilità da accoppiamento
// tra le due funzioni.
export function engineerNearMiss(grid) {
  const pl = PAYLINES[0];
  let anchor = grid[0][pl[0]];
  // Se l'ancora "naturale" è wild/scatter, sostituiamola con un linguaggio reale
  // — altrimenti detectNearMiss salterebbe il match e il near-miss non verrebbe
  // mai visualizzato.
  if (anchor === WILD_ID || anchor === SCATTER_ID) {
    anchor = SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
    grid[0][pl[0]] = anchor;
  }

  // Max 10 tentativi: se non riusciamo a creare un near-miss riconoscibile,
  // falliamo silenziosamente (chiama di nuovo generateGrid).
  for (let attempt = 0; attempt < 10; attempt++) {
    // Near-miss "shallow": 2 anchor consecutivi sulla payline centrale (count=2 →
    // NON è una win, che parte da 3) e poi un "break" con anchor adiacente nel
    // rullo successivo. 2 soli anchor garantiscono che engineerNearMiss generi
    // SEMPRE un near-miss e MAI una vittoria accidentale (il bug precedente
    // allineava 3-4 simboli, che checkWins leggeva come win vera).
    const matchLen = 2;
    for (let c = 1; c < matchLen; c++) grid[c][pl[c]] = anchor;
    if (matchLen >= COLS) continue;
    const others = SYMBOL_IDS.filter((i) => i !== anchor);
    if (others.length === 0) continue;
    // Rullo "di rottura" — quello che evidenziamo come near-miss.
    const breakCol = matchLen;
    grid[breakCol][pl[breakCol]] =
      others[Math.floor(Math.random() * others.length)];
    // Anchor adiacente nello stesso rullo → near-miss visivo.
    const adjR = pl[breakCol] > 0 ? pl[breakCol] - 1 : pl[breakCol] + 1;
    if (adjR >= 0 && adjR < ROWS) grid[breakCol][adjR] = anchor;

    // VERIFICA: rileggiamo il near-miss per assicurarci che sia riconoscibile.
    // Se detectNearMiss non lo trova, rigeneriamo con un'ancora diversa.
    const detected = detectNearMiss(grid, checkWins(grid));
    if (detected >= 0) return; // OK, near-miss riconosciuto!

    // Ripristiniamo la colonna di rottura per il prossimo tentativo.
    grid[breakCol][pl[breakCol]] = anchor;
    if (adjR >= 0 && adjR < ROWS) grid[breakCol][adjR] = anchor;
    // Cambia l'ancora per il prossimo tentativo.
    anchor = others[Math.floor(Math.random() * others.length)];
    grid[0][pl[0]] = anchor;
    for (let c = 1; c < matchLen; c++) grid[c][pl[c]] = anchor;
  }
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

export function detectNearMiss(grid, wins) {
  if (wins.length > 0) return -1;
  // Scansioniamo TUTTE le paylines, non solo quella centrale: qualsiasi
  // 2+ in fila con un anchor adiacente nel rullo successivo è un near-miss
  // visivamente significativo. Restituiamo il primo rullo "di rottura" trovato.
  for (let p = 0; p < PAYLINES.length; p++) {
    const pl = PAYLINES[p];
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
    if (count < 2 || count >= COLS) continue;
    const missCol = count;
    const missRow = pl[missCol];
    for (const adj of [missRow - 1, missRow + 1]) {
      if (adj >= 0 && adj < ROWS && grid[missCol][adj] === anchor)
        return missCol;
    }
  }
  return -1;
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
