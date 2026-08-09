// ─────────────────────────────────────────────────────────────────────────────
//  CREDENTIALS SERVICE
//  Verifica delle credenziali di accesso per POST /api/auth/login.
//
//  Lettura da ambiente (NESSUN default — fail-closed):
//    - AUTH_USERNAME → utente amministratore
//    - AUTH_PASSWORD → password amministratore
//
//  Se le variabili non sono configurate il login NON è possibile: ogni
//  richiesta riceve 401 (non esiste alcuna credenziale valida). Non esiste
//  una coppia di default di sviluppo: credenziali hardcoded sarebbero un
//  backdoor silenzioso.
//
//  Il confronto usa timingSafeEqual su digest SHA-256: né la lunghezza né il
//  contenuto delle stringhe sono deducibili dal timing di risposta.
//
//  TESTABILITÀ: le funzioni accettano un oggetto env opzionale (default
//  process.env), così i test possono sovrascrivere le variabili d'ambiente
//  senza toccare lo stato globale del processo (stessa convenzione di
//  jwt-config.js).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Carica la configurazione credenziali. Oggetto congelato (Object.freeze).
 * @param {object} env - Oggetto env (default process.env)
 * @returns {Readonly<{username: string, password: string, configured: boolean}>}
 */
export function getCredentialsConfig(env = process.env) {
  const username = (env.AUTH_USERNAME ?? '').trim();
  const password = (env.AUTH_PASSWORD ?? '').trim();
  return Object.freeze({
    username,
    password,
    configured: Boolean(username && password),
  });
}

// Confronto a tempo costante: hash SHA-256 di entrambe le parti (parifica la
// lunghezza, quindi timingSafeEqual non fa leak né di lunghezza né di bytes).
function safeEqual(a, b) {
  const digestA = createHash('sha256').update(String(a)).digest();
  const digestB = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Verifica le credenziali in modo fail-closed.
 * @param {unknown} username - Username fornito dal client
 * @param {unknown} password - Password fornita dal client
 * @param {object} env - Oggetto env (default process.env)
 * @returns {boolean} true solo se l'auth è configurata e le credenziali
 *   coincidono. Non lancia mai: credenziali mancanti/non stringa o auth non
 *   configurata producono semplicemente false (→ 401).
 */
export function verifyCredentials(username, password, env = process.env) {
  const config = getCredentialsConfig(env);
  if (!config.configured) return false;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return false;
  }
  const uname = username.trim();
  if (uname === '' || password === '') return false;
  return (
    safeEqual(uname, config.username) && safeEqual(password, config.password)
  );
}
