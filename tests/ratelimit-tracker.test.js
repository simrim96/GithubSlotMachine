// Test per api/_lib/ratelimit-tracker.js — Rate Limit Tracking per GitHub API
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RateLimitTracker,
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

    const state = tracker.getState();

    expect(state.remaining).toBe(5);
    expect(state.reset).toBe(1784100000);
    expect(state.totalRequests).toBe(100);
    expect(state.isBelowWarningThreshold).toBe(true);
  });

  it('reset() resetta tutti i valori', () => {
    const tracker = new RateLimitTracker();
    tracker.remaining = 5;
    tracker.reset = 1784100000;
    tracker.totalRequests = 100;

    tracker.clearState();

    expect(tracker.remaining).toBe(null);
    expect(tracker.reset).toBe(null);
    expect(tracker.totalRequests).toBe(0);
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

});
