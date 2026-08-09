// ─────────────────────────────────────────────────────────────────────────────
//  JWT CONFIG
//  Configurazione centralizzata per firma/verifica token JWT.
//  Legge le variabili d'ambiente con default sicuri SOLO per sviluppo:
//    - JWT_SECRET            → segreto di firma (obbligatorio in produzione)
//    - JWT_ALGORITHM         → algoritmo di firma (default HS256)
//    - JWT_ISSUER            → issuer scritto nei claim (default github-slot-machine)
//    - JWT_ACCESS_TOKEN_TTL  → durata access token (default 15m)
//    - JWT_REFRESH_TOKEN_TTL → durata refresh token (default 7d)
//
//  Le durate accettano secondi (900) o stringhe con unità ("15m", "1h", "7d").
//
//  TESTABILITÀ: getJwtConfig(env) accetta un oggetto env opzionale (default
//  process.env), così i test possono sovrascrivere le variabili d'ambiente
//  senza toccare lo stato globale del processo.
// ─────────────────────────────────────────────────────────────────────────────

// Placeholder DEV-ONLY: mai usato fuori da sviluppo locale (vedi sotto).
export const DEV_DEFAULT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

export const DEFAULT_ALGORITHM = 'HS256';
export const DEFAULT_ISSUER = 'github-slot-machine';
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minuti
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 giorni

// Algoritmi supportati da jose per HS/RSA/EC/EdDSA. JWT_SECRET deve contenere
// il materiale di chiave corrispondente (stringa per HS, PEM per RSA/EC/EdDSA).
const SUPPORTED_ALGORITHMS = new Set([
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
  'EdDSA',
]);

const UNIT_TO_SECONDS = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };

/**
 * Converte una durata in secondi.
 * Accetta numeri puri ("900") o stringhe con unità ("15m", "1h", "7d").
 * @param {string|number|undefined} value - Valore da convertire
 * @param {number} fallbackSeconds - Default se value è vuoto/assente
 * @param {string} varName - Nome della variabile (per errori chiari)
 * @returns {number} Durata in secondi (intero positivo)
 * @throws {Error} Se il valore è presente ma non è una durata valida
 */
export function parseDurationSeconds(value, fallbackSeconds, varName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallbackSeconds;
  }

  const str = String(value).trim();
  let seconds;

  if (/^\d+$/.test(str)) {
    seconds = Number(str);
  } else {
    const match = /^(\d+)([smhd])$/i.exec(str);
    if (!match) {
      throw new Error(
        `JWT config: ${varName} non valido "${value}" — usa secondi (es. 900) ` +
          'o una durata con unità (es. "15m", "1h", "7d")'
      );
    }
    seconds = Number(match[1]) * UNIT_TO_SECONDS[match[2].toLowerCase()];
  }

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(
      `JWT config: ${varName} deve essere un intero positivo, ricevuto "${value}"`
    );
  }

  return seconds;
}

/**
 * Carica la configurazione JWT. Oggetto congelato (Object.freeze).
 * @param {NodeJS.ProcessEnv|object} env - Oggetto env (default process.env)
 * @returns {Readonly<{secret: string, algorithm: string, issuer: string,
 *   accessTokenTtlSeconds: number, refreshTokenTtlSeconds: number}>}
 * @throws {Error} In produzione se JWT_SECRET manca o è il default di sviluppo;
 *   se JWT_ALGORITHM non è supportato; se una durata non è valida.
 */
export function getJwtConfig(env = process.env) {
  const isProduction = (env.NODE_ENV ?? 'development') === 'production';

  const secret = (env.JWT_SECRET ?? '').trim();
  if (!secret) {
    if (isProduction) {
      throw new Error('JWT config: JWT_SECRET è obbligatorio in produzione');
    }
    return buildConfig(env, DEV_DEFAULT_SECRET, isProduction);
  }
  if (isProduction && secret === DEV_DEFAULT_SECRET) {
    throw new Error(
      'JWT config: JWT_SECRET non può essere il default di sviluppo in produzione'
    );
  }
  return buildConfig(env, secret, isProduction);
}

function buildConfig(env, secret, isProduction) {
  const algorithm = (env.JWT_ALGORITHM ?? '').trim() || DEFAULT_ALGORITHM;
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Error(
      `JWT config: JWT_ALGORITHM "${algorithm}" non supportato. ` +
        `Usa uno tra: ${[...SUPPORTED_ALGORITHMS].join(', ')}`
    );
  }

  return Object.freeze({
    secret,
    algorithm,
    issuer: (env.JWT_ISSUER ?? '').trim() || DEFAULT_ISSUER,
    accessTokenTtlSeconds: parseDurationSeconds(
      env.JWT_ACCESS_TOKEN_TTL,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      'JWT_ACCESS_TOKEN_TTL'
    ),
    refreshTokenTtlSeconds: parseDurationSeconds(
      env.JWT_REFRESH_TOKEN_TTL,
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
      'JWT_REFRESH_TOKEN_TTL'
    ),
    // Esposto per i consumer che vogliono fail-closed in produzione
    // senza ricalcolare la logica: true = secret esplicito fornito.
    isProduction,
  });
}
