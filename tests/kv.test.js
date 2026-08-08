// Test per il modulo kv.js — verifica del timeout e comportamento fetch diretto
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;

    vi.resetModules();
    const { kvGet, kvEnabled } = await import('../api/_lib/kv.js');

    expect(kvEnabled).toBe(false);
    const result = await kvGet('some-key');
    expect(result).toBeNull();
  });

  it('kvSet ritorna false quando Redis non è abilitato', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;

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

  afterEach(() => {
    delete globalThis.fetchMock;
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
    process.env.KV_REST_API_READ_ONLY_TOKEN = 'read-token';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { kvSet } = await import('../api/_lib/kv.js');

    const result = await kvSet('gsm:slotSvg', '<svg/>');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/nessun token di SCRITTURA/i);
    expect(warnSpy.mock.calls[0][0]).toMatch(/SCRITTURA/i);
    
    warnSpy.mockRestore();
  });

  it('con UPSTASH_REDIS_REST_TOKEN: kvWritable=true e kvSet usa fetch diretto', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';

    vi.resetModules();

    // Mock fetch globale prima di importare il modulo
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'OK' }),
    });

    const { kvEnabled, kvWritable, kvSet } = await import('../api/_lib/kv.js');

    expect(kvEnabled).toBe(true);
    expect(kvWritable).toBe(true);

    const result = await kvSet('gsm:slotSvg', '<svg/>');
    expect(result).toBe(true);
    
    // Verifica che fetch sia stato chiamato
    expect(globalThis.fetch).toHaveBeenCalled();
    
    // Ripristina fetch originale
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('kvSet logga un warning esplicito su errore 401/403 invece di fallire in silenzio', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';

    vi.resetModules();

    // Mock fetch che simula errore 401
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { kvSet } = await import('../api/_lib/kv.js');

    const result = await kvSet('gsm:slotSvg', '<svg/>');
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/scrittura negata|401|403/i);
    
    warnSpy.mockRestore();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
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

    afterEach(() => {
      delete globalThis.fetchMock;
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
      const { kvIncr } = await import('../api/_lib/kv.js');

      const result = await kvIncr('gsm:counter:spins');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('[kvIncr] no write token configured', {
        key: 'gsm:counter:spins',
      });
    });

    it('kvIncr incrementa correttamente un contatore su Upstash (simulato)', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN='***';

      vi.resetModules();

      // Mock fetch globale prima di importare il modulo
      const originalFetch = globalThis.fetch;
      let callCount = 0;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          callCount++;
          return { result: callCount };
        },
      });

      const { kvIncr } = await import('../api/_lib/kv.js');

      // Primo increment
      const result1 = await kvIncr('gsm:counter:spins');
      expect(result1).toBe(1);

      // Secondo increment
      const result2 = await kvIncr('gsm:counter:spins');
      expect(result2).toBe(2);
      
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      }
    });

    it('kvIncr gestisce correttamente il timeout', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN='***';

      vi.resetModules();

      // Mock fetch che timeouta
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('fetch timeout')), 1000)
        )
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { kvIncr } = await import('../api/_lib/kv.js');

      const result = await kvIncr('gsm:counter:spins');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('[kvIncr] failed', expect.objectContaining({
        key: 'gsm:counter:spins',
      }));
      
      warnSpy.mockRestore();
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('SEC-2: test mancanti per kvMset e kvMget', () => {
    beforeEach(() => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.KV_REST_API_READ_ONLY_TOKEN;
    });

    it('kvMget ritorna array di null quando Redis non è abilitato', async () => {
      vi.resetModules();
      const { kvMget } = await import('../api/_lib/kv.js');

      const result = await kvMget('key1', 'key2', 'key3');
      expect(result).toEqual([null, null, null]);
    });

    it('kvMget restituisce risultati correttamente quando Redis è abilitato', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://kv.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = '***';

      vi.resetModules();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: ['val1', null, 'val3'] }),
      });

      const { kvMget } = await import('../api/_lib/kv.js');

      const result = await kvMget('key1', 'key2', 'key3');
      expect(result).toEqual(['val1', null, 'val3']);

      // FIX REST format (2026-08-08): MGET va in path, non in body.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://kv.upstash.io/mget/key1/key2/key3',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ***',
          }),
        })
      );

      if (originalFetch) globalThis.fetch = originalFetch;
    });

    it('kvMget ritorna array di null su errore HTTP', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://kv.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = '***';

      vi.resetModules();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { kvMget } = await import('../api/_lib/kv.js');

      const result = await kvMget('key1', 'key2');
      expect(result).toEqual([null, null]);

      if (originalFetch) globalThis.fetch = originalFetch;
    });

    it('kvMset ritorna false quando Redis non è abilitato', async () => {
      vi.resetModules();
      const { kvMset } = await import('../api/_lib/kv.js');

      const result = await kvMset({ key1: 'val1', key2: 'val2' });
      expect(result).toBe(false);
    });

    it('kvMset ritorna false e logga warning senza token di scrittura', async () => {
      process.env.KV_REST_API_URL = 'https://read-only.upstash.io';
      process.env.KV_REST_API_READ_ONLY_TOKEN = 'read-only-token';

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.resetModules();
      const { kvMset } = await import('../api/_lib/kv.js');

      const result = await kvMset({ key1: 'val1', key2: 'val2' });
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        '[kvMset] nessun token di SCRITTURA configurato:',
        expect.objectContaining({
          keys: 'key1, key2',
        })
      );

      warnSpy.mockRestore();
    });

    it('kvMset salva correttamente le coppie su Upstash (simulato)', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://kv.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = '***';

      vi.resetModules();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'OK' }),
      });

      const { kvMset } = await import('../api/_lib/kv.js');

      const result = await kvMset({ a: '1', b: '2' });
      expect(result).toBe(true);

      // FIX REST format (2026-08-08): MSET va in path (k1/v1/k2/v2), non in body.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://kv.upstash.io/mset/a/1/b/2',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer ***',
          }),
        })
      );

      if (originalFetch) globalThis.fetch = originalFetch;
    });

    it('kvMset gestisce correttamente il timeout', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://kv.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = '***';

      vi.resetModules();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('fetch timeout')), 1000)
        )
      );

      const { kvMset } = await import('../api/_lib/kv.js');

      const result = await kvMset({ key: 'value' });
      // kvMset non logga su errore, ritorna solo false
      expect(result).toBe(false);

      if (originalFetch) globalThis.fetch = originalFetch;
    });
  });
});
