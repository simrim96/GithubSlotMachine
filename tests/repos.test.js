// Test su api/_lib/repos.js — copre il fix ISSUE-3:
//   • timeout reale su ogni fetch (AbortController + GITHUB_API_TIMEOUT_MS)
//   • concorrenza limitata a REPO_LANG_BATCH_SIZE (niente burst di ~100 in parallelo)
//   • il circuit breaker di github.js è riusato (gli errori propagano e contano)
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

// Mock di github.js: manteniamo il circuit breaker REALE ma accorciamo il
// timeout a 60ms per testare velocemente l'AbortController.
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

// Ricrea il grafo moduli + importa fresco (cache fredda, breaker pulito).
async function freshImport() {
  vi.resetModules();
  const repos = await import('../api/_lib/repos.js');
  const gh = await import('../api/_lib/github.js');
  return { repos, gh };
}

describe('repos.js — ISSUE-3 (timeout + concorrenza + breaker)', () => {
  it('REPO_LANG_BATCH_SIZE è definito e ≤ 20 (limite di concorrenza)', async () => {
    const { repos } = await freshImport();
    expect(repos.REPO_LANG_BATCH_SIZE).toBeGreaterThan(0);
    expect(repos.REPO_LANG_BATCH_SIZE).toBeLessThanOrEqual(20);
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

  it('limita la concorrenza: mai più di REPO_LANG_BATCH_SIZE fetch /languages in parallelo', async () => {
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
    expect(maxInFlight).toBeLessThanOrEqual(repos.REPO_LANG_BATCH_SIZE);
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

  it('propaga l’errore al circuit breaker (fetch che fallisce conta come failure)', async () => {
    const { repos, gh } = await freshImport();
    const reposList = [makeRepo('broken', { Python: 100 })];
    global.fetch = buildFetch(reposList, {
      failUrls: [reposList[0].languages_url],
    });
    await repos.getRepoForLanguage('tok', 'owner', LANGUAGES[0], LANGUAGES);
    await new Promise((r) => setTimeout(r, 60));
    expect(gh.githubCircuitBreaker.failures).toBeGreaterThanOrEqual(1);
  });
});
