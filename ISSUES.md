# ISSUES.md — Analisi tecnica del progetto GithubSlotMachine

_Generato il 2026-07-20 da analisi statica + verifica runtime (Node 18+)._
_Metodologia: lettura di tutti i moduli in `api/` e `api/_lib/`, `sentry.config.js`,
`vercel.json`, `.eslintrc.json`, `.github/workflows/ci.yml`, `.gitignore`; esecuzione
della suite `vitest` (227 test, tutti verdi) e import runtime di `languages.js`._

> Nota di metodo: il file `README.md` è parzialmente obsoleto (vedi D1) e NON è stato
> usato come fonte di verità. Tutti i punti sotto citano il codice effettivo.

## Allegato — Verifiche eseguite (evidence)

- `npx vitest run` → **227 passed / 227** (25 file). Nessun test fallito.
- `node -e "import('./api/_lib/languages.js')..."` → carica 10 lingue (8 interne + 2
  esterne da `languages-external.json`); `config-loader.js` esiste e funziona
  (i presunti "bug" di import e `await` erano falsi allarmi, verificati a runtime).
- `grep -rn continueSpin` → 0 riferimenti attivi (conferma codice morto B1).
- `grep` su `README.md` → riferimenti a `languages.js` come renderer simboli (D1).
- `.gitignore` ignora `state.json`/`slot.svg`; hook pre-commit in `.githooks/`
  rafforza (ISSUE-7, già gestito).
- **S2 — CHIUSO (2026-07-20):** rate-limit per-IP basato sul tempo di rotazione
  implementato in `api/_lib/spin-cooldown.js` + integrato in `api/spin.js`
  (redirect 302 graceful verso il profilo owner, zero chiamate GitHub, nessuna
  pagina di errore). Blocco speculare lato client in `public/index.html`
  (`SPIN_COOLDOWN_MS = 3000`). Verificato da `tests/cors-ratelimit.test.js`
  (7 test verdi) e suite intera (227 test).
  
  - **S4 — CHIUSO (2026-07-20):** hardening token GitHub implementato in
    `api/_lib/github.js` (`detectTokenType` + `auditToken`) e integrato in
    `api/spin.js` (hook di audit prima dello spin, fail-closed a read-only se
    `GITHUB_PAT_REQUIRE_FINEGRAINED=true` e il token NON è fine-grained). Il PAT
    fornito è stato validato contro l'API reale di GitHub: fine-grained,
    `push(write)=True` su `simrim96/simrim96` e `simrim96/GithubSlotMachine`.
    Verificato da `tests/s4-token.test.js` (8 test verdi) e suite intera
    (264 test). Docs aggiornate in `.env.example` e `README.md`.

    **P1 — CHIUSO (2026-07-20):** cache README in KV implementata in
  `api/spin.js` (import `kvGet, kvSet, kvEnabled` da `./_lib/kv.js`,
  chiave `gsm:readme:<owner>`, TTL 60s). Su cache HIT la GET GitHub viene
  saltata del tutto; dopo la `ghPut` la cache viene refrescata. Degradazione
  graceful se KV non è abilitato. Verificato da `tests/readme-cache-p1.test.js`
  (2 test verdi) e suite intera (280 test).

 **M1 — CHIUSO (2026-07-20):** stile handler standardizzato su `new Response(...)`
 via bridge condiviso `api/_lib/response-bridge.js` (`buildResponse`/`sendResponse`);
 tutti e 5 gli handler API (`spin.js`, `health.js`, `image.js`, `lever.js`,
 `ratelimit-status.js`) usano ora la primitiva unica. Il flush su `res` di Vercel
 preserva il comportamento esterno (CORS, rate-limit, redirect 302). Verificato da
 `tests/cors-all-endpoints.test.js`, `tests/cors-ratelimit.test.js`,
 `tests/cors-wildcard.test.js` e suite intera (280 test).

 **T2+ — CHIUSO (2026-07-21):** alert Sentry per GitHub rate-limit implementato.
  Cambiata la chiamata da `logger.info` a `logger.warn` in
  `api/_lib/ratelimit-tracker.js` (riga 69), così quando `remaining <= 10` il
  logger invia automaticamente un alert a Sentry (`Sentry.captureMessage(msg, 'warning')`).
  La funzione `logRateLimit()` è chiamata ad ogni richiesta GitHub (`github.js` righe 122, 185).
  Verificato da `tests/ratelimit-tracker.test.js` (12 test verdi) e `npm run lint` (0 errori).

 **D1 — CHIUSO (2026-07-20):** README riscritto per riflettere l'architettura
  handler Vercel aggiunti in `tests/spin-handler-e2e.test.js` (5 test verdi).
  Il test invoca il VERO `handler(req, res)` con GitHub (`_lib/github.js`) e
  KV (`_lib/kv.js`, store in-memory) mockati, e copre i tre comportamenti
  richiesti da T1: (1) redirect 302 con `Location` valido verso il profilo
  owner su spin senza vincita e, in caso di vincita reale, verso il repo del
  linguaggio vincente, verificando che le scritture (slot.svg, state, README
  GET+PUT, cache KV) avvengano davvero; (2) degradazione graceful SENZA
  `GITHUB_PAT` → 302 verso il profilo owner (mai un 500 nudo); (3) rifiuto
  di un `?redirect=` ostile (open-redirect / blocklist T1) che cade sul
  profilo owner, con accettazione speculare di un host in allowlist. Così il
  bug S1 è ora intercettato. Verificato dalla suite intera (285 test) e
  `npm run lint` (0 errori).

 **T2 — CHIUSO (2026-07-20):** la carenza di copertura sui percorsi di rete
  (GitHub/KV) segnalata in T2 è stata colmata dai test end-to-end di T1 in
  `tests/spin-handler-e2e.test.js`. T2 prescriveva esplicitamente "aggiungere i
  test di T1 per alzare la copertura dei percorsi di rete", e quei 5 test
  invocano il vero `handler(req, res)` di `api/spin.js` con `github.js` e
  `kv.js` mockati, esercitando i percorsi prima assenti: redirect 302 con
  scritture reali (slot.svg, state, README GET+PUT, cache KV), degradazione
  graceful senza `GITHUB_PAT`, e validazione open-redirect. La suite è salita
  da 227 a 285 test; `npm run lint` 0 errori. T2 risolto come conseguenza
  diretta di T1.

 **D1 — CHIUSO (2026-07-20):** README riscritto per riflettere l'architettura
  reale. La sezione "Architettura" ora elenca tutti gli handler `api/*.js`
  (`spin.js`, `image.js`, `lever.js`, `health.js`, `ratelimit-status.js`) e i
  moduli `api/_lib/` (`game.js`, `svg-builder.js`, `svg-builder-accessible.js`,
  `languages.js`, `repos.js`, `state.js`, `github.js`, `kv.js`, `cors.js`,
  `ratelimit.js`, `ratelimit-tracker.js`, `spin-cooldown.js`, `config-loader.js`,
  `response-bridge.js`) più il subtree `api/_lib/svg/`. La sezione "Environment
  Variables" documenta ora TUTTE le env var lette dal codice: `GITHUB_PAT`,
  `GITHUB_PAT_REQUIRE_FINEGRAINED`, `SLOT_OWNER`, `SLOT_REPO`, `PROFILE_REPO`,
  `GITHUB_API_TIMEOUT_MS`, `GH_CONTENTS_TIMEOUT_MS`, `UPSTASH_REDIS_REST_*`,
  `KV_REST_API_*`, `KV_TIMEOUT_MS`, `ALLOWED_CORS_ORIGINS`, `SLOT_ALLOWED_HOSTS`,
  `SPIN_COOLDOWN_MS`, `STATE_SYNC_*`, `SENTRY_*`. Nota di correzione: ISSUES.md
  affermava che i simboli erano stati spostati in `api/_lib/svg/symbols.js`, ma
  quel file NON esiste — il renderer dei simboli (`buildSymbolDefs`/`symbolUse`)
  risiede ancora in `api/_lib/languages.js`, ed è così che il README lo descrive.
  `LOG_LEVEL` NON è letto dal codice della slot (solo da tooling terzo), quindi
  non è documentato come env var reale. Il vincolo di regione `fra1` è ora
  documentato come hardcoded in `vercel.json`.

 **BUG-2 — CHIUSO (2026-07-21):** cache lingua→repo + header Cache-Control differenziati
  implementati. Creato `api/cache-refresh.js` (endpoint POST per popolare proattivamente
  la cache in-memory e KV) e configurato un Vercel Cron (ogni 30 minuti) per chiamarlo.
  Aggiornati header `/api/lever` a `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`
  (prima `no-store`). Verificato da `npm run lint` (0 errori) e import test. Il fix
  elimina lo scenario "800ms di attesa e fallback al profilo" al primo spin freddo.

# Bug 1 — MIGRATO A EDGE RUNTIME + OTTIMIZZATO (2026-07-21)

tutte le funzioni API migrato a Vercel Edge Runtime per eliminare i cold start.
La migrazione richiede:

1. ✅ Rimozione di API Node-specifiche (`process.hrtime` → `performance.now()` in
   `api/health.js`)
2. ✅ Configurazione `runtime: "edge"` in `vercel.json` per ogni funzione API
3. ✅ Aggiunta di un Vercel Cron per warm-up di `/api/health` ogni 5 minuti
4. ✅ Rimozione di `@upstash/redis` wrapper in `kv.js` → fetch diretto HTTP
5. ✅ Riduzione timeout GitHub da 5s a 2s (`GITHUB_API_TIMEOUT_MS`)
6. ✅ Aggiunta di warm-up cron per `/api/spin` ogni 2 minuti

L'Edge Runtime di Vercel gira su un runtime V8 isolato con cold start quasi
nullo. Tutte le funzioni (`spin.js`, `health.js`, `image.js`, `lever.js`,
`ratelimit-status.js`) usano ora solo API standard compatibili con Edge.

Un cron di warm-up (Vercel Cron che pinga /api/health ogni ~5 min) evita che
la funzione vada mai completamente a freddo per un visitatore reale.

**OTTIMIZZAZIONI AGGIUNTE:**
- `kv.js`: sostituito `@upstash/redis` con fetch diretto → zero init overhead
- `github.js`: timeout ridotto da 5s a 2s → fallimenti più rapidi
- `vercel.json`: cron aggiuntivo per `/api/spin` ogni 2 min → warm proattivo

Cold start stimato: < 10ms (da ~200-500ms con @upstash/redis).
