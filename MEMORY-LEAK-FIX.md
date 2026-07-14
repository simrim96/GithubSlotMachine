# Fix per Memory Leak nei Task Asincroni in Background

## Riepilogo

Questo documento descrive le fix applicate per risolvere i memory leak nei task asincroni in background del progetto GithubSlotMachine.

## Problemi Identificati

### 1. Background Task IIFE senza Cleanup (`api/spin.js`)

**Problema:** La funzione che aggiorna il README in background era un IIFE (Immediately Invoked Function Expression) senza gestione degli errori e senza tracciamento:

```javascript
// CODICE ORIGINALE (BROKEN)
(async () => {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // ... operazioni asincrone
    } catch (e) {
      // ... gestione errori parziale
    }
  }
})();
```

**Problemi:**
- Nessuna Promise rejection handler
- Nessun tracciamento del completamento
- Le promise orfane si accumulano nel tempo
- Non visibili nei log o negli strumenti di monitoring

**Fix Applicato:**

```javascript
// CODICE CORRETTO
const backgroundTaskId = `readme-update-${spinStart}`;
let backgroundTaskCompleted = false;

const updateReadmeBackground = async () => {
  // ... logica completa con try-catch finale
  backgroundTaskCompleted = true;
};

// Start background task with proper error handling and cleanup
updateReadmeBackground()
  .then(() => {
    console.log(`[Background Task ${backgroundTaskId}] Completed successfully`);
  })
  .catch((err) => {
    console.error(`[Background Task ${backgroundTaskId}] Unhandled rejection:`, err.message);
    backgroundTaskCompleted = true;
  });

// Register with Sentry for monitoring
try {
  Sentry.addBreadcrumb({
    category: 'background-task',
    message: `Started ${backgroundTaskId}`,
    level: 'info',
  });
} catch {
  // Sentry might not be initialized, ignore
}
```

**Miglioramenti:**
- ✅ ID univoco per ogni task (basato su `spinStart`)
- ✅ Flag di completamento (`backgroundTaskCompleted`)
- ✅ `.then()` e `.catch()` per gestire tutte le vie di uscita
- ✅ Logging chiaro del completamento/fallimento
- ✅ Breadcrumb su Sentry per visibility

### 2. Race Condition in `processQueue()` (`api/_lib/ratelimit-tracker.js`)

**Problema:** Il metodo `processQueue()` risolveva/ricettava la promise esterna anche per items che non erano nella promise principale:

```javascript
// CODICE ORIGINALE (BROKEN)
async processQueue() {
  // ...
  while (this.queue.length > 0) {
    const { fn, resolve, reject } = this.queue.shift();
    try {
      const result = await fn();
      resolve(result); // ❌ Risolve la promise esterna anche per queue items!
    } catch (err) {
      reject(err); // ❌ Ricetta la promise esterna anche per queue items!
    }
  }
}
```

**Problema:** Se un item in coda falliva, poteva:
1. Rifiutare la promise esterna (che era già stata risolta con successo)
2. Creare race condition tra promise esterne e queue items

**Fix Applicato:**

```javascript
// CODICE CORRETTO
async processQueue() {
  // ...
  while (this.queue.length > 0) {
    const { fn, resolve, reject, wasFromAdd = false } = this.queue.shift();
    
    try {
      const result = await fn();
      if (wasFromAdd) {
        resolve(result); // ✅ Solo se era l'item principale da add()
      }
    } catch (err) {
      if (wasFromAdd) {
        reject(err); // ✅ Solo se era l'item principale da add()
      }
      console.error('[RateLimitQueue] Queued call failed:', err.message);
    }
  }
}
```

**Miglioramenti:**
- ✅ Flag `wasFromAdd` distingue tra item principali e queue items
- ✅ Promise esterna risolta/ricettata SOLO per l'item principale
- ✅ Queue items gestiti in isolamento
- ✅ Errori nei queue items non influenzano la promise esterna

## Testing

### Nuovi Test Aggiunti

File: `tests/background-task.test.js`

Test specifici:
1. `trackSpin non blocca il redirect` - Verifica che le metriche siano non-bloccanti
2. `IIFE background task ha cleanup handlers` - Verifica il pattern corretto
3. `Background task ha ID univoco e flag completion` - Verifica tracciamento
4. `Background task registra breadcrumbs su Sentry` - Verifica visibility
5. `processQueue usa flag wasFromAdd` - Verifica fix del race condition
6. `processQueue non risolve outer promise per items in coda` - Verifica isolamento

### Risultati dei Test

```
Test Files  10 passed (10)
Tests  141 passed (141)
```

Tutti i test esistenti (135) + nuovi test (6) = **141 test passati** ✅

## Impatto sul Performance

### Prima della fix
- Accumulo progressivo di promise orfane
- Memory leak che cresce con il numero di spin
- Errori non tracciati
- Difficile debugging in produzione

### Dopo la fix
- ✅ Promesse gestite correttamente con `.then()` e `.catch()`
- ✅ Tracciamento con ID univoco
- ✅ Logging strutturato
- ✅ Breadcrumb su Sentry per visibility
- ✅ Isolamento completo tra promise esterne e queue items
- ✅ Memory leak prevenuto

## Deployment Notes

Queste fix sono backward-compatible:
- Nessuna modifica alle API pubbliche
- Nessuna modifica ai file di configurazione
- Tutti i test esistenti passano
- Le modifiche sono contenute in:
  - `api/spin.js` (background task cleanup)
  - `api/_lib/ratelimit-tracker.js` (processQueue fix)
  - `tests/background-task.test.js` (nuovi test)

## Monitoraggio in Produzione

Dopo il deployment, monitorare:
1. **Sentry breadcrumbs** per i background task
2. **Console log** con `[Background Task readme-update-...]`
3. **Memory usage** - dovrebbe stabilizzarsi
4. **Numero di promise in sospeso** - dovrebbe essere ~0

## Referenze

- [MDN: Promise.allSettled](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
- [MDN: Immediately Invoked Function Expression](https://developer.mozilla.org/en-US/docs/Glossary/IIFE)
- [Sentry Breadcrumbs](https://docs.sentry.io/platforms/javascript/guides/javascript/environments/node/#breadcrumbs)
