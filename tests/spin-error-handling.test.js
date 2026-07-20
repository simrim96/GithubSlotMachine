// ─── Test: gestione errore globale in spin.js (Miglioramento #3) ────────────
// Verifica che un'eccezione imprevista nel percorso principale dello spin NON
// produca mai un 500 nudo: l'handler deve degradare graceful rispondendo con
// un redirect (302) verso il profilo dell'owner (o, in extremis, con un SVG di
// errore grezzo), e non con status 500.
//
// Forziamo l'errore mockando generateGrid() perché lanci, così il flusso
// entra nel blocco catch() di spin.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sentry: niente init reale in test. spin.js importa '../sentry.config.js'
// (dalla root del progetto), quindi il mock deve puntare lì.
vi.mock('../sentry.config.js', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// Forza generateGrid() a lanciare per innescare il catch globale.
vi.mock('../api/_lib/game.js', async () => {
  const actual = await vi.importActual('../api/_lib/game.js');
  return {
    ...actual,
    generateGrid: vi.fn(() => {
      throw new Error('boom: injected failure');
    }),
  };
});

// Mock delle dipendenze di rete così il catch non tocca GitHub/Redis.
vi.mock('../api/_lib/github.js', () => ({
  ghGet: vi.fn(),
  ghPut: vi.fn(),
  saveSlotSvg: vi.fn().mockResolvedValue({}),
  loadSlotSvg: vi.fn().mockResolvedValue({ content: '', sha: null }),
  updateReadmeMarkers: vi.fn((r) => r),
}));

vi.mock('../api/_lib/state.js', () => ({
  readState: vi.fn().mockResolvedValue({
    state: { totalSpins: 0, totalWins: 0, lastWin: null },
    sha: 'sha',
  }),
  writeState: vi.fn().mockResolvedValue({ sha: 'sha' }),
}));

vi.mock('../api/_lib/svg-builder-accessible.js', async () => {
  const actual = await vi.importActual('../api/_lib/svg-builder-accessible.js');
  return actual;
});

vi.mock('../api/_lib/repos.js', () => ({
  getRepoForLanguage: vi.fn().mockResolvedValue(null),
}));

vi.mock('../api/_lib/ratelimit.js', () => ({
  isValidUser: vi.fn(() => true),
}));

import handler from '../api/spin.js';

// ── Mock response ──────────────────────────────────────────────────────────
function makeRes() {
  const headers = {};
  let statusCode = 0;
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
      ended = true;
      return this;
    },
    end() {
      ended = true;
      return this;
    },
    redirect(c, u) {
      statusCode = c;
      headers.Location = u;
      ended = true;
      return this;
    },
  };
  return res;
}

describe('Miglioramento #3 — gestione errore globale (no 500 nudo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Token presente: superiamo la guardia e arriviamo a generateGrid().
    process.env.GITHUB_PAT = 'test-token-12345';
  });

  it('un errore imprevisto degrada a redirect 302 (mai 500)', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.91' },
      query: {},
    };
    const res = makeRes();

    await handler(req, res);

    // NESSUN 500: il catch deve rispondere con un redirect graceful.
    expect(res.statusCode).toBe(302);
    expect(res.statusCode).not.toBe(500);
    expect(res.headers.Location).toBeDefined();
    expect(res.headers.Location).toContain('github.com');
  });

  it('il redirect di errore non è un open-redirect verso host estranei', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.92' },
      query: { redirect: 'https://evil.example.com/phish' },
    };
    const res = makeRes();

    await handler(req, res);

    // Anche in caso di errore, il redirect validato blocca l'open-redirect:
    // cade sul default (profilo owner), non sull'host malizioso.
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).not.toContain('evil.example.com');
    expect(res.headers.Location).toContain('github.com');
  });

  it('in extremis (redirect fallito) risponde con SVG di errore, non 500', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.93' },
      query: {},
    };
    // Mock res che fa fallire redirect() per simulare headers già inviati.
    const headers = {};
    const res = {
      headers,
      statusCode: 0,
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
      redirect() {
        throw new Error('headers already sent');
      },
    };

    await handler(req, res);

    // Ultimo baluardo: niente 500 nudo, ma un SVG di errore valido (200).
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('Errore');
  });
});
