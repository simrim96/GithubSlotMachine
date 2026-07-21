// Test per api/_lib/ratelimit-tracker.js — parsing header rate limit GitHub
// (ISSUE-12: la classe RateLimitTracker è stata rimossa; restano solo gli
// helper di parsing header e il logging).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  safeGetHeader,
  parseRateLimitHeaders,
  logRateLimit,
  GITHUB_RATE_LIMIT_WARNING_THRESHOLD,
} from '../api/_lib/ratelimit-tracker.js';

function makeHeaders(map) {
  return { get: (name) => (map.has(name) ? map.get(name) : null) };
}

describe('safeGetHeader', () => {
  it('legge da Headers standard', () => {
    const h = makeHeaders(new Map([['X-RateLimit-Remaining', '4999']]));
    expect(safeGetHeader(h, 'X-RateLimit-Remaining')).toBe('4999');
  });

  it('legge da oggetto plain (case-insensitive)', () => {
    expect(safeGetHeader({ 'x-ratelimit-remaining': '10' }, 'X-RateLimit-Remaining')).toBe('10');
  });

  it('ritorna null su headers undefined', () => {
    expect(safeGetHeader(undefined, 'X-RateLimit-Remaining')).toBe(null);
  });

  it('ritorna null su oggetto plain senza la chiave', () => {
    expect(safeGetHeader({}, 'X-RateLimit-Remaining')).toBe(null);
  });
});

describe('parseRateLimitHeaders', () => {
  it('estrae remaining e reset da Headers', () => {
    const h = makeHeaders(
      new Map([
        ['X-RateLimit-Remaining', '4999'],
        ['X-RateLimit-Reset', '1784100000'],
      ])
    );
    const r = parseRateLimitHeaders({ headers: h });
    expect(r.remaining).toBe(4999);
    expect(r.reset).toBe(1784100000);
  });

  it('ritorna null se gli header sono assenti', () => {
    const r = parseRateLimitHeaders({ headers: makeHeaders(new Map()) });
    expect(r.remaining).toBe(null);
    expect(r.reset).toBe(null);
  });

  it('ritorna null su valori non numerici', () => {
    const h = makeHeaders(new Map([['X-RateLimit-Remaining', 'invalid']]));
    const r = parseRateLimitHeaders({ headers: h });
    expect(r.remaining).toBe(null);
  });

  it('accetta un oggetto headers passato direttamente (senza .headers)', () => {
    const h = makeHeaders(
      new Map([
        ['X-RateLimit-Remaining', '100'],
        ['X-RateLimit-Reset', '1784100000'],
      ])
    );
    const r = parseRateLimitHeaders(h);
    expect(r.remaining).toBe(100);
  });
});

describe('logRateLimit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stampa warning su stderr quando remaining <= threshold', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const h = makeHeaders(
      new Map([
        ['X-RateLimit-Remaining', String(GITHUB_RATE_LIMIT_WARNING_THRESHOLD)],
        ['X-RateLimit-Reset', '1784100000'],
      ])
    );
    logRateLimit({ headers: h });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"warn"')
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"GitHub Rate Limit status"')
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('"remaining":10')
    );
  });

  it('NON stampa warning quando remaining > threshold', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const h = makeHeaders(
      new Map([
        ['X-RateLimit-Remaining', '4999'],
        ['X-RateLimit-Reset', '1784100000'],
      ])
    );
    logRateLimit({ headers: h });
    expect(spy).not.toHaveBeenCalled();
  });

  it('gestisce reset non numerico senza crash', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const h = makeHeaders(
      new Map([
        ['X-RateLimit-Remaining', '5'],
        ['X-RateLimit-Reset', 'invalid'],
      ])
    );
    expect(() => logRateLimit({ headers: h })).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('ignora header mancanti senza crash né log', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logRateLimit({ headers: makeHeaders(new Map()) });
    expect(spy).not.toHaveBeenCalled();
  });
});
