// ─────────────────────────────────────────────────────────────────────────────
//  TOKEN ISSUER
//  Emissione degli access token JWT per POST /api/auth/login.
//
//  Usa jose (isomorfico: funziona sui runtime Vercel Node E Edge) e la
//  configurazione condivisa di jwt-config.js:
//    - HS256/384/512  → chiave simmetrica dal segreto (TextEncoder)
//    - RSA/EC/EdDSA   → chiave asimmetrica PEM da JWT_SECRET (importPKCS8)
//
//  La risoluzione della chiave è condivisa con require-auth.js (jwt-keys.js),
//  così firma e verifica usano la stessa logica per ogni algoritmo.
//
//  Il claim `sub` e `username` identificano l'utente autenticato; il token
//  porta anche iss/iat/exp come da configurazione.
//
//  TESTABILITÀ: issueAccessToken(username, env) accetta un oggetto env
//  opzionale (default process.env), come getJwtConfig.
// ─────────────────────────────────────────────────────────────────────────────

import { SignJWT } from 'jose';
import { getJwtConfig } from './jwt-config.js';
import { resolveSigningKey } from './jwt-keys.js';

/**
 * Emette un access token JWT firmato con la configurazione condivisa.
 * @param {string} username - Identità da inserire nei claim sub/username
 * @param {object} env - Oggetto env (default process.env)
 * @returns {Promise<{accessToken: string, tokenType: string, expiresIn: number,
 *   issuedAt: string, expiresAt: string}>}
 * @throws {Error} Se la configurazione JWT non è valida (es. produzione senza
 *   JWT_SECRET o algoritmo non supportato) o il PEM asimmetrico è malformato.
 */
export async function issueAccessToken(username, env = process.env) {
  const config = getJwtConfig(env);
  const key = await resolveSigningKey(config);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + config.accessTokenTtlSeconds;

  const accessToken = await new SignJWT({ sub: username, username })
    .setProtectedHeader({ alg: config.algorithm })
    .setIssuer(config.issuer)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expSeconds)
    .sign(key);

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSeconds,
    issuedAt: new Date(nowSeconds * 1000).toISOString(),
    expiresAt: new Date(expSeconds * 1000).toISOString(),
  };
}
