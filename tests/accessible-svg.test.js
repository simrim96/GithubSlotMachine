// ISSUE-21 / M1 — il percorso reale dello spin (api/spin.js:240 chiama
// buildAccessibleSVG e lo scrive su KV / README / /api/image) DEVE produrre
// un SVG con accessibilità dinamica: aria-label che riflette l'esito dello
// spin, e riferimenti aria-labelledby/aria-describedby verso <title>/<desc>.
// Questo test blinda che l'SVG "servito" non sia un dead-end (come era prima
// di ISSUE-21) e che gli screen reader ricevano davvero il risultato.
import { describe, it, expect } from 'vitest';
import { buildAccessibleSVG } from '../api/_lib/svg-builder-accessible.js';
import {
  checkWins,
  detectNearMiss,
  winningLangId,
  COLS,
  ROWS,
  SYMBOL_IDS,
  SCATTER_ID,
} from '../api/_lib/game.js';
import { LANGUAGE_BY_ID } from '../api/_lib/languages.js';

// ─── Griglie deterministiche (stesse tecniche di svg.test.js) ───────────────
function emptyGrid() {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = SCATTER_ID;
  }
  return g;
}
function winGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c <= 2; c++) g[c][pl[c]] = langId;
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[3][pl[3]] = other;
  g[4][pl[4]] = other;
  return g;
}
function jackpotGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c < COLS; c++) g[c][pl[c]] = langId;
  return g;
}
function nearMissGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  g[0][pl[0]] = langId;
  g[1][pl[1]] = langId;
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[2][pl[2]] = other;
  g[2][pl[2] > 0 ? pl[2] - 1 : pl[2] + 1] = langId;
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

function build(grid, a, uid = 1) {
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

describe('buildAccessibleSVG — percorso reale accessibile (ISSUE-21)', () => {
  it('ha role="img" e i riferimenti ARIA collegati a title/desc', () => {
    const svg = build(winGrid(SYMBOL_IDS[0]), analyze(winGrid(SYMBOL_IDS[0])));
    expect(svg).toContain('role="img"');
    // estrai gli id referenziati
    const labelledby = svg.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedby = svg.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(labelledby).toBeTruthy();
    expect(describedby).toBeTruthy();
    // devono esistere gli elementi con quegli id
    expect(svg).toContain(`<title id="${labelledby}">`);
    expect(svg).toContain(`<desc id="${describedby}">`);
  });

  it('vittoria normale → aria-label "Vinci con <linguaggio>"', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = build(grid, analyze(grid));
    const ariaLabel = svg.match(/aria-label="([^"]*)"/)?.[1] || '';
    expect(/Vinci con/.test(ariaLabel)).toBe(true);
    expect(svg).toContain('<title');
    expect(svg).toContain('Vincita');
  });

  it('jackpot → aria-label "Jackpot!"', () => {
    const grid = jackpotGrid(SYMBOL_IDS[0]);
    const svg = build(grid, analyze(grid));
    const ariaLabel = svg.match(/aria-label="([^"]*)"/)?.[1] || '';
    expect(/Jackpot!/.test(ariaLabel)).toBe(true);
  });

  it('perdita → aria-label "Nessun vincitore questa volta."', () => {
    const grid = emptyGrid();
    const svg = build(grid, analyze(grid));
    const ariaLabel = svg.match(/aria-label="([^"]*)"/)?.[1] || '';
    expect(/Nessun vincitore questa volta\./.test(ariaLabel)).toBe(true);
  });

  it('near-miss → aria-label "Quasi una vincita!"', () => {
    const grid = nearMissGrid(SYMBOL_IDS[0]);
    const svg = build(grid, analyze(grid));
    const ariaLabel = svg.match(/aria-label="([^"]*)"/)?.[1] || '';
    expect(/Quasi una vincita!/.test(ariaLabel)).toBe(true);
  });

  it("l'aria-label riporta i totali girate/vincite", () => {
    const svg = build(winGrid(SYMBOL_IDS[0]), analyze(winGrid(SYMBOL_IDS[0])));
    const ariaLabel = svg.match(/aria-label="([^"]*)"/)?.[1] || '';
    expect(/Totali:.*girate,.*vincite/.test(ariaLabel)).toBe(true);
  });

  it('gli id ARIA sono univoci per uid diversi (no collisioni)', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const a = analyze(grid);
    const svg1 = build(grid, a, 111);
    const svg2 = build(grid, a, 222);
    const id1 = svg1.match(/aria-labelledby="([^"]+)"/)?.[1];
    const id2 = svg2.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id1).not.toBe(id2);
    expect(svg1).toContain(`id="${id1}"`);
    expect(svg2).toContain(`id="${id2}"`);
  });
});
