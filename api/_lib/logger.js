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

import * as Sentry from '@sentry/node';

// Livelli ordinati per priorità
const LEVELS = ['debug', 'info', 'warn', 'error'];

// Legge LOG_LEVEL da环境变量, default 'info'
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase().trim();
const MIN_LEVEL_IDX = LEVELS.indexOf(LOG_LEVEL);
const ENABLED = MIN_LEVEL_IDX >= 0 ? LEVELS.slice(MIN_LEVEL_IDX) : ['info', 'warn', 'error'];

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
  const stream = useError || level === 'error' ? process.stderr : process.stdout;
  stream.write(formatted + '\n');
}

// Fallback a Sentry per warn/error quando configurato
function reportToSentry(level, msg, meta) {
  try {
    if (typeof Sentry !== 'undefined' && Sentry.captureMessage) {
      switch (level) {
        case 'error':
          if (meta?.error) {
            Sentry.captureException(meta.error, { extra: meta });
          } else {
            Sentry.captureMessage(msg, 'error');
          }
          break;
        case 'warn':
          Sentry.captureMessage(msg, 'warning');
          break;
        case 'debug':
          // Sentry ha un livello 'debug', ma di solito non si invia in prod
          if (process.env.VERCEL_ENV !== 'production') {
            Sentry.captureMessage(msg, 'debug');
          }
          break;
        case 'info':
          // Non si invia info a Sentry per default
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

  // Utility: crea un logger pre-configurato con contesto aggiuntivo fisso
  child(context) {
    return {
      debug(msg, meta) {
        this.debug(msg, { ...context, ...meta });
      },
      info(msg, meta) {
        this.info(msg, { ...context, ...meta });
      },
      warn(msg, meta) {
        this.warn(msg, { ...context, ...meta });
      },
      error(msg, meta) {
        this.error(msg, { ...context, ...meta });
      },
    };
  },
};

// Esporta anche il livello corrente per debugging interno
export { LEVELS, LOG_LEVEL, MIN_LEVEL_IDX, ENABLED };
export { logger };
