// ─── Test memoizzazione sha di state.json (gsm:state:sha) ────────────────────
// Pattern speculare a gsm:slotSvg:sha (github.js): il sync fire-and-forget di
// state.json su GitHub passa dal GET-first di ghPut → 2 round trip per spin.
// ORA:
//   • readState (percorso KV) legge stato + sha memoizzato con kvMget in UNA
//     sola round trip e propaga lo sha a writeState → ghPut → UNA PUT.
//   • syncStateToGitHub memoizza lo sha POST-PUT in KV (gsm:state:sha) dopo
//     ogni PUT riuscita (fire-and-forget, come saveSlotSvg).
//   • su modifica esterna dello stato, lo sha stale produce un 409 che ghPut
//     risolve da solo (refetch → PUT) e lo sha nuovo viene rimemoizzato.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock KV con funzioni controllabili ──────────────────────────────────────
const kvMocks = vi.hoisted(() => ({
  kvEnabled: true,
  kvWritable: true,
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => true),
  kvIncr: vi.fn(async () => 1),
  kvMget: vi.fn(async () => [null, null]),
  kvDel: vi.fn(async () => true),
}));

vi.mock('../api/_lib/kv.js', () => kvMocks);

// ── Mock Sentry (importato dal modulo reale di state.js via logger) ────────
vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn(), captureException: vi.fn() },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// ── Mock github.js: controlliamo ghPut e ghGetContentsJson ──────────────────
const ghPut = vi.fn();
const ghGetContentsJson = vi.fn();
vi.mock('../api/_lib/github.js', () => ({
  ghPut,
  ghGetContentsJson,
}));

const stateMod = await import('../api/_lib/state.js');
const { readState, writeState, syncStateToGitHub } = stateMod;

const TOKEN = 'github_pat_test';
const OWNER = 'simrim96';
const REPO = 'GithubSlotMachine';
const STATE = { totalSpins: 10, totalWins: 3, lastWin: null, version: 2 };

describe('readState — percorso KV con sha memoizzato (velocizzazione)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kvMocks.kvEnabled = true;
    kvMocks.kvSet.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('legge stato + sha memoizzato in UNA kvMget (sync a chiamata singola)', async () => {
    kvMocks.kvMget.mockResolvedValue([STATE, 'stored-sha']);

    const res = await readState(TOKEN, OWNER, REPO);

    expect(kvMocks.kvMget).toHaveBeenCalledWith('gsm:state', 'gsm:state:sha');
    expect(res).toEqual({
      state: expect.objectContaining({ totalSpins: 10, version: 2 }),
      sha: 'stored-sha',
    });
    // Nessun fallback GitHub: la copia KV basta.
    expect(ghGetContentsJson).not.toHaveBeenCalled();
  });

  it('senza sha memoizzato (primo giro): sha null → ghPut farà GET-first', async () => {
    kvMocks.kvMget.mockResolvedValue([STATE, null]);

    const res = await readState(TOKEN, OWNER, REPO);

    expect(res).toEqual({
      state: expect.objectContaining({ totalSpins: 10 }),
      sha: null,
    });
    expect(ghGetContentsJson).not.toHaveBeenCalled();
  });

  it('KV vuoto → seed da GitHub: propaga lo sha letto (prima PUT a chiamata singola)', async () => {
    kvMocks.kvMget.mockResolvedValue([null, null]);
    ghGetContentsJson.mockResolvedValue({
      sha: 'gh-sha',
      content: Buffer.from(JSON.stringify(STATE)).toString('base64'),
    });

    const res = await readState(TOKEN, OWNER, REPO);

    expect(kvMocks.kvSet).toHaveBeenCalledWith('gsm:state', expect.anything());
    expect(res).toEqual({
      state: expect.objectContaining({ totalSpins: 10 }),
      sha: 'gh-sha',
    });
  });

  it('KV vuoto e GitHub irraggiungibile: default con sha null', async () => {
    kvMocks.kvMget.mockResolvedValue([null, null]);
    ghGetContentsJson.mockResolvedValue(null);

    const res = await readState(TOKEN, OWNER, REPO);

    expect(res.state.totalSpins).toBe(0);
    expect(res.sha).toBe(null);
  });
});

describe('syncStateToGitHub — memoizzazione sha POST-PUT in KV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kvMocks.kvEnabled = true;
    kvMocks.kvSet.mockResolvedValue(true);
    ghPut.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dopo una PUT riuscita memoizza lo sha in gsm:state:sha (TTL 7gg)', async () => {
    ghPut.mockResolvedValue('newsha123');

    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, 'oldsha');

    expect(ok).toBe(true);
    // ghPut riceve lo sha memoizzato → UNA sola chiamata (niente GET-first).
    expect(ghPut).toHaveBeenCalledTimes(1);
    expect(ghPut).toHaveBeenCalledWith(
      TOKEN,
      OWNER,
      REPO,
      'state.json',
      expect.any(String),
      'oldsha',
      '🎰 Update slot stats'
    );
    expect(kvMocks.kvSet).toHaveBeenCalledWith(
      'gsm:state:sha',
      'newsha123',
      604800
    );
  });

  it('se ghPut non ritorna sha (body senza sha), NON memoizza nulla', async () => {
    ghPut.mockResolvedValue(null);

    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, 'oldsha');

    expect(ok).toBe(true);
    expect(kvMocks.kvSet).not.toHaveBeenCalledWith(
      'gsm:state:sha',
      expect.anything(),
      expect.anything()
    );
  });

  it('se il sync fallisce, NON memoizza alcun sha', async () => {
    ghPut.mockRejectedValue(new Error('GitHub down'));

    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);

    expect(ok).toBe(false);
    expect(kvMocks.kvSet).not.toHaveBeenCalledWith(
      'gsm:state:sha',
      expect.anything(),
      expect.anything()
    );
  });

  it('senza KV (kvEnabled=false): nessuna chiamata kvSet', async () => {
    kvMocks.kvEnabled = false;
    ghPut.mockResolvedValue('newsha123');

    const ok = await syncStateToGitHub(TOKEN, OWNER, REPO, STATE, null);

    expect(ok).toBe(true);
    expect(kvMocks.kvSet).not.toHaveBeenCalled();
  });
});

describe('writeState — il sync fire-and-forget riceve lo sha da readState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kvMocks.kvEnabled = true;
    kvMocks.kvSet.mockResolvedValue(true);
    ghPut.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passa lo sha memoizzato al sync GitHub (catena readState → writeState)', async () => {
    ghPut.mockResolvedValue('sha-after-put');

    // writeState ritorna subito (fire-and-forget): diamo tempo al sync.
    await writeState(TOKEN, OWNER, REPO, STATE, 'memoized-sha');
    await new Promise((r) => setTimeout(r, 0));

    // ghPut chiamato con lo sha memoizzato (UNA PUT, niente GET-first).
    expect(ghPut).toHaveBeenCalledWith(
      TOKEN,
      OWNER,
      REPO,
      'state.json',
      expect.any(String),
      'memoized-sha',
      '🎰 Update slot stats'
    );
  });
});
