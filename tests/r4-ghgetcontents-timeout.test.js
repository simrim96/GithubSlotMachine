// Test per R4 — ghGetContentsJson con timeout stretto (ISSUE/R4, ISSUES.md §3).
//
// Verifica che la lettura di contenuto dal repo remoto (percorso critico dello
// spin quando KV è disabilitato) NON possa appendersi per secondi interi se
// GitHub è lento: ghGetContentsJson() deve abortire allo scadere di
// GH_CONTENTS_TIMEOUT_MS (800ms default) e lanciare, così il chiamante
// (readState) applica il fallback ai default e lo spin prosegue.
//
// I test usano fake timers + fetch stubbato "signal-aware" (rispetta
// AbortSignal) per simulare GitHub lento in modo deterministico e veloce.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn(), captureException: vi.fn() },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const github = await import('../api/_lib/github.js');
const {
  ghGetJson,
  ghGetContentsJson,
  GH_CONTENTS_TIMEOUT_MS,
  GITHUB_API_TIMEOUT_MS,
} = github;

// fetch stub che NON risolve mai ma rispetta l'AbortSignal: quando il codice
// chiama controller.abort() (scaduto il timeout), la promise viene rifiutata
// con un AbortError — esattamente come fa il vero fetch di Node.
function makeSignalAwareFetch() {
  return vi.fn((_url, opts = {}) => {
    return new Promise((_resolve, reject) => {
      const signal = opts.signal;
      if (signal) {
        if (signal.aborted) {
          reject(new Error('The operation was aborted.'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new Error('The operation was aborted.'));
        });
      }
      // altrimenti: hang (non risolve mai)
    });
  });
}

describe("R4: ghGetContentsJson ha un timeout stretto e non si appoggia all'infinito", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', makeSignalAwareFetch());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('GH_CONTENTS_TIMEOUT_MS (800) è molto più stretto di GITHUB_API_TIMEOUT_MS (2000)', () => {
    expect(GH_CONTENTS_TIMEOUT_MS).toBeLessThanOrEqual(1500);
    expect(GITHUB_API_TIMEOUT_MS).toBeGreaterThanOrEqual(1500);
    expect(GH_CONTENTS_TIMEOUT_MS).toBeLessThan(GITHUB_API_TIMEOUT_MS);
  });

  it('ghGetContentsJson abortisce al timeout stretto quando GitHub non risponde', async () => {
    const p = ghGetContentsJson('tok', 'o', 'r', 'state.json').then(
      () => 'ok',
      (e) => e
    );
    // Avanziamo oltre 800ms (timeout stretto).
    vi.advanceTimersByTime(1000);
    const res = await p;
    expect(res).not.toBe('ok'); // deve aver lanciato (AbortError), non risolto
  });

  it('ghGetJson di default usa il timeout largo: a 1000ms è già morto contents ma il default è ancora vivo', async () => {
    const contentsP = ghGetContentsJson('t', 'o', 'r', 'p').then(
      () => 'ok-contents',
      () => 'err-contents'
    );
    const defaultP = ghGetJson('t', 'o', 'r', 'p').then(
      () => 'ok-default',
      () => 'err-default'
    );
    // Avanziamo oltre il timeout stretto (800ms) ma ben sotto quello largo (5000ms).
    vi.advanceTimersByTime(1000);
    const contentsRes = await contentsP;
    expect(contentsRes).toBe('err-contents');

    // Allo stesso istante, il ghGetJson di default NON deve essersi ancora risolto:
    // raccogliamo il suo stato senza attendere i 5s.
    let defaultSettled = false;
    defaultP.finally(() => {
      defaultSettled = true;
    });
    await Promise.resolve();
    expect(defaultSettled).toBe(false);

    // Se avanziamo oltre i 5s, anche il default abortisce.
    vi.advanceTimersByTime(5000);
    const defaultRes = await defaultP;
    expect(defaultRes).toBe('err-default');
  });

  it("readState con KV disabilitato e GitHub lento propaga l'errore entro ~800ms (il caller fa fallback)", async () => {
    const stateMod = await import('../api/_lib/state.js');
    // Nessuna env Upstash → kvEnabled=false; token presente → readStateGitHub
    // usa ghGetContentsJson (800ms). fetch hang + abort → readState lancia.
    const p = stateMod.readState('fake-token', 'o', 'r');
    // Avanziamo oltre 800ms ma ben sotto 5000ms: readState deve rigettare.
    vi.advanceTimersByTime(1000);
    await expect(p).rejects.toBeTruthy();
  });
});
