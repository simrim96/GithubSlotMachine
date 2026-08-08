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
- **Stato**: **APERTA**
- **Descrizione**: `api/image.js` serve il file `slot.svg` generato. Anche se il file è statico, ogni richiesta carica il filesystem e la rete (se il file è su GitHub/R2). Non c'è cooldown per-IP.
- **Mitigazione**: Il file è cacheato nel browser (GET diretto con nome fisso).
- **Test mancante**: Nessun test per rate limiting su image.

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
- **Stato**: **APERTA**
- **Descrizione**: L'endpoint che interroga GitHub `/rate_limit` per esporre lo stato del rate limit non ha test dedicati. Verifica solo indirettamente attraverso `tests/ratelimit.test.js` e `tests/ratelimit-tracker.test.js`.
- **Test mancante**: Nessun test end-to-end per `GET /api/ratelimit-status`.

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
**Stato: RISOLTA** — `checkSpinCooldown` in `lever.js` (linee 354-365).

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

## MIGLIORAMENTI GENERALI

### IMPROVE-1 — Test coverage
- **File**: `tests/`
- **Stato**: 370 test su 42 file, **tutti passanti**.
- **Comando**: `npm test`
- **Gap principali**: SVG components (`api/_lib/svg/*.js`), `cache-refresh.js`, `ratelimit-status.js`, `languages.js` (copertura minima).

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

| Priorità | Count | Stato | Azione |
|----------|-------|-------|--------|
| P1 (Critico) | 0 | — | — |
| P2 (Alto) | 0 (H1-H3 risolti) | — | — |
| P3 (Medio) | 0 (M1-M5 risolte) | — | — |
| P4 (Basso) | 9 (L2-L10) | 1 aperta | Rate limiting, test SVG, CORS |
| **P1 (Perf)** | 6 (B1-B6) | 0 aperti | **Ottimizzazione lever.js** |

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
**Stato: RISOLTA** — `checkSpinCooldown` in `lever.js` (linee 354-365).

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

| Priorità | Count | Stato | Azione |
|----------|-------|-------|--------|
| P1 (Critico) | 0 | — | — |
| P2 (Alto) | 0 (H1-H3 risolti) | — | — |
| P3 (Medio) | 0 (M1-M5 risolte) | — | — |
| P4 (Basso) | 9 (L2-L10) | 1 aperta | Rate limiting, test SVG, CORS |
| **P1 (Perf)** | 6 (B1-B6) | 0 aperti | **Ottimizzazione lever.js** |

**Totale problemi aperti: 9 (tutti P4) + 6 bottleneck performance da risolvere**

**Piano di ottimizzazione lever.js (stimato)**:
1. Cache linguaggio principale (B1) → **-200/500ms** (impatto maggiore)
2. Doppia chiamata KV cooldown (B2) → **-10ms**
3. INCR+SET separati (B3) → **-10ms**
4. loadFromKv ridondante (B4) → **-5/10ms** ai cold start
5. ReadState migration (B5) → **variabile**
6. Retry ghGetJson su 5xx (B6) → **-1s** in caso di 5xx

**Tempo totale stimato dopo fix: ~100-500ms per spin** (vs ~250-1400ms attuale).
