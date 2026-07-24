// ─── Lever endpoint ──────────────────────────────────────────────────────────
// SVG della leva laterale di una slot machine. Stile coerente col cabinet
// (pomello rosso laccato, montatura cromata).
//
// Animazione "pull": quando la leva viene tirata (state.lastPullTimestamp recente),
// l'SVG mostra un'animazione CSS che parte con un "pull" verso il basso e
// ritorna gradualmente all'idle loop.
//
// Geometria semplificata per eliminare ogni glitch:
//   • L'asta è un singolo <line> con stroke-linecap="round" → nessun spigolo
//     può sbucare durante la rotazione del gruppo.
//   • Pomello, anello cromato e highlight sono ALLINEATI ESATTAMENTE sulla
//     retta pivot→tip e ruotano tutti insieme nel `leverArm`.
//   • Il bumper (mounting boss) resta FUORI dal gruppo che ruota → fisso
//     rispetto al cabinet.
//
// Layout: leva quasi verticale (delta x = 10px su delta y = 78px) → quindi
// "leggermente parallela" al fianco della slot, non più diagonale aggressiva.

import { applyCorsWildcard } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { kvGet } from './_lib/kv.js';
import { logger } from './_lib/logger.js';

const W = 60;
const H = 150;

// ── Base guida FRONTALE (ruotata 90°: dalla faccia della slot, verso l'utente) ──
// La leva esce dalla FACCIA FRONTALE della slot (non più dal fianco) e punta
// dritta verso l'utente. In prospettiva 2D (l'SVG è embeddato come <img>, il
// 3D CSS non è supportato) otteniamo il "verso l'utente" con: asta a trapezio
// (più larga vicino al pomello), pomello più grande in basso, e pull = scale-up
// + translateY verso il basso.
const BASE_X = 6, BASE_Y = 22, BASE_W = 48, BASE_H = 18; // piastra di montaggio
const BOC_CX = W / 2;                 // 30: centro boccola (foro da cui esce l'asta)
const BOC_CY = BASE_Y + BASE_H / 2;   // ~31: y della boccola
const BOC_RX = 7, BOC_RY = 4;         // foro ovale (visto di fronte)

// ── Asta (punta verso l'utente: trapezio, più larga vicino al pomello) ──
const ARM_TOP_W = 6;   // larghezza in alto (lontano, alla boccola)
const ARM_BOT_W = 15;  // larghezza in basso (vicino, al pomello)
const BALL_CX = BOC_CX; // asta centrata sull'asse verticale

// ── Pomello ──
const BALL_REST_CY = 98;   // y a riposo (lontano)
const BALL_REST_R = 11;    // raggio a riposo (lontano)
const BALL_PULL_CY = 112;  // y al picco del pull (più vicino all'utente)
const BALL_PULL_R = 15;    // raggio al picco del pull (più grande)

// Parametri animazione pull (2D, verso l'utente)
const PULL_SCALE = 1.2;    // ingrandimento al picco (più vicino)
const PULL_DROP = 9;       // traslazione verso il basso (fuori schermo) al picco

// Chiave KV per lo stato
const STATE_KEY = 'gsm:state';

// Owner/repo per leggere state.json pubblico (fonte di verità alternativa a ?v).
// Deve combaciare con quanto usato da spin.js (PROFILE_REPO / SLOT_REPO).
const OWNER = process.env.PROFILE_REPO_OWNER || process.env.GITHUB_OWNER || 'simrim96';
const SLOT_REPO = process.env.SLOT_REPO || 'GithubSlotMachine';

// Durate animazione in ms
const PULL_DURATION_MS = 500; // Durata della fase "pull" (aumentato da 300ms)
const IDLE_DELAY_MS = 0; // Dopo il pull, attesa prima di iniziare l'idle loop
const IDLE_LOOP_MS = 2000; // Durata del loop idle

// Finestra (ms) entro cui uno spin è considerato "recente" e la leva deve
// riprodurre l'animazione di pull prima di tornare all'idle loop.
// 30s copre il ritardo con cui GitHub refetcha l'SVG embeddata sul profilo
// e il rate-limit dell'API Contents (il README con ?v puo' non aggiornarsi
// subito ad ogni spin). Vedi nota in getPullState.
const PULL_RECENCY_WINDOW_MS = 30000;

// Legge lastPullTimestamp dallo state.json PUBBLICO su GitHub (raw, no token).
// spin.js aggiorna state.json a OGNI spin (commit). Questa è la fonte di
// verità indipendente dal README: anche se l'API Contents va in rate-limit
// e il ?v nel README si "blocca", qui leggiamo l'ultimo spin reale.
// Timeout corto: se GitHub è lento, skip e cascadiamo al fallback KV.
async function getLastPullFromRawGithub() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800);
    const res = await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${SLOT_REPO}/main/state.json`,
      { cache: 'no-store', signal: controller.signal }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.lastPullTimestamp || null;
  } catch {
    return null;
  }
}

// Determina se la leva deve riprodurre l'animazione di pull.
//
// ORDINE DELLE FONTI (le prime due sono SENZA rete, il percorso caldo resta
// veloce; la fetch raw è solo ultimo fallback):
//  1) ?v=<spinStart> nell'URL (scritto da spin.js nel README) -> deterministico,
//     primario. Funziona finché il README si aggiorna.
//  2) KV gsm:state -> fonte veloci e autorevole: spin.js scrive state.json/KV
//     (con lastPullTimestamp) a OGNI spin in parallelo prima del redirect
//     (vedi spin.js Promise.allSettled + state.js kvSet), INDEPENDENTEMENTE
//     dal rate-limit della README Contents API. Copre quindi il bug
//     "funziona 2-3 volte poi smette" senza alcuna chiamata di rete.
//  3) state.json PUBBLICO su GitHub (raw) -> fallback LENTO (40-800ms di rete)
//     usato solo se KV non è attivo (es. dev locale / chiamate dirette).
async function getPullState(req) {
  const now = Date.now();
  const withinWindow = (ts) =>
    ts && Number.isFinite(ts) && now - ts >= 0 && now - ts < PULL_RECENCY_WINDOW_MS;

  // 1) Fonte deterministica: timestamp di spin nell'URL (?v=spinStart)
  const vRaw = req?.query?.v;
  const spinV = typeof vRaw === 'string' ? parseInt(vRaw, 10) : 0;
  if (withinWindow(spinV)) {
    const timeSincePull = now - spinV;
    return {
      isPulling: true,
      pullPhase: timeSincePull < PULL_DURATION_MS,
      idlePhase: timeSincePull >= PULL_DURATION_MS + IDLE_DELAY_MS,
      timeSincePull,
      reason: 'recent_pull_url',
    };
  }

  // 2) Fonte veloce e autorevole: KV gsm:state (scritto a ogni spin da spin.js).
  //    Ordinata PRIMA della fetch raw così il percorso caldo non fa mai rete.
  try {
    const state = await kvGet(STATE_KEY);
    if (state?.lastPullTimestamp && withinWindow(state.lastPullTimestamp)) {
      const timeSincePull = now - state.lastPullTimestamp;
      return {
        isPulling: true,
        pullPhase: timeSincePull < PULL_DURATION_MS,
        idlePhase: timeSincePull >= PULL_DURATION_MS + IDLE_DELAY_MS,
        timeSincePull,
        reason: 'recent_pull_kv',
      };
    }
  } catch (err) {
    logger.warn('lever.js: error reading state', { error: err?.message || err });
  }

  // 3) Fallback LENTO: state.json pubblico su GitHub (raw). Solo se KV è vuoto
  //    o assente — non sul percorso caldo, per non appesantire la leva.
  try {
    const ghTs = await getLastPullFromRawGithub();
    if (withinWindow(ghTs)) {
      const timeSincePull = now - ghTs;
      return {
        isPulling: true,
        pullPhase: timeSincePull < PULL_DURATION_MS,
        idlePhase: timeSincePull >= PULL_DURATION_MS + IDLE_DELAY_MS,
        timeSincePull,
        reason: 'recent_pull_github',
      };
    }
  } catch (err) {
    logger.warn('lever.js: raw github state read failed', { error: err?.message || err });
  }

  return { isPulling: false, reason: 'no_recent_pull' };
}

// SVG statico: leva laterale di una slot machine
// Geometria dell'asta (trapezio: più larga vicino al pomello = più vicina
// all'utente). Coordinata y del lato alto = boccola; lato basso = pomello.
const _armTopY = BOC_CY;
const _armBotY = BALL_REST_CY - BALL_REST_R + 2; // sbuca appena dentro il pomello
const _armTopHalf = ARM_TOP_W / 2;
const _armBotHalf = ARM_BOT_W / 2;

const LEVER_SVG_TEMPLATE = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
  role="button" aria-label="Pulla la leva per girare la slot machine" tabindex="0">
  <title>Leva slot machine</title>
  <desc>Elemento interattivo per avviare la rotazione dei rulli della slot machine.</desc>
  <defs>
    <!-- Pomello rosso laccato (stessi stop del cabinet) -->
    <radialGradient id="leverBall" cx="32%" cy="28%" r="78%">
      <stop offset="0%"  stop-color="#ff8a78"/>
      <stop offset="25%" stop-color="#e8331f"/>
      <stop offset="65%" stop-color="#c41e1e"/>
      <stop offset="100%" stop-color="#5a0606"/>
    </radialGradient>
    <radialGradient id="leverBallShine" cx="32%" cy="28%" r="22%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <!-- Cromature (boccola, anello) -->
    <radialGradient id="leverChrome" cx="35%" cy="30%" r="80%">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#d8d8e0"/>
      <stop offset="60%" stop-color="#7a7a85"/>
      <stop offset="100%" stop-color="#2a2a32"/>
    </radialGradient>
    <!-- Asta cilindrica: gradient orizzontale per effetto tubo -->
    <linearGradient id="leverArmGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="40%"  stop-color="#4a4a52"/>
      <stop offset="55%"  stop-color="#9a9aa5"/>
      <stop offset="72%"  stop-color="#3a3a42"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
    <!-- Base guida (piastra frontale cromata) -->
    <linearGradient id="leverBaseGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#5a5a64"/>
      <stop offset="50%"  stop-color="#2a2a32"/>
      <stop offset="100%" stop-color="#101016"/>
    </linearGradient>
  </defs>

  <!-- ── Base guida FRONTALE (ruotata 90° rispetto alla leva laterale:
       dalla faccia della slot, verso l'utente) ── -->
  <g id="leverBase">
    <!-- ombra a terra -->
    <ellipse cx="${BASE_X + BASE_W / 2}" cy="${BASE_Y + BASE_H + 3}"
             rx="${BASE_W / 2}" ry="4" fill="#000" opacity="0.35"/>
    <!-- piastra di montaggio (vista di fronte: rettangolo arrotondato) -->
    <rect x="${BASE_X}" y="${BASE_Y}" width="${BASE_W}" height="${BASE_H}" rx="5"
          fill="url(#leverBaseGrad)" stroke="#000" stroke-width="1"/>
    <rect x="${BASE_X + 2}" y="${BASE_Y + 2}" width="${BASE_W - 4}" height="3"
          rx="1.5" fill="#ffffff" opacity="0.18"/>
    <!-- boccola (foro ovale da cui esce l'asta verso l'utente) -->
    <ellipse cx="${BOC_CX}" cy="${BOC_CY}" rx="${BOC_RX + 2}" ry="${BOC_RY + 1.5}"
             fill="#000" opacity="0.5"/>
    <ellipse cx="${BOC_CX}" cy="${BOC_CY}" rx="${BOC_RX}" ry="${BOC_RY}"
             fill="url(#leverChrome)" stroke="#000" stroke-width="0.6"/>
    <ellipse cx="${BOC_CX}" cy="${BOC_CY}" rx="${BOC_RX - 2}" ry="${BOC_RY - 1}"
             fill="#0a0a0a"/>
  </g>

  <!-- ── Leva (punta verso l'utente): gruppo animato ── -->
  <g class="leverArm" id="leverGroup">
    <!-- Asta a trapezio: più larga in basso (più vicina) -->
    <polygon
      points="${BOC_CX - _armTopHalf},${_armTopY}
               ${BOC_CX + _armTopHalf},${_armTopY}
               ${BALL_CX + _armBotHalf},${_armBotY}
               ${BALL_CX - _armBotHalf},${_armBotY}"
      fill="url(#leverArmGrad)" stroke="#000" stroke-width="0.6"/>
    <!-- Highlight tubo (linea chiara sul lato sinistro dell'asta) -->
    <line x1="${BOC_CX - _armTopHalf + 1}" y1="${_armTopY + 1}"
          x2="${BALL_CX - _armBotHalf + 1.5}" y2="${_armBotY - 1}"
          stroke="#ffffff" stroke-width="1" opacity="0.5" stroke-linecap="round"/>

    <!-- Anello cromato a metà asta (visto di fronte = ellisse orizzontale) -->
    <ellipse cx="${BALL_CX}" cy="${(_armTopY + _armBotY) / 2}"
             rx="${(ARM_TOP_W + ARM_BOT_W) / 4 + 1}" ry="${(ARM_TOP_W + ARM_BOT_W) / 4}"
             fill="none" stroke="url(#leverChrome)" stroke-width="1.4"/>

    <!-- Pomello rosso: a riposo lontano (piccolo), al pull vicino (grande) -->
    <circle cx="${BALL_CX}" cy="${BALL_REST_CY}" r="${BALL_REST_R}"
            fill="#000" opacity="0.4" transform="translate(1.5 2)"/>
    <circle cx="${BALL_CX}" cy="${BALL_REST_CY}" r="${BALL_REST_R}"
            fill="url(#leverBall)" stroke="#3a0404" stroke-width="1.2"/>
    <circle cx="${BALL_CX}" cy="${BALL_REST_CY}" r="${BALL_REST_R - 0.8}"
            fill="none" stroke="#ff6a4a" stroke-width="0.5" opacity="0.5"/>
    <circle cx="${BALL_CX - 3.5}" cy="${BALL_REST_CY - 4}" r="5"
            fill="url(#leverBallShine)"/>
    <circle cx="${BALL_CX - 4}" cy="${BALL_REST_CY - 4.5}" r="1.4"
            fill="#ffffff" opacity="0.95"/>
  </g>
</svg>
`;

// Animazioni CSS per il pull e l'idle loop.
// La leva è FRONTALE (punta verso l'utente): il "pull verso l'utente" si
// ottiene con scale-up + translateY verso il basso (fuori dallo schermo).
// Nessun 3D CSS perché l'SVG è embeddato come <img> (non supportato).
const ANIMATIONS = `
<style>
  /* Origine di scalatura = base/boccola, così il pomello "esce" verso il
     basso senza staccarsi dalla base. */
  #leverGroup {
    transform-origin: ${BOC_CX}px ${BOC_CY}px;
  }

  /* Pull-and-release: il pomello si avvicina (scale) e scende verso l'utente,
     poi torna al riposo. */
  @keyframes pull {
    0%   { transform: scale(1) translateY(0px); }
    35%  { transform: scale(${PULL_SCALE}) translateY(${PULL_DROP}px); }
    100% { transform: scale(1) translateY(0px); }
  }

  @keyframes idleLoop {
    0%, 100% { transform: scale(1) translateY(0px); }
    50%      { transform: scale(1.04) translateY(2px); }
  }

  /* Stato "pull appena avvenuto": riproduce il pull e, al termine, entra
     nel loop idle senza soluzione di continuità. */
  .pulling {
    animation:
      pull ${PULL_DURATION_MS}ms ease-in-out forwards,
      idleLoop ${IDLE_LOOP_MS}ms ease-in-out ${PULL_DURATION_MS}ms infinite;
  }

  /* Stato di riposo (nessuno spin recente): solo loop idle. */
  .idling {
    animation: idleLoop ${IDLE_LOOP_MS}ms ease-in-out infinite;
  }

  /* Accessibilità: niente animazioni per chi ha disattivato il motion. */
  @media (prefers-reduced-motion: reduce) {
    #leverGroup { animation: none !important; }
  }
</style>
`;

export default async function handler(req, res) {
  // ── CORS (ISSUE-25: wildcard `*`, la leva è embeddata cross-origin
  //    su github.com e altri domini non deterministici) ──
  applyCorsWildcard(req, res);
  if (req.method === 'OPTIONS') {
    sendResponse(res, { status: 204 });
    return;
  }

  // Verifica lo stato per determinare l'animazione.
  // getPullState(req) usa come fonte PRIMARIA il timestamp di spin nell'URL
  // (?v=spinStart, scritto da spin.js nel README) -> deterministico, non
  // dipende da KV. Fallback a lastPullTimestamp su KV se l'URL non ha ?v.
  const pullState = await getPullState(req);

  // Logica animazione:
  // - Se c'è stato uno spin RECENTE (finestra di 3s, fonte URL o KV ->
  //   pullState.isPulling), riproduciamo l'animazione di pull, che poi
  //   sfuma nel loop idle.
  // - Altrimenti: solo loop idle di riposo.
  const currentClass = pullState.isPulling ? 'pulling' : 'idling';

  // Costruisci SVG con animazioni CSS
  let svg = LEVER_SVG_TEMPLATE;
  
  // Inserisci le animazioni CSS prima dei defs
  svg = svg.replace(
    '<defs>',
    ANIMATIONS + '\n  <defs>'
  );
  
  // Aggiungi la classe appropriata al gruppo della leva
  if (currentClass) {
    svg = svg.replace(
      '<g class="leverArm" id="leverGroup">',
      `<g class="leverArm ${currentClass}" id="leverGroup">`
    );
  }

  sendResponse(res, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=30',
      'ETag': `"lever-${Date.now()}"`,
      Expires: new Date(Date.now() + 5000).toUTCString(),
    },
    body: svg,
  });
}
