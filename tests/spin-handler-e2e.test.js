// ─── Tests end-to-end per api/spin.js come handler Vercel (fix T1, ISSUES.md) ─
// Copre spin.js come handler (req, res) con GitHub + KV mockati, verificando i
// tre comportamenti richiesti da T1:
//   1. redirect 302 con `Location` valido (same-origin / profilo owner);
//   2. degradazione graceful quando il PAT è assente (NESSUN 500 nudo, mai una
//      pagina rotta: lo spin risponde con un 302 verso il profilo owner);
//   3. rifiuto di un `?redirect=` ostile (open-redirect / "blocklist" di T1) →
//      il redirect validato cade sul profilo owner, non sull'host malizioso.
// In più verifica il percorso di vincita reale (302 verso il repo del linguaggio
// vincente) e che le scritture GitHub/KV avvengano davvero.
//
// Esegue il vero `handler` (nessun stub): è un test e2e a tutti gli effetti,
// con la rete (GitHub) e lo stato (KV) simulati.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kvSet } from '../api/_lib/kv.js';

// ── Sentry: nessuna init reale in test ──────────────────────────────────────
vi.mock('../sentry.config.js', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ── KV simulato (store in-memory → Upstash) ───────────────────────────────
const kvStore = new Map();
vi.mock('../api/_lib/kv.js', () => ({
  kvEnabled: true,
  kvGet: vi.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null)),
  kvSet: vi.fn(async (key, val) => {
    kvStore.set(key, val);
    return true;
  }),
}));

// ── State (contatori totalSpins/totalWins) ────────────────────────────────
vi.mock('../api/_lib/state.js', () => ({
  readState: vi.fn().mockResolvedValue({
    state: { totalSpins: 0, totalWins: 0, lastWin: null },
    sha: 'state-sha',
  }),
  writeState: vi.fn().mockResolvedValue({ sha: 'state-sha-2' }),
}));

// ── GitHub network: funzioni controllabili + stub delle scritture ──────────
const ghGetJson = vi.fn();
const ghPut = vi.fn();
vi.mock('../api/_lib/github.js', async () => {
  const actual = await vi.importActual('../api/_lib/github.js');
  // Fallback esplicito per clearReadmeMarkers: quando il pool di worker
  // paralleli di Vitest non risolve in tempo `importActual` (caso flaky),
  // lo spread di `actual` risulta `{}` e le export non elencate qui
  // spariscono. clearReadmeMarkers è l'unica usata da spin.js non già
  // esplicita → la fissiamo con un fallback no-op così il mock resta
  // deterministico indipendentemente dall'ordine di esecuzione.
  const clearReadmeMarkers =
    (actual && actual.clearReadmeMarkers) || ((r) => r);
  return {
    ...actual,
    ghGetJson,
    ghPut,
    saveSlotSvg: vi.fn().mockResolvedValue({ sha: 'slot-sha-2' }),
    loadSlotSvg: vi.fn().mockResolvedValue({ content: '', sha: 'slot-sha' }),
    updateReadmeMarkers: vi.fn((r) => r),
    auditToken: vi.fn(),
    clearReadmeMarkers: vi.fn(clearReadmeMarkers),
  };
});

// ── Repo lookup (linguaggio → repo) ───────────────────────────────────────
const getRepoForLanguage = vi.fn().mockResolvedValue(null);
vi.mock('../api/_lib/repos.js', () => ({
  getRepoForLanguage,
}));

// ── Rate-limit / validazione user ─────────────────────────────────────────
vi.mock('../api/_lib/ratelimit.js', () => ({
  isValidUser: vi.fn(() => true),
}));

// ── Cooldown: sempre consentito (isoliamo il comportamento dello spin) ─────
vi.mock('../api/_lib/spin-cooldown.js', () => ({
  checkSpinCooldown: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ── Game logic: sovrascriviamo solo ciò che serve a forzare win/no-win ───
const generateGrid = vi.fn();
const checkWins = vi.fn();
const winningLangId = vi.fn();
vi.mock('../api/_lib/game.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    generateGrid,
    checkWins,
    winningLangId,
  };
});

// Handler importato DOPO i mock (dynamic import).
const handler = (await import('../api/spin.js')).default;

// ── Mock response (firma Vercel (req, res)) ───────────────────────────────
function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body = '';
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    setHeader(k, v) {
      headers[k] = v;
      return this;
    },
    status(c) {
      statusCode = c;
      return this;
    },
    send(b) {
      body = b;
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

// README di base: contiene un `api/image?v=123` che lo spin riscrive → la
// PUT di aggiornamento scatta (così verifichiamo che le scritture avvengano).
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

function req(overrides = {}) {
  return {
    method: 'GET',
    headers: { 'x-forwarded-for': '198.51.100.7' },
    query: {},
    ...overrides,
  };
}

describe('T1 — spin.js come handler (e2e, GitHub + KV mockati)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kvStore.clear();
    process.env.GITHUB_PAT = 'test-token-12345';
    // Default: nessuna vincita.
    generateGrid.mockReturnValue(
      Array.from({ length: 5 }, () => ['python', 'python', 'python'])
    );
    checkWins.mockReturnValue([]);
    winningLangId.mockReturnValue(null);
    getRepoForLanguage.mockResolvedValue(null);
    ghGetJson.mockResolvedValue({
      content: Buffer.from(README_BODY, 'utf-8').toString('base64'),
      sha: 'readme-sha',
    });
    ghPut.mockResolvedValue(undefined);
  });

  // ── 1) redirect 302 con Location valido (spin normale, nessuna vincita) ──
  it('redirect 302 con Location valido verso il profilo owner (spin senza vincita)', async () => {
    const res = makeRes();
    await handler(req(), res);
    // La PUT del README avviene in parallelo (unica GET+PUT, ~1s) SOLO SE il
    // contenuto cambia; con nessuna vincita e marker già vuoti il README non
    // cambia, quindi ghPut può NON essere chiamata. Aspettiamo il completamento.
    await new Promise((r) => setTimeout(r, 1_500));

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBeDefined();
    expect(res.headers.Location).toBe('https://github.com/simrim96');
    // NESSUN 500.
    expect(res.statusCode).not.toBe(500);
    // In assenza di vincita il README non cambia: ghPut può NON essere chiamata.
  }, 30000);

  // ── 1b) su vincita NON reindirizza più alla repo: resta sul profilo owner ───
  it('su vincita NON reindirizza alla repo (link cliccabile nel README), ma scrive su GitHub/KV', async () => {
    // Forza una vincita (count=3, NON jackpot) sul linguaggio 'javascript'.
    checkWins.mockReturnValue([
      { payline: 0, count: 3, symbol: 'javascript', positions: [], color: '#ffd700' },
    ]);
    winningLangId.mockReturnValue('javascript');
    getRepoForLanguage.mockResolvedValue({
      url: 'https://github.com/simrim96/DemoRepo',
      name: 'DemoRepo',
      description: 'A demo repository',
    });

    const res = makeRes();
    await handler(req(), res);
    // La PUT del README avviene in parallelo al redirect (unica GET+PUT, ~1s):
    // aspettiamo il completamento prima di asserire le scritture di rete.
    await new Promise((r) => setTimeout(r, 1_500));

    // Comportamento voluto: la leva NON reindirizza alla repo vincente, ma
    // riporta al profilo owner (il link cliccabile alla repo appare nel
    // marker "🏆 Last win" del README, non nel redirect).
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('https://github.com/simrim96');
    expect(res.headers.Location).not.toContain('DemoRepo');

    // Le scritture di rete avvengono davvero (slot.svg, state, README, cache):
    const { saveSlotSvg } = await import('../api/_lib/github.js');
    const { writeState } = await import('../api/_lib/state.js');
    expect(saveSlotSvg).toHaveBeenCalled();
    expect(writeState).toHaveBeenCalled();
    expect(ghPut).toHaveBeenCalled();

    const cacheCalls = kvSet.mock.calls.filter((c) =>
      String(c[0]).startsWith('gsm:readme:')
    );
    expect(cacheCalls.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  // ── 2) degradazione graceful quando il PAT è assente (mai 500) ───────────
  it('senza GITHUB_PAT risponde con 302 graceful (no 500, no pagina rotta)', async () => {
    const saved = process.env.GITHUB_PAT;
    delete process.env.GITHUB_PAT;

    const res = makeRes();
    await handler(req(), res);

    // NESSUN 500: lo spin degrada a redirect verso il profilo owner.
    expect(res.statusCode).toBe(302);
    expect(res.statusCode).not.toBe(500);
    expect(res.headers.Location).toBeDefined();
    expect(res.headers.Location).toContain('github.com/simrim96');
    // Con PAT assente NON vengono fatte chiamate GitHub/KV di scrittura.
    expect(ghPut).not.toHaveBeenCalled();

    process.env.GITHUB_PAT = saved;
  });

  // ── 3) rifiuto di `?redirect=` ostile (open-redirect / "blocklist" T1) ───
  it('rifiuta un ?redirect= verso host estraneo e cade sul profilo owner', async () => {
    const saved = process.env.GITHUB_PAT;
    delete process.env.GITHUB_PAT; // il param redirect è onorato nel branch graceful

    const res = makeRes();
    await handler(
      req({ query: { redirect: 'https://evil.example.com/phish' } }),
      res
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).not.toContain('evil.example.com');
    expect(res.headers.Location).toContain('github.com/simrim96');

    process.env.GITHUB_PAT = saved;
  });

  // ── 3b) un redirect verso un host in allowlist è invece accettato ────────
  it('accetta un ?redirect= verso un host in allowlist (es. github.com)', async () => {
    const saved = process.env.GITHUB_PAT;
    delete process.env.GITHUB_PAT;

    const allowed = 'https://github.com/simrim96?tab=repositories&language=python';
    const res = makeRes();
    await handler(req({ query: { redirect: allowed } }), res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe(allowed);

    process.env.GITHUB_PAT = saved;
  });
});
