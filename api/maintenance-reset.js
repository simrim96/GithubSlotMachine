// TEMPORARY maintenance endpoint (2026-08-08) — da rimuovere dopo l'uso.
//
// Scopo: eliminare i dati storici CORROTTI in produzione (Richiesta dashboard:
// "elimina i dati storici corrotti in produzione").
//
// Il bug ISSUE-4 (kvIncr su chiavi contatore separate) ha corrotto i contatori
// community: totalWins == totalSpins (193/193 → 194/194 live). state.json su
// GitHub è già stato resettato a 0/0 (commit d652f06), ma Redis `gsm:state`
// conteneva ancora i valori corrotti e il codice in produzione era ancora
// quello buggy.
//
// NOTA REST format (2026-08-08, verificato live coi probe): la REST API di
// Upstash mette comando e argomenti nel PATH dell'URL (/get/{key},
// /set/{key}/{value}, /del/{key1}/{key2}). Gli endpoint /db, /key/, e i body
// {keys:[...]} NON esistono (400 "Command is not available") — i DEL con body
// restituivano result:0 (0 chiavi eliminate).
//
// Modalità:
//   ?mode=diag  — legge chiavi note (gsm:state, gsm:slotSvg, ...) senza toccare
//                 nulla. Verifica che il DB sia davvero pulito.
//   ?mode=reset — ELIMINA le chiavi corrotte: gsm:state, gsm:counter:spins,
//                 gsm:counter:wins. Alla prossima readState(), KV vuoto → seed
//                 da GitHub state.json (0/0).
//   ?mode=svg   — rigenera slot.svg con stato pulito 0/0 (nessuna vincita) e lo
//                 scrive su GitHub (slot.svg) + Redis (gsm:slotSvg), così
//                 l'immagine servita non mostra più i contatori corrotti 194/194.
//
// PROTETTO da token segreto in query (?token=...) per non essere invocabile
// da terzi. Il token è hardcodato perché l'endpoint è temporaneo e verrà
// rimosso subito dopo la verifica.
import { kvEnabled } from './_lib/kv.js';
import { logger } from './_lib/logger.js';
import { generateGrid } from './_lib/game.js';
import { buildAccessibleSVGWithTimeout } from './_lib/svg-builder-accessible.js';
import { ghGetJson, ghPut } from './_lib/github.js';

const MAINTENANCE_TOKEN = '8AX5rMmyfM3z0UTt1GuCRy_fFovAOQ1d';
const KEYS_TO_DELETE = ['gsm:state', 'gsm:counter:spins', 'gsm:counter:wins'];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 2));
}

// GET via path (formato REST reale): GET {url}/get/{key}
async function restGet(url, token, key) {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `HTTP ${r.status}: ${JSON.stringify(d).slice(0, 120)}` };
  return d.result ?? null;
}

// DEL via path (formato REST reale): POST {url}/del/{key1}/{key2}
async function restDel(url, token, ...keys) {
  const r = await fetch(
    `${url}/del/${keys.map((k) => encodeURIComponent(k)).join('/')}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const d = await r.json().catch(() => ({}));
  return { status: r.status, result: d.result, error: d.error || null };
}

export default async function handler(req, res) {
  const token = req.query?.token ? String(req.query.token) : '';
  if (token !== MAINTENANCE_TOKEN) {
    return json(res, 403, { ok: false, error: 'forbidden' });
  }

  try {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
    const writeToken =
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

    if (!url || !writeToken) {
      return json(res, 500, { ok: false, error: 'KV non configurato' });
    }

    // Modalità diagnostica: ?mode=diag — legge chiavi note senza cancellare nulla.
    const mode = req.query?.mode ? String(req.query.mode) : 'reset';
    if (mode === 'diag') {
      const keys = [
        'gsm:state',
        'gsm:counter:spins',
        'gsm:counter:wins',
        'gsm:slotSvg',
        'gsm:stateDirty',
        'gsm:stateStale',
        'gsm:readme:simrim96',
      ];
      const out = {};
      for (const key of keys) {
        try {
          const val = await restGet(url, writeToken, key);
          out[key] =
            typeof val === 'string' && val.length > 80
              ? `STRING len=${val.length} head=${val.slice(0, 60)}`
              : val;
        } catch (e) {
          out[key] = `ERR: ${e.message}`;
        }
      }
      return json(res, 200, { ok: true, mode: 'diag', url, keys: out });
    }

    // Modalità rigenerazione SVG: ?mode=svg — costruisce slot.svg con stato
    // pulito (0/0) e lo scrive su GitHub + Redis, così l'immagine servita
    // non mostra più i contatori corrotti.
    if (mode === 'svg') {
      const owner = process.env.SLOT_OWNER || 'simrim96';
      const repo = process.env.SLOT_REPO || 'GithubSlotMachine';
      const token = process.env.GITHUB_PAT || process.env.GITHUB_PAT__ || '';
      if (!token) {
        return json(res, 500, { ok: false, error: 'GITHUB_PAT non configurato' });
      }

      // Stato pulito: contatori a zero, nessuna vincita.
      const cleanState = {
        totalSpins: 0,
        totalWins: 0,
        lastWin: null,
        version: 2,
        lastPullTimestamp: 0,
        settings: { theme: 'auto', sound: true },
        stats: { longestStreak: 0, currentStreak: 0, winsByLang: {} },
      };

      const grid = generateGrid();
      const svg = await buildAccessibleSVGWithTimeout({
        grid,
        uid: Date.now(),
        state: cleanState,
        winningLang: null,
        fact: null,
        owner,
        isWin: false,
      });

      // Scrivi su Redis (se possibile) e su GitHub (sempre, così la fonte
      // remota è allineata e il fallback dell'immagine serve il file pulito).
      const results = { redis: null, github: null };
      if (kvEnabled) {
        try {
          const { kvSet } = await import('./_lib/kv.js');
          results.redis = await kvSet('gsm:slotSvg', svg, 60 * 60 * 24 * 7);
        } catch (e) {
          results.redis = `ERR: ${e.message}`;
        }
      }

      // Leggi lo sha corrente di slot.svg su GitHub per il PUT.
      const gh = await ghGetJson(token, owner, repo, 'slot.svg');
      const sha = gh?.sha || null;
      try {
        await ghPut(token, owner, repo, 'slot.svg', svg, sha, '🎰 Update live slot');
        results.github = `ok (sha ${sha})`;
      } catch (e) {
        results.github = `ERR: ${e.message}`;
      }

      logger.info('[maintenance] slot.svg regenerated with clean state', { results });
      return json(res, 200, {
        ok: true,
        mode: 'svg',
        state: cleanState,
        svgSize: svg.length,
        results,
      });
    }

    // 1. Stato prima (lettura diretta con formato REST corretto /get/{key})
    const before = {};
    for (const key of KEYS_TO_DELETE) {
      try {
        before[key] = await restGet(url, writeToken, key);
      } catch (e) {
        before[key] = `ERR: ${e.message}`;
      }
    }

    // 2. Elimina le chiavi corrotte (DEL con chiavi nel path: /del/{k1}/{k2})
    const delResult = await restDel(url, writeToken, ...KEYS_TO_DELETE);

    // 3. Stato dopo
    const after = {};
    for (const key of KEYS_TO_DELETE) {
      try {
        after[key] = await restGet(url, writeToken, key);
      } catch (e) {
        after[key] = `ERR: ${e.message}`;
      }
    }

    logger.info('[maintenance] keys deleted', { delResult });
    return json(res, 200, {
      ok: true,
      kvEnabled,
      before,
      deleted: delResult,
      after,
      note: 'Prossima readState() farà seed da GitHub state.json (0/0)',
    });
  } catch (err) {
    logger.error('[maintenance] failed', { error: err?.message || err });
    return json(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
