// ─────────────────────────────────────────────────────────────────────────────
//  JWT FLOW — TEST DI INTEGRAZIONE (task t_a4277d69)
//  Flusso completo reale: POST /api/auth/login → token → rotta protetta
//  (api/cache-refresh, avvolta da require-auth).
//
//  Casi coperti (criterio di accettazione):
//    - successo:           login 200 → token → /api/cache-refresh 200
//    - credenziali errate: login 401, nessun token
//    - token scaduto:      401 EXPIRED_TOKEN (handler mai eseguito)
//    - token manomesso:    payload alterato / firma alterata → 401 INVALID_TOKEN
//    - token mancante:     401 MISSING_TOKEN (handler mai eseguito)
//
//  Isolamento dipendenze esterne: getLanguages (languages.js) e
//  getRepoForLanguage (repos.js) sono MOCKATE — nessuna chiamata di rete
//  verso GitHub o file esterni durante i test. Secret di test dedicato
//  (mai i default di sviluppo di jwt-config.js).
//
//  Il middleware requireAuth di cache-refresh è stato creato con env=process.env
//  (default al load del modulo): l'oggetto è lo stesso riferimento, quindi
//  scrivere process.env.JWT_SECRET nel beforeEach è sufficiente.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, importPKCS8 } from 'jose';
import { generateKeyPairSync } from 'node:crypto';

// Logger mocked (stessa factory di login.test.js): output pulito e spy su
// eventuali segreti che non devono MAI finire nei log del flusso.
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
    { id: 'js', short: 'JS', color: '#f7df1e', icon: '' },
  ]),
}));

const loginHandler = (await import('../api/auth/login.js')).default;
const cacheRefreshHandler = (await import('../api/cache-refresh.js')).default;
const { verifyAccessToken, AUTH_CODES } =
  await import('../api/_lib/require-auth.js');
const { getRepoForLanguage } = await import('../api/_lib/repos.js');

// ── Env di test: secret dedicato, issuer dedicato, credenziali di test ──────
const TEST_SECRET = 'test-integration-secret-123';
const TEST_ISSUER = 'test-issuer';
const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 's3cret!pw';

const ENV_KEYS = [
  'JWT_SECRET',
  'JWT_ALGORITHM',
  'JWT_ISSUER',
  'JWT_ACCESS_TOKEN_TTL',
  'JWT_REFRESH_TOKEN_TTL',
  'NODE_ENV',
  'AUTH_USERNAME',
  'AUTH_PASSWORD',
  'GITHUB_PAT',
  'SLOT_OWNER',
];

function setEnv(overrides = {}) {
  const base = {
    JWT_SECRET: TEST_SECRET,
    JWT_ISSUER: TEST_ISSUER,
    NODE_ENV: 'test',
    AUTH_USERNAME: TEST_USERNAME,
    AUTH_PASSWORD: TEST_PASSWORD,
    GITHUB_PAT: 'test-pat',
    SLOT_OWNER: 'test-owner',
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

// ── Helpers req/res (stesso stile di tests/login.test.js) ───────────────────
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
// IncomingMessage Node); senza body → stream vuoto (rotta protetta).
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

// ── Helpers token ───────────────────────────────────────────────────────────
// Firma un token con il secret/issuer di test (jose, come il middleware).
async function signToken({
  sub = TEST_USERNAME,
  expiresInSeconds = 60,
  secret = TEST_SECRET,
  issuer = TEST_ISSUER,
  algorithm = 'HS256',
  extraClaims = {},
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub, ...extraClaims })
    .setProtectedHeader({ alg: algorithm })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .setIssuer(issuer)
    .sign(new TextEncoder().encode(secret));
}

// Manomissione del payload: decodifica, muta i claim, ricodifica in base64url
// SENZA rifirmare — la firma resta quella del token originale.
function tamperPayload(token, mutate) {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const tampered = mutate(claims);
  const newPayload = Buffer.from(JSON.stringify(tampered)).toString(
    'base64url'
  );
  return `${header}.${newPayload}.${signature}`;
}

// Altera un byte della firma: decodifica base64url, flip del byte centrale,
// ricodifica. (Flippare l'ULTIMO carattere non basta: i bit finali di un
// base64url senza padding sono padding, il valore decodificato non cambia.)
function tamperSignature(token) {
  const [header, payload, signature] = token.split('.');
  const bytes = Buffer.from(signature, 'base64url');
  const mid = Math.floor(bytes.length / 2);
  bytes[mid] = bytes[mid] ^ 0xff;
  const tamperedSig = bytes.toString('base64url');
  return `${header}.${payload}.${tamperedSig}`;
}

async function login() {
  const res = makeRes();
  await loginHandler(
    makeReq({ body: { username: TEST_USERNAME, password: TEST_PASSWORD } }),
    res
  );
  return res;
}

// ── Flusso integrato: login → rotta protetta ────────────────────────────────
describe('flusso integrato: login → /api/cache-refresh (protetta)', () => {
  test('successo: login 200 → token → rotta protetta 200', async () => {
    const loginRes = await login();
    expect(loginRes.statusCode).toBe(200);
    const { accessToken } = parseBody(loginRes);
    expect(accessToken.split('.')).toHaveLength(3);

    // Il token emesso da login supera la verifica del middleware (stesso
    // secret condiviso tra issuer e verifier).
    const claims = await verifyAccessToken(accessToken, process.env);
    expect(claims.sub).toBe(TEST_USERNAME);

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.success).toBe(true);
    expect(body.stats.success).toBe(1);
    expect(getRepoForLanguage).toHaveBeenCalledWith(
      'test-pat',
      'test-owner',
      expect.objectContaining({ id: 'js' }),
      expect.any(Array)
    );
  });

  test('credenziali errate → 401 invalid_credentials, nessun token', async () => {
    const res = makeRes();
    await loginHandler(
      makeReq({ body: { username: TEST_USERNAME, password: 'wrong' } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(parseBody(res)).toEqual({ error: 'invalid_credentials' });
    expect(res.body).not.toContain('accessToken');
  });

  test('token scaduto → 401 EXPIRED_TOKEN, handler mai eseguito', async () => {
    const expired = await signToken({ expiresInSeconds: -10 });
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${expired}` } }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe(AUTH_CODES.EXPIRED_TOKEN);
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('token manomesso (payload sub alterato, firma invariata) → 401 INVALID_TOKEN', async () => {
    const valid = await signToken();
    const tampered = tamperPayload(valid, (claims) => ({
      ...claims,
      sub: 'attacker',
    }));
    expect(tampered).not.toBe(valid);

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${tampered}` } }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe(AUTH_CODES.INVALID_TOKEN);
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('token manomesso (un carattere della firma alterato) → 401 INVALID_TOKEN', async () => {
    const valid = await signToken();
    const tampered = tamperSignature(valid);
    expect(tampered).not.toBe(valid);

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${tampered}` } }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe(AUTH_CODES.INVALID_TOKEN);
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('token firmato con secret diverso → 401 INVALID_TOKEN', async () => {
    const forged = await signToken({ secret: 'attacker-secret' });
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${forged}` } }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe(AUTH_CODES.INVALID_TOKEN);
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('token mancante → 401 MISSING_TOKEN, handler mai eseguito', async () => {
    const res = makeRes();
    await cacheRefreshHandler(makeReq({ headers: {} }), res);

    expect(res.statusCode).toBe(401);
    const body = parseBody(res);
    expect(body.code).toBe(AUTH_CODES.MISSING_TOKEN);
    expect(body.error).toBe('Unauthorized');
    expect(res.headers['WWW-Authenticate']).toBe(
      'Bearer realm="github-slot-machine"'
    );
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('header non-Bearer → 401 MALFORMED_TOKEN', async () => {
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: 'Basic Zm9vOmJhcg==' } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe(AUTH_CODES.MALFORMED_TOKEN);
  });
});

// ── Verifica token: casi di manomissione a livello unitario ─────────────────
describe('verifyAccessToken — token manomesso (unità)', () => {
  test('rifiuta un token con payload alterato (firma non valida per i nuovi claim)', async () => {
    const valid = await signToken({ extraClaims: { role: 'user' } });
    const tampered = tamperPayload(valid, (claims) => ({
      ...claims,
      role: 'admin',
    }));

    await expect(verifyAccessToken(tampered, process.env)).rejects.toThrow(
      /signature/i
    );
  });

  test('rifiuta un token con firma alterata', async () => {
    const valid = await signToken();
    const tampered = tamperSignature(valid);

    await expect(verifyAccessToken(tampered, process.env)).rejects.toThrow(
      /signature/i
    );
  });

  test('accetta il token originale (controllo che la manomissione sia reale)', async () => {
    const valid = await signToken();
    const claims = await verifyAccessToken(valid, process.env);
    expect(claims.sub).toBe(TEST_USERNAME);
    expect(claims.iss).toBe(TEST_ISSUER);
  });
});

// ── Flusso asimmetrico RS256 (follow-up t_8e9d78bc) ─────────────────────────
// End-to-end: genera una keypair RSA nel test, firma con issueAccessToken
// (via /api/auth/login) e verifica con requireAuth (via /api/cache-refresh).
// Prima del fix, verifyAccessToken usava sempre una chiave HMAC
// (TextEncoder del secret): con JWT_ALGORITHM=RS256 ogni richiesta cadeva in
// 401 INVALID_TOKEN (TypeError: Key for the RS256 algorithm must be one of
// type CryptoKey...). Ora la chiave di verifica è derivata dal PEM privato.
describe('flusso asimmetrico RS256: login → token → rotta protetta', () => {
  // Keypair RSA dedicata a questo blocco: JWT_SECRET = PEM privato (PKCS8).
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const { privateKey: otherKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const OTHER_PRIVATE_PEM = otherKey.export({ type: 'pkcs8', format: 'pem' });

  test('login emette token RS256 che supera la verifica di requireAuth', async () => {
    setEnv({ JWT_SECRET: PRIVATE_PEM, JWT_ALGORITHM: 'RS256' });

    const loginRes = await login();
    expect(loginRes.statusCode).toBe(200);
    const { accessToken } = parseBody(loginRes);
    expect(accessToken.split('.')).toHaveLength(3);

    // Il token emesso da issueAccessToken (firma RS256 con chiave privata)
    // supera la verifica di requireAuth (chiave pubblica derivata dal PEM).
    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${accessToken}` } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(getRepoForLanguage).toHaveBeenCalledTimes(1);
  });

  test('token RS256 firmato con ALTRA keypair → 401 INVALID_TOKEN', async () => {
    setEnv({ JWT_SECRET: PRIVATE_PEM, JWT_ALGORITHM: 'RS256' });

    // Firma con una chiave privata diversa (attaccante): la verifica deve
    // fallire nonostante l'algoritmo e l'issuer corretti.
    const now = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(await importPKCS8(OTHER_PRIVATE_PEM, 'RS256'));

    const res = makeRes();
    await cacheRefreshHandler(
      makeReq({ headers: { authorization: `Bearer ${forged}` } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(parseBody(res).code).toBe(AUTH_CODES.INVALID_TOKEN);
    expect(getRepoForLanguage).not.toHaveBeenCalled();
  });

  test('verifyAccessToken verifica direttamente un token RS256 (issueAccessToken)', async () => {
    setEnv({ JWT_SECRET: PRIVATE_PEM, JWT_ALGORITHM: 'RS256' });
    const issued = await (
      await import('../api/_lib/token-issuer.js')
    ).issueAccessToken(TEST_USERNAME);
    const claims = await verifyAccessToken(issued.accessToken, process.env);
    expect(claims.sub).toBe(TEST_USERNAME);
    expect(claims.iss).toBe(TEST_ISSUER);
  });
});
