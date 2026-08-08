// Diagnostica performance: misura le latenze reali dei componenti dello spin.
// Utile per capire se Upstash è cross-region rispetto a Vercel (la causa
// più comune di spin lenti nonostante Redis).
//
// GET /api/health  → JSON con tempi in ms di ogni hop.
// GET /api/health?full=1 → aggiunge anche la scansione repo (cold cache).

import { kvEnabled, kvWritable, kvGet, kvSet } from './_lib/kv.js';
import { getRepoCacheStats } from './_lib/repos.js';
import { ghHeaders } from './_lib/github.js';
import { applyCors } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { logger } from './_lib/logger.js';

const OWNER = process.env.SLOT_OWNER || 'simrim96';

function now() {
  return performance.now();
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }

  const full = req.query?.full === '1' || req.query?.full === 'true';
  const steps = {};
  const t = now();

  // ── 1. Upstash Redis round-trip (solo se abilitato) ─────────────────────
  if (kvEnabled) {
    const t0 = now();
    let kvOk = false;
    let kvWriteOk = false;
    try {
      const probe = 'gsm:__health__' + Date.now();
      // FIX (2026-08-08): prima kvOk veniva impostato a true anche quando
      // kvSet ritornava false silenziosamente (kvSet non lancia mai: su
      // errore ritorna false). Per questo health diceva "kv_writable: true"
      // mentre in produzione le scritture fallivano (endpoint REST sbagliati
      // in kv.js: /db e /key/ invece di /set/ e /get/). Ora kvOk richiede
      // che kvSet ritorni TRUE e che kvGet rilegga il valore scritto.
      kvWriteOk = await kvSet(probe, '1');
      const readBack = await kvGet(probe);
      kvOk = kvWriteOk && readBack === '1';
    } catch (e) {
      /* Sentry already handled by logger */
      steps.kv_error = e.message;
    }
    steps.kv_roundtrip_ms = now() - t0;
    steps.kv_enabled = true;
    steps.kv_writable = kvWritable;
    steps.kv_ok = kvOk;
    steps.kv_write_ok = kvWriteOk;
    if (!kvWritable) {
      steps.kv_note =
        'READ-ONLY: presente solo KV_REST_API_READ_ONLY_TOKEN. Le scritture ' +
        '(stato community, cache repo) NON vengono persistite (ISSUE-23). ' +
        'Configura UPSTASH_REDIS_REST_TOKEN o KV_REST_API_TOKEN per scrivere.';
    } else if (!kvOk) {
      steps.kv_note =
        'ERRORE SCRITTURA: kvSet/kvGet non completano il round-trip. Controlla ' +
        'URL/token Upstash e che gli endpoint REST usati da kv.js siano validi ' +
        '(formato REST: /set/{key}/{value} e /get/{key}, NON /db o /key/).';
      steps.kv_severity = 'error';
    } else {
      steps.kv_note =
        steps.kv_roundtrip_ms > 60
          ? 'LENTO: Upstash probabilmente è in una region diversa da Vercel. Spostalo nella stessa region.'
          : 'OK: same-region ~10-20ms.';
    }

    if (steps.kv_roundtrip_ms > 60) {
      const slowMsg = `health: cross-region Upstash detected; kv_roundtrip_ms=${steps.kv_roundtrip_ms} > 60ms`;
      logger.warn(slowMsg);
      steps.kv_severity = 'warning';
      steps.kv_note = 'LENTO: Upstash probabilmente è in una region diversa da Vercel. Spostalo nella stessa region.';
    }
  } else {
    steps.kv_enabled = false;
    steps.kv_note = 'Upstash NON configurato (uso fallback GitHub).';
    // Diagnostica: quali nomi env sono presenti (solo presenza, mai i valori).
    steps.kv_env_seen = {
      UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
      KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
      KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    };
    steps.kv_fix_hint =
      'Nessuna env Upstash trovata. In Vercel: Project → Settings → Environment Variables, ' +
      'OPPURE Storage → collega Upstash Redis e conferma che le env (UPSTASH_REDIS_REST_URL/_TOKEN ' +
      'o KV_REST_API_URL/_TOKEN) appaiano nel progetto. Poi redeploy.';
  }

  // ── 2. GitHub README GET (hop che lo spin aspettava prima del redirect) ───
  const token = process.env.GITHUB_PAT;
  if (token) {
    const t0 = now();
    try {
      const r = await fetch(
        'https://api.github.com/repos/' + OWNER + '/' + OWNER + '/readme',
        {
          headers: ghHeaders(token, {
            accept: 'application/vnd.github+json',
            userAgent: 'gsm-health',
          }),
        }
      );
      steps.github_readme_get_ms = now() - t0;
      steps.github_status = r.status;
    } catch (e) {
      /* Sentry already handled by logger */
      steps.github_readme_get_ms = now() - t0;
      steps.github_error = e.message;
    }
  } else {
    steps.github_note = 'GITHUB_PAT assente: skip misurazione GitHub.';
  }

  // ── 3. (opzionale) stato cache repo ────────────────────────────────────
  // NOTA: leggiamo SOLO lo stato della cache, NON chiamiamo getRepoForLanguage
  // (che a cold-start lancia refreshCache in background e lascia fetch GitHub
  // pendenti → FUNCTION_INVOCATION_FAILED su Vercel). Health è puramente
  // diagnostico: misura se la cache è calda senza mai scatenare il crash.
  if (full && token) {
    const t0 = now();
    try {
      const stats = await getRepoCacheStats();
      steps.repo_cache = stats;
      steps.repo_scan_ms = now() - t0;
      steps.repo_scan_note = stats.populated
        ? 'Cache repo popolata — il primo spin non paga lo stall GitHub.'
        : 'Cache repo VUOTA — il prossimo spin a freddo pagherà ~575ms di stall GitHub.';
    } catch (e) {
      steps.repo_scan_ms = now() - t0;
      steps.repo_scan_error = e.message;
    }
  }

  steps.total_ms = now() - t;
  steps.region_hint =
    'Vercel region: Project → Settings → General. Upstash: crea il DB nella stessa region.';
  sendResponse(res, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(steps, null, 2),
  });
}
