// ─── CORS policy centralizzata (Miglioramento #4, ISSUES.md) ────────────────
//
// NOTA SEC-2: perché usiamo Access-Control-Allow-Origin: * su alcuni endpoint.
//
// Gli endpoint /api/image e /api/lever servono SVG embeddati direttamente in
// una README su github.com/simrim96/simrim96. In quel contesto il browser
// esegue una richiesta cross-origin verso Vercel. L'Origin di quella richiesta
// è "https://github.com" che non è noto a priori quando il server riceve la
// richiesta (e non può essere inserito in una allowlist perché l'owner della
// README può cambiare). Riflettere un origin sconosciuto è inutile e dannoso
// (il browser scarterebbe la risposta).
//
// La soluzione sicura è usare il wildcard '*'. È sicuro perché:
// 1. /api/image e /api/lever servono solo SVG pubblici — nessun dato sensibile.
// 2. Nessuna di queste rotte usa cookie o header Authorization.
// 3. Nessuna rotta espose API che modificano stato (POST/PUT/DELETE).
// 4. Il browser, con '*' + nessuna credenziale, ignora i body nella risposta
//    cross-origin (solo immagini/immagini statiche sono accessibili).
//
// Vedi: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS/Errors/CORSNotSCU
//
// La logica CORS era inline in api/spin.js. Ora è un modulo riusabile così
// tutti gli endpoint API (spin, image, health, lever, ratelimit-status)
// emettono una policy CORS coerente senza duplicazioni (stesso approccio
// della sorgente unica ghHeaders — ISSUE-16).
//
// /api/spin (e gli altri endpoint) sono raggiungibili anche in cross-origin
// (es. embed su github.com). Specifichiamo una policy
// esplicita anziché il wildcard '*' (che sarebbe insicuro su redirect/state
// con credenziali). Gli origin ammessi sono configurabili via env
// ALLOWED_CORS_ORIGINS (CSV), con fallback ai domini noti dell'app. Se
// l'Origin non è fra quelli consentiti, NON emettiamo l'header
// Access-Control-Allow-Origin (il browser blocca la lettura cross-origin ma
// la navigazione diretta funziona).
const CORS_ALLOWED = (
  process.env.ALLOWED_CORS_ORIGINS ||
  'https://github-slot-machine.vercel.app,http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Vero/falso se l'origin è fra quelli consentiti.
function isAllowedOrigin(origin) {
  return Boolean(origin) && CORS_ALLOWED.includes(origin);
}

// Applicala a un handler Vercel nel formato Node/Serverless (req, res).
// Stessa firma di prima: basta chiamare applyCors(req, res) all'inizio
// dell'handler. Il terzo argomento opzionale override i metodi ammessi
// (es. applyCors(req, res, 'POST, OPTIONS') per /api/auth/login). Il quarto
// argomento opzionale override gli header ammessi (es. 'Content-Type,
// Authorization' per endpoint autenticati con Bearer).
function applyCors(
  req,
  res,
  methods = 'GET, OPTIONS',
  allowedHeaders = 'Content-Type'
) {
  const origin = req?.headers?.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
  res.setHeader('Access-Control-Max-Age', '86400');
  // Header di sicurezza generici: riducono la superficie di attacco anche su
  // richieste same-origin (es. click della leva da github.com).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// ── Policy WILDCARD `*` (ISSUE-25) ─────────────────────────────────────────
// Gli endpoint che servono SVG/immagini (api/image.js, api/lever.js) vengono
// embeddati in contesti cross-origin non deterministici (es. una README su
// github.com). In quei casi l'Origin non è noto a
// priori e non può stare in una allowlist: rifletterlo negherebbe richieste
// valide (immagini che non si caricano, leva che non risponde). Per questi
// endpoint serviamo `Access-Control-Allow-Origin: *`, che è sicuro perché la
// slot è un contenuto statico/ pubblico e non espone mai credenziali (niente
// `Access-Control-Allow-Credentials`).
function applyCorsWildcard(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// Variante Web Response (formato `new Response(body, { headers })`) con
// wildcard `*` — usata se in futuro un endpoint immagine passa al formato
// Response anziché (req, res).
function corsHeadersWildcard() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

// Helper per endpoint che usano il formato Web Response (es.
// ratelimit-status.js): ritorna un oggetto header da spargere in
// `new Response(body, { headers })`, così la policy è identica ovunque.
function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (isAllowedOrigin(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

export {
  CORS_ALLOWED,
  isAllowedOrigin,
  applyCors,
  applyCorsWildcard,
  corsHeaders,
  corsHeadersWildcard,
};
