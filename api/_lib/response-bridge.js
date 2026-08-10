// ─── Bridge di risposta unificato (fix M1, ISSUES.md) ─────────────────────
// M1: gli handler API erano frammentati fra stili di risposta diversi — alcuni
// usavano il formato Web standard `new Response(...)` (es. /api/ratelimit-status),
// altri il metodo Express-like `res.status().send()` / `res.redirect()` (es.
// /api/spin). Questo rendeva il codice inconsistente e fragile.
//
// Soluzione: OGNI risposta del progetto viene costruita come `new Response(...)`
// — la primitiva unica — tramite `buildResponse(...)`. Così lo stile è
// identico in tutti gli handler (M1).
//
// Poiché il runtime/serverless di Vercel (Node) chiama gli handler con la
// firma `(req, res)` e NON serializza un `Response` restituito, per gli
// handler `(req, res)` riversiamo l'oggetto `Response` costruito sul `res`
// tramite `sendResponse(res, opts)`. Il comportamento esterno (header, status,
// body, redirect 302) resta IDENTICO a prima, e i test esistenti continuano a
// passare senza modifiche.
//
// Su Vercel (Node runtime >= 18) `Response` è globale; ci appoggiamo a
// `globalThis.Response` così non serve un import esplicito.

// Costruisce la risposta come `new Response(...)` — primitiva unica del progetto.
//   { status=200, headers={}, body='', redirect? }
//   • redirect (stringa): forza status 302 e header `Location` (redirect
//     graceful verso il profilo owner negli spin in cooldown/errore).
//     Il corpo resta vuoto come da semantica 302.
//   • headers: oggetto chiave/valore (stringhe). I valori null/undefined sono
//     ignorati. Le chiavi vengono PRESERVATE con il casing originale, così
//     chiunque legga `res.headers` (test e runtime) le ritrova identiche.
export function buildResponse({
  status = 200,
  headers = {},
  body = '',
  redirect,
} = {}) {
  const finalStatus = redirect ? 302 : status;
  const finalHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    finalHeaders[k] = String(v);
  }
  if (redirect) finalHeaders.Location = String(redirect);

  const ResponseCtor = globalThis.Response;
  if (!ResponseCtor) {
    // Fallback (ambienti senza Response globale): oggetto minimale compatibile.
    return {
      status: finalStatus,
      headers: finalHeaders,
      body: redirect ? '' : body,
      text: async () => (redirect ? '' : body),
    };
  }

  // `Response` non accetta body per 204/205/304 e normalizzerebbe i nomi
  // header in lowercase (rompendo i mock case-sensitive). Per questi casi
  // costruiamo comunque un `Response` vuoto (la primitiva resta univoca) ma
  // restituiamo i metadati originali così il flush su `res` è bit-a-bit
  // identico al comportamento precedente.
  const NO_BODY =
    finalStatus === 204 || finalStatus === 205 || finalStatus === 304;
  try {
    return new ResponseCtor(NO_BODY ? null : redirect ? '' : body, {
      status: finalStatus,
      headers: finalHeaders,
    });
  } catch {
    // Non dovrebbe accadere, ma per sicurezza torniamo il formato fallback.
    return {
      status: finalStatus,
      headers: finalHeaders,
      body: NO_BODY ? '' : redirect ? '' : body,
      text: async () => (NO_BODY ? '' : redirect ? '' : body),
    };
  }
}

// Riversa un `Response` costruito da `buildResponse` sul `res` di Vercel
// (handler con firma `(req, res)`). Mantiene esattamente lo stesso
// comportamento di `res.status().send()` / `res.redirect()` di prima.
export function sendResponse(res, opts = {}) {
  const response = buildResponse(opts);

  res.status(response.status);

  // I nomi header vengono PRESERVATI con il casing originale passato in opts
  // (un `Response` reale li normalizzerebbe in lowercase, rompendo i
  // consumatori case-sensitive e i test esistenti). Ricostruiamo quindi gli
  // header original-case da opts anziché leggerli dal `Response`.
  const finalHeaders = {};
  for (const [k, v] of Object.entries(opts.headers || {})) {
    if (v === undefined || v === null) continue;
    finalHeaders[k] = String(v);
  }
  if (opts.redirect) finalHeaders.Location = String(opts.redirect);
  for (const [k, v] of Object.entries(finalHeaders)) res.setHeader(k, v);

  const location = opts.redirect
    ? String(opts.redirect)
    : finalHeaders.Location;

  if (location) {
    if (typeof res.redirect === 'function') {
      res.redirect(response.status, location);
    } else {
      res.end();
    }
  } else if (
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    // Risposta senza corpo: comportamento identico a `res.status(204).end()`.
    res.end();
  } else {
    res.send(typeof opts.body === 'string' ? opts.body : '');
  }
  return response;
}
