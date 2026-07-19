// ─── CORS policy centralizzata (Miglioramento #4, ISSUES.md) ────────────────
// La logica CORS era inline in api/spin.js. Ora è un modulo riusabile così
// tutti gli endpoint API (spin, image, health, lever, ratelimit-status)
// emettono una policy CORS coerente senza duplicazioni (stesso approccio
// della sorgente unica ghHeaders — ISSUE-16).
//
// /api/spin (e gli altri endpoint) sono raggiungibili anche in cross-origin
// (es. embed su github.com o fork su altri domini). Specifichiamo una policy
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
// dell'handler.
function applyCors(req, res) {
  const origin = req?.headers?.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Header di sicurezza generici: riducono la superficie di attacco anche su
  // richieste same-origin (es. click della leva da github.com).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
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

export { CORS_ALLOWED, isAllowedOrigin, applyCors, corsHeaders };
