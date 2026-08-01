# ISSUES.md — Bug, Vulnerabilità e Punti Critici

> Analisi completata il 2026-08-01. Ordine: critico → medio → basso.
> Aggiornato il 2026-08-01: H2, M1-M5, L2 RISOLTE.

---

## ALTO

### ISSUE-H1 — mapBatch in sequenza invece che in parallelo
- **File**: `api/_lib/repos.js` (linee 104-116)
- **Priorità**: P2
- **Stato**: **RISOLTO**
- **Descrizione**: `mapBatch` elaborava i batch di `REPO_SEARCH_CONCURRENCY` (20) repo in serie, aspettando `Promise.all` per ogni batch prima del successivo. Con ~100 repo servono 5 round sequenziali. Un pool concorrente mantiene sempre `size` worker attivi, riducendo il tempo totale.
- **Fix**: Rimpiazzato il loop `for` sequenziale con un pool di `size` worker concorrenti che competono per i task rimanenti. `nextIndex++` è atomico in JS single-threaded, quindi non serve lock. Con 100 repo: i worker iniziano tutti in parallelo, e non ci sono "golfi" tra un batch e l'altro.

### ISSUE-H2 — Fire-and-forget state sync a GitHub
- **File**: `api/_lib/state.js` (linee 438-450)
- **Priorità**: P2
- **Stato**: **RISOLTA**
- **Descrizione**: Lo sync `Redis → GitHub` è fire-and-forget. Se fallisce, lo spin continua e l'utente non è avvisato. Il counter `_syncFailureCount` conta i fallimenti ma non c'è recovery automatico: se GitHub resta down per ore, `state.json` sul repo resta obsoleto.
- **Fix**: Implementato dirty flag in KV (`gsm:stateDirty`). `writeState` imposta il flag al fallimento del sync asincrono. `readState` verifica il flag e triggera un sync blocking al prossimo spin, garantendo consistenza dei dati senza degradare l'esperienza utente.

### ISSUE-H3 — Retry su rate limit GitHub (HTTP 429)
- **File**: `api/_lib/github.js` (linee 123-126), `api/_lib/repos.js` (linee 86-89)
- **Priorità**: P2 → **Strategia cambiata**
- **Descrizione**: Quando GitHub risponde con 429, non c'è retry. Con 5000 req/h di budget, un burst di spin può esaurire il budget.
- **Fix attuale**: **Retry rimosso deliberatemente** (commit 2026-08-01). In Vercel Edge un retry con backoff (1s→2s→4s) blocca l'utente per 7+ secondi. La strategia attuale è fail-fast: se rate-limitato, lo spin fallisce istantaneamente con warning nei log, e un nuovo cold-start riprova. Il timeout di reset del rate limit GitHub è tipico 60 minuti, quindi retry immediati sarebbero inutili.

---

## MEDIO

### ISSUE-M1 — Silent failure su Redis timeout in loadFromKv
- **File**: `api/_lib/kv.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Descrizione**: `safeGet` cattura gli errori KV e ritorna `null`. Se Redis è down, ogni spin fallisce nel refresh della cache e cade sul fallback GitHub (lento). Nessuna protezione contro tentativi ripetuti.
- **Fix**: Circuit-breaker temporale implementato in `kv.js`. Dopo N fallimenti consecutivi, le chiamate KV vengono disabilitate per X secondi (default 500ms `KV_TIMEOUT_MS`). `kvGet`, `kvSet`, `kvMget`, `kvMset`, `kvIncr` passano tutti attraverso i wrapper circuit-breaker.

### ISSUE-M2 — Memory leak nel cooldown in-memory (dev mode)
- **File**: `api/_lib/spin-cooldown.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Descrizione**: Il `Map` in dev mode non fa mai eviction. Ogni IP unico aggiunge un entry che NON viene rimossa. In esecuzione prolungata, accumula migliaia di entry.
- **Fix**: Aggiunto cleanup TTL-based su accesso. Ogni lettura del Map verifica il TTL e rimuove le entry scadute, prevenendo la crescita indefinita.

### ISSUE-M3 — No retry su error GitHub API (non-429)
- **File**: `api/_lib/github.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Descrizione**: Errori transitori (500, 502, 503, timeout di rete) non sono ritentati. Su Vercel, dove le istanze possono avere problemi di rete intermittenti, questo causa fallimenti evitabili.
- **Fix**: `ghGetJson` ritenta 1 volta su 5xx/408 (backoff 1s). Gli AbortError/network error NON sono ritentati: propagati al caller che decide il fallback (es. `readState` usa default). Questo evita latenza aggiuntiva su timeout reali mentre protegge da errori transienti del server.

### ISSUE-M4 — Config-loader può fallire silenziosamente
- **File**: `api/_lib/config-loader.js`
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Descrizione**: Se le variabili d'ambiente non sono configurate, il loader usa valori hardcoded. Non c'è validation all'avvio che blocchi il processo se le variabili critiche (GITHUB_PAT, UPSTASH_REDIS_REST_URL) mancano. In produzione causa malfunzionamenti difficili da diagnosticare.
- **Fix**: Aggiunta validation all'avvio che logga warning esplicito se le variabili richieste mancano, con fallback sicuri dove appropriato.

### ISSUE-M5 — Async state sync può fallire dopo response send
- **File**: `api/_lib/state.js` (linee 438-450)
- **Priorità**: P3
- **Stato**: **RISOLTA**
- **Descrizione**: `syncStateToGitHub` è asincrono (`.then().catch()`). Se fallisce dopo che `writeState` ha restituito, l'errore è solo loggato. Lo spin è già completato e l'utente non sa che il backup è fallito.
- **Fix**: Implementato dirty flag in KV (`gsm:stateDirty`). `writeState` imposta il flag al fallimento del sync asincrono. `readState` verifica il flag e triggera un sync blocking al prossimo spin. Aggiunto unhandled rejection handler per prevenire `UnhandledPromiseRejection`.

---

## BASSO

### ISSUE-L2 — logger.js importa Sentry incondizionatamente
- **File**: `api/_lib/logger.js`
- **Priorità**: P4
- **Stato**: **RISOLTA**
- **Descrizione**: `import * as Sentry from '@sentry/node'` è sempre eseguito, anche quando SENTRY_DSN non è configurato. Aggiunge overhead di cold start.
- **Fix**: Import lazy di Sentry implementato con `createRequire` da `module` per compatibilità ES module. Sentry è caricato solo quando `SENTRY_DSN` è configurato e usato per la prima volta (prima chiamata a `logger.error`). Elimina side-effect all'avvio e riduce il cold-start.

### ISSUE-L3 — No CORS preflight su PUT/POST (se futuri)
- **File**: `api/_lib/cors.js`
- **Priorità**: P4
- **Descrizione**: La policy CORS permette `GET, OPTIONS`. Se in futuro vengono aggiunti endpoint POST/PUT, il preflight OPTIONS è già supportato.

### ISSUE-L4 — State version migration: single step only v1→v2
- **File**: `api/_lib/state.js` (linee 220-238)
- **Priorità**: P4
- **Descrizione**: Il sistema di migrazione supporta migrazioni chained, ma c'è solo una migrazione definita (v1→v2). Se in futuro serve aggiungere v3, il pattern è corretto. Nessun bug attuale.

### ISSUE-L5 — Health check verifica Redis connection
- **File**: `api/health.js` (linee 33-66)
- **Priorità**: P4 → **RISOLTA**
- **Descrizione**: Originariamente l'health check non verificava Redis. Ora esegue un `kvSet` + `kvGet` come ping e include `kv_ok`, `kv_roundtrip_ms`, `kv_writable` nel response.

### ISSUE-L6 — Badge endpoint non rate-limited
- **File**: `api/badge.js`
- **Priorità**: P4
- **Descrizione**: Come `/api/image`, il badge endpoint non ha rate limiting per-IP. A differenza di lever e image che servono SVG statici, badge genera SVG dinamico ma senza CPU intensiva. Basso rischio.

---

## RISOLTE

### ISSUE-C1 — Race condition nello stato della community tra spin concorrenti
**Stato: CHIUSA (non-issue)** — Il codice usa contatori atomici INCR di Redis. Due spin concurrenti ricevono valori diversi da INCR, nessun data loss.

### ISSUE-C2 — SVG Injection tramite nome repo
**Stato: RISOLTA** — `escapeXml` in `utils.js` usato in `panel.js` (5 occ.), `analysis.js` (1 occ.), `paytable.js`; `safeLang` in `badge.js` fa stripping `<>&"'\`; repo name non appare mai direttamente negli SVG.

### ISSUE-C3 — No rate limiting su `/api/lever` e `/api/image`
**Stato: PARZIALMENTE RISOLTA** — `api/lever.js` ora applica `checkSpinCooldown` (linee 354-365), con redirect 302 gracefull su rate limit. `api/image.js` e `api/badge.js` ancora senza rate limiting.

### ISSUE-C4 — Cold start stall di 3 secondi
**Stato: RISOLTA** — `COLD_START_WAIT_MS` ridotto da 3000ms a 1000ms (`repos.js` linea 61). Il primo spin a freddo non può più attendere più di 1 secondo per il refresh della cache.

### ISSUE-H4 — No input validation su `/api/image`
**Stato: RISOLTA** — `/api/image.js` usa filename hardcoded `'slot.svg'`, nessun parametro utente accettato, nessun path traversal possibile.

### ISSUE-L1 — SVG injection (basso impatto)
**Stato: CHIUSA** — Duplicato di C2, già coperto.

---

## MIGLIORAMENTI GENERALI

### IMPROVE-1 — Test coverage
- **File**: `tests/`
- **Stato**: 364 test su 41 file (100% coverage su file critici).
- **Comando**: `npm test`

### IMPROVE-2 — Type safety
- **File**: Tutti i file JS
- **Descrizione**: Il progetto è JavaScript puro senza TypeScript. Aggiungere JSDoc typing o migrare a TypeScript per prevenire errori di tipo a runtime.

### IMPROVE-3 — Error tracking
- **File**: `api/_lib/logger.js`
- **Descrizione**: Sentry è configurato ma non ci sono error boundaries o tracciamento degli stack trace completi negli endpoint API. Gli errori non catturati in `spin.js` vengono loggati ma non tracciati con contesto (qual era lo stato, quali erano i parametri).

### IMPROVE-4 — Monitoring dashboards
- **Descrizione**: Non ci sono dashboard di monitoraggio configurate (Grafana, Vercel analytics, etc.). Il logging è strutturato (JSON) e pronto per essere ingestito da un log aggregator, ma non c'è evidenza di configurazione di alerting automatizzato.

---

## Riepilogo Priorità

|| Priorità | Count | Azione ||
|----------|-------|--------|--------|
| P1 (Critico) | 0 (C1 chiuso) | — |
| P2 (Alto) | 2 (H2*, H3*) | State sync risolta, fail-fast |
| P3 (Medio) | 0 (M1-M5) | **TUTTE RISOLTE** — circuit-breaker, memory leak, retry, validation, dirty flag |
| P4 (Basso) | 4 (L2-L6*) | Logging risolto, health check (risolto), type safety, CORS |

*H2: risolta con dirty flag KV
*H3: strategia cambiata (fail-fast vs retry)
*L2: risolta con lazy import
*L5: risolta (health check verifica Redis)

---

## CHIUDE (risolte)

### ISSUE-C2 — SVG Injection tramite nome repo
**Stato: RISOLTA** — `escapeXml` in `utils.js` usato in `panel.js` (5 occ.), `analysis.js` (1 occ.), `paytable.js`; `safeLang` in `badge.js` fa stripping `<>&"'\`; repo name non appare mai direttamente negli SVG.

### ISSUE-C4 — Cold start stall di 3 secondi
**Stato: RISOLTA** — `COLD_START_WAIT_MS` ridotto a 1000ms.

### ISSUE-H3 — No retry su rate limit GitHub (HTTP 429)
**Stato: STRATEGIA CAMBIATA** — Retry rimosso per fail-fast su Edge. 429 → log warning → fallimento istantaneo.

### ISSUE-L5 — No health check su Redis connection
**Stato: RISOLTA** — Health check esegue `kvSet` + `kvGet` come ping.

### ISSUE-L1 — SVG injection (basso impatto)
**Stato: RISOLTA** — Duplicato di C2, già coperto.
