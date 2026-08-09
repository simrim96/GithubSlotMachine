// ─────────────────────────────────────────────────────────────────────────────
//  REQUIRE-AUTH
//  Middleware/protector di verifica JWT per gli handler Vercel (req, res).
//
//  Flusso:
//    1. estrae il token dall'header `Authorization: Bearer <token>`;
//    2. verifica firma, algoritmo, issuer e scadenza tramite jose usando la
//       configurazione condivisa (api/_lib/jwt-config.js → getJwtConfig);
//    3. in caso di successo inietta il payload del token in `req.user` e
//       chiama l'handler originale;
//    4. in caso di token mancante, malformato, scaduto o invalido risponde
//       401 con un body JSON chiaro (code + message) e l'header
//       `WWW-Authenticate: Bearer` (RFC 6750), SENZA mai chiamare l'handler.
//
//  Uso:
//     import { requireAuth } from './_lib/require-auth.js';
//     async function handler(req, res) { ... req.user.sub ... }
//     export default requireAuth(handler);
//
//  Le richieste OPTIONS (preflight CORS) passano SENZA token: il preflight non
//  porta credenziali per definizione, e la policy CORS resta responsabilità
//  dell'handler sottostante (applyCors / applyCorsWildcard).
//
//  TESTABILITÀ: requireAuth(handler, { env }) e verifyAccessToken(token, env)
//  accettano un oggetto env opzionale (default process.env), così i test
//  possono usare un secret dedicato senza toccare lo stato globale.
// ─────────────────────────────────────────────────────────────────────────────

import { jwtVerify } from 'jose';
import { getJwtConfig } from './jwt-config.js';
import { resolveVerificationKey } from './jwt-keys.js';
import { sendResponse } from './response-bridge.js';
import { logger } from './logger.js';

// Codici di errore esposti nel body 401 (macchina-leggibili e stabili).
export const AUTH_CODES = {
  MISSING_TOKEN: 'MISSING_TOKEN',
  MALFORMED_TOKEN: 'MALFORMED_TOKEN',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
};

// Valore dell'header WWW-Authenticate (RFC 6750) sulle risposte 401.
const WWW_AUTHENTICATE = 'Bearer realm="github-slot-machine"';

// Regex dello schema Bearer: `Bearer <token>` (case-insensitive, tollera
// spazi extra). Il token NON deve contenere spazi.
const BEARER_RE = /^Bearer\s+(\S+)$/i;

/**
 * Estrae il token dall'header Authorization di una richiesta Vercel.
 * Supporta sia `req.headers.authorization` (Node) sia il formato
 * `req.headers.get('authorization')` (Web/Edge).
 * @param {object} req - Richiesta Vercel
 * @returns {string|null} Token JWT, oppure null se assente/malformato.
 */
export function extractBearerToken(req) {
  const headers = req?.headers ?? {};
  const raw =
    typeof headers.get === 'function'
      ? headers.get('authorization')
      : (headers.authorization ?? headers.Authorization);
  if (!raw) return null;
  const match = BEARER_RE.exec(String(raw).trim());
  return match ? match[1] : null;
}

/**
 * Verifica firma, algoritmo, issuer e scadenza di un token JWT.
 * La chiave è risolta in base all'algoritmo configurato (jwt-keys.js):
 * simmetrica per HS*, pubblica (derivata dal PEM privato se necessario)
 * per RSA/EC/EdDSA — così RS256/ES256/EdDSA verificano correttamente,
 * non solo HS*.
 * @param {string} token - Token JWT da verificare
 * @param {object} env - Oggetto env (default process.env), passato a getJwtConfig
 * @returns {Promise<object>} Payload decodificato e verificato
 * @throws {Error} JWTExpired / JWSSignatureVerificationFailed /
 *   JWTClaimValidationFailed / JWTInvalid (errori jose con `.code`)
 */
export async function verifyAccessToken(token, env = process.env) {
  const config = getJwtConfig(env);
  const key = await resolveVerificationKey(config);
  const { payload } = await jwtVerify(token, key, {
    issuer: config.issuer,
    algorithms: [config.algorithm],
  });
  return payload;
}

// Mappa un errore jose a un codice AUTH_CODES leggibile.
function codeForError(err) {
  switch (err?.code) {
    case 'ERR_JWT_EXPIRED':
      return AUTH_CODES.EXPIRED_TOKEN;
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
    case 'ERR_JWT_INVALID':
    case 'ERR_JWS_INVALID':
      return AUTH_CODES.INVALID_TOKEN;
    default:
      return AUTH_CODES.INVALID_TOKEN;
  }
}

// Messaggio umano per ciascun codice di errore.
const MESSAGES = {
  [AUTH_CODES.MISSING_TOKEN]:
    'Token mancante: header "Authorization: Bearer <token>" richiesto',
  [AUTH_CODES.MALFORMED_TOKEN]:
    'Token malformato: lo schema deve essere "Authorization: Bearer <token>"',
  [AUTH_CODES.EXPIRED_TOKEN]: 'Token scaduto: effettua di nuovo il login',
  [AUTH_CODES.INVALID_TOKEN]:
    'Token non valido: firma, issuer o algoritmo non riconosciuti',
};

// Risponde 401 con body JSON e header WWW-Authenticate (RFC 6750).
export function sendUnauthorized(res, code, message) {
  return sendResponse(res, {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'WWW-Authenticate': WWW_AUTHENTICATE,
    },
    body: JSON.stringify({
      error: 'Unauthorized',
      code,
      message: message || MESSAGES[code] || 'Autenticazione richiesta',
    }),
  });
}

/**
 * Avvolge un handler Vercel (req, res) con la verifica JWT.
 * - token mancante      → 401 MISSING_TOKEN
 * - header non-Bearer   → 401 MALFORMED_TOKEN
 * - token scaduto       → 401 EXPIRED_TOKEN
 * - firma/issuer/alg    → 401 INVALID_TOKEN
 * - token valido        → req.user = payload, poi handler(req, res)
 * - OPTIONS             → passa direttamente all'handler (preflight CORS)
 * @param {Function} handler - Handler Vercel originale
 * @param {{env?: object}} opts - Opzioni (env custom per i test)
 * @returns {Function} Handler protetto
 */
export function requireAuth(handler, { env = process.env } = {}) {
  return async function protectedHandler(req, res) {
    if (req?.method === 'OPTIONS') {
      return handler(req, res);
    }

    const token = extractBearerToken(req);
    if (!token) {
      // Nessun header Authorization → token mancante. Header presente ma
      // senza schema Bearer valido → token malformato.
      const hasAuthHeader =
        req?.headers?.authorization || req?.headers?.Authorization;
      return sendUnauthorized(
        res,
        hasAuthHeader ? AUTH_CODES.MALFORMED_TOKEN : AUTH_CODES.MISSING_TOKEN
      );
    }

    // Il token è presente ma non è in formato JWT (es. "abc", "Bearer x y").
    if (!token.includes('.') || token.split('.').length !== 3) {
      return sendUnauthorized(res, AUTH_CODES.MALFORMED_TOKEN);
    }

    try {
      const payload = await verifyAccessToken(token, env);
      req.user = payload;
    } catch (err) {
      // Errori di configurazione (es. JWT_SECRET assente in produzione) NON
      // sono colpa del client: logghiamo e rispondiamo 500 fail-closed,
      // mai un 401 che nasconderebbe un problema server.
      if (err?.name === 'Error' && !err?.code) {
        logger.error('[require-auth] configurazione JWT non valida', {
          error: err.message,
        });
        return sendResponse(res, {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          body: JSON.stringify({
            error: 'Internal Server Error',
            code: 'AUTH_CONFIG_ERROR',
          }),
        });
      }
      const code = codeForError(err);
      logger.warn('[require-auth] accesso rifiutato', { code });
      return sendUnauthorized(res, code);
    }

    return handler(req, res);
  };
}
