// Test del middleware di verifica JWT (api/_lib/require-auth.js).
//
// Criterio di accettazione (task t_d19eabc1):
//   • richieste senza token o con token invalido ricevono 401;
//   • richieste con token valido proseguono (req.user iniettato).
//
// Casi coperti:
//   - token mancante (nessun header Authorization)           → 401 MISSING_TOKEN
//   - header presente ma non-Bearer (es. "Basic …")          → 401 MALFORMED_TOKEN
//   - token malformato (non-JWT, es. "abc")                  → 401 MALFORMED_TOKEN
//   - token scaduto                                          → 401 EXPIRED_TOKEN
//   - firma errata (secret diverso)                          → 401 INVALID_TOKEN
//   - issuer errato                                          → 401 INVALID_TOKEN
//   - token valido                                           → handler chiamato, req.user
//   - OPTIONS (preflight CORS) passa senza token
//   - applicazione reale: /api/cache-refresh senza token → 401

import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import {
  requireAuth,
  extractBearerToken,
  verifyAccessToken,
  sendUnauthorized,
  AUTH_CODES,
} from '../api/_lib/require-auth.js';

// ── Env di test: secret e issuer fissi (mai i default di produzione) ────────
const TEST_ENV = {
  JWT_SECRET: 'test-secret-require-auth-123',
  JWT_ALGORITHM: 'HS256',
  JWT_ISSUER: 'test-issuer',
  NODE_ENV: 'test',
};

// ── Helper: firma un token con i claim desiderati ───────────────────────────
async function signToken({
  sub = 'user-42',
  issuer = TEST_ENV.JWT_ISSUER,
  expiresInSeconds = 60,
  secret = TEST_ENV.JWT_SECRET,
  algorithm = 'HS256',
  extraClaims = {},
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  let builder = new SignJWT({ sub, ...extraClaims })
    .setProtectedHeader({ alg: algorithm })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds);
  if (issuer) builder = builder.setIssuer(issuer);
  return builder.sign(new TextEncoder().encode(secret));
}

// ── Helper: mock response compatibile con sendResponse ──────────────────────
function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body = '';
  let ended = false;
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
    setHeader(k, v) {
      headers[k] = v;
      return this;
    },
    status(c) {
      statusCode = c;
      return this;
    },
    send(b) {
      body = b;
      return this;
    },
    end() {
      ended = true;
      return this;
    },
    redirect(c, u) {
      statusCode = c;
      headers.Location = u;
      return this;
    },
  };
  return res;
}

describe('extractBearerToken', () => {
  it('estrae il token da Authorization: Bearer <token>', () => {
    expect(
      extractBearerToken({ headers: { authorization: 'Bearer abc.def.ghi' } })
    ).toBe('abc.def.ghi');
  });

  it('è case-insensitive sullo schema Bearer', () => {
    expect(
      extractBearerToken({ headers: { authorization: 'bearer abc.def.ghi' } })
    ).toBe('abc.def.ghi');
  });

  it('tollera spazi extra attorno al valore', () => {
    expect(
      extractBearerToken({
        headers: { authorization: '  Bearer  abc.def.ghi  ' },
      })
    ).toBe('abc.def.ghi');
  });

  it("ritorna null se l'header è assente", () => {
    expect(extractBearerToken({ headers: {} })).toBeNull();
    expect(extractBearerToken({})).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it('ritorna null per schema non-Bearer', () => {
    expect(
      extractBearerToken({ headers: { authorization: 'Basic abc' } })
    ).toBeNull();
  });

  it('supporta il formato Web headers.get()', () => {
    const headers = {
      get: (name) =>
        name === 'authorization' ? 'Bearer web.token.here' : null,
    };
    expect(extractBearerToken({ headers })).toBe('web.token.here');
  });
});

describe('verifyAccessToken', () => {
  it('verifica un token firmato con la config condivisa', async () => {
    const token = await signToken();
    const payload = await verifyAccessToken(token, TEST_ENV);
    expect(payload.sub).toBe('user-42');
    expect(payload.iss).toBe('test-issuer');
  });

  it('rifiuta un token scaduto', async () => {
    const token = await signToken({ expiresInSeconds: -10 });
    await expect(verifyAccessToken(token, TEST_ENV)).rejects.toThrow();
  });

  it('rifiuta un token con firma errata', async () => {
    const token = await signToken({ secret: 'wrong-secret' });
    await expect(verifyAccessToken(token, TEST_ENV)).rejects.toThrow();
  });

  it('rifiuta un token con issuer diverso dalla config', async () => {
    const token = await signToken({ issuer: 'evil-issuer' });
    await expect(verifyAccessToken(token, TEST_ENV)).rejects.toThrow();
  });

  it('rifiuta un token malformato', async () => {
    await expect(verifyAccessToken('not-a-jwt', TEST_ENV)).rejects.toThrow();
  });
});

describe('requireAuth — middleware', () => {
  it("401 MISSING_TOKEN senza header Authorization (l'handler non viene chiamato)", async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const req = { method: 'GET', headers: {} };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe(
      'Bearer realm="github-slot-machine"'
    );
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe(AUTH_CODES.MISSING_TOKEN);
    expect(inner).not.toHaveBeenCalled();
  });

  it('401 MALFORMED_TOKEN con header non-Bearer (es. Basic)', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const req = {
      method: 'GET',
      headers: { authorization: 'Basic Zm9vOmJhcg==' },
    };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe(AUTH_CODES.MALFORMED_TOKEN);
    expect(inner).not.toHaveBeenCalled();
  });

  it('401 MALFORMED_TOKEN con token non-JWT', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const req = { method: 'GET', headers: { authorization: 'Bearer abc' } };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe(AUTH_CODES.MALFORMED_TOKEN);
    expect(inner).not.toHaveBeenCalled();
  });

  it('401 EXPIRED_TOKEN con token scaduto', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const token = await signToken({ expiresInSeconds: -10 });
    const req = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe(AUTH_CODES.EXPIRED_TOKEN);
    expect(inner).not.toHaveBeenCalled();
  });

  it('401 INVALID_TOKEN con firma errata', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const token = await signToken({ secret: 'another-secret' });
    const req = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe(AUTH_CODES.INVALID_TOKEN);
    expect(inner).not.toHaveBeenCalled();
  });

  it('401 INVALID_TOKEN con issuer errato', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const token = await signToken({ issuer: 'evil-issuer' });
    const req = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe(AUTH_CODES.INVALID_TOKEN);
    expect(inner).not.toHaveBeenCalled();
  });

  it('token valido → handler chiamato e req.user iniettato', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const token = await signToken({
      sub: 'user-42',
      extraClaims: { role: 'admin' },
    });
    const req = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.sub).toBe('user-42');
    expect(req.user.role).toBe('admin');
    expect(req.user.iss).toBe('test-issuer');
  });

  it('OPTIONS (preflight CORS) passa senza token', async () => {
    const inner = vi.fn(async () => {});
    const protectedHandler = requireAuth(inner, { env: TEST_ENV });

    const req = {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com' },
    };
    const res = makeRes();
    await protectedHandler(req, res);

    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('le risposte 401 non hanno cache (Cache-Control: no-store)', async () => {
    const protectedHandler = requireAuth(
      vi.fn(async () => {}),
      { env: TEST_ENV }
    );
    const res = makeRes();
    await protectedHandler({ method: 'GET', headers: {} }, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

describe('sendUnauthorized — contratto di risposta', () => {
  it('risponde 401 con body JSON e WWW-Authenticate', () => {
    const res = makeRes();
    sendUnauthorized(res, AUTH_CODES.EXPIRED_TOKEN);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe(
      'Bearer realm="github-slot-machine"'
    );
    const body = JSON.parse(res.body);
    expect(body.code).toBe(AUTH_CODES.EXPIRED_TOKEN);
    expect(body.message).toMatch(/scaduto/i);
  });

  it('accetta un message personalizzato', () => {
    const res = makeRes();
    sendUnauthorized(res, AUTH_CODES.MISSING_TOKEN, 'Vai a /auth/login');
    expect(JSON.parse(res.body).message).toBe('Vai a /auth/login');
  });
});

// ── Applicazione reale: /api/cache-refresh è protetto da require-auth ───────
describe('applicazione: /api/cache-refresh è protetto', () => {
  it('senza token → 401 (prima ancora di toccare GITHUB_PAT)', async () => {
    // Il modulo legge process.env a import-time per la config JWT: usiamo
    // l'env di test così il middleware arriva fino alla verifica del token.
    const handler = (await import('../api/cache-refresh.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe(AUTH_CODES.MISSING_TOKEN);
  });
});
