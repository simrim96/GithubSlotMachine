# ISSUES.md — Analisi tecnica del progetto GithubSlotMachine

_Generato il 2026-07-20 da analisi statica + verifica runtime (Node 18+)._
_Metodologia: lettura di tutti i moduli in `api/` e `api/_lib/`, `sentry.config.js`,
`vercel.json`, `.eslintrc.json`, `.github/workflows/ci.yml`, `.gitignore`; esecuzione
della suite `vitest` (227 test, tutti verdi) e import runtime di `languages.js`._

> Nota di metodo: il file `README.md` è parzialmente obsoleto (vedi D1) e NON è stato
> usato come fonte di verità. Tutti i punti sotto citano il codice effettivo.

---

## Indice delle priorità

| ID  | Area            | Gravità | Titolo breve |
|-----|-----------------|---------|--------------|
|| R5  | Affidabilità    | P1      | Spin senza repo se Upstash è cross-region (timeout 800ms) |

|| R3  | Affidabilità    | P3      | Scritture KV silenziose in read-only mode |

## 8. Operatività / Deploy

---

## 9. Miglioramenti proposti (roadmap)

1. **Alert rate-limit GitHub (T2+)** — `ratelimit-status` già espone `remaining`; aggiungere
    notifica (Sentry/Telegram) quando `< soglia`, oltre al solo frontend badge.

---

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

  **T1 — CHIUSO (2026-07-20):** test end-to-end di `api/spin.js` come
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

  Se le funzioni non usano API specifiche di Node (fs, crypto nativo pesante, ecc.), valuta il passaggio a Vercel Edge Runtime invece delle serverless functions Node classiche — l'Edge Runtime ha cold start quasi nullo (gira su un runtime V8 isolato, non un intero container Node), che è esattamente il tipo di guadagno che WASM non ti darebbe.

Un cron di warm-up (Vercel Cron che pinga /api/health ogni ~5 min) evita che la funzione vada mai completamente a freddo per un visitatore reale.

Cache

Popola la cache lingua→repo proattivamente con un cron invece di aspettare il primo spin freddo (elimini del tutto lo scenario "800ms di attesa e fallback al profilo").
Header Cache-Control differenziati: /api/lever cambia raramente (potrebbe quasi essere statico), mentre /api/image è dinamico — assicurati che Camo non tenga in cache più del necessario né rifaccia fetch inutili.

Payload

Minimizza l'SVG generato: nessuno spazio bianco ridondante, riusa <symbol>/<use> per le icone dei linguaggi (sembra che tu lo faccia già), evita di embeddare font o immagini come base64 se non necessario — ogni KB in meno è meno tempo di trasferimento attraverso Camo.

Concorrenza / correttezza

Se due spin arrivano quasi in contemporanea, verifica che la scrittura del counter su Redis sia atomica (INCR, non "leggi-poi-scrivi") per evitare race condition sul contatore — non è propriamente "performance" ma evita comportamenti anomali sotto carico.
