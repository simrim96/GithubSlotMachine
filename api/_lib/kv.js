// ─── Upstash Redis via fetch diretto (Edge-optimized) ─────────────────────────
// Wrapper minimale su Upstash Redis via HTTP REST API (fetch diretto).
//
// PERCHÉ FARE FETCH DIRETTO:
// - @upstash/redis v1.38.0 ha un init overhead significativo in Edge Runtime
// - Le operazioni Redis sono semplici REST API: GET/PUT/DELETE via HTTP
// - Fetch diretto = zero init, cold start < 10ms
//
// SE LE ENV SONO IMPOSTATE:
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN → scrittura completa
//   o KV_REST_API_URL + KV_REST_API_TOKEN (+ KV_REST_API_READ_ONLY_TOKEN)
//   kvEnabled = true, stato in Redis ~10ms same-region
//
// SE LE ENV NON SONO IMPOSTATE:
//   kvEnabled = false, fallback su GitHub Contents API (funziona in locale)
//
// TIMEOUT: Tutte le operazioni hanno timeout KV_TIMEOUT_MS (default 500ms)
// per evitare che Redis lento blocchi lo spin per secondi interi.

import { logger } from './logger.js';

const url =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';

const writeToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  '';

const readToken =
  writeToken ||
  process.env.KV_REST_API_READ_ONLY_TOKEN ||
  '';

// ─── Circuit-breaker per Redis (ISSUE-M1) ─────────────────────────────────
// Dopo CIRCUIT_BREAKER_FAILURE_THRESHOLD fallimenti consecutivi, il circuit
// breaker si apre: Redis viene disattivato per CIRCUIT_BREAKER_RESET_MS,
// evitando di sprecare richieste su un backend DOWN.
// Transizioni: closed → open (dopo threshold fallimenti) → half-open
// (dopo resetMs) → closed (se il prossimo tentativo riesce) o open (se fallisce).

const CIRCUIT_BREAKER_FAILURE_THRESHOLD =
  parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 5;
const CIRCUIT_BREAKER_RESET_MS =
  parseInt(process.env.CIRCUIT_BREAKER_RESET_MS) || 60_000; // 60 secondi

let _cbState = 'closed'; // 'closed' | 'open' | 'half-open'
let _cbFailureCount = 0;
let _cbOpenAt = 0;

export const kvEnabled = Boolean(url && readToken);
export const kvWritable = Boolean(url && writeToken);

// Valuta lo stato del circuit-breaker a ogni richiesta: se siamo in stato "open",
// controlla se è passato il tempo di reset. Se sì, transiziona a "half-open".
// In "half-open", il prossimo tentativo determina se chiudere o riaprire.
function evaluateCircuitBreaker() {
  if (_cbState === 'closed') return 'allowed';
  if (_cbState === 'open') {
    if (Date.now() - _cbOpenAt >= CIRCUIT_BREAKER_RESET_MS) {
      _cbState = 'half-open';
    }
    return 'blocked';
  }
  // half-open: consente un solo tentativo
  return 'half-open';
}

export function getCircuitBreakerState() {
  // Ri-evaluare prima di restituire lo stato
  evaluateCircuitBreaker();
  return {
    state: _cbState,
    failureCount: _cbFailureCount,
    isOpen: _cbState === 'open',
    isHalfOpen: _cbState === 'half-open',
  };
}

export { evaluateCircuitBreaker };
export { CIRCUIT_BREAKER_FAILURE_THRESHOLD, CIRCUIT_BREAKER_RESET_MS };

// Registratore di successo/fallimento per circuit-breaker
function _cbSuccess() {
  _cbFailureCount = 0;
  _cbState = 'closed';
}
function _cbFailure() {
  _cbFailureCount += 1;
  if (_cbFailureCount >= CIRCUIT_BREAKER_FAILURE_THRESHOLD && _cbState !== 'open') {
    _cbState = 'open';
    _cbOpenAt = Date.now();
    logger.warn('[kv] circuit-breaker OPEN after', { failures: _cbFailureCount, threshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD, reset_ms: CIRCUIT_BREAKER_RESET_MS });
  }
}

const KV_TIMEOUT_MS = parseInt(process.env.KV_TIMEOUT_MS) || 500;

async function withTimeout(p, ms = KV_TIMEOUT_MS) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('kv timeout')), ms)
    ),
  ]);
}

function getHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function kvGet(key) {
  if (!kvEnabled) return null;
  if (evaluateCircuitBreaker() === 'blocked') {
    logger.debug('[kv] circuit-breaker open, kvGet skipped', { key });
    return null;
  }
  try {
    const response = await withTimeout(
      fetch(`${url}/key/${encodeURIComponent(key)}`, {
        headers: getHeaders(readToken),
      })
    );
    if (!response.ok) {
      _cbFailure();
      return null;
    }
    _cbSuccess();
    const data = await response.json();
    return data.result || null;
  } catch (err) {
    _cbFailure();
    logger.debug('[kv] kvGet failed, circuit-breaker updated', { key, error: err?.message });
    return null;
  }
}

export async function kvSet(key, val, ttlSec = 0) {
  if (!kvEnabled) return false;
  if (!kvWritable) {
    console.warn('[kvSet] nessun token di SCRITTURA configurato:', {
      message: 'Solo KV_REST_API_READ_ONLY_TOKEN presente. Chiave non salvata.',
      key,
    });
    return false;
  }
  if (evaluateCircuitBreaker() === 'blocked') {
    logger.debug('[kv] circuit-breaker open, kvSet skipped', { key });
    return false;
  }
  try {
    const body = { key, value: val };
    if (ttlSec > 0) body.ex = ttlSec;

    const response = await withTimeout(
      fetch(`${url}/db`, {
        method: 'POST',
        headers: getHeaders(writeToken),
        body: JSON.stringify(body),
      })
    );
    if (!response.ok) {
      if (isAuthError({ status: response.status })) {
        console.warn('[kvSet] scrittura negata (401/403):', { key, status: response.status });
      }
      _cbFailure();
      return false;
    }
    _cbSuccess();
    return response.ok;
  } catch (err) {
    _cbFailure();
    console.warn('[kvSet] failed', { key, error: err?.message || err });
    return false;
  }
}

export async function kvMget(...keys) {
  if (!kvEnabled) return keys.map(() => null);
  if (evaluateCircuitBreaker() === 'blocked') {
    logger.debug('[kv] circuit-breaker open, kvMget skipped', { keys });
    return keys.map(() => null);
  }
  try {
    const response = await withTimeout(
      fetch(`${url}/mget`, {
        method: 'POST',
        headers: getHeaders(readToken),
        body: JSON.stringify({ keys }),
      })
    );
    if (!response.ok) {
      _cbFailure();
      return keys.map(() => null);
    }
    _cbSuccess();
    const data = await response.json();
    return data.result || keys.map(() => null);
  } catch {
    _cbFailure();
    return keys.map(() => null);
  }
}

export async function kvMset(obj) {
  if (!kvEnabled) return false;
  if (!kvWritable) {
    console.warn('[kvMset] nessun token di SCRITTURA configurato:', {
      message: 'Solo KV_REST_API_READ_ONLY_TOKEN presente. Chiavi non salvate.',
      keys: Object.keys(obj).join(', '),
    });
    return false;
  }
  if (evaluateCircuitBreaker() === 'blocked') {
    logger.debug('[kv] circuit-breaker open, kvMset skipped', { keys: Object.keys(obj) });
    return false;
  }
  try {
    const pairs = Object.entries(obj).map(([k, v]) => ({ key: k, value: v }));
    const response = await withTimeout(
      fetch(`${url}/mset`, {
        method: 'POST',
        headers: getHeaders(writeToken),
        body: JSON.stringify({ pairs }),
      })
    );
    if (!response.ok) {
      _cbFailure();
      return false;
    }
    _cbSuccess();
    return response.ok;
  } catch {
    _cbFailure();
    return false;
  }
}

export async function kvIncr(key) {
  if (!kvEnabled) return null;
  if (!kvWritable) {
    console.warn('[kvIncr] no write token configured', { key });
    return null;
  }
  if (evaluateCircuitBreaker() === 'blocked') {
    logger.debug('[kv] circuit-breaker open, kvIncr skipped', { key });
    return null;
  }
  try {
    const response = await withTimeout(
      fetch(`${url}/incr/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: getHeaders(writeToken),
      })
    );
    if (!response.ok) {
      _cbFailure();
      return null;
    }
    _cbSuccess();
    const data = await response.json();
    return data.result || null;
  } catch (err) {
    _cbFailure();
    console.warn('[kvIncr] failed', { key, error: err?.message || err });
    return null;
  }
}

// Helper per auth errors
function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  const msg = String(err.message || err).toLowerCase();
  return /401|403|unauthorized|forbidden|not authorized|permission/i.test(msg);
}

export { withTimeout, isAuthError };
