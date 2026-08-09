// ─── Test saveSlotSvg: coerenza KV ⇄ GitHub (fix "risultato precedente") ─────
// PRIMA (bug t_690b8db0): quando kvSet riusciva, GitHub slot.svg NON veniva
// aggiornato (restava fermo all'ultimo spin in cui KV era fallito — anche
// ore/giorni prima); quando kvSet falliva, KV conservava il vecchio svg e
// image.js (KV first) serviva il risultato PRECEDENTE ignorando il GitHub
// fresco. ORA:
//   • kvSet OK   → aggiornamento GitHub fire-and-forget (fallback sempre fresco)
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
}));

vi.mock('../api/_lib/kv.js', () => kvMocks);

// ── Mock Sentry (importato dal modulo reale di github.js via logger) ────────
vi.mock('../../sentry.config.js', () => ({
  default: { captureMessage: vi.fn(), captureException: vi.fn() },
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { saveSlotSvg } = await import('../api/_lib/github.js');

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

  it('kvSet OK: ritorna subito e aggiorna GitHub in fire-and-forget (fallback mai stale)', async () => {
    kvMocks.kvSet.mockResolvedValue(true);

    await saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA);
    await flushMicrotasks();

    // Nessuna invalidazione: la copia KV è fresca.
    expect(kvMocks.kvDel).not.toHaveBeenCalled();
    // GitHub viene comunque aggiornato (best-effort, non bloccante).
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      SLOT_URL,
      expect.objectContaining({ method: 'PUT' })
    );
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

  it('kvSet OK ma GitHub fallisce in background: saveSlotSvg NON rigetta (best-effort)', async () => {
    kvMocks.kvSet.mockResolvedValue(true);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('github down'));

    await expect(
      saveSlotSvg(TOKEN, OWNER, REPO, SVG, SHA)
    ).resolves.toBeUndefined();
    await flushMicrotasks(); // lascia completare il .catch del fire-and-forget
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
});
