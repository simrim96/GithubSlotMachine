// Test del flusso di login JWT (task t_b5bcede4):
//   - api/_lib/credentials.js  → verifica credenziali (fail-closed, timing-safe)
//   - api/_lib/token-issuer.js → emissione token jose (HS + asimmetrico)
//   - api/auth/login.js        → endpoint POST /api/auth/login
//
// Copre il criterio di accettazione: credenziali corrette → 200 con token ed
// expiry; credenziali errate / input non valido → 401. Verifica inoltre che
// password e segreto JWT non finiscano MAI nei log o nelle risposte.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { jwtVerify, importSPKI } from 'jose';
import { generateKeyPairSync } from 'node:crypto';

// Logger mocked: ci serve spiare che password/segreto non vengano mai loggati.
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

const { logger } = await import('../api/_lib/logger.js');
const loginHandler = (await import('../api/auth/login.js')).default;
const { verifyCredentials, getCredentialsConfig } =
  await import('../api/_lib/credentials.js');
const { issueAccessToken } = await import('../api/_lib/token-issuer.js');

const ENV_KEYS = [
  'JWT_SECRET',
  'JWT_ALGORITHM',
  'JWT_ISSUER',
  'JWT_ACCESS_TOKEN_TTL',
  'JWT_REFRESH_TOKEN_TTL',
  'NODE_ENV',
  'AUTH_USERNAME',
  'AUTH_PASSWORD',
];

const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 's3cret!pw';
const TEST_SECRET = 'test-secret';

// ── helpers env ─────────────────────────────────────────────────────────────
function setEnv(overrides = {}) {
  const base = {
    JWT_SECRET: TEST_SECRET,
    AUTH_USERNAME: TEST_USERNAME,
    AUTH_PASSWORD: TEST_PASSWORD,
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

// ── helpers req/res (stesso stile di tests/cors-all-endpoints.test.js) ──────
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

// Richiesta POST con body JSON emesso come stream (come un vero
// IncomingMessage Node); senza body → stream vuoto.
function makeReq({ method = 'POST', headers = {}, body } = {}) {
  let sent = false;
  const req = { method, headers };
  req[Symbol.asyncIterator] = () => ({
    next: async () => {
      if (sent || body === undefined) return { done: true };
      sent = true;
      const value = typeof body === 'string' ? body : JSON.stringify(body);
      return { done: false, value };
    },
  });
  return req;
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// Verifica un token emesso con il secret di test e ne ritorna i claim.
async function verifyToken(
  token,
  secret = TEST_SECRET,
  issuer = 'github-slot-machine'
) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer,
    algorithms: ['HS256', 'HS384', 'HS512'],
  });
  return payload;
}

// ── credentials service ─────────────────────────────────────────────────────
describe('credentials service', () => {
  test('configured=false se manca AUTH_USERNAME o AUTH_PASSWORD', () => {
    expect(
      getCredentialsConfig({ AUTH_USERNAME: 'a', AUTH_PASSWORD: 'b' })
        .configured
    ).toBe(true);
    expect(getCredentialsConfig({ AUTH_PASSWORD: 'b' }).configured).toBe(false);
    expect(getCredentialsConfig({ AUTH_USERNAME: 'a' }).configured).toBe(false);
    expect(getCredentialsConfig({}).configured).toBe(false);
  });

  test('verifica credenziali esatte (con trim dello username)', () => {
    const env = { AUTH_USERNAME: 'admin', AUTH_PASSWORD: 'pw' };
    expect(verifyCredentials('admin', 'pw', env)).toBe(true);
    expect(verifyCredentials('  admin  ', 'pw', env)).toBe(true);
  });

  test('rifiuta password errata e username errato', () => {
    const env = { AUTH_USERNAME: 'admin', AUTH_PASSWORD: 'pw' };
    expect(verifyCredentials('admin', 'wrong', env)).toBe(false);
    expect(verifyCredentials('hacker', 'pw', env)).toBe(false);
  });

  test('rifiuta input non-stringa o vuoto', () => {
    const env = { AUTH_USERNAME: 'admin', AUTH_PASSWORD: 'pw' };
    expect(verifyCredentials(42, 'pw', env)).toBe(false);
    expect(verifyCredentials('admin', null, env)).toBe(false);
    expect(verifyCredentials('', 'pw', env)).toBe(false);
    expect(verifyCredentials('admin', '', env)).toBe(false);
    expect(verifyCredentials(undefined, undefined, env)).toBe(false);
  });

  test('fail-closed: senza configurazione non valida MAI', () => {
    expect(verifyCredentials('admin', 'pw', {})).toBe(false);
  });
});

// ── token issuer ────────────────────────────────────────────────────────────
describe('token issuer', () => {
  test('emette un token verificabile con sub/username/iss/exp', async () => {
    const issued = await issueAccessToken('admin', {
      JWT_SECRET: TEST_SECRET,
      JWT_ISSUER: 'test-issuer',
      JWT_ACCESS_TOKEN_TTL: '15m',
    });
    expect(issued.tokenType).toBe('Bearer');
    expect(issued.expiresIn).toBe(900);
    expect(issued.accessToken.split('.')).toHaveLength(3);

    const claims = await verifyToken(
      issued.accessToken,
      TEST_SECRET,
      'test-issuer'
    );
    expect(claims.sub).toBe('admin');
    expect(claims.username).toBe('admin');
    expect(claims.iss).toBe('test-issuer');
    expect(claims.exp).toBe(
      Math.floor(new Date(issued.expiresAt).getTime() / 1000)
    );
    expect(claims.exp - claims.iat).toBe(900);
  });

  test('rispetta la durata configurata (5m → 300s)', async () => {
    const issued = await issueAccessToken('admin', {
      JWT_SECRET: TEST_SECRET,
      JWT_ACCESS_TOKEN_TTL: '5m',
    });
    expect(issued.expiresIn).toBe(300);
    const claims = await verifyToken(issued.accessToken);
    expect(claims.exp - claims.iat).toBe(300);
  });

  test('supporta HS512 via env override', async () => {
    const issued = await issueAccessToken('admin', {
      JWT_SECRET: TEST_SECRET,
      JWT_ALGORITHM: 'HS512',
    });
    const { protectedHeader } = await jwtVerify(
      issued.accessToken,
      new TextEncoder().encode(TEST_SECRET)
    );
    expect(protectedHeader.alg).toBe('HS512');
  });

  test('supporta firma asimmetrica RS256 (PEM in JWT_SECRET)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

    const issued = await issueAccessToken('admin', {
      JWT_SECRET: privatePem,
      JWT_ALGORITHM: 'RS256',
      JWT_ISSUER: 'test-issuer',
    });

    const { payload, protectedHeader } = await jwtVerify(
      issued.accessToken,
      await importSPKI(publicPem, 'RS256'),
      { issuer: 'test-issuer', algorithms: ['RS256'] }
    );
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.sub).toBe('admin');
  });

  test('fail-closed: produzione senza JWT_SECRET → errore', async () => {
    await expect(
      issueAccessToken('admin', { NODE_ENV: 'production' })
    ).rejects.toThrow(/JWT_SECRET è obbligatorio/);
  });
});

// ── endpoint POST /api/auth/login ───────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('credenziali corrette → 200 con token ed expiry', async () => {
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    const payload = parseBody(res);
    expect(payload.accessToken.split('.')).toHaveLength(3);
    expect(payload.tokenType).toBe('Bearer');
    expect(payload.expiresIn).toBe(900); // default 15m
    expect(new Date(payload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(payload.user).toEqual({ username: TEST_USERNAME });

    const claims = await verifyToken(payload.accessToken);
    expect(claims.sub).toBe(TEST_USERNAME);
    expect(claims.iss).toBe('github-slot-machine');
  });

  test('password errata → 401 invalid_credentials', async () => {
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: 'wrong' } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toEqual({ error: 'invalid_credentials' });
  });

  test('username errato → 401 con lo stesso corpo (nessun leak)', async () => {
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: 'hacker', password: TEST_PASSWORD } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toEqual({ error: 'invalid_credentials' });
  });

  test('input non valido → 401 (campo mancante, non-stringa, array, body vuoto)', async () => {
    for (const body of [
      {},
      { username: TEST_USERNAME },
      { password: TEST_PASSWORD },
      { username: 42, password: TEST_PASSWORD },
      { username: TEST_USERNAME, password: ['x'] },
      [],
      null,
    ]) {
      const res = makeRes();
      await loginHandler(makeReq({ body }), res);
      expect(res.statusCode, `body=${JSON.stringify(body)}`).toBe(401);
      expect(parseBody(res)).toEqual({ error: 'invalid_credentials' });
    }
  });

  test('JSON malformato → 401', async () => {
    const res = makeRes();
    await loginHandler(makeReq({ body: '{not-json' }), res);
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toEqual({ error: 'invalid_credentials' });
  });

  test('auth non configurata → 401 anche con credenziali note', async () => {
    setEnv({ AUTH_USERNAME: undefined, AUTH_PASSWORD: undefined });
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
      res
    );
    expect(res.statusCode).toBe(401);
  });

  test('produzione senza JWT_SECRET → 500 internal_error (fail-closed)', async () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: undefined });
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
      res
    );
    expect(res.statusCode).toBe(500);
    expect(parseBody(res)).toEqual({ error: 'internal_error' });
    expect(res.body).not.toContain(TEST_SECRET);
  });

  test('GET → 405 con header Allow', async () => {
    const res = makeRes();
    await loginHandler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST, OPTIONS');
    expect(parseBody(res)).toEqual({ error: 'method_not_allowed' });
  });

  test('OPTIONS → 204 con CORS POST, OPTIONS', async () => {
    const res = makeRes();
    await loginHandler(
      makeReq({
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000' },
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(res.headers['Access-Control-Allow-Origin']).toBe(
      'http://localhost:3000'
    );
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  test('rispetta JWT_ACCESS_TOKEN_TTL configurato (5m → 300s)', async () => {
    setEnv({ JWT_ACCESS_TOKEN_TTL: '5m' });
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(parseBody(res).expiresIn).toBe(300);
  });

  test('NON logga password né segreto, e non li rimanda in risposta', async () => {
    // Un login riuscito e due falliti: ogni ramo di logging viene esercitato.
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: 'wrong' } }),
      makeRes()
    );
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
      makeRes()
    );

    const logged = [
      ...logger.warn.mock.calls,
      ...logger.info.mock.calls,
      ...logger.error.mock.calls,
      ...logger.debug.mock.calls,
    ]
      .flat()
      .map(String)
      .join(' ');

    expect(logged).not.toContain(TEST_PASSWORD);
    expect(logged).not.toContain(TEST_SECRET);

    // I log di login portano solo lo username (audit) e il livello giusto.
    expect(logger.info).toHaveBeenCalledWith('login.ok', {
      username: TEST_USERNAME,
    });
    expect(logger.warn).toHaveBeenCalledWith('login.failed', {
      username: TEST_USERNAME,
    });

    // Nessuna risposta 401 rimanda la password al client.
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
      makeRes()
    );
    expect(res.body ?? '').not.toContain(TEST_PASSWORD);
  });
});
