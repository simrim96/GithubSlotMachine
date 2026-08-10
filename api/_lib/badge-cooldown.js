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

// Anti-spoofing (N12, ISSUES.md): stessa gerarchia di header fidati di
// spin-cooldown.js. L'ordine conta: x-vercel-ip è impostato dal proxy Vercel
// (non spoofabile), x-real-ip dal proxy upstream, e di X-Forwarded-For è
// affidabile SOLO l'ultimo elemento (quello aggiunto dal proxy finale — il
// client può forgiare i primi, quindi NON usarli mai come identità).
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

export function badgeCooldown(req) {
  const ip = clientIp(req);

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
