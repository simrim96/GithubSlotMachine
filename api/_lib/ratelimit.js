// Rate-limiting + validazione dell'input utente per lo slot.
//
// Due responsabilità, entrambe pure/testabili:
//   1) rateLimit(req)  — token-bucket 1 spin / 3s per IP su Upstash (con
//      fallback in-memory se Redis non è configurato). Ritorna { ok, retryAfter }.
//   2) isValidUser(s)  — valida il parametro ?user= per chiudere l'open-redirect:
//      solo [A-Za-z0-9-], max 39 char, niente path/underscore/slash.
//
// Il rate-limit usato è deliberatamente permissivo (1 spin ogni 3s) per non
// infastidire l'uso "onesto" del widget, ma basta a fermare un abuso che
// esaurirebbe i 5000/h di GitHub API o i 10k/day di Upstash free.

import { kvEnabled, kvGet, kvSet } from './kv.js';

// Finestra del token-bucket: massimo 1 spin ogni RL_WINDOW_SEC secondi per IP.
export const RL_WINDOW_SEC = 3;

// Regex per GitHub login: solo lettere/cifre/trattino, lunghezza 1-39.
// Niente underscore (GitHub non li permette nei login), niente slash, niente path.
const USER_RE = /^[A-Za-z0-9-]{1,39}$/;

export function isValidUser(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length === 0) return false;
  return USER_RE.test(t);
}

// Estrae l'IP dal request Vercel/Node. Considera X-Forwarded-For (lista di IP
// separati da virgola) prendendo il primo hop. Fallback a 'local'.
export function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req?.socket?.remoteAddress || 'local';
}

// Rate-limit token-bucket semplificato: se è passato < RL_WINDOW_SEC dall'ultimo
// spin di questo IP, lo rifiuta e dice quanto aspettare. Altrimenti registra
// l'istante corrente e passa.
//
// Su Redis (kvEnabled) lo stato vive per RL_WINDOW_SEC grazie al TTL, così
// sopravvive ai cold-start e al multi-istanza. In locale (no Redis) usiamo una
// Map in-memory (perde stato al restart, ma va bene per dev).
export async function rateLimit(req) {
  const ip = clientIp(req);
  const now = Math.floor(Date.now() / 1000);
  const key = `gsm:rl:${ip}`;

  if (kvEnabled) {
    const last = await kvGet(key);
    if (last != null) {
      const lastSec = Number(last);
      if (!Number.isNaN(lastSec) && now - lastSec < RL_WINDOW_SEC) {
        return { ok: false, retryAfter: RL_WINDOW_SEC - (now - lastSec) };
      }
    }
    await kvSet(key, now, RL_WINDOW_SEC);
    return { ok: true, retryAfter: 0 };
  }

  // Fallback in-memory (solo dev / single-instance).
  const m = getMemBucket();
  const lastSec = m.get(ip);
  if (lastSec != null && now - lastSec < RL_WINDOW_SEC) {
    return { ok: false, retryAfter: RL_WINDOW_SEC - (now - lastSec) };
  }
  m.set(ip, now);
  return { ok: true, retryAfter: 0 };
}

// La Map in-memory è un dettaglio di implementazione: la esponiamo solo per i
// test (per poterne verificare/azzerare lo stato). In produzione non serve.
const _memBucket = new Map();
export function getMemBucket() {
  return _memBucket;
}
