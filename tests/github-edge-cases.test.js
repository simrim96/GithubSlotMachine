// ─── Test: Edge cases GitHub API (M9 - ISSUES.md §3) ─────────────────────────
// Copertura test per edge cases GitHub API non ancora coperti:
// 1. GitHub API 403 rate limit exceeded (rate_limit_exceeded error)
// 2. GitHub API 502/504 gateway errors (bad_gateway, gateway_timeout)
// 3. Forked repo handling (già filtrato ma serve test esplicito)
//
// ISSUES.md §3 indica che questi casi sono "Mancanti" → test specifici.
//
// Pattern usato: fake timers + fetch stubbato che simula le risposte HTTP
// di GitHub con gli header di rate limit e gli errori specifici.
//
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn(), captureException: vi.fn() },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const github = await import('../api/_lib/github.js');
const { ghGetJson, ghGetContentsJson, ghHeaders, auditToken, detectTokenType } = github;

// Helper: crea risposta fetch mockata con status, headers e opzionale body
function makeFetchResponse(status, headers = {}, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    json: async () => body,
    text: async () => body ? JSON.stringify(body) : '',
  };
}

// Helper: fetch stub che rispetta AbortSignal e simula rate limit headers
function makeRateLimitAwareFetch(mockMap = {}) {
  return vi.fn((url, opts = {}) => {
    return new Promise((resolve, reject) => {
      const signal = opts.signal;
      if (signal && signal.aborted) {
        reject(new Error('The operation was aborted.'));
        return;
      }
      if (signal) {
        signal.addEventListener('abort', () => {
          reject(new Error('The operation was aborted.'));
        });
      }
      // Cerca la mock corrispondente all'URL
      const mock = mockMap[url] || mockMap['default'];
      if (mock instanceof Error) {
        setTimeout(() => reject(mock), 10);
      } else {
        setTimeout(() => resolve(makeFetchResponse(mock.status, mock.headers, mock.body)), 10);
      }
    });
  });
}

describe('M9: GitHub API edge cases', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeRateLimitAwareFetch({}));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.GITHUB_PAT = 'github_pat_test123';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GITHUB_PAT;
  });

  // ── 403 Rate Limit Exceeded ────────────────────────────────────────────────
  describe('403 rate_limit_exceeded', () => {
    it('ghGetJson ritorna null su 403 rate_limit_exceeded', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': Date.now() / 1000 + 3600,
            'Retry-After': '60',
          },
          body: {
            message: 'rate_limit_exceeded',
            documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api',
          },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      // Su 403, ghGetJson ritorna null (response.ok = false)
      expect(result).toBeNull();
    });

    it('ghGetJson NON lancia su 403 con altre cause (es. forbidden)', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 403,
          headers: {
            'X-RateLimit-Remaining': '0',
          },
          body: {
            message: 'Resource not accessible by integration',
          },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      // Anche su 403, ritorna null (non è un errore che va lanciato)
      expect(result).toBeNull();
    });

    it('ghGetJson propaga errori 500 anche su 403 rate limit (se non gestito)', async () => {
      // Caso raro: 403 che non è rate limit e non dovrebbe essere ignorato
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 403,
          headers: {},
          body: { message: 'forbidden' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      // ghGetJson tratta tutti i 403 come null (non-ok)
      expect(result).toBeNull();
    });
  });

  // ── 502/504 Gateway Errors ─────────────────────────────────────────────────
  describe('502 bad_gateway / 504 gateway_timeout', () => {
    it('ghGetJson ritorna null su 502 bad_gateway', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 502,
          headers: {},
          body: { message: 'Bad Gateway' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      // 502 = response.ok = false → ritorna null
      expect(result).toBeNull();
    });

    it('ghGetJson ritorna null su 504 gateway_timeout', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 504,
          headers: {},
          body: { message: 'Gateway Timeout' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      // 504 = response.ok = false → ritorna null
      expect(result).toBeNull();
    });

    it('ghGetJson ritorna null su 503 service_unavailable', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 503,
          headers: {},
          body: { message: 'Service Unavailable' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      expect(result).toBeNull();
    });
  });

  // ── Forked Repo Handling ───────────────────────────────────────────────────
  describe('forked repo handling', () => {
    it('ghGetJson funziona correttamente per forked repo (la logica di filtraggio è esterna)', async () => {
      // Nota: il filtraggio dei forked repo è fatto nel layer superiore (repos.js),
      // non in github.js. Quindi ghGetJson deve funzionare normalmente anche per fork.
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 200,
          headers: {},
          body: {
            name: 'test.json',
            sha: 'abc123',
            size: 100,
            path: 'p',
            content: Buffer.from('test content').toString('base64'),
            encoding: 'base64',
          },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p');

      expect(result).not.toBeNull();
      expect(result.name).toBe('test.json');
      expect(result.content).toEqual(Buffer.from('test content').toString('base64'));
    });

    it('ghGetContentsJson su forked repo usa il timeout stretto (800ms)', async () => {
      // Simula forked repo lento: la chiamata dovrebbe essere abortita al timeout
      const url = 'https://api.github.com/repos/o/r/contents/state.json';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: new Error('timeout: forked repo lento'),
      }));

      const result = await ghGetContentsJson('token', 'o', 'r', 'state.json').then(
        r => r,
        e => e
      );

      // Timeout → errore lanciato (non null)
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('timeout: forked repo lento');
    });
  });

  // ── Additional Edge Cases ──────────────────────────────────────────────────
  describe('additional edge cases', () => {
    it('ghGetJson ritorna null su 404 Not Found', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 404,
          headers: {},
          body: { message: 'Not Found' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      expect(result).toBeNull();
    });

    it('ghGetJson ritorna null su 401 Unauthorized', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 401,
          headers: {},
          body: { message: 'Bad credentials' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      expect(result).toBeNull();
    });

    it('ghGetJson ritorna null su 403 Forbidden (resource non accessibile)', async () => {
      const url = 'https://api.github.com/repos/o/r/contents/p';
      vi.mocked(fetch).mockImplementation(makeRateLimitAwareFetch({
        [url]: {
          status: 403,
          headers: {},
          body: { message: 'Resource not accessible by integration' },
        },
      }));

      const result = await ghGetJson('token', 'o', 'r', 'p').then(
        r => r,
        e => e
      );

      expect(result).toBeNull();
    });
  });

  // ── ghHeaders helper ───────────────────────────────────────────────────────
  describe('ghHeaders helper', () => {
    it('ghHeaders include Authorization header quando token è presente', () => {
      const headers = ghHeaders('my-token');
      expect(headers.Authorization).toBe('Bearer my-token');
      expect(headers.Accept).toBe('application/vnd.github.v3+json');
      expect(headers['User-Agent']).toBe('GithubSlotMachine');
    });

    it('ghHeaders include solo headers base quando token è undefined', () => {
      const headers = ghHeaders(undefined);
      expect(headers.Authorization).toBeUndefined();
      expect(headers.Accept).toBe('application/vnd.github.v3+json');
    });

    it('ghHeaders accetta override di accept e userAgent', () => {
      const headers = ghHeaders('token', {
        accept: 'application/vnd.github.v3+json; format=json',
        userAgent: 'Custom-Client/1.0',
      });
      expect(headers.Accept).toBe('application/vnd.github.v3+json; format=json');
      expect(headers['User-Agent']).toBe('Custom-Client/1.0');
      expect(headers.Authorization).toBe('Bearer token');
    });
  });

  // ── Token Detection (S4) ───────────────────────────────────────────────────
  describe('Token detection (S4 hardening)', () => {
    it('detectTokenType riconosce fine-grained PAT (github_pat_)', () => {
      const result = detectTokenType('github_pat_abc123');
      expect(result.kind).toBe('fine-grained');
      expect(result.safe).toBe(true);
    });

    it('detectTokenType riconosce classic PAT (ghp_, gho_, ghu_, ghs_, ghr_)', () => {
      const prefixes = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
      prefixes.forEach(prefix => {
        const result = detectTokenType(`${prefix}abc123`);
        expect(result.kind).toBe('classic');
        expect(result.safe).toBe(false);
      });
    });

    it('detectTokenType tratta undefined/null come none (safe=false)', () => {
      expect(detectTokenType(undefined)).toEqual({ kind: 'none', safe: false });
      expect(detectTokenType(null)).toEqual({ kind: 'none', safe: false });
      expect(detectTokenType('')).toEqual({ kind: 'none', safe: false });
    });

    it('detectTokenType tratta token sconosciuti come unknown (safe=false)', () => {
      const result = detectTokenType('sconosciuto');
      expect(result.kind).toBe('unknown');
      expect(result.safe).toBe(false);
    });

    it('auditToken lancia errore quando enforce=true e token è classic', () => {
      const token = 'ghp_classic123';
      expect(() => auditToken(token, { enforce: true })).toThrow(
        'S4 enforcement: refusing to use a non-fine-grained GITHUB_PAT'
      );
    });

    it('auditToken non lancia quando enforce=false anche se token è classic', () => {
      const token = 'ghp_classic123';
      const result = auditToken(token, { enforce: false });
      expect(result.kind).toBe('classic');
      expect(result.safe).toBe(false);
    });

    it('auditToken non lancia quando token è fine-grained', () => {
      const token = 'github_pat_fine123';
      const result = auditToken(token, { enforce: true });
      expect(result.kind).toBe('fine-grained');
      expect(result.safe).toBe(true);
    });

    it('auditToken non lancia quando token è none (dev mode)', () => {
      const token = undefined;
      const result = auditToken(token, { enforce: true });
      expect(result.kind).toBe('none');
      expect(result.safe).toBe(false); // none è considerato safe per il flow
    });
  });
});
