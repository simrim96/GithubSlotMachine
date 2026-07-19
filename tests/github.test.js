// Test su api/_lib/github.js — solo le parti PURE (no rete):
//   • escapeRegex / escapeMarkdown (anti-injection nei marker README)
//   • updateReadmeMarkers (il parsing/riscrittura dei marker nel profilo)
// ghGet/ghPut/saveSlotSvg/loadSlotSvg non sono testati qui (richiedono fetch/GitHub).
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

  it('scrive i contatori totali (spins/wins) formattati', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 1234, totalWins: 7 },
      null,
      null,
      null
    );
    expect(out).toContain('**Total community spins:** `1,234`');
    expect(out).toContain('**Wins:** `7`');
    expect(out).toContain(START);
    expect(out).toContain(END);
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

  it('mostra win con repo (name + url) e fact EN/IT', () => {
    const lang = { name: 'Python', githubLang: 'python' };
    const repoMatch = { name: 'myrepo', url: 'https://github.com/x/myrepo' };
    const fact = { it: 'Fatto in Italia', en: 'Made in English' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 50, totalWins: 3 },
      lang,
      repoMatch,
      fact
    );
    expect(out).toContain(
      '**Last win:** `Python` → [myrepo](https://github.com/x/myrepo)'
    );
    expect(out).toContain('_Made in English_');
    expect(out).toContain('_Fatto in Italia_');
  });

  it('win senza repo pubblica mostra solo lingua + fact', () => {
    const lang = { name: 'Rust' };
    const fact = { en: 'safe by default' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 9, totalWins: 1 },
      lang,
      null,
      fact
    );
    expect(out).toContain('**Last win:** `Rust`');
    expect(out).not.toContain('→ [');
    expect(out).toContain('_safe by default_');
  });

  it('win da state.lastWin (retro-compat, senza lang/repoMatch)', () => {
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
    expect(out).toContain(
      '**Last win:** `Go` → [goproj](https://github.com/x/goproj)'
    );
    expect(out).toContain('_fast builds_');
  });

  it('fact come stringa singola (retro-compat)', () => {
    const lang = { name: 'Lua' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 2, totalWins: 1 },
      lang,
      null,
      'tiny and fast'
    );
    expect(out).toContain('_tiny and fast_');
  });

  it('escapa markdown pericoloso dentro il fact', () => {
    const lang = { name: 'JS' };
    const fact = { en: 'a*b_c`[x]' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 1, totalWins: 1 },
      lang,
      null,
      fact
    );
    expect(out).toContain('_a\\*b\\_c\\`\\[x\\]_');
    expect(out).not.toContain('[x]('); // nessun link iniettato
  });

  it('non rompe la struttura del README (marker sempre bilanciati)', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 5, totalWins: 2 },
      { name: 'C' },
      null,
      { en: 'portable' }
    );
    const idxS = out.indexOf(START);
    const idxE = out.indexOf(END);
    expect(idxS).toBeGreaterThan(-1);
    expect(idxE).toBeGreaterThan(idxS);
    expect(out).toContain('## Altre sezioni');
    // la sezione dopo END deve essere preservata integralmente
    expect(out.indexOf('## Altre sezioni')).toBeGreaterThan(idxE);
  });
});

describe('github.test.js', () => {
  it('test placeholder per future test su ghGet/ghPut', () => {
    expect(true).toBe(true);
  });
});
