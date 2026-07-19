// Contract test sull'header di autorizzazione GitHub (Miglioramento #1, ISSUES.md).
//
// Obiettivo: asserire che OGNI fetch verso https://api.github.com usi
// `Authorization: Bearer <token>` e che NON compaiano mai forme degenerate
// tipo `Authorization: *** `, `Basic `, o header vuoto/senza "Bearer".
//
// Questo copre eventuali regressioni del tipo ISSUE-16 (header duplicati /
// divergenti tra repos.js / image.js / health.js / github.js) e i falsi
// positivi da output redatto (`***`). Intercettiamo global.fetch e ispezioniamo
// gli header di ogni chiamata a api.github.com, così il test è indipendente
// dalla sorgente esatta dell'header (ghHeaders vs inline) e dal codice che chiama.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock di kv.js: niente Redis in test, così i path prendono il ramo GitHub.
vi.mock('../api/_lib/kv.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvEnabled: false,
}));

// Mock di github.js: timeout corto (non toccato da questo test, ma coerente
// con gli altri test del repo).
vi.mock('../api/_lib/github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, GITHUB_API_TIMEOUT_MS: 60 };
});

// ── Helper: response mock compatibile con logRateLimit (headers.get) ────────
function makeGithubResponse(body = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => {
        const map = {
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        };
        return map[String(name).toLowerCase()] ?? null;
      },
    },
    json: async () => body,
  };
}

// ── Helper: fetch intercettore che registra le chiamate a api.github.com ────
function installGithubFetchSpy() {
  const calls = [];
  const spy = vi.fn(async (url, opts = {}) => {
    if (String(url).includes('api.github.com')) {
      const h = opts.headers || {};
      const auth =
        h.Authorization ??
        (h.get && typeof h.get === 'function' ? h.get('Authorization') : undefined);
      calls.push({ url: String(url), method: opts.method || 'GET', auth });
    }
    // Risposta generica valida per qualsiasi endpoint GitHub.
    if (String(url).includes('/contents/')) {
      return makeGithubResponse({
        content: Buffer.from('<svg></svg>').toString('base64'),
        sha: 'abc123',
      });
    }
    if (String(url).includes('/repos?')) {
      // Lista repo per la refresh cache di repos.js (si aspetta un array .filter).
      return makeGithubResponse([
        {
          name: 'pythonrepo',
          html_url: 'https://github.com/owner/pythonrepo',
          fork: false,
          archived: false,
          languages_url: 'https://api.github.com/repos/owner/pythonrepo/languages',
          topics: [],
        },
      ]);
    }
    if (String(url).includes('/languages')) {
      return makeGithubResponse({ Python: 100 });
    }
    return makeGithubResponse({});
  });
  global.fetch = spy;
  return { spy, calls };
}

// Asserisce che un singolo valore Authorization sia un Bearer valido.
function assertValidBearer(auth, ctx) {
  expect(auth, `Authorization mancante su ${ctx}`).toBeDefined();
  expect(
    auth,
    `Authorization su ${ctx} non è una stringa: ${JSON.stringify(auth)}`
  ).toEqual(expect.any(String));
  expect(
    auth.startsWith('Bearer '),
    `Authorization su ${ctx} non inizia con "Bearer ": "${auth}"`
  ).toBe(true);
  const tokenPart = auth.slice('Bearer '.length);
  expect(
    tokenPart.length,
    `Bearer token vuoto su ${ctx}: "${auth}"`
  ).toBeGreaterThan(0);
  expect(
    auth,
    `Authorization su ${ctx} contiene il placeholder "***" (regressione ISSUE-16): "${auth}"`
  ).not.toContain('***');
  expect(
    auth.startsWith('Basic '),
    `Authorization su ${ctx} usa Basic invece di Bearer: "${auth}"`
  ).toBe(false);
}

describe('Contract test header — ghHeaders (sorgente unica condivisa)', () => {
  it('ghHeaders produce sempre Authorization: Bearer <token>', async () => {
    const { ghHeaders } = await import('../api/_lib/github.js');
    const h = ghHeaders('mio-token-segreto');
    expect(h.Authorization).toBe('Bearer mio-token-segreto');
    expect(h.Authorization).not.toContain('***');
    // default Accept / User-Agent
    expect(h.Accept).toBe('application/vnd.github.v3+json');
    expect(h['User-Agent']).toBe('GithubSlotMachine');
  });

  it('ghHeaders senza token NON mette Authorization', async () => {
    const { ghHeaders } = await import('../api/_lib/github.js');
    const h = ghHeaders('');
    expect(h.Authorization).toBeUndefined();
  });

  it('ghHeaders rispetta gli override accept/userAgent (health.js)', async () => {
    const { ghHeaders } = await import('../api/_lib/github.js');
    const h = ghHeaders('t', {
      accept: 'application/vnd.github+json',
      userAgent: 'gsm-health',
    });
    expect(h.Authorization).toBe('Bearer t');
    expect(h.Accept).toBe('application/vnd.github+json');
    expect(h['User-Agent']).toBe('gsm-health');
  });
});

describe('Contract test header — ogni fetch a api.github.com usa Bearer', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('ghGet invia Authorization: Bearer', async () => {
    const { ghGet } = await import('../api/_lib/github.js');
    const { calls } = installGithubFetchSpy();
    await ghGet('tok-123', 'owner', 'repo', 'slot.svg').catch(() => {});
    const ghCalls = calls.filter((c) => c.url.includes('api.github.com'));
    expect(ghCalls.length).toBeGreaterThan(0);
    ghCalls.forEach((c) => assertValidBearer(c.auth, `ghGet ${c.url}`));
  });

  it('ghPut invia Authorization: Bearer', async () => {
    const { ghPut } = await import('../api/_lib/github.js');
    const { calls } = installGithubFetchSpy();
    await ghPut('tok-456', 'owner', 'repo', 'slot.svg', '<svg/>', null, 'msg').catch(
      () => {}
    );
    const ghCalls = calls.filter((c) => c.url.includes('api.github.com'));
    expect(ghCalls.length).toBeGreaterThan(0);
    ghCalls.forEach((c) => assertValidBearer(c.auth, `ghPut ${c.url}`));
  });

  it('getRepoForLanguage (repos.js) invia Authorization: Bearer', async () => {
    vi.resetModules();
    const repos = await import('../api/_lib/repos.js');
    const { calls } = installGithubFetchSpy();
    await repos
      .getRepoForLanguage('tok-repos', 'owner', { id: 'python' }, [
        { id: 'python', githubLang: 'Python' },
      ])
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 120)); // lascia girare la refresh in bg
    const ghCalls = calls.filter((c) => c.url.includes('api.github.com'));
    expect(ghCalls.length).toBeGreaterThan(0);
    ghCalls.forEach((c) => assertValidBearer(c.auth, `repos.js ${c.url}`));
  });

  it('handler image.js invia Authorization: Bearer', async () => {
    vi.resetModules();
    const handler = (await import('../api/image.js')).default;
    const { calls } = installGithubFetchSpy();
    process.env.GITHUB_PAT = 'tok-image';
    const res = { setHeader: vi.fn(), status: vi.fn(() => res), send: vi.fn() };
    await handler({ method: 'GET', query: {} }, res);
    const ghCalls = calls.filter((c) => c.url.includes('api.github.com'));
    expect(ghCalls.length).toBeGreaterThan(0);
    ghCalls.forEach((c) => assertValidBearer(c.auth, `image.js ${c.url}`));
  });

  it('handler health.js invia Authorization: Bearer (con override accept/UA)', async () => {
    vi.resetModules();
    const handler = (await import('../api/health.js')).default;
    const { calls } = installGithubFetchSpy();
    process.env.GITHUB_PAT = 'tok-health';
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(() => res),
      send: vi.fn(),
    };
    await handler({ method: 'GET', query: {} }, res);
    const ghCalls = calls.filter((c) => c.url.includes('api.github.com'));
    expect(ghCalls.length).toBeGreaterThan(0);
    ghCalls.forEach((c) => assertValidBearer(c.auth, `health.js ${c.url}`));
    // health.js passa accept custom via ghHeaders
    expect(ghCalls[0].url).toContain('readme');
  });

  it('handler ratelimit-status.js invia Authorization: Bearer', async () => {
    vi.resetModules();
    const handler = (await import('../api/ratelimit-status.js')).default;
    const { calls } = installGithubFetchSpy();
    process.env.GITHUB_PAT = 'tok-rl';
    const res = await handler({ method: 'GET', query: {} });
    expect(res.status).toBe(200);
    const ghCalls = calls.filter((c) => c.url.includes('api.github.com'));
    expect(ghCalls.length).toBeGreaterThan(0);
    ghCalls.forEach((c) => assertValidBearer(c.auth, `ratelimit-status.js ${c.url}`));
  });
});

describe('Contract test header — NON regressione su ghHeaders unica', () => {
  it('resta un’unica definizione di ghHeaders nel repo (ISSUE-16)', async () => {
    const { execSync } = await import('node:child_process');
    const out = execSync(
      "grep -rn 'function ghHeaders' api/ 2>/dev/null || true"
    )
      .toString()
      .trim();
    const count = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean).length;
    expect(count).toBe(1);
  });
});
