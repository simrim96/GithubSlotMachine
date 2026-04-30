// ─── Lever endpoint ──────────────────────────────────────────────────────────
// SVG statico: leva laterale di una slot machine, stile cartoon/casino con
// prospettiva 3D.
//
// Anti-glitch: la base dell'asta è estesa fin DENTRO il bumper, e il "foro"
// scuro centrale del bumper è ridisegnato come overlay SOPRA il gruppo che
// oscilla. Così, nonostante l'asta ruoti attorno al pivot, i suoi bordi
// non sbucano mai dal bumper durante l'animazione idle.
//
// Posizionamento: il bumper sporge a sinistra del SVG ed è in parte clippato
// fuori canvas — questo permette di affiancare la leva al cabinet della slot
// con zero gap visivo.

const W = 130;
const H = 760;

// Bumper sporge dal lato sinistro del canvas: BUMPER_CX è poco a destra del
// bordo (parte sinistra del bumper viene clippata fuori → si "incastra"
// otticamente col fianco destro del cabinet della slot, a contatto).
const BUMPER_CX = 6;
const BUMPER_CY = Math.round(H * 0.58);
const BUMPER_R  = 30;

// Asta diagonale: parte DENTRO il bumper (per evitare gap di rotazione)
// e va in alto a destra.
const ARM_BASE_CX = BUMPER_CX;        // dentro il bumper (era +10 → glitch)
const ARM_BASE_CY = BUMPER_CY;
const ARM_TOP_CX  = W - 32;
const ARM_TOP_CY  = 110;
const ARM_BASE_W  = 18;   // più largo alla base (più vicino all'osservatore)
const ARM_TOP_W   = 11;   // più stretto in cima (prospettiva)

// Pomello sferico in cima all'asta
const BALL_CX = ARM_TOP_CX + 4;
const BALL_CY = ARM_TOP_CY - 28;
const BALL_R  = 34;

// Trapezoide dell'asta: 4 punti calcolati perpendicolarmente alla retta
// base→top, con larghezza variabile (base wider → tip narrower) per
// simulare la prospettiva.
function armPolygon() {
  const dx = ARM_TOP_CX - ARM_BASE_CX;
  const dy = ARM_TOP_CY - ARM_BASE_CY;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny =  dx / len;
  const hb = ARM_BASE_W / 2;
  const ht = ARM_TOP_W  / 2;
  const p1 = [ARM_BASE_CX + nx * hb, ARM_BASE_CY + ny * hb];
  const p2 = [ARM_TOP_CX  + nx * ht, ARM_TOP_CY  + ny * ht];
  const p3 = [ARM_TOP_CX  - nx * ht, ARM_TOP_CY  - ny * ht];
  const p4 = [ARM_BASE_CX - nx * hb, ARM_BASE_CY - ny * hb];
  return [p1, p2, p3, p4]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function armHighlight() {
  const dx = ARM_TOP_CX - ARM_BASE_CX;
  const dy = ARM_TOP_CY - ARM_BASE_CY;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const oB = ARM_BASE_W * 0.18;
  const oT = ARM_TOP_W  * 0.18;
  return {
    x1: (ARM_BASE_CX + nx * oB).toFixed(1),
    y1: (ARM_BASE_CY + ny * oB).toFixed(1),
    x2: (ARM_TOP_CX  + nx * oT).toFixed(1),
    y2: (ARM_TOP_CY  + ny * oT).toFixed(1),
  };
}

// Anello cromato a metà asta
function armMidRing() {
  const mx = (ARM_BASE_CX + ARM_TOP_CX) / 2;
  const my = (ARM_BASE_CY + ARM_TOP_CY) / 2;
  const dx = ARM_TOP_CX - ARM_BASE_CX;
  const dy = ARM_TOP_CY - ARM_BASE_CY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const halfMid = ((ARM_BASE_W + ARM_TOP_W) / 2) / 2 + 2.4;
  const ringLen = 4;
  const corners = [
    [mx + ux * (-ringLen) + nx * halfMid, my + uy * (-ringLen) + ny * halfMid],
    [mx + ux *  ringLen   + nx * halfMid, my + uy *  ringLen   + ny * halfMid],
    [mx + ux *  ringLen   - nx * halfMid, my + uy *  ringLen   - ny * halfMid],
    [mx + ux * (-ringLen) - nx * halfMid, my + uy * (-ringLen) - ny * halfMid],
  ];
  return corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

const armPts = armPolygon();
const armHl = armHighlight();
const ringPts = armMidRing();

const LEVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="leverBall" cx="32%" cy="28%" r="78%">
      <stop offset="0%"  stop-color="#fff8c0"/>
      <stop offset="20%" stop-color="#ffe066"/>
      <stop offset="55%" stop-color="#f5a623"/>
      <stop offset="85%" stop-color="#a85a00"/>
      <stop offset="100%" stop-color="#5a3000"/>
    </radialGradient>
    <radialGradient id="leverBallShine" cx="32%" cy="28%" r="22%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="leverBallBounce" cx="55%" cy="85%" r="40%">
      <stop offset="0%" stop-color="#ff6a4a" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ff6a4a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="leverBumper" cx="35%" cy="30%" r="80%">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="20%" stop-color="#d8d8e0"/>
      <stop offset="55%" stop-color="#7a7a85"/>
      <stop offset="100%" stop-color="#2a2a32"/>
    </radialGradient>
    <linearGradient id="leverArm" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="35%"  stop-color="#2a2a2e"/>
      <stop offset="55%"  stop-color="#5a5a64"/>
      <stop offset="70%"  stop-color="#1a1a1e"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>

  <style>
    /* Idle MOLTO leggero — quasi statico — per evitare qualsiasi shimmer
       sul bordo del bumper. La leva resta visibilmente "viva" ma stabile. */
    @keyframes leverIdle {
      0%, 100% { transform: rotate(-0.8deg); }
      50%      { transform: rotate(1.2deg); }
    }
    @keyframes leverPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.6; }
    }
    @keyframes leverBallGlow {
      0%, 100% { opacity: 0.30; }
      50%      { opacity: 0.65; }
    }
    .leverArm {
      transform-origin: ${BUMPER_CX}px ${BUMPER_CY}px;
      animation: leverIdle 3.2s ease-in-out infinite;
    }
    .leverLabel    { animation: leverPulse    1.4s ease-in-out infinite; }
    .leverBallHalo { animation: leverBallGlow 1.8s ease-in-out infinite; }
  </style>

  <!-- ── Bumper (mounting boss) — fisso, ancorato al cabinet ── -->
  <ellipse cx="${BUMPER_CX + 4}" cy="${BUMPER_CY + 6}" rx="${BUMPER_R + 4}" ry="${BUMPER_R - 4}"
           fill="#000" opacity="0.45"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R}"
          fill="#1a0606" stroke="#000" stroke-width="1.4"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R - 5}"
          fill="url(#leverBumper)" stroke="#3a3a44" stroke-width="0.8"/>
  <ellipse cx="${BUMPER_CX - 8}" cy="${BUMPER_CY - 10}" rx="11" ry="6"
           fill="#ffffff" opacity="0.7"/>

  <!-- ── Leva (gruppo che oscilla attorno al pivot del bumper) ── -->
  <g class="leverArm">
    <!-- Halo del pomello -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R + 18}"
            fill="#ffd84a" opacity="0.32" class="leverBallHalo"/>

    <!-- Asta: trapezoide con prospettiva -->
    <polygon points="${armPts}" fill="#000" opacity="0.45"
             transform="translate(2 4)"/>
    <polygon points="${armPts}" fill="url(#leverArm)"
             stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>
    <line x1="${armHl.x1}" y1="${armHl.y1}" x2="${armHl.x2}" y2="${armHl.y2}"
          stroke="#c8c8d0" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
    <line x1="${armHl.x1}" y1="${armHl.y1}" x2="${armHl.x2}" y2="${armHl.y2}"
          stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" opacity="0.75"/>

    <!-- Anello cromato a metà asta -->
    <polygon points="${ringPts}" fill="url(#leverBumper)"
             stroke="#000" stroke-width="0.8"/>

    <!-- Tappo cromato all'innesto col pomello -->
    <circle cx="${ARM_TOP_CX + (BALL_CX - ARM_TOP_CX) * 0.5}"
            cy="${ARM_TOP_CY + (BALL_CY - ARM_TOP_CY) * 0.5}"
            r="6.5" fill="url(#leverBumper)" stroke="#000" stroke-width="0.8"/>

    <!-- ── Pomello sferico giallo ── -->
    <circle cx="${BALL_CX + 2}" cy="${BALL_CY + 3}" r="${BALL_R}"
            fill="#000" opacity="0.4"/>
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R}"
            fill="url(#leverBall)" stroke="#5a3000" stroke-width="2"/>
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R - 1}"
            fill="url(#leverBallBounce)"/>
    <ellipse cx="${BALL_CX}" cy="${BALL_CY + BALL_R * 0.55}"
             rx="${BALL_R * 0.7}" ry="3" fill="#ff8a4a" opacity="0.45"/>
    <circle cx="${BALL_CX - 12}" cy="${BALL_CY - 14}" r="13"
            fill="url(#leverBallShine)"/>
    <circle cx="${BALL_CX - 14}" cy="${BALL_CY - 16}" r="3.5"
            fill="#ffffff" opacity="0.95"/>
  </g>

  <!-- ── Overlay anti-glitch ──
       Il "foro" centrale del bumper viene RIDISEGNATO sopra l'asta:
       così, qualunque sia l'angolo di rotazione, la base del polígono
       resta nascosta dietro questo dischetto scuro fisso. -->
  <circle cx="${BUMPER_CX + 3}" cy="${BUMPER_CY - 1}" r="6"
          fill="#0a0a0a" stroke="#3a3a44" stroke-width="0.6"/>
  <circle cx="${BUMPER_CX + 1.5}" cy="${BUMPER_CY - 2.5}" r="1.6"
          fill="#ffffff" opacity="0.55"/>

  <!-- ── Label "PULL!" sotto il bumper ── -->
  <g class="leverLabel" font-family="'Segoe UI','Helvetica Neue',sans-serif"
     text-anchor="middle">
    <rect x="${BUMPER_CX - 4}" y="${BUMPER_CY + BUMPER_R + 22}"
          width="86" height="28" rx="6"
          fill="#0a0a18" stroke="#ffd84a" stroke-width="1.6"/>
    <text x="${BUMPER_CX + 39}" y="${BUMPER_CY + BUMPER_R + 42}"
          font-size="15" font-weight="900" fill="#ffd84a" letter-spacing="2">PULL!</text>
  </g>
  <text x="${BUMPER_CX + 39}" y="${BUMPER_CY + BUMPER_R + 64}" text-anchor="middle"
        font-family="'Segoe UI',sans-serif" font-size="9" fill="#7a4400"
        font-style="italic" letter-spacing="0.5">click to spin</text>
</svg>`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(LEVER_SVG);
}
