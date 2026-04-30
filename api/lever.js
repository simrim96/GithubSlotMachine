// ─── Lever endpoint ──────────────────────────────────────────────────────────
// SVG statico: leva laterale di una slot machine. Stile coerente col cabinet
// (pomello rosso laccato, montatura cromata).
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

const W = 52;
const H = 150;

// Pivot del bumper: clippato a metà sul bordo sinistro, così quando il SVG
// viene affiancato al cabinet la leva si "incastra" nel fianco della slot.
const BUMPER_CX = 0;
const BUMPER_CY = 100;
const BUMPER_R  = 10;

// Tip dell'asta (= centro del pomello). Quasi verticale: dx=10, dy=78.
const TIP_X = 10;
const TIP_Y = 22;

// Pomello rosso (stesso colore del cabinet).
const BALL_R = 11;

// Punto medio dell'asta (anello cromato).
const MID_X = (BUMPER_CX + TIP_X) / 2;
const MID_Y = (BUMPER_CY + TIP_Y) / 2;

// Vettore unitario lungo l'asta (per orientare highlight e anello).
const _dx = TIP_X - BUMPER_CX;
const _dy = TIP_Y - BUMPER_CY;
const _len = Math.hypot(_dx, _dy);
const _ux = _dx / _len, _uy = _dy / _len;
// angolo dell'asta in gradi (rotazione dell'ellisse-anello)
const ARM_ANGLE_DEG = (Math.atan2(_uy, _ux) * 180) / Math.PI;

const LEVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
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

  <style>
    /* Idle leggero: oscillazione piccolissima, nessuno shimmer percettibile. */
    @keyframes leverIdle {
      0%, 100% { transform: rotate(-1deg); }
      50%      { transform: rotate(1.4deg); }
    }
    @keyframes leverBallGlow {
      0%, 100% { opacity: 0.30; }
      50%      { opacity: 0.65; }
    }
    .leverArm {
      transform-origin: ${BUMPER_CX}px ${BUMPER_CY}px;
      animation: leverIdle 3.2s ease-in-out infinite;
    }
    .leverBallHalo { animation: leverBallGlow 1.8s ease-in-out infinite; }
  </style>

  <!-- ── Bumper (mounting boss) — fisso ── -->
  <ellipse cx="${BUMPER_CX + 3}" cy="${BUMPER_CY + 5}"
           rx="${BUMPER_R + 3}" ry="${BUMPER_R - 2}"
           fill="#000" opacity="0.4"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R}"
          fill="#1a0606" stroke="#000" stroke-width="1"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R - 3}"
          fill="url(#leverChrome)"/>

  <!-- ── Leva (gruppo rotante) ── -->
  <g class="leverArm">
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
          x2="${(TIP_X     + _uy * 1.2).toFixed(2)}"
          y2="${(TIP_Y     - _ux * 1.2).toFixed(2)}"
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
</svg>`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(LEVER_SVG);
}
