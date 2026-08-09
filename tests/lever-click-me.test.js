/**
 * Test per la CTA animata "click me!" sopra la leva (api/lever.js).
 *
 * Requisiti:
 *   - La scritta "click me!" (testo + freccia) è presente sopra il pomello,
 *     FUORI da #leverGroup (che ruota/scala durante pull e idle loop).
 *   - È animata (keyframes clickBob/clickPulse) in ENTRAMBI gli stati:
 *     a riposo (.idling) e durante il pull (.pulling) — la CTA è l'affordance
 *     sempre visibile che invita al click (nasconderla dopo lo spin la
 *     rendeva invisibile nel README: ogni spin aggiorna ?v= e il browser
 *     rifetcha la leva proprio in stato pulling).
 *   - L'SVG si allunga in alto (Y_OFFSET) per fare spazio al testo: la
 *     geometria della leva (TIP_Y/BUMPER_CY) è traslata verso il basso.
 *   - prefers-reduced-motion disattiva anche l'animazione della CTA.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Costanti duplicate dal sorgente per i controlli geometrici (se cambiano
// nel sorgente, questi test segnalano la discrepanza invece di passare in
// silenzio con valori stantii).
const Y_OFFSET = 36;
const W = 52;
const H = 150 + Y_OFFSET;
const TIP_Y = 22 + Y_OFFSET; // centro del pomello (traslato in basso)
const BALL_R = 11;
const HALO_TOP = TIP_Y - (BALL_R + 8); // bordo superiore dell'alone rosso

describe('CTA animata "click me!" (api/lever.js)', () => {
  beforeEach(() => {
    captured = null;
    githubTs = null;
    fetchMock.mockClear();
    kvGetMock.mockResolvedValue(null);
    kvSetMock.mockResolvedValue(true);
  });

  afterEach(() => {
    kvGetMock.mockResolvedValue(null);
    kvSetMock.mockResolvedValue(true);
  });

  it('a riposo (.idling) emette la CTA con testo, freccia e animazioni', async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    // Stato a riposo sia sulla radice che su #leverGroup
    expect(body).toContain('<svg class="lever idling"');
    expect(body).toContain('class="leverArm idling"');

    // Testo + freccia presenti
    expect(body).toContain('class="clickMe"');
    expect(body).toContain('click me!');
    expect(body).toMatch(/<path d="M21 29 L31 29 L26 35 Z"/);
    expect(body).toContain('aria-hidden="true"');

    // Animazioni CTA: keyframes + regola valida in ENTRAMBI gli stati
    expect(body).toContain('@keyframes clickBob');
    expect(body).toContain('@keyframes clickPulse');
    expect(body).toContain('.lever .clickMe');
    expect(body).toContain('clickBob 1.2s ease-in-out infinite');
  });

  it('dopo un pull recente (.pulling) la CTA resta visibile e animata', async () => {
    const recent = Date.now();
    await leverHandler(makeReq(recent), makeRes());
    const body = captured.body;

    expect(body).toContain('<svg class="lever pulling"');
    expect(body).toContain('class="leverArm pulling"');

    // La CTA resta nel markup E resta visibile: nessuna regola che la
    // nasconda nello stato pulling (la regola è .lever .clickMe, non
    // condizionata allo stato).
    expect(body).toContain('click me!');
    expect(body).toContain('.lever .clickMe');
    expect(body).not.toContain('.lever.pulling .clickMe');
  });

  it('la CTA sta SOPRA il pomello: baseline testo e punta freccia sopra alone e palla', async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    // Il testo (baseline y=24) e la punta della freccia (y=35) stanno sopra
    // il bordo superiore dell'alone (y=39) e sopra il centro del pomello.
    expect(body).toContain('y="24"');
    expect(body).toContain('cy="58"'); // TIP_Y = 22 + 36
    expect(HALO_TOP).toBe(39);
    // Il template usa le stesse coordinate: testo < alone < pomello
    expect(24).toBeLessThan(HALO_TOP);
    expect(HALO_TOP).toBeLessThan(TIP_Y);
  });

  it("l'SVG si allunga in alto (Y_OFFSET) e la geometria è traslata in basso", async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    expect(body).toContain(`width="${W}" height="${H}"`);
    expect(body).toContain(`viewBox="0 0 ${W} ${H}"`);
    // Bumper traslato: BUMPER_CY = 100 + 36 = 136
    expect(body).toContain('cy="136"');
  });

  it('la CTA è FUORI da #leverGroup (sibling diretto della radice, non annidata)', async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    const ctaIdx = body.indexOf('<g class="clickMe"');
    expect(ctaIdx).toBeGreaterThan(-1);

    // Tra l'apertura della CTA e la chiusura dell'SVG c'è UN SOLO </g>
    // (quello della CTA stessa): quindi il gruppo non è annidato in altri
    // gruppi (es. #leverGroup) ed è figlio diretto di <svg>.
    const tail = body.slice(ctaIdx, body.lastIndexOf('</svg>'));
    expect(tail.match(/<\/g>/g) || []).toHaveLength(1);

    // La CTA compare DOPO l'apertura di #leverGroup e NON al suo interno
    expect(ctaIdx).toBeGreaterThan(body.indexOf('id="leverGroup"'));
  });

  it("prefers-reduced-motion disattiva anche l'animazione della CTA", async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    const mediaBlock = body.slice(
      body.indexOf('@media (prefers-reduced-motion')
    );
    expect(mediaBlock).toMatch(/\.clickMe/);
    expect(mediaBlock).toContain('animation: none !important');
  });
});
