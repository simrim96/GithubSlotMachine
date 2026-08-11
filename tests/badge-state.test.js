// ─── Test self-validation del badge (FIX t_5381abfe — badge STICKY) ────────
// Il badge nel README è l'unico "pulsante con il link alla repo" dopo una
// vincita. Bug riportato: "vinto il simbolo qt (rilevato vincente) ma
// nessun pulsante". Due cause:
//   1. i check stretti su ?v/lang invalidavano l'URL di un badge di una
//      vincita vera appena lo stato avanzava (GitHub cachea il render del
//      README per minuti) → servito SVG vuoto;
//   2. il gate lastPull !== lastWin.ts (e lo svuotamento marker su spin
//      perdenti in spin.js) faceva sparire il pulsante appena dopo la
//      vincita arrivava uno spin perdente.
// L'endpoint /api/badge è self-validante contro lo stato corrente
// (gsm:state / state.json):
//   • almeno UNA vincita reale (lastWin presente) → badge normale;
//   • nessuna vincita MAI (lastWin null) → SVG vuoto, niente pulsante.
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

  it("VALIDO anche dopo spin PERDENTI (badge sticky: rappresenta l'ultima vincita)", () => {
    // FIX t_5381abfe: vincita a T, poi spin perdenti a T+1000. Il badge
    // della vincita deve RESTARE: prima del fix lastPull !== lastWin.ts
    // lo invalidava → "vinto qt ma nessun pulsante" appena l'utente
    // ritirava di nuovo dopo una vincita.
    expect(
      isBadgeValidForCurrentSpin(losingState(T, T + 1000), String(T), 'React')
    ).toBe(true);
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

describe('handler /api/badge — badge sticky (mai SVG vuoto dopo una vincita reale)', () => {
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

  it('spin PERDENTE dopo una vincita → il badge della vincita resta (sticky)', async () => {
    // FIX t_5381abfe: vincita a T, spin perdente a T+1000. Prima del fix
    // l'endpoint serviva SVG vuoto appena arrivava uno spin perso → il
    // pulsante della vincita spariva ("vinto qt ma nessun pulsante").
    kvGetMock = vi.fn().mockResolvedValue(losingState(T, T + 1000));
    await badgeHandler(makeReq({ v: String(T), lang: 'React' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('check out this repo I wrote in React');
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

  it('FIX t_5381abfe (scenario esatto): vincita Qt, poi spin perdente → il pulsante Qt resta', async () => {
    // Bug riportato: "dopo aver vinto il simbolo qt (rilevato vincente)
    // non è comparso il pulsante con il link alla repo". In produzione:
    // vincita Qt alle 22:01, spin perdente 8s dopo → badge svuotato per
    // ore. Il badge deve sopravvivere agli spin perdenti.
    const qtState = {
      totalSpins: 78,
      totalWins: 43,
      lastPullTimestamp: T + 8000, // spin perdente DOPO la vincita
      lastWin: { langId: 'qt', langName: 'Qt', ts: T },
      version: 2,
      settings: { theme: 'auto', sound: true },
      stats: { longestStreak: 0, currentStreak: 0, winsByLang: {} },
    };
    // Logica pura: valido nonostante lastPull > lastWin.ts
    expect(isBadgeValidForCurrentSpin(qtState, String(T), 'Qt')).toBe(true);
    // Endpoint: serve il badge reale, non SVG vuoto
    kvGetMock = vi.fn().mockResolvedValue(qtState);
    await badgeHandler(makeReq({ v: String(T), lang: 'Qt' }), makeRes());
    expect(captured.status).toBe(200);
    expect(captured.body).toContain('check out this repo I wrote in Qt');
    expect(captured.body).not.toBe('');
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
