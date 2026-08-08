// ─── Badge rate-limit (ISSUE-L1) ────────────────────────────────────────────
// Cooldown per-IP per /api/badge, puramente in-memory.
// Nessun Redis: il badge ha traffico molto inferiore allo spin e un cooldown
// per-IP in-memory con cleanup TTL-based è sufficiente a prevenire abuse.
// Questo file è DELIBERATAMENTE indipendente da spin-cooldown.js per non
// introdurre overhead sul percorso critico di lever.js.

const COOLDOWN_MS = 1000; // 1 secondo tra badge requests dallo stesso IP

// Mappa ip -> { ts: number }
const map = new Map();

// Cleanup TTL-based per prevenire memory leak.
// Rimuove le entry scadute al momento dell'accesso e periodicamente.
const CLEANUP_INTERVAL = 100;
let _accessCounter = 0;

function cleanup() {
  const now = Date.now();
  for (const [ip, entry] of map.entries()) {
    if (now - entry.ts >= COOLDOWN_MS) {
      map.delete(ip);
    }
  }
}

export function badgeCooldown(req) {
  // Estrai IP (stessa gerarchia di spin-cooldown).
  const xff = req?.headers?.['x-forwarded-for'];
  const raw = typeof xff === 'string' ? xff : req?.headers?.get?.('x-forwarded-for');
  const ip = raw ? raw.split(',')[0].trim() :
             req?.headers?.['x-real-ip']?.split?.(',')[0]?.trim() ??
             req?.headers?.get?.('x-real-ip')?.trim() ??
             req?.headers?.get?.('x-vercel-ip')?.trim() ??
             'unknown';

  // Cleanup periodico.
  _accessCounter += 1;
  if (_accessCounter % CLEANUP_INTERVAL === 0) {
    cleanup();
  }

  const now = Date.now();
  const entry = map.get(ip);

  if (entry && now - entry.ts < COOLDOWN_MS) {
    return { allowed: false, ip };
  }

  map.set(ip, { ts: now });
  return { allowed: true, ip };
}

export { COOLDOWN_MS };
