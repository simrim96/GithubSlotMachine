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

vi.mock('../api/_lib/spin-cooldown.js', () => ({
  checkSpinCooldown: async () => ({ allowed: true }),
}));

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
