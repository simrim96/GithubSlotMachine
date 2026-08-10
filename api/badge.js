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
import { kvGet, kvEnabled } from './_lib/kv.js';
// escapeXml leggero per il testo dentro l'SVG (defense-in-depth).
import { escapeXml } from './_lib/svg/utils.js';

// Delay (s) prima che il badge compaia: > durata max rulli (6.2s).
const BADGE_DELAY_S = 6.5;
// Durata (s) dell'animazione di entrata.
const BADGE_ANIM_S = 0.9;

// ─── Self-validation contro lo stato corrente ─────────────────────────────
// FIX "pulsante su spin perdente": il badge vive nel README, ma il README
// può essere STALE (GitHub cachea il render, la PUT asincrona può fallire).
// Un badge vecchio — scritto da una vincita PRECEDENTE — resterebbe visibile
// anche dopo uno spin perdente, simulando una vincita inesistente.
// Qui l'endpoint si autovalida: serve il contenuto SOLO se l'ULTIMO spin è
// stata una vincita che corrisponde alla richiesta (stesso spinStart ?v e
// stesso linguaggio). Altrimenti serve un SVG VUOTO → niente pulsante
// fantasma, anche se il README embeddato è ancora cacheato.
const STATE_KEY = 'gsm:state';
const OWNER =
  process.env.PROFILE_REPO_OWNER || process.env.GITHUB_OWNER || 'simrim96';
const SLOT_REPO = process.env.SLOT_REPO || 'GithubSlotMachine';

// Legge lo stato corrente: KV prima (veloce), poi state.json pubblico come
// fallback (stesso pattern di lever.js). Ritorna null se nessuna fonte
// risponde — in tal caso il chiamante decide il comportamento.
async function getCurrentState() {
  if (kvEnabled) {
    try {
      const state = await kvGet(STATE_KEY);
      if (state) return state;
    } catch (e) {
      logger.warn('badge: KV state read failed, fallback raw', {
        error: e?.message,
      });
    }
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800);
    const res = await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${SLOT_REPO}/main/state.json`,
      { cache: 'no-store', signal: controller.signal }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    logger.warn('badge: raw state read failed', { error: e?.message });
    return null;
  }
}

// Il badge è valido SOLO se l'ultimo spin è stata una vincita coerente con
// la richiesta. lastPullTimestamp si aggiorna a OGNI spin; lastWin.ts solo
// su vincita → se sono uguali, l'ultimo spin HA vinto. Il ?v della richiesta
// deve combaciare con quello della vincita (un badge più vecchio, anche se
// embeddato in un README cacheato, viene scartato).
export function isBadgeValidForCurrentSpin(state, v, lang) {
  if (!state || !state.lastWin) return false;
  const lastPull = Number(state.lastPullTimestamp);
  const lastWinTs = Number(state.lastWin.ts);
  if (!Number.isFinite(lastPull) || !Number.isFinite(lastWinTs)) return false;
  if (lastPull !== lastWinTs) return false; // ultimo spin NON vincente
  const spinV = v == null || v === '' ? NaN : Number(v);
  if (Number.isFinite(spinV) && spinV !== lastWinTs) return false;
  const langName = state.lastWin.langName || state.lastWin.langId || '';
  if (lang && langName && safeLang(langName) !== safeLang(String(lang)))
    return false;
  return true;
}

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

  // ── Self-validation contro lo stato corrente ────────────────────────────
  // FIX "pulsante su spin perdente": se l'ULTIMO spin NON è stata una
  // vincita coerente con questo badge (?v e lang), serve un SVG VUOTO così
  // il pulsante non compare mai su spin perdenti — anche quando il README
  // embeddato è ancora cacheato con un badge vecchio. Se lo stato non è
  // leggibile (KV + GitHub giù) serve comunque il badge normale: meglio un
  // falso positivo che spezzare la vincita reale in un'outage.
  let badgeAllowed = true;
  try {
    const state = await getCurrentState();
    if (
      state &&
      !isBadgeValidForCurrentSpin(state, req.query?.v, req.query?.lang)
    ) {
      badgeAllowed = false;
    }
  } catch (e) {
    logger.warn('badge: self-validation failed, serving badge anyway', {
      error: e?.message,
    });
  }
  if (!badgeAllowed) {
    // SVG vuoto con le stesse dimensioni del badge reale: il README mantiene
    // il layout (width 340) ma non mostra alcun pulsante.
    const emptySvg = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="340" height="84" viewBox="0 0 340 84" role="img" aria-label=""></svg>`;
    return sendResponse(res, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-store',
      },
      body: emptySvg,
    });
  }

  const lang = safeLang(req.query?.lang);
  // Stelle della repo vincente (passate da updateReadmeMarkers come &stars=).
  // Sanitizzate a intero ≥0, clamp a 6 cifre (evita width assurde).
  const starsRaw = parseInt(req.query?.stars, 10);
  const stars =
    Number.isFinite(starsRaw) && starsRaw > 0 ? Math.min(starsRaw, 999999) : 0;
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
    <text x="${W / 2 + 14}" y="${H / 2 + 6}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="17" font-weight="700" fill="#f3f1ff">${escapeXml(message)}</text>
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
