// ─── Rate Limit Header Parsing per GitHub API ──────────────────────────────
// Parsing degli header X-RateLimit-* dalle risposte GitHub API per scopi di
// logging/monitoraggio. NIENTE stato persistente, NIENTE classe: ogni risposta
// viene loggata al volo e basta. Il rate limit di GitHub (5000 req/h per le
// chiamate autenticate) non è mai un vincolo reale per una slot machine
// personale, quindi non blocchiamo né accodiamo nulla — ci limitiamo a
// registrare il remaining e a stampare un warning quando si avvicina allo zero.
//
// NOTA (ISSUE-12): in passato esisteva una classe RateLimitTracker che
// manteneva lo stato in-process ed esponeva un metodo di soglia, ma
// nessun handler la interrogava per bloccare le chiamate → codice puramente
// osservazionale e ingannevole. Rimossa: qui restano solo gli helper di
// parsing header e il logging.

export const GITHUB_RATE_LIMIT_HEADER_REMAINING = 'X-RateLimit-Remaining';
export const GITHUB_RATE_LIMIT_HEADER_RESET = 'X-RateLimit-Reset';
export const GITHUB_RATE_LIMIT_WARNING_THRESHOLD = 10; // Stampa warning quando remaining <= 10

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

// Estrae remaining/reset dalla risposta GitHub (o dal suo oggetto headers).
// Ritorna { remaining, reset } con valori numerici o null.
export function parseRateLimitHeaders(response) {
  const headers = response?.headers ?? response;
  const remaining = safeGetHeader(headers, GITHUB_RATE_LIMIT_HEADER_REMAINING);
  const reset = safeGetHeader(headers, GITHUB_RATE_LIMIT_HEADER_RESET);

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

// Logga il rate limit a partire da una risposta GitHub: registra il remaining
// e stampa un warning quando si avvicina allo zero. Solo logging — NON blocca.
export function logRateLimit(response) {
  const { remaining, reset } = parseRateLimitHeaders(response);
  if (remaining !== null && remaining <= GITHUB_RATE_LIMIT_WARNING_THRESHOLD) {
    const resetStr =
      reset !== null ? new Date(reset * 1000).toLocaleString() : 'unknown';
    console.warn(
      `[GitHub Rate Limit] Remaining: ${remaining}, Reset at: ${resetStr}`
    );
  }
}
