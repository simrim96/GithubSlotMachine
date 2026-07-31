// Test sulla sanitizzazione SVG (ISSUE-25 / S3).
// Verifica che sanitizeSvg rimuova vettori di attacco anche se l'SVG fosse
// generato (in futuro) a partire da input utente, dato che /api/image e
// /api/lever servono con CORS wildcard `*` in contesti cross-origin.

import { describe, it, expect } from 'vitest';
import { sanitizeSvg, buildSVG, errorSVGString } from '../api/_lib/svg-builder.js';
import { SCATTER_ID } from '../api/_lib/languages.js';
import { COLS, ROWS } from '../api/_lib/game.js';

describe('sanitizeSvg — hardening ISSUE-25 / S3', () => {
  it('rimuove tag <script>', () => {
    const dirty = '<svg><script>alert(1)</script><rect/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
  });

  it('rimuove tag <foreignObject>', () => {
    const dirty =
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><p>hi</p></body></foreignObject></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('<foreignObject');
    expect(clean).not.toContain('<body');
  });

  it('rimuove attributi di evento on*', () => {
    const dirty = '<svg><rect onload="alert(1)" onclick="x()" onmouseover=\'y()\'/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/onload\s*=/i);
    expect(clean).not.toMatch(/onclick\s*=/i);
    expect(clean).not.toMatch(/onmouseover\s*=/i);
  });

  it('rimuove URI javascript: negli href', () => {
    const dirty = '<svg><a href="javascript:alert(1)">x</a></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('javascript:');
  });

  it('rimuove URI javascript: nei xlink:href', () => {
    const dirty = '<svg><use xlink:href="javascript:alert(1)"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('javascript:');
  });

  it('lascia intatto un SVG legittimo', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    expect(sanitizeSvg(ok)).toBe(ok);
  });

  it('non altera buildSVG/errorSVGString di produzione', () => {
    // griglia vuota (tutti scatter) come nei test di forma
    const grid = [];
    for (let c = 0; c < COLS; c++) {
      grid[c] = [];
      for (let r = 0; r < ROWS; r++) grid[c][r] = SCATTER_ID;
    }
    const built = buildSVG({
      grid,
      uid: 1,
      state: { totalSpins: 42, totalWins: 7, lastWin: null },
      winningLang: null,
      fact: null,
      repoMatch: null,
    });
    expect(built).toContain('<svg');
    expect(built).toContain('<?xml');
    expect(built).not.toContain('<script');
    const err = errorSVGString({ owner: 'simrim96', message: 'test' });
    expect(err).toContain('<svg');
    expect(err).not.toContain('<script');
  });
});
