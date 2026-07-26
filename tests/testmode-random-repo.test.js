// Test della MODALITÀ DI TEST (SLOT_TEST_RANDOM_REPO=1):
// verifica che in caso di VINCITA (lang presente) il link nel formato
// "check my work in <lang>: [repo](url)" venga scritto nel marker del README,
// anche quando il repo reale non è disponibile (cache fredda / <30% / nessun
// repo valido) — in quel caso getRandomRepo ritorna il fallback hardcoded.
// SU SPIN PERDENTI (lang null) il blocco resta vuoto, come in produzione.
import { describe, it, expect } from 'vitest';
import { updateReadmeMarkers } from '../api/_lib/github.js';

const START = '<!-- SLOT_LAST_WIN_START -->';
const END = '<!-- SLOT_LAST_WIN_END -->';
const baseReadme = `# Profilo\n${START}\nplaceholder\n${END}\n## Fine`;

describe('test-mode SLOT_TEST_RANDOM_REPO', () => {
  it('scrive il link in formato "check my work in" su vincita con repo forzato', () => {
    const lang = { name: 'C++' };
    // Simula il repoMatch forzato dal test-mode (pct=0, sotto la soglia 30%)
    const randomRepo = {
      name: 'BetterSpin',
      url: 'https://github.com/simrim96/BetterSpin',
      description: 'progetto test',
      stars: 0,
      pct: 0,
    };
    const out = updateReadmeMarkers(baseReadme, {}, lang, randomRepo, 1700000000000);
    expect(out).toContain(
      'check out this repo I wrote in C++'
    );
    expect(out).toContain('<a href="https://github.com/simrim96/BetterSpin">');
    expect(out).not.toContain('check my work in');
  });

  it('SU VINCITA con repo reale stellato mostra le stelle nel badge', () => {
    const lang = { name: 'C++' };
    const randomRepo = {
      name: 'BetterSpin',
      url: 'https://github.com/simrim96/BetterSpin',
      description: 'progetto test',
      stars: 128,
      pct: 0,
    };
    const out = updateReadmeMarkers(baseReadme, {}, lang, randomRepo, 1700000000000);
    expect(out).toContain('&amp;stars=128');
    expect(out).toContain('check out this repo I wrote in C++');
  });

  it('SU VINCITA con repo senza stelle (stars=0) il badge NON mostra il contatore', () => {
    const lang = { name: 'C++' };
    const randomRepo = {
      name: 'BetterSpin',
      url: 'https://github.com/simrim96/BetterSpin',
      description: 'progetto test',
      stars: 0,
      pct: 0,
    };
    const out = updateReadmeMarkers(baseReadme, {}, lang, randomRepo, 1700000000000);
    expect(out).not.toContain('★');
    expect(out).not.toContain('&stars=');
    expect(out).toContain('check out this repo I wrote in C++');
  });

  it('SU SPIN PERDENTE (lang null) il blocco resta vuoto anche con repoMatch', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      {},
      null,
      { name: 'Foo', url: 'https://github.com/simrim96/Foo' },
      1700000000000
    );
    expect(out).not.toContain('check out this repo');
    expect(out).not.toContain('](');
    expect(out).toContain(`${START}\n${END}`);
  });

  it('nessun doppio marker / nessun link quando repoMatch è null', () => {
    const out = updateReadmeMarkers(baseReadme, {}, { name: 'Rust' }, null, 1700000000000);
    expect(out).toContain(`${START}\n${END}`);
    expect(out).not.toContain('](');
  });
});
