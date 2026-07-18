// Test per api/_lib/ratelimit-tracker.js — Rate Limit Tracking & Queue per GitHub API
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RateLimitTracker,
  RateLimitQueue,
  parseRateLimitHeaders,
} from '../api/_lib/ratelimit-tracker.js';

// ─── RateLimitTracker Tests ────────────────────────────────────────────────────
describe('RateLimitTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inizializza con stato null', () => {
    const tracker = new RateLimitTracker();
    expect(tracker.remaining).toBe(null);
    expect(tracker.reset).toBe(null);
    expect(tracker.totalRequests).toBe(0);
    expect(tracker.requestsBlocked).toBe(0);
    expect(tracker.callsQueued).toBe(0);
  });

  it('aggiorna remaining e reset dagli headers', () => {
    const tracker = new RateLimitTracker();
    const headers = new Map([
      ['X-RateLimit-Remaining', '4999'],
      ['X-RateLimit-Reset', '1784100000'],
    ]);
    const mockHeaders = {
      get: (name) => headers.get(name),
    };

    tracker.updateFromResponse(mockHeaders);

    expect(tracker.remaining).toBe(4999);
    expect(tracker.reset).toBe(1784100000);
    expect(tracker.totalRequests).toBe(1);
  });

  it('ignora headers null/undefined', () => {
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: () => null,
    };

    tracker.updateFromResponse(mockHeaders);

    expect(tracker.remaining).toBe(null);
    expect(tracker.reset).toBe(null);
  });

  it('gestisce headers non numerici (li setta a null)', () => {
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: () => 'invalid',
    };

    tracker.updateFromResponse(mockHeaders);

    expect(tracker.remaining).toBe(null);
    expect(tracker.reset).toBe(null);
  });

  it('triggera warning quando remaining <= 10', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: (name) => {
        if (name === 'X-RateLimit-Remaining') return '10';
        if (name === 'X-RateLimit-Reset') return '1784100000';
        return null;
      },
    };

    tracker.updateFromResponse(mockHeaders);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GitHub Rate Limit] Remaining: 10')
    );
    consoleSpy.mockRestore();
  });

  it('triggera warning quando remaining <= 2', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: (name) => {
        if (name === 'X-RateLimit-Remaining') return '2';
        if (name === 'X-RateLimit-Reset') return '1784100000';
        return null;
      },
    };

    tracker.updateFromResponse(mockHeaders);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GitHub Rate Limit] Remaining: 2')
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[GitHub Rate Limit] CRITICAL: Only 2 requests left!'
      )
    );
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('isBelowWarningThreshold ritorna true quando remaining <= 10', () => {
    const tracker = new RateLimitTracker();

    // Stato init
    expect(tracker.isBelowWarningThreshold()).toBe(false);

    tracker.remaining = 10;
    expect(tracker.isBelowWarningThreshold()).toBe(true);

    tracker.remaining = 11;
    expect(tracker.isBelowWarningThreshold()).toBe(false);

    tracker.remaining = 5;
    expect(tracker.isBelowWarningThreshold()).toBe(true);
  });

  it('isBelowBlockThreshold ritorna true quando remaining <= 2', () => {
    const tracker = new RateLimitTracker();

    // Stato init
    expect(tracker.isBelowBlockThreshold()).toBe(false);

    tracker.remaining = 2;
    expect(tracker.isBelowBlockThreshold()).toBe(true);

    tracker.remaining = 3;
    expect(tracker.isBelowBlockThreshold()).toBe(false);

    tracker.remaining = 1;
    expect(tracker.isBelowBlockThreshold()).toBe(true);
  });

  it('getSecondsUntilReset calcola correttamente i secondi', () => {
    const tracker = new RateLimitTracker();

    // Nessuna reset time
    expect(tracker.getSecondsUntilReset()).toBe(null);

    tracker.reset = Math.floor(Date.now() / 1000) + 120; // 120 secondi nel futuro

    const seconds = tracker.getSecondsUntilReset();
    expect(seconds).toBeGreaterThan(115);
    expect(seconds).toBeLessThanOrEqual(120);
  });

  it('formatResetTime formatta correttamente la data', () => {
    const tracker = new RateLimitTracker();

    expect(tracker.formatResetTime()).toBe('unknown');

    tracker.reset = 1784100000;
    const formatted = tracker.formatResetTime();

    expect(formatted).not.toBe('unknown');
    expect(typeof formatted).toBe('string');
  });

  it('getState ritorna lo stato completo', () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 5;
    tracker.reset = 1784100000;
    tracker.totalRequests = 100;
    tracker.requestsBlocked = 5;

    const state = tracker.getState();

    expect(state.remaining).toBe(5);
    expect(state.reset).toBe(1784100000);
    expect(state.totalRequests).toBe(100);
    expect(state.requestsBlocked).toBe(5);
    expect(state.isBelowWarningThreshold).toBe(true);
    expect(state.isBelowBlockThreshold).toBe(false);
  });

  it('reset() resetta tutti i valori', () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 5;
    tracker.reset = 1784100000;
    tracker.totalRequests = 100;
    tracker.requestsBlocked = 5;

    tracker.clearState();

    expect(tracker.remaining).toBe(null);
    expect(tracker.reset).toBe(null);
    expect(tracker.totalRequests).toBe(0);
    expect(tracker.requestsBlocked).toBe(0);
  });

  it('incrementa totalRequests ad ogni update', () => {
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: (name) => {
        if (name === 'X-RateLimit-Remaining') return '4999';
        if (name === 'X-RateLimit-Reset') return '1784100000';
        return null;
      },
    };

    tracker.updateFromResponse(mockHeaders);
    expect(tracker.totalRequests).toBe(1);

    tracker.updateFromResponse(mockHeaders);
    expect(tracker.totalRequests).toBe(2);

    tracker.updateFromResponse(mockHeaders);
    expect(tracker.totalRequests).toBe(3);
  });
});

// ─── RateLimitQueue Tests ──────────────────────────────────────────────────────
describe('RateLimitQueue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('inizializza con tracker e queue vuota', () => {
    const tracker = new RateLimitTracker();
    const queue = new RateLimitQueue(tracker);

    expect(queue.queueLength).toBe(0);
    expect(queue.isProcessing).toBe(false);
  });

  it('esegue subito la funzione se remaining > 2', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 100;
    const queue = new RateLimitQueue(tracker);

    const fn = vi.fn(async () => 'result');

    const result = await queue.add(fn);

    expect(result).toBe('result');
    expect(fn).toHaveBeenCalled();
    expect(queue.queueLength).toBe(0);
  });

  it('attende se remaining <= 2 e risolve dopo il reset', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 1;
    const queue = new RateLimitQueue(tracker);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let executionResolved = false;
    const fn = vi.fn(async () => {
      executionResolved = true;
      return 'result';
    });

    // Avvia la chiamata in coda
    const promise = queue.add(fn);

    // Non dovrebbe essere eseguita subito
    expect(executionResolved).toBe(false);

    // Simuliamo il passare del tempo fino al reset
    tracker.remaining = 100; // Simuliamo che il rate limit si resetti
    vi.advanceTimersByTime(2000);

    const result = await promise;

    expect(result).toBe('result');
    expect(fn).toHaveBeenCalled();
    expect(executionResolved).toBe(true);
    consoleSpy.mockRestore();
  });

  it('risolve le chiamate in coda dopo il successo della prima', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 100;
    const queue = new RateLimitQueue(tracker);

    const results = [];
    const fn1 = vi.fn(async () => {
      results.push(1);
      return 'result1';
    });
    const fn2 = vi.fn(async () => {
      results.push(2);
      return 'result2';
    });
    const fn3 = vi.fn(async () => {
      results.push(3);
      return 'result3';
    });

    // Aggiungi 3 funzioni alla coda
    const promise1 = queue.add(fn1);
    const promise2 = queue.add(fn2);
    const promise3 = queue.add(fn3);

    // Prima funzione eseguita subito, le altre in coda
    await promise1;

    // fn2 e fn3 dovrebbero essere state eseguite dopo
    await promise2;
    await promise3;

    expect(results).toEqual([1, 2, 3]);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  it('gestisce errori e continua a processare la coda', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 100;
    const queue = new RateLimitQueue(tracker);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const fn1 = vi.fn(async () => {
      throw new Error('Errore simulato');
    });
    const fn2 = vi.fn(async () => 'result2');

    // fn1 fallisce, fn2 dovrebbe essere comunque eseguita
    const promise1 = queue.add(fn1);
    const promise2 = queue.add(fn2);

    await expect(promise1).rejects.toThrow('Errore simulato');
    await promise2;

    expect(fn2).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[RateLimitQueue] Error in queued call:',
      'Errore simulato'
    );
    consoleSpy.mockRestore();
  });

  it('timeout dopo 60 secondi se il rate limit non si resetta', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 1; // Sotto la soglia di blocco
    const queue = new RateLimitQueue(tracker);

    const fn = vi.fn(async () => 'result');

    // Avvia la richiesta
    const promise = queue.add(fn);

    // Avanza il tempo oltre il maxWaitTime (60 secondi)
    await vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow('Rate limit timeout after 60s');
    expect(fn).not.toHaveBeenCalled();
  });

  it('processQueue processa le chiamate in coda una alla volta', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 100;
    const queue = new RateLimitQueue(tracker);

    const executionOrder = [];

    const fn1 = vi.fn(async () => {
      executionOrder.push(1);
      return 'result1';
    });
    const fn2 = vi.fn(async () => {
      executionOrder.push(2);
      return 'result2';
    });
    const fn3 = vi.fn(async () => {
      executionOrder.push(3);
      return 'result3';
    });

    // Aggiungi tutte le funzioni
    const p1 = queue.add(fn1);
    const p2 = queue.add(fn2);
    const p3 = queue.add(fn3);

    await Promise.all([p1, p2, p3]);

    // Dovrebbero essere eseguite in ordine FIFO
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('peek() ritorna il primo elemento della coda', () => {
    const tracker = new RateLimitTracker();
    const queue = new RateLimitQueue(tracker);

    expect(queue.peek()).toBe(null);

    queue.queue.push({ promise: null, resolve: () => {}, reject: () => {} });
    expect(queue.peek()).not.toBe(null);
  });

  it('reset() resetta queue e isProcessing', () => {
    const tracker = new RateLimitTracker();
    const queue = new RateLimitQueue(tracker);

    queue.queue.push({ promise: null, resolve: () => {}, reject: () => {} });
    queue.isProcessing = true;

    queue.reset();

    expect(queue.queue.length).toBe(0);
    expect(queue.isProcessing).toBe(false);
  });
});

// ─── Factory Functions Tests ───────────────────────────────────────────────────
describe('Factory Functions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    // Reset singleton
    vi.resetModules();
  });

  it('getDefaultTracker ritorna singleton', () => {
    const { getDefaultTracker } = require('../api/_lib/ratelimit-tracker.js');
    const tracker1 = getDefaultTracker();
    const tracker2 = getDefaultTracker();

    expect(tracker1).toBe(tracker2);
  });

  it('getDefaultQueue ritorna singleton con tracker condiviso', () => {
    const { getDefaultQueue } = require('../api/_lib/ratelimit-tracker.js');
    const queue1 = getDefaultQueue();
    const queue2 = getDefaultQueue();

    expect(queue1).toBe(queue2);
    expect(queue1.tracker).toBe(queue2.tracker);
  });

  it('createCustomRateLimitSystem crea tracker e queue isolati', () => {
    const {
      createCustomRateLimitSystem,
      RateLimitTracker,
      RateLimitQueue,
    } = require('../api/_lib/ratelimit-tracker.js');

    const { tracker, queue } = createCustomRateLimitSystem();

    expect(tracker).toBeInstanceOf(RateLimitTracker);
    expect(queue).toBeInstanceOf(RateLimitQueue);
    expect(queue.tracker).toBe(tracker);
  });

  it('createCustomRateLimitSystem è isolato dai singleton', () => {
    const {
      createCustomRateLimitSystem,
      getDefaultTracker,
    } = require('../api/_lib/ratelimit-tracker.js');

    const custom = createCustomRateLimitSystem();
    const defaultTracker = getDefaultTracker();

    expect(custom.tracker).not.toBe(defaultTracker);

    custom.tracker.remaining = 100;
    expect(defaultTracker.remaining).toBe(null);
  });
});

// ─── Helper Functions Tests ────────────────────────────────────────────────────
describe('parseRateLimitHeaders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('parse remaining e reset da response headers', () => {
    const headers = new Map([
      ['X-RateLimit-Remaining', '4999'],
      ['X-RateLimit-Reset', '1784100000'],
    ]);
    const mockResponse = {
      headers: {
        get: (name) => headers.get(name),
      },
    };

    const result = parseRateLimitHeaders(mockResponse);

    expect(result.remaining).toBe(4999);
    expect(result.reset).toBe(1784100000);
  });

  it('ritorna null per headers mancanti', () => {
    const mockResponse = {
      headers: {
        get: () => null,
      },
    };

    const result = parseRateLimitHeaders(mockResponse);

    expect(result.remaining).toBe(null);
    expect(result.reset).toBe(null);
  });

  it('ritorna null per valori non numerici', () => {
    const mockResponse = {
      headers: {
        get: () => 'invalid',
      },
    };

    const result = parseRateLimitHeaders(mockResponse);

    expect(result.remaining).toBe(null);
    expect(result.reset).toBe(null);
  });
});

// ─── Integration Tests ──────────────────────────────────────────────────────────
describe('Integration: Tracker + Queue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('simula un flow completo di rate limiting', async () => {
    const {
      createCustomRateLimitSystem,
    } = require('../api/_lib/ratelimit-tracker.js');
    const { tracker, queue } = createCustomRateLimitSystem();

    const executionLog = [];

    // Simula 5 richieste consecutive
    for (let i = 1; i <= 5; i++) {
      tracker.remaining = 5000 - i;
      tracker.totalRequests = 0; // Reset per test

      const fn = vi.fn(async () => {
        executionLog.push({ remaining: tracker.remaining, order: i });
        return `result-${i}`;
      });

      const result = await queue.add(fn);
      expect(result).toBe(`result-${i}`);
    }

    // Tutte le richieste dovrebbero essere eseguite
    expect(executionLog.length).toBe(5);
    expect(executionLog[0].remaining).toBe(4999);
    expect(executionLog[4].remaining).toBe(4995);
  });

  it('blocca le richieste quando remaining == 0', async () => {
    const {
      createCustomRateLimitSystem,
    } = require('../api/_lib/ratelimit-tracker.js');
    const { tracker, queue } = createCustomRateLimitSystem();

    tracker.remaining = 0; // Rate limit exhausted

    const fn = vi.fn(async () => 'result');

    // Avvia la richiesta
    const promise = queue.add(fn);

    // Non dovrebbe essere eseguita
    expect(fn).not.toHaveBeenCalled();

    // Simula il reset del rate limit
    tracker.remaining = 100;
    vi.advanceTimersByTime(2000);

    await promise;

    expect(fn).toHaveBeenCalled();
  });

  it('tracker registra le chiamate bloccate', async () => {
    const {
      createCustomRateLimitSystem,
    } = require('../api/_lib/ratelimit-tracker.js');
    const { tracker, queue } = createCustomRateLimitSystem();

    tracker.remaining = 1;

    const fn = vi.fn(async () => 'result');

    const promise = queue.add(fn);

    // Il tracker dovrebbe aver incrementato requestsBlocked
    expect(tracker.requestsBlocked).toBe(1);

    // Simula il reset
    tracker.remaining = 100;
    vi.advanceTimersByTime(2000);

    await promise;
  });
});

// ─── Edge Cases & Robustness ───────────────────────────────────────────────────
describe('Edge Cases & Robustness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gestisce remaining negativo (valore anomalo)', () => {
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: (name) => {
        if (name === 'X-RateLimit-Remaining') return '-1';
        if (name === 'X-RateLimit-Reset') return '1784100000';
        return null;
      },
    };

    tracker.updateFromResponse(mockHeaders);

    // remaining negativo è valido (parse come numero negativo)
    expect(tracker.remaining).toBe(-1);
    expect(tracker.isBelowBlockThreshold()).toBe(true);
  });

  it('gestisce reset nel passato (timestamp invalido)', () => {
    const tracker = new RateLimitTracker();
    const mockHeaders = {
      get: (name) => {
        if (name === 'X-RateLimit-Remaining') return '100';
        if (name === 'X-RateLimit-Reset') return '1000000000'; // 2001
        return null;
      },
    };

    tracker.updateFromResponse(mockHeaders);

    // secondsUntilReset dovrebbe essere 0 o negativo (ma max(0, ...) lo corregge)
    const seconds = tracker.getSecondsUntilReset();
    expect(seconds).toBe(0);
  });

  it('queue gestisce funzioni che restituiscono promesse fallite', async () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 100;
    const queue = new RateLimitQueue(tracker);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const fn = vi.fn(async () => {
      throw new Error('Network error');
    });

    await expect(queue.add(fn)).rejects.toThrow('Network error');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[RateLimitQueue] Error in queued call:',
      'Network error'
    );
    consoleSpy.mockRestore();
  });

  it('processQueue non blocca se queue è vuota', async () => {
    const tracker = new RateLimitTracker();
    const queue = new RateLimitQueue(tracker);

    // Chiamare processQueue su queue vuota non dovrebbe fallire
    await queue.processQueue();

    expect(queue.queueLength).toBe(0);
  });
});
