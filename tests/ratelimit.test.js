import { describe, it, expect } from 'vitest';
import { isValidUser } from '../api/_lib/ratelimit.js';

// NOTA: il rate-limit per-IP (token-bucket 1 spin / 3s, ex rateLimit() /
// RL_WINDOW_SEC / getMemBucket()) è stato RIMOSSO (ISSUE-1): l'utente può
// effettuare tutti gli spin che vuole senza ricevere "429 Troppe richieste".
// ratelimit.js espone ora SOLO isValidUser (validazione ?user= per
// l'open-redirect). I test sul bucket sono stati eliminati; la rimozione del
// blocco 429 è verificata in tests/cors-ratelimit.test.js.

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
