// Diagnostica performance: misura le latenze reali dei componenti dello spin.
// Utile per capire se Upstash è cross-region rispetto a Vercel (la causa
// più comune di spin lenti nonostante Redis).
//
// GET /api/health  → JSON con tempi in ms di ogni hop.
// GET /api/health?full=1 → aggiunge anche la scansione repo (cold cache).

import { kvEnabled, kvGet, kvSet } from './_lib/kv.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { ghHeaders } from './_lib/github.js';
import { LANGUAGES } from './_lib/languages.js';
import * as Sentry from '@sentry/node';

const OWNER = process.env.SLOT_OWNER || 'simrim96';

function now() {
  return Number(process.hrtime.bigint() / 1000000n);
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');

  const full = req.query?.full === '1' || req.query?.full === 'true';
  const steps = {};
  const t = now();

  // ── 1. Upstash Redis round-trip (solo se abilitato) ─────────────────────
  if (kvEnabled) {
    const t0 = now();
    let kvOk = false;
    try {
      const probe = 'gsm:__health__' + Date.now();
      await kvSet(probe, '1');
      await kvGet(probe);
      kvOk = true;
    } catch (e) {
      Sentry.captureException(e);
      steps.kv_error = e.message;
    }
    steps.kv_roundtrip_ms = now() - t0;
    steps.kv_enabled = true;
    steps.kv_ok = kvOk;
    steps.kv_note =
      steps.kv_roundtrip_ms > 60
        ? 'LENTO: Upstash probabilmente è in una region diversa da Vercel. Spostalo nella stessa region.'
        : 'OK: same-region ~10-20ms.';
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
      Sentry.captureException(e);
      steps.github_readme_get_ms = now() - t0;
      steps.github_error = e.message;
    }
  } else {
    steps.github_note = 'GITHUB_PAT assente: skip misurazione GitHub.';
  }

  // ── 3. (opzionale) repo scan su cold cache ───────────────────────────────
  if (full && token) {
    const t0 = now();
    try {
      await getRepoForLanguage(token, OWNER, LANGUAGES[0], LANGUAGES);
      steps.repo_scan_ms = now() - t0;
      steps.repo_scan_note =
        'Include lo stall delle GitHub API se la cache KV è fredda.';
    } catch (e) {
      steps.repo_scan_ms = now() - t0;
      steps.repo_scan_error = e.message;
    }
  }

  steps.total_ms = now() - t;
  steps.region_hint =
    'Vercel region: Project → Settings → General. Upstash: crea il DB nella stessa region.';
  res.status(200).send(JSON.stringify(steps, null, 2));
}
