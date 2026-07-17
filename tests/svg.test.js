// Test sulla generazione SVG (buildSVG) — verifica FORMA e struttura, non i
// valori casuali dei filler/coins. Usa griglie costruite a mano per coprire
// i casi win / near-miss / jackpot / no-win.
import { describe, it, expect } from 'vitest';
import { buildSVG } from '../api/_lib/svg-builder.js';
import { checkWins, detectNearMiss, COLS, ROWS, SYMBOL_IDS, SCATTER_ID } from '../api/_lib/game.js';

// Griglia vuota (tutti scatter) — nessuna win, nessun near-miss.
function emptyGrid() {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = SCATTER_ID;
  }
  return g;
}

// Forza 3 linguaggi uguali (count=3) sulla payline centrale → win garantita.
function winGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c <= 2; c++) g[c][pl[c]] = langId;
  // rompi colonne 3-4 con un simbolo diverso (no jackpot)
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[3][pl[3]] = other;
  g[4][pl[4]] = other;
  return g;
}

// 5-in-a-row sulla payline centrale → jackpot.
function jackpotGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c < COLS; c++) g[c][pl[c]] = langId;
  return g;
}

// 2 anchor + break con anchor adiacente → near-miss.
function nearMissGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  g[0][pl[0]] = langId;
  g[1][pl[1]] = langId;
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[2][pl[2]] = other;       // break col
  g[2][pl[2] > 0 ? pl[2] - 1 : pl[2] + 1] = langId; // anchor adiacente
  return g;
}

const state = { totalSpins: 42, totalWins: 7, lastWin: null };
const winningLang = { id: SYMBOL_IDS[0], name: 'Python', accent: '#3776ab', githubLang: 'Python' };
const fact = { en: 'Fact about Python', it: 'Fatto su Python' };
const repoMatch = { name: 'myproj', url: 'https://github.com/simrim96/myproj', pct: 0.6, description: 'd' };

describe('buildSVG — forma', () => {
  it('restituisce un <svg> ben formato', () => {
    const svg = buildSVG({ grid: emptyGrid(), uid: 1, state, winningLang: null, fact, repoMatch: null });
    // L'SVG ha un preamble XML prima del tag <svg>
    expect(svg.match(/<\?xml[^\?]*\?>/)).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('dichiara le dimensioni 600x624', () => {
    const svg = buildSVG({ grid: emptyGrid(), uid: 1, state, winningLang: null, fact, repoMatch: null });
    expect(svg).toContain('width="600"');
    expect(svg).toContain('height="624"');
  });

  it('contiene i 5 rulli (clip-path cp1c0..4)', () => {
    const svg = buildSVG({ grid: emptyGrid(), uid: 1, state, winningLang: null, fact, repoMatch: null });
    for (let c = 0; c < COLS; c++) expect(svg).toContain(`cp1c${c}`);
  });

  it('non lascia undefined nel markup', () => {
    const svg = buildSVG({ grid: emptyGrid(), uid: 1, state, winningLang: null, fact, repoMatch: null });
    expect(svg).not.toContain('undefined');
  });
});

describe('buildSVG — casi di gioco', () => {
  it('win: mostra la payline vincente e il pannello linguaggio', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    expect(checkWins(grid).length).toBeGreaterThan(0);
    const svg = buildSVG({ grid, uid: 2, state, winningLang, fact, repoMatch });
    expect(svg).toContain('Python WIN!');
    expect(svg).toContain('Python'); // paytable language name
  });

  it('jackpot: overlay JACKPOT presente', () => {
    const grid = jackpotGrid(SYMBOL_IDS[0]);
    const wins = checkWins(grid);
    expect(wins.some((w) => w.count === 5)).toBe(true);
    const svg = buildSVG({ grid, uid: 3, state, winningLang, fact, repoMatch });
    expect(svg).toContain('JACKPOT');
  });

  it('near-miss: evidenzia il rullo di rottura (nm shine)', () => {
    const grid = nearMissGrid(SYMBOL_IDS[0]);
    const wins = checkWins(grid);
    const nm = detectNearMiss(grid, wins);
    expect(nm).toBeGreaterThanOrEqual(0);
    const svg = buildSVG({ grid, uid: 4, state, winningLang: null, fact, repoMatch: null });
    expect(svg).toContain('So close'); // messaggio near-miss invece di Try again
    expect(svg).toContain('nm4');      // animazione near-miss
  });

  it('no-win / no-near-miss: messaggio generico', () => {
    const grid = emptyGrid();
    const svg = buildSVG({ grid, uid: 5, state, winningLang: null, fact, repoMatch: null });
    expect(svg).toContain('Try again, better luck next time!');
    expect(svg).not.toContain('JACKPOT');
  });

  it('owner parametrico finisce nel CTA del repo match', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({ grid, uid: 6, state, winningLang, fact, repoMatch, owner: 'octocat' });
    expect(svg).toContain('github.com/octocat/myproj');
  });
});

describe('buildSVG — escape', () => {
  it('escapa i caratteri pericolosi nei fatti', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({
      grid, uid: 7, state, winningLang,
      fact: { en: '<script>&"\'', it: 'x' }, repoMatch,
    });
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});
