// ─── Cache Refresh Endpoint ────────────────────────────────────────────────────
// Endpoint per popolare proattivamente la cache lingua→repo.
// Chiamato da un cron job ogni 30 minuti per evitare il "primo spin freddo".
//
// Flusso:
//   1. Recupera le lingue da languages.js
//   2. Chama refreshCache da repos.js per popolare la cache in-memory e KV
//   3. Restituisce lo stato della cache aggiornata
//
// Sicurezza: richiede il token GITHUB_PAT per evitare abuso dell'endpoint

import { getLanguages } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { logger } from './_lib/logger.js';
import { applyCorsWildcard } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';

export default async function handler(req, res) {
  // ── CORS + preflight (ISSUE-25: wildcard `*`) ──
  applyCorsWildcard(req, res);
  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }

  if (req.method !== 'POST') {
    sendResponse(res, {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
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
    logger.info('cache-refresh: started', { owner, languageCount: languages.length });

    // Popola la cache per ogni lingua
    const results = {};
    let successCount = 0;
    let errorCount = 0;

    for (const lang of languages) {
      try {
        const repo = await getRepoForLanguage(token, owner, lang, languages);
        results[lang.id] = repo ? { found: true, url: repo.url, pct: repo.pct } : { found: false };
        if (repo) successCount++;
        else errorCount++;
      } catch (e) {
        logger.warn('cache-refresh: error fetching repo for lang', { langId: lang.id, error: e.message });
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
        stats: { total: languages.length, success: successCount, error: errorCount },
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
