/**
 * Test per verificare che api/lever.js riproduca l'animazione di pull in modo
 * DETERMINISTICO usando il timestamp di spin nell'URL (?v=spinStart), e NON
 * dipenda da KV (che in produzione puo' non essere la fonte attiva dello state).
 *
 * Radice del bug: lever.js leggeva SOLO kvGet('gsm:state').lastPullTimestamp.
 * Se KV non e' la fonte attiva in prod (e' esattamente cio' che rompe oggi:
 * lever.js cieco), lastPullTimestamp e' sempre assente -> isPulling sempre
 * false -> leva sempre "idling" dopo il refresh. Lo spin pero' scrive gia'
 * api/lever?v=<spinStart> nel README: quel timestamp nell'URL e' la fonte
 * deterministica che dobbiamo usare.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// KV vuoto: simula il caso di produzione in cui la fonte attiva NON e' KV
// (e' esattamente cio' che rompe oggi: lever.js cieco).
const kvGetMock = vi.fn(async () => null);
const kvSetMock = vi.fn(async () => true);

vi.mock('../api/_lib/kv.js', () => ({
  kvGet: (...args) => kvGetMock(...args),
  kvSet: (...args) => kvSetMock(...args),
  kvEnabled: true,
}));

vi.mock('../api/_lib/cors.js', () => ({
  applyCorsWildcard: () => {},
}));

let captured = null;
vi.mock('../api/_lib/response-bridge.js', () => ({
  sendResponse: (_res, payload) => {
    captured = payload;
  },
}));

vi.mock('../api/_lib/logger.js', () => ({
  logger: {
    warn: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

const leverHandler = (await import('../api/lever.js')).default;

function makeReq(v) {
  return {
    method: 'GET',
    query: v !== undefined ? { v: String(v) } : {},
  };
}

function makeRes() {
  return {};
}

describe('Lever pull deterministico (fonte URL, non KV)', () => {
  beforeEach(() => {
    captured = null;
    kvGetMock.mockClear();
    kvSetMock.mockClear();
  });

  it('con ?v=spin recente emette classe pulling ANCHE se KV e vuoto', async () => {
    const recent = Date.now();
    await leverHandler(makeReq(recent), makeRes());
    expect(captured).not.toBeNull();
    expect(captured.body).toContain('class="leverArm pulling"');
  });

  it('con ?v=spin vecchio (>3s) emette classe idling', async () => {
    const old = Date.now() - 10000;
    await leverHandler(makeReq(old), makeRes());
    expect(captured.body).toContain('class="leverArm idling"');
  });

  it('senza ?v ma con lastPullTimestamp recente su KV -> pulling (fallback)', async () => {
    kvGetMock.mockImplementationOnce(async () => ({
      totalSpins: 1,
      totalWins: 0,
      lastWin: null,
      version: 2,
      lastPullTimestamp: Date.now(),
      settings: { theme: 'auto', sound: true },
      stats: { longestStreak: 0, currentStreak: 0, winsByLang: {} },
    }));
    await leverHandler(makeReq(), makeRes());
    expect(captured.body).toContain('class="leverArm pulling"');
  });

  it('senza ?v e KV vuoto -> idling (default sicuro)', async () => {
    await leverHandler(makeReq(), makeRes());
    expect(captured.body).toContain('class="leverArm idling"');
  });
});
