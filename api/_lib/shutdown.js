// ─── Graceful Shutdown (Miglioramento M4, ISSUES.md) ───────────────────────────
// Gestione segnali SIGTERM/SIGINT per operazioni long-running in ambiente Vercel.
//
// In ambiente serverless, le istanze possono essere terminate in qualsiasi momento
// durante lo spin (es. riavvio, scaling). Senza gestione dei segnali:
// - Sync Redis→GitHub interrotto → stato inconsistent
// - SVG build incompleto → SVG di degrado servito
// - Connessioni Redis non chiuse correttamente
//
// Questo modulo implementa:
// 1. Tracciamento operazioni in-flight con un counter
// 2. Handler SIGTERM che attende max 5s per finire operazioni
// 3. Handler SIGINT che esce immediatamente (kill forzato)
// 4. Timeout automatico se le operazioni non finiscono in tempo
//
// Uso:
//   import { gracefulShutdown, trackOperation } from './_lib/shutdown.js';
//   trackOperation('spin'); // incrementa counter
//   try { await doSpin(); } finally { trackOperation('done'); } // decrementa
//   gracefulShutdown();     // registra handler e avvia shutdown se necessario
//
// Configurazione:
//   SHUTDOWN_TIMEOUT_MS - Timeout in ms (default: 5000)
//   SHUTDOWN_VERBOSE - Log dettagliato (default: false)

import { logger } from './logger.js';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

// Timeout configurabile via env
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS) || DEFAULT_SHUTDOWN_TIMEOUT_MS;
const SHUTDOWN_VERBOSE = process.env.SHUTDOWN_VERBOSE === 'true';

// Counter per operazioni in-flight
let _inFlightCount = 0;
let _shutdownRequested = false;
let _shutdownResolve = null;
let _shutdownPromise = null;

// Logger interno
function log(msg, ...args) {
  if (SHUTDOWN_VERBOSE) {
    logger.info(`[shutdown] ${msg}`, ...args);
  }
}

// Inizia un'operazione tracciata
export function trackOperation(operationName) {
  _inFlightCount++;
  log(`Operation started: ${operationName} (in-flight: ${_inFlightCount})`);
  
  return {
    end: () => {
      _inFlightCount--;
      log(`Operation ended: ${operationName} (in-flight: ${_inFlightCount})`);
      
      // Se lo shutdown è stato richiesto e non ci sono più operazioni,
      // risolviamo la promise di shutdown
      if (_shutdownRequested && _inFlightCount === 0 && _shutdownResolve) {
        log('All operations complete, resolving shutdown');
        _shutdownResolve();
      }
    }
  };
}

// Inizia il graceful shutdown
export function gracefulShutdown() {
  // Registra gli handler dei segnali una sola volta
  if (global._shutdownHandlersRegistered) return;
  global._shutdownHandlersRegistered = true;
  
  // Crea una promise che risolve quando tutte le operazioni in-flight sono finite
  _shutdownPromise = new Promise((resolve) => {
    _shutdownResolve = resolve;
  });
  
  // Handler SIGTERM: shutdown graduale
  process.on('SIGTERM', async () => {
    log('SIGTERM received, initiating graceful shutdown');
    _shutdownRequested = true;
    
    try {
      // Attendi che le operazioni in-flight finiscano (max SHUTDOWN_TIMEOUT_MS)
      await Promise.race([
        _shutdownPromise,
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
      ]);
      
      log('Graceful shutdown complete, all operations finished');
      process.exit(0);
    } catch (error) {
      log('Error during graceful shutdown:', error.message);
      process.exit(1);
    }
  });
  
  // Handler SIGINT: shutdown immediato (Ctrl+C)
  process.on('SIGINT', () => {
    log('SIGINT received, immediate shutdown');
    process.exit(0);
  });
  
  // Handler per errori non catturati: shutdown immediato
  process.on('uncaughtException', (error) => {
    log('Uncaught exception:', error.message);
    process.exit(1);
  });
  
  // Handler per promise non catturate
  process.on('unhandledRejection', (reason, promise) => {
    log('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
  
  log(`Graceful shutdown handlers registered (timeout: ${SHUTDOWN_TIMEOUT_MS}ms)`);
}

// Aspetta la fine di tutte le operazioni in-flight
export async function waitForOperationsToComplete(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
  if (_inFlightCount === 0) {
    return; // Nessuna operazione in-flight
  }
  
  log(`Waiting for ${_inFlightCount} operations to complete...`);
  
  // Se la promise di shutdown non esiste, creala
  if (!_shutdownPromise) {
    _shutdownPromise = new Promise((resolve) => {
      _shutdownResolve = resolve;
    });
  }
  
  _shutdownRequested = true;
  
  try {
    await Promise.race([
      _shutdownPromise,
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
    log('All operations completed');
  } catch (error) {
    log(`Timeout waiting for operations: ${error.message}`);
    // Continua comunque con lo shutdown
  }
}

// Verifica se lo shutdown è stato richiesto
export function isShutdownRequested() {
  return _shutdownRequested;
}

// Contatore operazioni in-flight (per test)
export function getInFlightCount() {
  return _inFlightCount;
}

// Reset per test
export function resetShutdownState() {
  _inFlightCount = 0;
  _shutdownRequested = false;
  _shutdownResolve = null;
  _shutdownPromise = null;
  global._shutdownHandlersRegistered = false;
}

// Export per testabilità
export const SHUTDOWN_CONFIG = {
  timeoutMs: SHUTDOWN_TIMEOUT_MS,
  verbose: SHUTDOWN_VERBOSE,
};
