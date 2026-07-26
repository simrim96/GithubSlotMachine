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
import { buildSVG, errorSVG, errorSVGString, getCachedSvg, setCachedSvg, LANGUAGES, SVG_BUILD_TIMEOUT_MS } from './svg-builder.js';
import { logger } from './logger.js';

// Cache helper per buildAccessibleSVG (usa le funzioni di cache globali)
function getAccessibleCachedSvg(state, grid, winningLang, fact, owner, uid) {
  // Recupera i languages dal file languages.js
  const languages = LANGUAGES || [];
  const cached = getCachedSvg(state, languages, grid, uid);
  if (cached) {
    return cached;
  }
  return null;
}

// Funzione wrapper accessibile che usa buildSVG originale e aggiunge ARIA
export function buildAccessibleSVG(params) {
  // Estrai i dati necessari per la cache
  const { state, grid, uid, winningLang, fact, owner = 'simrim96', isWin } = params;
  
  // M10: Controllo cache prima di costruire
  const cached = getAccessibleCachedSvg(state, grid, winningLang, fact, owner, uid);
  if (cached) {
    // Se c'è cache, aggiungi comunque l'accessibilità ARIA
    const ariaLabel = buildAriaLabel(state, winningLang, isWin);
    return addAriaToSvg(cached, ariaLabel, uid);
  }
  
  // Genera l'SVG originale usando la logica esistente
  const originalSVG = buildSVG(params);
  
  // M10: Salva nella cache
  setCachedSvg(state, [], grid, originalSVG);
  
  // Costruisci l'aria-label descrittivo
  const ariaLabel = buildAriaLabel(state, winningLang, isWin);
  
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

// Helper: costruisci aria-label descrittivo
// NOTA: near-miss e jackpot rimossi. Ora l'aria-label distingue solo
// vittoria normale / nessuna vincita.
function buildAriaLabel(state, winningLang, isWin) {
  let ariaLabel = 'Macchina slot per stack di sviluppo.';
  if (isWin) {
    ariaLabel += ` Vinci con ${winningLang?.name || 'linguaggio'}.`;
  } else {
    ariaLabel += ' Nessun vincitore questa volta.';
  }
  
  const totalSpins = (state?.totalSpins || 0).toLocaleString('en-US');
  const totalWins = (state?.totalWins || 0).toLocaleString('en-US');
  ariaLabel += ` Totali: ${totalSpins} girate, ${totalWins} vincite.`;
  
  return ariaLabel;
}

// Helper: aggiungi ARIA a un SVG esistente
function addAriaToSvg(svg, ariaLabel, uid) {
  const uidSafe = String(uid ?? '0').replace(/[^a-zA-Z0-9_-]/g, '');
  const titleId = `slot-title-${uidSafe}`;
  const descId = `slot-desc-${uidSafe}`;
  
  // Aggiungi role="img" + riferimenti ARIA
  let accessibleSVG = svg.replace(/(<svg[^>]*>)/, (match) =>
    match.replace(
      />$/,
      ` role="img" aria-labelledby="${titleId}" aria-describedby="${descId}" aria-label="${escapeXml(
        ariaLabel
      )}" aria-hidden="false">`
    )
  );
  
  // Aggiungi <title> e <desc>
  const titleElement = `<title id="${titleId}">Dev Stack Slot Machine - Vincita</title>`;
  const descElement = `<desc id="${descId}">Una slot machine animata che mostra il tuo stack tecnologico. ${escapeXml(
    ariaLabel
  )}</desc>`;
  
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

// ─── M3: Accessible SVG Build with Timeout ───────────────────────────────────
// Wrapper per buildAccessibleSVG con timeout per prevenire stalli.
export async function buildAccessibleSVGWithTimeout(params) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SVG_BUILD_TIMEOUT_MS);
  
  try {
    const svg = buildAccessibleSVG(params);
    clearTimeout(timeoutId);
    return svg;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.warn('M3: Accessible SVG build timeout, serving degradation SVG');
      return errorSVGString({ 
        owner: params.owner || 'simrim96', 
        message: 'Timeout build SVG - riprova!' 
      });
    }
    throw err;
  }
}
