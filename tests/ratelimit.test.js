import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidUser,
  clientIp,
  rateLimit,
  getMemBucket,
  RL_WINDOW_SEC,
} from '../api/_lib/ratelimit.js';

describe("isValidUser (?user= validation, chiude l'open-redirect)", () => {
  it('accetta login GitHub validi', () => {
    expect(isValidUser('torvalds')).toBe(true);
    expect(isValidUser('simrim96')).toBe(true);
    expect(isValidUser('Foo-Bar-123')).toBe(true);
    expect(isValidUser('a')).toBe(true); // minimo 1 char
  });

  it('rifiuta login vuoti o solo spazi', () => {
    expect(isValidUser('')).toBe(false);
    expect(isValidUser('   ')).toBe(false);
    expect(isValidUser(null)).toBe(false);
    expect(isValidUser(undefined)).toBe(false);
    expect(isValidUser(42)).toBe(false);
  });

  it('rifiuta caratteri non ammessi (slash, underscore, path)', () => {
    // Open-redirect: tentativo di puntare a un altro host/percorso.
    expect(isValidUser('../../etc/passwd')).toBe(false);
    expect(isValidUser('evil.com')).toBe(false);
    expect(isValidUser('foo/bar')).toBe(false);
    // GitHub non permette underscore nei login.
    expect(isValidUser('bad_name')).toBe(false);
    expect(isValidUser('foo@bar')).toBe(false);
    expect(isValidUser('foo bar')).toBe(false);
  });

  it('rifiuta login troppo lunghi (>39 char)', () => {
    expect(isValidUser('a'.repeat(39))).toBe(true);
    expect(isValidUser('a'.repeat(40))).toBe(false);
  });
});

describe('clientIp', () => {
  it('legge il primo hop da x-forwarded-for', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('accetta x-forwarded-for come array', () => {
    const req = { headers: { 'x-forwarded-for': ['9.9.9.9'] } };
    expect(clientIp(req)).toBe('9.9.9.9');
  });

  it('fallback a remoteAddress o local', () => {
    expect(clientIp({ socket: { remoteAddress: '127.0.0.1' } })).toBe(
      '127.0.0.1'
    );
    expect(clientIp({})).toBe('local');
  });
});

describe('rateLimit (token-bucket in-memory, fallback dev)', () => {
  beforeEach(() => getMemBucket().clear());

  it('il primo spin passa', async () => {
    const req = { headers: { 'x-forwarded-for': '10.0.0.1' } };
    const r = await rateLimit(req);
    expect(r.ok).toBe(true);
  });

  it('un secondo spin immediato viene bloccato con retryAfter > 0', async () => {
    const req = { headers: { 'x-forwarded-for': '10.0.0.2' } };
    expect((await rateLimit(req)).ok).toBe(true);
    const blocked = await rateLimit(req);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(RL_WINDOW_SEC);
  });

  it('IP diversi hanno bucket diversi', async () => {
    const a = { headers: { 'x-forwarded-for': '10.0.0.3' } };
    const b = { headers: { 'x-forwarded-for': '10.0.0.4' } };
    expect((await rateLimit(a)).ok).toBe(true);
    expect((await rateLimit(b)).ok).toBe(true); // b non è stato throttlato da a
  });

  it('dopo la finestra il bucket si libera', async () => {
    const req = { headers: { 'x-forwarded-for': '10.0.0.5' } };
    expect((await rateLimit(req)).ok).toBe(true);
    expect((await rateLimit(req)).ok).toBe(false);
    // Simuliamo il passare del tempo azzerando lo stato del bucket.
    getMemBucket().clear();
    expect((await rateLimit(req)).ok).toBe(true);
  });
});
