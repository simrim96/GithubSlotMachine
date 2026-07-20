// ─── GET /api/ratelimit-status ────────────────────────────────────────────────
// Espone lo stato corrente del GitHub API rate limit.
// Usato dal frontend per mostrare un badge con remaining requests, reset time, etc.
//
// A differenza della versione precedente, NON manteniamo più uno stato
// osservazionale in-process (la classe RateLimitTracker era puramente
// cosmetica e non bloccava nulla — vedi ISSUE-12). Leggiamo lo stato LIVE
// dall'endpoint GitHub /rate_limit — che NON consuma il budget delle 5000
// req/h — e parsiamo gli header X-RateLimit-* per il logging.
//
// Esempio di risposta:
//   {
//     "remaining": 50,
//     "limit": 5000,
//     "reset": 1784267400,
//     "resetTime": "17/07/2026, 08:10:00",
//     "secondsUntilReset": 300,
//     "percentageUsed": 99,
//     "status": "warning", // 'ok', 'warning', 'critical', 'unknown'
//     "totalRequests": null,
//     "isBelowWarningThreshold": true
//   }
//
// Endpoints correlati:
//   • GET /api/health     - Health check completo
//   • GET /api/stats      - Statistiche dell'applicazione

import {
  GITHUB_RATE_LIMIT_HEADER_REMAINING,
  GITHUB_RATE_LIMIT_HEADER_RESET,
  GITHUB_RATE_LIMIT_WARNING_THRESHOLD,
  safeGetHeader,
} from './_lib/ratelimit-tracker.js';
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
    console.warn('[ratelimit-status] fetch /rate_limit fallita:', error?.message);
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

  const remainingRaw = safeGetHeader(response, GITHUB_RATE_LIMIT_HEADER_REMAINING);
  const resetRaw = safeGetHeader(response, GITHUB_RATE_LIMIT_HEADER_RESET);

  const remaining =
    remainingRaw !== null && remainingRaw !== undefined
      ? parseInt(remainingRaw, 10)
      : null;
  const reset =
    resetRaw !== null && resetRaw !== undefined ? parseInt(resetRaw, 10) : null;

  // Calcola il limite totale (GitHub free tier: 5000 richieste/ora)
  const totalLimit = 5000;

  // Calcola la percentuale utilizzata
  const percentageUsed =
    remaining !== null
      ? (((totalLimit - remaining) / totalLimit) * 100).toFixed(2)
      : null;

  // Determina lo stato del rate limit (solo visualizzazione)
  let status = 'unknown';
  if (remaining === null) {
    status = 'unknown';
  } else if (remaining <= 2) {
    status = 'critical';
  } else if (remaining <= 10) {
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
      remaining !== null && remaining <= GITHUB_RATE_LIMIT_WARNING_THRESHOLD,
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
