// TEMPORARY maintenance endpoint (2026-08-08) — da rimuovere dopo l'uso.
//
// Scopo: eliminare i dati storici CORROTTI in produzione (Richiesta dashboard:
// "elimina i dati storici corrotti in produzione").
//
// Il bug ISSUE-4 (kvIncr su chiavi contatore separate) ha corrotto i contatori
// community: totalWins == totalSpins (193/193 → 194/194 live). state.json su
// GitHub è già stato resettato a 0/0 (commit d652f06), ma Redis `gsm:state`
// contiene ancora i valori corrotti e il codice in produzione è ancora quello
// buggy.
//
// Questo endpoint:
//   1. (con fix deployato) legge lo stato Redis corrente
//   2. ELIMINA le chiavi corrotte: gsm:state, gsm:counter:spins, gsm:counter:wins
//   3. Alla prossima readState(), KV vuoto → seed da GitHub state.json (0/0)
//
// PROTETTO da token segreto in query (?token=...) per non essere invocabile
// da terzi. Il token è hardcodato perché l'endpoint è temporaneo e verrà
// rimosso subito dopo la verifica.
import { kvGet, kvEnabled } from './_lib/kv.js';
import { logger } from './_lib/logger.js';

const MAINTENANCE_TOKEN = '8AX5rMmyfM3z0UTt1GuCRy_fFovAOQ1d';
const KEYS_TO_DELETE = ['gsm:state', 'gsm:counter:spins', 'gsm:counter:wins'];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 2));
}

async function deleteKeys(url, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${url}/del`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ keys: KEYS_TO_DELETE }),
  });
  if (!response.ok) {
    throw new Error(`Upstash /del failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
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
          const r = await fetch(`${url}/key/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${writeToken}` },
          });
          const d = await r.json();
          const val = d.result ?? null;
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

    // 1. Stato prima (lettura diretta, non attraverso kvGet che ha circuit-breaker)
    const before = {};
    for (const key of KEYS_TO_DELETE) {
      try {
        const r = await fetch(`${url}/key/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${writeToken}` },
        });
        const d = await r.json();
        before[key] = d.result ?? null;
      } catch (e) {
        before[key] = `ERR: ${e.message}`;
      }
    }

    // 2. Elimina le chiavi corrotte
    const delResult = await deleteKeys(url, writeToken);

    // 3. Stato dopo
    const after = {};
    for (const key of KEYS_TO_DELETE) {
      try {
        const r = await fetch(`${url}/key/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${writeToken}` },
        });
        const d = await r.json();
        after[key] = d.result ?? null;
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
