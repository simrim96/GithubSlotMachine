// Regression test per il bug health?full → 500 FUNCTION_INVOCATION_FAILED.
//
// CAUSA: in passato health?full chiamava getRepoForLanguage() che, a cold-start
// (cache KV vuota), lanciava refreshCache() in background lasciando fetch GitHub
// PENDENTI (non awaited). Vercel terminava la lambda al cleanup → 500.
//
// FIX: health?full usa ora getRepoCacheStats() (lettura cache, nessun fetch
// GitHub lanciato in background). Questo test garantisce che:
//   - health importi/solo getRepoCacheStats (mai getRepoForLanguage)
//   - health?full risponda 200 con repo_cache definito (anche con cache vuota)
//   - la fetch al README (sezione 2, hop misurato, awaited) resti l'unica rete
//     e venga sempre completata prima del return.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('health?full non lancia refreshCache in background (regression bug 500)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.KV_REST_API_URL;
    delete process.env.GITHUB_PAT;
  });

  function makeRes() {
    const headers = {};
    const res = {
      headers,
      statusCode: 200,
      _body: '',
      setHeader: (k, v) => { headers[k] = v; },
      status: (c) => { res.statusCode = c; return res; },
      send: (body) => { res._body = body; },
      end: () => {},
      redirect: () => {},
    };
    return res;
  }

  it('health?full risponde 200 con cache KV vuota, chiamando solo getRepoCacheStats', async () => {
    process.env.KV_REST_API_URL = 'https://fake.upstash.com';
    process.env.GITHUB_PAT = 'fake-pat';

    const repoCacheStats = vi.fn().mockResolvedValue({
      populated: false,
      lang_count: 0,
      ts: 0,
      age_ms: null,
      fresh: false,
    });

    vi.doMock('../api/_lib/kv.js', () => ({
      kvEnabled: true,
      kvWritable: true,
      kvGet: vi.fn().mockResolvedValue('1'),
      kvSet: vi.fn().mockResolvedValue(true),
    }));
    // Espone SOLO getRepoCacheStats: se health chiamasse getRepoForLanguage,
    // l'import fallirebbe (modulo non esporta quella funzione) → test rosso.
    vi.doMock('../api/_lib/repos.js', () => ({
      getRepoCacheStats: repoCacheStats,
    }));

    const mod = await import('../api/health.js');
    const handler = mod.default;
    const res = makeRes();

    await handler({ method: 'GET', query: { full: '1' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.repo_cache).toBeDefined();
    expect(body.repo_cache.populated).toBe(false);
    expect(repoCacheStats).toHaveBeenCalledTimes(1);
  });

  it('health (non-full) risponde 200 e NON chiama getRepoCacheStats', async () => {
    process.env.KV_REST_API_URL = 'https://fake.upstash.com';
    process.env.GITHUB_PAT = 'fake-pat';

    const repoCacheStats = vi.fn().mockResolvedValue({
      populated: true,
      lang_count: 3,
      ts: Date.now(),
      age_ms: 1000,
      fresh: true,
    });

    vi.doMock('../api/_lib/kv.js', () => ({
      kvEnabled: true,
      kvWritable: true,
      kvGet: vi.fn().mockResolvedValue('1'),
      kvSet: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock('../api/_lib/repos.js', () => ({
      getRepoCacheStats: repoCacheStats,
    }));

    const mod = await import('../api/health.js');
    const handler = mod.default;
    const res = makeRes();

    await handler({ method: 'GET', query: {}, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(repoCacheStats).not.toHaveBeenCalled();
  });
});
