// Wrapper minimale su Upstash Redis (serverless-friendly, via REST HTTP).
//
// Se le env UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN sono impostate,
// kvEnabled è true e tutto lo stato (slot.svg, contatori, cache repo) viene
// servito/scratchato da Redis in ~10ms same-region, eliminando i commit-per-spin
// su GitHub e le race condition da SHA stale.
//
// Se le env NON sono impostate (es. `vercel dev` in locale senza Redis) kvEnabled
// è false e i singoli moduli applicano un fallback su GitHub Contents API, così
// il progetto resta funzionante anche senza Redis.
//
// TIMEOUT: @upstash/redis NON ha un timeout di rete corto di default. Se Upstash
// è lento/cross-region, una kv.get potrebbe aspettare SECONDI prima di fallire.
// Ogni operazione qui è racchiusa in un timeout di KV_TIMEOUT_MS: scaduto,
// restituiamo null/false e il chiamante applica il fallback GitHub. Così Redis
// lento NON può mai peggiorare le prestazioni oltre il percorso GitHub.

import { Redis } from '@upstash/redis';
import { logger } from './logger.js';

// Upstash può essere collegato in due modi, con nomi env DIVERSI:
//  1) Standalone (crei il DB su upstash.com e copi le env):
//       UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//  2) Integrato in Vercel ("Upstash Redis" / Vercel KV storage integration):
//       KV_REST_API_URL + KV_REST_API_TOKEN (+ KV_REST_API_READ_ONLY_TOKEN)
// Supportiamo entrambi, così kvEnabled è true qualunque modo tu lo abbia collegato.
const url =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';

// Token di SCRITTURA: necessario per kvSet/kvMset. Non includiamo
// KV_REST_API_READ_ONLY_TOKEN perché è, per definizione, in sola lettura e
// le scritture fallirebbero silenziosamente con 401/403 (vedi ISSUE-23).
const writeToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  '';

// Token di LETTURA: usato per kvGet/kvMget. Può essere il read-only token
// se non c'è un token di scrittura, così almeno la lettura continua a funzionare.
const readToken =
  writeToken ||
  process.env.KV_REST_API_READ_ONLY_TOKEN ||
  '';

// kvEnabled = possiamo ALMENO leggere da Redis (URL + un qualsiasi token).
// kvWritable = abbiamo un token di SCRITTURA valido (le scritture non falliranno per auth).
export const kvEnabled = Boolean(url && readToken);
export const kvWritable = Boolean(url && writeToken);

export const kv = kvEnabled ? new Redis({ url, token: readToken }) : null;
export const kvWrite = kvWritable ? new Redis({ url, token: writeToken }) : null;

const KV_TIMEOUT_MS = parseInt(process.env.KV_TIMEOUT_MS) || 500;

function withTimeout(p, ms = KV_TIMEOUT_MS) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('kv timeout')), ms)
    ),
  ]);
}

export async function kvGet(key) {
  if (!kvEnabled) return null;
  try {
    return await withTimeout(kv.get(key));
  } catch {
    return null;
  }
}

export async function kvSet(key, val, ttlSec = 0) {
  if (!kvEnabled) return false;
  if (!kvWritable) {
    // ISSUE-23: solo token read-only (es. KV_REST_API_READ_ONLY_TOKEN) →
    // una scrittura fallirebbe con 401/403. Lo segnaliamo esplicitamente
    // invece di fallire in silenzio.
    logger.warn('kvSet ignored: no write token configured', {
      message: 'Only KV_REST_API_READ_ONLY_TOKEN present. Key not persisted.',
      key,
    });
    return false;
  }
  try {
    if (ttlSec > 0) await withTimeout(kvWrite.set(key, val, { ex: ttlSec }));
    else await withTimeout(kvWrite.set(key, val));
    return true;
  } catch (err) {
    if (isAuthError(err)) {
      logger.warn('kvSet auth failure', {
        status: err.status,
        message: 'Write denied (invalid write token?). Key not persisted.',
        key,
      });
    }
    return false;
  }
}

// Batch: legge più chiavi in un solo round-trip (mget).
export async function kvMget(...keys) {
  if (!kvEnabled) return keys.map(() => null);
  try {
    return await withTimeout(kv.mget(...keys));
  } catch {
    return keys.map(() => null);
  }
}

// Batch: scrive più coppie in un solo round-trip (mset).
export async function kvMset(obj) {
  if (!kvEnabled) return false;
  if (!kvWritable) {
    // ISSUE-23: idem kvSet — segnaliamo invece di fallire in silenzio.
    logger.warn('kvMset ignored: no write token configured', {
      message: 'Only KV_REST_API_READ_ONLY_TOKEN present. Keys not persisted.',
      keys: Object.keys(obj).join(', '),
    });
    return false;
  }
  try {
    await withTimeout(kvWrite.mset(obj));
    return true;
  } catch (err) {
    if (isAuthError(err)) {
      logger.warn('kvMset auth failure', {
        status: err.status,
        message: 'Write denied (invalid write token?). Keys not persisted.',
        keys: Object.keys(obj).join(', '),
      });
    }
    return false;
  }
}

// Incremento atomico di un intero Redis (per counter).
// Usa l'operazione atomica INCR di Redis per evitare race condition
// quando due o più spin arrivano contemporaneamente (ISSUE-4).
export async function kvIncr(key) {
  if (!kvEnabled) return null;
  if (!kvWritable) {
    logger.warn('kvIncr ignored: no write token configured', { key });
    return null;
  }
  try {
    const result = await withTimeout(kvWrite.incr(key));
    return result; // result è l'NUOVO valore dopo l'incremento (Integer)
  } catch (err) {
    logger.warn('kvIncr failed', { key, error: err?.message || err });
    return null;
  }
}

// Rileva errori 401/403 (UpstashError espone .status quando la REST API
// risponde con un codice di stato non-2xx; altrimenti controlla il messaggio).
function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  const msg = String(err.message || err).toLowerCase();
  return /401|403|unauthorized|forbidden|not authorized|permission/i.test(msg);
}

// Esportato per testing
export { withTimeout, isAuthError };
