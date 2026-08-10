// Verifica del fix ISSUE-25: gli endpoint SVG/immagine (/api/image e
// /api/lever) devono emettere `Access-Control-Allow-Origin: *` indipendentemente
// dall'origine della richiesta. Vengono embeddati in contesti cross-origin non
// deterministici (es. README su github.com), quindi non possiamo riflettere un
// Origin specifico: il wildcard `*` è la policy corretta per contenuti statici
// pubblici che non espongono credenziali.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/spin-cooldown.js', () => ({
  checkSpinCooldown: async () => ({ allowed: true }),
}));

const imageHandler = (await import('../api/image.js')).default;
const leverHandler = (await import('../api/lever.js')).default;

// Blocca qualunque fetch di rete (api.github.com) così il test resta offline.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  };
  return res;
}

// La scena critica: origine github.com (quella vera dell'embed in README).
const GH_ORIGIN = 'https://github.com';
const ARBITRARY_ORIGIN = 'https://some-fork.example.net';

describe('CORS wildcard su /api/image (ISSUE-25)', () => {
  it('OPTIONS emette ACAO:* anche con origine github.com', async () => {
    const res = makeRes();
    await imageHandler(
      { method: 'OPTIONS', headers: { origin: GH_ORIGIN } },
      res
    );
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.statusCode).toBe(204);
  });

  it('GET emette ACAO:* per qualsiasi origine (anche non allowlisted)', async () => {
    const res = makeRes();
    await imageHandler(
      { method: 'GET', headers: { origin: ARBITRARY_ORIGIN } },
      res
    );
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('GET emette ACAO:* anche senza header Origin', async () => {
    const res = makeRes();
    await imageHandler({ method: 'GET', headers: {} }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('mantiene gli altri header di sicurezza CORS', async () => {
    const res = makeRes();
    await imageHandler({ method: 'GET', headers: { origin: GH_ORIGIN } }, res);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('CORS wildcard su /api/lever (ISSUE-25)', () => {
  it('OPTIONS emette ACAO:* anche con origine github.com', () => {
    const res = makeRes();
    leverHandler({ method: 'OPTIONS', headers: { origin: GH_ORIGIN } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.statusCode).toBe(204);
  });

  it('GET emette ACAO:* per qualsiasi origine (anche non allowlisted)', () => {
    const res = makeRes();
    leverHandler({ method: 'GET', headers: { origin: ARBITRARY_ORIGIN } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('GET emette ACAO:* anche senza header Origin', () => {
    const res = makeRes();
    leverHandler({ method: 'GET', headers: {} }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
