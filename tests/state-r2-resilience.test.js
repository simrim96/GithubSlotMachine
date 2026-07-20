// Test per il fix R2 (ISSUES.md §3): resilience del sync state.json → GitHub.
//
// Verifica che syncStateToGitHub:
//  1. ritenti fino a STATE_SYNC_MAX_RETRIES con backoff esponenziale;
//  2. ritorni true al primo successo (anche dopo N fallimenti);
//  3. ritorni false e marchi lo stato come stale se TUTTI i tentativi falliscono;
//  4. al sync riuscito successivo, scriva il campo `stale: true` nel body
//     (così il frontend/profilo può segnalare la divergenza recuperata);
//  5. azzeri il flag stale dopo un sync riuscito.
//
// I test mockano ghPut via vi.mock sul modulo github.js (factory), così
// state.js — che importa ghPut come named binding — viene intercettato e non
// servono chiamate di rete reali verso GitHub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Sentry mockato (DSN assente in test).
vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn() },
  captureMessage: vi.fn(),
}));

// Mock del modulo kv.js: forziamo kvEnabled=false così lo stato stale usa solo
// il marker /tmp (pienamente controllabile dal test) e non dipende da un KV
// read-only o da stato persistito tra i run in un ambiente reale.
vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: false,
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => true),
}));

// Mock del modulo github.js: controlliamo ghPut per simulare
// fallimenti/ripristini del sync verso state.json.
const ghPut = vi.fn();
vi.mock('../api/_lib/github.js', () => ({
  ghPut,
  // ghGetContents è usato da readState, ma in questi test non serve:
  ghGetContents: vi.fn(),
  ghGet: vi.fn(),
}));

const stateMod = await import('../api/_lib/state.js');
const {
  syncStateToGitHub,
  recordStateSyncSuccess,
  persistStaleFlag,
  isStateStale,
  STATE_SYNC_MAX_RETRIES,
  STATE_SYNC_BACKOFF_BASE_MS,
} = stateMod;

const TOKEN = '***';
const OWNER = 'o';
const REPO = 'r';
const STATE = { totalSpins: 10, totalWins: 3, lastWin: null, version: 2 };

describe('R2: sync state.json → GitHub con retry + backoff', () => {
  beforeEach(async () => {
    // Forza lo stato pulito (azzera anche il marker /tmp lasciato da run
    // precedenti) così i test sono isolati e riproducibili. Va await-ed:
    // persistStaleFlag è async e prima del sync viene ricaricato da disco.
    await persistStaleFlag(false);
    recordStateSyncSuccess(); // azzera contatore/alert/stale
    ghPut.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('la soglia di default dei retry è 3', () => {
    expect(STATE_SYNC_MAX_RETRIES).toBe(3);
    expect(STATE_SYNC_BACKOFF_BASE_MS).toBe(200);
  });

  it('ritorna true al primo successo (nessun retry)', async () => {
    ghPut.mockResolvedValueOnce(undefined);
    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);
    expect(ok).toBe(true);
    expect(ghPut).toHaveBeenCalledTimes(1);
    expect(isStateStale()).toBe(false);
  });

  it('ritenta con backoff e ritorna true se un tentativo intermedio riesce', async () => {
    ghPut
      .mockRejectedValueOnce(new Error('timeout 1'))
      .mockRejectedValueOnce(new Error('timeout 2'))
      .mockResolvedValueOnce(undefined); // 3° tentativo ok
    const t0 = Date.now();
    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);
    const elapsed = Date.now() - t0;
    expect(ok).toBe(true);
    // 3 chiamate: 2 fallite + 1 riuscita.
    expect(ghPut).toHaveBeenCalledTimes(STATE_SYNC_MAX_RETRIES);
    // Backoff: 200 + 400 = 600ms attesi (tolleranza per scheduling).
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(isStateStale()).toBe(false);
  });

  it('dopo N fallimenti ritorna false e marca stale', async () => {
    ghPut.mockRejectedValue(new Error('GitHub down'));
    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);
    expect(ok).toBe(false);
    expect(ghPut).toHaveBeenCalledTimes(STATE_SYNC_MAX_RETRIES);
    expect(isStateStale()).toBe(true);
  });

  it('al sync riuscito successivo scrive stale:true nel body (divergenza recuperata)', async () => {
    // Prima: tutti falliscono → stale.
    ghPut.mockRejectedValue(new Error('GitHub down'));
    await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);
    expect(isStateStale()).toBe(true);

    // Poi: GitHub torna su, il sync riuscito deve includere `stale: true`.
    let syncedBody;
    ghPut.mockImplementation(async (tok, owner, repo, path, content) => {
      // NOTA: writeStateGitHub passa a ghPut il JSON GIA' stringificato (il
      // base64 avviene dentro github.js). Qui `content` è JSON grezzo.
      syncedBody = JSON.parse(content);
    });
    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);
    expect(ok).toBe(true);
    expect(syncedBody.stale).toBe(true);
    // E il flag stale viene azzerato dopo il recupero.
    expect(isStateStale()).toBe(false);
  });

  it('se non siamo mai stati stale, il body NON ha il campo stale', async () => {
    // Stato pulito: nessun fallimento precedente.
    recordStateSyncSuccess();
    let syncedBody;
    ghPut.mockImplementation(async (tok, owner, repo, path, content) => {
      // `content` è il JSON grezzo (writeStateGitHub non fa base64).
      syncedBody = JSON.parse(content);
    });
    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);
    expect(ok).toBe(true);
    expect(syncedBody.stale).toBeUndefined();
  });
});
