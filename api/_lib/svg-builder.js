// ─── SVG Generator (Main Entry Point) ────────────────────────────────────────────
// buildSVG è una funzione pura: stessi input → stesso output.
// Architettura modulare con funzioni separate per ogni sezione SVG.

import {
  LANGUAGES,
  WILD_ID,
  SCATTER_ID,
  LANGUAGE_BY_ID,
  buildSymbolDefs,
  symbolUse,
} from './languages.js';
import { COLS, ROWS } from './game.js';
import { escapeXml } from './svg/utils.js';
import { errorSVG as errorSVGAccessible } from './svg-builder-accessible.js';

// Re-export errorSVG and escapeXml for backward compatibility
export { errorSVGAccessible as errorSVG, escapeXml };

// Importa tutti i moduli
import { analyzeResult } from './svg/analysis.js';
import { generateCSS } from './svg/css.js';
import { generateDefs } from './svg/defs.js';
import { generateMarqueeBulbs } from './svg/marquee.js';
import { generateReels } from './svg/reels.js';
import { generateWinEffects } from './svg/effects.js';
import { generateResultPanel } from './svg/panel.js';
import { generateJackpotOverlay } from './svg/jackpot.js';
import { generateHeader } from './svg/header.js';
import { generateCabinet } from './svg/cabinet.js';
import { generateScreenFrame } from './svg/screen.js';
import { generatePaytable } from './svg/paytable.js';

// Constants e coordinate
import { SVG_W, SVG_H } from './svg/constants.js';

// ─── Main Build Function ──────────────────────────────────────────────────────────
export function buildSVG({
  grid,
  uid,
  state,
  winningLang,
  fact,
  repoMatch,
  owner = 'simrim96',
}) {
  // Analyze result
  const result = analyzeResult(grid, state, winningLang);
  
  // Generate all components
  const css = generateCSS(uid, result);
  const defs = generateDefs(uid, winningLang);
  const marqueeBulbs = generateMarqueeBulbs(uid, result.isWin, result.ED);
  const { colBGs, reelsSvg, colBordersSvg, nmShineSvg } = generateReels(uid, grid, result.nearMissCol, result.ED);
  const { winGlowSvg, nearMissSvg, coinsSvg } = generateWinEffects(uid, result.winCells, result.nearMissCol, result.ED, result.isBigWin, result.isJackpot);
  const panelSvg = generateResultPanel(uid, result.isWin, winningLang, fact, repoMatch, owner, result.ED, result);
  const overlaySvg = result.isJackpot ? generateJackpotOverlay(uid, winningLang, result.ED) : '';
  const headerSvg = generateHeader(uid, state);
  const cabinetSvg = generateCabinet(uid);
  const screenFrameSvg = generateScreenFrame(uid, result.isWin, result.ED, result.nearMissCol);
  const paytableSvg = generatePaytable(uid, result.isWin ? winningLang : null);
  
  // Border
  const borderAttr = result.isJackpot
    ? `stroke="#ffd700" stroke-width="3" style="animation:jb${uid} .3s ${result.ED}s infinite"`
    : result.isWin
      ? `stroke="#16a34a" stroke-width="2.5"`
      : `stroke="#3a3666" stroke-width="2"`;
  
  // Assemble SVG
  const GY = ROWS * 84 + 150; // getGY() simplified
  const GW = COLS * 84 + (COLS - 1) * 8;
  const GH = ROWS * 84;
  
  return `<?xml version="1.0" encoding="utf-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" style="background:#171530">
<defs>
<style>${css}</style>
${defs}
</defs>
${cabinetSvg}
${headerSvg}
<g clip-path="url(#paytable)">
<rect x="120" y="${124}" width="360" height="${112}" rx="12" fill="#13122d" stroke="#4ecdc4" stroke-width="1.5"/>
<text x="300" y="${152}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#4ecdc4">PAYTABLE</text>
<text x="300" y="${166}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="8.5" fill="#8b8baf">More dots = more mastery</text>
${paytableSvg}
</g>
${screenFrameSvg}
<g clip-path="url(#screen)">
${marqueeBulbs}
${colBGs}
${reelsSvg}
${colBordersSvg}
${nmShineSvg}
${winGlowSvg}
${nearMissSvg}
${coinsSvg}
${overlaySvg}
</g>
${panelSvg}
</svg>`;
}
