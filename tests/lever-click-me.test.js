/**
 * Test per la CTA animata "click me!" sopra la leva (api/lever.js).
 *
 * Requisiti:
 *   - La scritta "click me!" (testo + freccia) è presente sopra il pomello,
 *     FUORI da #leverGroup (che ruota/scala durante pull e idle loop).
 *   - Appare SOLO a spin concluso: a riposo (.idling) è subito visibile e
 *     animata; durante lo spin (.pulling) parte NASCOSTA (opacity 0) e le
 *     animazioni entrano con delay = SPIN_DURATION_S (durata rotazione
 *     rulli), quindi la CTA compare da sola quando i rulli si fermano.
 *     (Nasconderla per l'intera finestra pulling la rendeva invisibile nel
 *     README: ogni spin aggiorna ?v= e il browser rifetcha la leva proprio
 *     in stato pulling → di fatto non si vedeva mai. Il delay CSS — non lo
 *     stato — governa la comparsa.)
 *   - L'SVG si allunga in alto (Y_OFFSET) per fare spazio al testo: la
 *     geometria della leva (TIP_Y/BUMPER_CY) è traslata verso il basso.
 *   - prefers-reduced-motion disattiva anche l'animazione della CTA e, in
 *     stato pulling, la rende subito visibile (opacity 1).
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

    // Animazioni CTA: keyframes + regola valida nello stato a riposo
    expect(body).toContain('@keyframes clickBob');
    expect(body).toContain('@keyframes clickPulse');
    expect(body).toContain('.lever.idling .clickMe');
    expect(body).toContain('clickBob 1.2s ease-in-out infinite');
  });

  it('durante lo spin (.pulling) la CTA parte NASCOSTA e compare solo a rotazione conclusa', async () => {
    const recent = Date.now();
    await leverHandler(makeReq(recent), makeRes());
    const body = captured.body;

    expect(body).toContain('<svg class="lever pulling"');
    expect(body).toContain('class="leverArm pulling"');

    // La CTA resta nel markup ma è nascosta (opacity 0) e le sue animazioni
    // entrano con delay = SPIN_DURATION_S (6.5s): compare SOLO dopo che i
    // rulli si fermano, sincronizzata con la slot. Non è legata allo stato
    // server (che resta pulling per 30s), ma al delay CSS: anche se l'SVG è
    // servito in stato pulling, la CTA entra in scena senza refetch.
    expect(body).toContain('click me!');
    expect(body).toContain('.lever.pulling .clickMe');
    expect(body).toContain('opacity: 0;');
    // Fade-in a 6.5s (ctaIn), poi bob + pulsazione da 7.0s in poi
    expect(body).toContain('ctaIn 0.5s ease-out 6.5s both');
    expect(body).toContain('clickBob 1.2s ease-in-out 7s infinite');
    expect(body).toContain('clickPulse 1.2s ease-in-out 7s infinite');
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

  it('le animazioni di stato sono SCOPATE a #leverGroup (la radice non ruota la CTA)', async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    // Le regole di animazione per pull/idle devono agganciare SOLO il gruppo
    // della leva, non la radice <svg>.
    expect(body).toContain('#leverGroup.idling {');
    expect(body).toContain('#leverGroup.pulling {');
    expect(body).toContain('#leverGroup.pulling .leverBallGroup {');

    // Nessuna regola generica .idling/.pulling: la radice <svg> porta la
    // classe di stato (per i selettori .lever.idling/.lever.pulling della
    // CTA) e una regola generica la farebbe ruotare (idleLoop ±3°)
    // spostando la CTA a destra/sinistra durante l'animazione.
    const styles = body.slice(
      body.indexOf('<style>'),
      body.lastIndexOf('</style>')
    );
    expect(styles).not.toMatch(/(^|\n)\s*\.(idling|pulling)\s*\{/);
    expect(styles).not.toMatch(/(^|\n)\s*\.pulling\s+\.leverBallGroup/);
  });

  it("prefers-reduced-motion disattiva l'animazione della CTA e la rende visibile anche in pulling", async () => {
    await leverHandler(makeReq(), makeRes());
    const body = captured.body;

    const mediaBlock = body.slice(
      body.indexOf('@media (prefers-reduced-motion')
    );
    expect(mediaBlock).toMatch(/\.clickMe/);
    expect(mediaBlock).toContain('animation: none !important');
    // Con motion ridotto la rotazione è istantanea → la CTA non deve
    // restare bloccata su opacity 0 (il delay non scatta mai senza
    // animazioni): override esplicito anche in stato pulling.
    expect(mediaBlock).toContain('.lever.pulling .clickMe { opacity: 1; }');
  });
});
