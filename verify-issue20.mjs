// Verifica ISSUE-20: buildAccessibleSVG riceve i flag di vittoria e l'aria-label
// riflette il risultato reale dello spin (come fa spin.js dopo il fix).
import { checkWins, detectNearMiss, winningLangId } from './api/_lib/game.js';
import { LANGUAGE_BY_ID, LANGUAGES } from './api/_lib/languages.js';
import { buildAccessibleSVG } from './api/_lib/svg-builder-accessible.js';

const S = LANGUAGES.map((l) => l.id);

function extractAriaLabel(svg) {
  const m = svg.match(/aria-label="([^"]*)"/);
  return m ? m[1] : null;
}

// Costruisce una griglia [col][row] con righe top/bottom "sicure" (nessun 3-in-row
// su nessuna payline) così solo la riga centrale (center) determina l'esito.
function makeGrid(center, overrides = []) {
  const top = [S[1], S[2], S[3], S[4], S[5]];    // row 0
  const bottom = [S[5], S[4], S[3], S[2], S[1]]; // row 2
  const g = [];
  for (let c = 0; c < 5; c++) g[c] = [top[c], center[c], bottom[c]];
  for (const [c, r, sym] of overrides) g[c][r] = sym;
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

function build(grid, a) {
  return buildAccessibleSVG({
    grid, uid: 1, state: { totalSpins: 10, totalWins: 3 },
    winningLang: a.winningLang, fact: { it: '', en: '' }, repoMatch: null,
    owner: 'simrim96', isWin: a.isWin, isJackpot: a.isJackpot, nearMissCol: a.nearMissCol,
  });
}

// Caso 1: VITTORIA NORMALE (3 simboli S0 sulla payline centrale)
const winGrid = makeGrid([S[0], S[0], S[0], S[7], S[3]]);
const a1 = analyze(winGrid);
const label1 = extractAriaLabel(build(winGrid, a1));

// Caso 2: JACKPOT (5 simboli S0 sulla payline centrale)
const jackpotGrid = makeGrid([S[0], S[0], S[0], S[0], S[0]]);
const a2 = analyze(jackpotGrid);
const label2 = extractAriaLabel(build(jackpotGrid, a2));

// Caso 3: PERDITA (nessuna vittoria, nessun near-miss)
const loseGrid = makeGrid([S[0], S[1], S[2], S[3], S[4]]);
const a3 = analyze(loseGrid);
const label3 = extractAriaLabel(build(loseGrid, a3));

// Caso 4: NEAR-MISS — 2 simboli uguali poi rottura, con anchor adiacente nel rullo successivo
const loseGridNM = makeGrid([S[0], S[0], S[1], S[3], S[4]], [[2, 0, S[0]]]);
const a4 = analyze(loseGridNM);
const label4 = extractAriaLabel(build(loseGridNM, a4));

const show = (n, a, label) => {
  console.log(`\n=== Caso ${n} ===`);
  console.log(`isWin=${a.isWin} isJackpot=${a.isJackpot} nearMissCol=${a.nearMissCol}`);
  console.log('aria-label:', label);
};
show(1, a1, label1);
show(2, a2, label2);
show(3, a3, label3);
show(4, a4, label4);

// ─── ASSERT ───
let ok = true;
function expect(cond, msg) {
  if (!cond) { ok = false; console.log('  ✗ FALLITO:', msg); }
  else console.log('  ✓', msg);
}

console.log('\n=== ASSERT ISSUE-20 ===');
expect(a1.isWin && !a1.isJackpot && /Vinci con/.test(label1), 'Caso 1 = vittoria normale → "Vinci con <linguaggio>"');
expect(a2.isWin && a2.isJackpot && /Jackpot!/.test(label2), 'Caso 2 = jackpot → "Jackpot!"');
expect(!a3.isWin && !a3.isJackpot && a3.nearMissCol < 0 && /Nessun vincitore/.test(label3), 'Caso 3 = perdita → "Nessun vincitore"');
expect(!a4.isWin && a4.nearMissCol >= 0 && /Quasi una vincita/.test(label4), 'Caso 4 = near-miss → "Quasi una vincita"');
expect(/role="img"/.test(build(winGrid, a1)), 'SVG accessibile ha role="img"');

console.log('\nRISULTATO:', ok ? 'PASS — ISSUE-20 RISOLTO' : 'FAIL — ISSUE-20 NON RISOLTO');
process.exit(ok ? 0 : 1);
