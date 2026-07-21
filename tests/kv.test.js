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

describe('ISSUE-23: separazione token lettura/scrittura', () => {
  beforeEach(() => {
    // Pulizia completa delle env KV/Upstash prima di ogni test
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;
    vi.restoreAllMocks();
  });

  it('con solo KV_REST_API_READ_ONLY_TOKEN: kvEnabled=true (lettura ok) ma kvWritable=false', async () => {
    process.env.KV_REST_API_URL = 'https://read-only.upstash.io';
    process.env.KV_REST_API_READ_ONLY_TOKEN = 'read-only-token';

    vi.resetModules();
    const { kvEnabled, kvWritable } = await import('../api/_lib/kv.js');

    // PRIMA (bug): kvEnabled era true e le scritture fallivano silenziosamente.
    // ORA: leggiamo ancora, ma segnaliamo che non si può scrivere.
    expect(kvEnabled).toBe(true);
    expect(kvWritable).toBe(false);
  });

  it('con solo KV_REST_API_READ_ONLY_TOKEN: kvSet ritorna false e logga un warning', async () => {
    process.env.KV_REST_API_URL = 'https://read-only.upstash.io';
    process.env.KV_REST_API_READ_ONLY_TOKEN = 'read-only-token';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.resetModules();
    const { kvSet } = await import('../api/_lib/kv.js');

    const result = await kvSet('gsm:slotSvg', '<svg/>');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/nessun token di SCRITTURA/i);
    expect(warnSpy.mock.calls[0][0]).toMatch(/KV_REST_API_READ_ONLY_TOKEN/);
  });

  it('con UPSTASH_REDIS_REST_TOKEN: kvWritable=true e kvSet usa il client di scrittura', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';

    // Client fake deterministico: registriamo la chiamata a .set()
    const FakeRedis = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockResolvedValue('OK'),
      mset: vi.fn().mockResolvedValue('OK'),
    }));
    vi.doMock('@upstash/redis', () => ({ Redis: FakeRedis }));

    vi.resetModules();
    const { kvEnabled, kvWritable, kvSet } = await import('../api/_lib/kv.js');

    expect(kvEnabled).toBe(true);
    expect(kvWritable).toBe(true);

    const result = await kvSet('gsm:slotSvg', '<svg/>');
    expect(result).toBe(true);
    expect(FakeRedis).toHaveBeenCalled();
    // Il client di SCRITTURA deve essere stato costruito con il write token
    const usedToken = FakeRedis.mock.calls[0][0].token;
    expect(usedToken).toBe('***');

    vi.doUnmock('@upstash/redis');
  });

  it('kvSet logga un warning esplicito su errore 401/403 invece di fallire in silenzio', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';

    // Client fake che rifiuta con un errore di autenticazione (come Upstash 401).
    const authErr = Object.assign(new Error('UpstashError: Unauthorized'), {
      status: 401,
    });
    const FakeRedis = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockRejectedValue(authErr),
      mset: vi.fn().mockRejectedValue(authErr),
    }));
    vi.doMock('@upstash/redis', () => ({ Redis: FakeRedis }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.resetModules();
    const { kvSet } = await import('../api/_lib/kv.js');

    const result = await kvSet('gsm:slotSvg', '<svg/>');
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/scrittura negata|401|403/i);

    vi.doUnmock('@upstash/redis');
  });

  it('isAuthError rileva 401/403 e messaggi di permesso negato', async () => {
    vi.resetModules();
    const { isAuthError } = await import('../api/_lib/kv.js');

    expect(isAuthError({ status: 401 })).toBe(true);
    expect(isAuthError({ status: 403 })).toBe(true);
    expect(isAuthError({ message: 'UpstashError: Unauthorized' })).toBe(true);
    expect(isAuthError({ message: 'forbidden' })).toBe(true);
    expect(isAuthError({ message: 'network timeout' })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });

  describe('ISSUE-4: incremento atomico con kvIncr', () => {
    beforeEach(() => {
      // Pulizia completa delle env KV/Upstash prima di ogni test
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.KV_REST_API_READ_ONLY_TOKEN;
    });

    it('kvIncr ritorna null quando Redis non è abilitato', async () => {
      vi.resetModules();
      const { kvIncr, kvEnabled } = await import('../api/_lib/kv.js');

      expect(kvEnabled).toBe(false);
      const result = await kvIncr('gsm:counter:spins');
      expect(result).toBeNull();
    });

    it('kvIncr ritorna null quando non c\'è token di scrittura', async () => {
      process.env.KV_REST_API_URL = 'https://read-only.upstash.io';
      process.env.KV_REST_API_READ_ONLY_TOKEN = 'read-only-token';

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.resetModules();
      const { kvIncr, kvEnabled, kvWritable } = await import('../api/_lib/kv.js');

      expect(kvEnabled).toBe(true);
      expect(kvWritable).toBe(false);

      const result = await kvIncr('gsm:counter:spins');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('kvIncr ignored: no write token configured', { key: 'gsm:counter:spins' });
    });

    it('kvIncr incrementa correttamente un contatore su Redis (simulato)', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = '***';

      // Client fake: incrementa un contatore simulato
      const counters = new Map();
      const FakeRedis = vi.fn().mockImplementation(() => ({
        incr: vi.fn().mockImplementation(async (key) => {
          const current = counters.get(key) || 0;
          const newValue = current + 1;
          counters.set(key, newValue);
          return newValue;
        }),
      }));
      vi.doMock('@upstash/redis', () => ({ Redis: FakeRedis }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.resetModules();
      const { kvIncr, kvEnabled, kvWritable } = await import('../api/_lib/kv.js');

      expect(kvEnabled).toBe(true);
      expect(kvWritable).toBe(true);

      // Primo increment
      const result1 = await kvIncr('gsm:counter:spins');
      expect(result1).toBe(1);

      // Secondo increment
      const result2 = await kvIncr('gsm:counter:spins');
      expect(result2).toBe(2);

      // Terzo increment
      const result3 = await kvIncr('gsm:counter:spins');
      expect(result3).toBe(3);

      // Il contatore wins è indipendente
      const winsResult1 = await kvIncr('gsm:counter:wins');
      expect(winsResult1).toBe(1);

      warnSpy.mockRestore();
      vi.doUnmock('@upstash/redis');
    });

    it('kvIncr gestisce correttamente il timeout', async () => {
      process.env.KV_TIMEOUT_MS = '50';

      process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = '***';

      // Client fake: simula un timeout
      const FakeRedis = vi.fn().mockImplementation(() => ({
        incr: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 1;
        }),
      }));
      vi.doMock('@upstash/redis', () => ({ Redis: FakeRedis }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.resetModules();
      const { kvIncr } = await import('../api/_lib/kv.js');

      // Dovrebbe timeoutare e ritonare null
      const result = await kvIncr('gsm:counter:spins');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('kvIncr failed', expect.objectContaining({
        error: 'kv timeout',
        key: 'gsm:counter:spins'
      }));

      warnSpy.mockRestore();
      vi.doUnmock('@upstash/redis');
    });
  });
});
