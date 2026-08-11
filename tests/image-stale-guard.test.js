// ─── Test guard anti-stale di /api/image (fix "risultato precedente") ───────
// Quando la scrittura KV del nuovo slot.svg fallisce durante uno spin, KV
// conserva la copia VECCHIA. image.js legge KV per primo: senza guard,
// servirebbe il risultato PRECEDENTE ignorando il GitHub appena aggiornato.
// Il guard confronta lo uid dell'SVG (slot-title-<uid>) con
// state.lastPullTimestamp: se uid < lastPull → la copia KV è STALE → ricade
// sul fallback GitHub.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock logger (S15, O3) ────────────────────────────────────────────────────
vi.mock('../api/_lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  LEVELS: ['debug', 'info', 'warn', 'error'],
  LOG_LEVEL: 'info',
  MIN_LEVEL_IDX: 1,
  ENABLED: ['info', 'warn', 'error'],
}));

// ── Mock KV: store in-memory controllabile ──────────────────────────────────
const kvStore = vi.hoisted(() => new Map());
vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: true,
  kvGet: vi.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null)),
  kvSet: vi.fn(),
}));

// ── Mock cooldown: teniamo un riferimento per asserire che image.js NON lo
//    chiami più (bug t_a81cdf35: il check-and-set di checkSpinCooldown su un
//    GET passivo registrava l'IP e faceva rifiutare lo spin successivo). ─────
const cooldownMock = vi.hoisted(() => ({
  checkSpinCooldown: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('../api/_lib/spin-cooldown.js', () => cooldownMock);

vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn(), captureException: vi.fn() },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { default: handler, extractSvgUid } = await import('../api/image.js');
const { logger } = await import('../api/_lib/logger.js');

function makeRes() {
  const headers = {};
  const res = {
    headers,
    statusCode: 200,
    body: null,
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
      headers.Location = u;
      return this;
    },
  };
  return res;
}

function ghResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

const GH_URL =
  'https://api.github.com/repos/simrim96/GithubSlotMachine/contents/slot.svg';

describe('extractSvgUid', () => {
  it('estrae lo uid da slot-title-<uid> e slot-desc-<uid>', () => {
    expect(extractSvgUid('<svg>slot-title-1786281466709</svg>')).toBe(
      1786281466709
    );
    expect(extractSvgUid('<svg>slot-desc-42</svg>')).toBe(42);
  });

  it('ritorna null per SVG senza uid o input non stringa', () => {
    expect(extractSvgUid('<svg>no uid here</svg>')).toBeNull();
    expect(extractSvgUid(null)).toBeNull();
    expect(extractSvgUid(undefined)).toBeNull();
    expect(extractSvgUid(123)).toBeNull();
  });
});

describe('/api/image — guard anti-stale (KV vs state.lastPullTimestamp)', () => {
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    kvStore.clear();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      ghResponse({
        content: Buffer.from('<svg>github-fallback</svg>').toString('base64'),
      })
    );
    process.env.GITHUB_PAT = 'tok-stale-guard';
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    delete process.env.GITHUB_PAT;
  });

  const req = { method: 'GET', query: {}, headers: {} };

  it('KV fresco (uid == lastPullTimestamp): serve da KV, NESSUNA fetch GitHub', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1000</svg>');
    kvStore.set('gsm:state', { totalSpins: 5, lastPullTimestamp: 1000 });

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-1000</svg>');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("NON chiama checkSpinCooldown (bug t_a81cdf35: il check-and-set su un GET passivo registrava l'IP e faceva rifiutare lo spin successivo)", async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1000</svg>');
    kvStore.set('gsm:state', { totalSpins: 5, lastPullTimestamp: 1000 });

    const res = makeRes();
    await handler(req, res);

    // Se image.js chiamasse checkSpinCooldown, un GET dell'immagine
    // registrerebbe l'IP e /api/spin entro 3s verrebbe 302-rifiutato in
    // silenzio → l'utente rivede lo spin precedente.
    expect(cooldownMock.checkSpinCooldown).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-1000</svg>');
  });

  it('KV STALE (uid < lastPullTimestamp): ricade su GitHub (fresco) e logga', async () => {
    // La scrittura KV dello spin 2000 è fallita: KV ha ancora lo svg dello
    // spin 1000, ma lo stato dice che l'ultimo spin è il 2000.
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1000</svg>');
    kvStore.set('gsm:state', { totalSpins: 6, lastPullTimestamp: 2000 });

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>github-fallback</svg>');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(GH_URL, expect.anything());
    expect(logger.warn).toHaveBeenCalledWith(
      'kv slotSvg is stale (uid < lastPullTimestamp), falling back to github',
      expect.objectContaining({ svgUid: 1000, lastPull: 2000 })
    );
  });

  it('GitHub fallback PIÙ VECCHIO della copia KV: serve la copia KV (la più fresca disponibile)', async () => {
    // KV ha lo svg 1500 (stale vs lastPull 2000) ma GitHub è ANCHE più
    // vecchio (1000, propagazione Contents API lenta / PUT fallita):
    // serve KV, non ciecamente GitHub.
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1500</svg>');
    kvStore.set('gsm:state', { totalSpins: 6, lastPullTimestamp: 2000 });
    globalThis.fetch = vi.fn().mockResolvedValue(
      ghResponse({
        content: Buffer.from('<svg>slot-title-1000</svg>').toString('base64'),
      })
    );

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-1500</svg>');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'github slot.svg older than kv copy, serving kv',
      expect.objectContaining({ ghUid: 1000, svgUid: 1500 })
    );
  });

  it('KV fresco ma stato assente: serve da KV (il guard non può giudicare, nessuna regressione)', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1000</svg>');
    // gsm:state assente → lastPullTimestamp non disponibile

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-1000</svg>');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('SVG senza uid estraibile: serve da KV (guard skip)', async () => {
    kvStore.set('gsm:slotSvg', '<svg data-testid="slot-svg"></svg>');
    kvStore.set('gsm:state', { totalSpins: 6, lastPullTimestamp: 2000 });

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg data-testid="slot-svg"></svg>');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('KV vuoto: fallback GitHub (comportamento storico invariato)', async () => {
    // kvStore vuoto → nessun svg in KV
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>github-fallback</svg>');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('lastPullTimestamp come stringa: coerce a numero, guard funziona comunque', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1000</svg>');
    kvStore.set('gsm:state', { totalSpins: 6, lastPullTimestamp: '2000' });

    const res = makeRes();
    await handler(req, res);

    expect(res.body).toBe('<svg>github-fallback</svg>');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('/api/image — self-heal URL ?v stantia (fix t_308e49dc)', () => {
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    kvStore.clear();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      ghResponse({
        content: Buffer.from('<svg>github-fallback</svg>').toString('base64'),
      })
    );
    process.env.GITHUB_PAT = 'tok-stale-guard';
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    delete process.env.GITHUB_PAT;
  });

  it('?v più vecchio di lastPullTimestamp → 302 a /api/image?v=<lastPull>, NESSUNA fetch GitHub', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-3000</svg>');
    kvStore.set('gsm:state', { totalSpins: 7, lastPullTimestamp: 3000 });

    const res = makeRes();
    await handler({ method: 'GET', query: { v: '1000' } }, res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/api/image?v=3000');
    expect(res.headers['Cache-Control']).toBe('no-store');
    // L'URL vecchio viene corretto PRIMA di servire qualsiasi contenuto.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('?v == lastPull → 200 da KV, nessun redirect', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-3000</svg>');
    kvStore.set('gsm:state', { totalSpins: 7, lastPullTimestamp: 3000 });

    const res = makeRes();
    await handler({ method: 'GET', query: { v: '3000' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-3000</svg>');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('?v > lastPull (clock skew/forward) → 200 da KV, nessun redirect', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-3000</svg>');
    kvStore.set('gsm:state', { totalSpins: 7, lastPullTimestamp: 3000 });

    const res = makeRes();
    await handler({ method: 'GET', query: { v: '9999' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-3000</svg>');
  });

  it('senza ?v → 200 diretto, nessun redirect (curl e embed senza query invariati)', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-3000</svg>');
    kvStore.set('gsm:state', { totalSpins: 7, lastPullTimestamp: 3000 });

    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-3000</svg>');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('?v non numerico → 200 diretto, nessun redirect', async () => {
    kvStore.set('gsm:slotSvg', '<svg>slot-title-3000</svg>');
    kvStore.set('gsm:state', { totalSpins: 7, lastPullTimestamp: 3000 });

    const res = makeRes();
    await handler({ method: 'GET', query: { v: 'abc' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-3000</svg>');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("?v stantio ma KV vuoto (fallback GitHub): il 302 scatta comunque (corregge l'URL prima del contenuto)", async () => {
    kvStore.set('gsm:state', { totalSpins: 7, lastPullTimestamp: 3000 });

    const res = makeRes();
    await handler({ method: 'GET', query: { v: '1000' } }, res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/api/image?v=3000');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('/api/image — retry anti-propagazione sul fallback GitHub (fix t_308e49dc)', () => {
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    kvStore.clear();
    originalFetch = globalThis.fetch;
    process.env.GITHUB_PAT = 'tok-stale-guard';
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    delete process.env.GITHUB_PAT;
  });

  it('GitHub serve SVG STALE (uid < lastPull) → rilegge una volta e serve il fresco', async () => {
    // KV svg assente (fallback GitHub attivo), stato con l'ultimo spin = 2000.
    kvStore.set('gsm:state', { totalSpins: 8, lastPullTimestamp: 2000 });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ghResponse({
          content: Buffer.from('<svg>slot-title-1000</svg>').toString('base64'),
        })
      )
      .mockResolvedValueOnce(
        ghResponse({
          content: Buffer.from('<svg>slot-title-2000</svg>').toString('base64'),
        })
      );

    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-2000</svg>');
  });

  it('GitHub serve STALE due volte → serve il migliore disponibile e logga il retry', async () => {
    kvStore.set('gsm:state', { totalSpins: 8, lastPullTimestamp: 2000 });

    globalThis.fetch = vi.fn().mockResolvedValue(
      ghResponse({
        content: Buffer.from('<svg>slot-title-1000</svg>').toString('base64'),
      })
    );

    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-1000</svg>');
    expect(logger.warn).toHaveBeenCalledWith(
      'github fallback svg stale vs lastPull, retrying once (CDN propagation)',
      expect.objectContaining({ uid: 1000, lastPull: 2000 })
    );
  });

  it('GitHub fresco (uid >= lastPull) → UNA sola fetch, nessun retry', async () => {
    kvStore.set('gsm:state', { totalSpins: 8, lastPullTimestamp: 2000 });

    globalThis.fetch = vi.fn().mockResolvedValue(
      ghResponse({
        content: Buffer.from('<svg>slot-title-2000</svg>').toString('base64'),
      })
    );

    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(res.body).toBe('<svg>slot-title-2000</svg>');
  });

  it('GitHub più fresco della copia KV ma ancora STALE vs lastPull → retry e serve il fresco', async () => {
    // KV ha 1000, GitHub (prima lettura) ha 2000, l'ultimo spin è 3000:
    // il retry vale la pena perché GitHub è il candidato migliore.
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1000</svg>');
    kvStore.set('gsm:state', { totalSpins: 9, lastPullTimestamp: 3000 });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        ghResponse({
          content: Buffer.from('<svg>slot-title-2000</svg>').toString('base64'),
        })
      )
      .mockResolvedValueOnce(
        ghResponse({
          content: Buffer.from('<svg>slot-title-3000</svg>').toString('base64'),
        })
      );

    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-3000</svg>');
  });

  it("GitHub più VECCHIO della copia KV (già coperto dall'hardening) → NESSUN retry, serve KV", async () => {
    // KV ha 1500 (stale vs lastPull 2000) ma GitHub è ancora più vecchio
    // (1000): l'hardening serve KV; il retry non cambierebbe l'esito.
    kvStore.set('gsm:slotSvg', '<svg>slot-title-1500</svg>');
    kvStore.set('gsm:state', { totalSpins: 6, lastPullTimestamp: 2000 });

    globalThis.fetch = vi.fn().mockResolvedValue(
      ghResponse({
        content: Buffer.from('<svg>slot-title-1000</svg>').toString('base64'),
      })
    );

    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg>slot-title-1500</svg>');
    expect(logger.warn).toHaveBeenCalledWith(
      'github slot.svg older than kv copy, serving kv',
      expect.objectContaining({ ghUid: 1000, svgUid: 1500 })
    );
  });
});
