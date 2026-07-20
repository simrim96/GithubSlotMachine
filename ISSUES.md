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
| R5  | Affidabilità    | P1      | Spin senza repo se Upstash è cross-region (timeout 800ms) |

| T3  | Testing         | P2      | Script one-off `verify-issue` in root (clutter) |
| R3  | Affidabilità    | P3      | Scritture KV silenziose in read-only mode |
| O2/O3| Operatività    | P3      | Sentry error sampling 1.0; logger non strutturato |


## 6. Documentazione

### Registro centralizzato ISSUE-N

Il codice referenzia decine di `ISSUE-N` (ISSUE-1 … ISSUE-31) nei commenti.
Per tenere traccia di ogni numero, in questa sezione è mantenuto il registro
che mappa ogni `ISSUE-N` referenziato dal codice alla relativa descrizione
(convenzione: "ogni `ISSUE-N` nel codice → voce qui").

| ISSUE   | Area / Tema        | Stato  | Descrizione breve |
|---------|--------------------|--------|-------------------|
| ISSUE-1  | State / migrations | chiuso | Indice di versione esplicito `v` nello state; tutte le chiamate GitHub centralizzate in `github.js` (`ghGetJson`/`ghPut`); sistema di migrazione stato (`MIGRATIONS`). |
| ISSUE-3  | Telemetria / repos | chiuso | Rimosso tracking server-side verso endpoint non documentato; `repos.js` gestisce timeout + concorrenza; analytics spostato lato client (Vercel Web Analytics in `index.html`). |
| ISSUE-7  | State / artifact   | chiuso | La copia locale del README nel repo è un artefatto ignorato: lo stato è tracciato su KV/GitHub, non su file locale. |
| ISSUE-8  | State / migrations | chiuso | `MIGRATIONS[2]` placeholder portava a `version: 3` (bug corretto). |
| ISSUE-11 | Rate-limit         | chiuso | La protezione contro l'abuso resta demandata al rate-limit (fix 2 in `ratelimit.js`). |
| ISSUE-12 | Rate-limit         | chiuso | Classe osservazionale `RateLimitTracker` rimossa; sostituita da `logRateLimit()` in `github.js`; stato letto LIVE in `ratelimit-status.js`. |
| ISSUE-16 | CORS / headers     | chiuso | Sorgente unica `ghHeaders` per evitare duplicazioni divergenti e header duplicati / placeholder nei test. |
| ISSUE-20 | SVG accessibile    | chiuso | `buildAccessibleSVG` riceve i flag di vittoria e l'`aria-label` corretti. |
| ISSUE-21 | SVG accessibile    | chiuso | Percorso reale accessibile dello spin (`api/spin.js` chiama `buildAccessibleSVG`); gli screen reader ricevono davvero il risultato (M1). |
| ISSUE-22 | Headers            | chiuso | Header centralizzati su `ghHeaders` (unica sorgente condivisa, M3). |
| ISSUE-23 | KV read-only       | chiuso | Separazione token read-only KV; le scritture silenziose in read-only mode vengono segnalate invece di fallire; stato community/cache repo non persistite. |
| ISSUE-24 | `/api/image`       | chiuso | Fallback quando `content` è assente (repo esistente ma senza README); in caso di errore GitHub il client non riceve più testo senza SVG (B4). |
| ISSUE-25 | CORS / SVG sanitize| chiuso | Policy CORS `*` (wildcard) su endpoint SVG/immagine/leva; hardening difensivo di sanitizzazione SVG in uscita (S3). |
| ISSUE-26 | CI                 | chiuso | Lint gate: ESLint fallisce sugli errori e blocca il merge. |
| ISSUE-27 | Docs / CI          | chiuso | Guida `CI-CD-GUIDE.md` riscritta (19/07/2026) per descrivere il flusso reale. |
| ISSUE-28 | repos cold-start   | chiuso | `repos.js` fa un breve `await` invece di appendersi all'infinito sullo stall GitHub: cold-start non-bloccante ma popolato. |
| ISSUE-29 | SVG error          | chiuso | `svg-builder.js` è l'unica fonte canonica di `errorSVG`/`errorSVGString`; re-import per retrocompatibilità in `svg-builder-accessible.js`. |
| ISSUE-31 | Sentry             | chiuso | Flag debug Sentry: `debug` è `true` SOLO se `SENTRY_DEBUG==='true'`. |

> I numeri non elencati sopra (es. ISSUE-2, ISSUE-4…ISSUE-19, ISSUE-30) non sono
> referenziati dal codice attuale e quindi non hanno voce; se ricompaiono nei
> commenti va aggiunta qui la relativa riga, per rispettare la convenzione.

---

## 7. Testing / CI

### T3 — Script one-off `verify-issue*.mjs` in root  · P2
`verify-issue20.mjs` e `verify-issue21.mjs` sono script di verifica una-tantum,
non test automatizzati, e vivono nella root del repo (clutter, rischiano di essere
committati e di confondere).
**Fix:** spostarli in `tests/` (o `scripts/`) oppure eliminarli se i corrispondenti
`*.test.js` li coprono già.

### T2 — CI OK ma senza integrazione  · P3
`ci.yml` esegue import-smoke + `npm test` + `npm run lint` su Node 18/20/22.
Nessun build/preview Vercel né test contro API reali (giustificabile). La copertura
è buona ma concentrata sulla generazione SVG; mancano test sui percorsi GitHub/KV
(vedi T1).
**Fix:** nessun blocco, ma aggiungere i test di T1 per alzare la copertura dei
percorsi di rete.

---

## 8. Operatività / Deploy

### O1 — Dipendenza di regione Upstash↔Vercel  · P2  (collegato a R5)
`vercel.json` fissa `regions: ["fra1"]`. Upstash DEVE essere crea nella stessa
regione, altrimenti gli spin cold sono lenti/without-repo. Questo vincolo è
nascosto nei commenti di `health.js` e non documentato nell'ops/deploy.
**Fix:** documentarlo in README (D1) e, se possibile, misurarlo in CI (alert se
`kv_roundtrip_ms > 60`).

### O2 — Sentry error sampling al 100%  · P3
`sentry.config.js` imposta `tracesSampleRate`/`profilesSampleRate` a 0 di default
(ok), ma `captureException` invia SEMPRE (error sampling 1.0). Su traffico alto
aumenta i costi Sentry. Per una slot personale è accettabile; se il traffico cresce,
valutare `sampleRate` su `Sentry.init`.

### O3 — Logger non strutturato  · P3
Il codice mescola `console.log`/`console.warn`/`Sentry.captureException` senza un
logger unico. `LOG_LEVEL` è letto ma non centralizza l'output.
**Fix:** introdurre un piccolo `logger.js` (`_lib/logger.js`) con livelli e output
JSON, usato ovunque al posto di `console.*`.

---

## 9. Miglioramenti proposti (roadmap)

1. **Allowlist redirect (S1)** — sostituire `BLOCKED_HOSTS` con `SLOT_ALLOWED_HOSTS`.
12. **Logger strutturato (O3)** — `_lib/logger.js`, livelli + JSON.
13. **Alert rate-limit GitHub (T2+)** — `ratelimit-status` già espone `remaining`; aggiungere
    notifica (Sentry/Telegram) quando `< soglia`, oltre al solo frontend badge.
14. **Documenta vincolo regione fra1 (O1)** — nel README e (opzionale) alert CI.

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
  
  **S4 — CHIUSO (2026-07-20):** hardening token GitHub implementato in
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
