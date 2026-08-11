# ISSUES.md — Bug, Vulnerabilità e Punti Critici

> Analisi completata il 2026-08-02. Ordine: critico → medio → basso.
> Aggiornato il 2026-08-01: H2, M1-M5, L2, L5 RISOLTE.
> Aggiornato il 2026-08-02: H2, M1-M5, L1-L5 RISOLTE.

---

## ALTO

### ISSUE-H1 — mapBatch in sequenza invece che in parallelo

- **File**: `api/_lib/repos.js` (linee 104-116)
- **Priorità**: P2
- **Stato**: **RISOLTA**
- **Descrizione**: `mapBatch` elaborava i batch di `REPO_SEARCH_CONCURRENCY` (20) repo in serie.
- **Fix**: Pool concorrente di `size` worker.

### ISSUE-H2 — Fire-and-forget state sync a GitHub

- **File**: `api/_lib/state.js` (linee 438-450)
- **Priorità**: P2
- **Stato**: **RISOLTA**
- **Fix**: Dirty flag in KV (`gsm:stateDirty`). Sync blocking al prossimo spin.

### ISSUE-H3 — Retry su rate limit GitHub (HTTP 429)

- **File**: `api/_lib/github.js`
- **Priorità**: P2
- **Stato**: **Strategia cambiata**
- **Fix**: Retry rimosso deliberatamente per fail-fast su Edge.

---

## MEDIO

### ISSUE-M1 — Silent failure su Redis timeout

- **File**: `api/_lib/kv.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Fix**: Circuit-breaker temporale dopo N fallimenti consecutivi.

### ISSUE-M2 — Memory leak nel cooldown in-memory

- **File**: `api/_lib/spin-cooldown.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Fix**: Cleanup TTL-based su accesso.

### ISSUE-M3 — No retry su error GitHub API (non-429)

- **File**: `api/_lib/github.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Fix**: `ghGetJson` ritenta 1 volta su 5xx/408.

### ISSUE-M4 — Config-loader validation

- **File**: `api/_lib/config-loader.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Fix**: `validateEnv()` all'import del modulo.

### ISSUE-M5 — Async state sync può fallire dopo response send

- **File**: `api/_lib/state.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Fix**: Dirty flag + sync blocking.

---

## BASSO — PROBLEMI ANCORA APERTI

### ISSUE-L1 — No rate limiting su `/api/badge`

- **File**: `api/badge.js`
- **Priorità**: P4
- **Stato**: **RISOLTA**
- **Descrizione**: Il badge endpoint genera SVG dinamico (linguaggio corrente, statistiche) ma non applica cooldown per-IP. A differenza di `/api/lever` che usa `checkSpinCooldown` (linee 354-365 di `lever.js`), `/api/badge.js` risponde immediatamente a ogni richiesta senza alcun throttling.
- **Rischio**: Basso (badge è leggero), ma in caso di scraping aggressivo contribuisce inutilmente al carico del servizio.
- **Fix**: `api/_lib/badge-cooldown.js` — cooldown per-IP in-memory a 1 secondo. Nessun Redis, nessun impatto su lever.js. `api/badge.js` restituisce 429 con `Retry-After: 1` quando il cooldown è attivo.
- **Test**: `tests/badge-cooldown.test.js` (6 test).

### ISSUE-L2 — No rate limiting su `/api/image`

- **File**: `api/image.js`
- **Priorità**: P4
- **Stato**: **APERTA** (decisione deliberata, 2026-08-09)
- **Descrizione**: `api/image.js` serve il file `slot.svg` generato. Non c'è
  cooldown per-IP: il precedente tentativo (checkSpinCooldown, check-and-set)
  registrava l'IP a ogni GET passivo e faceva rifiutare con 302 silenzioso lo
  spin successivo dello stesso IP (bug t_a81cdf35, "rivedo lo spin precedente").
  Il cooldown è stato RIMOSSO e resta solo su `/api/spin`.
- **Mitigazione**: Il file è servito da KV (nessuna chiamata GitHub nel path
  caldo); il fallback GitHub è contenuto dal circuit-breaker KV e dai rate
  limit GitHub; header `Cache-Control: no-store`.
- **Test mancante**: Nessun test per rate limiting su image (accettato).

### ISSUE-L3 — CORS allowlist hardcoded con un solo dominio

- **File**: `api/_lib/cors.js` (linea ~10)
- **Priorità**: P4
- **Stato**: **APERTA**
- **Descrizione**: La allowlist di origin accetta solo `https://github.com`. Questo è corretto per il deployment attuale (slot su GitHub profile README), ma rende difficile il testing locale (il frontend si serve da localhost) e impedisce deploy su altri domini.
- **Test esistente**: `tests/cors-wildcard.test.js` testa il wildcard `*` ma non il caso allowlist multipla. `tests/cors-all-endpoints.test.js` verifica CORS su tutti gli endpoint.
- **Fix suggerito**: Leggere la allowlist da variabile d'ambiente `CORS_ALLOWED_ORIGINS` (comma-separated, default `https://github.com`).

### ISSUE-L4 — SVG components non testati

- **File**: `api/_lib/svg/*.js`
- **Priorità**: P4
- **Stato**: **APERTA**
- **Descrizione**: La directory `api/_lib/svg/` contiene 8+ componenti SVG (coordinates, effects, panel, reels, screen, paytable, constants, utils) ma non esistono file test dedicati per nessuno di essi. L'unica copertura indiretta viene dai test end-to-end di `svg.test.js` che verificano output SVG completo, ma non testano i singoli componenti in isolamento.
- **Componenti non testati**:
  - `api/_lib/svg/coordinates.js` (coordinate helpers)
  - `api/_lib/svg/effects.js` (win effects)
  - `api/_lib/svg/panel.js` (result panel)
  - `api/_lib/svg/reels.js` (reel animation)
  - `api/_lib/svg/screen.js` (screen frame)
  - `api/_lib/svg/paytable.js` (paytable)
- **Rischio**: Modifiche ai componenti SVG non sono protette da test unitari, aumentando il rischio di regressioni visive.

### ISSUE-L5 — `api/_lib/languages.js` non testato

- **File**: `api/_lib/languages.js`
- **Priorità**: P4
- **Stato**: **APERTA**
- **Descrizione**: `languages.js` (24.181 caratteri, 600+ linee) contiene la definizione di ~30 linguaggi con proprietà color/accent/icon/facts. Non esiste `tests/languages.test.js`. L'unico riferimento è `tests/languages.test.js` che esiste ma testa solo un subset minimo.
- **Test esistente**: `tests/languages.test.js` (4.306 caratteri, test limitati).
- **Rischio**: Cambiamenti alla struttura dei dati linguistici potrebbero rompere il rendering SVG senza essere rilevati.

### ISSUE-L6 — SVG builder accessibilità duplica logica

- **File**: `api/_lib/svg-builder-accessible.js`
- **Priorità**: P4
- **Stato**: **APERTA**
- **Descrizione**: `svg-builder-accessible.js` (6.978 caratteri) duplica gran parte della logica di `svg-builder.js` (13.040 caratteri) per generare versioni SVG accessibili. La duplicazione significa che fix o miglioramenti in uno dei due builder potrebbero non essere riflettuti nell'altro.
- **Rischio**: Divergenza tra SVG standard e accessibile.

### ISSUE-L7 — Client-side cooldown usa sessionStorage (bypassabile)

- **File**: `api/_lib/spin-cooldown.js`
- **Priorità**: P4
- **Stato**: **APERTA** (non un bug, limitazione nota)
- **Descrizione**: Il cooldown client-side usa `sessionStorage` che è cancellato in modalità privacy/incognito o se l'utente cancella i dati del sito. Il server-side cooldown rimane la fonte di verità, quindi il client-side è solo un'ulteriore protezione UX.
- **Test esistente**: `tests/client-spin-cooldown.test.js` (4.918 caratteri) copre il comportamento client-side.

### ISSUE-L8 — No test per `api/_lib/shutdown.js`

- **File**: `api/_lib/shutdown.js`
- **Priorità**: P4
- **Stato**: **APERTA**
- **Descrizione**: Il modulo di graceful shutdown (171 linee) ha un handler di registrazione globale e gestisce segnali SIGTERM/SIGINT. Esiste `tests/shutdown.test.js` ma verifica solo casi base. I percorsi critici (timeout, operazioni in-flight durante shutdown, unhandled rejection) non sono testati approfonditamente.
- **Test esistente**: `tests/shutdown.test.js` (7.132 caratteri, test base).

### ISSUE-L9 — No test per `api/ratelimit-status.js`

- **File**: `api/ratelimit-status.js`
- **Priorità**: P4
- **Stato**: **RISOLTA** (2026-08-10)
- **Descrizione**: L'endpoint che interroga GitHub `/rate_limit` per esporre lo stato del rate limit non ha test dedicati. Verifica solo indirettamente attraverso `tests/ratelimit.test.js` e `tests/ratelimit-tracker.test.js`.
- **Test mancante**: Nessun test end-to-end per `GET /api/ratelimit-status`.
- **Fix**: aggiunto `tests/ratelimit-status-e2e.test.js` (23 test): percentuali
  `percentageUsed` e soglie `status` sul limite reale dal body
  (`resources.core.limit`, 5000 autenticato / 60 anonimo, allineato alla fix
  N10), confini ok/warning/critical, robustezza (header assenti, body
  non-JSON, fetch fallita, reset non numerico) e protocollo (405 non-GET,
  CORS, Bearer su GitHub). La chiamata a GitHub è sempre mockata
  (`vi.stubGlobal('fetch')`). Il primo run dei test ha scoperto un bug reale:
  gli header X-RateLimit-* venivano letti dall'intera response invece che da
  `response.headers` (via `parseRateLimitHeaders`), quindi `remaining`/`reset`
  risultavano sempre `null` → `status` sempre `'unknown'` anche a valle della
  fix N10. Corretto il call-site in `api/ratelimit-status.js`.

### ISSUE-L10 — No test per `api/cache-refresh.js`

- **File**: `api/cache-refresh.js`
- **Priorità**: P4
- **Stato**: **APERTA**
- **Descrizione**: Il cron job che popola la cache lingua→repo non ha test dedicati. La sua logica dipende da GitHub API, KV, e state sync, tutti con comportamenti complessi.
- **Test mancante**: Nessun test per `api/cache-refresh.js`.

---

## RISOLTE

### ISSUE-C1 — Race condition nello stato della community

**Stato: CHIUSA** — Contatori atomici INCR di Redis.

### ISSUE-C2 — SVG Injection tramite nome repo

**Stato: RISOLTA** — `escapeXml` in `utils.js`, `safeLang` in `badge.js`.

### ISSUE-C3 — No rate limiting su `/api/lever`

**Stato: RISOLTA (2026-08-09) — cooldown RIMOSSO per bug t_a81cdf35.**

- **Fix originale**: `checkSpinCooldown` in `lever.js` — ma `checkSpinCooldown` è
  _check-and-set_: un GET passivo registrava l'IP del chiamante, quindi lo spin
  successivo dello stesso IP entro la finestra veniva RIFIUTATO con un 302
  silenzioso verso il profilo → nessuno spin eseguito e l'utente rivedeva il
  risultato precedente ("come se l'svg non venisse aggiornato").
- **Fix attuale**: il cooldown resta SOLO su `/api/spin` (l'unico endpoint che
  esegue un'azione). `/api/lever` e `/api/image` sono GET passivi di asset
  statici: nessun registro IP, nessun 302. L'abuso è già contenuto dal
  circuit-breaker KV e dai rate limit GitHub (vedi ISSUE-L2).

### ISSUE-C4 — Cold start stall di 3 secondi

**Stato: RISOLTA** — `COLD_START_WAIT_MS` ridotto a 1000ms.

### ISSUE-H4 — No input validation su `/api/image`

**Stato: RISOLTA** — Filename hardcoded `'slot.svg'`.

### ISSUE-L1 (vecchio) — SVG injection basso impatto

**Stato: CHIUSA** — Duplicato di C2.

### ISSUE-L2 (vecchio) — logger.js Sentry

**Stato: RISOLTA** — Lazy import di Sentry.

### ISSUE-L5 (vecchio) — No health check Redis

**Stato: RISOLTA** — `kvSet` + `kvGet` nell'health check.

### ISSUE-L6 — kv.js usava endpoint REST Upstash INESISTENTI (Redis mai attivo)

**Stato: RISOLTA** (2026-08-08, fix contatori community).

- **Problema**: `kvGet`/`kvSet`/`kvMget`/`kvMset` chiamavano `/key/{key}` e
  `/db` (con body `{key,value}` / `{keys}` / `{pairs}`). La REST API di
  Upstash NON ha questi endpoint → rispondeva 400 "Command is not
  available: 'DB'/'KEY'". `kvGet` tornava `null` e `kvSet` `false`
  SILENZIOSAMENTE (nessun throw) → **Redis non è mai stato letto né
  scritto in produzione**: tutto passava dal fallback GitHub. L'health
  check diceva `kv_ok: true` solo perché non verificava il round-trip.
- **Fix**: endpoint allineati al formato REST reale (verificato live coi
  probe del 2026-08-08):
  - `GET  {url}/get/{key}`
  - `POST {url}/set/{key}/{value}[/EX/{ttl}]` — valori grandi (slot.svg
    ~54KB) via `POST /pipeline` con body `[[...]]` (risposta `[{result}]`)
  - `GET  {url}/mget/{k1}/{k2}` / `POST {url}/mset/{k1}/{v1}/{k2}/{v2}`
  - `POST {url}/incr/{key}` (già corretto)
- **Health check**: ora `kv_ok` richiede un round-trip reale
  (`kvSet` true + `kvGet` rilegge il valore scritto), con `kv_write_ok`
  esposto e `kv_severity: error` se la scrittura fallisce.
- **Impatto**: i contatori community ora vivono davvero in Redis; il
  sync Redis→GitHub di state.json funziona (fix 422 sha mancante nel
  percorso KV, vedi commit ghPut).

### ISSUE-N6 — /api/cache-refresh mai schedulato (cron inesistente)

**Stato: RISOLTA (2026-08-10)** — Scelta la prima opzione del fix: l'endpoint
resta ed è stato aggiunto il cron.

- Il commento in testa a `api/cache-refresh.js` prometteva un warm-up
  "ogni 30 minuti" che non esisteva: `vercel.json` schedulava solo
  `/api/health` giornaliero, e l'endpoint era POST-only + JWT (i cron Vercel
  fanno GET senza Authorization → 401 garantito).
- **Fix**: cron `GET /api/cache-refresh` ogni 30 minuti (`*/30 * * * *`) in
  `vercel.json`; il GET è autenticato con la env `CRON_SECRET` (Vercel la
  inietta come `Authorization: Bearer <secret>` sui cron job; accettato anche
  l'header `x-cron-secret`, confronto timing-safe via digest SHA-256). Senza
  `CRON_SECRET` il GET risponde 401 fail-closed. Il POST manuale resta
  autenticato con JWT (require-auth).
- **File toccati**: `api/cache-refresh.js`, `vercel.json`, `.env.example`,
  `AGENTS.md`, `README.md`, `tests/cors-all-endpoints.test.js`.
- **Aggiornamento (2026-08-10)**: il cron è stato ridotto a una volta al
  giorno (`0 1 * * *`) perché il piano Hobby di Vercel ammette solo cron con
  frequenza massima giornaliera — `*/30 * * * *` farebbe fallire il deploy.
  `/api/health` (già giornaliero) resta invariato; entrambi i cron sono ora
  entro i limiti Hobby.

### ISSUE-N10 — `ratelimit-status.js`: limite hardcoded 5000 (anonimo = 60)

**Stato: RISOLTA (2026-08-10)** — Il limite reale viene letto dal body.

- `totalLimit` era hardcoded a 5000 in `api/ratelimit-status.js`: senza token
  GitHub il limite reale è 60/h, quindi `percentageUsed` e lo `status`
  (critical ≤2 / warning ≤10 assoluti, calibrati su 5000) erano distorti per
  i client anonimi (es. 55/60 rimasti = 98.9% "usato" fasullo).
- **Fix**: il body di `/rate_limit` (`resources.core.limit`) viene parsato e
  usato come limite reale; fallback difensivo ai limiti documentati (5000 con
  token, 60 anonimo) quando il body non è leggibile. Soglie ora PERCENTUALI:
  warning ≤ 10% del limite, critical ≤ 5% (arrotondati per eccesso);
  `percentageUsed` clampata a 0.
- **Bonus (bug pre-esistente emerso dai test)**: gli header X-RateLimit-* non
  venivano mai letti (`safeGetHeader(response, …)` passava l'intera Response
  invece di `response.headers`) → `remaining`/`status` erano sempre
  `null`/`unknown`. Ora si usa `parseRateLimitHeaders(response)`.
- **Test**: `tests/ratelimit-status-e2e.test.js` (23 test, copertura completa
  del gap ISSUE-L9: percentuali su 5000 e 60, confini 10%/5%, robustezza,
  CORS, Authorization).

---

## MIGLIORAMENTI GENERALI

### IMPROVE-1 — Test coverage

- **File**: `tests/`
- **Stato**: 370 test su 42 file, **tutti passanti**.
- **Comando**: `npm test`
- **Gap principali**: SVG components (`api/_lib/svg/*.js`), `cache-refresh.js`, `languages.js` (copertura minima).

### IMPROVE-2 — Type safety

- **File**: Tutti i file JS
- **Descrizione**: JavaScript puro senza TypeScript. JSDoc typing possibile ma non implementato.

### IMPROVE-3 — Error tracking

- **File**: `api/_lib/logger.js`
- **Descrizione**: Sentry configurato ma senza context tracking negli endpoint API. Errori non catturati in `spin.js` sono loggati ma non tracciati con stato.

### IMPROVE-4 — Monitoring dashboards

- **Descrizione**: Logging strutturato JSON ma nessun dashboard o alerting configurato.

---

## Riepilogo Priorità

| Priorità      | Count             | Stato    | Azione                        |
| ------------- | ----------------- | -------- | ----------------------------- |
| P1 (Critico)  | 0                 | —        | —                             |
| P2 (Alto)     | 0 (H1-H3 risolti) | —        | —                             |
| P3 (Medio)    | 0 (M1-M5 risolte) | —        | —                             |
| P4 (Basso)    | 9 (L2-L10)        | 1 aperta | Rate limiting, test SVG, CORS |
| **P1 (Perf)** | 6 (B1-B6)         | 0 aperti | **Ottimizzazione lever.js**   |

**Totale problemi aperti: 9 (tutti P4)**

---

## LEVER.JS PERFORMANCE — ANALISI E BOTTLENECK (2026-08-02)

> Priorità assoluta: velocità di risposta post-spin. Tutto il resto è secondario.

### Percorso critico attuale (`/api/lever`)

1. Parse input → istantaneo
2. `checkSpinCooldown` → 10ms (Redis round-trip) + 10ms (scrittura cooldown) = **~20ms minimo**
3. `getRepoForLanguage` → 0ms (cache hit) o 1000ms (cold start wait) + 2 letture KV (loadFromKv) = **~10-1000ms**
4. Fetch GitHub Languages API (`/users/{owner}/languages`) → **~200-500ms** (bottleneck principale)
5. `readState` → ~10ms (Redis) o ~800ms (GitHub fallback)
6. `writeState` → 10ms (kvIncr) + 10ms (kvSet) + fire-and-forget = **~20ms**
7. Salvataggio SVG → 10ms (Redis) o 400ms (GitHub fallback)

**Totale stimato: ~250-1400ms** (dipende da cache hit/miss e Redis round-trip)

### 🔴 Bottleneck 1: Cache del linguaggio principale assente

**Problema**: Ogni singolo spin chiama `https://api.github.com/users/{owner}/languages` (righe 86-90 di lever.js). Questo è il singolo call più costoso (200-500ms) e viene ripetuto ad OGNI richiesta. Le lingue di un repo non cambiano mai (o quasi mai).

**Situazione attuale**: La cache `repos.js` cachea solo `linguaggio → repo`, non il risultato della chiamata `/users/{owner}/languages`.

**Fix**: Implementare cache per la chiamata `/users/{owner}/languages` con TTL di 1+ ora (le lingue non cambiano mai). Aggiungere un entry point in-memory + Redis (chiave `gsm:userLanguages:{owner}`) che eviti la chiamata GitHub a ogni spin. Impatto stimato: -200/500ms per spin.

### 🔴 Bottleneck 2: Doppia chiamata KV in `checkSpinCooldown`

**Problema**: `spin-cooldown.js:81-93` esegue `kvGet` (per leggere l'ultimo timestamp) seguito da `kvSet` (per registrare il nuovo timestamp). Due round-trip HTTP a Upstash.

**Fix**: Usare `kvIncr` con un valore timestamp o `kvSet` con valore univoco (es. `ip:timestamp`) e controllare l'errore/conflitto. Alternativamente: un solo `kvSet` che restituisce il valore precedente (se Upstash REST lo supporta con `prev=true`). Impatto stimato: -10ms per spin.

### 🟡 Bottleneck 3: `writeState` con INCR + SET separati

**Problema**: `state.js` eseguiva `kvIncr('gsm:counter:spins')` seguito da `kvSet(STATE_KEY, stateToSave)`. Due operazioni Redis separate per scrivere lo stato.

**Fix**: Calcolare `totalSpins` e `totalWins` localmente (leggere lo stato corrente, incrementare, scrivere). Le race condition sono accettabili per contatori statistici (errore di ±1 spin su 1000 è trascurabile). Un singolo `kvSet` invece di due operazioni. Impatto stimato: -10ms per spin.

**Stato**: **RISOLTA** (2026-08-08, fix contatori community). Il vecchio approccio INCR su chiavi contatore separate (`gsm:counter:spins`/`gsm:counter:wins`) era la causa dei contatori rotti: incrementava `totalWins` a OGNI spin (anche perdenti → `wins == spins`, vedi state.json reale 193/193) e, non avendo seed dallo stato blob, a Redis fresco ripartiva da 1 azzerando lo storico (573 → 1). Ora `writeState` persiste con un singolo `kvSet` lo stato già incrementato dal chiamante (`spin.js`: `totalSpins` +1 sempre, `totalWins` +1 solo su vincita).

### 🟡 Bottleneck 4: `loadFromKv` in `repos.js` a ogni chiamata

**Problema**: `getRepoForLanguage` chiama `loadFromKv()` che fa 2 letture parallele KV (fresh + lastgood). Anche se `kvLoaded=true` previene letture duplicate sul modulo, ogni istanza serverless fredda paga il costo di queste 2 letture.

**Fix**: `kvLoaded` è già un flag a livello di modulo che evita letture duplicate. Il comportamento attuale è già ragionevole. Se si vuole ottimizzare ulteriormente, si potrebbe usare un solo `kvGet` (il tier fresh) e usare lastgood solo come fallback, riducendo a 1 chiamata invece di 2 parallele. Impatto stimato: -5-10ms ai cold start.

### 🟡 Bottleneck 5: `readState` con migrazione possibile

**Problema**: Ogni `readState` (linee 348-398) verifica la versione e potenzialmente esegue la migrazione (che include un `kvSet` aggiuntivo). Questo succede a ogni spin.

**Fix**: La migrazione è necessaria una sola volta al primo spin dopo un aggiornamento dello schema. Dopo di che, ogni lettura è un semplice `kvGet` → istantaneo. Se persiste latenza, verificare che non ci siano letture GitHub non necessarie. Impatto stimato: variabile (dipende se serve migrazione o meno).

### 🟢 Bottleneck 6: `ghGetJson` retry su 5xx/408

**Problema**: `github.js:134-140` ritenta 1 volta su 5xx/408 con backoff di 1 secondo. Nel percorso critico dello spin, se GitHub restituisce 502, lo spin aspetta 1s prima di fallire.

**Fix**: Il retry è già limitato a 1 volta. Nel percorso critico (language fetch), un 502 causerebbe un attesa di ~2s (timeout 2s + retry 1s). Valutare di rimuovere il retry per le chiamate nel percorso critico dello spin. Impatto stimato: -1s in caso di 5xx.

---

## RISOLTE

### ISSUE-C1 — Race condition nello stato della community

**Stato: CHIUSA** — Contatori atomici INCR di Redis.

### ISSUE-C2 — SVG Injection tramite nome repo

**Stato: RISOLTA** — `escapeXml` in `utils.js`, `safeLang` in `badge.js`.

### ISSUE-C3 — No rate limiting su `/api/lever`

**Stato: RISOLTA (2026-08-09) — cooldown RIMOSSO per bug t_a81cdf35.**

- **Fix originale**: `checkSpinCooldown` in `lever.js` — ma `checkSpinCooldown` è
  _check-and-set_: un GET passivo registrava l'IP del chiamante, quindi lo spin
  successivo dello stesso IP entro la finestra veniva RIFIUTATO con un 302
  silenzioso verso il profilo → nessuno spin eseguito e l'utente rivedeva il
  risultato precedente ("come se l'svg non venisse aggiornato").
- **Fix attuale**: il cooldown resta SOLO su `/api/spin` (l'unico endpoint che
  esegue un'azione). `/api/lever` e `/api/image` sono GET passivi di asset
  statici: nessun registro IP, nessun 302. L'abuso è già contenuto dal
  circuit-breaker KV e dai rate limit GitHub (vedi ISSUE-L2).

### ISSUE-C4 — Cold start stall di 3 secondi

**Stato: RISOLTA** — `COLD_START_WAIT_MS` ridotto a 1000ms.

### ISSUE-H4 — No input validation su `/api/image`

**Stato: RISOLTA** — Filename hardcoded `'slot.svg'`.

### ISSUE-L1 (vecchio) — SVG injection basso impatto

**Stato: CHIUSA** — Duplicato di C2.

### ISSUE-L2 (vecchio) — logger.js Sentry

**Stato: RISOLTA** — Lazy import di Sentry.

### ISSUE-L5 (vecchio) — No health check Redis

**Stato: RISOLTA** — `kvSet` + `kvGet` nell'health check.

---

## Riepilogo Priorità

| Priorità      | Count             | Stato    | Azione                        |
| ------------- | ----------------- | -------- | ----------------------------- |
| P1 (Critico)  | 0                 | —        | —                             |
| P2 (Alto)     | 0 (H1-H3 risolti) | —        | —                             |
| P3 (Medio)    | 0 (M1-M5 risolte) | —        | —                             |
| P4 (Basso)    | 9 (L2-L10)        | 1 aperta | Rate limiting, test SVG, CORS |
| **P1 (Perf)** | 6 (B1-B6)         | 0 aperti | **Ottimizzazione lever.js**   |

**Totale problemi aperti: 9 (tutti P4) + 6 bottleneck performance da risolvere**

**Piano di ottimizzazione lever.js (stimato)**:

1. Cache linguaggio principale (B1) → **-200/500ms** (impatto maggiore)
2. Doppia chiamata KV cooldown (B2) → **-10ms**
3. INCR+SET separati (B3) → **-10ms**
4. loadFromKv ridondante (B4) → **-5/10ms** ai cold start
5. ReadState migration (B5) → **variabile**
6. Retry ghGetJson su 5xx (B6) → **-1s** in caso di 5xx

**Tempo totale stimato dopo fix: ~100-500ms per spin** (vs ~250-1400ms attuale).

---

## SPIN A FREDDO — OTTIMIZZAZIONE (2026-08-09)

> Task kanban t_2dd28800: dopo lunga inattività (cold start Vercel + cache scadute) lo spin è lento. Analisi del percorso critico e fix applicati:

**Cosa pesava sullo spin a freddo (in ordine di impatto):**

1. **GET README in serie al percorso critico** — la GET GitHub della README (~150-400ms) partiva solo DOPO la build SVG: su spin a freddo (cache `gsm:readme` TTL 60s scaduta → GET quasi certa) aggiungeva la sua latenza IN SERIE al redirect. **Fix**: la GET è ora anticipata (`readmeGetPromise`, parte subito dopo la lettura dello stato) e si sovrappone a repo lookup + build SVG. Il redirect aspetta solo la PUT (~150-300ms).
2. **Timeout GET README troppo largo** — usava il default `GITHUB_API_TIMEOUT_MS` (2s) pur essendo una lettura di contenuto sul percorso critico. **Fix**: ora usa `GH_CONTENTS_TIMEOUT_MS` (800ms, come state.json) → worst case GET+retry = 2.1s invece di 4.5s (il cap di sicurezza README_TIMEOUT_MS=4s resta come ultima rete).
3. **Preload cache repo rotto (TDZ)** — `loadFromKv()` al caricamento del modulo (repos.js) era chiamata PRIMA della dichiarazione di `kvLoaded` → `ReferenceError: Cannot access 'kvLoaded' before initialization` a OGNI cold start: il preload KV non è mai partito, e il primo `getRepoForLanguage` poteva cascare nel falso cold start (stall GitHub fino a 1s) pur avendo i repo in KV. **Fix**: chiamata spostata dopo le dichiarazioni + dedup della promise in corso (`kvLoadPromise`) così i chiamanti concorrenti attendono la STESSA load.
4. **Sha stale nella cache README (P1)** — dopo una PUT si salvava in cache lo sha PRE-PUT → a ogni cache HIT la PUT falliva con 409 e ghPut rifetchava (GET inutile a ogni spin entro il TTL). **Fix**: `ghPut` ora ritorna lo sha POST-PUT e la cache lo salva → cache HIT = una sola PUT (200 diretto).

**Impatto stimato**: spin a freddo ~-300/400ms tipici (GET fuori dal percorso critico), worst case GitHub lento 4.5s → ~2.1s, e spariti: ReferenceError al boot, GET extra per 409 a ogni cache HIT, falso cold start da 1s quando KV ha i repo.

**Rimasto fuori (valutato, non applicato)**:

- **Keep-warm**: un cron che bussi a `/api/spin` non è proponibile (farebbe spin veri: contatori + PUT README); un endpoint `/api/warm` dedicato richiederebbe un nuovo deploy/cron e su Vercel il keep-warm non garantisce isolati caldi. Si può valutare "Minimum Instances" (piano Pro) se il cold start Vercel (~300-600ms) diventa il collo di bottiglia percepito.
- **Tier "lastgood" per la cache README**: scarteremmo la GET su spin a freddo, ma allargherebbe la finestra di sovrascrittura di edit manuali alla README (ora limitata a 60s di TTL). Non applicato per non cambiare il contratto P1.

---

## CLICK → ROTAZIONE RULLI — VELOCIZZAZIONE (2026-08-09)

> Task kanban t_1754398f: "verificare se possibile velocizzare il caricamento dal click sulla leva all'inizio della rotazione effettiva dei rulli, sia a caldo che a freddo". Misure LIVE su github-slot-machine.vercel.app + fix applicati.

**Misure live (probe + commit GitHub correlati):**

- `/api/spin` (server-side, 4 spin): **2.05-2.35s TTFB** costanti, su 4 istanze diverse (NON è cold start).
- `/api/image` dopo lo spin: 110-190ms (KV serve bene).
- `/api/lever`: 34ms a caldo.
- Correlazione col timestamp dei commit GitHub: la PUT README sul profilo atterra ~1-1.4s dopo lo start; la PUT di backup di slot.svg atterra SOLO in 1 spin su 4 (gli altri sforano il cap di 1.5s e il backup GitHub resta STALE).
- `buildSVG` misurato: ~2ms (il commento M10 "100-500ms" è obsoleto).

**Causa radice del collo di bottiglia**: la PUT di backup di slot.svg su GitHub parte SENZA sha (il percorso KV di `loadSlotSvg` non propaga lo sha GitHub) → GitHub risponde 422 garantito "sha wasn't supplied" → `ghPut` rifetcha → riprova: **3 round trip (PUT+GET+PUT, ~1.2-1.5s)** che sforano `SLOT_SVG_GITHUB_TIMEOUT_MS` (1.5s) e diventano il polo del `Promise.allSettled` pre-redirect. La PUT README (~1s) è il secondo polo.

**Fix applicati:**

1. **`ghPut` GET-first quando sha manca** (api/_lib/github.js): prima PUT(422)→GET→PUT (3 round trip); ora GET dello sha (o 404 → file nuovo) → UNA PUT. Beneficia TUTTI i chiamanti senza sha (backup slot.svg, sync state.json). Niente più 422 garantito a ogni spin.
2. **Sha di slot.svg memoizzato in KV** (`gsm:slotSvg:sha`, scritto da `saveSlotSvg` dopo la PUT di backup, letto da `loadSlotSvg` via `kvMget` in una sola round trip): sul percorso caldo la PUT di backup diventa UNA sola chiamata (~0.5-1s), sotto il polo della PUT README. Se la memoizzazione non atterra, si casca nel GET-first di ghPut (corretto, solo più lento).
3. **`readmeGetPromise` parte PRIMA** (api/spin.js): la GET della README (cache KV → GitHub) ora si sovrappone ANCHE alla lettura di slot.svg+stato, non solo a repo lookup + build.

**Impatto atteso**: spin server-side ~2.1-2.35s → ~1.2-1.5s a caldo (~35-40% in meno); spin a freddo ~1.5-1.7s. In più il backup GitHub di slot.svg atterra a OGNI spin (robustezza: prima 1 su 4).

**Rimasto fuori (non applicato)**:

- Il resto della latenza percepita (redirect → render README su GitHub → Camo → fetch immagine) è fuori dal nostro controllo server-side; la PUT README (~1s) resta il polo inevitabile perché il `?v=` deve stare nel profilo PRIMA che il browser lo renderizzi.
- Cold start Vercel (~300-600ms per richiesta su istanza nuova): infrastruttura, mitigabile solo con Minimum Instances (piano Pro).
- Cooldown KV in 2 round trip (B2): -10ms, non toccato per non cambiare la semantica check-and-set.

---

## SYNC STATE.JSON — MEMOIZZAZIONE SHA (2026-08-10)

> Task kanban t_02838af5 (ISSUES.md §4, osservazione 1): il sync fire-and-forget di state.json su GitHub passava dal GET-first di `ghPut` → 2 round trip per spin. Pattern speculare alla memoizzazione di slot.svg (`gsm:slotSvg:sha`, fix 2026-08-09).

**Fix applicato** (api/_lib/state.js):

- **`gsm:state:sha` memoizzato in KV** (TTL 7gg, come slot.svg): `syncStateToGitHub` lo scrive dopo ogni PUT riuscita (sha POST-PUT ritornato da `ghPut`); `readState` (percorso KV) lo rilegge con `kvMget(STATE_KEY, STATE_SHA_KEY)` in UNA sola round trip e lo propaga a `writeState` → `syncStateToGitHub` → `ghPut`. Sul percorso caldo il sync diventa UNA sola PUT (niente GET-first né 422).
- Se la memoizzazione non atterra (es. Vercel congela il processo prima della kvSet), si casca nel GET-first di ghPut: corretto, solo più lento.
- Su modifica esterna di state.json, lo sha stale produce un 409 che `ghPut` risolve da solo (refetch → PUT) e lo sha nuovo viene rimemoizzato.

**Impatto**: -1 round trip GitHub (~150-300ms) per spin sul sync fire-and-forget (non percepito dall'utente — gira in parallelo al redirect), con guadagno su consumo rate-limit e affidabilità del backup.

---

## /API/IMAGE — SELF-HEAL URL STANTIA + RETRY ANTI-PROPAGAZIONE (2026-08-11)

> Task kanban t_308e49dc: "a volte dopo aver cliccato la leva per un nuovo spin, vedo comunque l'svg precedente".

**Causa radice**: l'immagine è embeddata nel README del profilo con `api/image?v=<spinStart>` come cache-buster verso Camo (il proxy immagini di GitHub, che cachea PER URL — bug t_690b8db0). Quando il README non si è ancora ri-renderizzato dopo lo spin (PUT fallita/timeout, o cache di render di GitHub in ritardo), il browser richiede un `?v` VECCHIO: Camo può servire l'SVG dello spin precedente senza nemmeno raggiungere /api/image. In più, sul path di fallback GitHub, la Contents API può servire la versione PRECEDENTE del file per qualche secondo dopo la PUT (cache CDN non invalidata).

**Fix applicato** (api/image.js):

1. **Self-heal URL stantia**: se la richiesta arriva con un `?v` numerico più vecchio dell'ultimo spin noto (`state.lastPullTimestamp` da KV), /api/image risponde `302` → `/api/image?v=<lastPull>` (Location relativa, `Cache-Control: no-store`). Il client — e Camo, che segue i redirect (CAMO_MAX_REDIRECTS=4) — rifetcha l'URL nuovo e riceve l'SVG dell'ULTIMO spin; la cache Camo dell'URL vecchio converge al contenuto fresco anche se il README resta fermo. Le richieste senza `?v` (curl, embed senza query) restano invariati (200 diretto).
2. **Retry anti-propagazione sul fallback GitHub**: se l'SVG letto dalla Contents API ha `uid < lastPull` (copia sicuramente vecchia) e GitHub è il candidato migliore (uid >= uid KV), rileggiamo UNA volta dopo 700ms (bounded: 1 solo retry, solo sul path di fallback). Completa l'hardening t_a81cdf35, che prima serviva solo la "meno vecchia" delle due copie stale.
3. **`lastPull` letto dallo stato KV indipendentemente dalla presenza dell'SVG in KV** (prima era annidato dentro `if (svg)`): serve a (1) e (2) anche quando la copia KV è assente.

**Test**: +11 test in `tests/image-stale-guard.test.js` (302 su ?v stantio, no-redirect su ?v fresco/assente/non numerico, retry con esito fresco/stale, skip retry quando KV batte GitHub). Suite completa: 708 test verdi, lint pulito, Prettier pulito.

**Limite noto**: se Camo ha già in cache l'URL vecchio, la richiesta non raggiunge /api/image e il 302 non può scattare (la cache Camo converge al fresco al primo MISS successivo). Il caso "README mai aggiornato" resta coperto solo dal prossimo spin (il ?v avanza comunque nel README quando la PUT riesce).

---

## README ?v — AVANZAMENTO GARANTITO A OGNI SPIN (fix t_36b41bcb)

> Task kanban t_36b41bcb: "a volte capita che eseguendo un nuovo spin, l'svg sia
> quello dello spin precedente. Stesso counter, stessa vincita/perdita, stesse
> icone nei rulli. Ogni volta che viene cliccata la leva e fatto partire uno
> spin nuovo l'svg deve essere rigenerato e cambiare rispetto a quello in cache".

**Causa radice**: il README del profilo embedda l'immagine con
`api/image?v=<spinStart>` come cache-buster verso Camo (che cachea PER URL,
bug t_690b8db0). Quando la GET della README falliva (API GitHub lenta oltre
l'800ms stretto, 429 rate limit, timeout), `readmeGetPromise` tornava `null` e
`readmePromise` usciva SUBITO senza fare la PUT → il `?v` nel README restava
fermo all'ultimo spin riuscito → Camo continuava a servire l'SVG dello spin
PRECEDENTE (stesso counter, stessa vincita, stesse icone) senza nemmeno
raggiungere /api/image — quindi il self-heal 302 (t_308e49dc) non poteva
scattare. Il "limite noto" di t_308e49dc ("README mai aggiornato") era
esattamente questo buco.

**Fix applicato** (api/spin.js):

1. **Copia "ultima nota" della README in KV** (`gsm:readme:last-known:<owner>`,
   TTL 7 giorni), scritta a ogni GET riuscita e a ogni PUT riuscita. Quando la
   GET GitHub fallisce, `readmePromise` NON esce più subito: ricade sulla copia
   last-known (il contenuto può essere di qualche minuto fa — il `?v` viene
   comunque riscritto con lo `spinStart` corrente) e fa la PUT. `ghPut` si
   auto-corregge su 409 (sha stale → refetch → PUT). Il `?v` avanza quindi a
   OGNI spin, anche con GitHub lento/429, e Camo riceve sempre un URL nuovo.
   La cache "calda" (60s, per la freschezza e il rilevamento di edit esterni)
   resta invariata.
2. **`README_TIMEOUT_MS` 4s → 6s**: la PUT README ha timeout 2s per tentativo
   con fino a 2 tentativi (+500ms di delay) — il caso peggiore (~4.5s)
   sforava il vecchio cap di 4s e la `Promise.race` scattava col PUT ancora in
   volo → su Vercel il processo veniva congelato appena inviata la risposta →
   il `?v` NON atterrava. Il cap resta un tetto di sicurezza (6s): su GitHub
   veloce la PUT finisce in ~1.5s e il redirect non paga nulla; il cap si tocca
   solo quando GitHub è lento, ed è il caso in cui vogliamo che il `?v`
   atterri comunque.

**Test**: +4 test in `tests/readme-last-known.test.js` (GET fallita + copia
last-known → PUT comunque eseguita con ?v nuovo; GET fallita + nessuna copia →
nessuna PUT ma spin non rotto; GET riuscita → last-known scritta con TTL lungo;
fallback con marker di vincita preservati). Suite completa: 714 test verdi,
lint pulito, Prettier pulito.

**Comportamento residuo**: solo se la GET fallisce E la copia last-known è
assente (primo spin in assoluto con KV vuoto e GitHub giù) il README non viene
aggiornato — niente da scrivere. Con KV attivo la copia viene seminata alla
prima GET/PUT riuscita e poi sopravvive 7 giorni.

---

## BADGE VINCITA — PULSANTE STICKY (2026-08-11)

> Task kanban t_5381abfe: "dopo aver vinto il simbolo qt (è stato rilevato
> vincente) non è comparso il pulsante con il link alla repo".

**Causa radice**: il "pulsante con il link alla repo" è il badge animato nel
README del profilo (`<a href="repo"><img src="/api/badge?v=...&lang=..."/></a>`).
Evidenza di produzione (vincita Qt del 09/08, ts 1786312864697): il badge
veniva scritto correttamente, ma due meccanismi lo facevano sparire subito:

1. **Svuotamento marker a ogni spin** (api/spin.js): `clearReadmeMarkers` +
   `updateReadmeMarkers` giravano a OGNI spin — anche perdenti. La vincita Qt
   alle 22:01:04 è stata seguita da uno spin perdente alle 22:01:12: badge
   svuotato 8 secondi dopo, e il README è rimasto senza pulsante per 12+ ore
   pur avendo `state.lastWin = qt`. Con il delay CSS di 6.5s del badge,
   l'utente non lo vedeva MAI.
2. **Self-validation troppo stretta** (api/badge.js): `isBadgeValidForCurrentSpin`
   invalidava il badge se `lastPull !== lastWin.ts` (spin perdente dopo la
   vincita) o se `?v`/`lang` non combaciavano ESATTAMENTE con `lastWin`
   (GitHub cachea il render del README per minuti: un badge di una vincita
   vera ancora embeddato in un render cacheato veniva servito come SVG vuoto
   appena lo stato avanzava).

**Fix applicato** (badge STICKY — il pulsante rappresenta l'ULTIMA VINCITA,
non l'ultimo spin):

- **api/spin.js**: `clearReadmeMarkers` + `updateReadmeMarkers` vengono
  eseguiti SOLO su spin VINCENTI. Su spin perdenti i marker non vengono
  toccati → il badge dell'ultima vincita resta visibile (il `?v` di
  api/image e api/lever continua ad avanzare a ogni spin).
- **api/badge.js**: `isBadgeValidForCurrentSpin` ora serve il badge se
  `state.lastWin` esiste (una vincita è successa davvero); SVG vuoto solo se
  non c'è MAI stata una vincita. Rimossi i gate su `?v`/`lang` (cache-buster
  e testo, non identità) e su `lastPull` (uno spin perdente non cancella la
  vincita). L'anti-ghost residuo: senza `lastWin` niente pulsante.

**Test**: aggiornati i 2 test che codificavano il vecchio comportamento
(spin perdente → SVG vuoto) + nuovi regression test dello scenario esatto
(vincita Qt → spin perdente → pulsante Qt ancora servito; spin.js non
svuota i marker su spin perdente; su vincita `updateReadmeMarkers` parte).
Suite completa: 710 test verdi, lint pulito, Prettier pulito.

---
