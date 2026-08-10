import { describe, test, expect } from 'vitest';
import { badgeCooldown } from '../api/_lib/badge-cooldown.js';

// Since badgeCooldown uses a module-level Map, we must use unique IPs
// for the "first request" tests and never reuse IPs across tests.
// The cooldown is 1 second — if we reuse an IP, we need to wait or
// use a fresh one. We use 100 unique IPs to guarantee freshness.
const _ipBase = 100;
let _ipCounter = 0;
function nextIp() {
  const ip = `10.99.${_ipBase + _ipCounter}.1`;
  _ipCounter += 1;
  return ip;
}

describe('badge-cooldown', () => {
  function makeRequest(ip) {
    return {
      headers: {
        'x-forwarded-for': ip,
        'x-real-ip': ip,
      },
    };
  }

  function makeVercelRequest(ip) {
    return {
      headers: {
        'x-forwarded-for': ip,
        get: (name) => (name === 'x-vercel-ip' ? ip : null),
      },
    };
  }

  test('allows first request from an IP', () => {
    const ip = nextIp();
    const req = makeRequest(ip);
    const result = badgeCooldown(req);
    expect(result.allowed).toBe(true);
  });

  test('blocks second request within 1s from same IP', () => {
    const ip = nextIp();
    const req = makeRequest(ip);
    expect(badgeCooldown(req).allowed).toBe(true);
    expect(badgeCooldown(req).allowed).toBe(false);
  });

  test('allows request from different IP', () => {
    const ip1 = nextIp();
    const ip2 = nextIp();
    const req1 = makeRequest(ip1);
    const req2 = makeRequest(ip2);
    expect(badgeCooldown(req1).allowed).toBe(true);
    expect(badgeCooldown(req2).allowed).toBe(true);
  });

  test('uses x-vercel-ip header', () => {
    const ip = nextIp();
    const req = makeVercelRequest(ip);
    expect(badgeCooldown(req).allowed).toBe(true);
    expect(badgeCooldown(req).allowed).toBe(false);
  });

  test('handles unknown IP fallback', () => {
    const req = { headers: {} };
    expect(badgeCooldown(req).allowed).toBe(true);
    // Same unknown IP should be blocked
    expect(badgeCooldown(req).allowed).toBe(false);
  });

  test('returns ip in result', () => {
    const ip = nextIp();
    const req = makeRequest(ip);
    const result = badgeCooldown(req);
    expect(result.ip).toBe(ip);
  });

  // ── Anti-spoofing (N12, ISSUES.md) ────────────────────────────────────────
  // Il client può forgiare x-forwarded-for: la gerarchia deve preferire
  // x-vercel-ip (proxy Vercel, non spoofabile), poi x-real-ip, e di XFF
  // usare SOLO l'ultimo elemento (aggiunto dal proxy finale).

  test('N12: x-vercel-ip vince su x-forwarded-for spoofato', () => {
    const ip = nextIp();
    const req = {
      headers: {
        'x-forwarded-for': '1.2.3.4', // spoofato dal client
        get: (name) => (name === 'x-vercel-ip' ? ip : null),
      },
    };
    expect(badgeCooldown(req).ip).toBe(ip);
  });

  test('N12: x-real-ip vince su x-forwarded-for spoofato', () => {
    const ip = nextIp();
    const req = {
      headers: {
        'x-forwarded-for': '1.2.3.4', // spoofato dal client
        'x-real-ip': ip,
      },
    };
    expect(badgeCooldown(req).ip).toBe(ip);
  });

  test("N12: di x-forwarded-for usa l'ULTIMO elemento (quello del proxy finale)", () => {
    const ip = nextIp();
    const req = {
      headers: {
        'x-forwarded-for': `1.2.3.4, 203.0.113.9, ${ip}`,
      },
    };
    expect(badgeCooldown(req).ip).toBe(ip);
  });

  test('N12: x-forwarded-for a elemento singolo è accettato come fallback', () => {
    const ip = nextIp();
    const req = { headers: { 'x-forwarded-for': ip } };
    expect(badgeCooldown(req).ip).toBe(ip);
  });
});
