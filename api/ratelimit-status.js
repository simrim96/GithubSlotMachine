// ─── GET /api/ratelimit-status ────────────────────────────────────────────────
// Espone lo stato corrente del GitHub API rate limit.
// Usato dal frontend per mostrare un badge con remaining requests, reset time, etc.
//
// A differenza della versione precedente, NON manteniamo più uno stato
// osservazionale in-process (la classe RateLimitTracker era puramente
// cosmetica e non bloccava nulla — vedi ISSUE-12). Leggiamo lo stato LIVE
// dall'endpoint GitHub /rate_limit — che NON consuma il budget di rate
// limit — e parsiamo gli header X-RateLimit-* per il logging.
//
// Esempio di risposta (client anonimo, limite reale 60/h da
// resources.core.limit — ISSUE-N10):
//   {
//     "remaining": 55,
//     "limit": 60,
//     "reset": 1784267400,
//     "resetTime": "17/07/2026, 08:10:00",
//     "secondsUntilReset": 300,
//     "percentageUsed": 8.33,
//     "status": "ok", // 'ok', 'warning', 'critical', 'unknown'
//     "totalRequests": null,
//     "isBelowWarningThreshold": false
//   }
//
// Endpoints correlati:
//   • GET /api/health     - Health check completo
//   • GET /api/stats      - Statistiche dell'applicazione
//

import { parseRateLimitHeaders } from './_lib/ratelimit-tracker.js';
import { logger } from './_lib/logger.js';
import { ghHeaders } from './_lib/github.js';
import { corsHeaders } from './_lib/cors.js';
import { buildResponse } from './_lib/response-bridge.js';

export default async function handler(req) {
  const origin = req.headers?.get?.('origin') ?? req.headers?.origin;

  // Supporta solo GET
  if (req.method !== 'GET') {
    return buildResponse({
      status: 405,
      headers: { ...corsHeaders(origin) },
    });
  }

  // /rate_limit NON conta verso il limite, ma con token ritorna il limite
  // dell'utente autenticato (5000/h) anziché quello anonimo (60/h).
  const token = process.env.GITHUB_PAT;
  // Header centralizzati su ghHeaders (unica sorgente condivisa, ISSUE-22 / M3):
  // garantisce Accept + User-Agent + Authorization: Bearer *** coerenti
  // con gli altri endpoint GitHub del repo, evitando header inline divergenti.
  const headers = ghHeaders(token);

  let response;
  try {
    response = await fetch('https://api.github.com/rate_limit', { headers });
  } catch (error) {
    logger.warn('ratelimit-status fetch /rate_limit failed', {
      error: error?.message,
    });
    return buildResponse({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...corsHeaders(origin),
      },
      body: JSON.stringify({ status: 'unknown', remaining: null, reset: null }),
    });
  }

  // Gli header X-RateLimit-* vivono su response.headers; parseRateLimitHeaders
  // estrae remaining/reset in modo difensivo (Headers standard o plain object)
  // e normalizza i non-numerici a null.
  const { remaining, reset } = parseRateLimitHeaders(response);

  // Il body /rate_limit espone il limite reale (resources.core.limit): 5000/h
  // con token, 60/h anonimo (ISSUE-N10). Prima questo valore era hardcoded a
  // 5000, quindi con un client anonimo percentageUsed e status venivano
  // calcolati su un budget sbagliato (es. 55/60 rimasti = 98.9% "usato").
  let totalLimit = null;
  try {
    const rateLimitBody = await response.json();
    totalLimit = rateLimitBody?.resources?.core?.limit ?? null;
  } catch {
    totalLimit = null;
  }
  if (
    typeof totalLimit !== 'number' ||
    !Number.isFinite(totalLimit) ||
    totalLimit <= 0
  ) {
    // Fallback difensivo ai limiti documentati GitHub quando il body non è
    // leggibile o non espone il campo.
    totalLimit = token ? 5000 : 60;
  }

  // Soglie percentuali sul limite reale: gli assoluti 2/10 erano calibrati
  // sul limite 5000 e distorti per i client anonimi. warning ≤ 10% del
  // limite, critical ≤ 5% (arrotondati per eccesso per restare su interi).
  const warningThreshold = Math.ceil(totalLimit * 0.1);
  const criticalThreshold = Math.ceil(totalLimit * 0.05);

  // Calcola la percentuale utilizzata (clampata a 0: remaining non dovrebbe
  // mai superare il limite, ma un header stale non deve produrre negativi)
  const percentageUsed =
    remaining !== null
      ? ((Math.max(0, totalLimit - remaining) / totalLimit) * 100).toFixed(2)
      : null;

  // Determina lo stato del rate limit (solo visualizzazione)
  let status = 'unknown';
  if (remaining === null) {
    status = 'unknown';
  } else if (remaining <= criticalThreshold) {
    status = 'critical';
  } else if (remaining <= warningThreshold) {
    status = 'warning';
  } else {
    status = 'ok';
  }

  const secondsUntilReset =
    reset !== null ? Math.max(0, reset - Math.floor(Date.now() / 1000)) : null;
  const resetTime =
    reset !== null ? new Date(reset * 1000).toLocaleString() : null;

  const body = {
    remaining: remaining,
    limit: totalLimit,
    reset: reset,
    resetTime: resetTime,
    secondsUntilReset: secondsUntilReset,
    percentageUsed: percentageUsed,
    status: status,
    // Non teniamo più uno stato in-process: il conteggio è live, non cumulativo.
    totalRequests: null,
    isBelowWarningThreshold:
      remaining !== null && remaining <= warningThreshold,
  };

  return buildResponse({
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      ...corsHeaders(origin),
    },
    body: JSON.stringify(body),
  });
}
