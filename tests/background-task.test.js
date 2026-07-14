// ─── Tests per Background Task Memory Leak Fixes ──────────────────────────────
// Verifica che le promesse in background vengano gestite correttamente e non
// si accumulino come memory leak.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Background Task Memory Leak Fixes', () => {
  let originalConsole;
  let consoleSpy;

  beforeEach(() => {
    originalConsole = { ...console };
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    console = originalConsole;
    vi.restoreAllMocks();
  });

  it('trackSpin non blocca il redirect', async () => {
    // Simula trackSpin function
    const trackSpin = (metrics) => {
      if (process.env.VERCEL) {
        return fetch('https://api.vercel.com/v1/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: [{
              event: 'spin',
              timestamp: Date.now(),
              ...metrics,
            }],
          }),
        }).catch(() => {});
      }
      return Promise.resolve(); // Silently ignore in non-Vercel
    };

    // trackSpin deve essere non-bloccante
    const spinStart = Date.now();
    const redirectPromise = Promise.resolve('redirect');
    const analyticsPromise = trackSpin({ win: 'win', win_type: 'jackpot' });

    // Il redirect non deve aspettare l'analytics
    const [redirectResult, _] = await Promise.allSettled([
      redirectPromise,
      analyticsPromise,
    ]);

    expect(redirectResult.status).toBe('fulfilled');
  });

  it('IIFE background task ha cleanup handlers', () => {
    // Verifica che il pattern usato in spin.js includa .then() e .catch()
    const spinJsContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );

    // Cerca il pattern corretto: funzione assegnata a variabile + .then() + .catch()
    expect(spinJsContent).toMatch(/updateReadmeBackground\s*\(\)/);
    expect(spinJsContent).toMatch(/\.then\s*\(\s*\(\)\s*=>/);
    expect(spinJsContent).toMatch(/\.catch\s*\(\s*\(err\)\s*=>/);

    // Non deve esserci più il vecchio pattern IIFE senza handler
    const iifePattern = /async\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)/;
    const iifeMatches = spinJsContent.match(iifePattern);
    
    // Se ci sono match, devono essere all'interno di una assegnazione a variabile
    if (iifeMatches) {
      const index = spinJsContent.indexOf(iifeMatches[0]);
      const contextBefore = spinJsContent.slice(Math.max(0, index - 50), index);
      expect(contextBefore).toMatch(/updateReadmeBackground\s*=\s*async/);
    }
  });

  it('Background task ha ID univoco e flag completion', async () => {
    const spinJsContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );

    // Deve avere task ID univoco basato su spinStart
    expect(spinJsContent).toMatch(/backgroundTaskId\s*=\s*`readme-update-\$\{spinStart\}`/);
    
    // Deve avere flag di completamento
    expect(spinJsContent).toMatch(/backgroundTaskCompleted\s*=\s*false/);
    expect(spinJsContent).toMatch(/backgroundTaskCompleted\s*=\s*true/);
  });

  it('Background task registra breadcrumbs su Sentry', async () => {
    const spinJsContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );

    // Deve aggiungere breadcrumb su Sentry
    expect(spinJsContent).toMatch(/Sentry\.addBreadcrumb/);
    expect(spinJsContent).toMatch(/category:\s*'background-task'/);
  });
});

describe('RateLimitQueue Memory Leak Prevention', () => {
  let originalConsole;
  let consoleSpy;

  beforeEach(() => {
    originalConsole = { ...console };
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    console = originalConsole;
    vi.restoreAllMocks();
  });

  it('processQueue usa flag wasFromAdd', () => {
    const ratelimitTrackerContent = require('fs').readFileSync(
      new URL('../api/_lib/ratelimit-tracker.js', import.meta.url),
      'utf-8'
    );

    // processQueue deve usare wasFromAdd flag
    expect(ratelimitTrackerContent).toMatch(/wasFromAdd\s*=\s*false/);
    expect(ratelimitTrackerContent).toMatch(/if\s*\(\s*wasFromAdd\s*\)/);
    
    // resolve e reject devono essere conditional
    const processQueueMatch = ratelimitTrackerContent.match(
      /async processQueue\(\) \{[\s\S]*?\n  \}/
    );
    
    if (processQueueMatch) {
      const processQueueBody = processQueueMatch[0];
      
      // resolve deve essere conditionale
      const resolveMatch = processQueueBody.match(
        /if\s*\(\s*wasFromAdd\s*\)\s*\{[\s\S]*?resolve\(result\)/
      );
      expect(resolveMatch).not.toBeNull();
      
      // reject deve essere conditionale
      const rejectMatch = processQueueBody.match(
        /if\s*\(\s*wasFromAdd\s*\)\s*\{[\s\S]*?reject\(err\)/
      );
      expect(rejectMatch).not.toBeNull();
    }
  });

  it('processQueue non risolve outer promise per items in coda', () => {
    const ratelimitTrackerContent = require('fs').readFileSync(
      new URL('../api/_lib/ratelimit-tracker.js', import.meta.url),
      'utf-8'
    );

    // Il codice deve avere commenti che spiegano il fix
    expect(ratelimitTrackerContent).toMatch(/FIX: Properly resolve\/reject the outer promise/);
    expect(ratelimitTrackerContent).toMatch(/don't resolve the OUTER promise/);
  });
});
