// ─── Rate Limit Tracking per GitHub API ──────────────────────────────────────
// Traccia X-RateLimit-Remaining e X-RateLimit-Reset dalle risposte GitHub API
// per scopi di logging/monitoraggio. Non serializza più le chiamate: per una
// slot machine personale il limite di 5000 req/h non è mai un vincolo reale,
// e la coda (RateLimitQueue) aggiungeva solo latenza e log fuorvianti sugli
// AbortError di timeout. Le chiamate GitHub passano direttamente dal circuit
// breaker in github.js.

export const GITHUB_RATE_LIMIT_HEADER_REMAINING = 'X-RateLimit-Remaining';
export const GITHUB_RATE_LIMIT_HEADER_RESET = 'X-RateLimit-Reset';
export const GITHUB_RATE_LIMIT_WARNING_THRESHOLD = 10; // Attiva la coda quando remaining <= 10
export const GITHUB_RATE_LIMIT_BLOCK_THRESHOLD = 2; // Blocca quando remaining <= 2

// ─── RateLimitTracker ────────────────────────────────────────────────────────
// Legge gli headers e mantiene lo stato corrente del rate limit.
export class RateLimitTracker {
  constructor() {
    // Valori correnti (aggiornati ad ogni risposta GitHub)
    this.remaining = null; // X-RateLimit-Remaining
    this.reset = null; // X-RateLimit-Reset (timestamp epoch secondi)

    // Statistiche per monitoraggio
    this.totalRequests = 0;
    this.requestsBlocked = 0;
    this.callsQueued = 0;
  }

  updateFromResponse(headers) {
    const remainingHeader = safeGetHeader(headers, GITHUB_RATE_LIMIT_HEADER_REMAINING);
    const resetHeader = safeGetHeader(headers, GITHUB_RATE_LIMIT_HEADER_RESET);

    if (remainingHeader !== null && remainingHeader !== undefined) {
      this.remaining = parseInt(remainingHeader, 10);
      if (isNaN(this.remaining)) this.remaining = null;
    }

    if (resetHeader !== null && resetHeader !== undefined) {
      this.reset = parseInt(resetHeader, 10);
      if (isNaN(this.reset)) this.reset = null;
    }

    this.totalRequests++;

    // Log warning se ci si avvicina al limite
    if (
      this.remaining !== null &&
      this.remaining <= GITHUB_RATE_LIMIT_WARNING_THRESHOLD
    ) {
      console.warn(
        `[GitHub Rate Limit] Remaining: ${this.remaining}, Reset at: ${this.formatResetTime()}`
      );
    }

    if (
      this.remaining !== null &&
      this.remaining <= GITHUB_RATE_LIMIT_BLOCK_THRESHOLD
    ) {
      console.error(
        `[GitHub Rate Limit] CRITICAL: Only ${this.remaining} requests left!`
      );
    }
  }

  // Ritorna true se siamo sotto il threshold di warning
  isBelowWarningThreshold() {
    return (
      this.remaining !== null &&
      this.remaining <= GITHUB_RATE_LIMIT_WARNING_THRESHOLD
    );
  }

  // Ritorna true se siamo sotto il threshold di blocco
  isBelowBlockThreshold() {
    return (
      this.remaining !== null &&
      this.remaining <= GITHUB_RATE_LIMIT_BLOCK_THRESHOLD
    );
  }

  // Calcola il tempo di reset (seconds until reset)
  getSecondsUntilReset() {
    if (this.reset === null) return null;
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, this.reset - now);
  }

  // Formatta il tempo di reset in stringa leggibile
  formatResetTime() {
    if (this.reset === null) return 'unknown';
    const date = new Date(this.reset * 1000);
    return date.toLocaleString();
  }

  // Ritorna lo stato attuale per il logging
  getState() {
    return {
      remaining: this.remaining,
      reset: this.reset,
      resetTime: this.formatResetTime(),
      secondsUntilReset: this.getSecondsUntilReset(),
      totalRequests: this.totalRequests,
      requestsBlocked: this.requestsBlocked,
      callsQueued: this.callsQueued,
      isBelowWarningThreshold: this.isBelowWarningThreshold(),
      isBelowBlockThreshold: this.isBelowBlockThreshold(),
    };
  }

  // Resetta lo stato (per test)
  clearState() {
    this.remaining = null;
    this.reset = null;
    this.totalRequests = 0;
    this.requestsBlocked = 0;
    this.callsQueued = 0;
  }
}

// ─── Factory functions per l'inizializzazione ────────────────────────────────
let _defaultTracker = null;

// Legge un header in modo difensivo: supporta sia l'oggetto Headers standard
// (con .get), sia un oggetto plain (accesso diretto), sia undefined. Su Vercel
// l'oggetto response.headers a volte NON è un Headers standard → .get non
// esiste → TypeError. Questo evita il crash che rompeva la ghGet per la README.
export function safeGetHeader(headers, name) {
  if (!headers) return null;
  // Headers standard (Web API / undici-fetch)
  if (typeof headers.get === 'function') {
    return headers.get(name);
  }
  // Oggetto plain (es. headers serializzati): prova la chiave esatta e
  // case-insensitive (GitHub usa X-RateLimit-Remaining)
  if (typeof headers === 'object') {
    if (name in headers) return headers[name];
    const lower = String(name).toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) return headers[key];
    }
  }
  return null;
}

export function getDefaultTracker() {
  if (!_defaultTracker) {
    _defaultTracker = new RateLimitTracker();
  }
  return _defaultTracker;
}

// Helper per leggere gli headers da una risposta
export function parseRateLimitHeaders(response) {
  const remaining = safeGetHeader(response?.headers, GITHUB_RATE_LIMIT_HEADER_REMAINING);
  const reset = safeGetHeader(response?.headers, GITHUB_RATE_LIMIT_HEADER_RESET);

  const remainingNum =
    remaining !== null && remaining !== undefined
      ? parseInt(remaining, 10)
      : null;
  const resetNum =
    reset !== null && reset !== undefined ? parseInt(reset, 10) : null;

  return {
    remaining: Number.isNaN(remainingNum) ? null : remainingNum,
    reset: Number.isNaN(resetNum) ? null : resetNum,
  };
}
