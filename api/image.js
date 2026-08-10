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
        lastPull = Number(state?.lastPullTimestamp);
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
            body: svg,
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
    } catch (e) {
      /* Sentry already handled by logger */
      logger.warn('kv image read failed, falling back to github', {
        error: e.message,
      });
    }
  }

  // Fallback: leggi slot.svg dal repo.
  const r = await fetch(
    `https://api.github.com/repos/${user}/${repo}/contents/${SVG_PATH}`,
    { headers: ghHeaders(token) }
  );
  if (!r.ok) {
    // ISSUE-24/B4: in caso di errore GitHub il client riceveva testo senza
    // Content-Type e l'evento non finiva in Sentry. Catturiamo l'errore e
    // serviamo l'SVG di degrado come negli altri path (vedi sotto), così
    // l'embed resta valido invece di rompersi su un 404 in chiaro.
    const status = r.status;
    /* logger already handles Sentry */
    logger.warn('github image fetch failed, serving degradation SVG', {
      status,
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
  const data = await r.json();
  // ISSUE-24: se `r.ok` è true ma `data.content` è assente (repo esistente ma
  // slot.svg vuoto / risposta inattesa), `Buffer.from(undefined)` lancia.
  // In tal caso servi un SVG di degrado invece di crashare.
  if (!data || !data.content) {
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
  const svg = Buffer.from(data.content, 'base64').toString('utf-8');

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
