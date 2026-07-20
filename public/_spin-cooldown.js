// Rate-limit client-side (fix S2, speculare al backend).
//
// Lo spin usa `window.location.assign('/api/spin')`, che è una navigazione
// COMPLETA di pagina (redirect a GitHub → ritorno al profilo). Questo AZZERA
// qualsiasi stato in-memory (spinBtn.disabled, timer). Perché il blocco
// sopravviva alla navigazione, persistiamo l'istante dello spin in
// localStorage e lo riapplichiamo al caricamento della pagina.
//
// La finestra SPIN_COOLDOWN_MS è identica a quella usata dal server in
// api/_lib/spin-cooldown.js (3000ms = durata rotazione rulli).
/* eslint-env browser */

export const SPIN_COOLDOWN_MS =
  parseInt(String(typeof process !== 'undefined' ? process.env?.SPIN_COOLDOWN_MS : ''), 10) || 3000;
export const LAST_SPIN_KEY = 'gsm_last_spin_ts';

// Riabilita la leva. `ctx` è l'oggetto di contesto fornito da index.html.
function enableSpinBtn(ctx) {
  ctx.spinBtn.disabled = false;
  ctx.spinBtn.textContent = 'GIRA ORA';
  ctx.setSpinning(false);
}

// Al caricamento: se l'ultimo spin è avvenuto da meno di SPIN_COOLDOWN_MS,
// teniamo la leva disabilitata per il tempo rimanente (copre il caso in cui
// la pagina è stata ricaricata dal redirect di /api/spin).
export function applyCooldownOnLoad(ctx) {
  const last = parseInt(localStorage.getItem(LAST_SPIN_KEY) || '0', 10);
  const elapsed = Date.now() - last;
  if (last && elapsed < SPIN_COOLDOWN_MS) {
    ctx.spinBtn.disabled = true;
    ctx.setSpinning(true);
    ctx.spinBtn.textContent = '⏳ Girando...';
    if (ctx.cooldownTimer) clearTimeout(ctx.cooldownTimer);
    ctx.cooldownTimer = setTimeout(() => enableSpinBtn(ctx), SPIN_COOLDOWN_MS - elapsed);
    return true;
  }
  return false;
}

// Gestisce il click sulla leva. Ritorna `true` se lo spin è stato avviato,
// `false` se è stato ignorato perché già in rotazione.
export function handleSpinClick(ctx) {
  if (ctx.spinBtn.disabled) return false;

  // Registra SUBITO l'istante dello spin in localStorage, così il blocco
  // persiste anche se la pagina naviga via (redirect a GitHub).
  localStorage.setItem(LAST_SPIN_KEY, String(Date.now()));

  ctx.spinBtn.disabled = true;
  ctx.setSpinning(true);
  ctx.spinBtn.textContent = '⏳ Girando...';
  if (typeof ctx.announce === 'function') ctx.announce('Giro in corso...', 'polite');

  if (typeof window !== 'undefined' && typeof window.va === 'function') {
    window.va('track', 'spin', {});
  }
  if (typeof window !== 'undefined') window.location.assign('/api/spin');

  if (ctx.cooldownTimer) clearTimeout(ctx.cooldownTimer);
  ctx.cooldownTimer = setTimeout(() => enableSpinBtn(ctx), SPIN_COOLDOWN_MS);
  return true;
}

// Punto di ingresso chiamato da index.html. `opts` deve contenere:
// { spinBtn, isSpinningRef, setSpinning, announce }.
export function initSpinCooldown(opts) {
  const ctx = {
    spinBtn: opts.spinBtn,
    setSpinning: opts.setSpinning,
    announce: opts.announce,
    cooldownTimer: null,
  };
  applyCooldownOnLoad(ctx);
  opts.spinBtn.addEventListener('click', () => handleSpinClick(ctx));
}
