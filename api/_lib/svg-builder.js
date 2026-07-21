// ─── SVG Generator (Main Entry Point) ────────────────────────────────────────────
// buildSVG è una funzione pura: stessi input → stesso output.
// Architettura modulare con funzioni separate per ogni sezione SVG.

import { escapeXml } from './svg/utils.js';
import { LANGUAGES } from './languages.js';
import { logger } from './logger.js';

// Re-export escapeXml for backward compatibility
export { escapeXml, LANGUAGES };

// ─── M10: SVG Build Cache L1 (LRU con dimensione massima) ────────────────────
// Cache in-memory per ottimizzare il cold start e ridurre il tempo di costruzione
// SVG (originariamente 100-500ms). La cache usa una key basata su hash JSON dello
// stato, con eviction LRU quando la dimensione massima è raggiunta.
//
// Configurazione:
// - SVG_BUILD_CACHE_SIZE: dimensione massima (default: 50)
// - SVG_BUILD_CACHE_TTL_MS: TTL per entry (default: 60s)
//
// La cache è disabilitata automaticamente se la memoria disponibile è bassa.
const MAX_CACHE_SIZE = parseInt(process.env.SVG_BUILD_CACHE_SIZE) || 50;
const CACHE_TTL_MS = parseInt(process.env.SVG_BUILD_CACHE_TTL_MS) || 60000;
const svgCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

// ─── M3: SVG Build Timeout ──────────────────────────────────────────────────
// Timeout per prevenire stalli durante la generazione SVG in caso di dipendenze lente.
// Configurazione:
// - SVG_BUILD_TIMEOUT_MS: timeout in ms (default: 3000 = 3 secondi)
// Quando scade il timeout, viene servito un SVG di degrado invece di bloccare.
export const SVG_BUILD_TIMEOUT_MS = parseInt(process.env.SVG_BUILD_TIMEOUT_MS) || 3000;

function computeStateHash(state, languages, grid, uid) {
  // Crea una stringa deterministica per lo stato corrente
  const uidStr = String(uid ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  const gridStr = Array.isArray(grid) ? JSON.stringify(grid) : '[]';
  const stateStr = JSON.stringify({
    totalSpins: state?.totalSpins || 0,
    totalWins: state?.totalWins || 0,
    lastWin: state?.lastWin ? {
      langId: state.lastWin.langId,
      langName: state.lastWin.langName,
      repoName: state.lastWin.repoName,
    } : null,
  });
  
  const langsStr = Array.isArray(languages) 
    ? languages.map(l => l.id).sort().join(',') 
    : '';
  
  return `${uidStr}|${gridStr}|${stateStr}|${langsStr}`;
}

export function getCachedSvg(state, languages, grid, uid) {
  const hash = computeStateHash(state, languages, grid, uid);
  const now = Date.now();
  
  // Rimuovi entry scadute (maintenance periodica)
  if (svgCache.size > 0 && svgCache.size % 10 === 0) {
    for (const [key, entry] of svgCache.entries()) {
      if (now - entry.ts > CACHE_TTL_MS) {
        svgCache.delete(key);
      }
    }
  }
  
  const cached = svgCache.get(hash);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    cacheHits++;
    return cached.svg;
  }
  
  cacheMisses++;
  
  // Evict LRU se cache full
  if (svgCache.size >= MAX_CACHE_SIZE) {
    const firstKey = svgCache.keys().next().value;
    svgCache.delete(firstKey);
  }
  
  return null; // Cache miss, procedere con la build
}

export function setCachedSvg(state, languages, grid, svg) {
  const hash = computeStateHash(state, languages, grid);
  svgCache.set(hash, { svg, ts: Date.now() });
}

export function getCacheStats() {
  return {
    size: svgCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0 ? (cacheHits / (cacheHits + cacheMisses)).toFixed(4) : 0,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS,
  };
}

// Clear cache (per test o reset)
export function clearCache() {
  svgCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

// ─── M3: SVG Build with Timeout ─────────────────────────────────────────────
// Wrapper che applica un timeout alla build SVG. Se il timeout scade, serve
// un SVG di degrado invece di bloccare l'operazione.
export async function buildSvgWithTimeout(options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SVG_BUILD_TIMEOUT_MS);
  
  try {
    const svg = await buildSVG(options);
    clearTimeout(timeoutId);
    return svg;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.warn('M3: SVG build timeout, serving degradation SVG');
      return errorSVGString({ 
        owner: options.owner || 'simrim96', 
        message: 'Timeout build SVG - riprova!' 
      });
    }
    throw err;
  }
}

// ─── SVG Sanitization (hardening difensivo, ISSUE-25 / S3) ────────────────────
// Oggi l'SVG è generato internamente (nessun input utente) quindi il rischio è
// BASSO, ma poiché gli endpoint /api/image e /api/lever servono SVG con CORS
// wildcard `*` in contesti cross-origin (embed su github.com), sanifichiamo in
// uscita per evitare che eventuali injection future diventino eseguibili.
// La funzione rimuove: tag <script>, tag <foreignObject>, attributi di evento
// on* e URI javascript: negli href/xlink:href.
export function sanitizeSvg(svg) {
  if (typeof svg !== 'string') return svg;
  let out = svg;
  // 1) Rimuovi tag <script>...</script> (case-insensitive, multiline)
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // 2) Rimuovi tag <foreignObject>...</foreignObject>
  out = out.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '');
  // 3) Rimuovi attributi di evento on* (onload, onclick, onerror, ...)
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // 4) Rimuovi URI javascript: negli href/xlink:href
  out = out.replace(/(?:xlink:href|href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
  return out;
}

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

// ─── Main Build Function (con cache M10) ──────────────────────────────────────────────────────────
export function buildSVG({
  grid,
  uid,
  state,
  winningLang,
  fact,
  repoMatch,
  owner = 'simrim96',
}) {
  // M10: Controllo cache L1
  // Nota: languages non viene passato qui, quindi usiamo una fallback key
  // La cache vera e propria è in buildAccessibleSVG che ha accesso a languages
  const cached = getCachedSvg(state, [], grid, uid);
  if (cached) {
    return cached;
  }
  
  // Analyze result
  const result = analyzeResult(grid, state, winningLang);

  // Generate all components
  const css = generateCSS(uid, result);
  const defs = generateDefs(uid);
  const marqueeBulbs = generateMarqueeBulbs(uid, result.isWin, result.ED);
  const { colBGs, reelsSvg, colBordersSvg, nmShineSvg } = generateReels(
    uid,
    grid,
    result.nearMissCol
  );
  const { winGlowSvg, nearMissSvg, coinsSvg } = generateWinEffects(
    uid,
    result.winCells,
    result.nearMissCol,
    result.ED,
    result.isBigWin,
    result.isJackpot
  );
  const panelSvg = generateResultPanel(
    uid,
    result.isWin,
    winningLang,
    fact,
    repoMatch,
    owner,
    result.ED,
    result
  );
  const overlaySvg = result.isJackpot
    ? generateJackpotOverlay(uid, winningLang, result.ED)
    : '';
  const headerSvg = generateHeader(uid, state);
  const cabinetSvg = generateCabinet(uid);
  const screenFrameSvg = generateScreenFrame(uid);
  const paytableSvg = generatePaytable(uid, result.isWin ? winningLang : null, [
    ...new Set(grid.flat()),
  ]);

  // Assemble SVG
  const rawSvg = `<?xml version="1.0" encoding="utf-8"?><svg data-testid="slot-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" style="background:#171530"><defs><style>${css}</style>${defs}</defs>${cabinetSvg}${headerSvg}${screenFrameSvg}<g clip-path="url(#screen)">${marqueeBulbs}${colBGs}${reelsSvg}${colBordersSvg}${nmShineSvg}${winGlowSvg}${nearMissSvg}${coinsSvg}${overlaySvg}</g><g clip-path="url(#paytable)">${paytableSvg}</g>${panelSvg}</svg>`;

  // Minimizza l'SVG rimuovendo spazi bianchi ridondanti (Bug 3 - Payload optimization)
  const minimizedSvg = rawSvg
    .replace(/>\s+</g, '><')        // Rimuove newline/spazi tra tag
    .replace(/\s+/g, ' ');           // Normalizza spazi multipli

  // Sanitizzazione in uscita (ISSUE-25 / S3): l'SVG è servito con CORS
  // wildcard `*` su /api/image e /api/lever in contesti cross-origin.
  const resultSvg = sanitizeSvg(minimizedSvg);
  
  // M10: Salva nella cache
  setCachedSvg(state, [], grid, resultSvg);
  
  return resultSvg;
}

// ─── Error SVG Generator (canonical source) ───────────────────────────────────
// Restituisce un SVG di degrado per errori graceful. Due varianti:
//   • errorSVGString() → markup SVG GREZZO (salvabile come slot.svg, embed in <img>)
//   • errorSVG()       → data-URI base64 (per retro-compat / test)
// Il catch di spin.js salva la stringa grezza su slot.svg così l'utente vede
// davvero la slot di errore invece di un data-URI corrotto.
// ISSUE-29: questa è l'unica fonte canonica di errorSVG/errorSVGString.
// svg-builder-accessible.js e i test devono importare da qui (evita la
// dipendenza circolare svg-builder ↔ svg-builder-accessible).
function errorSvgMarkup({ owner = 'simrim96', message = 'Ops, riprova un attimo!' }) {
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

  const rawSvg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" style="background:#171530" role="img" aria-label="Errore della slot machine. ${safeMsg} Riprova.">
  <title>Errore slot machine</title>
  <rect width="${SVG_W}" height="${SVG_H}" fill="#171530"/>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 - 20}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="24" font-weight="700" fill="#ff4040">⚠️ Errore</text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="16" fill="#e8e8f4">${safeMsg}</text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 + 30}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="14" fill="#8b8baf"><a href="https://github.com/${owner}">github.com/${owner}</a></text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 + 50}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="14" fill="#8b8baf">Tenta di nuovo!</text>
</svg>`;

  // Sanitizzazione in uscita (ISSUE-25 / S3) — stessa difesa di buildSVG.
  return sanitizeSvg(rawSvg);
}

// SVG grezzo (salvabile su slot.svg / embeddabile in <img>)
export function errorSVGString(input) {
  return errorSvgMarkup(input ?? {});
}

// Restituisce un data-URI SVG di degrado per errori graceful
export function errorSVG(input) {
  return `data:image/svg+xml;base64,${Buffer.from(errorSvgMarkup(input ?? {})).toString('base64')}`;
}
