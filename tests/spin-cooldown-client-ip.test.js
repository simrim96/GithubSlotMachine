// Anti-spoofing di clientIp() (N12, ISSUES.md):
// il client può forgiare x-forwarded-for, quindi la gerarchia deve preferire
// x-vercel-ip (proxy Vercel, non spoofabile), poi x-real-ip, e di XFF usare
// SOLO l'ultimo elemento (quello aggiunto dal proxy finale).
import { describe, test, expect } from 'vitest';
import { clientIp } from '../api/_lib/spin-cooldown.js';

describe('spin-cooldown clientIp (anti-spoofing N12)', () => {
  test('preferisce x-vercel-ip su x-forwarded-for spoofato (Headers-like)', () => {
    const req = {
      headers: {
        get: (name) =>
          name === 'x-vercel-ip'
            ? '203.0.113.99'
            : name === 'x-forwarded-for'
              ? '1.2.3.4'
              : null,
      },
    };
    expect(clientIp(req)).toBe('203.0.113.99');
  });

  test('preferisce x-vercel-ip su x-forwarded-for spoofato (plain object)', () => {
    const req = {
      headers: {
        'x-vercel-ip': '203.0.113.99',
        'x-forwarded-for': '1.2.3.4',
      },
    };
    expect(clientIp(req)).toBe('203.0.113.99');
  });

  test('preferisce x-real-ip su x-forwarded-for spoofato', () => {
    const req = {
      headers: {
        'x-real-ip': '203.0.113.98',
        'x-forwarded-for': '1.2.3.4',
      },
    };
    expect(clientIp(req)).toBe('203.0.113.98');
  });

  test("di x-forwarded-for usa l'ULTIMO elemento (quello del proxy finale)", () => {
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 198.51.100.7' },
    };
    expect(clientIp(req)).toBe('198.51.100.7');
  });

  test('x-forwarded-for a elemento singolo è accettato come fallback', () => {
    const req = { headers: { 'x-forwarded-for': '198.51.100.7' } };
    expect(clientIp(req)).toBe('198.51.100.7');
  });

  test('x-vercel-ip letto via Headers-like con get()', () => {
    const req = {
      headers: {
        get: (name) => (name === 'x-vercel-ip' ? '203.0.113.99' : null),
      },
    };
    expect(clientIp(req)).toBe('203.0.113.99');
  });

  test('fallback a unknown senza header', () => {
    expect(clientIp({ headers: {} })).toBe('unknown');
    expect(clientIp({})).toBe('unknown');
    expect(clientIp(undefined)).toBe('unknown');
  });
});
