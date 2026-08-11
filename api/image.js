// Endpoint immagine della slot.
//
// Restituisce lo slot.svg "vivo" (quello generato dall'ultimo spin). Priorità:
//   1. Upstash Redis (kv:gsm:slotSvg) — velocissimo, elimina il GET su GitHub
//      che prima aggiungeva 150-400ms ogni caricamento.
//   2. Fallback: legge slot.svg dal repo REMOTO via GitHub Contents API
//      (per dev locale / Redis non configurato). Non legge dal filesystem
//      locale (vedi ISSUE-7 — la copia locale è solo un artefatto ignorato).
//
// Legge SLOT_OWNER / SLOT_REPO dalle env var come fa spin.js
// (default: simrim96 / GithubSlotMachine se le env non sono impostate).

import { kvGet, kvEnabled } from './_lib/kv.js';
import { ghHeaders } from './_lib/github.js';
import { applyCorsWildcard } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { errorSVGString } from './_lib/svg-builder.js';
import { logger } from './_lib/logger.js';

const SVG_PATH = 'slot.svg';

// Backoff del retry anti-propagazione sul fallback GitHub (fix t_308e49dc):
// subito dopo una PUT, la Contents API può servire per qualche secondo la
// versione PRECEDENTE del file (cache CDN non ancora invalidata). Se l'SVG
// letto ha uid < lastPull (l'ultimo spin noto), il contenuto è sicuramente
// vecchio: rileggiamo UNA volta dopo questo backoff prima di arrenderci.
const GH_FALLBACK_RETRY_DELAY_MS = 700;

// Estrae lo uid dello spin che ha generato l'SVG (es. `slot-title-1786281466709`
// scritto da svg-builder-accessible.js). Serve al guard anti-stale: se l'SVG in
// KV è più vecchio dell'ultimo spin registrato in gsm:state, è una copia STALE
// (la scrittura KV dello spin è fallita) e va ignorata a favore del GitHub
// fallback, che saveSlotSvg tiene fresco proprio per questo.
function extractSvgUid(svg) {
  if (typeof svg !== 'string') return null;
  const m = svg.match(/slot-(?:title|desc)-(\d+)/);
  return m ? Number(m[1]) : null;
}

export { extractSvgUid };

// Legge slot.svg dal repo remoto via GitHub Contents API (fallback).
// Ritorna { svg } oppure { error: 'http', status } (risposta non ok) /
// { error: 'empty' } (200 ma `content` assente — ISSUE-24).
async function fetchGitHubSvg(token, owner, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${SVG_PATH}`,
    { headers: ghHeaders(token) }
  );
  if (!r.ok) return { error: 'http', status: r.status };
  const data = await r.json();
  if (!data || !data.content) return { error: 'empty' };
  return { svg: Buffer.from(data.content, 'base64').toString('utf-8') };
}

// Lettura fallback con UN retry anti-propagazione CDN (fix t_308e49dc).
//
// Il fallback GitHub può essere PIÙ VECCHIO dell'ultimo spin anche subito
// dopo una PUT riuscita: la Contents API è servita da una cache CDN che
// impiega qualche secondo a invalidarsi. Se l'SVG letto ha uid < lastPull
// sappiamo con certezza che è la copia VECCHIA → rileggiamo una volta dopo
// un breve backoff (bounded: 1 solo retry, solo sul path di fallback, solo
// quando GitHub è il candidato migliore disponibile).
async function fetchGitHubSvgFresh(token, owner, repo, lastPull, kvUid) {
  const first = await fetchGitHubSvg(token, owner, repo);
  if (first.error) return first;

  const uid = extractSvgUid(first.svg);
  const stale =
    uid != null &&
    Number.isFinite(uid) &&
    Number.isFinite(lastPull) &&
    uid < lastPull;
  // Retry solo se la copia GitHub è uguale o più fresca di quella KV: se KV
  // ha già una copia più fresca, il retry non cambierebbe l'esito (l'hardening
  // sotto serve la più fresca delle due) e costerebbe solo latenza.
  const kvNotBetter = kvUid == null || uid >= kvUid;
  if (!stale || !kvNotBetter) return first;

  logger.warn(
    'github fallback svg stale vs lastPull, retrying once (CDN propagation)',
    { uid, lastPull }
  );
  await new Promise((r) => setTimeout(r, GH_FALLBACK_RETRY_DELAY_MS));
  const second = await fetchGitHubSvg(token, owner, repo);
  if (second.error) return first; // la prima lettura resta il meglio disponibile
  return second;
}

export default async function handler(req, res) {
  const user = process.env.SLOT_OWNER || 'simrim96';
  const repo = process.env.SLOT_REPO || 'GithubSlotMachine';
  const token = process.env.GITHUB_PAT || '';

  // ── CORS + preflight (ISSUE-25: wildcard `*`, l'SVG è embeddato
  //    cross-origin su github.com e altri domini non deterministici) ──
  applyCorsWildcard(req, res);
  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }

  // ── NOTA: NESSUN cooldown per-IP qui (bug t_a81cdf35) ────────────────────
  // checkSpinCooldown è check-AND-set: un GET passivo (questo, o /api/lever)
  // registrava l'IP del chiamante, quindi lo spin successivo entro la finestra
  // veniva RIFIUTATO con un 302 silenzioso verso il profilo → nessuno spin
  // veniva eseguito e l'utente rivedeva il risultato PRECEDENTE ("come se
  // l'svg non venisse aggiornato"). Il cooldown resta SOLO su /api/spin,
  // l'unico endpoint che esegue davvero un'azione. L'abuso dell'immagine
  // (fallback GitHub) è già contenuto dal circuit-breaker KV e dai rate limit
  // GitHub (ISSUE-L2 era APERTA senza cooldown: rischio accettato).

  // Leggiamo svg + stato in parallelo: il guard anti-stale confronta lo uid
  // dell'SVG con lastPullTimestamp dell'ultimo spin. Se lo uid è più vecchio,
  // la copia KV è STALE (la scrittura KV dello spin era fallita) e ricadiamo
  // su GitHub — che saveSlotSvg tiene fresco proprio per questo (fix
  // t_690b8db0 + t_a81cdf35: la scrittura GitHub ora è ATTESA, non più
  // fire-and-forget ucciso da Vercel). Senza questo guard, l'utente
  // rivedrebbe l'animazione/risultato precedente nonostante il GitHub fresco.
  let kvSvg = null;
  let kvUid = null;
  let lastPull = NaN;
  if (kvEnabled) {
    try {
      const [svg, state] = await Promise.all([
        kvGet('gsm:slotSvg'),
        kvGet('gsm:state'),
      ]);
      kvSvg = svg;
      if (svg) {
        kvUid = extractSvgUid(svg);
      }
      // lastPull viene letto dallo stato INDIPENDENTEMENTE dalla presenza
      // dell'SVG in KV: serve al self-heal dell'URL (?v stantio) e al retry
      // anti-propagazione anche quando la copia KV è assente.
      if (state) {
        lastPull = Number(state.lastPullTimestamp);
      }
    } catch (e) {
      /* Sentry already handled by logger */
      logger.warn('kv image read failed, falling back to github', {
        error: e.message,
      });
    }
  }

  // ── Self-heal URL stantia (fix t_308e49dc) ───────────────────────────────
  // "A volte, dopo lo spin, vedo ancora l'svg precedente". Il README del
  // profilo embedda l'immagine con `api/image?v=<spinStart>`; se il README
  // non si è ancora ri-renderizzato (PUT fallita/timeout, o cache di render
  // di GitHub in ritardo), il browser richiede un ?v VECCHIO. Camo (il proxy
  // immagini di GitHub) cachea PER URL: un ?v vecchio può quindi far servire
  // l'SVG dello spin precedente senza nemmeno raggiungerci (bug t_690b8db0).
  // Quando la richiesta arriva qui con un ?v più vecchio dell'ultimo spin
  // noto (state.lastPullTimestamp), rispondiamo 302 verso l'URL col timestamp
  // corrente: il client — e Camo, che segue i redirect (CAMO_MAX_REDIRECTS) —
  // rifetcha l'URL nuovo e riceve l'SVG dell'ULTIMO spin. La cache Camo
  // dell'URL vecchio converge così al contenuto fresco, anche se il README
  // resta fermo per qualche secondo. Solo richieste con ?v numerico: curl
  // /api/image e gli embed senza query restano invariati (200 diretto).
  if (Number.isFinite(lastPull)) {
    const rawV = req?.query?.v;
    const v = typeof rawV === 'string' ? parseInt(rawV, 10) : NaN;
    if (Number.isFinite(v) && v < lastPull) {
      logger.info(
        'image URL ?v older than last spin, redirecting to current version',
        { requestedV: v, lastPull }
      );
      sendResponse(res, {
        status: 302,
        headers: {
          'Cache-Control': 'no-store',
        },
        redirect: `/api/image?v=${lastPull}`,
      });
      return;
    }
  }

  // Guard anti-stale: se l'SVG in KV è più vecchio dell'ultimo spin, ignoralo
  // e ricadi sul fallback GitHub (che saveSlotSvg tiene fresco).
  if (kvSvg) {
    const stale =
      kvUid != null &&
      Number.isFinite(kvUid) &&
      Number.isFinite(lastPull) &&
      kvUid < lastPull;
    if (!stale) {
      sendResponse(res, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-store',
        },
        body: kvSvg,
      });
      return;
    }
    logger.warn(
      'kv slotSvg is stale (uid < lastPullTimestamp), falling back to github',
      {
        svgUid: kvUid,
        lastPull,
      }
    );
  }

  // Fallback: leggi slot.svg dal repo (con retry anti-propagazione CDN).
  const gh = await fetchGitHubSvgFresh(token, user, repo, lastPull, kvUid);
  if (gh.error === 'http') {
    // ISSUE-24/B4: in caso di errore GitHub il client riceveva testo senza
    // Content-Type e l'evento non finiva in Sentry. Catturiamo l'errore e
    // serviamo l'SVG di degrado come negli altri path (vedi sotto), così
    // l'embed resta valido invece di rompersi su un 404 in chiaro.
    /* logger already handles Sentry */
    logger.warn('github image fetch failed, serving degradation SVG', {
      status: gh.status,
    });
    sendResponse(res, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-store',
      },
      body: errorSVGString({ owner: user, message: 'Slot image unavailable' }),
    });
    return;
  }
  if (gh.error === 'empty') {
    // ISSUE-24: `r.ok` true ma `data.content` assente (repo esistente ma
    // slot.svg vuoto / risposta inattesa). Servi un SVG di degrado invece di
    // crashare su `Buffer.from(undefined)`.
    sendResponse(res, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-store',
      },
      body: errorSVGString({ owner: user, message: 'Slot image unavailable' }),
    });
    return;
  }
  const svg = gh.svg;

  // ── Hardening (bug t_a81cdf35) ────────────────────────────────────────────
  // Il fallback GitHub può essere PIÙ VECCHIO della copia KV (propagazione
  // Contents API in ritardo dopo la PUT, o scrittura GitHub fallita/timeout).
  // Serviamo la copia PIÙ FRESCA delle due, non ciecamente GitHub.
  if (kvSvg) {
    const ghUid = extractSvgUid(svg);
    if (ghUid != null && kvUid != null && ghUid < kvUid) {
      logger.warn('github slot.svg older than kv copy, serving kv', {
        ghUid,
        svgUid: kvUid,
      });
      sendResponse(res, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-store',
        },
        body: kvSvg,
      });
      return;
    }
    if (ghUid != null && Number.isFinite(lastPull) && ghUid < lastPull) {
      // Entrambi gli store sono più vecchi dell'ultimo spin: le scritture di
      // QUESTO spin sono fallite del tutto. Logghiamo per visibilità.
      logger.warn('both stores stale (kv + github older than last pull)', {
        ghUid,
        lastPull,
      });
    }
  }

  sendResponse(res, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
    },
    body: svg,
  });
}
