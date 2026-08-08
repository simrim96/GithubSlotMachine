// ─── Upstash Redis via fetch diretto (Edge-optimized) ─────────────────────────
// Wrapper minimale su Upstash Redis via HTTP REST API (fetch diretto).
//
// PERCHÉ FARE FETCH DIRETTO:
// - @upstash/redis v1.38.0 ha un init overhead significativo in Edge Runtime
// - Le operazioni Redis sono semplici REST API: GET/PUT/DELETE via HTTP
// - Fetch diretto = zero init, cold start < 10ms
//
// FORMATO REST UPSTASH (2026-08-08, verificato live col probe di manutenzione):
//   La REST API segue la convenzione del protocollo Redis: il comando e i suoi
//   argomenti vanno nel PATH dell'URL, separati da '/':
//     GET foo        → GET  {url}/get/foo
//     SET foo bar    → POST {url}/set/foo/bar            (args nel path)
//     SET foo bar EX 100 → POST {url}/set/foo/bar/EX/100
//     INCR foo       → POST {url}/incr/foo
//     MGET a b       → GET  {url}/mget/a/b
//     MSET a 1 b 2   → POST {url}/mset/a/1/b/2
//   Per valori GRANDI (es. slot.svg ~56KB) il path URL è inadatto → si usa
//   /pipeline con body JSON 2D: [["SET", key, value, "EX", ttl], ...].
//
// ⚠️ STORICO BUG (commit 96c1338): gli endpoint usati erano `/db` (SET con body
// {key,value}) e `/key/{key}` (GET) — INESISTENTI nella REST API Upstash. Il
// server rispondeva 400 "Command is not available: 'DB'/'KEY'". Conseguenza:
// kvGet tornava null e kvSet false SILENZIOSAMENTE → Redis non è mai stato né
// letto né scritto in produzione (tutto passava dal fallback GitHub). Il fix
// allinea gli endpoint al formato REST reale.
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

// Soglia oltre la quale usiamo /pipeline invece del path URL per SET
// (valori grandi come slot.svg ~56KB non stanno in un path URL ragionevole).
const KV_PIPELINE_THRESHOLD = 2048;

// Serializza un valore per la REST API Upstash (tutto è stringa in Redis):
// oggetti → JSON, stringhe → raw, numeri/booleani → String().
function kvSerialize(val) {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || val === null) {
    return String(val);
  }
  return JSON.stringify(val);
}

// Deserializza il risultato di una GET: JSON se sembra JSON, altrimenti raw.
function kvDeserialize(result) {
  if (typeof result !== 'string') return result;
  const trimmed = result.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return result;
    }
  }
  return result;
}

export async function kvGet(key) {
  if (!kvEnabled) return null;
  if (evaluateCircuitBreaker() === 'blocked') {
    logger.debug('[kv] circuit-breaker open, kvGet skipped', { key });
    return null;
  }
  try {
    const response = await withTimeout(
      fetch(`${url}/get/${encodeURIComponent(key)}`, {
        headers: getHeaders(readToken),
      })
    );
    if (!response.ok) {
      _cbFailure();
      return null;
    }
    _cbSuccess();
    const data = await response.json();
    return kvDeserialize(data.result);
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
  const serialized = kvSerialize(val);
  try {
    // Valori piccoli: SET nel path (formato REST: /set/{key}/{value}[/EX/{ttl}]).
    // Valori grandi: /pipeline con body JSON 2D per evitare URL enormi.
    let response;
    if (serialized.length <= KV_PIPELINE_THRESHOLD) {
      let path = `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(serialized)}`;
      if (ttlSec > 0) path += `/EX/${Math.floor(ttlSec)}`;
      response = await withTimeout(
        fetch(path, {
          method: 'POST',
          headers: getHeaders(writeToken),
        })
      );
    } else {
      const cmd = ['SET', key, serialized];
      if (ttlSec > 0) cmd.push('EX', String(Math.floor(ttlSec)));
      response = await withTimeout(
        fetch(`${url}/pipeline`, {
          method: 'POST',
          headers: getHeaders(writeToken),
          body: JSON.stringify([cmd]),
        })
      );
    }
    if (!response.ok) {
      if (isAuthError({ status: response.status })) {
        console.warn('[kvSet] scrittura negata (401/403):', { key, status: response.status });
      }
      _cbFailure();
      return false;
    }
    _cbSuccess();
    const data = await response.json();
    // SET via path → { result: 'OK' }; via pipeline → { result: ['OK'] }
    const result = Array.isArray(data.result) ? data.result[0] : data.result;
    return result === 'OK';
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
      fetch(
        `${url}/mget/${keys.map((k) => encodeURIComponent(k)).join('/')}`,
        { headers: getHeaders(readToken) }
      )
    );
    if (!response.ok) {
      _cbFailure();
      return keys.map(() => null);
    }
    _cbSuccess();
    const data = await response.json();
    const result = Array.isArray(data.result) ? data.result : keys.map(() => null);
    return result.map((v) => kvDeserialize(v));
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
    const args = [];
    for (const [k, v] of Object.entries(obj)) {
      args.push(k, kvSerialize(v));
    }
    const response = await withTimeout(
      fetch(
        `${url}/mset/${args.map((a) => encodeURIComponent(a)).join('/')}`,
        {
          method: 'POST',
          headers: getHeaders(writeToken),
        }
      )
    );
    if (!response.ok) {
      _cbFailure();
      return false;
    }
    _cbSuccess();
    const data = await response.json();
    return data.result === 'OK';
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
