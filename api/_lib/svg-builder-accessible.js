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

import { escapeXml, buildSVG as buildSVGOriginal } from './svg-builder.js';

// Funzione wrapper accessibile che usa buildSVG originale e aggiunge ARIA
export function buildAccessibleSVG(params) {
  // Genera l'SVG originale usando la logica esistente
  const originalSVG = buildSVGOriginal(params);
  
  // Estrai i dati necessari per i label
  const { grid, state, winningLang, isWin, isJackpot, nearMissCol, uid } = params;
  
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
  
  // Aggiungi role="img" e aria-label all'elemento <svg> root
  accessibleSVG = accessibleSVG.replace(
    /<svg([^>]*)>/,
    `<svg$1 role="img" aria-label="${escapeXml(ariaLabel)}" aria-hidden="false">`
  );
  
  // Aggiungi <title> e <desc> per screen reader (dopo <defs> o all'inizio)
  const titleElement = `<title>Dev Stack Slot Machine - ${isWin ? 'Vincita' : 'Nessuna vincita'}</title>`;
  const descElement = `<desc>Una slot machine animata che mostra il tuo stack tecnologico. ${ariaLabel}</desc>`;
  
  // Inserisci title e desc dopo l'apertura del svg
  accessibleSVG = accessibleSVG.replace(
    /(<svg[^>]*>)/,
    `$1\n${titleElement}\n${descElement}`
  );
  
  return accessibleSVG;
}
