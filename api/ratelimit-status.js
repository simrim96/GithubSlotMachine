// ─── GET /api/ratelimit-status ────────────────────────────────────────────────
// Espone lo stato corrente del GitHub API rate limit tracker.
// Usato dal frontend per mostrare un badge con remaining requests, reset time, etc.
//
// Esempio di risposta:
//   {
//     "remaining": 50,
//     "limit": 5000,
//     "reset": 1784267400,
//     "resetTime": "17/07/2026, 08:10:00",
//     "secondsUntilReset": 300,
//     "percentage": 1,
//     "status": "warning", // 'ok', 'warning', 'critical'
//     "totalRequests": 142
//   }
//
// Endpoints correlati:
//   • GET /api/health     - Health check completo
//   • GET /api/stats      - Statistiche dell'applicazione

import { getDefaultTracker } from './_lib/ratelimit-tracker.js';

export default async function handler(req) {
  // Supporta solo GET
  if (req.method !== 'GET') {
    return new Response(null, {
      status: 405,
      statusText: 'Method Not Allowed',
    });
  }

  const tracker = getDefaultTracker();
  const state = tracker.getState();

  // Calcola il limite totale (GitHub free tier: 5000 richieste/ora)
  // Se non abbiamo mai ricevuto l'header X-RateLimit-Limit, usiamo il default
  const totalLimit = 5000;

  // Calcola la percentuale utilizzata
  const percentageUsed =
    state.remaining !== null
      ? (((totalLimit - state.remaining) / totalLimit) * 100).toFixed(2)
      : null;

  // Determina lo stato del rate limit (solo visualizzazione: il tracker è
  // osservazionale e non blocca le chiamate)
  let status = 'unknown';
  if (state.remaining === null) {
    status = 'unknown';
  } else if (state.remaining <= 2) {
    status = 'critical';
  } else if (state.remaining <= 10) {
    status = 'warning';
  } else {
    status = 'ok';
  }

  const response = {
    remaining: state.remaining,
    limit: totalLimit,
    reset: state.reset,
    resetTime: state.resetTime,
    secondsUntilReset: state.secondsUntilReset,
    percentageUsed: percentageUsed,
    status: status,
    totalRequests: state.totalRequests,
    isBelowWarningThreshold: state.isBelowWarningThreshold,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
