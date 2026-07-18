// Validazione dell'input utente per lo slot.
//
// Unica responsabilità rimasta: isValidUser(s) — valida il parametro ?user=
// per chiudere l'open-redirect: solo [A-Za-z0-9-], max 39 char, niente
// path/underscore/slash.
//
// NOTA: il rate-limit per-IP (token-bucket 1 spin / 3s, ex RL_WINDOW_SEC) è
// stato RIMOSSO (ISSUE-1): l'utente deve poter effettuare tutti gli spin che
// vuole senza ricevere "429 Troppe richieste". La protezione contro l'abuso
// del rate-limit globale GitHub (5000/h) resta demandata al graceful-fallback
// in state.js / github.js (circuit breaker + timeout), non a un blocco 429
// sugli spin.

// Regex per GitHub login: solo lettere/cifre/trattino, lunghezza 1-39.
// Niente underscore (GitHub non li permette nei login), niente slash, niente path.
const USER_RE = /^[A-Za-z0-9-]{1,39}$/;

export function isValidUser(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length === 0) return false;
  return USER_RE.test(t);
}
