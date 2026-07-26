// Test suite for the GithubSlotMachine game logic.
//
// These tests import the PURE functions exported from api/spin.js
// (checkWins, generateGrid, engineerWin, countScatters, winningLangId, wrap)
// plus the grid config constants.
//
// NOTA: engineerNearMiss e detectNearMiss sono stati RIMOSSI (near-miss
// disattivato). engineerWin ora NON produce MAI un 5-in-a-row (jackpot
// rimosso) — le vincite forzate sono sempre 3 o 4.
//
// They do NOT touch the network, GitHub, Upstash or any env var — the game
// logic is fully deterministic given a grid, so we can unit-test it in
// isolation. A seeded RNG (mulberry32) is used where randomness is needed so
// the suite is reproducible.
//
// Run with:  npm test          (single run)
//            npm run test:watch (re-run on change)

import { describe, it, expect } from 'vitest';
import {
  checkWins,
  countScatters,
  generateGrid,
  engineerWin,
  winningLangId,
  wrap,
  COLS,
  ROWS,
  PAYLINES,
  SYMBOL_IDS,
  WILD_ID,
  SCATTER_ID,
} from '../api/spin.js';

// ─── Helpers ─────────────────────────────────────────────────────────────
// Deterministic PRNG so the tests don't flap between runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A grid full of one symbol — used as a mutable base for the positive tests.
function filledGrid(sym = 'c') {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = sym;
  }
  return g;
}

// Build a random grid that has NO win and NO scatter on it. Rejection-sampled
// so the engineer* tests start from a clean (non-winning) board.
function randomNoWinGrid(rng) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const g = [];
    for (let c = 0; c < COLS; c++) {
      g[c] = [];
      for (let r = 0; r < ROWS; r++) {
        g[c][r] = SYMBOL_IDS[(rng() * SYMBOL_IDS.length) | 0];
      }
    }
    if (checkWins(g).length === 0 && countScatters(g).length === 0) return g;
  }
  throw new Error('randomNoWinGrid: could not build a clean grid');
}

// ─── Shape ──────────────────────────────────────────────────────────────────
describe('grid shape', () => {
  it('generateGrid returns a COLS x ROWS matrix', () => {
    const g = generateGrid();
    expect(g.length).toBe(COLS);
    for (const col of g) expect(col.length).toBe(ROWS);
  });

  it('every cell is a known symbol id', () => {
    const g = generateGrid();
    const known = new Set([...SYMBOL_IDS, WILD_ID, SCATTER_ID]);
    for (const col of g)
      for (const cell of col) expect(known.has(cell)).toBe(true);
  });
});

// ─── checkWins ──────────────────────────────────────────────────────────────
describe('checkWins', () => {
  it('detects 3-in-a-row on the center payline', () => {
    const g = filledGrid('c');
    for (let c = 0; c < COLS; c++) g[c][1] = 'cpp';
    const wins = checkWins(g);
    expect(wins.some((w) => w.count >= 3)).toBe(true);
  });

  it('detects a 5-in-a-row as a normal win (NOT a special jackpot)', () => {
    const g = filledGrid('cpp'); // all cells cpp → every payline is a 5x win
    const wins = checkWins(g);
    // È comunque una vincita valida (count===5), ma non c'è più alcun
    // concetto di "jackpot" a livello di game logic.
    expect(wins.some((w) => w.count === 5)).toBe(true);
  });

  it('returns no wins for a no-win grid', () => {
    const g = randomNoWinGrid(mulberry32(42));
    expect(checkWins(g).length).toBe(0);
  });

  it('WILD acts as a wildcard and matches the real anchor', () => {
    const g = filledGrid('c');
    g[0][1] = WILD_ID;
    g[1][1] = 'python';
    g[2][1] = WILD_ID;
    g[3][1] = 'python';
    g[4][1] = 'c';
    const wins = checkWins(g);
    expect(wins.some((w) => w.symbol === 'python' && w.count >= 3)).toBe(true);
  });

  it('SCATTER never counts as an anchor', () => {
    // Start from a clean board (no wins) so the only 3-in-a-row we add is the
    // scatter run — which must be ignored.
    const g = filledGrid('c');
    g[0][1] = 'python';
    g[1][1] = 'rust';
    g[2][1] = 'typescript';
    g[3][1] = 'c';
    g[4][1] = 'javascript';
    // Now overwrite a 3-run with SCATTER on a DIFFERENT payline (top row).
    g[0][0] = SCATTER_ID;
    g[1][0] = SCATTER_ID;
    g[2][0] = SCATTER_ID;
    expect(checkWins(g).some((w) => w.symbol === SCATTER_ID)).toBe(false);
  });

  it('detects wins on every payline geometry (top/bottom/V/Λ/center)', () => {
    // center
    let g = filledGrid('c');
    for (let c = 0; c < COLS; c++) g[c][1] = 'javascript';
    expect(checkWins(g).some((w) => w.payline === 0 && w.count >= 3)).toBe(
      true
    );

    // top
    g = filledGrid('c');
    for (let c = 0; c < COLS; c++) g[c][0] = 'python';
    expect(checkWins(g).some((w) => w.payline === 1 && w.count >= 3)).toBe(
      true
    );

    // bottom
    g = filledGrid('c');
    for (let c = 0; c < COLS; c++) g[c][2] = 'typescript';
    expect(checkWins(g).some((w) => w.payline === 2 && w.count >= 3)).toBe(
      true
    );

    // V (rows 0,1,2,1,0)
    g = filledGrid('c');
    g[0][0] = 'cpp';
    g[1][1] = 'cpp';
    g[2][2] = 'cpp';
    g[3][1] = 'cpp';
    g[4][0] = 'cpp';
    expect(checkWins(g).some((w) => w.payline === 3 && w.count >= 3)).toBe(
      true
    );

    // Λ (rows 2,1,0,1,2)
    g = filledGrid('c');
    g[0][2] = 'react';
    g[1][1] = 'react';
    g[2][0] = 'react';
    g[3][1] = 'react';
    g[4][2] = 'react';
    expect(checkWins(g).some((w) => w.payline === 4 && w.count >= 3)).toBe(
      true
    );
  });
});

// ─── countScatters ──────────────────────────────────────────────────────────
describe('countScatters', () => {
  it('counts scatter positions', () => {
    const g = filledGrid('c');
    g[0][0] = SCATTER_ID;
    g[2][2] = SCATTER_ID;
    expect(countScatters(g).length).toBe(2);
  });

  it('returns 0 when there are no scatters', () => {
    const g = filledGrid('c');
    expect(countScatters(g).length).toBe(0);
  });
});

// ─── engineerWin ────────────────────────────────────────────────────────────
describe('engineerWin', () => {
  it('always produces a win of 3 or 4 (never 5) on the center payline', () => {
    for (let i = 0; i < 300; i++) {
      const g = randomNoWinGrid(mulberry32(i + 1));
      engineerWin(g);
      const wins = checkWins(g);
      expect(wins.length).toBeGreaterThan(0);
      const best = wins.reduce((a, b) => (b.count > a.count ? b : a));
      expect(best.count).toBeGreaterThanOrEqual(3);
      expect(best.count).toBeLessThanOrEqual(4);
      // Il jackpot (5-in-a-row) è stato rimosso: engineerWin NON deve
      // mai produrre una vincita di 5.
      expect(wins.every((w) => w.count < 5)).toBe(true);
    }
  });
});

// ─── winningLangId ──────────────────────────────────────────────────────────
describe('winningLangId', () => {
  it('prefers the non-wild winning symbol', () => {
    expect(
      winningLangId([
        { symbol: 'python', count: 3 },
        { symbol: WILD_ID, count: 3 },
      ])
    ).toBe('python');
  });

  it('falls back to WILD only if that is the best win', () => {
    expect(winningLangId([{ symbol: WILD_ID, count: 4 }])).toBe(WILD_ID);
  });

  it('returns null for an empty win list', () => {
    expect(winningLangId([])).toBeNull();
  });
});

// ─── wrap ───────────────────────────────────────────────────────────────────
describe('wrap', () => {
  it('wraps text to maxChars per line and preserves content', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const lines = wrap(text, 12);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
    expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(text);
  });

  it('keeps a single over-long word on its own line', () => {
    const lines = wrap('supercalifragilistic', 5);
    expect(lines.length).toBe(1);
  });

  it('returns an empty array for empty input', () => {
    expect(wrap('', 10)).toEqual([]);
  });
});
