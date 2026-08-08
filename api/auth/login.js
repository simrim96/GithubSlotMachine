// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/login
//  Autenticazione amministratore: verifica le credenziali (credentials.js) e,
//  se valide, emette un JWT firmato con il segreto configurato
//  (token-issuer.js + jwt-config.js).
//
//  Risposte:
//    200 → { accessToken, tokenType, expiresIn, issuedAt, expiresAt, user }
//    401 → { error: 'invalid_credentials' }  — input non valido O credenziali
//          errate: stesso corpo per entrambi i casi, nessun leak su quale
//          campo è sbagliato né sullo stato di configurazione dell'auth.
//    405 → { error: 'method_not_allowed' }   — solo POST (OPTIONS per CORS)
//    500 → { error: 'internal_error' }       — configurazione JWT non valida
//
//  SICUREZZA:
//    - non logga MAI la password né il segreto JWT (solo lo username)
//    - Cache-Control: no-store su ogni risposta
//    - CORS con metodi POST, OPTIONS (login.js usa applyCors con override)
//    - body limitato a 16 KB
// ─────────────────────────────────────────────────────────────────────────────

import { applyCors } from '../_lib/cors.js';
import { sendResponse } from '../_lib/response-bridge.js';
import { logger } from '../_lib/logger.js';
import { verifyCredentials } from '../_lib/credentials.js';
import { issueAccessToken } from '../_lib/token-issuer.js';

const MAX_BODY_BYTES = 16 * 1024; // le credenziali occupano poche centinaia di byte

function sendJson(res, status, body, headers = {}) {
  sendResponse(res, {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// Legge il body JSON della richiesta: stream Node (IncomingMessage async
// iterable) oppure req.body già popolato (test/mock). JSON malformato o body
// oltre il cap → throw (gestito dal chiamante come 401).
async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  }
  const decoder = new TextDecoder();
  let raw = '';
  for await (const chunk of req) {
    raw += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
    if (raw.length > MAX_BODY_BYTES) throw new Error('body too large');
  }
  if (raw.trim() === '') return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    // Body illeggibile / JSON malformato → stessa risposta delle credenziali
    // errate: 401, senza dettagli sull'errore di parsing.
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  if (!verifyCredentials(username, password)) {
    logger.warn('login.failed', { username: username.trim() });
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  let issued;
  try {
    issued = await issueAccessToken(username.trim());
  } catch (e) {
    // Config JWT mancante/invalida (es. produzione senza JWT_SECRET): errore
    // interno. Mai dettagli in risposta: potrebbero contenere il segreto.
    logger.error('login.token_issue_error', { error: e });
    sendJson(res, 500, { error: 'internal_error' });
    return;
  }

  logger.info('login.ok', { username: username.trim() });
  sendJson(res, 200, {
    ...issued,
    user: { username: username.trim() },
  });
}
