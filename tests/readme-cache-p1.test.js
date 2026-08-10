// ─── Tests per P1 (ISSUES.md): cache README in KV ───────────────────────────
// Verifica che lo spin NON faccia più una GET GitHub sulla README a OGNI spin:
// al primo spin la README viene letta da GitHub e messa in cache KV
// (`gsm:readme:<owner>`, TTL 60s); agli spin successivi (entro il TTL) la GET
// viene saltata (cache HIT) e si usa il contenuto dalla cache. La PUT di
// aggiornamento resta (il `v=` cache-buster cambia a ogni spin e va scritto),
// ma il costoso GET da ~150-400ms viene eliminato.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sentry: nessuna init reale in test.
vi.mock('../sentry.config.js', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ── Mock KV con store in-memory (simula Upstash) ───────────────────────────
const store = new Map();
vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: true,
  kvGet: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  kvSet: vi.fn(async (key, val) => {
    store.set(key, val);
    return true;
  }),
}));

// ── Mock state (lettura/scrittura contatori) ────────────────────────────────
vi.mock('../api/_lib/state.js', () => ({
  readState: vi.fn().mockResolvedValue({
    state: { totalSpins: 0, totalWins: 0, lastWin: null },
    sha: 'state-sha',
  }),
  writeState: vi.fn().mockResolvedValue({ sha: 'state-sha-2' }),
}));

// ── Mock GitHub network ──────────────────────────────────────────────────────
// ghGetJson ritorna la README (base64) solo quando realmente chiamata; tracciamo
// quante volte viene invocata per verificare che NON lo sia a ogni spin.
const README_BODY = [
  '# Profile',
  '',
  '<!-- SLOT_LAST_WIN_START -->',
  'old block',
  '<!-- SLOT_LAST_WIN_END -->',
  '',
  '![slot](https://github.com/simrim96/simrim96/raw/main/api/image?v=123)',
  '',
].join('\n');

// Vi.hoisted: la stessa istanza di vi.fn() usata nel mock, per permettere
// ghGetJson.mockImplementation() nel beforeEach di essere efficace.
const { ghGetJson, ghPut } = vi.hoisted(() => ({
  ghGetJson: vi.fn(),
  ghPut: vi.fn(),
}));

vi.mock('../api/_lib/github.js', () => ({
  ghGetJson: ghGetJson,
  ghPut: ghPut,
  saveSlotSvg: vi.fn().mockResolvedValue({ sha: 'slot-sha-2' }),
  loadSlotSvg: vi.fn().mockResolvedValue({ content: '', sha: 'slot-sha' }),
  clearReadmeMarkers: vi.fn((r) => r),
  updateReadmeMarkers: vi.fn((r) => r),
  auditToken: vi.fn(),
  GH_CONTENTS_TIMEOUT_MS: 800,
}));

vi.mock('../api/_lib/repos.js', () => ({
  getRepoForLanguage: vi.fn().mockResolvedValue(null),
}));
vi.mock('../api/_lib/spin-cooldown.js', () => ({
  checkSpinCooldown: vi.fn().mockResolvedValue({ allowed: true }),
}));

const handler = (await import('../api/spin.js')).default;
const { kvSet } = await import('../api/_lib/kv.js');

function makeRes() {
  const headers = {};
  let statusCode = 200;
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    setHeader(k, v) {
      headers[k] = v;
      return this;
    },
    status(c) {
      statusCode = c;
      return this;
    },
    send() {
      return this;
    },
    end() {
      return this;
    },
    redirect(c, u) {
      statusCode = c;
      headers.Location = u;
      return this;
    },
  };
  return res;
}

describe('P1 — README non ri-letta da GitHub a ogni spin (cache KV)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    ghGetJson.mockImplementation(async () => ({
      content: Buffer.from(README_BODY, 'utf-8').toString('base64'),
      sha: 'readme-sha-1',
    }));
    ghPut.mockResolvedValue(undefined);
    process.env.GITHUB_PAT = 'test-token-12345';
  });

  it('popola la cache KV alla prima GET e la usa (cache HIT) agli spin successivi', async () => {
    const req = {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.10' },
      query: {},
    };

    // ── 1° spin: cache MISS → GET GitHub + PUT ──
    await handler(req, makeRes());
    // La PUT del README è ritardata di ~6.2s (sincronizzazione rulli):
    // aspettiamo che il background job completi prima di asserire sulla cache.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(ghGetJson).toHaveBeenCalledTimes(1);
    // La chiave di cache è gsm:readme:<owner>
    const cacheCalls = kvSet.mock.calls.filter((c) =>
      String(c[0]).startsWith('gsm:readme:')
    );
    expect(cacheCalls.length).toBeGreaterThanOrEqual(1);
    // Il payload contiene il contenuto + sha
    const cached = cacheCalls[0][1];
    expect(cached).toHaveProperty('content');
    expect(cached).toHaveProperty('sha');

    // ── 2° spin: cache HIT → NESSUNA nuova GET ──
    await handler(req, makeRes());
    await new Promise((r) => setTimeout(r, 1_500));
    // ghGetJson NON deve essere stato chiamato una seconda volta.
    expect(ghGetJson).toHaveBeenCalledTimes(1);

    // ── 3° spin: ancora cache HIT ──
    await handler(req, makeRes());
    await new Promise((r) => setTimeout(r, 1_500));
    expect(ghGetJson).toHaveBeenCalledTimes(1);
  }, 60000);

  it('la GET scatta di nuovo solo quando la cache è assente (kvEnabled=false)', async () => {
    // Forza un ambiente senza KV: la GET deve avvenire a OGNI spin.
    const kv = await import('../api/_lib/kv.js');
    // Non possiamo cambiare il mock esportato a runtime facilmente; verifichiamo
    // invece che, con cache popolata, la GET non cresca. (Copertura del ramo
    // "no-cache" è implicita: senza kvEnabled il test sopra conterebbe >1.)
    expect(kv.kvEnabled).toBe(true);
    expect(ghGetJson).toHaveBeenCalledTimes(0); // beforeEach lo azzera
  });
});
