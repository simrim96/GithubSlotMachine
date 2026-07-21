// Test per ISSUE-4: Concorrenza / correttezza
// Verifica che l'incremento del counter su Redis sia atomico (INCR)
// per evitare race condition quando due spin arrivano quasi in contemporanea
//
// Il bug era: se due spin arrivano contemporaneamente, entrambi leggono
// lo stesso stato da Redis, incrementano di 1, e il secondo sovrascrive il
// primo. Il contatore totale aumenterebbe di 1 invece che di 2.
//
// Fix: usare l'operazione atomica INCR di Redis per incrementare i counter.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('ISSUE-4: incremento atomico dei counter (race condition fix)', () => {
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
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;
  });

  it('kvIncr usa operazioni ATOMICHE per evitare race condition', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';
    process.env.KV_TIMEOUT_MS = '1000';

    // Simuliamo un Redis con Map per tenere traccia dei counter
    const counters = new Map();
    
    // Mock di fetch per simulare l'endpoint INCR REST
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      // Simuliamo risposta per endpoint /incr/:key
      if (path.startsWith('/incr/')) {
        const key = decodeURIComponent(path.split('/').pop());
        const current = counters.get(key) || 0;
        const newValue = current + 1;
        counters.set(key, newValue);
        
        return {
          ok: true,
          json: async () => ({ result: newValue }),
        };
      }
      
      // Fallback per altre chiamate
      return {
        ok: false,
        json: async () => null,
      };
    });

    vi.resetModules();
    const { kvIncr, kvEnabled, kvWritable } = await import('../api/_lib/kv.js');

    expect(kvEnabled).toBe(true);
    expect(kvWritable).toBe(true);

    // Simuliamo due spin che arrivano contemporaneamente
    // Con l'approccio atomico INCR, ogni increment è indipendente
    const spin1 = await kvIncr('gsm:counter:spins');
    const spin2 = await kvIncr('gsm:counter:spins');
    
    // Verifichiamo che i counter siano stati incrementati correttamente
    expect(spin1).toBe(1);
    expect(spin2).toBe(2);
    
    // Anche se gli spin arrivano "contemporaneamente" (in sequenza nei test),
    // INCR garantisce che ogni incremento sia atomico
    expect(counters.get('gsm:counter:spins')).toBe(2);
  });

  it('writeState usa kvIncr per incrementare atomicamente totalSpins e totalWins', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';
    process.env.KV_TIMEOUT_MS = '500';

    // Simuliamo un Redis con Map per stato e counter
    const redisState = new Map();
    const counters = new Map();
    
    // Mock di fetch per simulare tutte le operazioni REST API
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      if (path.startsWith('/incr/')) {
        // Simuliamo INCR
        const key = decodeURIComponent(path.split('/').pop());
        const current = counters.get(key) || 0;
        const newValue = current + 1;
        counters.set(key, newValue);
        
        return {
          ok: true,
          json: async () => ({ result: newValue }),
        };
      }
      
      if (path === '/db') {
        // Simuliamo SET/PUT
        const body = options?.body ? JSON.parse(options.body) : {};
        const { key, value } = body;
        redisState.set(key, value);
        
        return {
          ok: true,
          json: async () => ({ result: 'OK' }),
        };
      }
      
      if (path.startsWith('/key/')) {
        // Simuliamo GET
        const key = decodeURIComponent(path.split('/').pop());
        const value = redisState.get(key);
        
        return {
          ok: true,
          json: async () => ({ result: value }),
        };
      }
      
      // Fallback
      return {
        ok: false,
        json: async () => null,
      };
    });

    // Mock completo di github.js con ES module syntax (vi.mock factory)
    const originalGithubModule = await import('../api/_lib/github.js');
    const mockState = { totalSpins: 0, totalWins: 0, version: 2 };
    
    vi.doMock('../api/_lib/github.js', () => ({
      ...originalGithubModule,
      ghGetContentsJson: vi.fn().mockResolvedValue({
        content: Buffer.from(JSON.stringify(mockState)).toString('base64'),
        sha: 'abc123',
      }),
    }));

    vi.resetModules();
    const { writeState, readState } = await import('../api/_lib/state.js');

    // Primo spin
    const state1 = { totalSpins: 0, totalWins: 0, version: 2 };
    await writeState('fake-token', 'owner', 'repo', state1, null);
    
    // Legge lo stato dopo il primo spin
    const result1 = await readState('fake-token', 'owner', 'repo');
    expect(result1.state.totalSpins).toBe(1);
    expect(result1.state.totalWins).toBe(1);

    // Secondo spin (simula arrivo contemporaneo)
    const state2 = { totalSpins: 0, totalWins: 0, version: 2 };
    await writeState('fake-token', 'owner', 'repo', state2, null);
    
    // Legge lo stato dopo il secondo spin
    const result2 = await readState('fake-token', 'owner', 'repo');
    
    // CON IL FIX ATOMICO: i counter devono essere 2
    expect(result2.state.totalSpins).toBe(2);
    expect(result2.state.totalWins).toBe(2);
    
    // VERIFICA CRITICA: se non fosse atomico, totalSpins sarebbe 1
    // (perché il secondo spin sovrascriverebbe il primo)
    expect(counters.get('gsm:counter:spins')).toBe(2);
  });

  it('due incrementi paralleli (simulati) producono risultati atomici corretti', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://write.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN='***';

    const counters = new Map();
    
    // Mock di fetch per INCR
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      if (path.startsWith('/incr/')) {
        const key = decodeURIComponent(path.split('/').pop());
        const current = counters.get(key) || 0;
        const newValue = current + 1;
        counters.set(key, newValue);
        
        return {
          ok: true,
          json: async () => ({ result: newValue }),
        };
      }
      
      return {
        ok: false,
        json: async () => null,
      };
    });

    vi.resetModules();
    const { kvIncr } = await import('../api/_lib/kv.js');

    // Simuliamo N spin che arrivano quasi contemporaneamente
    const N = 10;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(kvIncr('gsm:counter:spins'));
    }
    
    // Esegui tutti gli incrementi (in parallelo, ma INCR è atomica)
    const results = await Promise.all(promises);
    
    // Ogni risultato deve essere unico e sequenziale: 1, 2, 3, ..., N
    const expected = Array.from({ length: N }, (_, i) => i + 1);
    const sortedResults = [...results].sort((a, b) => a - b);
    
    expect(sortedResults).toEqual(expected);
    expect(counters.get('gsm:counter:spins')).toBe(N);
  });
});
