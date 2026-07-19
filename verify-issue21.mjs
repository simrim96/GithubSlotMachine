// Verifica end-to-end ISSUE-21: l'SVG servito da spin.js (quello scritto su
// KV / README / /api/image) DEVE esporre accessibilità dinamica a screen
// reader. Ripercorre ESATTAMENTE la chiamata di spin.js:240 a buildAccessibleSVG.
import { buildAccessibleSVG } from './api/_lib/svg-builder-accessible.js';
import {
  checkWins,
  detectNearMiss,
  winningLangId,
  COLS,
  ROWS,
  SYMBOL_IDS,
  SCATTER_ID,
} from './api/_lib/game.js';
import { LANGUAGE_BY_ID } from './api/_lib/languages.js';

function emptyGrid() {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = SCATTER_ID;
  }
  return g;
}
const A = SYMBOL_IDS[0];
const B = SYMBOL_IDS.find((i) => i !== A) || A;

function winGrid(id) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c <= 2; c++) g[c][pl[c]] = id;
  g[3][pl[3]] = B;
  g[4][pl[4]] = B;
  return g;
}
function jackpotGrid(id) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c < COLS; c++) g[c][pl[c]] = id;
  return g;
}
function lossGrid() {
  return emptyGrid();
}
function nearMissGrid(id) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  g[0][pl[0]] = id; // 2 di fila sulla payline centrale
  g[1][pl[1]] = id;
  g[2][pl[2]] = B; // break sul rullo 2
  g[2][pl[2] > 0 ? pl[2] - 1 : pl[2] + 1] = id; // anchor adiacente => near-miss
  return g;
}

function analyze(grid) {
  const wins = checkWins(grid);
  const isWin = wins.length > 0;
  const isJackpot = wins.some((w) => w.count === 5);
  const nearMissCol = detectNearMiss(grid, wins);
  const winningLang = isWin ? LANGUAGE_BY_ID[winningLangId(wins)] : null;
  return { wins, isWin, isJackpot, nearMissCol, winningLang };
}

// La stessa firma usata da spin.js:240
function serve(grid, a, uid = 777) {
  return buildAccessibleSVG({
    grid,
    uid,
    state: { totalSpins: 10, totalWins: 3, lastWin: null },
    winningLang: a.winningLang,
    fact: { it: '', en: '' },
    repoMatch: null,
    owner: 'simrim96',
    isWin: a.isWin,
    isJackpot: a.isJackpot,
    nearMissCol: a.nearMissCol,
  });
}

function check(label, grid, expectLabel) {
  const a = analyze(grid);
  const svg = serve(grid, a);
  const root = svg.match(/<svg[^>]*>/)?.[0] || '';
  const labelledby = root.match(/aria-labelledby="([^"]+)"/)?.[1] || null;
  const describedby = root.match(/aria-describedby="([^"]+)"/)?.[1] || null;
  const ariaLabel = root.match(/aria-label="([^"]*)"/)?.[1] || '';
  const titleOk = labelledby && svg.includes(`<title id="${labelledby}">`);
  const descOk = describedby && svg.includes(`<desc id="${describedby}">`);
  const roleOk = /role="img"/.test(root);
  const labelOk = expectLabel.test(ariaLabel);
  const validSvg =
    (svg.startsWith('<?xml') || svg.startsWith('<svg')) &&
    svg.trimEnd().endsWith('</svg>');

  const pass =
    roleOk && labelledby && describedby && titleOk && descOk && labelOk && validSvg;
  console.log(`${pass ? '✅' : '❌'} ${label}`);
  console.log(`   role=img            : ${roleOk}`);
  console.log(`   aria-labelledby     : ${labelledby}  -> <title> esiste: ${titleOk}`);
  console.log(`   aria-describedby    : ${describedby}  -> <desc> esiste: ${descOk}`);
  console.log(`   aria-label dinamico : ${JSON.stringify(ariaLabel)}  (match atteso: ${labelOk})`);
  console.log(`   SVG valido standalone: ${validSvg}`);
  return pass;
}

let allPass = true;
allPass &= check('VITTORIA', winGrid(A), /Vinci con/);
allPass &= check('JACKPOT', jackpotGrid(A), /Jackpot!/);
allPass &= check('PERDITA', lossGrid(), /Nessun vincitore questa volta\./);
allPass &= check('NEAR-MISS', nearMissGrid(A), /Quasi una vincita!/);

console.log('\n' + (allPass ? 'RISULTATO: TUTTI GLI ESITI SERVONO SVG ACCESSIBILE ✅' : 'RISULTATO: FALLITO ❌'));
process.exit(allPass ? 0 : 1);
