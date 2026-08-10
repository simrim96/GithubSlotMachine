// ─── Header Generator ────────────────────────────────────────────────────────────
// Genera l'header della slot machine

import { SVG_W, HDR_H, HDR_TOP } from './constants.js';

// Larghezze misurate delle etichette dell'header (font-size 8.5, weight 700,
// letter-spacing 1.2, sui fallback sans-serif del font stack — Liberation /
// Noto / Adwaita Sans bold): 97px per "COMMUNITY SPINS", 26px per "WINS".
// Coerenti entro ±1px sui tre font, quindi robuste anche dove 'Segoe UI'
// non esiste. Servono per centrare il VALORE sotto la propria etichetta
// (text-anchor="middle" sul centro dell'etichetta) senza spostare le
// etichette dai bordi (design originale: sinistra x=50, destra x=SVG_W-50).
const SPINS_LABEL_W = 97;
const WINS_LABEL_W = 26;
const SPINS_VALUE_X = 50 + SPINS_LABEL_W / 2; // 98.5 = centro etichetta SINISTRA
const WINS_VALUE_X = SVG_W - 50 - WINS_LABEL_W / 2; // 537 = centro etichetta DESTRA

export function generateHeader(uid, state, result, winningLang) {
  const total = (state?.totalSpins || 0).toLocaleString('en-US');
  const wonTotal = (state?.totalWins || 0).toLocaleString('en-US');

  // Counter WINS ritardato: spin.js incrementa state.totalWins PRIMA di
  // buildSVG, quindi il valore "nuovo" è già in `state`. Per non far
  // prevedere la vincita prima che i rulli si fermino, durante la
  // rotazione mostriamo il valore PRECEDENTE (totalWins - 1) e solo a
  // rotazione terminata (delay = ED, come il glow e il ring della
  // paytable) animiamo il passaggio al nuovo valore: il vecchio esce
  // (fade + slide-up) mentre il nuovo entra da sotto (keyframes
  // co${uid}/ci${uid} in css.js).
  //
  // PRINCIPIO "base = stato finale" (come i rulli): senza animazioni CSS
  // (anteprima statica di GitHub, screenshot, img in client senza
  // animazioni) deve restare visibile il valore NUOVO corretto. Per
  // questo le opacità di BASE sono invertite rispetto a ciò che si vede
  // durante la rotazione:
  //   • testo vecchio → opacity:0 di base, reso VISIBILE da 0→ED dal
  //     backwards-fill di co (from{opacity:1}) in un browser;
  //   • testo nuovo → opacity:1 di base, reso NASCOSTO da 0→ED dal
  //     backwards-fill di ci (from{opacity:0}).
  // Con animation-fill-mode:both il keyframe `from` vale anche durante
  // il delay: in un browser il counter mostra il valore precedente per
  // tutta la rotazione e scatta al nuovo a ED; in un rendering statico
  // resta visibile il valore nuovo.
  //
  // NOTA: l'animazione scatta SOLO quando il contatore è stato davvero
  // incrementato, cioè quando winningLang è truthy (stessa condizione di
  // spin.js: un payline di soli WILD non incrementa totalWins anche se
  // checkWins riporta una win). Usare result.isWin qui mostrerebbe un
  // fantasma +1 su quella vincita "muta".
  const countsAsWin = Boolean(winningLang);
  const ED = result?.ED ?? 0;

  let winsText;
  if (countsAsWin && (state.totalWins || 0) > 0) {
    const prevWins = ((state.totalWins || 0) - 1).toLocaleString('en-US');
    const outDelay = ED.toFixed(2);
    const inDelay = (ED + 0.06).toFixed(2);
    winsText =
      `<text x="${WINS_VALUE_X}" y="${HDR_TOP + 68}" text-anchor="middle" font-size="14" font-weight="800" fill="#4ade80" style="opacity:0;animation:co${uid} .5s ${outDelay}s both">${prevWins}</text>` +
      `<text x="${WINS_VALUE_X}" y="${HDR_TOP + 68}" text-anchor="middle" font-size="14" font-weight="800" fill="#4ade80" style="opacity:1;animation:ci${uid} .5s ${inDelay}s both">${wonTotal}</text>`;
  } else {
    winsText = `<text x="${WINS_VALUE_X}" y="${HDR_TOP + 68}" text-anchor="middle" font-size="14" font-weight="800" fill="#4ade80">${wonTotal}</text>`;
  }

  return `<rect x="32" y="${HDR_TOP}" width="${SVG_W - 64}" height="${HDR_H - 6}" rx="14" fill="#13122d" opacity="0.92" stroke="#7a4400" stroke-width="1.2"/>
<text x="${SVG_W / 2}" y="${HDR_TOP + 22}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="19" font-weight="800" fill="url(#hdr${uid})" filter="url(#glow${uid})">DEV STACK SLOT MACHINE</text>
<text x="${SVG_W / 2}" y="${HDR_TOP + 36}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="8.5" fill="#8b8baf" letter-spacing="2.6">SPIN · LEARN · DISCOVER MY PROJECTS</text>
<g font-family="'Segoe UI',sans-serif">
  <text x="50" y="${HDR_TOP + 53}" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">COMMUNITY SPINS</text>
  <text x="${SPINS_VALUE_X}" y="${HDR_TOP + 68}" text-anchor="middle" font-size="14" font-weight="800" fill="#ffd700">${total}</text>
  <text x="${SVG_W - 50}" y="${HDR_TOP + 53}" text-anchor="end" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">WINS</text>
  ${winsText}
</g>`;
}
