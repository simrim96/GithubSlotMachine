// Test per il modulo kv.js — verifica del timeout e comportamento fallback
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withTimeout } from '../api/_lib/kv.js';

describe('kv.js timeout', () => {
  beforeEach(() => {
    delete process.env.KV_TIMEOUT_MS;
  });

  it('usa timeout di default 500ms quando KV_TIMEOUT_MS non è impostato', async () => {
    const slowPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('too slow')), 1000)
    );
    const fastPromise = Promise.resolve('fast');

    // Test timeout che scatta
    try {
      await withTimeout(slowPromise, 500);
      expect.fail('Dovrebbe timeoutare');
    } catch (err) {
      expect(err.message).toBe('kv timeout');
    }

    // Test promise veloce che non timeouta
    const result = await withTimeout(fastPromise, 500);
    expect(result).toBe('fast');
  });

  it('usa KV_TIMEOUT_MS da ENV se impostato', async () => {
    process.env.KV_TIMEOUT_MS = '1000';

    // Ricarichiamo il modulo per applicare le nuove ENV
    vi.resetModules();
    const { withTimeout: timeoutFn } = await import('../api/_lib/kv.js');

    const slowPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('too slow')), 800)
    );

    // Con timeout 1000ms, 800ms non dovrebbe timeoutare
    try {
      await timeoutFn(slowPromise, 1000);
      expect.fail('Dovrebbe timeoutare perché 800 < 1000');
    } catch (err) {
      expect(err.message).toBe('too slow');
    }
  });

  it('kvGet ritorna null quando Redis non è abilitato', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    vi.resetModules();
    const { kvGet, kvEnabled } = await import('../api/_lib/kv.js');

    expect(kvEnabled).toBe(false);
    const result = await kvGet('some-key');
    expect(result).toBeNull();
  });

  it('kvSet ritorna false quando Redis non è abilitato', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    vi.resetModules();
    const { kvSet, kvEnabled } = await import('../api/_lib/kv.js');

    expect(kvEnabled).toBe(false);
    const result = await kvSet('some-key', { data: 'value' });
    expect(result).toBe(false);
  });
});
