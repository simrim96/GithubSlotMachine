// ─── Test self-validation del badge (t_c9ca9ed9 — badge NON-sticky) ────────
// Il badge nel README è l'unico "pulsante con il link alla repo" dopo una
// vincita. Richiesta: il pulsante NON deve comparire sempre, ma SOLO in caso
// di vincita. L'endpoint /api/badge è self-validante contro lo stato
// corrente (gsm:state / state.json):
//   • l'ULTIMO spin è stato una VINCITA (lastWin.ts === lastPullTimestamp)
//     → badge normale;
//   • l'ultimo spin è stato PERDENTE (lastPullTimestamp > lastWin.ts) o non
//     c'è MAI stata una vincita (lastWin null) → SVG vuoto, niente pulsante.
// ?v e lang NON sono gate di validità: ?v è solo un cache-buster per
// camo e lang il testo mostrato. Il README (scritto solo dalla slot) è il
// confine di fiducia.
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

  it('INVALIDO dopo spin PERDENTI (badge non-sticky: il pulsante compare solo in caso di vincita)', () => {
    // t_c9ca9ed9: il pulsante NON è più sticky. Vincita a T, poi spin
    // perdente a T+1000 (lastPullTimestamp avanza, lastWin.ts resta a T):
    // il badge NON va servito — uno spin perso fa sparire il pulsante.
    expect(
      isBadgeValidForCurrentSpin(losingState(T, T + 1000), String(T), 'React')
    ).toBe(false);
  });

  it("VALIDA il badge di una vincita PRECEDENTE quando l'ultimo spin è una vincita NUOVA (README cacheato)", () => {
    // FIX t_5381abfe: vincita corrente a T+2000 (es. Python), ma la
    // richiesta chiede il badge di una vincita più vecchia a T (es. Qt),
    // ancora embeddato in un render del README cacheato da GitHub. La
    // vincita a T è REALE (è successa): il pulsante deve comparire lo
    // stesso. Prima del fix questo caso serviva un SVG vuoto → il pulsante
    // spariva su vincite reali non appena lo stato avanzava.
    expect(
      isBadgeValidForCurrentSpin(winningState(T + 2000), String(T), 'React')
    ).toBe(true);
  });

  it('VALIDO anche con linguaggio diverso dalla vincita corrente (lang è solo testo)', () => {
    // FIX t_5381abfe: un render cacheato di una vincita precedente può
    // embeddare ?lang=<linguaggio vecchio>. La vincita è reale, quindi il
    // badge si serve con il testo richiesto (coerente col render).
    expect(
      isBadgeValidForCurrentSpin(winningState(T), String(T), 'Python')
    ).toBe(true);
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

describe('handler /api/badge — badge non-sticky (SVG vuoto dopo uno spin perdente)', () => {
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

  it('spin PERDENTE dopo una vincita → SVG vuoto (il pulsante sparisce, non-sticky)', async () => {
    // t_c9ca9ed9: vincita a T, spin perdente a T+1000. Il pulsante NON
    // resta: l'ultimo spin è una perdita, quindi l'endpoint serve un SVG
    // vuoto (nessun link fantasma nel README).
    kvGetMock = vi.fn().mockResolvedValue(losingState(T, T + 1000));
    await badgeHandler(makeReq({ v: String(T), lang: 'React' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).not.toContain('check out this repo');
    expect(captured.body).toContain('<svg');
    expect(captured.body).toContain('aria-label=""');
  });

  it("FIX t_5381abfe: badge di una vincita Qt PRECEDENTE servito anche se l'ultimo spin ha vinto altro (README cacheato)", async () => {
    // Scenario reale del bug: vincita Qt a T, poi vincita Python a T+2000.
    // GitHub serve ancora il render cacheato del README con l'URL del badge
    // Qt (?v=T&lang=Qt): la vincita Qt è reale, quindi il pulsante DEVE
    // comparire. Prima del fix l'endpoint serviva un SVG vuoto (i check
    // stretti su ?v/lang invalidavano il badge appena lo stato avanzava).
    kvGetMock = vi.fn().mockResolvedValue(winningState(T + 2000));
    await badgeHandler(makeReq({ v: String(T), lang: 'Qt' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('check out this repo I wrote in Qt');
    expect(captured.body).not.toBe('');
  });

  it('t_c9ca9ed9 (scenario esatto): vincita Qt, poi spin perdente → il pulsante Qt NON resta', async () => {
    // Bug storico t_5381abfe: "dopo aver vinto il simbolo qt non è comparso
    // il pulsante". La fix t_5381abfe rese il badge STICKY (resta per
    // sempre). t_c9ca9ed9 chiede il contrario: il pulsante deve comparire
    // SOLO in caso di vincita — uno spin perdente dopo la vincita Qt DEVE
    // togliere il pulsante (l'utente vede la perdita nello spin corrente).
    const qtState = {
      totalSpins: 78,
      totalWins: 43,
      lastPullTimestamp: T + 8000, // spin perdente DOPO la vincita
      lastWin: { langId: 'qt', langName: 'Qt', ts: T },
      version: 2,
      settings: { theme: 'auto', sound: true },
      stats: { longestStreak: 0, currentStreak: 0, winsByLang: {} },
    };
    // Logica pura: INVALIDO perché l'ultimo spin (T+8000) è una perdita
    expect(isBadgeValidForCurrentSpin(qtState, String(T), 'Qt')).toBe(false);
    // Endpoint: serve SVG vuoto, niente pulsante Qt
    kvGetMock = vi.fn().mockResolvedValue(qtState);
    await badgeHandler(makeReq({ v: String(T), lang: 'Qt' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).not.toContain('check out this repo');
    expect(captured.body).toContain('aria-label=""');
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
