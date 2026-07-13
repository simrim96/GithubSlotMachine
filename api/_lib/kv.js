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

// Upstash può essere collegato in due modi, con nomi env DIVERSI:
//  1) Standalone (crei il DB su upstash.com e copi le env):
//       UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//  2) Integrato in Vercel ("Upstash Redis" / Vercel KV storage integration):
//       KV_REST_API_URL + KV_REST_API_TOKEN (+ KV_REST_API_READ_ONLY_TOKEN)
// Supportiamo entrambi, così kvEnabled è true qualunque modo tu lo abbia collegato.
const url =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  '';
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.KV_REST_API_READ_ONLY_TOKEN ||
  '';

export const kvEnabled = Boolean(url && token);

export const kv = kvEnabled ? new Redis({ url, token }) : null;

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
  try {
    if (ttlSec > 0) await withTimeout(kv.set(key, val, { ex: ttlSec }));
    else await withTimeout(kv.set(key, val));
    return true;
  } catch {
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
  try {
    await withTimeout(kv.mset(obj));
    return true;
  } catch {
    return false;
  }
}

// Esportato per testing
export { withTimeout };
