// Test e2e dedicati per GET /api/ratelimit-status (ISSUES.md §5, riga 6 della
// tabella copertura). Prima di questo file l'endpoint era coperto solo
// indirettamente (CORS in cors-all-endpoints.test.js, Authorization in
// header-contract.test.js): la logica di `percentageUsed` e delle soglie
// `status` non era MAI verificata.
//
// Cosa copre:
//   1. percentuali `percentageUsed` corrette sul limite REALE letto dal body
//      `resources.core.limit` (5000 autenticato / 60 anonimo — ISSUE-N10),
//      incluso il fallback ai limiti documentati quando il body non è
//      leggibile o non espone il campo;
//   2. soglie `status` PERCENTUALI (warning ≤ 10% del limite, critical ≤ 5%),
//      inclusi i confini (501/500 e 251/250 su limite 5000; 6/3 su limite 60);
//   3. risposta GitHub anonima (limite reale 60): limit/percentage/status
//      calcolati su 60, NON su 5000 hardcoded (ISSUE-N10 applicata);
//   4. robustezza: header assenti, fetch che fallisce, reset non numerico,
//      body non-JSON (fallback 60/5000 in base al token);
//   5. protocollo: solo GET (405 altrimenti), header CORS/Cache-Control,
//      chiamata a https://api.github.com/rate_limit con Bearer se GITHUB_PAT
//      è impostato (e senza Authorization se assente).
//
// La chiamata a GitHub è SEMPRE mockata (vi.stubGlobal('fetch')): nessuna rete.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handler = (await import('../api/ratelimit-status.js')).default;

const ALLOWED = 'http://localhost:3000';
const DISALLOWED = 'https://evil.example.com';

// ── Mock della risposta GitHub /rate_limit ─────────────────────────────────
// headers.get case-insensitive come un vero oggetto Headers (così
// safeGetHeader li legge), più body JSON opzionale: dal fix N10 l'endpoint
// LEGGE `resources.core.limit` dal body per ottenere il limite reale.
function makeGithubResponse({ remaining = '4999', reset, body = {} }) {
  const resetValue = reset ?? String(Math.floor(Date.now() / 1000) + 3600);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => {
        const map = {
          'x-ratelimit-remaining': String(remaining),
          'x-ratelimit-reset': String(resetValue),
        };
        return map[String(name).toLowerCase()] ?? null;
      },
    },
    json: async () => body,
  };
}

// Stuba global.fetch con una risposta GitHub che riporta `remaining`.
// Ritorna lo spy per ispezionare URL/header della chiamata.
function stubFetch(remaining, opts = {}) {
  const spy = vi
    .fn()
    .mockResolvedValue(makeGithubResponse({ remaining, ...opts }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  // Default: ramo anonimo. I singoli test impostano GITHUB_PAT quando serve.
  delete process.env.GITHUB_PAT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── percentuali e stato sul limite autenticato (5000 dal body) ──────────────
describe('GET /api/ratelimit-status — percentageUsed e status (limite 5000)', () => {
  // Body che GitHub ritorna per una chiamata autenticata: limite 5000/h.
  const AUTH_BODY = { resources: { core: { limit: 5000 } } };

  it('remaining alto (4999) → status ok, percentage 0.02, limit 5000', async () => {
    stubFetch('4999', { body: AUTH_BODY });
    process.env.GITHUB_PAT = 'test-token';

    const res = await handler({ method: 'GET', query: {} });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.remaining).toBe(4999);
    expect(body.limit).toBe(5000);
    expect(body.status).toBe('ok');
    expect(body.percentageUsed).toBe('0.02'); // (5000-4999)/5000*100
    expect(body.isBelowWarningThreshold).toBe(false);
    expect(body.totalRequests).toBeNull();
  });

  it('remaining al massimo (5000) → percentage 0.00', async () => {
    stubFetch('5000', { body: AUTH_BODY });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.percentageUsed).toBe('0.00');
    expect(body.status).toBe('ok');
  });

  it('remaining a metà (2500) → percentage 50.00', async () => {
    stubFetch('2500', { body: AUTH_BODY });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.percentageUsed).toBe('50.00');
    expect(body.status).toBe('ok');
  });

  it('remaining basso (10) → critical e isBelowWarningThreshold true', async () => {
    // Soglie PERCENTUALI post-N10: critical ≤ 5% del limite (250 su 5000),
    // quindi 10 rimasti = 0.2% è critico (i vecchi assoluti 2/10 davano
    // warning a 10, ma erano calibrati sul limite 5000 e distorti per l'anonimo).
    stubFetch('10', { body: AUTH_BODY });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('critical');
    expect(body.percentageUsed).toBe('99.80'); // (5000-10)/5000*100
    expect(body.isBelowWarningThreshold).toBe(true);
  });

  it('confine ok/warning: 501 → ok, 500 → warning (10% di 5000)', async () => {
    stubFetch('501', { body: AUTH_BODY });
    let res = await handler({ method: 'GET', query: {} });
    expect((await res.json()).status).toBe('ok');

    stubFetch('500', { body: AUTH_BODY });
    res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('warning');
    expect(body.percentageUsed).toBe('90.00'); // (5000-500)/5000*100
    expect(body.isBelowWarningThreshold).toBe(true);
  });

  it('confine warning/critical: 251 → warning, 250 → critical (5% di 5000)', async () => {
    stubFetch('251', { body: AUTH_BODY });
    let res = await handler({ method: 'GET', query: {} });
    expect((await res.json()).status).toBe('warning');

    stubFetch('250', { body: AUTH_BODY });
    res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('critical');
    expect(body.percentageUsed).toBe('95.00'); // (5000-250)/5000*100
  });

  it('remaining critico (2) → status critical, percentage 99.96', async () => {
    stubFetch('2', { body: AUTH_BODY });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('critical');
    expect(body.percentageUsed).toBe('99.96'); // (5000-2)/5000*100
    expect(body.isBelowWarningThreshold).toBe(true);
  });

  it('remaining 1 → critical, percentage 99.98', async () => {
    stubFetch('1', { body: AUTH_BODY });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('critical');
    expect(body.percentageUsed).toBe('99.98');
  });

  it('remaining 0 → critical, percentage 100.00', async () => {
    stubFetch('0', { body: AUTH_BODY });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('critical');
    expect(body.percentageUsed).toBe('100.00');
  });
});

// ── caso anonimo (limite reale 60) — ISSUE-N10 applicata ────────────────────
describe('GET /api/ratelimit-status — risposta GitHub anonima (limite 60, N10)', () => {
  it('senza token: limit/percentage/status calcolati sul limite reale 60 del body', async () => {
    // GitHub anonimo: X-RateLimit-Remaining su un budget reale di 60/h e body
    // /rate_limit che riporta resources.core.limit=60. L'endpoint LEGGE il
    // body (fix N10): prima calcolava su 5000 hardcoded → 98.90% fasullo.
    const reset = String(Math.floor(Date.now() / 1000) + 3600);
    stubFetch('55', {
      reset,
      body: { resources: { core: { limit: 60, remaining: 55 } } },
    });
    delete process.env.GITHUB_PAT;

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();

    expect(body.limit).toBe(60);
    expect(body.remaining).toBe(55);
    expect(body.percentageUsed).toBe('8.33'); // (60-55)/60*100
    expect(body.status).toBe('ok'); // 55 > 6 (10% di 60)
    expect(body.isBelowWarningThreshold).toBe(false);
  });

  it('anonimo: remaining 6 (10% di 60) → warning, 3 (5%) → critical', async () => {
    const anonBody = (remaining) => ({
      resources: { core: { limit: 60, remaining } },
    });

    stubFetch('6', { body: anonBody(6) });
    let res = await handler({ method: 'GET', query: {} });
    let body = await res.json();
    expect(body.status).toBe('warning');
    expect(body.percentageUsed).toBe('90.00'); // (60-6)/60*100
    expect(body.isBelowWarningThreshold).toBe(true);

    stubFetch('3', { body: anonBody(3) });
    res = await handler({ method: 'GET', query: {} });
    body = await res.json();
    expect(body.status).toBe('critical');
    expect(body.percentageUsed).toBe('95.00'); // (60-3)/60*100
  });

  it('body senza resources.core.limit → fallback anonimo 60', async () => {
    // Body di default {} in stubFetch: il campo limite manca → fallback
    // documentato GitHub per i client senza token (60/h).
    stubFetch('55');

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.limit).toBe(60);
    expect(body.percentageUsed).toBe('8.33'); // (60-55)/60*100
    expect(body.status).toBe('ok');
  });
});

// ── robustezza ──────────────────────────────────────────────────────────────
describe('GET /api/ratelimit-status — casi limite e robustezza', () => {
  it('header rate-limit assenti → status unknown, percentuale null', async () => {
    // headers.get ritorna null per entrambi gli header GitHub e body vuoto:
    // limite di fallback anonimo 60.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      })
    );

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.remaining).toBeNull();
    expect(body.percentageUsed).toBeNull();
    expect(body.reset).toBeNull();
    expect(body.secondsUntilReset).toBeNull();
    expect(body.isBelowWarningThreshold).toBe(false);
    expect(body.limit).toBe(60); // fallback anonimo
  });

  it('body non-JSON (json() fallisce) → fallback anonimo 60, status unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      })
    );

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.limit).toBe(60);
    expect(body.status).toBe('unknown');
  });

  it('body non-JSON con token → fallback autenticato 5000', async () => {
    process.env.GITHUB_PAT = 'test-token';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      })
    );

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.limit).toBe(5000);
    expect(body.status).toBe('unknown');
  });

  it('fetch verso GitHub fallisce → 200 con status unknown (degradazione)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    );

    const res = await handler({ method: 'GET', query: {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'unknown', remaining: null, reset: null });
    expect(res.headers.get('cache-control')).toBe(
      'no-cache, no-store, must-revalidate'
    );
  });

  it('reset non numerico → reset/secondsUntilReset/resetTime null', async () => {
    stubFetch('4000', { reset: 'not-a-number' });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.reset).toBeNull();
    expect(body.secondsUntilReset).toBeNull();
    expect(body.resetTime).toBeNull();
    expect(body.status).toBe('ok'); // il remaining è valido
  });

  it('reset valido → secondsUntilReset ≈ differenza e resetTime formattato', async () => {
    const reset = Math.floor(Date.now() / 1000) + 300; // fra 5 minuti
    stubFetch('4500', { reset: String(reset) });

    const res = await handler({ method: 'GET', query: {} });
    const body = await res.json();
    expect(body.reset).toBe(reset);
    expect(body.secondsUntilReset).toBeGreaterThanOrEqual(299);
    expect(body.secondsUntilReset).toBeLessThanOrEqual(300);
    expect(body.resetTime).toEqual(expect.any(String));
    expect(body.resetTime.length).toBeGreaterThan(0);
  });
});

// ── protocollo HTTP, CORS e chiamata a GitHub ───────────────────────────────
describe('GET /api/ratelimit-status — protocollo, CORS e fetch a GitHub', () => {
  it('chiama https://api.github.com/rate_limit con Authorization Bearer (token presente)', async () => {
    const spy = stubFetch('4900');
    process.env.GITHUB_PAT = 'tok-rl-status';

    await handler({ method: 'GET', query: {} });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, opts] = spy.mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/rate_limit');
    expect(opts.headers.Authorization).toBe('Bearer tok-rl-status');
    expect(opts.headers.Accept).toBe('application/vnd.github.v3+json');
  });

  it('senza token NON invia Authorization (ghHeaders senza token)', async () => {
    const spy = stubFetch('4000');
    delete process.env.GITHUB_PAT;

    await handler({ method: 'GET', query: {} });

    const [, opts] = spy.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('solo GET: POST → 405 con header CORS e senza chiamata a GitHub', async () => {
    const spy = stubFetch('4000');

    const res = await handler({
      method: 'POST',
      headers: { origin: ALLOWED },
    });

    expect(res.status).toBe(405);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-methods')).toBe(
      'GET, OPTIONS'
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('risposta GET: Content-Type JSON e Cache-Control no-cache', async () => {
    stubFetch('4000');

    const res = await handler({ method: 'GET', query: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe(
      'no-cache, no-store, must-revalidate'
    );
    expect(res.headers.get('pragma')).toBe('no-cache');
  });

  it('CORS: origin allowlisted riflesso, origin non consentito → nessun ACAO', async () => {
    stubFetch('4000');

    const allowed = await handler({
      method: 'GET',
      headers: { origin: ALLOWED },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED);

    const denied = await handler({
      method: 'GET',
      headers: { origin: DISALLOWED },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
