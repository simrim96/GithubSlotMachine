// Test su api/_lib/repos.js — copre il fix ISSUE-3:
//   • timeout reale su ogni fetch (AbortController + GITHUB_API_TIMEOUT_MS)
//   • concorrenza limitata a REPO_SEARCH_CONCURRENCY (niente burst di ~100 in parallelo)
//   • la cache byLangId viene popolata correttamente (≥30% di un linguaggio)
//
// Ogni test ricrea il grafo dei moduli (vi.resetModules) così la cache
// module-level riparte fredda e la refresh parte davvero.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock di kv.js: niente Redis in test, la cache resta solo in-memory.
vi.mock('../api/_lib/kv.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvEnabled: false,
}));

// Mock di github.js: accorciamo il timeout a 60ms per testare velocemente
// l'AbortController (le chiamate GitHub reali non sono colpite da questo mock).
vi.mock('../api/_lib/github.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, GITHUB_API_TIMEOUT_MS: 60 };
});

const LANGUAGES = [
  { id: 'python', name: 'Python', githubLang: 'Python' },
  { id: 'rust', name: 'Rust', githubLang: 'Rust', topic: 'rust-lang' },
];

function makeRepo(name, langs, { topics = [], stars = 0 } = {}) {
  return {
    name,
    html_url: `https://github.com/owner/${name}`,
    description: `${name} desc`,
    stargazers_count: stars,
    topics,
    languages_url: `https://api.github.com/repos/owner/${name}/languages`,
    fork: false,
    archived: false,
    langs,
  };
}

// buildFetch: fetch mock che rispetta l'AbortSignal (fondamentale per testare
// il timeout) e può simulare latenza/errori di rete.
function buildFetch(reposList, { slowUrls = [], failUrls = [] } = {}) {
  const byUrl = new Map(reposList.map((r) => [r.languages_url, r]));
  const fetchFn = vi.fn(async (url, opts = {}) => {
    const signal = opts.signal;
    const abortable = (ms, value) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        }, ms);
      });

    if (url.includes('/repos?')) {
      await abortable(0);
      return { ok: true, json: async () => reposList };
    }
    if (failUrls.includes(url)) throw new Error('network down');
    if (slowUrls.includes(url)) {
      await abortable(500, null); // verrà abortito dal timeout prima
      return { ok: true, json: async () => byUrl.get(url)?.langs || {} };
    }
    await abortable(0);
    const rep = byUrl.get(url);
    if (!rep) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => rep.langs || {} };
  });
  return fetchFn;
}

let realFetch;
beforeEach(() => {
  realFetch = global.fetch;
});
afterEach(() => {
  global.fetch = realFetch;
});

// Ricrea il grafo moduli + importa fresco (cache fredda).
async function freshImport() {
  vi.resetModules();
  const repos = await import('../api/_lib/repos.js');
  return { repos };
}

describe('repos.js — ISSUE-3 (timeout + concorrenza)', () => {
  it('REPO_SEARCH_CONCURRENCY è definito e ≤ 20 (limite di concorrenza)', async () => {
    const { repos } = await freshImport();
    expect(repos.REPO_SEARCH_CONCURRENCY).toBeGreaterThan(0);
    expect(repos.REPO_SEARCH_CONCURRENCY).toBeLessThanOrEqual(20);
  });

  it('popola la cache byLangId per un repo con ≥30% del linguaggio', async () => {
    const { repos } = await freshImport();
    const reposList = [makeRepo('pyapp', { Python: 90, JavaScript: 10 })];
    global.fetch = buildFetch(reposList);
    await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    await new Promise((r) => setTimeout(r, 60));
    const match = await repos.getRepoForLanguage(
      'tok',
      'owner',
      LANGUAGES[0],
      LANGUAGES
    );
    expect(match).not.toBeNull();
    expect(match.name).toBe('pyapp');
    expect(match.url).toContain('pyapp');
  });

  it('NON include un repo con < 30% del linguaggio', async () => {
    const { repos } = await freshImport();
    const reposList = [makeRepo('lowpy', { Python: 20, JavaScript: 80 })];
    global.fetch = buildFetch(reposList);
    await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    await new Promise((r) => setTimeout(r, 60));
    const match = await repos.getRepoForLanguage(
      'tok',
      'owner',
      LANGUAGES[0],
      LANGUAGES
    );
    expect(match).toBeNull();
  });

  it('limita la concorrenza: mai più di REPO_SEARCH_CONCURRENCY fetch /languages in parallelo', async () => {
    const { repos } = await freshImport();
    const reposList = Array.from({ length: 45 }, (_, i) =>
      makeRepo(`repo${i}`, { Python: 100 })
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const base = buildFetch(reposList);
    global.fetch = (url, opts) => {
      if (url.includes('/languages')) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return base(url, opts).finally(() => {
          inFlight--;
        });
      }
      return base(url, opts);
    };
    await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    await new Promise((r) => setTimeout(r, 250));
    expect(maxInFlight).toBeLessThanOrEqual(repos.REPO_SEARCH_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('rispetta il timeout: una fetch lenta viene abortita (AbortError)', async () => {
    const { repos } = await freshImport();
    const reposList = [makeRepo('slowapp', { Python: 100 })];
    const slow = [reposList[0].languages_url];
    let aborted = false;
    const base = buildFetch(reposList, { slowUrls: slow });
    global.fetch = (url, opts) => {
      const sig = opts?.signal;
      sig?.addEventListener('abort', () => {
        aborted = true;
      });
      return base(url, opts);
    };
    const t0 = Date.now();
    await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    // La refresh gira in background; la fetch lenta (500ms) deve essere
    // abortita dal timeout (60ms) molto prima.
    await new Promise((r) => setTimeout(r, 200));
    expect(aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it('un fetch che fallisce non rompe gli altri (errore propagato e catturato)', async () => {
    const { repos } = await freshImport();
    const reposList = [makeRepo('broken', { Python: 100 })];
    global.fetch = buildFetch(reposList, {
      failUrls: [reposList[0].languages_url],
    });
    // getRepoForLanguage non deve lanciare: la refresh gira in background e
    // cattura l'errore, ritornando null come match.
    let threw = false;
    try {
      await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
      await new Promise((r) => setTimeout(r, 60));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('repos.js — ISSUE-28 (cold-start non-bloccante ma popolato)', () => {
  it('al PRIMO giro (cache fredda) ritorna il repo popolato se la rete risponde', async () => {
    const { repos } = await freshImport();
    const reposList = [makeRepo('pyapp', { Python: 90, JavaScript: 10 })];
    global.fetch = buildFetch(reposList);
    // Chiamata singola, cold start: deve fare await della refresh (timeout
    // 800ms) e ritornare il match già al primo giro, NON null.
    const t0 = Date.now();
    const match = await repos.getRepoForLanguage(
      'tok',
      'owner',
      LANGUAGES[0],
      LANGUAGES
    );
    expect(match).not.toBeNull();
    expect(match.name).toBe('pyapp');
    // Non deve appenderci all'infinito: la rete risponde subito, ma anche nel
    // worst case il timeout cold-start è 800ms.
    expect(Date.now() - t0).toBeLessThan(800);
  });

  it('al cold start con rete troppo lenta ritorna null senza sforare l\'800ms', async () => {
    const { repos } = await freshImport();
    const reposList = [makeRepo('slowapp', { Python: 100 })];
    // fetch /repos? lenta (900ms) → sfora il cold-start timeout di 800ms.
    global.fetch = (url, opts) =>
      new Promise((resolve, reject) => {
        const signal = opts?.signal;
        if (signal?.aborted)
          return reject(new DOMException('aborted', 'AbortError'));
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          if (url.includes('/repos?'))
            return resolve({
              ok: true,
              json: async () => reposList,
            });
          resolve({ ok: true, json: async () => reposList[0].langs });
        }, 900);
      });
    const t0 = Date.now();
    const match = await repos.getRepoForLanguage(
      'tok',
      'owner',
      LANGUAGES[0],
      LANGUAGES
    );
    expect(match).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

// ─── R5: cache KV tiered (lastgood) resiliente a Upstash cross-region ────────
// Quando Upstash è in una regione diversa da Vercel (fra1), il round-trip KV
// supera i timeout e kvGet ritorna null. Il tier "lastgood" deve comunque
// fornire i repo recenti allo spin, SENZA attendere la rete GitHub.
describe('repos.js — R5 (cache tiered resiliente a Upstash cross-region)', () => {
  it('serve i repo dal tier lastgood in memoria senza attendere la rete', async () => {
    // KV "lento/cross-region": kvGet ritorna sempre null (simula timeout),
    // kvSet è un no-op. Lo spin NON deve bloccarsi.
    const slowKv = {
      kvGet: vi.fn(async () => null),
      kvSet: vi.fn(async () => false),
      kvEnabled: true,
    };
    // Pre-popola il tier lastgood in KV PRIMA dell'import del modulo: il
    // preload module-level di repos.js (loadFromKv all'init) lo legge e lo
    // carica in memoria, così getRepoForLanguage serve i repo senza rete.
    slowKv.kvGet.mockImplementation(async (key) => {
      if (key === 'gsm:repoCache:lastgood') {
        return {
          ts: Date.now() - 1000 * 60 * 60, // 1h fa → stale, ma servibile
          byLangId: { python: { name: 'pyapp', url: 'https://github.com/owner/pyapp' } },
        };
      }
      return null;
    });
    vi.doMock('../api/_lib/kv.js', () => slowKv);
    vi.resetModules();
    const repos = await import('../api/_lib/repos.js');

    const t0 = Date.now();
    const match = await repos.getRepoForLanguage(
      'tok',
      'owner',
      LANGUAGES[0],
      LANGUAGES
    );
    const elapsed = Date.now() - t0;
    // Nessun dato fresh in memoria → legge il lastgood da KV e lo serve
    // SUBITO, senza il blocco cold-start di 800ms su GitHub.
    expect(match).not.toBeNull();
    expect(match.name).toBe('pyapp');
    expect(elapsed).toBeLessThan(800);
    // La refresh gira in background (non deve aver bloccato il return).
    vi.doUnmock('../api/_lib/kv.js');
  });

  it('il tier fresh (TTL valido) prevale sul lastgood', async () => {
    const kvStore = {
      kvGet: vi.fn(async (key) => {
        if (key === 'gsm:repoCache') {
          return {
            ts: Date.now(), // fresh
            byLangId: { python: { name: 'freshRepo', url: 'https://github.com/owner/freshRepo' } },
          };
        }
        if (key === 'gsm:repoCache:lastgood') {
          return {
            ts: Date.now() - 1000 * 60 * 60,
            byLangId: { python: { name: 'staleRepo', url: 'https://github.com/owner/staleRepo' } },
          };
        }
        return null;
      }),
      kvSet: vi.fn(async () => true),
      kvEnabled: true,
    };
    vi.doMock('../api/_lib/kv.js', () => kvStore);
    vi.resetModules();
    const repos = await import('../api/_lib/repos.js');

    const match = await repos.getRepoForLanguage(
      'tok',
      'owner',
      LANGUAGES[0],
      LANGUAGES
    );
    expect(match).not.toBeNull();
    expect(match.name).toBe('freshRepo'); // il fresh batte il lastgood
    vi.doUnmock('../api/_lib/kv.js');
  });

  it('salva entrambi i tier (fresh + lastgood) dopo una refresh riuscita', async () => {
    const kvStore = {
      kvGet: vi.fn(async () => null),
      kvSet: vi.fn(async () => true),
      kvEnabled: true,
    };
    vi.doMock('../api/_lib/kv.js', () => kvStore);
    vi.resetModules();
    const repos = await import('../api/_lib/repos.js');

    const reposList = [makeRepo('pyapp', { Python: 90, JavaScript: 10 })];
    global.fetch = buildFetch(reposList);
    await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    await new Promise((r) => setTimeout(r, 80));

    const savedKeys = kvStore.kvSet.mock.calls.map((c) => c[0]);
    expect(savedKeys).toContain('gsm:repoCache');
    expect(savedKeys).toContain('gsm:repoCache:lastgood');
    vi.doUnmock('../api/_lib/kv.js');
  });

  it('Upstash totalmente down (kvGet throw) non rompe lo spin', async () => {
    // Simula Upstash che lancia (es. errore di rete) invece di ritornare null.
    const brokenKv = {
      kvGet: vi.fn(async () => {
        throw new Error('kv connection refused');
      }),
      kvSet: vi.fn(async () => false),
      kvEnabled: true,
    };
    vi.doMock('../api/_lib/kv.js', () => brokenKv);
    vi.resetModules();
    const repos = await import('../api/_lib/repos.js');

    // Nessun dato in memoria e KV rotto → cold start: attende SOLO GitHub
    // (che risponde), non deve crashare per l'errore KV.
    const reposList = [makeRepo('pyapp', { Python: 90, JavaScript: 10 })];
    global.fetch = buildFetch(reposList);
    const t0 = Date.now();
    const match = await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    expect(match).not.toBeNull();
    expect(match.name).toBe('pyapp');
    expect(Date.now() - t0).toBeLessThan(800);
    vi.doUnmock('../api/_lib/kv.js');
  });
});
