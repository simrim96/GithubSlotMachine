import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Verifica ISSUE-31: `debug` deve essere true SOLO se SENTRY_DEBUG==='true',
// e NON per fallthrough su NODE_ENV==='development'.

const captured = { initArgs: null };

// sentry.config.js fa `import * as Sentry` e accede a Sentry.init / Sentry.httpIntegration
// come named export -> il mock deve esporli come named (non sotto default).
vi.mock('@sentry/node', () => ({
  init: (opts) => { captured.initArgs = opts; },
  httpIntegration: () => ({ name: 'http' }),
}));

const configPath = pathToFileURL(path.resolve('sentry.config.js')).href;

async function loadConfigWithEnv(env) {
  vi.resetModules();
  const saved = {};
  const keys = ['SENTRY_DSN', 'SENTRY_DEBUG', 'NODE_ENV'];
  for (const k of keys) { saved[k] = process.env[k]; }
  for (const k of keys) {
    if (k in env) process.env[k] = env[k];
    else delete process.env[k];
  }
  await import(configPath);
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return captured.initArgs;
}

describe('ISSUE-31: Sentry debug flag', () => {
  beforeEach(() => { captured.initArgs = null; });

  it('NODE_ENV=development + SENTRY_DSN set + SENTRY_DEBUG unset => debug false', async () => {
    const opts = await loadConfigWithEnv({ NODE_ENV: 'development', SENTRY_DSN: 'https://x@y/1' });
    expect(opts.debug).toBe(false);
  });

  it('NODE_ENV=development + SENTRY_DSN set + SENTRY_DEBUG=true => debug true', async () => {
    const opts = await loadConfigWithEnv({ NODE_ENV: 'development', SENTRY_DSN: 'https://x@y/1', SENTRY_DEBUG: 'true' });
    expect(opts.debug).toBe(true);
  });

  it('NODE_ENV=production + SENTRY_DEBUG unset => debug false', async () => {
    const opts = await loadConfigWithEnv({ NODE_ENV: 'production', SENTRY_DSN: 'https://x@y/1' });
    expect(opts.debug).toBe(false);
  });
});
