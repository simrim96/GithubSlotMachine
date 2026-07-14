import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || "development",
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
  release: process.env.npm_package_version || "1.0.0",
  integrations: [
    Sentry.httpIntegration(),
    Sentry.expressIntegration(),
  ],
  // Debug: disabilita in produzione
  debug: process.env.NODE_ENV === "development",
});

export default Sentry;
