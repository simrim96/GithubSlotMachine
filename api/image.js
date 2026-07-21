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

  if (kvEnabled) {
    try {
      const svg = await kvGet('gsm:slotSvg');
      if (svg) {
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
    } catch (e) {
      /* Sentry already handled by logger */
      logger.warn('kv image read failed, falling back to github', { error: e.message });
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
    logger.warn('github image fetch failed, serving degradation SVG', { status });
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
  sendResponse(res, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
    },
    body: svg,
  });
}
