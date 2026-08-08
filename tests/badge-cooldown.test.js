import { describe, test, expect } from 'vitest';
import { badgeCooldown } from '../api/_lib/badge-cooldown.js';

// Reset state between tests (module singleton is shared across the test run)
let _cooldownState;
function snapshotState() {
  // Access the internal map via module introspection
  // We store it once and restore, or just use unique IPs per test
}

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
        get: (name) => name === 'x-vercel-ip' ? ip : null,
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
});
