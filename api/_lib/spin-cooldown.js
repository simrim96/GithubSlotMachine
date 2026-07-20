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

// Anti-spoofing: gerarchia di header fidati come in ratelimit-tracker.js.
function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  const raw = typeof xff === 'string' ? xff : req?.headers?.get?.('x-forwarded-for');
  if (raw) return raw.split(',')[0].trim();
  const xri = req?.headers?.['x-real-ip'];
  const raw2 = typeof xri === 'string' ? xri : req?.headers?.get?.('x-real-ip');
  if (raw2) return raw2.trim();
  // Vercel edge: req.headers.get('x-vercel-ip')
  const xv = req?.headers?.get?.('x-vercel-ip');
  if (xv) return xv.trim();
  return 'unknown';
}

// ── Storage in-memory (fallback, non condiviso fra istanze) ──────────────────
const mem = new Map(); // ip -> timestamp ms dell'ultimo spin consentito

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
  const lastTs = mem.get(ip);
  if (typeof lastTs === 'number') {
    const elapsed = now - lastTs;
    if (elapsed < windowMs) {
      const retryAfterSec = Math.ceil((windowMs - elapsed) / 1000);
      return { allowed: false, retryAfterSec, ip };
    }
  }
  mem.set(ip, now);
  return { allowed: true, ip };
}

export { clientIp };
