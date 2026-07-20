/* eslint-env browser */
// Rate-limit client-side (fix S2, speculare al backend).
//
// Lo spin usa `window.location.assign('/api/spin')`, che è una navigazione
// COMPLETA di pagina (redirect a GitHub → ritorno al profilo)...
// [continua come prima]
export const SPIN_COOLDOWN_MS = 3000;

const LS_KEY = 'gsm_last_spin_ts';

// Stato di navigazione in-memory: durante il round-trip di assign() la
// vecchia pagina resta viva finché il browser non ricarica. Se l'utente
// clicca ancora in quel brevissimo lasso, handleSpinClick partirebbe di
// nuovo e farebbe un SECONDO assign → doppia ricarica. Questo flag lo
// impedisce (in-memory basta: vale per la durata della vecchia pagina).
let isNavigating = false;

function readLastTs() {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastTs(ts) {
  try {
    window.localStorage.setItem(LS_KEY, String(ts));
  } catch {
    /* localStorage può essere disabilitato (private mode) — ignoriamo */
  }
}

// Restituisce { inCooldown, remainingMs } in modo SINCRONO, leggendo il
// timestamp persistito. Usato SIA da handleSpinClick (blocco prima del
// redirect) SIA da applyCooldownOnLoad (blocco al ritorno della pagina).
export function getCooldownState(now = Date.now()) {
  const last = readLastTs();
  if (last === null) return { inCooldown: false, remainingMs: 0 };
  const elapsed = now - last;
  if (elapsed < SPIN_COOLDOWN_MS) {
    return { inCooldown: true, remainingMs: SPIN_COOLDOWN_MS - elapsed };
  }
  return { inCooldown: false, remainingMs: 0 };
}

function applyDisabledVisual(spinBtn, remainingMs, announce) {
  spinBtn.disabled = true;
  spinBtn.setAttribute('aria-disabled', 'true');
  if (announce && remainingMs > 0) {
    announce('Spin in corso, attendi la fine della rotazione…', 'polite');
  }
}

function clearDisabledVisual(spinBtn) {
  spinBtn.disabled = false;
  spinBtn.removeAttribute('aria-disabled');
}

export function handleSpinClick(ctx) {
  const { spinBtn, announce } = ctx;

  // (1) Già in navigazione verso /api/spin? Ignora il click.
  if (isNavigating) return;

  // (2) Siamo ancora dentro la finestra di rotazione (cooldown attivo)?
  //     Ignora il click SENZA ricaricare la pagina. Questo è il fix
  //     richiesto: i click sulla leva durante la rotazione non devono
  //     scatenare alcun assign()/reload.
  const { inCooldown } = getCooldownState();
  if (inCooldown) {
    applyDisabledVisual(spinBtn, 0, announce);
    return;
  }

  // (3) Spin consentito: registra SUBITO il timestamp (prima del redirect,
  //     così un eventuale secondo click nello stesso istante trova il blocco),
  //     marca la navigazione e fa il redirect.
  isNavigating = true;
  writeLastTs(Date.now());
  if (typeof window !== 'undefined') window.location.assign('/api/spin');
}

// Al caricamento della pagina (anche dopo il redirect di /api/spin che
// ricarica tutto): se siamo ancora dentro la finestra di rotazione, tieni la
// leva disabilitata per il tempo rimanente. Resetta isNavigating perché
// questa è una pagina "nuova".
export function applyCooldownOnLoad(ctx) {
  const { spinBtn, announce, setSpinning } = ctx;
  isNavigating = false;
  if (setSpinning) setSpinning(false);

  const { inCooldown, remainingMs } = getCooldownState();
  if (inCooldown) {
    let remaining = remainingMs;
    applyDisabledVisual(spinBtn, remaining, announce);
    const tick = setInterval(() => {
      remaining -= 250;
      if (remaining <= 0) {
        clearInterval(tick);
        clearDisabledVisual(spinBtn);
      }
    }, 250);
    return true; // era in cooldown
  }
  return false;
}

export function initSpinCooldown(opts) {
  const { spinBtn, isSpinningRef, setSpinning, announce } = opts;
  const ctx = { spinBtn, isSpinningRef, setSpinning, announce };

  // Al click della leva: blocca se in rotazione/cooldown, altrimenti spinna.
  spinBtn.addEventListener('click', () => handleSpinClick(ctx));

  // Al caricamento (e dopo ogni redirect): ripristina il blocco se la
  // rotazione precedente è ancora in corso.
  applyCooldownOnLoad(ctx);

  return { getCooldownState, handleSpinClick, applyCooldownOnLoad };
}
