// Test sulla generazione SVG (buildSVG) — verifica FORMA e struttura, non i
// valori casuali dei filler/coins. Usa griglie costruite a mano per coprire
// i casi win / no-win.
// NOTA: jackpot e near-miss sono stati RIMOSSI (su richiesta). Ogni
// vincita è "normale", il rullo gira normalmente.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSVG, clearCache } from '../api/_lib/svg-builder.js';
import {
  checkWins,
  COLS,
  ROWS,
  SYMBOL_IDS,
  SCATTER_ID,
} from '../api/_lib/game.js';

// Griglia vuota (tutti scatter) — nessuna win.
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

const state = { totalSpins: 42, totalWins: 7, lastWin: null };
const winningLang = {
  id: SYMBOL_IDS[0],
  name: 'Python',
  accent: '#3776ab',
  githubLang: 'Python',
};
const fact = { en: 'Fact about Python', it: 'Fatto su Python' };
// repoMatch NON viene più passato alla buildSVG: il link alla repo vive
// esclusivamente nel README del profilo (github.js), non nell'SVG.
const repoMatch = {
  name: 'myproj',
  url: 'https://github.com/simrim96/myproj',
  pct: 0.6,
  description: 'd',
};

describe('buildSVG — forma', () => {
  beforeEach(() => {
    clearCache();
  });

  it('restituisce un <svg> ben formato', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    // L'SVG ha un preamble XML prima del tag <svg>
    expect(svg.match(/<\?xml[^?]*\?>/)).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('dichiara le dimensioni 600x624', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    expect(svg).toContain('width="600"');
    expect(svg).toContain('height="624"');
  });

  it('contiene i 5 rulli (clip-path cp1c0..4)', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    for (let c = 0; c < COLS; c++) expect(svg).toContain(`cp1c${c}`);
  });

  it('non lascia undefined nel markup', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    expect(svg).not.toContain('undefined');
  });
});

describe('buildSVG — casi di gioco', () => {
  beforeEach(() => {
    clearCache();
  });

  it('win: mostra la payline vincente e il pannello linguaggio', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    expect(checkWins(grid).length).toBeGreaterThan(0);
    const svg = buildSVG({ grid, uid: 2, state, winningLang, fact });
    expect(svg).toContain('Python WIN!');
    expect(svg).toContain('Python'); // paytable language name
    // NESSUN overlay jackpot
    expect(svg).not.toContain('JACKPOT');
  });

  it('no-win: messaggio generico (nessun near-miss)', () => {
    const grid = emptyGrid();
    const svg = buildSVG({
      grid,
      uid: 5,
      state,
      winningLang: null,
      fact,
    });
    expect(svg).toContain('Try again, better luck next time!');
    // NESSUN messaggio near-miss
    expect(svg).not.toContain('So close');
    expect(svg).not.toContain('JACKPOT');
    // NESSUNA animazione near-miss (nm shine)
    expect(svg).not.toContain('nm5');
  });

  it('NON contiene alcun link/testo repo nell\'SVG (il link vive nel README)', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({
      grid,
      uid: 6,
      state,
      winningLang,
      fact,
      owner: 'octocat',
    });
    // Il link alla repo NON deve comparire mai nell'SVG (non è cliccabile).
    expect(svg).not.toContain('github.com/octocat/myproj');
    expect(svg).not.toContain('myproj');
    expect(svg).not.toContain('check my work in');
  });
});

describe('buildSVG — escape', () => {
  beforeEach(() => {
    clearCache();
  });

  it('escapa i caratteri pericolosi nei fatti', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({
      grid,
      uid: 7,
      state,
      winningLang,
      fact: { en: '<script>&"\'', it: 'x' },
      repoMatch,
    });
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});
