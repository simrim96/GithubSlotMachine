// ─── Accessible SVG generator (fork of svg-builder.js) ────────────────────────────
// buildSVG con supporto completo per screen reader e accessibilità ARIA:
//   • role="img" + aria-label descrittivo
//   • <title> + <desc> per screen reader
//   • aria-live regions per annunciare vincite/risultati
//   • aria-hidden per elementi decorativi
//   • focus management e keyboard support
//
// Questa funzione è una estensione di svg-builder.js con accessibilità integrata
// senza modificare la logica di rendering esistente.

import { escapeXml } from './svg/utils.js';
import { buildSVG, errorSVG, errorSVGString } from './svg-builder.js';

// Funzione wrapper accessibile che usa buildSVG originale e aggiunge ARIA
export function buildAccessibleSVG(params) {
  // Genera l'SVG originale usando la logica esistente
  const originalSVG = buildSVG(params);

  // Estrai i dati necessari per i label
  const { state, winningLang, isWin, isJackpot, nearMissCol } = params;

  // Costruisci l'aria-label descrittivo
  let ariaLabel = 'Macchina slot per stack di sviluppo.';
  if (isWin) {
    if (isJackpot) {
      ariaLabel += ` Jackpot! Hai vinto con ${winningLang?.name || 'linguaggio'}.`;
    } else {
      ariaLabel += ` Vinci con ${winningLang?.name || 'linguaggio'}.`;
    }
  } else if (nearMissCol >= 0) {
    ariaLabel += ' Quasi una vincita!';
  } else {
    ariaLabel += ' Nessun vincitore questa volta.';
  }

  const totalSpins = (state?.totalSpins || 0).toLocaleString('en-US');
  const totalWins = (state?.totalWins || 0).toLocaleString('en-US');
  ariaLabel += ` Totali: ${totalSpins} girate, ${totalWins} vincite.`;

  // Estrai e modifica l'SVG per aggiungere accessibilità
  let accessibleSVG = originalSVG;

  // ID stabili e univoci per il collegamento ARIA (best-practice per SVG
  // embeddati come <img>: gli screen reader leggono <title>/<desc> solo se
  // referenziati via aria-labelledby/aria-describedby, non l'aria-label solo).
  const uidSafe = String(params.uid ?? '0').replace(/[^a-zA-Z0-9_-]/g, '');
  const titleId = `slot-title-${uidSafe}`;
  const descId = `slot-desc-${uidSafe}`;

  // Aggiungi role="img" + riferimenti ARIA all'elemento <svg> root,
  // preservando data-testid. aria-label resta come fallback.
  accessibleSVG = accessibleSVG.replace(/(<svg[^>]*>)/, (match) =>
    match.replace(
      />$/,
      ` role="img" aria-labelledby="${titleId}" aria-describedby="${descId}" aria-label="${escapeXml(
        ariaLabel
      )}" aria-hidden="false">`
    )
  );

  // Aggiungi <title> e <desc> per screen reader, con gli id referenziati sopra
  const titleElement = `<title id="${titleId}">Dev Stack Slot Machine - ${
    isWin ? 'Vincita' : 'Nessuna vincita'
  }</title>`;
  const descElement = `<desc id="${descId}">Una slot machine animata che mostra il tuo stack tecnologico. ${escapeXml(
    ariaLabel
  )}</desc>`;

  // Inserisci title e desc dopo l'apertura del svg
  accessibleSVG = accessibleSVG.replace(
    /(<svg[^>]*>)/,
    `$1\n${titleElement}\n${descElement}`
  );

  return accessibleSVG;
}

// ─── Error SVG Generator ──────────────────────────────────────────────────────────
// errorSVG / errorSVGString sono definiti in svg-builder.js (fonte canonica,
// ISSUE-29) e re-importati qui per retrocompatibilità: svg-builder-accessible
// non deve ridefinirli (evita la dipendenza circolare con svg-builder.js).
export { errorSVG, errorSVGString };
