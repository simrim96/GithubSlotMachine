// ─── SVG Module Index ────────────────────────────────────────────────────────────
// Export centralizzati per tutti i moduli SVG

// Core utilities
export { escapeXml, wrap } from './utils-extended.js';

// Constants
export { 
  CW, CH, GAP, SVG_W, SVG_H, HDR_H, HDR_TOP, 
  DUR, NM_DUR_EXTRA_LAST, PT_H 
} from './constants.js';

// Coordinates
export { 
  getMX, getGY, colL, cellY, getMX as MX, getGY as Y 
} from './coordinates.js';

// Analysis
export { analyzeResult } from './analysis.js';

// Generators
export { generateCSS } from './css.js';
export { generateDefs } from './defs.js';
export { generateMarqueeBulbs } from './marquee.js';
export { generateReels } from './reels.js';
export { generateWinEffects } from './effects.js';
export { generateResultPanel } from './panel.js';
export { generateJackpotOverlay } from './jackpot.js';
export { generateHeader } from './header.js';
export { generateCabinet } from './cabinet.js';
export { generateScreenFrame } from './screen.js';
export { generatePaytable } from './paytable.js';

// Main build function (re-exports from svg-builder.js)
// Note: svg-builder.js is the main entry point, this is just for convenience
export { buildSVG } from './svg-builder.js';
