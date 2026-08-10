// ─── Rate-limit per-IP basato sul tempo di rotazione (fix S2, ISSUES.md) ─────
//
// S2: "/api/spin NON ha alcun rate-limit per-IP" — un attaccante può inviare
// centinaia di richieste al secondo ed esaurire il budget GitHub (5000 req/h),
// causando "Rate limit exceeded" a tutti.
//
// Soluzione: il tempo di rotazione dei rulli è la finestra naturale in cui un
// utente legittimo NON può (e non deve) richiedere un secondo spin. Usiamo
// questa stessa durata come rate-limit per-IP: se lo stesso IP richiede
// /api/spin prima che la finestra di rotazione sia trascorsa, lo rifiutiamo
// CON UN REDIRECT GRACEFUL (302 verso il profilo owner) — NON con una pagina
// di errore 429, né consumando budget GitHub. Il redirect è una risposta
// "gratuita" (nessuna chiamata a GitHub) e all'utente reale appare come il
// normale ritorno al profilo dopo lo spin.
//
// La costante SPIN_COOLDOWN_MS è L'unica fonte di verità ed è condivisa con il
// frontend (public/index.html) così che client e server concordino sulla
// stessa finestra di rotazione.
//
// Storage:
//   • Dev / nessun Redis: mappa in-memory (non condivisa fra le istanze
//     serverless, ma sufﬁciente come defense-in-depth; il vero blocco è il
//     client sulla stessa macchina).
//   • Prod (Upstash KV abilitato): chiave per-IP su Redis con TTL = finestra,
//     così il limite è globale e non aggiribile da un semplice script curl.

// Durata della rotazione dei rulli = finestra minima fra due spin dello stesso
// IP. Override via env SPIN_COOLDOWN_MS (utile per test/ambiente).
export const SPIN_COOLDOWN_MS =
  parseInt(process.env.SPIN_COOLDOWN_MS, 10) || 3000;

// Anti-spoofing (N12, ISSUES.md): gerarchia di header fidati.
// L'ordine conta: x-vercel-ip è impostato dal proxy Vercel (non spoofabile),
// x-real-ip dal proxy upstream, e di X-Forwarded-For è affidabile SOLO
// l'ultimo elemento (quello aggiunto dal proxy finale — il client può
// forgiare i primi, quindi NON usarli mai come identità).
function readHeader(req, name) {
  const headers = req?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const v = headers.get(name);
    if (v) return v;
  }
  const direct = headers[name];
  if (typeof direct === 'string' && direct) return direct;
  return null;
}

function clientIp(req) {
  // 1. Vercel edge: header affidabile, impossibile da spoofare
  const vercelIp = readHeader(req, 'x-vercel-ip');
  if (vercelIp) return vercelIp.trim();
  // 2. Proxy: x-real-ip
  const realIp = readHeader(req, 'x-real-ip');
  if (realIp) return realIp.trim();
  // 3. XFF: SOLO l'ultimo elemento (quello aggiunto dal proxy finale)
  const xff = readHeader(req, 'x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}

// ── Storage in-memory (fallback, non condiviso fra istanze) ──────────────────
// FIX ISSUE-M2: TTL-based cleanup per prevenire memory leak.
// Ogni entry ha un TTL = SPIN_COOLDOWN_MS. Le entry scadute vengono rimosse:
//   1. Al momento dell'accesso (lazy cleanup)
//   2. Ogni CLEANUP_INTERVAL accessi (periodic cleanup)
const mem = new Map(); // ip -> { ts: number, expires: number }
const CLEANUP_INTERVAL = 50; // effettua cleanup periodico ogni N accessi
let _accessCounter = 0;

function _cleanupExpired() {
  const now = Date.now();
  const windowMs = SPIN_COOLDOWN_MS;
  for (const [ip, entry] of mem.entries()) {
    if (now - entry.ts >= windowMs) {
      mem.delete(ip);
    }
  }
}

// ── Storage Redis (prod) ─────────────────────────────────────────────────────
import { kvGet, kvSet, kvEnabled } from './kv.js';

function kvKey(ip) {
  return `spin-cooldown:${ip}`;
}

// Verifica se l'IP è in cooldown. Se NON lo è, registra l'istante dello spin
// (così il prossimo spin entro la finestra verrà bloccato). Ritorna:
//   { allowed: true }  se lo spin può procedere
//   { allowed: false, retryAfterSec }  se lo spin è troppo presto
export async function checkSpinCooldown(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const windowMs = SPIN_COOLDOWN_MS;

  if (kvEnabled) {
    const last = await kvGet(kvKey(ip));
    const lastTs = typeof last === 'number' ? last : parseInt(last, 10);
    if (Number.isFinite(lastTs)) {
      const elapsed = now - lastTs;
      if (elapsed < windowMs) {
        const retryAfterSec = Math.ceil((windowMs - elapsed) / 1000);
        return { allowed: false, retryAfterSec, ip };
      }
    }
    // Consenti e registra l'istante (TTL = finestra, così la chiave scade da sola).
    await kvSet(kvKey(ip), now, Math.ceil(windowMs / 1000));
    return { allowed: true, ip };
  }

  // Fallback in-memory (dev / nessun Redis).
  // Cleanup periodico (ISSUE-M2)
  _accessCounter += 1;
  if (_accessCounter % CLEANUP_INTERVAL === 0) {
    _cleanupExpired();
  }

  const entry = mem.get(ip);
  if (entry && typeof entry.ts === 'number') {
    const elapsed = now - entry.ts;
    if (elapsed < windowMs) {
      const retryAfterSec = Math.ceil((windowMs - elapsed) / 1000);
      return { allowed: false, retryAfterSec, ip };
    }
  }
  mem.set(ip, { ts: now, expires: now + windowMs });
  return { allowed: true, ip };
}

export { clientIp };
