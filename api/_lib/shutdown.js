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
const SHUTDOWN_TIMEOUT_MS =
  parseInt(process.env.SHUTDOWN_TIMEOUT_MS) || DEFAULT_SHUTDOWN_TIMEOUT_MS;
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

// Normalizza un valore sconosciuto (Error o altro) per il log JSON:
// JSON.stringify di un Error produce {}, quindi estraiamo i campi utili.
function toLoggable(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return { value: String(value) };
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
    },
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
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
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

  // Handler per errori non catturati: lo stato del processo è indefinito,
  // quindi logghiamo SEMPRE (anche senza SHUTDOWN_VERBOSE) e terminiamo.
  process.on('uncaughtException', (error) => {
    logger.error('[shutdown] Uncaught exception, terminating process', {
      error: toLoggable(error),
    });
    // Uscita immediata: su file/TTY stderr è sincrono; su pipe POSIX il
    // buffer del kernel accetta la riga prima che exit() chiuda l'fd.
    process.exit(1);
  });

  // Handler per promise non catturate (ISSUE-N11): logghiamo ma NON usciamo.
  // In un runtime serverless un singolo promise dimenticato (librerie terze,
  // fire-and-forget senza catch) non deve buttare giù l'istanza calda e le
  // richieste in volo su di essa: l'istanza sopravvive.
  process.on('unhandledRejection', (reason) => {
    logger.warn('[shutdown] Unhandled promise rejection (instance survives)', {
      reason: toLoggable(reason),
    });
  });

  log(
    `Graceful shutdown handlers registered (timeout: ${SHUTDOWN_TIMEOUT_MS}ms)`
  );
}

// Aspetta la fine di tutte le operazioni in-flight
export async function waitForOperationsToComplete(
  timeoutMs = SHUTDOWN_TIMEOUT_MS
) {
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
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
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
