// ─────────────────────────────────────────────────────────────────────────────
//  JWT KEYS
//  Risoluzione del materiale di chiave per firma e verifica JWT, condivisa
//  tra token-issuer.js (emissione) e require-auth.js (verifica).
//
//  Per HS* la chiave è simmetrica: bytes UTF-8 del segreto (TextEncoder).
//  Per RSA/EC/EdDSA la chiave è asimmetrica: JWT_SECRET contiene il PEM
//  (tipicamente la chiave PRIVATA, usata per firmare). jose richiede però una
//  CryptoKey PUBBLICA per la verifica: la deriviamo dal PEM privato con un
//  round-trip JWK (importPKCS8 → exportJWK → rimozione dei componenti privati
//  → importJWK), usando solo API WebCrypto → funziona sia su runtime Node sia
//  su Edge (nessuna dipendenza da node:crypto).
//  Se JWT_SECRET contiene già una chiave pubblica (PEM SPKI), la usiamo
//  direttamente senza derivazione.
//
//  TESTABILITÀ: entrambe le funzioni accettano la config congelata prodotta
//  da getJwtConfig(env) — nessuno stato globale.
// ─────────────────────────────────────────────────────────────────────────────

import { importPKCS8, importSPKI, importJWK, exportJWK } from 'jose';

// Componenti JWK che appartengono SOLO alla chiave privata; rimossi per
// ottenere la chiave pubblica equivalente (RSA: d,p,q,dp,dq,qi,oth; EC: d).
const PRIVATE_JWK_PARTS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

/**
 * Risolve la chiave di FIRMA dalla config (usata da token-issuer.js):
 * simmetrica per HS*, asimmetrica (PEM PKCS8) per RSA/EC/EdDSA.
 * @param {Readonly<{algorithm: string, secret: string}>} config - Config da getJwtConfig
 * @returns {Promise<Uint8Array|CryptoKey>} Chiave pronta per jose
 */
export async function resolveSigningKey(config) {
  if (config.algorithm.startsWith('HS')) {
    return new TextEncoder().encode(config.secret);
  }
  return importPKCS8(config.secret, config.algorithm);
}

/**
 * Risolve la chiave di VERIFICA dalla config (usata da require-auth.js).
 * jose accetta solo chiavi pubbliche per la verifica asimmetrica: se il PEM
 * in JWT_SECRET è una chiave privata, ne deriva la controparte pubblica.
 * @param {Readonly<{algorithm: string, secret: string}>} config - Config da getJwtConfig
 * @returns {Promise<Uint8Array|CryptoKey>} Chiave pubblica/simmetrica pronta per jose
 */
export async function resolveVerificationKey(config) {
  if (config.algorithm.startsWith('HS')) {
    return new TextEncoder().encode(config.secret);
  }

  const pem = config.secret.trim();
  // PEM SPKI (chiave pubblica) già disponibile → uso diretto.
  if (pem.includes('PUBLIC KEY')) {
    return importSPKI(pem, config.algorithm);
  }

  // PEM PKCS8 (chiave privata) → deriva la chiave pubblica via JWK:
  // 1. importPKCS8 con extractable: true (serve per esportare il JWK)
  // 2. exportJWK → JWK completo (componenti pubblici + privati)
  // 3. rimuovi i componenti privati → JWK pubblico
  // 4. importJWK → CryptoKey pubblica per la verifica
  const privateKey = await importPKCS8(pem, config.algorithm, {
    extractable: true,
  });
  const jwk = await exportJWK(privateKey);
  for (const part of PRIVATE_JWK_PARTS) {
    delete jwk[part];
  }
  return importJWK(jwk, config.algorithm);
}
