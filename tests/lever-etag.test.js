/**
 * Test per il fix ISSUE-N8: l'ETag di /api/lever deve derivare dall'hash
 * del contenuto SVG, non da un timestamp.
 *
 * Prima: `ETag: "lever-${Date.now()}"` cambiava a OGNI richiesta → client
 * e CDN dovevano sempre ri-validare, annullando il `max-age=5` dichiarato.
 * Ora: l'ETag è `"lever-<md5(svg)>"` → cambia solo quando l'SVG cambia
 * davvero (transizione idling↔pulling), e la ri-validazione riesce.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const kvGetMock = vi.fn(async () => null);
const kvSetMock = vi.fn(async () => true);

vi.mock('../api/_lib/kv.js', () => ({
  kvGet: (...args) => kvGetMock(...args),
  kvSet: (...args) => kvSetMock(...args),
  kvEnabled: true,
}));

vi.mock('../api/_lib/cors.js', () => ({
  applyCorsWildcard: () => {},
}));

let captured = null;
vi.mock('../api/_lib/response-bridge.js', () => ({
  sendResponse: (_res, payload) => {
    captured = payload;
  },
}));

vi.mock('../api/_lib/logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

// fetch mock per la fonte #2 (state.json pubblico su GitHub). githubTs null
// => fetch fallito/non recente -> idling.
let githubTs = null;
const fetchMock = vi.fn(async (url) => {
  if (String(url).includes('raw.githubusercontent.com')) {
    return {
      ok: githubTs !== null,
      json: async () => ({ lastPullTimestamp: githubTs }),
    };
  }
  return { ok: false, json: async () => ({}) };
});
vi.stubGlobal('fetch', fetchMock);

const leverHandler = (await import('../api/lever.js')).default;

function makeReq(v) {
  return { method: 'GET', query: v !== undefined ? { v: String(v) } : {} };
}
function makeRes() {
  return {};
}

// Estrae il valore dell'ETag dagli header catturati.
function etagOf(payload) {
  return payload.headers.ETag;
}

describe('ETag di /api/lever basato sul contenuto (ISSUE-N8)', () => {
  beforeEach(() => {
    captured = null;
    githubTs = null;
    fetchMock.mockClear();
    kvGetMock.mockResolvedValue(null);
    kvSetMock.mockResolvedValue(true);
  });

  it("l'ETag è l'md5 del body, non un timestamp", async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;
    const expected = `"lever-${createHash('md5').update(body).digest('hex')}"`;

    expect(etagOf(captured)).toBe(expected);
    // Forma forte (quoted) + prefisso del dominio `lever-`
    expect(etagOf(captured)).toMatch(/^"lever-[0-9a-f]{32}"$/);
  });

  it('è STABILE su richieste identiche (prima cambiava a ogni request)', async () => {
    await leverHandler(makeReq(), makeRes());
    const first = etagOf(captured);
    // Simula un piccolo intervallo tra le richieste: col vecchio
    // Date.now() l'ETag sarebbe cambiato; ora deve restare identico.
    await new Promise((r) => setTimeout(r, 5));
    await leverHandler(makeReq(), makeRes());
    const second = etagOf(captured);

    expect(first).toBe(second);
  });

  it("cambia quando l'SVG cambia stato (idling → pulling)", async () => {
    await leverHandler(makeReq(), makeRes());
    const idlingEtag = etagOf(captured);
    const idlingBody = captured.body;

    // Stato pulling (spin recente via ?v=)
    await leverHandler(makeReq(Date.now()), makeRes());
    const pullingEtag = etagOf(captured);

    expect(captured.body).toContain('<svg class="lever pulling"');
    expect(pullingEtag).not.toBe(idlingEtag);
    expect(pullingEtag).toBe(
      `"lever-${createHash('md5').update(captured.body).digest('hex')}"`
    );
    // Il body è davvero cambiato, non solo l'ETag
    expect(captured.body).not.toBe(idlingBody);
  });

  it('resta stabile anche ripetendo lo stesso stato pulling', async () => {
    const v = Date.now();
    await leverHandler(makeReq(v), makeRes());
    const first = etagOf(captured);

    await new Promise((r) => setTimeout(r, 5));
    await leverHandler(makeReq(v), makeRes());
    const second = etagOf(captured);

    expect(first).toBe(second);
  });
});
