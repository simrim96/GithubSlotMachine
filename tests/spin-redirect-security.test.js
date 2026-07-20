// Security test for S1 (ISSUES.md): the `redirect` parameter in /api/spin must
// be validated against an ALLOWLIST of hosts (not a blocklist) and must enforce
// https + safe path. Covers allowlist, protocol enforcement, and open-redirect
// rejection toward arbitrary domains (e.g. a fork on myslot.example.com).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidRedirectUrl, resolveRedirectUrl } from '../api/spin.js';

describe('S1 — spin redirect validation (allowlist, not blocklist)', () => {
  const originalEnv = process.env.SLOT_ALLOWED_HOSTS;

  afterEach(() => {
    // Restore env between tests
    if (originalEnv === undefined) {
      delete process.env.SLOT_ALLOWED_HOSTS;
    } else {
      process.env.SLOT_ALLOWED_HOSTS = originalEnv;
    }
  });

  describe('relative URLs (same-origin)', () => {
    it('accepts relative paths starting with /', () => {
      expect(isValidRedirectUrl('/foo/bar')).toBe(true);
      expect(isValidRedirectUrl('/?l=javascript')).toBe(true);
    });

    it('accepts empty / null / undefined as invalid (caller handles fallbacks)', () => {
      expect(isValidRedirectUrl('')).toBe(false);
      expect(isValidRedirectUrl('   ')).toBe(false);
      expect(isValidRedirectUrl(null)).toBe(false);
      expect(isValidRedirectUrl(undefined)).toBe(false);
    });
  });

  describe('default allowlist (no env override)', () => {
    beforeEach(() => {
      delete process.env.SLOT_ALLOWED_HOSTS;
    });

    it('accepts https on the deploy domain', () => {
      expect(
        isValidRedirectUrl('https://github-slot-machine.vercel.app/?l=js')
      ).toBe(true);
    });

    it('accepts https on github.com (legit owner profile target)', () => {
      expect(isValidRedirectUrl('https://github.com/simrim96')).toBe(true);
    });

    it('accepts http on localhost / 127.0.0.1 (dev only)', () => {
      expect(isValidRedirectUrl('http://localhost:3000/')).toBe(true);
      expect(isValidRedirectUrl('http://127.0.0.1:3000/')).toBe(true);
    });

    it('REJECTS non-https transport on public hosts (open-redirect guard)', () => {
      // http (not https) on a public host must be rejected even if host-listed
      expect(isValidRedirectUrl('http://github.com/simrim96')).toBe(false);
    });

    it('REJECTS arbitrary fork domains NOT on the allowlist', () => {
      // This is the exact S1 scenario: a fork on a custom domain must NOT be
      // reachable via the redirect param.
      expect(isValidRedirectUrl('https://myslot.example.com/x')).toBe(false);
      expect(
        isValidRedirectUrl('https://evil-attacker.com/steal?cookie=1')
      ).toBe(false);
    });

    it('REJECTS dangerous protocols (javascript:, data:, vbscript:)', () => {
      expect(isValidRedirectUrl('javascript:alert(1)')).toBe(false);
      expect(isValidRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe(
        false
      );
      expect(isValidRedirectUrl('vbscript:msgbox(1)')).toBe(false);
    });

    it('REJECTS protocol-relative / host-smuggling paths', () => {
      expect(isValidRedirectUrl('//evil.com')).toBe(false);
      expect(isValidRedirectUrl('https://github.com//evil.com')).toBe(false);
    });

    it('REJECTS malformed URLs', () => {
      expect(isValidRedirectUrl('ht!tp://[bad')).toBe(false);
    });
  });

  describe('env-driven allowlist (SLOT_ALLOWED_HOSTS)', () => {
    it('uses the env CSV list when provided', () => {
      process.env.SLOT_ALLOWED_HOSTS = 'my.custom.host,another.host';
      expect(isValidRedirectUrl('https://my.custom.host/path')).toBe(true);
      expect(isValidRedirectUrl('https://another.host/path')).toBe(true);
      // default hosts no longer apply when env is set
      expect(
        isValidRedirectUrl('https://github-slot-machine.vercel.app/')
      ).toBe(false);
    });

    it('normalizes case and whitespace in the env list', () => {
      process.env.SLOT_ALLOWED_HOSTS = '  My.Custom.Host , Another.Host ';
      expect(isValidRedirectUrl('https://my.custom.host/')).toBe(true);
      expect(isValidRedirectUrl('https://ANOTHER.HOST/')).toBe(true);
    });
  });

  describe('resolveRedirectUrl helper', () => {
    beforeEach(() => {
      delete process.env.SLOT_ALLOWED_HOSTS;
    });

    it('returns the validated URL when allowed', () => {
      const r = resolveRedirectUrl(
        'https://github.com/simrim96',
        'https://github-slot-machine.vercel.app/'
      );
      expect(r).toBe('https://github.com/simrim96');
    });

    it('falls back to defaultUrl when URL is not allowed', () => {
      const fallback = 'https://github-slot-machine.vercel.app/';
      const r = resolveRedirectUrl('https://evil.example.com/', fallback);
      expect(r).toBe(fallback);
    });

    it('falls back to defaultUrl when URL is empty', () => {
      const fallback = 'https://github.com/simrim96';
      expect(resolveRedirectUrl('', fallback)).toBe(fallback);
      expect(resolveRedirectUrl('   ', fallback)).toBe(fallback);
    });
  });
});
