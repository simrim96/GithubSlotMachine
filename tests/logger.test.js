// ─── Logger child() Tests (ISSUE-N3 regression) ──────────────────────────────
// Il bug N3: child() chiamava this.* dentro l'object literal (this = il child
// stesso) → ricorsione infinita → RangeError. Questi test bloccano la
// regressione: child() deve chiudere sul logger padre e unire il contesto
// senza alterare il logger originale.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../api/_lib/logger.js';

describe('logger.child() (ISSUE-N3)', () => {
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restituisce un logger con i 4 metodi di livello', () => {
    const child = logger.child({ ctx: 'x' });
    expect(child).toBeDefined();
    for (const level of ['debug', 'info', 'warn', 'error']) {
      expect(typeof child[level]).toBe('function');
    }
  });

  it('child().info() non lancia (regressione N3: niente ricorsione infinita)', () => {
    const child = logger.child({ ctx: 'x' });
    expect(() => child.info('hello')).not.toThrow();
  });

  it('child() senza contesto non lancia', () => {
    const child = logger.child();
    expect(() => child.info('hello')).not.toThrow();
  });

  it('child().info() scrive su stdout con contesto unito e meta', () => {
    const child = logger.child({ ctx: 'x', service: 'spin' });
    child.info('hello', { requestId: 'r1' });

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"')
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"hello"')
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"ctx":"x"')
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"service":"spin"')
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"requestId":"r1"')
    );
  });

  it('il meta della chiamata ha precedenza sul contesto del child', () => {
    const child = logger.child({ ctx: 'dal-contesto' });
    child.info('hello', { ctx: 'dal-meta' });

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"ctx":"dal-meta"')
    );
  });

  it('child() non altera il logger padre', () => {
    const child = logger.child({ ctx: 'x' });
    child.info('from-child');

    stdoutSpy.mockClear();
    logger.info('from-parent');

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('"msg":"from-parent"');
    expect(output).not.toContain('"ctx"');
  });

  it('ogni chiamata del child usa un merge fresco del contesto (nessun accumulo)', () => {
    const child = logger.child({ ctx: 'x' });
    child.info('one');
    child.info('two');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('"msg":"one"');
    expect(calls[1]).toContain('"msg":"two"');
    expect(calls[1]).toContain('"ctx":"x"');
  });

  it('child().warn() e child().error() scrivono su stderr con il contesto', () => {
    const child = logger.child({ ctx: 'x' });
    child.warn('warn-msg', { a: 1 });
    child.error('error-msg', { b: 2 });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"warn"')
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"')
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"warn-msg"')
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"error-msg"')
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('"ctx":"x"')
    );
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('child().debug() inoltra al padre quando LOG_LEVEL=debug', async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = 'debug';
    const { logger: debugLogger } = await import('../api/_lib/logger.js');
    const child = debugLogger.child({ ctx: 'x' });

    expect(() => child.debug('debug-msg')).not.toThrow();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"debug"')
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"debug-msg"')
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"ctx":"x"')
    );

    delete process.env.LOG_LEVEL;
  });
});
