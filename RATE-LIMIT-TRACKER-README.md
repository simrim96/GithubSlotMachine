# GitHub API Rate Limit Tracking & Queue

## Panoramica

Questo modulo implementa un sistema completo di tracciamento e gestione del rate limit per le chiamate API GitHub, prevenendo errori 403 e garantendo il funzionamento affidabile del GithubSlotMachine.

## Problema Risolto

GitHub free tier permette **5000 richieste/ora** (circa 60/min). Quando il limite viene raggiunto, le chiamate restituiscono 403 (Forbidden). Senza gestione corretta, questo interromperebbe completamente lo slot machine.

## Soluzione Implementata

### Componenti Principali

1. **`RateLimitTracker`** - Legge e tiene traccia degli headers `X-RateLimit-Remaining` e `X-RateLimit-Reset` da ogni risposta GitHub API.

2. **`RateLimitQueue`** - Coda FIFO che serializza le chiamate quando ci si avvicina al limite, prevenendo errori 403.

### Soglie Configurabili

- **Warning threshold**: `10` - Attiva la coda quando `remaining <= 10`
- **Block threshold**: `2` - Blocca le richieste quando `remaining <= 2`

### Funzionamento

1. Ogni risposta GitHub aggiorna automaticamente il tracker con gli headers
2. Quando `remaining <= 10`: log warning
3. Quando `remaining <= 2`: 
   - La coda si attiva automaticamente
   - Le nuove chiamate vengono bloccate fino al reset
   - Il tracker registra quanti request sono stati bloccati
4. Dopo il reset, la coda viene processata FIFO

## Integrazione

### In `api/_lib/github.js`

Le funzioni `ghGet()` e `ghPut()` sono già integrate con il sistema:

```javascript
export async function ghGet(token, owner, repo, path) {
  const queue = getDefaultQueue();
  
  return queue.add(async () => {
    return githubCircuitBreaker.call(async () => {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'GithubSlotMachine',
          },
        }
      );
      
      // Traccia i rate limit headers
      getDefaultTracker().updateFromResponse(response);
      
      return response.ok ? await response.json() : null;
    });
  });
}
```

### In `api/spin.js`

Tutte le chiamate a GitHub passano automaticamente attraverso la queue grazie all'integrazione in `ghGet` e `ghPut`.

## API

### `RateLimitTracker`

```javascript
const tracker = new RateLimitTracker();

// Aggiorna dallo response headers
tracker.updateFromResponse(headers, expectedHeaders = true);

// Controllo soglie
tracker.isBelowWarningThreshold();  // true se remaining <= 10
tracker.isBelowBlockThreshold();    // true se remaining <= 2

// Tempo di reset
tracker.getSecondsUntilReset();      // secondi fino al reset
tracker.formatResetTime();           // stringa leggibile

// Stato completo
tracker.getState();                  // oggetto con tutte le metriche

// Reset per test
tracker.clearState();
```

### `RateLimitQueue`

```javascript
const queue = new RateLimitQueue(tracker);

// Aggiungi chiamata alla coda
const result = await queue.add(async () => {
  // La tua chiamata GitHub API
  return await someGitHubCall();
});

// Monitoring
queue.queueLength;   // dimensione coda
queue.peek();        // primo elemento
queue.reset();       // reset per test
```

### Factory Functions

```javascript
// Singleton (usato in produzione)
const tracker = getDefaultTracker();
const queue = getDefaultQueue();

// Isolati per test
const { tracker, queue } = createCustomRateLimitSystem();
```

## Testing

### Esegui tutti i test

```bash
cd /home/simonerimenti/Progetti/GithubSlotMachine
npm test
```

### Test specifici

```bash
# Test ratelimit-tracker (36 test)
npm test -- ratelimit-tracker.test.js

# Test github (24 test - usa il tracker)
npm test -- github.test.js

# Test completi (135 test totali)
npm test
```

## Metriche Monitorate

Il tracker registra:
- `remaining`: richieste rimaste
- `reset`: timestamp di reset
- `totalRequests`: totali chiamate tracciate
- `requestsBlocked`: chiamate bloccate dalla coda
- `callsQueued`: chiamate in coda
- `isBelowWarningThreshold`: stato warning
- `isBelowBlockThreshold`: stato blocco
- `secondsUntilReset`: secondi al reset

## Log Output

### Warning (remaining <= 10)
```
[GitHub Rate Limit] Remaining: 10, Reset at: 15/07/2026, 09:20:00
```

### Critical (remaining <= 2)
```
[GitHub Rate Limit] CRITICAL: Only 2 requests left!
```

### Queue Activation (remaining <= 2)
```
[RateLimitQueue] Blocked: 1 requests left. Waiting for reset...
[RateLimitQueue] Rate limit restored. Remaining: 100
```

## Circuit Breaker

Insieme al `RateLimitQueue`, il `GitHubCircuitBreaker` fornisce ulteriore protezione:
- **Soglia failure**: 3
- **Reset timeout**: 60 secondi
- **Stati**: closed → open → half-open → closed

## Best Practices

1. **Non disabilitare mai il tracker** in produzione
2. **Monitora i log** per vedere quando si attiva la coda
3. **Aumenta il rate limit** se la coda si attiva frequentemente
4. **Considera Upgrade a GitHub Pro** per 50k richieste/ora se necessario

## File Correlati

- `api/_lib/ratelimit-tracker.js` - Implementazione principale
- `tests/ratelimit-tracker.test.js` - Test completi (36 test)
- `api/_lib/github.js` - Integrazione con ghGet/ghPut
- `api/_lib/ratelimit.js` - Rate limiting user-side (1 spin/3s per IP)

## Autori

Implementato per il task Kanban `t_8e5954eb: Reliability: GitHub API Rate Limit Tracking & Queue`.
