// Test su api/_lib/github.js — solo le parti PURE (no rete):
//   • escapeRegex / escapeMarkdown (anti-injection nei marker README)
//   • updateReadmeMarkers (il parsing/riscrittura dei marker nel profilo)
// ghGetJson/ghPut/saveSlotSvg/loadSlotSvg non sono testati qui (richiedono fetch/GitHub).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  escapeRegex,
  escapeMarkdown,
  updateReadmeMarkers,
  clearReadmeMarkers,
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

  it('scrive SOLO il badge cliccabile (img wrapper in <a>) verso la repo vincente, con le stelle', () => {
    const lang = { name: 'Python', githubLang: 'python' };
    const repoMatch = { name: 'myrepo', url: 'https://github.com/x/myrepo', stars: 42 };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 50, totalWins: 3 },
      lang,
      repoMatch,
      1700000000000
    );
    // Testo del badge + link cliccabile verso la repo (nessun markdown)
    expect(out).toContain('check out this repo I wrote in Python');
    expect(out).toContain('&amp;stars=42');
    expect(out).toContain('<a href="https://github.com/x/myrepo">');
    expect(out).toContain('<img');
    expect(out).toContain('/api/badge?');
    // NESSUN vecchio markdown "check my work in" né link [repo](url)
    expect(out).not.toContain('check my work in');
    expect(out).not.toContain('](');
    // NESSUN contatore / "Last win" / funfact devono comparire
    expect(out).not.toContain('Total community spins');
    expect(out).not.toContain('Wins:');
    expect(out).not.toContain('Last win:');
    expect(out).not.toContain('Made in English');
    expect(out).not.toContain('Fatto in Italia');
  });

  it('senza stelle (repoMatch.stars assente) il badge NON mostra il contatore', () => {
    const lang = { name: 'Python', githubLang: 'python' };
    const repoMatch = { name: 'myrepo', url: 'https://github.com/x/myrepo' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 50, totalWins: 3 },
      lang,
      repoMatch,
      1700000000000
    );
    expect(out).not.toContain('&stars=');
    expect(out).not.toContain('★');
    expect(out).toContain('check out this repo I wrote in Python');
  });

  it('stelle non numeriche vengono ignorate (badge senza contatore)', () => {
    const lang = { name: 'Python', githubLang: 'python' };
    const repoMatch = { name: 'myrepo', url: 'https://github.com/x/myrepo', stars: 'abc' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 50, totalWins: 3 },
      lang,
      repoMatch,
      1700000000000
    );
    expect(out).not.toContain('&stars=');
    expect(out).not.toContain('★');
  });

  it('senza vincita (lang null) il blocco resta vuoto anche con repoMatch', () => {
    const repoMatch = { name: 'myrepo', url: 'https://github.com/x/myrepo' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 9, totalWins: 0 },
      null,
      repoMatch,
      { en: 'safe by default' }
    );
    expect(out).not.toContain('check my work in');
    expect(out).not.toContain('[myrepo]');
    expect(out).toContain(`${START}\n${END}`);
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
    expect(out).not.toContain('check my work in');
    expect(out).not.toContain('[Rust]');
    expect(out).not.toContain('Total community spins');
    expect(out).not.toContain('Last win:');
    // Il blocco tra i marker è vuoto
    expect(out).toContain(`${START}\n${END}`);
  });

  it('ignora state.lastWin (scrive solo link da lang+repoMatch)', () => {
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
    expect(out).not.toContain('check my work in');
    expect(out).not.toContain('[goproj]');
  });

  it('non rompe la struttura del README (marker sempre bilanciati)', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 5, totalWins: 2 },
      { name: 'C' },
      { name: 'crepo', url: 'https://github.com/x/crepo', stars: 7 },
      { en: 'portable' }
    );
    const idxS = out.indexOf(START);
    const idxE = out.indexOf(END);
    expect(idxS).toBeGreaterThan(-1);
    expect(idxE).toBeGreaterThan(idxS);
    expect(out).toContain('check out this repo I wrote in C');
    expect(out).toContain('&amp;stars=7');
    expect(out).toContain('<a href="https://github.com/x/crepo">');
    expect(out).toContain('## Altre sezioni');
    expect(out.indexOf('## Altre sezioni')).toBeGreaterThan(idxE);
  });
});

describe('clearReadmeMarkers', () => {
  const START = '<!-- SLOT_LAST_WIN_START -->';
  const END = '<!-- SLOT_LAST_WIN_END -->';

  it('ritorna il readme invariato se i marker non ci sono', () => {
    const r = '# nessun marker';
    expect(clearReadmeMarkers(r)).toBe(r);
  });

  it('svuota il blocco tra i marker (badge della vittoria precedente rimosso)', () => {
    const filled = `${START}\n<a href="https://github.com/x/crepo"><img src="https://github-slot-machine.vercel.app/api/badge?lang=C" alt="check out this repo I wrote in C"/></a>\n${END}`;
    const out = clearReadmeMarkers(filled);
    expect(out).toBe(`${START}\n${END}`);
    expect(out).not.toContain('check my work in');
    expect(out).not.toContain('https out this repo');
    expect(out).not.toContain('https://github.com/x/crepo');
  });

  it('lascia intatto il resto del README', () => {
    const body = `## Slot\n${START}\n<a href="https://github.com/x/r"><img src="https://github-slot-machine.vercel.app/api/badge?lang=Rust" alt="check out this repo I wrote in Rust"/></a>\n${END}\n## Altre sezioni`;
    const out = clearReadmeMarkers(body);
    expect(out).toContain('## Slot');
    expect(out).toContain('## Altre sezioni');
    expect(out).toBe(`## Slot\n${START}\n${END}\n## Altre sezioni`);
  });
});

describe('ghPut: recovery 422 sha mancante (percorso KV)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rifetcha lo sha e ritenta quando PUT fallisce con 422 "sha wasn\'t supplied"', async () => {
    // Il percorso KV (readState da Redis) non propaga lo sha GitHub → ghPut
    // parte senza sha → GitHub risponde 422 per un file già esistente.
    // ghPut deve rifetchare lo sha corrente e ritentare una volta.
    const fetchMock = vi.fn()
      // 1ª chiamata: PUT senza sha → 422
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => null },
      })
      // 2ª chiamata: ghGetJson per recuperare lo sha
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ sha: 'abc123', content: Buffer.from('{}').toString('base64') }),
      })
      // 3ª chiamata: PUT con sha → ok
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
      });

    vi.stubGlobal('fetch', fetchMock);

    const { ghPut } = await import('../api/_lib/github.js');
    await ghPut('token', 'owner', 'repo', 'state.json', '{}', null, '🎰 Update slot stats');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // La 3ª chiamata (retry) deve includere lo sha recuperato
    const retryBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(retryBody.sha).toBe('abc123');
  });

  it('se lo sha non è recuperabile nemmeno col rifetch, lancia', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => null },
      })
      // ghGetJson fallisce (rete/404) → null
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ message: 'Not Found' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { ghPut } = await import('../api/_lib/github.js');
    await expect(
      ghPut('token', 'owner', 'repo', 'state.json', '{}', null, '🎰 Update slot stats')
    ).rejects.toThrow(/422/);
  });
});

describe('github.test.js', () => {
  it('test placeholder per future test su ghGetJson/ghPut', () => {
    expect(true).toBe(true);
  });
});
