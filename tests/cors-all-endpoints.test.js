// M6 (ISSUES.md) — Verifica uniforme degli header CORS su TUTTI gli endpoint
// /api/*. La gestione CORS è centralizzata in api/_lib/cors.js:
//   • applyCors(req, res)        → policy esplicita (allowlist) per spin/health
//   • corsHeaders(origin)        → policy esplicita (allowlist), formato Response
//                                  per ratelimit-status
//   • applyCorsWildcard(req, res)→ policy wildcard `*` per i contenuti embeddati
//                                  (image/lever, visti su github.com)
//
// Qui asseriamo che:
//   1. OGNI endpoint emetta la stessa superficie di header di sicurezza CORS
//      (Methods / Headers / Max-Age / X-Content-Type-Options / Referrer-Policy)
//      → prova dell'uniformità voluta da M6.
//   2. La policy esplicita rifletta l'Origin solo se allowlisted (altrimenti
//      NON emette Access-Control-Allow-Origin).
//   3. La policy wildcard emetta sempre `Access-Control-Allow-Origin: *`
//      indipendentemente dall'origine.
//
// Endpoint coperti:
//   • /api/spin             → applyCors
//   • /api/health           → applyCors
//   • /api/ratelimit-status → corsHeaders (formato Web Response)
//   • /api/image            → applyCorsWildcard
//   • /api/lever            → applyCorsWildcard

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Nessuna rete nei test: kv disabilitato e fetch intercettato.
vi.mock('../api/_lib/kv.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvEnabled: false,
  kvWritable: false,
}));

const spinHandler = (await import('../api/spin.js')).default;
const healthHandler = (await import('../api/health.js')).default;
const ratelimitHandler = (await import('../api/ratelimit-status.js')).default;
const imageHandler = (await import('../api/image.js')).default;
const leverHandler = (await import('../api/lever.js')).default;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (n) =>
          ({
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          })[String(n).toLowerCase()] ?? null,
      },
      json: async () => ({}),
    })
  );
  delete process.env.GITHUB_PAT; // spin/health seguono il branch no-token
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Response mock compatibile con gli handler (req, res) ────────────────────
function makeRes() {
  const headers = {};
  const res = {
    headers,
    setHeader(k, v) {
      headers[k] = v;
      return this;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    end() {
      return this;
    },
    redirect(c, u) {
      this.statusCode = c;
      this.headers.Location = u;
      return this;
    },
  };
  return res;
}

// Header di sicurezza CORS condivisi da TUTTE le policy (prova di uniformità).
const SHARED = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function expectSharedSecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SHARED)) {
    expect(headers[k], `header CORS mancante o errato: ${k}`).toBe(v);
  }
}

const ALLOWED = 'http://localhost:3000';
const DISALLOWED = 'https://evil.example.com';

// ── Policy esplicita (allowlist) ────────────────────────────────────────────
describe('Policy CORS esplicita (allowlist) su /api/spin, /api/health, /api/ratelimit-status', () => {
  it('spin: GET con origin consentito riflette ACAO', async () => {
    const res = makeRes();
    await spinHandler({ method: 'GET', headers: { origin: ALLOWED }, query: {} }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ALLOWED);
    expectSharedSecurityHeaders(res.headers);
  });

  it('spin: OPTIONS per origin NON consentito NON emette ACAO', async () => {
    const res = makeRes();
    await spinHandler({ method: 'OPTIONS', headers: { origin: DISALLOWED } }, res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expectSharedSecurityHeaders(res.headers);
  });

  it('health: GET con origin consentito riflette ACAO', async () => {
    const res = makeRes();
    await healthHandler({ method: 'GET', headers: { origin: ALLOWED }, query: {} }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ALLOWED);
    expectSharedSecurityHeaders(res.headers);
  });

  it('health: OPTIONS per origin NON consentito NON emette ACAO', async () => {
    const res = makeRes();
    await healthHandler({ method: 'OPTIONS', headers: { origin: DISALLOWED } }, res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expectSharedSecurityHeaders(res.headers);
  });

  it('ratelimit-status: GET con origin consentito riflette ACAO (formato Response)', async () => {
    const res = await ratelimitHandler({
      method: 'GET',
      headers: { origin: ALLOWED },
      query: {},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('ratelimit-status: origin NON consentito NON emette ACAO (formato Response)', async () => {
    const res = await ratelimitHandler({
      method: 'GET',
      headers: { origin: DISALLOWED },
      query: {},
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});

// ── Policy wildcard per contenuti embeddati ─────────────────────────────────
describe('Policy CORS wildcard (*) su /api/image, /api/lever', () => {
  it('image: GET emette ACAO:* per qualsiasi origin (anche non allowlisted)', async () => {
    const res = makeRes();
    await imageHandler({ method: 'GET', headers: { origin: DISALLOWED } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expectSharedSecurityHeaders(res.headers);
  });

  it('image: OPTIONS emette ACAO:* e 204', async () => {
    const res = makeRes();
    await imageHandler({ method: 'OPTIONS', headers: { origin: ALLOWED } }, res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('lever: GET emette ACAO:* per qualsiasi origin (anche non allowlisted)', async () => {
    const res = makeRes();
    await leverHandler({ method: 'GET', headers: { origin: DISALLOWED } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expectSharedSecurityHeaders(res.headers);
  });

  it('lever: OPTIONS emette ACAO:* e 204', async () => {
    const res = makeRes();
    await leverHandler({ method: 'OPTIONS', headers: { origin: ALLOWED } }, res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
