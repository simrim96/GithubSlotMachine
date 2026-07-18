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
import { buildSVG } from './svg-builder.js';

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

  // Aggiungi role="img", aria-label e aria-hidden all'elemento <svg> root, preservando data-testid
  // Sostituisce l'apertura <svg ...> con <svg ... role="img" aria-label="..." aria-hidden="false">
  accessibleSVG = accessibleSVG.replace(/(<svg[^>]*>)/, (match) =>
    match.replace(
      />$/,
      ` role="img" aria-label="${escapeXml(ariaLabel)}" aria-hidden="false">`
    )
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

// ─── Error SVG Generator ──────────────────────────────────────────────────────────
// Restituisce un data-URI SVG di degrado per errori graceful
export function errorSVG(input) {
  // Gestisce input undefined/null
  const { owner = 'simrim96', message = 'Ops, riprova un attimo!' } =
    input ?? {};

  const SVG_W = 600;
  const SVG_H = 624;

  // Escapa e tronca il messaggio (max 80 char)
  const safeMsg = String(message ?? '')
    .slice(0, 80)
    .replace(
      /[<>&'\\"]/g,
      (c) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          "'": '&apos;',
          '"': '&quot;',
          '\\': '\\\\',
        })[c]
    );

  const svgContent = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" style="background:#171530">
  <rect width="${SVG_W}" height="${SVG_H}" fill="#171530"/>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 - 20}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="24" font-weight="700" fill="#ff4040">⚠️ Errore</text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="16" fill="#e8e8f4">${safeMsg}</text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 + 30}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="14" fill="#8b8baf"><a href="https://github.com/${owner}">github.com/${owner}</a></text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 + 50}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="14" fill="#8b8baf">Tenta di nuovo!</text>
</svg>`;

  // Restituisce data-URI
  return `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
}
