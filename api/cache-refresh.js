// ─── Cache Refresh Endpoint ────────────────────────────────────────────────────
// Endpoint per popolare proattivamente la cache lingua→repo.
// Chiamato da un cron Vercel ogni 30 minuti (GET + CRON_SECRET) per evitare il
// "primo spin freddo", oppure manualmente (POST + JWT admin).
//
// Flusso:
//   1. Recupera le lingue da languages.js
//   2. Chiama refreshCache da repos.js per popolare la cache in-memory e KV
//   3. Restituisce lo stato della cache aggiornata
//
// Sicurezza (due vie, decise in ISSUE-N6 — prima il cron non esisteva e il
// commento prometteva un warm-up mai schedulato):
//   - GET  → riservato al cron Vercel. Se la env CRON_SECRET è impostata nel
//            progetto, Vercel aggiunge automaticamente l'header
//            `Authorization: Bearer <CRON_SECRET>` alle richieste dei cron job
//            (vedi https://vercel.com/docs/cron-jobs). In alternativa viene
//            accettato l'header `x-cron-secret`. Confronto timing-safe.
//            Senza secret valido → 401 (fail-closed).
//   - POST → solo admin autenticato con JWT (require-auth, Bearer token).
//            Nessun default: le richieste senza token valido ricevono 401
//            prima ancora di leggere GITHUB_PAT.
//
// vercel.json: cron `GET /api/cache-refresh` ogni 30 minuti (`*/30 * * * *`).

import { getLanguages } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { logger } from './_lib/logger.js';
import { applyCors } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import {
  requireAuth,
  extractBearerToken,
  sendUnauthorized,
} from './_lib/require-auth.js';

// Codice macchina-leggibile per il 401 della via cron (GET senza CRON_SECRET).
const CRON_AUTH_CODE = 'CRON_AUTH_FAILED';

// Confronto timing-safe via digest SHA-256 (WebCrypto: funziona sia su Vercel
// Edge sia su Node 18+). Nessun early-exit sulla lunghezza: si confrontano
// solo digest a lunghezza fissa, quindi la lunghezza del secret non è
// osservabile.
async function safeEqual(a, b) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false; // fail-closed: senza WebCrypto il cron non passa
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    subtle.digest('SHA-256', encoder.encode(String(a))),
    subtle.digest('SHA-256', encoder.encode(String(b))),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i += 1) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// Legge un header dal req supportando sia il formato Node (oggetto chiave/
// valore, case-insensitive) sia il formato Web/Edge (headers.get).
function getHeader(req, name) {
  const headers = req?.headers ?? {};
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') {
    return headers.get(name) ?? headers.get(lower) ?? null;
  }
  return (
    headers[lower] ??
    headers[name] ??
    headers[name.charAt(0).toUpperCase() + name.slice(1)] ??
    null
  );
}

// GET (cron Vercel): il secret deve combaciare con la env CRON_SECRET.
// Fonti accettate: `Authorization: Bearer <secret>` (quella che Vercel
// inietta automaticamente sui cron job) oppure l'header `x-cron-secret`.
async function isCronAuthorized(req, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) return false; // CRON_SECRET non configurato → fail-closed
  const candidates = [
    extractBearerToken(req),
    getHeader(req, 'x-cron-secret'),
  ].filter((v) => typeof v === 'string' && v.length > 0);
  for (const candidate of candidates) {
    if (await safeEqual(secret, candidate)) return true;
  }
  return false;
}

async function handler(req, res) {
  // ── CORS + preflight ──
  // Endpoint AUTHENTICATED: la policy è esplicita con allowlist (applyCors),
  // NON il wildcard `*` riservato ai soli contenuti pubblici embeddati
  // (image/lever) — vedi NOTA SEC-2 in cors.js.
  // Methods: GET (cron Vercel), POST (admin JWT), OPTIONS (il POST non
  // passerebbe il preflight con il default GET, OPTIONS). Headers:
  // Content-Type + Authorization (il Bearer verrebbe bloccato dal preflight
  // se non dichiarato).
  applyCors(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    sendResponse(res, {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        error: 'Method not allowed. Use GET (cron) or POST.',
      }),
    });
    return;
  }

  const token = process.env.GITHUB_PAT || '';
  const owner = process.env.SLOT_OWNER || 'simrim96';

  if (!token) {
    logger.warn('cache-refresh endpoint called without GITHUB_PAT');
    sendResponse(res, {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        error: 'GITHUB_PAT not configured. Cache refresh cannot proceed.',
      }),
    });
    return;
  }

  try {
    // Carica tutte le lingue
    const languages = await getLanguages();
    logger.info('cache-refresh: started', {
      owner,
      languageCount: languages.length,
    });

    // Popola la cache per ogni lingua
    const results = {};
    let successCount = 0;
    let errorCount = 0;

    for (const lang of languages) {
      try {
        const repo = await getRepoForLanguage(token, owner, lang, languages);
        results[lang.id] = repo
          ? { found: true, url: repo.url, pct: repo.pct }
          : { found: false };
        if (repo) successCount++;
        else errorCount++;
      } catch (e) {
        logger.warn('cache-refresh: error fetching repo for lang', {
          langId: lang.id,
          error: e.message,
        });
        results[lang.id] = { found: false, error: e.message };
        errorCount++;
      }
    }

    logger.info('cache-refresh: completed', {
      owner,
      total: languages.length,
      success: successCount,
      error: errorCount,
    });

    sendResponse(res, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
      body: JSON.stringify({
        success: true,
        message: 'Cache refreshed successfully',
        timestamp: Date.now(),
        results,
        stats: {
          total: languages.length,
          success: successCount,
          error: errorCount,
        },
      }),
    });
  } catch (e) {
    logger.error('cache-refresh: unexpected error', { error: e.message });
    sendResponse(res, {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        error: 'Internal server error during cache refresh',
        details: e.message,
      }),
    });
  }
}

// Rotte protette, due vie (ISSUE-N6):
//   - OPTIONS → preflight CORS, passa senza credenziali (come require-auth);
//   - GET     → riservato al cron Vercel, autenticato con CRON_SECRET
//               (Authorization: Bearer <secret> o header x-cron-secret);
//   - POST    → JWT admin via require-auth (401 senza token valido; il 405
//               per i metodi non ammessi arriva dall'handler sottostante).
export default async function protectedHandler(req, res) {
  if (req?.method === 'OPTIONS') {
    return handler(req, res);
  }

  if (req.method === 'GET') {
    if (await isCronAuthorized(req)) {
      return handler(req, res);
    }
    return sendUnauthorized(
      res,
      CRON_AUTH_CODE,
      'Accesso negato: GET /api/cache-refresh è riservato al cron Vercel ' +
        '(richiede la env CRON_SECRET via "Authorization: Bearer <secret>" ' +
        'oppure header "x-cron-secret").'
    );
  }

  // POST e altri metodi: JWT (require-auth risponde 401 senza token valido).
  return requireAuth(handler)(req, res);
}
