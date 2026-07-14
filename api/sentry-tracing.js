// Configurazione Sentry per le performance monitoring
import * as Sentry from "@sentry/node";

// Funzione per abilitare il tracing nelle API routes
export function enableTracing() {
  const sampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0');
  
  return Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
    tracesSampleRate: sampleRate,
    profilesSampleRate: 1.0,
    release: process.env.npm_package_version || "1.0.0",
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
  });
}

// Helper per tracciare transazioni
export function startTransaction(name) {
  return Sentry.startTransaction({
    name: name,
    op: 'handler',
  });
}

export function endTransaction(transaction, status = 'ok') {
  if (transaction) {
    transaction.setStatus(status);
    transaction.finish();
  }
}

// Esempio di uso in api/spin.js:
//
// import { startTransaction, endTransaction } from './sentry-tracing.js';
//
// export default async function handler(req, res) {
//   const transaction = startTransaction('spin_handler');
//   try {
//     // ... tua logica
//     await someOperation();
//   } catch (error) {
//     transaction.setStatus('internal_error');
//     throw error;
//   } finally {
//     endTransaction(transaction);
//   }
// }
