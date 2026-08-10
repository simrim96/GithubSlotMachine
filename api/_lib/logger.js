// ─── Logger strutturato centralizzato (O3) ─────────────────────────────────────
// Sostituisce console.log/warn/error e Sentry.captureException con un'unica API
// con livelli, output JSON, e fallback elegante a Sentry quando configurato.
//
// Livelli: debug < info < warn < error
// LOG_LEVEL (default 'info'): controlla il livello minimo abilitato.
//
// Uso:
//   const { logger } = require('./logger');
//   logger.debug('dettaglio', { key: 'val' });
//   logger.info('informazione', { user: id });
//   logger.warn('avviso', { reason: e.message });
//   logger.error('errore', { error: e, context: 'xxx' });
//
// Output JSON su stderr (compatibile con i log serverless):
//   { ts, level, msg, ...meta }
//
// FIX ISSUE-L2: import lazy di Sentry — il modulo @sentry/node viene
// caricato SOLO quando SENTRY_DSN è configurato, riducendo il cold-start
// e il bundle quando Sentry non è usato.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Livelli ordinari per priorità
const LEVELS = ['debug', 'info', 'warn', 'error'];

// Legge LOG_LEVEL da环境变量, default 'info'
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase().trim();
const MIN_LEVEL_IDX = LEVELS.indexOf(LOG_LEVEL);
const ENABLED =
  MIN_LEVEL_IDX >= 0 ? LEVELS.slice(MIN_LEVEL_IDX) : ['info', 'warn', 'error'];

function isEnabled(level) {
  return ENABLED.includes(level);
}

function formatLog(level, msg, meta = {}) {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: typeof msg === 'string' ? msg : String(msg),
    ...meta,
  };
  // Rimuove `error` dal meta per includerlo come oggetto completo
  if (record.error && typeof record.error === 'object') {
    record.error = {
      name: record.error.name || 'Error',
      message: record.error.message || String(record.error),
      stack: record.error.stack?.split('\n').slice(0, 3).join(' | '),
    };
  }
  return JSON.stringify(record);
}

function writeOutput(level, formatted, { useError = false } = {}) {
  const stream =
    useError || level === 'error' ? process.stderr : process.stdout;
  stream.write(formatted + '\n');
}

// FIX ISSUE-L2: lazy import di Sentry — caricato SOLO quando necessario.
let _sentryInitialized = false;
let _sentryMod = null;

function _ensureSentry() {
  if (_sentryInitialized) return _sentryMod;
  _sentryInitialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn || dsn.trim() === '') return null;

  try {
    _sentryMod = require('@sentry/node');
    _sentryMod.init({
      dsn,
      tracesSampleRate:
        parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0') || 0,
      profilesSampleRate:
        parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0') || 0,
      defaultEventSampleRate:
        parseFloat(process.env.SENTRY_ERROR_SAMPLE_RATE || '0.1') || 0.1,
      debug: process.env.SENTRY_DEBUG === 'true',
    });
    return _sentryMod;
  } catch {
    // Sentry non installato o errore di init: silenzioso
    return null;
  }
}

// Fallback a Sentry per warn/error quando configurato
function reportToSentry(level, msg, meta) {
  if (level === 'info') return; // info non va su Sentry
  const sentry = _ensureSentry();
  if (!sentry) return;

  try {
    if (typeof sentry !== 'undefined' && sentry.captureMessage) {
      switch (level) {
        case 'error':
          if (meta?.error) {
            sentry.captureException(meta.error, { extra: meta });
          } else {
            sentry.captureMessage(msg, 'error');
          }
          break;
        case 'warn':
          sentry.captureMessage(msg, 'warning');
          break;
        case 'debug':
          if (process.env.VERCEL_ENV !== 'production') {
            sentry.captureMessage(msg, 'debug');
          }
          break;
      }
    }
  } catch {
    // Fallback silenzioso se Sentry fallisce
  }
}

// API pubblica del logger
const logger = {
  debug(msg, meta) {
    if (!isEnabled('debug')) return;
    const formatted = formatLog('debug', msg, meta);
    writeOutput('debug', formatted);
    reportToSentry('debug', msg, meta);
  },

  info(msg, meta) {
    if (!isEnabled('info')) return;
    const formatted = formatLog('info', msg, meta);
    writeOutput('info', formatted);
    reportToSentry('info', msg, meta);
  },

  warn(msg, meta) {
    if (!isEnabled('warn')) return;
    const formatted = formatLog('warn', msg, meta);
    writeOutput('warn', formatted, { useError: true });
    reportToSentry('warn', msg, meta);
  },

  error(msg, meta) {
    if (!isEnabled('error')) return;
    const formatted = formatLog('error', msg, meta);
    writeOutput('error', formatted, { useError: true });
    reportToSentry('error', msg, meta);
  },

  // Utility: crea un logger pre-configurato con contesto aggiuntivo fisso.
  // FIX ISSUE-N3: i metodi chiudono sul logger padre (`logger`) invece di
  // usare `this` — dentro l'object literal `this` è il child stesso e
  // chiamare `this.debug(...)` causava ricorsione infinita (RangeError).
  child(context) {
    return {
      debug(msg, meta) {
        logger.debug(msg, { ...context, ...meta });
      },
      info(msg, meta) {
        logger.info(msg, { ...context, ...meta });
      },
      warn(msg, meta) {
        logger.warn(msg, { ...context, ...meta });
      },
      error(msg, meta) {
        logger.error(msg, { ...context, ...meta });
      },
    };
  },
};

// Esporta anche il livello corrente per debugging interno
export { LEVELS, LOG_LEVEL, MIN_LEVEL_IDX, ENABLED };
export { logger };
