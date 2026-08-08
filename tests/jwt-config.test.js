import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';
import {
  getJwtConfig,
  parseDurationSeconds,
  DEV_DEFAULT_SECRET,
  DEFAULT_ALGORITHM,
  DEFAULT_ISSUER,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
} from '../api/_lib/jwt-config.js';

const JWT_ENV_KEYS = [
  'JWT_SECRET',
  'JWT_ALGORITHM',
  'JWT_ISSUER',
  'JWT_ACCESS_TOKEN_TTL',
  'JWT_REFRESH_TOKEN_TTL',
  'NODE_ENV',
];

describe('jwt-config', () => {
  let envSnapshot;

  beforeEach(() => {
    envSnapshot = {};
    for (const key of JWT_ENV_KEYS) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of JWT_ENV_KEYS) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  });

  describe('defaults (dev)', () => {
    test('uses safe dev-only defaults when env is empty', () => {
      const config = getJwtConfig({});
      expect(config.secret).toBe(DEV_DEFAULT_SECRET);
      expect(config.algorithm).toBe(DEFAULT_ALGORITHM);
      expect(config.issuer).toBe(DEFAULT_ISSUER);
      expect(config.accessTokenTtlSeconds).toBe(
        DEFAULT_ACCESS_TOKEN_TTL_SECONDS
      );
      expect(config.refreshTokenTtlSeconds).toBe(
        DEFAULT_REFRESH_TOKEN_TTL_SECONDS
      );
      expect(config.isProduction).toBe(false);
    });

    test('uses dev defaults from process.env when called without args', () => {
      delete process.env.JWT_SECRET;
      const config = getJwtConfig();
      expect(config.secret).toBe(DEV_DEFAULT_SECRET);
    });

    test('returns a frozen object', () => {
      const config = getJwtConfig({});
      expect(Object.isFrozen(config)).toBe(true);
    });
  });

  describe('env override (acceptance: tests can override env vars)', () => {
    test('honours a custom env object', () => {
      const config = getJwtConfig({
        JWT_SECRET: 'my-custom-secret',
        JWT_ALGORITHM: 'HS512',
        JWT_ISSUER: 'my-slot',
        JWT_ACCESS_TOKEN_TTL: '30m',
        JWT_REFRESH_TOKEN_TTL: '30d',
      });
      expect(config.secret).toBe('my-custom-secret');
      expect(config.algorithm).toBe('HS512');
      expect(config.issuer).toBe('my-slot');
      expect(config.accessTokenTtlSeconds).toBe(30 * 60);
      expect(config.refreshTokenTtlSeconds).toBe(30 * 24 * 3600);
    });

    test('honours process.env overrides when called without args', () => {
      process.env.JWT_SECRET = 'from-process-env';
      process.env.JWT_ACCESS_TOKEN_TTL = '5m';
      const config = getJwtConfig();
      expect(config.secret).toBe('from-process-env');
      expect(config.accessTokenTtlSeconds).toBe(300);
    });

    test('trims whitespace around values', () => {
      const config = getJwtConfig({
        JWT_SECRET: '  padded-secret  ',
        JWT_ISSUER: '  padded-issuer  ',
        JWT_ALGORITHM: ' HS384 ',
      });
      expect(config.secret).toBe('padded-secret');
      expect(config.issuer).toBe('padded-issuer');
      expect(config.algorithm).toBe('HS384');
    });

    test('falls back to defaults for empty overrides', () => {
      const config = getJwtConfig({
        JWT_SECRET: 'x',
        JWT_ACCESS_TOKEN_TTL: '',
        JWT_REFRESH_TOKEN_TTL: '   ',
      });
      expect(config.accessTokenTtlSeconds).toBe(
        DEFAULT_ACCESS_TOKEN_TTL_SECONDS
      );
      expect(config.refreshTokenTtlSeconds).toBe(
        DEFAULT_REFRESH_TOKEN_TTL_SECONDS
      );
    });
  });

  describe('production fail-closed', () => {
    test('throws when NODE_ENV=production and JWT_SECRET is missing', () => {
      expect(() => getJwtConfig({ NODE_ENV: 'production' })).toThrow(
        /JWT_SECRET è obbligatorio/
      );
    });

    test('throws when NODE_ENV=production and JWT_SECRET is the dev default', () => {
      expect(() =>
        getJwtConfig({ NODE_ENV: 'production', JWT_SECRET: DEV_DEFAULT_SECRET })
      ).toThrow(/non può essere il default di sviluppo/);
    });

    test('accepts an explicit secret in production', () => {
      const config = getJwtConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-secret-123',
      });
      expect(config.secret).toBe('prod-secret-123');
      expect(config.isProduction).toBe(true);
    });

    test('does not fail-closed outside production', () => {
      const config = getJwtConfig({ NODE_ENV: 'test' });
      expect(config.secret).toBe(DEV_DEFAULT_SECRET);
      expect(config.isProduction).toBe(false);
    });
  });

  describe('parseDurationSeconds', () => {
    test('accepts plain seconds', () => {
      expect(parseDurationSeconds('900', 60, 'X')).toBe(900);
      expect(parseDurationSeconds(120, 60, 'X')).toBe(120);
    });

    test('accepts duration strings with units', () => {
      expect(parseDurationSeconds('15m', 0, 'X')).toBe(900);
      expect(parseDurationSeconds('1h', 0, 'X')).toBe(3600);
      expect(parseDurationSeconds('7d', 0, 'X')).toBe(604800);
      expect(parseDurationSeconds('30s', 0, 'X')).toBe(30);
      expect(parseDurationSeconds('2H', 0, 'X')).toBe(7200);
    });

    test('falls back on empty values', () => {
      expect(parseDurationSeconds(undefined, 42, 'X')).toBe(42);
      expect(parseDurationSeconds('', 42, 'X')).toBe(42);
      expect(parseDurationSeconds(null, 42, 'X')).toBe(42);
    });

    test('rejects invalid durations', () => {
      expect(() => parseDurationSeconds('abc', 60, 'X')).toThrow(/non valido/);
      expect(() => parseDurationSeconds('1x', 60, 'X')).toThrow(/non valido/);
      expect(() => parseDurationSeconds('0', 60, 'X')).toThrow(
        /intero positivo/
      );
      expect(() => parseDurationSeconds('-5', 60, 'X')).toThrow(/non valido/);
      expect(() => parseDurationSeconds('1.5h', 60, 'X')).toThrow(/non valido/);
    });
  });

  describe('algorithm validation', () => {
    test('rejects unsupported algorithms', () => {
      expect(() =>
        getJwtConfig({ JWT_SECRET: 'x', JWT_ALGORITHM: 'NONE' })
      ).toThrow(/non supportato/);
    });

    test('accepts asymmetric algorithms', () => {
      const config = getJwtConfig({ JWT_SECRET: 'x', JWT_ALGORITHM: 'RS256' });
      expect(config.algorithm).toBe('RS256');
    });
  });

  describe('integration with jose', () => {
    test('signs and verifies a token with the configured secret', async () => {
      const config = getJwtConfig({
        JWT_SECRET: 'integration-secret',
        JWT_ISSUER: 'test-issuer',
        JWT_ACCESS_TOKEN_TTL: '15m',
      });
      const key = new TextEncoder().encode(config.secret);
      const nowSeconds = Math.floor(Date.now() / 1000);

      const token = await new SignJWT({ sub: 'user-42' })
        .setProtectedHeader({ alg: config.algorithm })
        .setIssuer(config.issuer)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + config.accessTokenTtlSeconds)
        .sign(key);

      const { payload } = await jwtVerify(token, key, {
        issuer: config.issuer,
        algorithms: [config.algorithm],
      });

      expect(payload.sub).toBe('user-42');
      expect(payload.iss).toBe('test-issuer');
      expect(payload.exp).toBe(nowSeconds + config.accessTokenTtlSeconds);
    });

    test('rejects a token signed with a different secret', async () => {
      const config = getJwtConfig({ JWT_SECRET: 'real-secret' });
      const token = await new SignJWT({ sub: 'x' })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode('wrong-secret'));

      await expect(
        jwtVerify(token, new TextEncoder().encode(config.secret))
      ).rejects.toThrow();
    });
  });
});
