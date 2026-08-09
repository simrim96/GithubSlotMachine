// ─── Test saveSlotSvg: coerenza KV ⇄ GitHub (fix "risultato precedente") ─────
// PRIMA (bug t_690b8db0): quando kvSet riusciva, GitHub slot.svg NON veniva
// aggiornato (restava fermo all'ultimo spin in cui KV era fallito — anche
// ore/giorni prima); quando kvSet falliva, KV conservava il vecchio svg e
// image.js (KV first) serviva il risultato PRECEDENTE ignorando il GitHub
// fresco. ORA:
//   • kvSet OK   → aggiornamento GitHub ATTESO con timeout (non più
//                 fire-and-forget: su Vercel il job in background veniva
//                 congelato e GitHub restava stale — bug t_a81cdf35)
//   • kvSet KO   → invalidazione della copia stale in KV (kvDel) + ghPut
//                 attendato (image.js ricade sul GitHub appena scritto)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock KV con funzioni controllabili ──────────────────────────────────────
const kvMocks = vi.hoisted(() => ({
  kvEnabled: true,
  kvWritable: true,
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  kvMget: vi.fn(),
}));

vi.mock('../api/_lib/kv.js', () => kvMocks);

// ── Mock Sentry (importato dal modulo reale di github.js via logger) ────────
vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn(), captureException: vi.fn() },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { saveSlotSvg, loadSlotSvg } = await import('../api/_lib/github.js');

const TOKEN = 'github_pat_test';
const OWNER = 'simrim96';
const REPO = 'GithubSlotMachine';
const SVG = '<svg data-testid="slot-svg">slot-title-1786281466709</svg>';
const SHA = 'abc123';

const SLOT_URL =
  'https://api.github.com/repos/simrim96/GithubSlotMachine/contents/slot.svg';

function okResponse() {
  return {
    ok: true,
    status: 201,
    headers: { get: () => null },
    json: async () => ({}),
  };
}

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('saveSlotSvg — coerenza KV ⇄ GitHub', () => {
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    kvMocks.kvEnabled = true;
    kvMocks.kvSet.mockResolvedValue(true);
    kvMocks.kvDel.mockResolvedValue(true);
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse());
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('senza KV (kvEnabled=false): scrive solo su GitHub, nessuna chiamata KV', async () => {
    kvMocks.kvEnabled = false;

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    expect(kvMocks.kvSet).not.toHaveBeenCalled();
    expect(kvMocks.kvDel).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      SLOT_URL,
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('kvSet OK: aggiorna GitHub in modo ATTESO (fallback mai stale) e NON invalida KV', async () => {
    kvMocks.kvSet.mockResolvedValue(true);

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    // Nessuna invalidazione: la copia KV è fresca.
    expect(kvMocks.kvDel).not.toHaveBeenCalled();
    // GitHub viene aggiornato PRIMA che saveSlotSvg risolva (await, non più
    // fire-and-forget: su Vercel il background job veniva congelato e GitHub
    // restava stale → image.js su KV-miss serviva lo spin precedente).
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      SLOT_URL,
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('kvSet OK: saveSlotSvg NON risolve finché la PUT GitHub non è completata (await reale)', async () => {
    kvMocks.kvSet.mockResolvedValue(true);
    let resolveFetch;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    let settled = false;
    const p = saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA).then(() => {
      settled = true;
    });
    await flushMicrotasks();

    // La PUT GitHub è ancora in volo → saveSlotSvg NON deve aver risolto.
    expect(settled).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(okResponse());
    await p;
    expect(settled).toBe(true);
  });

  it('kvSet fallito (false): invalida la copia stale in KV e scrive GitHub in modo attendato', async () => {
    kvMocks.kvSet.mockResolvedValue(false);

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    // kvDel sulla chiave stale → image.js non serve più il vecchio svg.
    expect(kvMocks.kvDel).toHaveBeenCalledTimes(1);
    expect(kvMocks.kvDel).toHaveBeenCalledWith('gsm:slotSvg');
    // GitHub aggiornato (await → al ritorno di saveSlotSvg è già scritto).
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      SLOT_URL,
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('kvSet in eccezione (timeout): stesso comportamento del caso false', async () => {
    kvMocks.kvSet.mockRejectedValue(new Error('kv timeout'));

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    expect(kvMocks.kvDel).toHaveBeenCalledWith('gsm:slotSvg');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('kvSet OK ma la PUT GitHub fallisce: saveSlotSvg NON rigetta (KV resta primario, best-effort)', async () => {
    kvMocks.kvSet.mockResolvedValue(true);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('github down'));

    await expect(
      saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA)
    ).resolves.toBeUndefined();
  });

  it('kvSet fallito E GitHub fallisce: saveSlotSvg rigetta (come prima, il caller decide il redirect)', async () => {
    kvMocks.kvSet.mockResolvedValue(false);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('github down'));

    await expect(saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA)).rejects.toThrow(
      'github down'
    );
  });

  it('kvDel fallisce (kvDel=false): non blocca il ghPut di fallback', async () => {
    kvMocks.kvSet.mockResolvedValue(false);
    kvMocks.kvDel.mockResolvedValue(false);

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('memoizza lo sha POST-PUT in KV (gsm:slotSvg:sha) per la prossima PUT di backup', async () => {
    // Velocizzazione percorso click→rotazione: lo sha memoizzato permette a
    // loadSlotSvg di passarlo a ghPut → PUT di backup come UNA sola chiamata
    // (niente GET-first né 422 garantito). Qui ghPut ritorna lo sha nuovo.
    kvMocks.kvSet.mockResolvedValue(true);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => null },
      json: async () => ({ sha: 'newsha123' }),
    });

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(kvMocks.kvSet).toHaveBeenCalledWith(
      'gsm:slotSvg:sha',
      'newsha123',
      604800
    );
  });

  it('se ghPut non ritorna sha (body senza sha), NON memoizza nulla', async () => {
    kvMocks.kvSet.mockResolvedValue(true);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => null },
      json: async () => ({}),
    });

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);

    expect(kvMocks.kvSet).not.toHaveBeenCalledWith(
      'gsm:slotSvg:sha',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('loadSlotSvg — percorso KV con sha memoizzato (velocizzazione)', () => {
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    kvMocks.kvEnabled = true;
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse());
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('legge SVG + sha memoizzato in UNA kvMget (PUT di backup a chiamata singola)', async () => {
    kvMocks.kvMget.mockResolvedValue([SVG, 'stored-sha']);

    const res = await loadSlotSvg(TOKEN, OWNER, REPO);

    expect(kvMocks.kvMget).toHaveBeenCalledWith(
      'gsm:slotSvg',
      'gsm:slotSvg:sha'
    );
    expect(res).toEqual({ content: SVG, sha: 'stored-sha' });
    // Nessun fallback GitHub: la copia KV basta.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('senza sha memoizzato (primo giro): sha null → ghPut farà GET-first', async () => {
    kvMocks.kvMget.mockResolvedValue([SVG, null]);

    const res = await loadSlotSvg(TOKEN, OWNER, REPO);

    expect(res).toEqual({ content: SVG, sha: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('KV vuoto → fallback GitHub (GET con sha)', async () => {
    kvMocks.kvMget.mockResolvedValue([null, null]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        sha: 'gh-sha',
        content: Buffer.from(SVG).toString('base64'),
      }),
    });

    const res = await loadSlotSvg(TOKEN, OWNER, REPO);

    expect(res).toEqual({ content: SVG, sha: 'gh-sha' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
