// Test su api/_lib/github.js — solo le parti PURE (no rete):
//   • escapeRegex (anti-injection nei marker README)
//   • updateReadmeMarkers (il parsing/riscrittura dei marker nel profilo)
// ghGetJson/ghPut/saveSlotSvg/loadSlotSvg non sono testati qui (richiedono fetch/GitHub).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  escapeRegex,
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
    const repoMatch = {
      name: 'myrepo',
      url: 'https://github.com/x/myrepo',
      stars: 42,
    };
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
    const repoMatch = {
      name: 'myrepo',
      url: 'https://github.com/x/myrepo',
      stars: 'abc',
    };
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

  it('su vincita senza repoMatch scrive comunque il badge con link di fallback al profilo owner', () => {
    // FIX "contrario" (vincita senza pulsante): il repo lookup può fallire
    // (cache fredda, linguaggio <30%, nessun repo valido). Una vincita reale
    // non deve mai finire senza pulsante: il badge viene scritto comunque,
    // puntando al profilo dell'owner come fallback.
    const lang = { name: 'Rust' };
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 9, totalWins: 1 },
      lang,
      null,
      1700000000000,
      'simrim96'
    );
    expect(out).toContain('check out this repo I wrote in Rust');
    expect(out).toContain('<a href="https://github.com/simrim96">');
    expect(out).toContain('/api/badge?');
    expect(out).not.toContain('&amp;stars=');
    expect(out).not.toContain('Total community spins');
    expect(out).not.toContain('Last win:');
    // Il blocco tra i marker NON è vuoto: contiene il badge di fallback
    expect(out).not.toContain(`${START}\n${END}`);
  });

  it('senza repoMatch e senza vincita (lang null) il blocco resta vuoto', () => {
    const out = updateReadmeMarkers(
      baseReadme,
      { totalSpins: 9, totalWins: 1 },
      null,
      null,
      1700000000000
    );
    expect(out).not.toContain('check out this repo');
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

describe('ghPut: sha mancante (percorso KV) — GET-first', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pre-fetcha lo sha con una GET e poi fa UNA PUT (niente 422 garantito)', async () => {
    // Il percorso KV (loadSlotSvg/readState da Redis) non propaga lo sha
    // GitHub → ghPut parte senza sha. PRIMA partiva PUT senza sha → 422
    // garantito su file esistente → GET → PUT (tre round trip). ORA:
    // GET dello sha → UNA PUT. Stesso risultato, una round trip in meno.
    const fetchMock = vi
      .fn()
      // 1ª chiamata: GET (ghGetJson) per recuperare lo sha corrente
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          sha: 'abc123',
          content: Buffer.from('{}').toString('base64'),
        }),
      })
      // 2ª chiamata: PUT con lo sha → ok
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
      });

    vi.stubGlobal('fetch', fetchMock);

    const { ghPut } = await import('../api/_lib/github.js');
    await ghPut(
      'token',
      'owner',
      'repo',
      'state.json',
      '{}',
      null,
      '🎰 Update slot stats'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // La prima chiamata è una GET (niente PUT 422 inutile)
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined(); // GET di default
    // La PUT (2ª) deve includere lo sha recuperato
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.sha).toBe('abc123');
  });

  it('se il file non esiste (GET 404), PUT senza sha lo crea', async () => {
    const fetchMock = vi
      .fn()
      // 1ª: GET → 404 (file nuovo, nessuno sha da recuperare)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ message: 'Not Found' }),
      })
      // 2ª: PUT senza sha → crea il file → ok
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => null },
      });

    vi.stubGlobal('fetch', fetchMock);

    const { ghPut } = await import('../api/_lib/github.js');
    await ghPut(
      'token',
      'owner',
      'repo',
      'slot.svg',
      '<svg/>',
      null,
      '🎰 Update live slot'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.sha).toBeUndefined();
  });

  it('PUT con sha stale (409) → rifetcha lo sha e ritenta', async () => {
    // Con lo sha memoizzato in KV (gsm:slotSvg:sha), la PUT di backup parte
    // con sha: se GitHub è stato modificato esternamente → 409 → GET + retry.
    const fetchMock = vi
      .fn()
      // 1ª: PUT con sha stale → 409
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => null },
      })
      // 2ª: GET per lo sha fresco
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          sha: 'fresh123',
          content: Buffer.from('{}').toString('base64'),
        }),
      })
      // 3ª: PUT con sha fresco → ok
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
      });

    vi.stubGlobal('fetch', fetchMock);

    const { ghPut } = await import('../api/_lib/github.js');
    await ghPut(
      'token',
      'owner',
      'repo',
      'state.json',
      '{}',
      'stale-sha',
      '🎰 Update slot stats'
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(retryBody.sha).toBe('fresh123');
  });

  it('se lo sha non è recuperabile (GET 404 nel recovery 422), lancia', async () => {
    const fetchMock = vi
      .fn()
      // 1ª: GET pre-fetch → 404 (sha non recuperabile in partenza)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ message: 'Not Found' }),
      })
      // 2ª: PUT senza sha su file esistente → 422
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => null },
      })
      // 3ª: GET nel recovery 422 → fallisce di nuovo (404) → throw
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ message: 'Not Found' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { ghPut } = await import('../api/_lib/github.js');
    await expect(
      ghPut(
        'token',
        'owner',
        'repo',
        'state.json',
        '{}',
        null,
        '🎰 Update slot stats'
      )
    ).rejects.toThrow(/422/);
  });
});

describe('github.test.js', () => {
  it('test placeholder per future test su ghGetJson/ghPut', () => {
    expect(true).toBe(true);
  });
});
