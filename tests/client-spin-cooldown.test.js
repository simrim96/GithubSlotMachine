// Verifica del rate-limit client-side (S2) che SOPRAVVIVE alla navigazione.
//
// Riproduce il bug reale: lo spin fa `window.location.assign('/api/spin')`
// che è una navigazione COMPLETA di pagina. Senza persistenza in localStorage,
// la leva veniva riabilitata al ritorno e si poteva spinare di nuovo mentre
// i rulli ruotavano ancora. Qui simuliamo: click → "reload pagina" →
// il modulo deve rilevare l'ultimo spin in localStorage e tenere la leva
// disabilitata per il tempo rimanente.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SPIN_COOLDOWN_MS,
  LAST_SPIN_KEY,
  applyCooldownOnLoad,
  handleSpinClick,
} from '../public/_spin-cooldown.js';

// ── Mock minimale del DOM / localStorage / window ──────────────────────────
function makeCtx() {
  const listeners = {};
  const btn = {
    disabled: false,
    textContent: 'GIRA ORA',
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  let spinning = false;
  return {
    btn,
    listeners,
    ctx: {
      spinBtn: btn,
      setSpinning: (v) => { spinning = v; },
      isSpinning: () => spinning,
      announce: vi.fn(),
      cooldownTimer: null,
    },
    getSpinning: () => spinning,
  };
}

// localStorage in-memory condiviso fra i "reload" della pagina.
function makeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store,
  };
}

let storage;
beforeEach(() => {
  storage = makeStorage();
  globalThis.localStorage = storage;
  // Nessun timer reale: usiamo fake timers per controllare il tempo.
  vi.useFakeTimers();
});

describe('client-side spin cooldown (S2) — sopravvive alla navigazione', () => {
  it('dopo un click, un secondo click immediato è ignorato (stessa pagina)', () => {
    const { ctx, listeners } = makeCtx();
    handleSpinClick(ctx);
    expect(ctx.spinBtn.disabled).toBe(true);

    // Simula un secondo click subito dopo (stesso document, ma il blocco in
    // memory avrebbe dovuto già bastare). Registriamo lo spy su localStorage.
    const before = storage.getItem(LAST_SPIN_KEY);
    handleSpinClick(ctx); // deve essere ignorato
    const after = storage.getItem(LAST_SPIN_KEY);
    expect(after).toBe(before); // nessun nuovo spin registrato
  });

  it('al caricamento della pagina, se l’ultimo spin è dentro la finestra la leva resta disabilitata', () => {
    // 1) Primo "caricamento": l'utente clicca la leva.
    const first = makeCtx();
    handleSpinClick(first.ctx);
    expect(first.ctx.spinBtn.disabled).toBe(true);
    expect(storage.getItem(LAST_SPIN_KEY)).not.toBeNull();

    // 2) La pagina "naviga via" (redirect a GitHub) e poi "ritorna":
    //    costruiamo un NUOVO contesto (nuovo btn, nuova memoria) ma con lo
    //    STESSO localStorage → deve riapplicare il blocco.
    const second = makeCtx();
    const wasInCooldown = applyCooldownOnLoad(second.ctx);
    expect(wasInCooldown).toBe(true);
    expect(second.ctx.spinBtn.disabled).toBe(true);
    expect(second.ctx.spinBtn.textContent).toBe('⏳ Girando...');
  });

  it('dopo lo scadere della finestra, la leva viene riabilitata', () => {
    const { ctx } = makeCtx();
    handleSpinClick(ctx);
    expect(ctx.spinBtn.disabled).toBe(true);

    // Avanziamo il tempo oltre SPIN_COOLDOWN_MS.
    vi.advanceTimersByTime(SPIN_COOLDOWN_MS + 50);
    expect(ctx.spinBtn.disabled).toBe(false);
    expect(ctx.spinBtn.textContent).toBe('GIRA ORA');
  });

  it('se l’ultimo spin è vecchio, al caricamento la leva parte abilitata', () => {
    storage.setItem(LAST_SPIN_KEY, String(Date.now() - (SPIN_COOLDOWN_MS + 1000)));
    const { ctx } = makeCtx();
    const wasInCooldown = applyCooldownOnLoad(ctx);
    expect(wasInCooldown).toBe(false);
    expect(ctx.spinBtn.disabled).toBe(false);
  });
});
