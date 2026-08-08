// ─── Badge endpoint (SVG animato della vittoria) ────────────────────────────
// Genera l'SVG "check out this repo I wrote in <linguaggio>" usato nel README
// del profilo al posto del vecchio link markdown. L'SVG è wrappato lato README
// in <a href="<repo url>"><img src="/api/badge?v=...&lang=..."/></a>, così
// l'immagine risulta cliccabile verso la repo vincente.
//
// Animazione: parte INVISIBILE (opacity:0) e diventa visibile solo DOPO la
// rotazione dei rulli. La colonna più lenta finisce a DUR[4] = 6.2s (vedi
// api/_lib/svg/constants.js), quindi il delay è volutamente un pelo superiore
// (6.5s) così il badge entra "leggermente dopo" i rulli, come richiesto.
// L'entrata non è un semplice fade ma un pop con slide+scale (badgeIn).
//
// Nota sull'SVG in <img>: le animazioni CSS interne FUNZIONANO quando l'SVG è
// servito come <img> (contesto img), quindi il badge si anima davvero nel
// README. GitHub proxyfa l'immagine via camo ma il contenuto (SVG + CSS) viene
// preservato e il ?v univoco per spin forza il refetch → l'animazione parte da 0.

import { applyCorsWildcard } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { logger } from './_lib/logger.js';
import { badgeCooldown } from './_lib/badge-cooldown.js';
// escapeXml leggero per il testo dentro l'SVG (defense-in-depth).
import { escapeXml } from './_lib/svg/utils.js';

// Delay (s) prima che il badge compaia: > durata max rulli (6.2s).
const BADGE_DELAY_S = 6.5;
// Durata (s) dell'animazione di entrata.
const BADGE_ANIM_S = 0.9;

// Sanitizza il linguaggio proveniente dai query param (testo non fidato a
// tutti gli effetti, anche se noi stessi lo scriviamo nel README). Toglie
// caratteri pericolosi per HTML/XML e tronca a 24 char.
function safeLang(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[<>&"']/g, '')
    .trim()
    .slice(0, 24);
  return s || 'code';
}

export default async function handler(req, res) {
  applyCorsWildcard(req, res);
  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }

  // Rate-limit per-IP: 1 badge ogni secondo dallo stesso IP (ISSUE-L1).
  const cooldown = badgeCooldown(req);
  if (!cooldown.allowed) {
    return sendResponse(res, {
      status: 429,
      headers: { 'Retry-After': '1' },
      body: JSON.stringify({ error: 'Too Many Requests — badge cooldown' }),
    });
  }

  const lang = safeLang(req.query?.lang);
  // Stelle della repo vincente (passate da updateReadmeMarkers come &stars=).
  // Sanitizzate a intero ≥0, clamp a 6 cifre (evita width assurde).
  const starsRaw = parseInt(req.query?.stars, 10);
  const stars =
    Number.isFinite(starsRaw) && starsRaw > 0
      ? Math.min(starsRaw, 999999)
      : 0;
  // La stella NON è più solo decorativa: riflette le stelle reali della repo.
  const prefix = stars > 0 ? `★ ${stars} · ` : '';
  const message = `${prefix}check out this repo I wrote in ${lang}`;

  // Larghezza snug in base al testo (font-size 17, ~9px/char + padding).
  const W = Math.max(320, Math.round(message.length * 9 + 84));
  const H = 84;
  // Margine orizzontale (px) lasciato LIBERO ai lati della pill: l'animazione
  // fa un piccolo overshoot (scale) e, senza questo margine, il contenuto
  // superava i bordi del viewBox e l'SVG (renderizzato come <img>) veniva
  // tagliato lateralmente. 10px bastano per l'overshoot ridotto a 1.02.
  const M = 10;

  const css = `
    <style>
      .badgeIn {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: center;
        animation: badgeIn ${BADGE_ANIM_S}s cubic-bezier(.2,.8,.3,1) ${BADGE_DELAY_S}s forwards;
      }
      @keyframes badgeIn {
        0%   { opacity: 0; transform: translateY(16px) scale(0.9); }
        65%  { opacity: 1; transform: translateY(-3px) scale(1.02); }
        100% { opacity: 1; transform: translateY(0)    scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .badgeIn { opacity: 1; animation: none; transform: none; }
      }
    </style>`;

  const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(message)}">
  <title>${escapeXml(message)}</title>${css}
  <g class="badgeIn">
    <defs>
      <linearGradient id="badgeBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2a2350"/>
        <stop offset="55%" stop-color="#1a1640"/>
        <stop offset="100%" stop-color="#3a1330"/>
      </linearGradient>
      <linearGradient id="badgeEdge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#e94560"/>
        <stop offset="100%" stop-color="#ffb454"/>
      </linearGradient>
    </defs>
    <!-- Pill di sfondo (lascia M px liberi ai lati per l'overshoot dell'animazione) -->
    <rect x="${M}" y="6" width="${W - 2 * M}" height="${H - 12}" rx="18" fill="url(#badgeBg)" stroke="url(#badgeEdge)" stroke-width="2"/>
    <!-- Stella d'accento a sinistra del testo (dentro il margine M) -->
    <path d="M${M + 22} ${H / 2 - 9} l2.6 5.3 5.9 0.9 -4.3 4.1 1 5.8 -5.2 -2.7 -5.2 2.7 1 -5.8 -4.3 -4.1 5.9 -0.9 z" fill="#ffd166" stroke="#ffe9a8" stroke-width="0.8"/>
    <!-- Testo del badge, centrato nel resto della pill -->
    <text x="${(W / 2) + 14}" y="${H / 2 + 6}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="17" font-weight="700" fill="#f3f1ff">${escapeXml(message)}</text>
  </g>
</svg>`;

  sendResponse(res, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      // no-store: l'SVG cambia a ogni spin (e ha animazione che deve replay).
      // Il ?v univoco nel README già busta la cache, ma no-store garantisce
      // il refetch anche lato camo/GitHub.
      'Cache-Control': 'no-store',
    },
    body: svg,
  });
}
