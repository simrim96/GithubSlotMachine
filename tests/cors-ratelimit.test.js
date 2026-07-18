// Behavioral test for the per-IP rate-limit removal (ISSUE-1) and the CORS
// policy on /api/spin.
//
// The per-IP rate-limit (token-bucket 1 spin / 3s) was REMOVED: the user must
// be able to spin as many times as they want, even back-to-back, without ever
// receiving a "429 Troppe richieste". Here we verify that consecutive spins
// from the SAME IP are NOT throttled (they reach the token check / 500 when
// GITHUB_PAT is absent), and that the explicit CORS policy is still emitted.
//
// The pure rateLimit()/clientIp() functions are no longer exported from
// ratelimit.js (only isValidUser remains, covered by ratelimit.test.js). We
// drive the real default handler from api/spin.js with a mock `res`, no
// network. Even with no UPSTASH env, NO spin is ever blocked.

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../api/spin.js';

// ── Mock response ────────────────────────────────────────────────────────────
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

const ALLOWED = 'http://localhost:3000';
const DISALLOWED = 'https://evil.example.com';

beforeEach(() => {
  delete process.env.GITHUB_PAT; // forza il branch "no token" dopo il rate-limit
});

describe('CORS policy su /api/spin', () => {
  it('preflight OPTIONS 204 con header CORS per origin consentito', async () => {
    const req = {
      method: 'OPTIONS',
      headers: { origin: ALLOWED },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ALLOWED);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type');
    expect(res.headers['Access-Control-Max-Age']).toBe('86400');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('OPTIONS non emette ACAO per origin NON consentito', async () => {
    const req = {
      method: 'OPTIONS',
      headers: { origin: DISALLOWED },
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('GET con origin consentito riceve ACAO anche sul path normale', async () => {
    const req = {
      method: 'GET',
      headers: { origin: ALLOWED, 'x-forwarded-for': '203.0.113.9' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);

    // Nessun token → 500, ma applyCors() è già stato eseguito prima.
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ALLOWED);
  });
});

describe('Nessun rate-limit per-IP su /api/spin (ISSUE-1)', () => {
  it('il primo spin dello stesso IP passa (raggiunge il check del token)', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);

    // Passa qualsiasi rate-limit, poi 500 per mancanza di GITHUB_PAT (token check).
    expect(res.statusCode).toBe(500);
  });

  it('UN SECONDO spin immediato dello STESSO IP NON è bloccato (niente 429)', async () => {
    const ip = '198.51.100.2';
    const req = () => ({
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
      query: {},
    });

    const first = makeRes();
    await handler(req(), first);
    expect(first.statusCode).toBe(500); // ha superato il percorso

    const second = makeRes();
    await handler(req(), second);
    // Nessun rate-limit: anche di fila, mai 429. Raggiunge il token check (500).
    expect(second.statusCode).toBe(500);
    expect(second.headers['Retry-After']).toBeUndefined();
  });

  it('IP DIVERSI non si influenzano (limite per-IP, non globale)', async () => {
    const a = makeRes();
    await handler(
      {
        method: 'GET',
        headers: { 'x-forwarded-for': '198.51.100.3' },
        query: {},
      },
      a
    );
    expect(a.statusCode).toBe(500); // primo spin di A passa

    const b = makeRes();
    await handler(
      {
        method: 'GET',
        headers: { 'x-forwarded-for': '198.51.100.4' },
        query: {},
      },
      b
    );
    expect(b.statusCode).toBe(500); // B non è stato throttlato da A
  });

  it('spin ripetuti dello stesso IP non producono MAI 429', async () => {
    const ip = '198.51.100.5';
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
      query: {},
    };
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      await handler(req, res);
      // Mai 429: ogni spin arriva al check del token (500 per assenza PAT).
      expect(res.statusCode).toBe(500);
      expect(res.headers['Retry-After']).toBeUndefined();
    }
  });
});
