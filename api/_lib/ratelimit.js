// Validazione dell'input utente per lo slot.
//
// Unica responsabilità rimasta: isValidUser(s) — valida il parametro ?user=
// per chiudere l'open-redirect: solo [A-Za-z0-9-], max 39 char, niente
// path/underscore/slash.
//
// NOTA: gli spin per-IP NON hanno alcun rate-limit (nessun 429). L'utente può
// effettuare tutti gli spin che vuole, senza limite per indirizzo IP
// (ISSUE-11, fix 2). La protezione contro l'abuso resta demandata al
// graceful-fallback GitHub (limite globale 5000/h) implementato in state.js /
// github.js tramite AbortController (timeout sulle chiamate API), non a un
// blocco 429 sugli spin. Questo file espone ora SOLO isValidUser(...) per la
// validazione del parametro ?user= (chiusura dell'open-redirect).

// Regex per GitHub login: solo lettere/cifre/trattino, lunghezza 1-39.
// Niente underscore (GitHub non li permette nei login), niente slash, niente path.
const USER_RE = /^[A-Za-z0-9-]{1,39}$/;

export function isValidUser(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length === 0) return false;
  return USER_RE.test(t);
}
