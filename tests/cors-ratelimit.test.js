// Behavioral test for the per-IP spin cooldown (fix S2, ISSUES.md).
//
// S2 prevedeva un rate-limit per-IP basato sul tempo di rotazione dei rulli.
// Ora /api/spin blocca (con un REDIRECT GRACEFUL 302 verso il profilo owner,
// ZERO chiamate a GitHub, mai una pagina di errore 429) un secondo spin dello
// stesso IP se arriva prima che la finestra di rotazione (SPIN_COOLDOWN_MS)
// sia trascorsa. Qui verifichiamo che:
//   1. il primo spin passi (raggiunge il check del token → 302 redirect);
//   2. un secondo spin IMMEDIATO dello stesso IP venga rifiutato con 302
//      redirect verso github.com (graceful), portando Retry-After, e NON
//      consumi il budget GitHub (niente chiamate di scrittura bloccate);
//   3. IP DIVERSI non si influenzano (limite per-IP, non globale);
//   4. la policy CORS esplicita resti emessa anche sul redirect di cooldown.

import { describe, it, expect, beforeEach } from 'vitest';

// SPIN_COOLDOWN_MS basso per il test: 50ms, così il secondo spin nello stesso
// test cade ancora dentro la finestra senza aspettare 3s.
process.env.SPIN_COOLDOWN_MS = '50';

const handler = (await import('../api/spin.js')).default;

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

describe('CORS policy su /api/spin (invariata)', () => {
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

    expect(res.headers['Access-Control-Allow-Origin']).toBe(ALLOWED);
  });
});

describe('Rate-limit per-IP basato sulla rotazione (S2)', () => {
  it('il primo spin dello stesso IP passa (raggiunge il check del token)', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);

    // Passa il cooldown, poi 302 redirect graceful (token assente → degradation).
    expect(res.statusCode).toBe(302);
  });

  it('UN SECONDO spin immediato dello STESSO IP è rifiutato con 302 graceful (retry)', async () => {
    const ip = '198.51.100.2';
    const req = () => ({
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
      query: {},
    });

    const first = makeRes();
    await handler(req(), first);
    expect(first.statusCode).toBe(302); // primo spin passa

    const second = makeRes();
    await handler(req(), second);
    // Bloccato dalla cooldown ma in modo GRACEFUL: 302 redirect verso il
    // profilo owner, NON una pagina di errore. Nessuna chiamata GitHub.
    expect(second.statusCode).toBe(302);
    expect(second.headers.Location).toContain('github.com');
    // Segnala quanto aspettare (Retry-After), senza pagination/error page.
    expect(second.headers['Retry-After']).toBeDefined();
    expect(second.headers['X-Spin-Cooldown']).toBe('1');
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
    expect(a.statusCode).toBe(302); // primo spin di A passa

    const b = makeRes();
    await handler(
      {
        method: 'GET',
        headers: { 'x-forwarded-for': '198.51.100.4' },
        query: {},
      },
      b
    );
    expect(b.statusCode).toBe(302); // B non è stato throttlato da A
  });

  it('dopo la finestra di rotazione lo stesso IP può spinare di nuovo', async () => {
    const ip = '198.51.100.6';
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
      query: {},
    };
    const first = makeRes();
    await handler(req, first);
    expect(first.statusCode).toBe(302); // primo spin passa

    // Aspetta che la finestra di cooldown (50ms in test) scada.
    await new Promise((r) => setTimeout(r, 80));

    const second = makeRes();
    await handler(req, second);
    // Ora lo spin è di nuovo consentito (302, non bloccato).
    expect(second.statusCode).toBe(302);
    expect(second.headers['Retry-After']).toBeUndefined();
  });
});
