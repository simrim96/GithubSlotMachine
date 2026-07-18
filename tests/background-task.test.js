// ─── Tests per Background Task / README update ────────────────────────────────
// Verifica che l'aggiornamento della README avvenga nel flusso principale
// (rete VIVA su Vercel), in parallelo con slot.svg+state, e NON in background
// post-redirect (waitUntil su Vercel non ha rete in uscita → timeout 5000ms,
// bug "stessa svg più volte").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('README update nel flusso principale (no waitUntil)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('non usa più waitUntil (rete bloccata post-redirect su Vercel)', () => {
    const spinJsContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );
    expect(spinJsContent).not.toMatch(/waitUntil\s*\(/);
    expect(spinJsContent).not.toMatch(/import\s*\{\s*waitUntil\s*\}/);
  });

  it('README scritta in Promise.allSettled con slot.svg+state', () => {
    const spinJsContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );
    // Deve esserci un Promise.allSettled che include saveSlotSvg, writeState
    // e la promise di aggiornamento README.
    expect(spinJsContent).toMatch(/Promise\.allSettled\s*\(/);
    expect(spinJsContent).toMatch(/saveSlotSvg\s*\(/);
    expect(spinJsContent).toMatch(/writeState\s*\(/);
    // La README usa ghGet/ghPut con la regex ?v= al suo interno
    expect(spinJsContent).toMatch(/api\/image\?v=\$\{spinStart\}/);
  });

  it('ha un timeout di sicurezza per non bloccare il redirect', () => {
    const spinJsContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );
    expect(spinJsContent).toMatch(/README_TIMEOUT_MS/);
    expect(spinJsContent).toMatch(/Promise\.race\s*\(/);
  });
});

describe('No RateLimitQueue (direct calls)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('github.js non usa più RateLimitQueue', () => {
    const githubContent = require('fs').readFileSync(
      new URL('../api/_lib/github.js', import.meta.url),
      'utf-8'
    );

    // La coda è stata rimossa: nessun import e nessun getDefaultQueue()
    expect(githubContent).not.toMatch(/getDefaultQueue/);
    expect(githubContent).not.toMatch(/RateLimitQueue/);
  });

  it('ratelimit-tracker.js non esporta più la queue', () => {
    const content = require('fs').readFileSync(
      new URL('../api/_lib/ratelimit-tracker.js', import.meta.url),
      'utf-8'
    );

    expect(content).not.toMatch(/class RateLimitQueue/);
    expect(content).not.toMatch(/export function getDefaultQueue/);
  });

  it('spin.js: ghGet/ghPut per la README usano 4 argomenti (owner, repo, path)', () => {
    const spinContent = require('fs').readFileSync(
      new URL('../api/spin.js', import.meta.url),
      'utf-8'
    );

    // Regressione del bug "README.md/undefined": prima si chiamava
    // ghGet(token, PROFILE_REPO, 'README.md') con 3 argomenti, saltando
    // il parametro `repo` e passando 'README.md' come repo e undefined come
    // path. La firma corretta è (token, owner, repo, path), quindi servono
    // 4 argomenti. Blocchiamo la forma a 3 argomenti che rompe l'URL.
    expect(spinContent).not.toMatch(
      /ghGet\(\s*token,\s*PROFILE_REPO,\s*'README\.md'\s*\)/
    );
    expect(spinContent).not.toMatch(
      /ghPut\(\s*token,\s*PROFILE_REPO,\s*'README\.md'/
    );
    // La forma a 4 argomenti (owner, repo, path) deve essere presente.
    expect(spinContent).toMatch(
      /ghGet\(\s*token,\s*PROFILE_REPO,\s*PROFILE_REPO,\s*'README\.md'\s*\)/
    );
    expect(spinContent).toMatch(
      /ghPut\(\s*token,\s*PROFILE_REPO,\s*PROFILE_REPO,\s*'README\.md'/
    );
  });
});
