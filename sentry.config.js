import * as Sentry from '@sentry/node';

// In @sentry/node v10, `expressIntegration()` is a no-op relic (the SDK relies on
// `httpIntegration()` to instrument the underlying HTTP layer, which is what Vercel
// serverless functions use). It has been removed here to avoid loading the dead
// instrumentation and to silence the 404 polling it previously triggered.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || 'development',

  // Error sampling: default to 10% (0.1) to control costs at scale.
  // Override with SENTRY_ERROR_SAMPLE_RATE (0.0–1.0).
  sampleRate: parseFloat(process.env.SENTRY_ERROR_SAMPLE_RATE ?? '0.1') || 0.1,

  // Read sample rates from env vars instead of hardcoding 1.0.
  // Defaults to 0 (tracing/profiling off) when the vars are not set, so a
  // misconfigured fork doesn't silently send 100% of traffic to Sentry.
  tracesSampleRate:
    parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.0') || 0,
  profilesSampleRate:
    parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.0') || 0,

  release: process.env.npm_package_version || '1.0.0',
  integrations: [Sentry.httpIntegration()],
  // Debug: solo se esplicitamente abilitato via SENTRY_DEBUG, per evitare di
  // inviare eventi/logger a Sentry in locale durante lo sviluppo (ISSUE-31).
  debug: process.env.SENTRY_DEBUG === 'true',
});

export default Sentry;
