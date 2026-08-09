// End-to-end proof for issue #16: with the per-IP rate-limit and CORS now wired
// into the real handler, a LEGITIMATE first spin must still complete fully
// (reach the GitHub/Redis writes and return a 302 redirect) and the response
// must carry the CORS headers. This guards against the fix accidentally
// blocking normal spins.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network-facing helpers so no real GitHub/Redis calls happen, and so
// we can assert the handler reaches the writes + redirect.
vi.mock('../api/_lib/state.js', () => ({
  readState: vi.fn().mockResolvedValue({
    state: { totalSpins: 0, totalWins: 0, lastWin: null },
    sha: 'sha-1',
  }),
  writeState: vi.fn().mockResolvedValue({ sha: 'sha-2' }),
}));
vi.mock('../api/_lib/github.js', () => ({
  loadSlotSvg: vi.fn().mockResolvedValue({ content: '', sha: 'slot-sha' }),
  saveSlotSvg: vi.fn().mockResolvedValue({ sha: 'slot-sha-2' }),
  ghGetJson: vi.fn(),
  ghPut: vi.fn(),
  updateReadmeMarkers: vi.fn((r) => r),
  GH_CONTENTS_TIMEOUT_MS: 800,
}));
vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: false,
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));
vi.mock('../api/_lib/repos.js', () => ({
  getRepoForLanguage: vi.fn().mockResolvedValue(null),
}));
vi.mock('../sentry.config.js', () => ({
  default: { captureException: vi.fn(), addBreadcrumb: vi.fn() },
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const handler = (await import('../api/spin.js')).default;

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body = '';
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
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

describe('legittimo spin completo con rate-limit + CORS attivi', () => {
  beforeEach(() => {
    process.env.GITHUB_PAT = 'test-token';
  });

  it('il primo spin di un IP completa (302) e porta gli header CORS', async () => {
    const req = {
      method: 'GET',
      headers: {
        'x-forwarded-for': '203.0.113.50',
        origin: 'http://localhost:3000',
      },
      query: {},
    };
    const res = makeRes();
    await handler(req, res);

    // Ha superato il rate-limit ed è arrivato al redirect (non 429, non 500).
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toMatch(/^https:\/\/github\.com\//);
    // CORS policy applicata.
    expect(res.headers['Access-Control-Allow-Origin']).toBe(
      'http://localhost:3000'
    );
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
  });
});
