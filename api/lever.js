// ─── Lever endpoint ──────────────────────────────────────────────────────────
// SVG della leva VERTICALE di una slot machine. Stile coerente col cabinet
// (pomello rosso laccato, montatura cromata).
//
// Animazione "pull": quando la leva viene tirata (state.lastPullTimestamp recente),
// la punta SUPERIORE (il pomello rosso, in alto) scende VERTICALMENTE verso il
// basso / il giocatore. Nessuna rotazione, nessuno spostamento laterale: è una
// pura translateY dell'intero gruppo leva.
//
// Geometria:
//   • Leva verticale: pomello rosso in ALTO, base/tubo-guida in BASSO.
//   • L'asta parte BEN DENTRO il tubo-guida (fisso, disegnato sopra la base
//     dell'asta) così, anche quando il gruppo scende di qualche px, la base
//     dell'asta resta nascosta nel tubo → nessuno "stacco" visibile.
//   • Il tubo-guida + giunto cromato restano FUORI dal gruppo animato → fissi
//     rispetto al cabinet.

import { applyCorsWildcard } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { kvGet } from './_lib/kv.js';
import { logger } from './_lib/logger.js';

const W = 52;
const H = 150;

// ── Base / tubo-guida (FISSO, SOTTO la leva) ──
// Tubo verticale da cui l'asta esce e scorre; nasconde la base dell'asta anche
// durante la discesa del pull. Il giunto cromato è in cima al tubo.
const GUIDE_X = W / 2;     // 26: centro tubo (asta centrata sull'asse)
const GUIDE_W = 18;        // larghezza tubo
const GUIDE_TOP = 95;      // y superiore del tubo
const GUIDE_BOT = H;       // 150: il tubo arriva al fondo SVG
const BUMPER_CX = GUIDE_X;
const BUMPER_CY = GUIDE_TOP + 6; // giunto cromato in cima al tubo
const BUMPER_R = 12;

// ── Asta (verticale) ──
// Parte BEN DENTRO il tubo-guida (asta coperta dal tubo a riposo) e sale fino
// al pomello in alto.
const ARM_BOT_Y = 134;     // base asta (nascosta nel tubo)
const TIP_X = GUIDE_X;     // asta centrata sull'asse verticale
const TIP_Y = 30;          // pomello rosso in ALTO
const BALL_R = 12;         // raggio pomello

// Vettore asta (dal basso al tip): punta verso l'ALTO
const _ux = 0;
const _uy = -1;
const MID_X = (GUIDE_X + TIP_X) / 2;
const MID_Y = (ARM_BOT_Y + TIP_Y) / 2;

// Parametri animazione pull (2D, discesa verticale verso il giocatore)
const PULL_DROP = 26;      // px di discesa della punta verso il basso al picco

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

// SVG statico: leva VERTICALE di una slot machine.
// Il gruppo animato (leverGroup) contiene SOLO asta + pomello: durante il pull
// scende di translateY verso il basso. La base dell'asta è nascosta nel tubo-guida
// (disegnato DOPO, sopra la base dell'asta) → nessuno stacco visibile.
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
    <!-- Cromature (tubo, giunto) -->
    <radialGradient id="leverChrome" cx="35%" cy="30%" r="80%">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#d8d8e0"/>
      <stop offset="60%" stop-color="#7a7a85"/>
      <stop offset="100%" stop-color="#2a2a32"/>
    </radialGradient>
    <!-- Asta cilindrica: gradient orizzontale per effetto tubo -->
    <linearGradient id="leverArmGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="35%"  stop-color="#3a3a3e"/>
      <stop offset="55%"  stop-color="#7a7a85"/>
      <stop offset="75%"  stop-color="#2a2a2e"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
    <!-- Tubo-guida (base fissa) -->
    <linearGradient id="leverGuideGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="40%"  stop-color="#3a3a42"/>
      <stop offset="55%"  stop-color="#8a8a94"/>
      <stop offset="75%"  stop-color="#26262e"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>

  <!-- ── Leva (verticale): pomello in ALTO + asta. Gruppo animato ── -->
  <g class="leverArm" id="leverGroup">
    <!-- Asta verticale: dal fondo del tubo (nascosta) fino al pomello in alto -->
    <line x1="${GUIDE_X}" y1="${ARM_BOT_Y}" x2="${TIP_X}" y2="${TIP_Y}"
          stroke="#000" stroke-width="9" stroke-linecap="round" opacity="0.55"
          transform="translate(1 2)"/>
    <line x1="${GUIDE_X}" y1="${ARM_BOT_Y}" x2="${TIP_X}" y2="${TIP_Y}"
          stroke="url(#leverArmGrad)" stroke-width="7" stroke-linecap="round"/>
    <!-- Highlight cilindrico sull'asta (linea chiara, parallela) -->
    <line x1="${GUIDE_X + _uy * 1.2}" y1="${ARM_BOT_Y - _ux * 1.2}"
          x2="${TIP_X + _uy * 1.2}" y2="${TIP_Y - _ux * 1.2}"
          stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity="0.55"/>

    <!-- Pomello rosso in ALTO (punta della leva) -->
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

  <!-- ── Tubo-guida + giunto (FISSI, SOTTO la leva): disegnati DOPO il gruppo
       animato così nascondono la base dell'asta anche durante la discesa ── -->
  <g id="leverGuide">
    <!-- ombra a terra -->
    <ellipse cx="${GUIDE_X}" cy="${GUIDE_BOT - 2}" rx="${(GUIDE_W / 2) + 4}" ry="5"
             fill="#000" opacity="0.35"/>
    <!-- tubo verticale -->
    <rect x="${GUIDE_X - GUIDE_W / 2}" y="${GUIDE_TOP}" width="${GUIDE_W}"
          height="${GUIDE_BOT - GUIDE_TOP}" rx="4"
          fill="url(#leverGuideGrad)" stroke="#000" stroke-width="1"/>
    <rect x="${GUIDE_X - GUIDE_W / 2 + 2}" y="${GUIDE_TOP + 2}" width="3"
          height="${GUIDE_BOT - GUIDE_TOP - 4}" rx="1.5"
          fill="#ffffff" opacity="0.18"/>
    <!-- giunto cromato in cima al tubo (da cui esce l'asta) -->
    <ellipse cx="${BUMPER_CX + 3}" cy="${BUMPER_CY + 5}" rx="${BUMPER_R + 2}" ry="${BUMPER_R - 3}"
             fill="#000" opacity="0.4"/>
    <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R}"
            fill="#1a0606" stroke="#000" stroke-width="1"/>
    <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R - 3}"
            fill="url(#leverChrome)"/>
    <!-- foro centrale del giunto (sopra l'asta che sbuca) -->
    <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="3"
            fill="#0a0a0a" stroke="#3a3a44" stroke-width="0.4"/>
  </g>
</svg>
`;

// Animazioni CSS per il pull e l'idle loop.
// Leva VERTICALE: il pull è una pura translateY dell'intero gruppo verso il
// basso (la punta con il pomello rosso scende dritta verso il giocatore).
// Nessuna rotazione, nessuno spostamento laterale.
// L'asta resta nascosta nel tubo-guida (disegnato sopra la base dell'asta),
// quindi la discesa non mostra alcuno "stacco".
const ANIMATIONS = `
<style>
  /* Il gruppo leva scende verticalmente: nessuna trasformazione orizzontale. */
  #leverGroup {
    transform-origin: ${GUIDE_X}px ${TIP_Y}px;
  }

  /* Pull-and-release: la punta (pomello rosso in alto) scende verso il basso
     / il giocatore, poi torna su. Solo translateY, verticale puro. */
  @keyframes pull {
    0%   { transform: translateY(0px); }
    35%  { transform: translateY(${PULL_DROP}px); }
    100% { transform: translateY(0px); }
  }

  @keyframes idleLoop {
    0%, 100% { transform: translateY(0px); }
    50%      { transform: translateY(2px); }
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
