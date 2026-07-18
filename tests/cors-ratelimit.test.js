// Behavioral test for issue #16: /api/spin must enforce a per-IP rate limit and
// emit an explicit CORS policy. The pure rateLimit()/clientIp() functions are
// already covered by ratelimit.test.js — here we verify they are actually
// WIRED INTO the handler (they previously were dead code) and that CORS headers
// are present on the response.
//
// We drive the real default handler from api/spin.js with a mock `res`, no
// network. With no UPSTASH env, rateLimit falls back to its in-memory bucket.

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../api/spin.js';
import { getMemBucket } from '../api/_lib/ratelimit.js';

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
  // Isola il bucket in-memory del rate-limit fra i test.
  getMemBucket().clear();
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

describe('Rate-limit per-IP su /api/spin', () => {
  it('il primo spin dello stesso IP passa (raggiunge il check del token)', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);

    // Passa il rate-limit, poi 500 per mancanza di GITHUB_PAT (token check).
    expect(res.statusCode).toBe(500);
  });

  it('un secondo spin immediato dello STESSO IP viene bloccato con 429', async () => {
    const ip = '198.51.100.2';
    const req = () => ({
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
      query: {},
    });

    const first = makeRes();
    await handler(req(), first);
    expect(first.statusCode).toBe(500); // ha superato il rate-limit

    const second = makeRes();
    await handler(req(), second);
    expect(second.statusCode).toBe(429);
    expect(second.headers['Retry-After']).toBeDefined();
    expect(Number(second.headers['Retry-After'])).toBeGreaterThan(0);
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

  it('un IP bloccato NON tocca il check del token (429 prima di 500)', async () => {
    const ip = '198.51.100.5';
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
      query: {},
    };
    const first = makeRes();
    await handler(req, first); // consuma il bucket
    const blocked = makeRes();
    await handler(req, blocked); // stesso IP, immediato → bloccato

    // Se il rate-limit fosse morto, questo sarebbe 500 (no token) invece di 429.
    expect(blocked.statusCode).toBe(429);
  });
});
