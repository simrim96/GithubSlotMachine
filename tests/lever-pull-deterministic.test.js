/**
 * Test per verificare che api/lever.js riproduca l'animazione di pull in modo
 * robusto, con piu' fonti di verita' ordinate, e NON dipenda da un'unica
 * sorgente fragile.
 *
 * Radice del bug "funziona 2-3 volte poi smette": lever.js decideva pulling/
 * idling leggendo SOLO kvGet('gsm:state') (vuoto in prod) o ?v nel README.
 * Il ?v nel README e' aggiornato da spin.js via GitHub Contents API, che va
 * in rate-limit: dopo 2-3 spin il ?v si "blocca" e la leva resta idle.
 *
 * Fix: getPullState(req) prova in ordine:
 *   1) ?v=spinStart nell'URL (deterministico, primario)
 *   2) state.json PUBBLICO su GitHub (aggiornato a ogni spin da spin.js -> fonte
 *      di verita' indipendente dal README, copre il rate-limit del README)
 *   3) KV (fallback chiamate dirette / dev locale)
 * Finestra di recency: 30s (copre il ritardo di refetch di GitHub).
 *
 * Il test mocka global.fetch per isolare la fonte #2 (state.json GitHub)
 * senza I/O di rete reale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const PULL_WINDOW_MS = 30000;

// KV vuoto di default: simula il caso di produzione in cui la fonte attiva
// NON e' KV.
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

vi.mock('../api/_lib/spin-cooldown.js', () => ({
  checkSpinCooldown: async () => ({ allowed: true }),
  clientIp: (req) => req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1',
}));

let captured = null;
vi.mock('../api/_lib/response-bridge.js', () => ({
  sendResponse: (_res, payload) => {
    captured = payload;
  },
}));

vi.mock('../api/_lib/logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

// fetch mock per la fonte #2 (state.json pubblico su GitHub).
// githubTs e' configurabile per test: null => fetch fallito/non recente.
let githubTs = null;
const fetchMock = vi.fn(async (url) => {
  if (String(url).includes('raw.githubusercontent.com')) {
    return {
      ok: githubTs !== null,
      json: async () => ({ lastPullTimestamp: githubTs }),
    };
  }
  return { ok: false, json: async () => ({}) };
});
vi.stubGlobal('fetch', fetchMock);

const leverHandler = (await import('../api/lever.js')).default;

function makeReq(v) {
  return { method: 'GET', query: v !== undefined ? { v: String(v) } : {} };
}
function makeRes() {
  return {};
}

describe('Lever pull deterministico (fonti ordinate, finestra 30s)', () => {
  beforeEach(() => {
    captured = null;
    githubTs = null;
    kvGetMock.mockClear();
    kvSetMock.mockClear();
    fetchMock.mockClear();
  });

  it('FONTE 1: ?v=spin recente emette pulling ANCHE se KV e GitHub vuoti', async () => {
    const recent = Date.now();
    await leverHandler(makeReq(recent), makeRes());
    expect(captured).not.toBeNull();
    expect(captured.body).toContain('class="leverArm pulling"');
    // La fonte 1 vince: non deve nemmeno interrogare GitHub.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FONTE 1: ?v=spin vecchio (>30s) NON emette pulling', async () => {
    const old = Date.now() - (PULL_WINDOW_MS + 5000);
    await leverHandler(makeReq(old), makeRes());
    expect(captured.body).toContain('class="leverArm idling"');
  });

  it('FONTE 2: senza ?v, GitHub state.json recente -> pulling', async () => {
    githubTs = Date.now() - 2000; // 2s fa, dentro la finestra
    await leverHandler(makeReq(), makeRes());
    expect(captured.body).toContain('class="leverArm pulling"');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('FONTE 3: senza ?v, GitHub non recente ma KV recente -> pulling (fallback)', async () => {
    githubTs = Date.now() - (PULL_WINDOW_MS + 5000); // GitHub vecchio
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

  it('DEFAULT SICURO: senza ?v, GitHub e KV vuoti -> idling', async () => {
    await leverHandler(makeReq(), makeRes());
    expect(captured.body).toContain('class="leverArm idling"');
  });

  it('COLD-START: kvGet va in TIMEOUT/lancia -> non rompe, degrada a idling', async () => {
    // Simula Upstash lento/cross-region a freddo: kvGet impiega >500ms e lancia.
    kvGetMock.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 600));
      throw new Error('kv timeout');
    });
    const start = Date.now();
    await leverHandler(makeReq(), makeRes());
    const elapsed = Date.now() - start;
    // Non deve lanciare e non deve impiegare più del timeout KV (~500ms)
    // + il fallback raw GitHub (800ms). Se supera di molto, il percorso
    // caldo è rotto a freddo.
    expect(captured.body).toContain('class="leverArm idling"');
    expect(elapsed).toBeLessThan(2000);
  });

  it('COLD-START KV lento ma raw GitHub recente -> pulling (fallback funziona)', async () => {
    // KV lento/timeout, ma raw GitHub risponde con timestamp recente:
    // il fallback LENTO deve comunque tirare la leva.
    kvGetMock.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 600));
      throw new Error('kv timeout');
    });
    githubTs = Date.now() - 2000; // 2s fa, dentro finestra
    await leverHandler(makeReq(), makeRes());
    expect(captured.body).toContain('class="leverArm pulling"');
  });
});
