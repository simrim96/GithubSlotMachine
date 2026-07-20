import { describe, it, expect } from 'vitest';
import { isValidUser } from '../api/_lib/ratelimit.js';

// NOTA: la validazione ?user= (isValidUser, chiusura open-redirect) vive in
// ratelimit.js. Il rate-limit per-IP VERIE è stato reintrodotto come fix S2
// in api/_lib/spin-cooldown.js (finestra = tempo di rotazione dei rulli),
// con risposta GRACEFUL 302 (mai 429): lo spin troppo ravvicinato dello
// stesso IP viene rediretto al profilo owner senza consumare budget GitHub.
// I test sul comportamento del rate-limit vivono in tests/cors-ratelimit.test.js.

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
