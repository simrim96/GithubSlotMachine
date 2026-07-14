// ─── Rate Limit Tracking per GitHub API ──────────────────────────────────────
// Traccia X-RateLimit-Remaining e X-RateLimit-Reset dalle risposte GitHub API.
// Fornisce una coda (queue) per serializzare le richieste quando ci si avvicina
// al limite, prevenendo errori 403.
//
// GitHub free tier: 5000 requests/ora (60/min). Quando remaining <= 10, si
// attiva la coda che aspetta fino al reset.
//
// Struttura:
//   • RateLimitTracker: legge e tiene traccia degli headers
//   • RateLimitQueue: coda FIFO che blocca le chiamate quando remaining == 0
//   • Integrazione in ghGet/ghPut per usare la queue automaticamente
//
// Esempio:
//   const tracker = new RateLimitTracker();
//   const queue = new RateLimitQueue(tracker);
//   const result = await queue.add(() => ghGet(token, owner, repo, path));
//
// Tutti i metodi sono puri e testabili tranne le chiamate di rete.

export const GITHUB_RATE_LIMIT_HEADER_REMAINING = 'X-RateLimit-Remaining';
export const GITHUB_RATE_LIMIT_HEADER_RESET = 'X-RateLimit-Reset';
export const GITHUB_RATE_LIMIT_WARNING_THRESHOLD = 10; // Attiva la coda quando remaining <= 10
export const GITHUB_RATE_LIMIT_BLOCK_THRESHOLD = 2; // Blocca quando remaining <= 2

// ─── RateLimitTracker ────────────────────────────────────────────────────────
// Legge gli headers e mantiene lo stato corrente del rate limit.
export class RateLimitTracker {
  constructor() {
    // Valori correnti (aggiornati ad ogni risposta GitHub)
    this.remaining = null;  // X-RateLimit-Remaining
    this.reset = null;      // X-RateLimit-Reset (timestamp epoch secondi)
    
    // Statistiche per monitoraggio
    this.totalRequests = 0;
    this.requestsBlocked = 0;
    this.callsQueued = 0;
  }

  // Aggiorna lo stato dagli headers della risposta GitHub
  // expectedHeaders: true se la risposta era attesa (200/404), false se errore
  updateFromResponse(headers, expectedHeaders = true) {
    const remainingHeader = headers.get(GITHUB_RATE_LIMIT_HEADER_REMAINING);
    const resetHeader = headers.get(GITHUB_RATE_LIMIT_HEADER_RESET);

    if (remainingHeader !== null && remainingHeader !== undefined) {
      this.remaining = parseInt(remainingHeader, 10);
      if (isNaN(this.remaining)) this.remaining = null;
    }

    if (resetHeader !== null && resetHeader !== undefined) {
      this.reset = parseInt(resetHeader, 10);
      if (isNaN(this.reset)) this.reset = null;
    }

    this.totalRequests++;

    // Log warning se ci si avvicina al limite
    if (this.remaining !== null && this.remaining <= GITHUB_RATE_LIMIT_WARNING_THRESHOLD) {
      console.warn(
        `[GitHub Rate Limit] Remaining: ${this.remaining}, Reset at: ${this.formatResetTime()}`
      );
    }

    if (this.remaining !== null && this.remaining <= GITHUB_RATE_LIMIT_BLOCK_THRESHOLD) {
      console.error(
        `[GitHub Rate Limit] CRITICAL: Only ${this.remaining} requests left!`
      );
    }
  }

  // Ritorna true se siamo sotto il threshold di warning
  isBelowWarningThreshold() {
    return this.remaining !== null && this.remaining <= GITHUB_RATE_LIMIT_WARNING_THRESHOLD;
  }

  // Ritorna true se siamo sotto il threshold di blocco
  isBelowBlockThreshold() {
    return this.remaining !== null && this.remaining <= GITHUB_RATE_LIMIT_BLOCK_THRESHOLD;
  }

  // Calcola il tempo di reset (seconds until reset)
  getSecondsUntilReset() {
    if (this.reset === null) return null;
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, this.reset - now);
  }

  // Formatta il tempo di reset in stringa leggibile
  formatResetTime() {
    if (this.reset === null) return 'unknown';
    const date = new Date(this.reset * 1000);
    return date.toLocaleString();
  }

  // Ritorna lo stato attuale per il logging
  getState() {
    return {
      remaining: this.remaining,
      reset: this.reset,
      resetTime: this.formatResetTime(),
      secondsUntilReset: this.getSecondsUntilReset(),
      totalRequests: this.totalRequests,
      requestsBlocked: this.requestsBlocked,
      callsQueued: this.callsQueued,
      isBelowWarningThreshold: this.isBelowWarningThreshold(),
      isBelowBlockThreshold: this.isBelowBlockThreshold(),
    };
  }

  // Resetta lo stato (per test)
  clearState() {
    this.remaining = null;
    this.reset = null;
    this.totalRequests = 0;
    this.requestsBlocked = 0;
    this.callsQueued = 0;
  }
}

// ─── RateLimitQueue ──────────────────────────────────────────────────────────
// Coda FIFO per serializzare le chiamate GitHub API quando ci si avvicina
// al rate limit. Usa il tracker per sapere quando sbloccare la coda.
export class RateLimitQueue {
  constructor(tracker) {
    this.tracker = tracker;
    this.queue = []; // Array di { promise, resolve, reject }
    this.isProcessing = false;
  }

  // Aggiungi una chiamata alla coda. Se il rate limit è libero, la esegue subito.
  // Altrimenti, la mette in coda e aspetta che si sblocchi.
  // FIX: Properly track queue items with wasFromAdd flag to avoid outer promise conflicts
  async add(fn) {
    // Se siamo sotto il threshold di blocco, aspetta fino al reset
    if (this.tracker.isBelowBlockThreshold()) {
      console.warn(
        `[RateLimitQueue] Blocked: ${this.tracker.remaining} requests left. Waiting for reset...`
      );
      this.tracker.requestsBlocked++;
      await this.waitForReset();
    }

    // Crea una promise che eseguirà la funzione e gestirà la coda
    return new Promise((resolve, reject) => {
      (async () => {
        try {
          const result = await fn();
          resolve(result);
          
          // Dopo il successo, processa la coda
          await this.processQueue();
        } catch (err) {
          reject(err);
          
          // Anche in caso di errore, processa la coda (ma logga l'errore)
          console.error('[RateLimitQueue] Error in queued call:', err.message);
          await this.processQueue();
        }
      })();
    });
  }

  // Aspetta che il rate limit si resett (controllo periodico ogni 1s)
  async waitForReset() {
    const checkInterval = 1000; // 1 secondo
    const maxWaitTime = 60 * 1000; // Max 1 minuto
    const startTime = Date.now();

    while (this.tracker.isBelowBlockThreshold()) {
      const elapsed = Date.now() - startTime;
      if (elapsed > maxWaitTime) {
        throw new Error(
          `Rate limit timeout after ${maxWaitTime/1000}s. ` +
          `Remaining: ${this.tracker.remaining}, Reset: ${this.tracker.formatResetTime()}`
        );
      }
      await new Promise(r => setTimeout(r, checkInterval));
    }

    console.log(`[RateLimitQueue] Rate limit restored. Remaining: ${this.tracker.remaining}`);
  }

  // Processa la prossima chiamata in coda
  // FIX: Properly resolve/reject the outer promise from add() when processing queue items
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;

    // Process all queued items, but don't resolve the OUTER promise
    // from add() unless it was this specific item
    while (this.queue.length > 0) {
      const { fn, resolve, reject, wasFromAdd = false } = this.queue.shift();

      try {
        const result = await fn();
        if (wasFromAdd) {
          resolve(result);
        }
      } catch (err) {
        if (wasFromAdd) {
          reject(err);
        }
        console.error('[RateLimitQueue] Queued call failed:', err.message);
      }
    }

    this.isProcessing = false;
  }

  // Ritorna la dimensione della coda (per monitoring)
  get queueLength() {
    return this.queue.length;
  }

  // Espone la coda per i test
  peek() {
    return this.queue[0] || null;
  }

  // Resetta per i test
  reset() {
    this.queue = [];
    this.isProcessing = false;
  }
}

// ─── Factory functions per l'inizializzazione ────────────────────────────────
let _defaultTracker = null;
let _defaultQueue = null;

export function getDefaultTracker() {
  if (!_defaultTracker) {
    _defaultTracker = new RateLimitTracker();
  }
  return _defaultTracker;
}

export function getDefaultQueue() {
  if (!_defaultQueue) {
    _defaultQueue = new RateLimitQueue(getDefaultTracker());
  }
  return _defaultQueue;
}

// Helper per creare un tracker e queue custom (per test isolati)
export function createCustomRateLimitSystem() {
  const tracker = new RateLimitTracker();
  const queue = new RateLimitQueue(tracker);
  return { tracker, queue };
}

// Helper per leggere gli headers da una risposta
export function parseRateLimitHeaders(response) {
  const remaining = response.headers.get(GITHUB_RATE_LIMIT_HEADER_REMAINING);
  const reset = response.headers.get(GITHUB_RATE_LIMIT_HEADER_RESET);
  
  const remainingNum = remaining !== null && remaining !== undefined ? parseInt(remaining, 10) : null;
  const resetNum = reset !== null && reset !== undefined ? parseInt(reset, 10) : null;
  
  return {
    remaining: Number.isNaN(remainingNum) ? null : remainingNum,
    reset: Number.isNaN(resetNum) ? null : resetNum,
  };
}
