// Test per il monitor del sync Redis→GitHub (Miglioramento M4, ISSUES.md).
//
// Verifica che i fallimenti *consecutivi* del sync su GitHub vengano contati
// e che, superata la soglia STATE_SYNC_FAILURE_ALERT_THRESHOLD, venga emesso
// un alert (console.error + Sentry.captureMessage). Al primo successo il
// contatore deve azzerarsi e l'alert non deve più essere "alzato".
//
// I test chiamano direttamente le funzioni esportate del monitor, così non
// serve simulare chiamate di rete verso GitHub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../api/_lib/logger.js';

// Carichiamo il modulo con Sentry mockato a livello di factory così il test
// non dipende dalla configurazione reale di Sentry (DSN assente in test).
vi.mock('../../sentry.config.js', () => ({
  default: {
    captureMessage: vi.fn(),
  },
  captureMessage: vi.fn(),
}));

// Mock del logger strutturato (logga su console.error, quindi i test possono verificare)
vi.mock('../api/_lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  LEVELS: ['debug', 'info', 'warn', 'error'],
  LOG_LEVEL: 'info',
  MIN_LEVEL_IDX: 1,
  ENABLED: ['info', 'warn', 'error'],
}));

const stateMod = await import('../api/_lib/state.js');
const {
  recordStateSyncFailure,
  recordStateSyncSuccess,
  reportStateSyncAlert,
  getSyncFailureCount,
  isAlertRaised,
  STATE_SYNC_FAILURE_ALERT_THRESHOLD,
} = stateMod;

describe('M4: monitor sync Redis→GitHub (fallimenti consecutivi)', () => {
  beforeEach(() => {
    // Azzeriamo lo stato del monitor prima di ogni test.
    // recordStateSyncSuccess() resetta contatore + flag di alert.
    recordStateSyncSuccess();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('la soglia di default è 5', () => {
    expect(STATE_SYNC_FAILURE_ALERT_THRESHOLD).toBe(5);
  });

  it('primi N-1 fallimenti NON sollevano l\'alert', () => {
    const threshold = STATE_SYNC_FAILURE_ALERT_THRESHOLD;
    for (let i = 0; i < threshold - 1; i++) {
      recordStateSyncFailure(new Error('boom'));
    }
    expect(getSyncFailureCount()).toBe(threshold - 1);
    expect(isAlertRaised()).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('al raggiungimento della soglia l\'alert viene sollevato (console.error + Sentry)', () => {
    const threshold = STATE_SYNC_FAILURE_ALERT_THRESHOLD;
    const captureMessage = stateMod.default
      ? stateMod.default.captureMessage
      : null;

    for (let i = 0; i < threshold; i++) {
      recordStateSyncFailure(new Error(`fail ${i}`));
    }

    expect(getSyncFailureCount()).toBe(threshold);
    expect(isAlertRaised()).toBe(true);
    // Deve aver loggato l'ALERT via logger.error() + Sentry.
    expect(logger.error).toHaveBeenCalled();
    const alertMsg = logger.error.mock.calls
      .map((c) => c[0])
      .join('\n');
    expect(alertMsg).toMatch(/ALERT.*sync Redis→GitHub/i);
    expect(alertMsg).toMatch(new RegExp(`fallito ${threshold} volte`));

    // Sentry deve aver ricevuto un captureMessage di livello errore.
    if (captureMessage) {
      expect(captureMessage).toHaveBeenCalled();
    }
  });

  it('fallimenti oltre la soglia continuano a loggare (warn) ma non duplicano l\'alert', () => {
    const threshold = STATE_SYNC_FAILURE_ALERT_THRESHOLD;
    for (let i = 0; i < threshold + 3; i++) {
      recordStateSyncFailure(new Error('still failing'));
    }
    expect(getSyncFailureCount()).toBe(threshold + 3);
    expect(isAlertRaised()).toBe(true);
    // L'alert (logger.error) deve essere stato emesso UNA sola volta:
    // il primo superamento della soglia. I successivi sono solo warn.
    const errorCalls = logger.error.mock.calls.length;
    expect(errorCalls).toBe(1);
    // I warn invece continuano ad accumularsi.
    expect(logger.warn.mock.calls.length).toBe(3);
  });

  it('un successo azzera il contatore e fa riabbassare l\'alert', () => {
    const threshold = STATE_SYNC_FAILURE_ALERT_THRESHOLD;
    for (let i = 0; i < threshold; i++) {
      recordStateSyncFailure(new Error('fail'));
    }
    expect(isAlertRaised()).toBe(true);

    recordStateSyncSuccess();
    expect(getSyncFailureCount()).toBe(0);
    expect(isAlertRaised()).toBe(false);

    // Dopo il reset, un nuovo fallimento NON deve ri-alertare subito:
    // riparte da 1.
    logger.error.mockClear();
    recordStateSyncFailure(new Error('fail again'));
    expect(getSyncFailureCount()).toBe(1);
    expect(isAlertRaised()).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reportStateSyncAlert segnala a Sentry e logga', () => {
    const captureMessage = stateMod.default?.captureMessage;
    reportStateSyncAlert(7, 'network timeout');
    expect(logger.error).toHaveBeenCalled();
    const msg = logger.error.mock.calls[0][0];
    expect(msg).toMatch(/fallito 7 volte/i);
    expect(msg).toMatch(/network timeout/i);
    if (captureMessage) {
      expect(captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('ALERT'),
        'error'
      );
    }
  });
});
