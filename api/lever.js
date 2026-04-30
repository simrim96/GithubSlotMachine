// ─── Lever endpoint ──────────────────────────────────────────────────────────
// Restituisce un SVG statico raffigurante la classica leva laterale di una slot
// machine cartoon: un bumper arancione tondeggiante che sporge dal fianco
// destro del cabinet, un'asta nera diagonale che va in alto a destra, e un
// pomello giallo (la "palla") in cima. Stile flat / vector ispirato alle
// illustrazioni vintage delle slot vere.
//
// Posizionamento: nel README va affiancato a slot.svg (a destra), allineato
// in modo che il bumper si sovrapponga visivamente al fianco destro del
// cabinet rosso.
//
// L'unico elemento cliccabile per far partire lo spin è questa immagine.

const W = 160;
const H = 740;

// Coordinate di riferimento
const BUMPER_CX = 22;          // bumper sul lato sinistro (incastra col cabinet)
const BUMPER_CY = Math.round(H * 0.42);
const BUMPER_RX = 38;
const BUMPER_RY = 30;

// Asta diagonale: parte dal bumper e va in alto a destra.
const ARM_X1 = BUMPER_CX + 14;
const ARM_Y1 = BUMPER_CY - 6;
const ARM_X2 = W - 26;
const ARM_Y2 = 110;
const ARM_W = 10;

// Pomello sferico in cima
const BALL_CX = ARM_X2 + 2;
const BALL_CY = ARM_Y2 - 26;
const BALL_R = 32;

const LEVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="leverBall" cx="35%" cy="30%" r="80%">
      <stop offset="0%"  stop-color="#fff4a8"/>
      <stop offset="35%" stop-color="#ffd84a"/>
      <stop offset="75%" stop-color="#f5a623"/>
      <stop offset="100%" stop-color="#a86610"/>
    </radialGradient>
    <radialGradient id="leverBallShine" cx="35%" cy="30%" r="35%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="leverBumper" cx="40%" cy="35%" r="80%">
      <stop offset="0%"  stop-color="#ffb070"/>
      <stop offset="55%" stop-color="#f5a623"/>
      <stop offset="100%" stop-color="#a85a00"/>
    </radialGradient>
    <linearGradient id="leverArm" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="50%"  stop-color="#3a3a3a"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>

  <style>
    @keyframes leverIdle {
      0%, 100% { transform: rotate(-1.5deg); }
      50%      { transform: rotate(2deg); }
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
      animation: leverIdle 2.6s ease-in-out infinite;
    }
    .leverLabel    { animation: leverPulse    1.4s ease-in-out infinite; }
    .leverBallHalo { animation: leverBallGlow 1.8s ease-in-out infinite; }
  </style>

  <!-- Bumper arancione: ellisse che sporge dal lato sinistro del SVG (e quindi
       dal fianco destro del cabinet della slot, una volta affiancato). -->
  <ellipse cx="${BUMPER_CX}" cy="${BUMPER_CY}" rx="${BUMPER_RX}" ry="${BUMPER_RY}"
           fill="url(#leverBumper)" stroke="#7a4400" stroke-width="2"/>
  <ellipse cx="${BUMPER_CX - 4}" cy="${BUMPER_CY - 12}" rx="${BUMPER_RX - 14}" ry="6"
           fill="#fff5b8" opacity="0.55"/>

  <!-- Leva (gruppo che oscilla attorno al bumper) -->
  <g class="leverArm">
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R + 16}"
            fill="#ffd84a" opacity="0.32" class="leverBallHalo"/>

    <!-- Asta nera diagonale (ombra + corpo + highlight) -->
    <line x1="${ARM_X1}" y1="${ARM_Y1}" x2="${ARM_X2}" y2="${ARM_Y2}"
          stroke="#0a0a0a" stroke-width="${ARM_W + 4}" stroke-linecap="round" opacity="0.35"/>
    <line x1="${ARM_X1}" y1="${ARM_Y1}" x2="${ARM_X2}" y2="${ARM_Y2}"
          stroke="url(#leverArm)" stroke-width="${ARM_W}" stroke-linecap="round"/>
    <line x1="${ARM_X1 + 1}" y1="${ARM_Y1 - 1}" x2="${ARM_X2 + 1}" y2="${ARM_Y2 - 1}"
          stroke="#7a7a7a" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>

    <!-- Tappo dove l'asta si innesta nel bumper -->
    <circle cx="${ARM_X1}" cy="${ARM_Y1}" r="6" fill="#3a3a3a" stroke="#0a0a0a" stroke-width="1"/>
    <circle cx="${ARM_X1 - 1.2}" cy="${ARM_Y1 - 1.4}" r="1.6" fill="#ffffff" opacity="0.7"/>

    <!-- Pomello sferico giallo -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R}"
            fill="url(#leverBall)" stroke="#7a4400" stroke-width="2"/>
    <circle cx="${BALL_CX - 10}" cy="${BALL_CY - 12}" r="11"
            fill="url(#leverBallShine)"/>
    <ellipse cx="${BALL_CX}" cy="${BALL_CY + 3}" rx="${BALL_R + 1}" ry="4"
             fill="none" stroke="#a86610" stroke-width="0.8" opacity="0.55"/>
  </g>

  <!-- Label "PULL!" sotto il bumper -->
  <g class="leverLabel" font-family="'Segoe UI','Helvetica Neue',sans-serif"
     text-anchor="middle">
    <rect x="${BUMPER_CX + 6}" y="${BUMPER_CY + BUMPER_RY + 18}"
          width="84" height="28" rx="6"
          fill="#0a0a18" stroke="#ffd84a" stroke-width="1.6"/>
    <text x="${BUMPER_CX + 48}" y="${BUMPER_CY + BUMPER_RY + 38}"
          font-size="15" font-weight="900" fill="#ffd84a" letter-spacing="2">PULL!</text>
  </g>
  <text x="${BUMPER_CX + 48}" y="${BUMPER_CY + BUMPER_RY + 60}" text-anchor="middle"
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
