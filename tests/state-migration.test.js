// Test per il sistema di migrazione dello stato (ISSUE-1)
//
// Questi test chiamano DIRETTAMENTE migrateState() (funzione esportata).
// Se il bug del loop infinito tornasse, il test non terminerebbe mai e
// vitest lo farebbe scattare in timeout — esattamente ciò che vogliamo
// rilevare. Ogni test imposta un timeout esplicito per essere sicuri.
import { describe, it, expect } from 'vitest';
import { migrateState, STATE_VERSION } from '../api/_lib/state.js';

// Timeout corto: se migrateState va in loop, il test fallisce in fretta
// invece di appendere 30s+.
const QUICK_TIMEOUT = 3000;

describe('state migration system — ISSUE-1', () => {
  it(
    'migrateState termina e migra v1 → v2 correttamente',
    () => {
      const v1State = {
        totalSpins: 5,
        totalWins: 2,
        // stato legacy: nessun campo version, settings, stats
      };

      const result = migrateState(v1State);

      // Deve terminare e produrre uno stato v2 valido
      expect(result.version).toBe(STATE_VERSION);
      expect(result.version).toBe(2);

      // I dati esistenti devono essere preservati
      expect(result.totalSpins).toBe(5);
      expect(result.totalWins).toBe(2);

      // I nuovi campi v2 devono essere presenti
      expect(result.settings).toBeDefined();
      expect(result.settings.theme).toBe('auto');
      expect(result.settings.sound).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.winsByLang).toBeDefined();
    },
    QUICK_TIMEOUT
  );

  it(
    'migrateState preserva lastWin e dati complessi durante la migrazione',
    () => {
      const v1State = {
        totalSpins: 100,
        totalWins: 50,
        lastWin: { langId: 'python', langName: 'Python', ts: 1234567890 },
      };

      const result = migrateState(v1State);

      expect(result.version).toBe(2);
      expect(result.totalSpins).toBe(100);
      expect(result.totalWins).toBe(50);
      expect(result.lastWin.langId).toBe('python');
      expect(result.lastWin.ts).toBe(1234567890);
    },
    QUICK_TIMEOUT
  );

  it(
    'migrateState NON ricrea uno stato "ahead" (v3) quando lo stato è già v2',
    () => {
      // ISSUE-1 / ISSUE-8: MIGRATIONS[2] placeholder portava a version: 3,
      // creando uno stato avanti rispetto a STATE_VERSION=2. Ora rimosso.
      const v2State = {
        totalSpins: 100,
        totalWins: 80,
        lastWin: null,
        version: 2,
        settings: { theme: 'dark', sound: false },
        stats: {
          longestStreak: 5,
          currentStreak: 3,
          winsByLang: { python: 10, rust: 5 },
        },
      };

      const result = migrateState(v2State);

      // Deve restare v2, NON saltare a v3
      expect(result.version).toBe(2);
      expect(result.version).toBeLessThanOrEqual(STATE_VERSION);
      // I campi v2 personalizzati non devono essere sovrascritti
      expect(result.settings.theme).toBe('dark');
      expect(result.settings.sound).toBe(false);
      expect(result.stats.winsByLang.python).toBe(10);
      expect(result.stats.currentStreak).toBe(3);
    },
    QUICK_TIMEOUT
  );

  it(
    'migrateState gestisce stato senza campo version (assunto v1)',
    () => {
      const legacyState = { totalSpins: 1, totalWins: 0 };
      const result = migrateState(legacyState);
      expect(result.version).toBe(2);
      expect(result.settings).toBeDefined();
      expect(result.stats).toBeDefined();
    },
    QUICK_TIMEOUT
  );

  it(
    'migrateState restituisce invariato uno stato "ahead" (versione >= STATE_VERSION)',
    () => {
      // Se lo stato persistito è già avanti rispetto alla versione corrente
      // (es. v3 mentre STATE_VERSION=2), non deve né loopare né crashare:
      // lo restituiamo com'è senza tentare migrazioni inesistenti.
      const aheadState = {
        totalSpins: 1,
        totalWins: 0,
        version: 99,
      };
      const result = migrateState(aheadState);
      expect(result.version).toBe(99);
      expect(result.totalSpins).toBe(1);
    },
    QUICK_TIMEOUT
  );

  it('STATE_VERSION è 2 (coerente con la migrazione v1→v2)', () => {
    expect(STATE_VERSION).toBe(2);
  });
});
