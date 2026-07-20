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
vi.mock('../api/_lib/github.js', () => ({
  ghGetJson,
  ghPut,
  saveSlotSvg: vi.fn().mockResolvedValue({ sha: 'slot-sha-2' }),
  loadSlotSvg: vi.fn().mockResolvedValue({ content: '', sha: 'slot-sha' }),
  updateReadmeMarkers: vi.fn((r) => r),
  auditToken: vi.fn(),
}));

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

// ── Game logic: sovrascriviamo solo ciò che serve a forzare win/no-win ────
// (il resto resta reale così la griglia/SVG restano coerenti).
const generateGrid = vi.fn();
const checkWins = vi.fn();
const winningLangId = vi.fn();
const detectNearMiss = vi.fn();
vi.mock('../api/_lib/game.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    generateGrid,
    checkWins,
    winningLangId,
    detectNearMiss,
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
    // Default: nessuna vincita, nessun near-miss.
    generateGrid.mockReturnValue(
      Array.from({ length: 5 }, () => ['python', 'python', 'python'])
    );
    checkWins.mockReturnValue([]);
    winningLangId.mockReturnValue(null);
    detectNearMiss.mockReturnValue(-1);
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

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBeDefined();
    expect(res.headers.Location).toBe('https://github.com/simrim96');
    // NESSUN 500.
    expect(res.statusCode).not.toBe(500);
    // Lo slot è stato persistito (scrittura reale, non solo calcolo).
    expect(ghPut).toHaveBeenCalled();
  });

  // ── 1b) redirect 302 verso il repo del linguaggio vincente (win reale) ───
  it('su vincita reindirizza 302 verso il repo del linguaggio e scrive su GitHub/KV', async () => {
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

    // Destinazione = repo del linguaggio vincente (non jackpot → usa repoMatch.url).
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('https://github.com/simrim96/DemoRepo');

    // Le scrittureNetwork avvengono davvero:
    //  • slot.svg salvato (KV/GitHub)
    //  • state aggiornato
    //  • README GET+PUT eseguiti
    //  • cache README popolata in KV (chiave gsm:readme:<owner>)
    const { saveSlotSvg } = await import('../api/_lib/github.js');
    const { writeState } = await import('../api/_lib/state.js');
    expect(saveSlotSvg).toHaveBeenCalled();
    expect(writeState).toHaveBeenCalled();
    expect(ghPut).toHaveBeenCalled();

    const cacheCalls = kvSet.mock.calls.filter((c) =>
      String(c[0]).startsWith('gsm:readme:')
    );
    expect(cacheCalls.length).toBeGreaterThanOrEqual(1);
  });

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
