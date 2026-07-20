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

| T1  | Testing         | P2      | Mancano test end-to-end di `spin.js` con mock KV/GitHub |
| T3  | Testing         | P2      | Script one-off `verify-issue` in root (clutter) |
| D3  | Documentazione | P2      | README non ha registro ISSUE-N centralizzato |
| R3  | Affidabilità    | P3      | Scritture KV silenziose in read-only mode |
| O2/O3| Operatività    | P3      | Sentry error sampling 1.0; logger non strutturato |


## 6. Documentazione

### D3 — Nessun registro centralizzato degli ISSUE-N  · P2
Il codice referenzia decine di `ISSUE-N` (ISSUE-1 … ISSUE-31) nei commenti, ma non
c'è un indice che colleghi ogni numero alla descrizione. Questo file (`ISSUES.md`)
è il candidato naturale, ma va tenuto allineato: ogni nuovo `ISSUE-N` nel codice
dovrebbe avere qui una voce corrispondente.
**Fix:** adottare la convenzione "ogni `ISSUE-N` nel codice → voce in ISSUES.md"
e aggiungere qui le voci mancanti (es. ISSUE-22 header centralizzati, ISSUE-23
read-only KV, ISSUE-26 lint gate, ISSUE-31 Sentry debug).

---

## 7. Testing / CI

### T1 — Mancano test end-to-end di `spin.js`  · P2
La suite copre SVG, KV, state, repos, cors, ratelimit — ma NON `spin.js` come
handler (redirect, graceful fallback senza PAT, validazione `explain`). Il bug S1
non sarebbe intercettato da alcun test.
**Fix:** aggiungere `tests/spin.test.js` con `fetch` mockato (GitHub + KV), che
verifichino: redirect 302 con `Location` valido, fallback SVG quando PAT assente,
rifiuto di `url` in blocklist.

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
6. **Riscrivi README (D3)** — D1 e D2 già fatti; resta D3 (registro ISSUE-N centralizzato).
7. **Test e2e `spin.js` (T1)** — mock GitHub/KV, copre S1.
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
