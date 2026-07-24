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

const W = 52;
const H = 150;

// Pivot del bumper: centrato nell'SVG (W=52)
const BUMPER_CX = 26;
const BUMPER_CY = 100;
const BUMPER_R = 10;

// Tip dell'asta: centrato orizzontalmente, verso il basso
const TIP_X = 26;
const TIP_Y = 22;

// Pomello rosso (stesso colore del cabinet).
const BALL_R = 11;

// Punto medio dell'asta (anello cromato).
const MID_X = (BUMPER_CX + TIP_X) / 2;
const MID_Y = (BUMPER_CY + TIP_Y) / 2;

// Vettore unitario lungo l'asta (per orientare highlight e anello).
// Leva ora verticale: dx=0, dy=-78
const _dx = TIP_X - BUMPER_CX;
const _dy = TIP_Y - BUMPER_CY;
const _len = Math.hypot(_dx, _dy);
const _ux = _dx / _len,
  _uy = _dy / _len;
// angolo dell'asta in gradi (rotazione dell'ellisse-anello)
// Leva verticale: -90°
const ARM_ANGLE_DEG = (Math.atan2(_uy, _ux) * 180) / Math.PI;

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

// Pull verticale "verso il giocatore": il pomello in alto viene tirato GIU'
// dritto verso il basso (il giocatore), mantenendo la leva a dimensione
// PIENA (niente rimpicciolimento, che darebbe sensazione di allontanamento).
// Origine = BUMPER in basso (fisso): con scale X=1 Y=0.8 l'asta si allunga
// verso il basso e il pomello scende, la base resta ferma (niente stacco).
const PULL_SCALE_X = 1;    // larghezza invariata (niente restringimento)
const PULL_SCALE_Y = 0.8;  // l'asta si accorcia in verticale: pomello scende
const PULL_DROP = 4;       // minima traslazione verticale aggiuntiva verso il basso

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
    <!-- Cromature (bumper, anello) -->
    <radialGradient id="leverChrome" cx="35%" cy="30%" r="80%">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#d8d8e0"/>
      <stop offset="60%" stop-color="#7a7a85"/>
      <stop offset="100%" stop-color="#2a2a32"/>
    </radialGradient>
    <!-- Asta cilindrica: gradient orizzontale sul bounding box della line -->
    <linearGradient id="leverArmGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="35%"  stop-color="#3a3a3e"/>
      <stop offset="55%"  stop-color="#7a7a85"/>
      <stop offset="75%"  stop-color="#2a2a2e"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>

  <!-- ── Bumper (mounting boss) — fisso ── -->
  <ellipse cx="${BUMPER_CX + 3}" cy="${BUMPER_CY + 5}"
           rx="${BUMPER_R + 3}" ry="${BUMPER_R - 2}"
           fill="#000" opacity="0.4"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R}"
          fill="#1a0606" stroke="#000" stroke-width="1"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R - 3}"
          fill="url(#leverChrome)"/>

  <!-- ── Leva (gruppo rotante) ── -->
  <g class="leverArm" id="leverGroup">
    <!-- Halo rosso attorno al pomello -->
    <circle cx="${TIP_X}" cy="${TIP_Y}" r="${BALL_R + 8}"
            fill="#ff5a4a" opacity="0.32" class="leverBallHalo"/>

    <!-- Asta: line singola con cap arrotondato → niente spigoli ai bordi.
         Va dal pivot del bumper al centro del pomello, quindi ball e arm
         restano sempre solidali. -->
    <line x1="${BUMPER_CX}" y1="${BUMPER_CY}" x2="${TIP_X}" y2="${TIP_Y}"
          stroke="#000" stroke-width="9" stroke-linecap="round" opacity="0.55"
          transform="translate(1 2)"/>
    <line x1="${BUMPER_CX}" y1="${BUMPER_CY}" x2="${TIP_X}" y2="${TIP_Y}"
          stroke="url(#leverArmGrad)" stroke-width="7" stroke-linecap="round"/>
    <!-- Highlight cilindrico sull'asta (linea chiara, parallela alla principale) -->
    <line x1="${(BUMPER_CX + _uy * 1.2).toFixed(2)}"
          y1="${(BUMPER_CY - _ux * 1.2).toFixed(2)}"
          x2="${(TIP_X + _uy * 1.2).toFixed(2)}"
          y2="${(TIP_Y - _ux * 1.2).toFixed(2)}"
          stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity="0.55"/>

    <!-- Anello cromato a metà asta -->
    <ellipse cx="${MID_X.toFixed(2)}" cy="${MID_Y.toFixed(2)}"
             rx="3.6" ry="5.5"
             transform="rotate(${ARM_ANGLE_DEG.toFixed(2)} ${MID_X.toFixed(2)} ${MID_Y.toFixed(2)})"
             fill="url(#leverChrome)" stroke="#000" stroke-width="0.6"/>

    <!-- Pomello rosso, centrato esattamente sul tip dell'asta -->
    <circle cx="${TIP_X + 1.5}" cy="${TIP_Y + 2}" r="${BALL_R}"
            fill="#000" opacity="0.4"/>
    <circle cx="${TIP_X}" cy="${TIP_Y}" r="${BALL_R}"
            fill="url(#leverBall)" stroke="#3a0404" stroke-width="1.2"/>
    <circle cx="${TIP_X}" cy="${TIP_Y}" r="${BALL_R - 0.8}"
            fill="none" stroke="#ff6a4a" stroke-width="0.5" opacity="0.5"/>
    <circle cx="${TIP_X - 3.5}" cy="${TIP_Y - 4}" r="5"
            fill="url(#leverBallShine)"/>
    <circle cx="${TIP_X - 4}" cy="${TIP_Y - 4.5}" r="1.4"
            fill="#ffffff" opacity="0.95"/>
  </g>

  <!-- ── Overlay anti-glitch: foro centrale del bumper sopra l'asta ── -->
  <circle cx="${BUMPER_CX + 1.5}" cy="${BUMPER_CY}" r="3"
          fill="#0a0a0a" stroke="#3a3a44" stroke-width="0.4"/>
</svg>
`;

// Animazioni CSS per il pull e l'idle loop
// Geometria verticale (pomello rosso in alto, bumper in basso): il pull è una
// discesa VERTICALE verso il giocatore — NON una rotazione di lato. Uso uno
// scale con origine sul bumper (in basso): l'asta si accorcia "tirata giù"
// verso il giocatore (profondità 3D della leva slot), l'asta resta sempre
// agganciata alla base (niente stacco). Nessun rotate → niente scivolata a dx.
const ANIMATIONS = `
<style>
  /* Origine sul bumper (in basso): scalando verso il basso il pomello in
     alto scende dritto verso il giocatore. */
  #leverGroup {
    transform-origin: ${BUMPER_CX}px ${BUMPER_CY}px;
  }

  /* Pull-and-release: il pomello viene tirato GIU' verso il giocatore
     (scale Y 0.8, X 1 = leva a dimensione piena, no restringimento),
     poi rilasciato tornando a riposo. Base fissa (origine sul bumper). */
  @keyframes pull {
    0%   { transform: scale(1,1) translateY(0px); }
    35%  { transform: scale(${PULL_SCALE_X}, ${PULL_SCALE_Y}) translateY(${PULL_DROP}px); }
    100% { transform: scale(1,1) translateY(0px); }
  }

  @keyframes idleLoop {
    0%, 100% {
      transform: scale(1) translateY(0px);
    }
    50% {
      transform: scale(0.99) translateY(1px);
    }
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
