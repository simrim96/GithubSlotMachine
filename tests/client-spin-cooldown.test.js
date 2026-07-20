// Verifica del rate-limit client-side (S2) che SOPRAVVIVE alla navigazione
// E ignora i click durante la rotazione (il bug reale segnalato dall'utente:
// "premo la leva prima che la rotazione sia terminata, la pagina si
// ricarica comunque").
//
// Usa vitest con global stubbati (window/localStorage) — nessun jsdom.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initSpinCooldown,
  handleSpinClick,
  getCooldownState,
  applyCooldownOnLoad,
} from '../public/_spin-cooldown.js';

const LS_KEY = 'gsm_last_spin_ts';

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _store: store,
  };
}

function installDom(localStorage, assignSpy) {
  const listeners = {};
  const spinBtn = {
    disabled: false,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    setAttribute() {},
    removeAttribute() {},
    click() {
      listeners.click && listeners.click();
    },
  };
  const location = { assign: assignSpy };
  const windowMock = { localStorage, location, Date };
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('localStorage', localStorage);
  return { spinBtn, windowMock };
}

describe('S2 client: click durante rotazione NON ricarica', () => {
  let ls;
  let assignSpy;

  beforeEach(() => {
    ls = makeLocalStorage();
    assignSpy = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));
  });

  it('primo click spinna (1 redirect), click durante cooldown → 0 redirect', () => {
    const { spinBtn } = installDom(ls, assignSpy);
    initSpinCooldown({
      spinBtn,
      isSpinningRef: () => false,
      setSpinning: () => {},
      announce: () => {},
    });

    spinBtn.click(); // spin valido
    expect(assignSpy).toHaveBeenCalledTimes(1);

    // Simula il ritorno della pagina (stesso localStorage, nuovo DOM)
    const ls2 = ls; // stessa persistenza
    const assignSpy2 = vi.fn();
    const { spinBtn: spinBtn2 } = installDom(ls2, assignSpy2);
    initSpinCooldown({
      spinBtn: spinBtn2,
      isSpinningRef: () => false,
      setSpinning: () => {},
      announce: () => {},
    });

    // applyCooldownOnLoad deve aver disabilitato la leva
    expect(spinBtn2.disabled).toBe(true);
    // Click durante rotazione → DEVE ignorare, ZERO redirect
    spinBtn2.click();
    expect(assignSpy2).toHaveBeenCalledTimes(0);
  });

  it('doppio click rapido durante navigazione → esattamente 1 redirect', () => {
    const { spinBtn } = installDom(ls, assignSpy);
    initSpinCooldown({
      spinBtn,
      isSpinningRef: () => false,
      setSpinning: () => {},
      announce: () => {},
    });
    spinBtn.click(); // primo → assign, isNavigating=true
    spinBtn.click(); // secondo immediato → ignorato
    expect(assignSpy).toHaveBeenCalledTimes(1);
  });

  it('dopo il cooldown (>3s) la leva si riabilita e spinna', () => {
    ls.setItem(LS_KEY, String(Date.now() - 5000)); // 5s fa
    const { spinBtn } = installDom(ls, assignSpy);
    initSpinCooldown({
      spinBtn,
      isSpinningRef: () => false,
      setSpinning: () => {},
      announce: () => {},
    });
    expect(spinBtn.disabled).toBe(false);
    spinBtn.click();
    expect(assignSpy).toHaveBeenCalledTimes(1);
  });

  it('getCooldownState è coerente con il timestamp persistito', () => {
    ls.setItem(LS_KEY, String(Date.now()));
    expect(getCooldownState(Date.now()).inCooldown).toBe(true);

    const ls2 = makeLocalStorage();
    ls2.setItem(LS_KEY, String(Date.now() - 99999));
    // getCooldownState legge window.localStorage: aggiorniamo quello.
    vi.stubGlobal('window', { localStorage: ls2, location: { assign: () => {} }, Date });
    expect(getCooldownState(Date.now()).inCooldown).toBe(false);
  });

  it('handleSpinClick ignorato se in cooldown, anche senza init', () => {
    ls.setItem(LS_KEY, String(Date.now()));
    const { spinBtn } = installDom(ls, assignSpy);
    handleSpinClick({
      spinBtn,
      isSpinningRef: () => false,
      setSpinning: () => {},
      announce: () => {},
    });
    expect(assignSpy).toHaveBeenCalledTimes(0);
  });
});
