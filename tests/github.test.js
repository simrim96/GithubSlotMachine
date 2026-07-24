// Test su api/_lib/github.js — solo le parti PURE (no rete):
//   • escapeRegex / escapeMarkdown (anti-injection nei marker README)
//   • updateReadmeMarkers (il parsing/riscrittura dei marker nel profilo)
// ghGetJson/ghPut/saveSlotSvg/loadSlotSvg non sono testati qui (richiedono fetch/GitHub).
import { describe, it, expect } from 'vitest';
import {
  escapeRegex,
  escapeMarkdown,
  updateReadmeMarkers,
} from '../api/_lib/github.js';

describe('escapeRegex', () => {
  it('escapa i metacaratteri regex', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
    expect(escapeRegex('(x)+')).toBe('\\(x\\)\\+');
    expect(escapeRegex('[a-z]{1,3}')).toBe('\\[a-z\\]\\{1,3\\}');
  });
  it('escapa backslash e pipe', () => {
    expect(escapeRegex('a\\b|c')).toBe('a\\\\b\\|c');
  });
  it('non rompe stringhe normali', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });
});

describe('escapeMarkdown', () => {
  it('escapa * _ ` [ ]', () => {
    expect(escapeMarkdown('a*b_c`d[e]f')).toBe('a\\*b\\_c\\`d\\[e\\]f');
  });
  it('non rompe testo senza markdown', () => {
    expect(escapeMarkdown('Python è figo')).toBe('Python è figo');
  });
  it('protegge da injection nel blockquote del README', () => {
    const evil = '*_test_`[x]';
    const out = escapeMarkdown(evil);
    expect(out).toBe('\\*\\_test\\_\\`\\[x\\]');
  });
});

describe('updateReadmeMarkers', () => {
  const START = '<!-- SLOT_LAST_WIN_START -->';
  const END = '<!-- SLOT_LAST_WIN_END -->';
  const baseReadme = `# Titolo\n${START}\nplaceholder\n${END}\n## Altre sezioni`;

  it('ritorna il readme invariato se i marker non ci sono', () => {
    const r = '# nessun marker';
    expect(updateReadmeMarkers(r, {}, null, null, null)).toBe(r);
  });

  it('non duplica i marker (uno START/END soli)', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 1, totalWins: 0 },
      null,
      null,
      null
    );
    expect(out.split(START).length - 1).toBe(1);
    expect(out.split(END).length - 1).toBe(1);
  });

  it('scrive SOLO il link alla repo vincente (niente contatori/fact)', () => {
    const lang = { name: 'Python', githubLang: 'python' };
    const repoMatch = { name: 'myrepo', url: 'https://github.com/x/myrepo' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 50, totalWins: 3 },
      lang,
      repoMatch,
      { it: 'Fatto in Italia', en: 'Made in English' }
    );
    expect(out).toContain('[myrepo](https://github.com/x/myrepo)');
    // NESSUN contatore / "Last win" / funfact devono comparire
    expect(out).not.toContain('Total community spins');
    expect(out).not.toContain('Wins:');
    expect(out).not.toContain('Last win:');
    expect(out).not.toContain('Made in English');
    expect(out).not.toContain('Fatto in Italia');
  });

  it('senza repoMatch il blocco resta vuoto (nessun link, nessun testo)', () => {
    const lang = { name: 'Rust' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 9, totalWins: 1 },
      lang,
      null,
      { en: 'safe by default' }
    );
    expect(out).not.toContain('→ [');
    expect(out).not.toContain('[Rust]');
    expect(out).not.toContain('Total community spins');
    expect(out).not.toContain('Last win:');
    // Il blocco tra i marker è vuoto
    expect(out).toContain(`${START}\n${END}`);
  });

  it('ignora state.lastWin (scrive solo link da repoMatch)', () => {
    const state = {
      totalSpins: 100,
      totalWins: 10,
      lastWin: {
        langName: 'Go',
        repoName: 'goproj',
        repoUrl: 'https://github.com/x/goproj',
        fact: 'fast builds',
      },
    };
    const out = updateReadmeMarkers(baseReadme, state, null, null, null);
    expect(out).not.toContain('**Last win:**');
    expect(out).not.toContain('[goproj]');
  });

  it('non rompe la struttura del README (marker sempre bilanciati)', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 5, totalWins: 2 },
      { name: 'C' },
      { name: 'crepo', url: 'https://github.com/x/crepo' },
      { en: 'portable' }
    );
    const idxS = out.indexOf(START);
    const idxE = out.indexOf(END);
    expect(idxS).toBeGreaterThan(-1);
    expect(idxE).toBeGreaterThan(idxS);
    expect(out).toContain('## Altre sezioni');
    expect(out.indexOf('## Altre sezioni')).toBeGreaterThan(idxE);
  });
});

describe('github.test.js', () => {
  it('test placeholder per future test su ghGetJson/ghPut', () => {
    expect(true).toBe(true);
  });
});
