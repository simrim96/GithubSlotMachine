// Test for S4 hardening: GITHUB_PAT token-type detection (ISSUES.md §2).
// A classic/unknown PAT with broad scope must be flagged as insecure; a
// fine-grained PAT (scoped to the slot + profile repos only) must be trusted.
import { describe, it, expect } from 'vitest';

const { detectTokenType, auditToken } = await import('../api/_lib/github.js');

describe('S4 — GITHUB_PAT token type detection', () => {
  it('trusts a fine-grained PAT (github_pat_…)', () => {
    const t = detectTokenType('github_pat_' + 'x'.repeat(60));
    expect(t.kind).toBe('fine-grained');
    expect(t.safe).toBe(true);
  });

  it('flags a classic PAT (ghp_…) as insecure', () => {
    const t = detectTokenType('ghp_' + 'a'.repeat(36));
    expect(t.kind).toBe('classic');
    expect(t.safe).toBe(false);
  });

  it('flags other classic prefixes (gho_/ghu_/ghs_/ghr_) as insecure', () => {
    for (const p of ['gho_', 'ghu_', 'ghs_', 'ghr_']) {
      const t = detectTokenType(p + 'z'.repeat(30));
      expect(t.kind).toBe('classic');
      expect(t.safe).toBe(false);
    }
  });

  it('treats an unknown/arbitrary token as insecure', () => {
    const t = detectTokenType('random-opaque-string-without-prefix');
    expect(t.kind).toBe('unknown');
    expect(t.safe).toBe(false);
  });

  it('handles absent/empty token as "none" (read-only mode)', () => {
    expect(detectTokenType('').kind).toBe('none');
    expect(detectTokenType(undefined).kind).toBe('none');
    expect(detectTokenType(null).kind).toBe('none');
  });

  it('auditToken warns on classic PAT but does not throw by default', () => {
    const t = auditToken('ghp_' + 'a'.repeat(36));
    expect(t.kind).toBe('classic');
  });

  it('auditToken throws (fail-closed) when enforce=true on classic PAT', () => {
    expect(() =>
      auditToken('ghp_' + 'a'.repeat(36), { enforce: true })
    ).toThrow(/fine-grained/);
  });

  it('auditToken passes through a fine-grained PAT even with enforce', () => {
    const t = auditToken('github_pat_' + 'x'.repeat(60), { enforce: true });
    expect(t.kind).toBe('fine-grained');
    expect(t.safe).toBe(true);
  });
});
