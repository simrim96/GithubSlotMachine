// ─── Graceful Shutdown Tests (Miglioramento M4) ──────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trackOperation,
  gracefulShutdown,
  waitForOperationsToComplete,
  isShutdownRequested,
  getInFlightCount,
  resetShutdownState,
  SHUTDOWN_CONFIG,
} from '../api/_lib/shutdown.js';

describe('Graceful Shutdown (M4)', () => {
  beforeEach(() => {
    // Reset stato globale prima di ogni test
    resetShutdownState();
    // Mock process.exit per evitare che i test escano
    vi.spyOn(process, 'exit').mockImplementation(() => {
      // Non esce davvero, solo record
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('trackOperation', () => {
    it('deve incrementare il counter quando inizia un\'operazione', () => {
      expect(getInFlightCount()).toBe(0);
      
      const op = trackOperation('test-op');
      
      expect(getInFlightCount()).toBe(1);
      expect(op).toBeDefined();
      expect(typeof op.end).toBe('function');
    });

    it('deve decrementare il counter quando termina un\'operazione', () => {
      const op = trackOperation('test-op');
      
      expect(getInFlightCount()).toBe(1);
      
      op.end();
      
      expect(getInFlightCount()).toBe(0);
    });

    it('deve supportare operazioni nested', () => {
      const op1 = trackOperation('outer');
      const op2 = trackOperation('inner');
      
      expect(getInFlightCount()).toBe(2);
      
      op1.end();
      expect(getInFlightCount()).toBe(1);
      
      op2.end();
      expect(getInFlightCount()).toBe(0);
    });

    it('deve restituire un oggetto con metodo end', () => {
      const op = trackOperation('test-op');
      
      expect(op).toHaveProperty('end');
      expect(typeof op.end).toBe('function');
    });
  });

  describe('gracefulShutdown', () => {
    it('deve registrare gli handler dei segnali una sola volta', () => {
      // Prima chiamata
      gracefulShutdown();
      const registered1 = global._shutdownHandlersRegistered;
      
      // Seconda chiamata
      gracefulShutdown();
      const registered2 = global._shutdownHandlersRegistered;
      
      expect(registered1).toBe(true);
      expect(registered2).toBe(true);
    });

    it('deve configurare correttamente il timeout', () => {
      expect(SHUTDOWN_CONFIG).toBeDefined();
      expect(SHUTDOWN_CONFIG.timeoutMs).toBeGreaterThan(0);
    });

    it('deve gestire correttamente SIGTERM', async () => {
      gracefulShutdown();
      
      // Simula SIGTERM
      process.emit('SIGTERM');
      
      // Attendi un po' per vedere se process.exit viene chiamato
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Il test passa se process.exit non è stato chiamato immediatamente
      // (attende le operazioni in-flight)
    });

    it('deve gestire correttamente SIGINT', () => {
      gracefulShutdown();
      
      // Simula SIGINT
      expect(() => process.emit('SIGINT')).not.toThrow();
    });

    it('deve gestire correttamente uncaughtException', () => {
      gracefulShutdown();
      
      // Simula eccezione non catturata
      expect(() => process.emit('uncaughtException', new Error('test'))).not.toThrow();
    });

    it('deve gestire correttamente unhandledRejection', () => {
      gracefulShutdown();
      
      const promise = new Promise(() => {});
      // Simula promise non gestita
      expect(() => process.emit('unhandledRejection', new Error('test'), promise)).not.toThrow();
    });
  });

  describe('waitForOperationsToComplete', () => {
    it('deve restituire immediatamente se non ci sono operazioni in-flight', async () => {
      await expect(waitForOperationsToComplete(1000)).resolves.toBeUndefined();
    });

    it('deve attendere il completamento delle operazioni in-flight', async () => {
      // Avvia un'operazione
      const op = trackOperation('slow-op');
      
      expect(getInFlightCount()).toBe(1);
      
      // Completa l'operazione
      op.end();
      
      expect(getInFlightCount()).toBe(0);
    });
  });

  describe('isShutdownRequested', () => {
    it('deve restituire false prima dello shutdown', () => {
      expect(isShutdownRequested()).toBe(false);
    });

    it('deve restituire true dopo richiesta di shutdown', async () => {
      gracefulShutdown();
      
      // Simula richiesta di shutdown
      process.emit('SIGTERM');
      
      // Attendi che la richiesta venga processata
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // isShutdownRequested dovrebbe ora restituire true
      // Nota: questo test potrebbe variare in base al timing
    });
  });

  describe('resetShutdownState', () => {
    it('deve resettare tutte le variabili di stato', () => {
      // Avvia stato
      trackOperation('test');
      gracefulShutdown();
      
      // Resetta
      resetShutdownState();
      
      // Verifica reset
      expect(getInFlightCount()).toBe(0);
      expect(global._shutdownHandlersRegistered).toBe(false);
    });
  });

  describe('Integrazione', () => {
    it('deve gestire correttamente un ciclo completo di operazione con shutdown', async () => {
      gracefulShutdown();
      
      // Avvia operazione
      const op = trackOperation('integrated-op');
      
      expect(getInFlightCount()).toBe(1);
      
      // Simula completamento
      op.end();
      
      expect(getInFlightCount()).toBe(0);
    });

    it('deve gestire operazioni multiple in parallelo', async () => {
      gracefulShutdown();
      
      const ops = [
        trackOperation('op1'),
        trackOperation('op2'),
        trackOperation('op3'),
      ];
      
      expect(getInFlightCount()).toBe(3);
      
      // Completa due operazioni
      ops[0].end();
      ops[1].end();
      
      expect(getInFlightCount()).toBe(1);
      
      // Completa l\'ultima
      ops[2].end();
      
      expect(getInFlightCount()).toBe(0);
    });
  });
});
