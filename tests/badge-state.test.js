// ─── Test self-validation del badge (FIX "pulsante su spin perdente") ────────
// Il badge nel README può restare STALE (GitHub cachea il render, la PUT
// asincrona può fallire): un badge scritto da una vincita PRECEDENTE
// resterebbe visibile anche dopo uno spin perdente, simulando una vincita
// inesistente. Il fix rende l'endpoint /api/badge self-validante contro lo
// stato corrente (gsm:state / state.json):
//   • ultimo spin VINCENTE e coerente (?v + lang) → badge normale;
//   • ultimo spin PERDENTE (o badge vecchio) → SVG vuoto, niente pulsante.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let kvGetMock;
let captured = null;

vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: true,
  kvGet: (...args) => kvGetMock(...args),
}));

vi.mock('../api/_lib/cors.js', () => ({
  applyCorsWildcard: () => {},
}));

vi.mock('../api/_lib/badge-cooldown.js', () => ({
  badgeCooldown: () => ({ allowed: true }),
}));

vi.mock('../api/_lib/response-bridge.js', () => ({
  sendResponse: (_res, payload) => {
    captured = payload;
  },
}));

vi.mock('../api/_lib/logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

// fetch mock per il fallback state.json pubblico (non deve mai servire se KV ok)
const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
vi.stubGlobal('fetch', fetchMock);

const badgeModule = await import('../api/badge.js');
const badgeHandler = badgeModule.default;
const { isBadgeValidForCurrentSpin } = badgeModule;

function makeReq(query = {}) {
  return { method: 'GET', query };
}
function makeRes() {
  return {};
}

// Stato tipo: ultimo spin = vincita React allo spinStart T
function winningState(ts) {
  return {
    totalSpins: 10,
    totalWins: 5,
    lastPullTimestamp: ts,
    lastWin: { langId: 'react', langName: 'React', ts },
    version: 2,
    settings: { theme: 'auto', sound: true },
    stats: { longestStreak: 0, currentStreak: 0, winsByLang: {} },
  };
}

// Stato tipo: ultimo spin = PERDENTE (lastPullTimestamp avanti, lastWin vecchio)
function losingState(winTs, pullTs) {
  return {
    totalSpins: 11,
    totalWins: 5,
    lastPullTimestamp: pullTs,
    lastWin: { langId: 'react', langName: 'React', ts: winTs },
    version: 2,
    settings: { theme: 'auto', sound: true },
    stats: { longestStreak: 0, currentStreak: 0, winsByLang: {} },
  };
}

describe('isBadgeValidForCurrentSpin (logica pura)', () => {
  const T = 1786284810807;

  it("valido quando l'ultimo spin è una vincita coerente (?v e lang)", () => {
    expect(
      isBadgeValidForCurrentSpin(winningState(T), String(T), 'React')
    ).toBe(true);
  });

  it('valido anche senza ?v (embed vecchio) se lang e vincita combaciano', () => {
    expect(isBadgeValidForCurrentSpin(winningState(T), null, 'React')).toBe(
      true
    );
  });

  it("INVALIDO quando l'ultimo spin è PERDENTE (lastPull > lastWin.ts)", () => {
    // Vincita a T, ma dopo c'è stato uno spin perdente a T+1000:
    // il badge di quella vincita non deve più comparire.
    expect(
      isBadgeValidForCurrentSpin(losingState(T, T + 1000), String(T), 'React')
    ).toBe(false);
  });

  it('INVALIDO quando ?v non corrisponde alla vincita corrente', () => {
    // Vincita corrente a T+2000, ma la richiesta chiede il badge di uno spin
    // più vecchio (T) — README cacheato con badge vecchio.
    expect(
      isBadgeValidForCurrentSpin(winningState(T + 2000), String(T), 'React')
    ).toBe(false);
  });

  it('INVALIDO quando il linguaggio non combacia', () => {
    expect(
      isBadgeValidForCurrentSpin(winningState(T), String(T), 'Python')
    ).toBe(false);
  });

  it("INVALIDO quando non c'è mai stata una vincita (lastWin null)", () => {
    const state = {
      totalSpins: 3,
      totalWins: 0,
      lastPullTimestamp: T,
      lastWin: null,
    };
    expect(isBadgeValidForCurrentSpin(state, String(T), 'React')).toBe(false);
  });

  it('INVALIDO quando lo stato è null/assente', () => {
    expect(isBadgeValidForCurrentSpin(null, String(T), 'React')).toBe(false);
  });
});

describe('handler /api/badge — serve SVG vuoto su spin perdenti', () => {
  const T = 1786284810807;

  beforeEach(() => {
    captured = null;
    fetchMock.mockClear();
  });

  it('ultimo spin VINCENTE → badge normale con testo', async () => {
    kvGetMock = vi.fn().mockResolvedValue(winningState(T));
    await badgeHandler(makeReq({ v: String(T), lang: 'React' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('check out this repo I wrote in React');
    expect(captured.body).not.toBe('');
  });

  it('ultimo spin PERDENTE → SVG vuoto, nessun pulsante', async () => {
    // Vincita a T, spin perdente a T+1000: il badge della vincita vecchia
    // deve sparire anche se il README embeddato è ancora cacheato.
    kvGetMock = vi.fn().mockResolvedValue(losingState(T, T + 1000));
    await badgeHandler(makeReq({ v: String(T), lang: 'React' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).not.toContain('check out this repo');
    expect(captured.body).not.toContain('<text');
  });

  it('senza stato leggibile (KV null + fetch fallita) → badge normale (fail-open)', async () => {
    kvGetMock = vi.fn().mockResolvedValue(null);
    await badgeHandler(makeReq({ v: String(T), lang: 'React' }), makeRes());
    // Fail-open: meglio un falso positivo che spezzare la vincita reale.
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('check out this repo I wrote in React');
  });

  it('KV in timeout/errore → fallback su state.json pubblico, poi badge normale', async () => {
    kvGetMock = vi.fn().mockRejectedValue(new Error('kv timeout'));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => winningState(T),
    });
    await badgeHandler(makeReq({ v: String(T), lang: 'React' }), makeRes());
    expect(fetchMock).toHaveBeenCalled();
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('check out this repo I wrote in React');
  });
});
