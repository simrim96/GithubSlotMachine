# ISSUES.md — Bug, Vulnerabilità e Punti Critici

> Analisi completata il 2026-07-31. Ordine: critico → medio → basso.
> Ogni voce ha priorità, file, descrizione e (se presente) riferimento a issue preesistenti nel codice.

---

## CRITICO

### ISSUE-C1 — Race condition nello stato della community tra spin concorrenti
- **File**: `api/_lib/state.js` (linee 384-450), `api/spin.js` (linee 540-570)
- **Priorità**: P1
- **Descrizione**: Due spin concorrenti possono produrre `totalSpins` e `totalWins` doppi. Il flusso è:
  1. `buildGameResult(state, ...)` calcola `newTotalSpins = state.totalSpins + 1`
  2. `writeState(..., stateToSave)` usa Redis `INCR` per incrementare atomicamente
  3. `stateToSave.totalSpins = newTotalSpins` (valore da INCR) sovrascrive

  In teoria INCR è atomico, ma `writeState` riceve `stateToSave` che è un oggetto mutato in-place da `gameResult`. Due richieste concurrenti passano lo stesso `state` a `buildGameResult`, che crea `gameResult = { ...state, ... }` (shallow copy). `writeState` muterebbe lo stesso oggetto, ma il vero problema è: `state` letta da `kvGet` è un oggetto parse, e se due istanze Vercel lo leggono contestualmente, `buildGameResult` calcola `newTotalSpins = state.totalSpins + 1` entrambe. Poi `kvIncr` fa INCR due volte (corretto), ma `stateToSave.totalSpins = newTotalSpins` usa il valore RESTITUITO da INCR (corretto). Quindi in realtà **non c'è data loss** grazie all'uso di INCR.
  
  **Verdetto**: Il codice è corretto grazie ai contatori atomici INCR. **Chiudere come non-issue**.

### ISSUE-C2 — SVG Injection tramite nome repo non sanitizzato
- **File**: `api/_lib/svg/header.js` (linea 7-18), `api/_lib/svg/cabinet.js`, `api/lever.js`
- **Priorità**: P1
- **Descrizione**: Il nome del repo viene inserito direttamente nel testo SVG senza escaping. Se un repo contiene caratteri come `<`, `>`, `&`, il testo SVG risulta corrotto. Inoltre, il `repoName` nel `gameResult` passa attraverso il path:
  `spin.js → buildGameResult → gameResult.repoName → SVG build → state → writeState`
  
  Il nome del repo viene usato nel paytable (`svg/paytable.js`) e nell'header, ma **non viene fatto escaping** dei caratteri XML/HTML. Un repo con nome `foo&bar` genererebbe SVG malformato.
- **Fix**: Aggiungere una funzione di escaping XML prima dell'inserimento nel template SVG.

### ISSUE-C3 — No rate limiting su `/api/lever` e `/api/image`
- **File**: `api/lever.js`, `api/image.js`
- **Priorità**: P2
- **Descrizione**: Il rate limiting per-IP (spin-cooldown.js) è applicato SOLO su `/api/spin`. Gli endpoint `/api/lever` e `/api/image` non hanno alcuna protezione. Un attaccante può:
  1. Chiamare `/api/lever` ripetutamente per ottenere repo diversi
  2. Chiamare `/api/image` per generare SVG diversi
  
  Anche se questi endpoint sono in lettura, un abuso massivo consuma CPU per il rendering SVG e banda per la risposta.
- **Fix**: Applicare lo stesso cooldown di spin-cooldown.js anche a lever e image.

### ISSUE-C4 — Cold start stall di 3 secondi
- **File**: `api/_lib/repos.js` (linee 57-61)
- **Priorità**: P2
- **Descrizione**: `COLD_START_WAIT_MS = 3000` significa che il PRIMO spin dopo un cold start può attendere fino a 3 secondi per il refresh della cache repo. Su Vercel il timeout di default è di 10s, ma questo riduce drasticamente il margine. In combinazione con la fetch GitHub (potenzialmente lenta), lo spin può timeout.
- **Fix**: Ridurre a 1-2 secondi, oppure fare il refresh solo in background senza blocking.

---

## ALTO

### ISSUE-H1 — mapBatch in sequenza invece che in parallelo
- **File**: `api/_lib/repos.js` (linee 91-103)
- **Priorità**: P2
- **Descrizione**: La funzione `mapBatch` è progettata per elaborare i repo in batch di dimensione `REPO_SEARCH_CONCURRENCY` (20) in parallelo. Ma `mapBatch` attende `Promise.all` per ogni batch PRIMA di passare al successivo:

```js
async function mapBatch(items, size, worker) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const settled = await Promise.all(
      slice.map((item, j) => worker(item, i + j))
    );  // ← aspetta TUTTO il batch
    settled.forEach((val, j) => {
      results[i + j] = val;
    });
  }
  return results;
}
```

  Questo è corretto per il CONCURRENCY cap (non più di `size` fetch in parallelo), ma NON è il massimo parallelismo possibile. Se ci sono 100 repo, servono 5 round di 20 in sequenza. Un approccio più performante sarebbe usare un pool concorrente che lancia sempre `size` worker in parallelo, mantenendo il concurrency cap senza sequenzialità dei batch.

### ISSUE-H2 — Fire-and-forget state sync a GitHub
- **File**: `api/_lib/state.js` (linee 426-438)
- **Priorità**: P2
- **Descrizione**: Lo sync `Redis → GitHub` è fire-and-forget. Se fallisce (es. GitHub API down), lo spin continua comunque e l'utente non è avvisato. Il counter di fallimenti (`_syncFailureCount`) conta a livello di modulo, ma non c'è meccanismo di recovery automatico: se GitHub rimane down per ore, `state.json` sul repo resta fermo a un valore vecchio indefinitamente.
- **Fix**: Aggiungere un meccanismo di alert (già parzialmente implementato con `STATE_SYNC_FAILURE_ALERT_THRESHOLD`) e un retry periodico al prossimo spin.

### ISSUE-H3 — No retry su rate limit GitHub (HTTP 429)
- **File**: `api/_lib/github.js`
- **Priorità**: P2
- **Descrizione**: Quando GitHub risponde con HTTP 429, il codice non implementa retry con backoff (solo su 409). Con 5000 req/h di budget, in caso di burst di spin il budget si esaurisce e tutte le chiamate subsequenti falliscono finché il reset timer non scade (può essere fino a un'ora).
- **Fix**: Aggiungere retry con exponential backoff sugli 429, leggendo il `X-RateLimit-Reset` header.

### ISSUE-H4 — No input validation su `/api/image` filename
- **File**: `api/image.js`
- **Priorità**: P2
- **Descrizione**: Se `/api/image` accetta parametri di input (es. `?name=` o simili), non ci sono controlli su path traversal (`../`). Verificare se il parametro `name` (slot.svg) è sanitizzato.
- **Fix**: Validare che il filename non contenga `..`, `/`, o altri caratteri pericolosi.

---

## MEDIO

### ISSUE-M1 — Silent failure su Redis timeout in loadFromKv
- **File**: `api/_lib/repos.js` (linee 30-31)
- **Priorità**: P3
- **Descrizione**: `loadFromKv().catch(...)` fa un warning log ma non impedisce il caricamento. Se Redis è down, ogni spin fa un fallback a GitHub API (lento). Non c'è meccanismo di circuit-breaker: si continua a tentare ogni volta.
- **Fix**: Implementare un circuit-breaker temporale: dopo N fallimenti consecutivi, disabilita Redis per X secondi.

### ISSUE-M2 — Memory leak nel cooldown in-memory (dev mode)
- **File**: `api/_lib/spin-cooldown.js` (linea 47)
- **Priorità**: P3
- **Descrizione**: Il `Map` usato in dev mode non fa mai eviction. Ogni IP unico che richiede uno spin aggiunge un entry che NON viene mai rimossa (solo aggiornata il timestamp). In un ambiente a lunga esecuzione, questo potrebbe accumulare migliaia di entry.
- **Fix**: Aggiungere un TTL-based cleanup o un LRU map.

### ISSUE-M3 — No retry su error GitHub API (non-429)
- **File**: `api/_lib/github.js`
- **Priorità**: P3
- **Descrizione**: Errori transitori (500, 502, 503, timeout di rete) non sono ritentati. Su Vercel, dove le istanze possono avere problemi di rete intermittenti, questo causa fallimenti evitabili.
- **Fix**: Aggiungere retry su errori 5xx con backoff esponenziale.

### ISSUE-M4 — Config-loader può fallire silenziosamente
- **File**: `api/_lib/config-loader.js`
- **Priorità**: P3
- **Descrizione**: Se le variabili d'ambiente non sono configurate, il loader usa valori hardcoded. Non c'è validation all'avvio che blocchi il processo se le variabili critiche (GITHUB_PAT, UPSTASH_REDIS_REST_URL) mancano. In produzione questo causa malfunzionamenti difficili da diagnosticare.
- **Fix**: Aggiungere validation all'avvio che fallisca esplicitamente se le variabili richieste mancano.

### ISSUE-M5 — Async state sync può fallire dopo response send
- **File**: `api/_lib/state.js` (linee 431-438)
- **Priorità**: P3
- **Descrizione**: `syncStateToGitHub` è asincrono (`.then().catch()`). Se fallisce dopo che `writeState` ha già restituito al chiamante, l'errore viene solo loggato. Nel contesto di `spin.js`, lo spin è già completato e l'utente non sa che il backup è fallito.
- **Fix**: Considerare lo stato "dirty" e riprovare al prossimo spin.

---

## BASSO

### ISSUE-L1 — SVG injection tramite nome repo (già in C2, ma basso impatto)
- **File**: `api/_lib/svg/header.js`, `api/_lib/svg/cabinet.js`
- **Priorità**: P3
- **Descrizione**: Il nome del repo viene usato direttamente come testo SVG senza escaping. GitHub repo names sono generalmente sani (alphanumerici + `-`), quindi il rischio è basso nella pratica.

### ISSUE-L2 — logger.js importa Sentry incondizionatamente
- **File**: `api/_lib/logger.js` (linea 18)
- **Priorità**: P4
- **Descrizione**: `import * as Sentry from '@sentry/node'` è sempre eseguito, anche quando SENTRY_DSN non è configurato. Questo aggiunge overhead di cold start.
- **Fix**: Import lazy di Sentry solo quando SENTRY_DSN è presente.

### ISSUE-L3 — No CORS preflight su PUT/POST (se futuri)
- **File**: `api/_lib/cors.js`
- **Priorità**: P4
- **Descrizione**: La policy CORS permette `GET, OPTIONS`. Se in futuro vengono aggiunti endpoint POST/PUT, il preflight OPTIONS è già supportato.

### ISSUE-L4 — State version migration: single step only v1→v2
- **File**: `api/_lib/state.js` (linee 220-238)
- **Priorità**: P4
- **Descrizione**: Il sistema di migrazione supporta migrazioni chained, ma c'è solo una migrazione definita (v1→v2). Se in futuro serve aggiungere v3, il pattern è corretto. Nessun bug attuale.

### ISSUE-L5 — No health check su Redis connection
- **File**: `api/health.js`
- **Priorità**: P4
- **Descrizione**: L'health check non verifica la connettività effettiva a Redis. Potrebbe segnare "healthy" anche se Redis è down.
- **Fix**: Aggiungere un ping Redis all'health check.

### ISSUE-L6 — Badge endpoint non rate-limited
- **File**: `api/badge.js`
- **Priorità**: P4
- **Descrizione**: Come `/api/lever` e `/api/image`, il badge endpoint non ha rate limiting per-IP.

---

## MIGLIORAMENTI GENERALI

### IMPROVE-1 — Test coverage
- **File**: `tests/` (da esplorare)
- **Stato**: Nessuna cartella `tests/` con file `.test.js` o `.spec.js` trovati nel repo.
- **Descrizione**: Non è stato possibile verificare la coverage dei test. Verificare se i test esistono in un'altra configurazione o branch.
- **Azione**: Eseguire `npm test` per verificare la coverage attuale.

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

| Priorità | Count | Azione |
|----------|-------|--------|
| P1 (Critico) | 1 (C1 chiuso, C2 aperto) | SVG injection: fix urgente |
| P2 (Alto) | 4 (C3, C4, H1, H2, H3) | Rate limiting, cold start, retry |
| P3 (Medio) | 5 (M1-M5) | Resilienza, memory leak, validation |
| P4 (Basso) | 4 (L1-L6) | Logging, health check, type safety |
