// ─── Tests fix t_36b41bcb: il ?v del README avanza ANCHE quando la GET fallisce ──
// Bug: "a volte, eseguendo un nuovo spin, l'svg è quello dello spin precedente
// (stesso counter, stessa vincita/perdita, stesse icone nei rulli)".
//
// Causa radice: il README del profilo embedda `api/image?v=<spinStart>` come
// cache-buster verso Camo (che cachea PER URL). Quando la GET GitHub della
// README falliva (API lenta oltre l'800ms stretto, 429, timeout), readmePromise
// tornava SUBITO senza fare la PUT → il ?v non avanzava → a ogni spin Camo
// serviva l'SVG dello spin precedente (la richiesta non raggiungeva nemmeno
// /api/image, quindi il self-heal 302 non poteva scattare).
//
// Fix: copia "ultima nota" della README in KV (`gsm:readme:last-known:<owner>`,
// TTL 7gg), scritta a ogni GET riuscita e a ogni PUT. Quando la GET fallisce,
// readmePromise ricade su quella copia per far avanzare comunque il ?v: il
// contenuto può essere di qualche minuto fa, ma il ?v viene riscritto con
// spinStart e ghPut si auto-corregge su 409 (sha stale → refetch → PUT).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sentry.config.js', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ── Mock KV con store in-memory (simula Upstash) ───────────────────────────
const store = new Map();
vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: true,
  kvGet: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  kvSet: vi.fn(async (key, val) => {
    store.set(key, val);
    return true;
  }),
}));

// ── Mock state (lettura/scrittura contatori) ────────────────────────────────
vi.mock('../api/_lib/state.js', () => ({
  readState: vi.fn().mockResolvedValue({
    state: { totalSpins: 0, totalWins: 0, lastWin: null },
    sha: 'state-sha',
  }),
  writeState: vi.fn().mockResolvedValue({ sha: 'state-sha-2' }),
}));

// ── Mock GitHub network ──────────────────────────────────────────────────────
const README_BODY = [
  '# Profile',
  '',
  '<!-- SLOT_LAST_WIN_START -->',
  'old block',
  '<!-- SLOT_LAST_WIN_END -->',
  '',
  '![slot](https://github-slot-machine.vercel.app/api/image?v=123)',
  '',
].join('\n');

const { ghGetJson, ghPut } = vi.hoisted(() => ({
  ghGetJson: vi.fn(),
  ghPut: vi.fn(),
}));

vi.mock('../api/_lib/github.js', () => ({
  ghGetJson: ghGetJson,
  ghPut: ghPut,
  saveSlotSvg: vi.fn().mockResolvedValue({ sha: 'slot-sha-2' }),
  loadSlotSvg: vi.fn().mockResolvedValue({ content: '', sha: 'slot-sha' }),
  clearReadmeMarkers: vi.fn((r) => r),
  updateReadmeMarkers: vi.fn((r) => r),
  auditToken: vi.fn(),
  GH_CONTENTS_TIMEOUT_MS: 800,
}));

vi.mock('../api/_lib/repos.js', () => ({
  getRepoForLanguage: vi.fn().mockResolvedValue(null),
}));
vi.mock('../api/_lib/spin-cooldown.js', () => ({
  checkSpinCooldown: vi.fn().mockResolvedValue({ allowed: true }),
}));

const handler = (await import('../api/spin.js')).default;
const { kvSet } = await import('../api/_lib/kv.js');

function makeRes() {
  const headers = {};
  let statusCode = 200;
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    setHeader(k, v) {
      headers[k] = v;
      return this;
    },
    status(c) {
      statusCode = c;
      return this;
    },
    send() {
      return this;
    },
    end() {
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

const LAST_KNOWN_KEY = 'gsm:readme:last-known:simrim96';

function seedLastKnown(readmeBody = README_BODY, sha = 'last-known-sha') {
  store.set(LAST_KNOWN_KEY, {
    content: Buffer.from(readmeBody, 'utf-8').toString('base64'),
    sha,
  });
}

describe('t_36b41bcb — README ?v avanza anche quando la GET GitHub fallisce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    ghGetJson.mockResolvedValue({
      content: Buffer.from(README_BODY, 'utf-8').toString('base64'),
      sha: 'readme-sha-1',
    });
    ghPut.mockResolvedValue('readme-sha-2');
    process.env.GITHUB_PAT = 'test-token-12345';
  });

  it('GET fallita + copia last-known presente → PUT comunque eseguita (il ?v avanza)', async () => {
    seedLastKnown();
    ghGetJson.mockResolvedValue(null); // GET GitHub fallita (lenta/429/timeout)

    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.10' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    // La PUT del README gira nel percorso di scrittura parallelo: attendiamo
    // il completamento prima di asserire su ghPut.
    await new Promise((r) => setTimeout(r, 1_000));

    // Lo spin non deve rompersi: redirect 302 normale.
    expect(res.statusCode).toBe(302);

    // La GET è fallita ma la PUT c'è stata, con la copia last-known.
    expect(ghGetJson).toHaveBeenCalled();
    expect(ghPut).toHaveBeenCalled();
    const putArgs = ghPut.mock.calls[ghPut.mock.calls.length - 1];
    // [token, owner, repo, path, content, sha, message]
    expect(putArgs[3]).toBe('README.md');
    const content = putArgs[4];
    // Il ?v è stato riscritto con lo spinStart corrente (non più 123).
    expect(content).toMatch(/api\/image\?v=\d{13}/);
    expect(content).not.toContain('api/image?v=123');
    // La PUT usa lo sha della copia last-known (o quello auto-corretto).
    expect(putArgs[5]).toBe('last-known-sha');
  }, 30000);

  it('GET fallita + NESSUNA copia last-known → nessuna PUT, ma spin non rotto (302)', async () => {
    // Nessun seed: store vuoto.
    ghGetJson.mockResolvedValue(null);

    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.11' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 1_000));

    expect(res.statusCode).toBe(302);
    // Niente README da scrivere: ghPut NON deve essere chiamato.
    expect(ghPut).not.toHaveBeenCalled();
  }, 30000);

  it('GET riuscita → la copia last-known viene scritta (seed per le prossime GET)', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.12' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 1_000));

    expect(res.statusCode).toBe(302);
    // La chiave last-known è stata scritta (almeno una volta) con content+sha.
    const lastKnownCalls = kvSet.mock.calls.filter((c) =>
      String(c[0]).startsWith(LAST_KNOWN_KEY)
    );
    expect(lastKnownCalls.length).toBeGreaterThanOrEqual(1);
    const payload = lastKnownCalls[0][1];
    expect(payload).toHaveProperty('content');
    expect(payload).toHaveProperty('sha');
    // Il TTL usato è quello lungo (7 giorni = 604800s), non quello corto.
    expect(lastKnownCalls[0][2]).toBe(60 * 60 * 24 * 7);
  }, 30000);

  it('GET fallita → fallback last-known: il contenuto scritto contiene il ?v NUOVO e i marker originali', async () => {
    // README con marker di vincita (blocco non vuoto) e ?v vecchio.
    const body = [
      '# Profile',
      '',
      '<!-- SLOT_LAST_WIN_START -->',
      '<a href="https://github.com/simrim96/DemoRepo"><img src="https://github-slot-machine.vercel.app/api/badge?v=42&amp;lang=C%2B%2B" /></a>',
      '<!-- SLOT_LAST_WIN_END -->',
      '',
      '![slot](https://github-slot-machine.vercel.app/api/image?v=111)',
      '',
      '![lever](https://github-slot-machine.vercel.app/api/lever?v=111)',
      '',
    ].join('\n');
    seedLastKnown(body, 'last-known-sha');
    ghGetJson.mockResolvedValue(null);

    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.13' },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);
    await new Promise((r) => setTimeout(r, 1_000));

    expect(res.statusCode).toBe(302);
    expect(ghPut).toHaveBeenCalled();
    const putArgs = ghPut.mock.calls[ghPut.mock.calls.length - 1];
    const content = putArgs[4];
    // Sia l'image che la lever ricevono il nuovo ?v.
    expect(content).toMatch(/api\/image\?v=\d{13}/);
    expect(content).toMatch(/api\/lever\?v=\d{13}/);
    expect(content).not.toContain('api/image?v=111');
    // I marker della vincita precedente NON vengono toccati su spin perdente
    // (badge sticky, fix t_5381abfe): il blocco resta com'era.
    expect(content).toContain('DemoRepo');
    expect(content).toContain('SLOT_LAST_WIN_START');
    expect(content).toContain('SLOT_LAST_WIN_END');
  }, 30000);
});
