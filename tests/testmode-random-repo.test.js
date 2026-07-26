// Test della MODALITÀ DI TEST (SLOT_TEST_RANDOM_REPO=1):
// verifica che in assenza di vincita (winningLang null / repoMatch null)
// il link a un repo casuale venga scritto nel marker del README, anche
// quando la percentuale del linguaggio sarebbe <30% (test-mode bypassa il filtro).
import { describe, it, expect } from 'vitest';
import { updateReadmeMarkers } from '../api/_lib/github.js';

const START = '<!-- SLOT_LAST_WIN_START -->';
const END = '<!-- SLOT_LAST_WIN_END -->';
const baseReadme = `# Profilo\n${START}\nplaceholder\n${END}\n## Fine`;

describe('test-mode SLOT_TEST_RANDOM_REPO', () => {
  it('scrive il link anche senza winningLang (link forzato casuale)', () => {
    // Simula il repoMatch forzato dal test-mode (pct=0, sotto la soglia 30%)
    const randomRepo = {
      name: 'BetterSpin',
      url: 'https://github.com/simrim96/BetterSpin',
      description: 'progetto test',
      stars: 0,
      pct: 0,
    };
    const out = updateReadmeMarkers(baseReadme, {}, null, randomRepo);
    expect(out).toContain('[BetterSpin](https://github.com/simrim96/BetterSpin)');
  });

  it('il link compare in README anche con repoMatch a <30% (bypass filtro test)', () => {
    const lowPctRepo = {
      name: 'Foo',
      url: 'https://github.com/simrim96/Foo',
      pct: 0.05,
    };
    const out = updateReadmeMarkers(baseReadme, {}, null, lowPctRepo);
    expect(out).toContain('[Foo](https://github.com/simrim96/Foo)');
  });

  it('nessun doppio marker / nessun link quando repoMatch è null', () => {
    const out = updateReadmeMarkers(baseReadme, {}, null, null);
    expect(out).toContain(`${START}\n${END}`);
    expect(out).not.toContain('](');
  });
});
