// ─────────────────────────────────────────────────────────────────────────────
//  CACHE-REFRESH — TEST END-TO-END (task t_8fff22ac, ISSUE-L10)
//  Copertura completa di /api/cache-refresh dopo la decisione N6 (t_181e7d78):
//  l'endpoint RESTA e il cron GET è autenticato con la env CRON_SECRET.
//
//  Casi coperti (casistica validata in N6 contro l'handler reale):
//    - GET senza secret              → 401 CRON_AUTH_FAILED (fail-closed)
//    - GET con Authorization Bearer  → 200 e cache popolata
//    - GET con header x-cron-secret  → 200
//    - GET con secret errato         → 401 CRON_AUTH_FAILED
//    - GET con JWT valido (non-CRON_SECRET) → 401: la via cron accetta SOLO
//      CRON_SECRET — un token che passerebbe requireAuth NON apre il cron
//    - CRON_SECRET non configurato   → 401 fail-closed
//    - POST senza JWT                → 401 MISSING_TOKEN (storico preservato)
//    - PUT senza token               → 401 via require-auth
//    - OPTIONS                       → 204 preflight (CORS GET,POST,OPTIONS)
//    - GET autorizzato senza GITHUB_PAT → 500 (pre-check dell'handler)
//    - GET autorizzato con errori per-lingua → 200 con stats.error > 0
//    - getLanguages lancia           → 500 (unexpected error)
//
//  Isolamento: getLanguages (languages.js) e getRepoForLanguage (repos.js)
//  sono MOCKATE — nessuna chiamata di rete verso GitHub. Le env
//  CRON_SECRET/GITHUB_PAT/SLOT_OWNER sono gestite in beforeEach/afterEach.
//  safeEqual usa WebCrypto (setup-webcrypto.js), quindi il confronto
//  timing-safe funziona anche su Node 18 in CI.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';

// Logger mocked (stessa factory di jwt-flow.integration.test.js): output
// pulito e spy su eventuali segreti che non devono finire nei log.
vi.mock('../api/_lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// Dipendenze esterne isolate: nessuna rete verso GitHub nei test.
vi.mock('../api/_lib/repos.js', () => ({
  getRepoForLanguage: vi.fn(async () => ({
    url: 'https://github.com/owner/repo',
    pct: 42,
  })),
}));

vi.mock('../api/_lib/languages.js', () => ({
  getLanguages: vi.fn(async () => [
    { id: 'js', name: 'JavaScript', short: 'JS' },
    { id: 'python', name: 'Python', short: 'Py' },
  ]),
}));

const cacheRefreshHandler = (await import('../api/cache-refresh.js')).default;
const { getRepoForLanguage } = await import('../api/_lib/repos.js');
const { getLanguages } = await import('../api/_lib/languages.js');

// ── Env di test ──────────────────────────────────────────────────────────────
const CRON_SECRET = 'cron-secret-test-abc123';
// JWT_SECRET/JWT_ISSUER coerenti con il token firmato da signValidJwt: così il
// POST con JWT valido supera davvero requireAuth (il flusso GET cron invece li
// ignora — confronta SOLO con CRON_SECRET).
const JWT_SECRET = 'jwt-secret-not-cron';
const JWT_ISSUER = 'test-issuer';
const ENV_KEYS = [
  'CRON_SECRET',
  'GITHUB_PAT',
  'SLOT_OWNER',
  'JWT_SECRET',
  'JWT_ISSUER',
];

function setEnv(overrides = {}) {
  const base = {
    CRON_SECRET,
    GITHUB_PAT: 'test-pat',
    SLOT_OWNER: 'test-owner',
    JWT_SECRET,
    JWT_ISSUER,
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

let envSnapshot = {};

beforeEach(() => {
  envSnapshot = {};
  for (const key of ENV_KEYS) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  setEnv();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envSnapshot[key];
    }
  }
  vi.restoreAllMocks();
});

// ── Helpers req/res (stesso stile di jwt-flow.integration.test.js) ──────────
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

function makeReq({ method = 'GET', headers = {} } = {}) {
  return { method, headers };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// Firma un JWT che PASSEREBBE requireAuth (secret/issuer coerenti) ma NON è
// il CRON_SECRET: serve a dimostrare che la via cron accetta solo CRON_SECRET.
async function signValidJwt() {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setIssuer(JWT_ISSUER)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

// ── GET: via cron (CRON_SECRET) ─────────────────────────────────────────────
describe('GET /api/cache-refresh — via cron (CRON_SECRET)', () => {
  test('GET senza secret → 401 CRON_AUTH_FAILED, handler mai eseguito', async () => {
    const res = makeRes();
    await cacheRefreshHandler(makeReq({ method: 'GET' }), res);

    expect(res.statusCode).toBe(401);
    const body = parseBody(res);
    expect(body.code).toBe('CRON_AUTH_FAILED');
    expect(body.error).toBe('Unauthorized');
    expect(res.headers['WWW-Authenticate']).toBe(
      'Bearer realm="github-slot-machine"'
    );
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('GET con Authorization: Bearer CRON_SECRET → 200 e cache popolata', async () => {
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      res
    );

    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Cache refreshed successfully');
    expect(body.stats).toEqual({ total: 2, success: 2, error: 0 });
    expect(body.results.js).toEqual({
      found: true,
      url: 'https://github.com/owner/repo',
      pct: 42,
    });
    expect(body.results.python).toEqual({
      found: true,
      url: 'https://github.com/owner/repo',
      pct: 42,
    });
    expect(res.headers['Cache-Control']).toBe(
      'no-store, no-cache, must-revalidate, max-age=0'
    );
    expect(getLanguages).toHaveBeenCalledTimes(1);
    expect(getRepoForLanguage).toHaveBeenCalledTimes(2);
    expect(getRepoForLanguage).toHaveBeenCalledWith(
      'test-pat',
      'test-owner',
      expect.objectContaining({ id: 'js' }),
      expect.any(Array)
    );
  });

  test('GET con header x-cron-secret → 200', async () => {
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { 'x-cron-secret': CRON_SECRET } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(parseBody(res).success).toBe(true);
    expect(getRepoForLanguage).toHaveBeenCalledTimes(2);
  });

  test('GET con secret errato → 401 CRON_AUTH_FAILED, handler mai eseguito', async () => {
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({
        headers: { authorization: 'Bearer wrong-secret' },
      }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe('CRON_AUTH_FAILED');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('GET con JWT valido (non-CRON_SECRET) → 401: la via cron accetta SOLO CRON_SECRET', async () => {
    const validJwt = await signValidJwt();
    expect(validJwt.split('.')).toHaveLength(3);

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${validJwt}` } }),
      res
    );

    // Il token supererebbe requireAuth sul POST, ma il GET cron confronta
    // SOLO con CRON_SECRET: nessun 200, nessun INVALID_TOKEN di require-auth.
    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe('CRON_AUTH_FAILED');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('CRON_SECRET non configurato → GET 401 fail-closed anche con Bearer', async () => {
    setEnv({ CRON_SECRET: undefined });

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe('CRON_AUTH_FAILED');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('GET autorizzato ma senza GITHUB_PAT → 500 (pre-check handler)', async () => {
    setEnv({ GITHUB_PAT: undefined });

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      res
    );

    expect(res.statusCode).toBe(500);
    expect(parseBody(res).error).toBe(
      'GITHUB_PAT not configured. Cache refresh cannot proceed.'
    );
    expect(getLanguages).not.toHaveBeenCalled();
  });

  test('GET autorizzato con errore per-lingua → 200 con stats.error > 0', async () => {
    getRepoForLanguage.mockImplementation(async (token, owner, lang) => {
      if (lang.id === 'python') throw new Error('github down');
      return { url: 'https://github.com/owner/repo', pct: 42 };
    });

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      res
    );

    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.stats).toEqual({ total: 2, success: 1, error: 1 });
    expect(body.results.js).toEqual({
      found: true,
      pct: 42,
      url: expect.any(String),
    });
    expect(body.results.python).toEqual({
      found: false,
      error: 'github down',
    });
  });

  test('getLanguages lancia → 500 (unexpected error)', async () => {
    getLanguages.mockRejectedValue(new Error('languages exploded'));

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      res
    );

    expect(res.statusCode).toBe(500);
    const body = parseBody(res);
    expect(body.error).toBe('Internal server error during cache refresh');
    expect(body.details).toBe('languages exploded');
  });
});

// ── POST / altri metodi: admin JWT (require-auth) ───────────────────────────
describe('POST e altri metodi /api/cache-refresh — admin JWT (require-auth)', () => {
  test('POST senza token → 401 MISSING_TOKEN (comportamento storico preservato)', async () => {
    const res = makeRes();
    await cacheRefreshHandler(makeReq({ method: 'POST' }), res);

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe('MISSING_TOKEN');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('POST con header non-Bearer → 401 MALFORMED_TOKEN', async () => {
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({
        method: 'POST',
        headers: { authorization: 'Basic Zm9vOmJhcg==' },
      }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe('MALFORMED_TOKEN');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('POST con JWT valido → 200 (il flusso completo login→token è in jwt-flow.integration)', async () => {
    const validJwt = await signValidJwt();
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({
        method: 'POST',
        headers: { authorization: `Bearer ${validJwt}` },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(parseBody(res).success).toBe(true);
    expect(getRepoForLanguage).toHaveBeenCalledTimes(2);
  });

  test('PUT senza token → 401 via require-auth', async () => {
    const res = makeRes();
    await cacheRefreshHandler(makeReq({ method: 'PUT' }), res);

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe('MISSING_TOKEN');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });
});

// ── OPTIONS: preflight CORS ─────────────────────────────────────────────────
describe('OPTIONS /api/cache-refresh — preflight CORS', () => {
  const ALLOWED = 'http://localhost:3000';

  test('OPTIONS → 204 con metodi GET,POST,OPTIONS e header Authorization dichiarati', async () => {
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ method: 'OPTIONS', headers: { origin: ALLOWED } }),
      res
    );

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ALLOWED);
    expect(res.headers['Access-Control-Allow-Methods']).toBe(
      'GET, POST, OPTIONS'
    );
    expect(res.headers['Access-Control-Allow-Headers']).toBe(
      'Content-Type, Authorization'
    );
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });
});
