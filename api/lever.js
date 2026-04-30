// ─── Lever endpoint ──────────────────────────────────────────────────────────
// Restituisce un SVG statico (140×700) raffigurante la classica leva laterale
// di una slot machine: bracket di montaggio sulla sinistra (che si "incastra"
// visivamente col bordo destro di slot.svg), asta cromata, pomello sferico
// rosso e base ancorata. La leva oscilla leggermente in idle e mostra una
// label "PULL!" come call-to-action.
//
// L'unico elemento cliccabile per far partire lo spin è questa immagine,
// posizionata a destra di slot.svg nel README. Il contenuto della slot
// rimane non-cliccabile (solo visualizzazione).
//
// Dimensioni pensate per affiancarsi a slot.svg (700px alto):
//   width:  140
//   height: 700
//
// Restituisce un SVG inline — nessuna fetch a GitHub: la leva è statica.

const LEVER_SVG = (() => {
  const W = 140, H = 700;
  // Geometria
  const PIVOT_X = 50;     // base/pivot della leva (sul lato sinistro, vicino allo slot)
  const PIVOT_Y = H - 120;
  const SHAFT_LEN = 360;  // lunghezza asta
  const BALL_R = 30;      // raggio pomello
  const BALL_CX = PIVOT_X;
  const BALL_CY = PIVOT_Y - SHAFT_LEN; // estremità superiore in posizione di "rest"

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Cabinet rosso (deve combaciare con quello di slot.svg) -->
    <linearGradient id="leverCab" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5a0f0f"/>
      <stop offset="50%" stop-color="#a82020"/>
      <stop offset="100%" stop-color="#5a0f0f"/>
    </linearGradient>
    <!-- Cromature -->
    <linearGradient id="leverChrome" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3a3a44"/>
      <stop offset="20%" stop-color="#e8e8ea"/>
      <stop offset="50%" stop-color="#9a9aa3"/>
      <stop offset="80%" stop-color="#e8e8ea"/>
      <stop offset="100%" stop-color="#3a3a44"/>
    </linearGradient>
    <linearGradient id="leverBezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4f4f6"/>
      <stop offset="50%" stop-color="#5b5b66"/>
      <stop offset="100%" stop-color="#f4f4f6"/>
    </linearGradient>
    <!-- Pomello rosso 3D -->
    <radialGradient id="leverBall" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#ff8a8a"/>
      <stop offset="20%" stop-color="#ee2a2a"/>
      <stop offset="60%" stop-color="#9a0a0a"/>
      <stop offset="100%" stop-color="#3a0202"/>
    </radialGradient>
    <radialGradient id="leverBallShine" cx="35%" cy="30%" r="35%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <!-- Base / mounting plate -->
    <linearGradient id="leverBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7a7a85"/>
      <stop offset="50%" stop-color="#2a2a32"/>
      <stop offset="100%" stop-color="#7a7a85"/>
    </linearGradient>
    <!-- Glow per il pomello (stato di chiamata all'azione) -->
    <filter id="leverGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <style>
    /* Idle bobbing della leva: oscillazione molto lieve attorno al pivot. */
    @keyframes leverIdle {
      0%, 100% { transform: rotate(-2deg); }
      50%      { transform: rotate(3deg); }
    }
    /* Pulse della label "PULL!" */
    @keyframes leverPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.55; }
    }
    /* Glow del pomello */
    @keyframes leverBallGlow {
      0%, 100% { opacity: 0.35; }
      50%      { opacity: 0.75; }
    }
    .leverArm {
      transform-origin: ${PIVOT_X}px ${PIVOT_Y}px;
      animation: leverIdle 2.6s ease-in-out infinite;
    }
    .leverLabel { animation: leverPulse 1.4s ease-in-out infinite; }
    .leverBallHalo { animation: leverBallGlow 1.8s ease-in-out infinite; }
  </style>

  <!-- Sfondo della cabinet "lato leva": tinta rossa lucida che si incastra
       col bordo destro della slot. La parte superiore è leggermente curva
       (rotondità verso destra) per evocare il fianco della macchina. -->
  <path d="M 0 0
           L ${W - 24} 0
           Q ${W} 0 ${W} 24
           L ${W} ${H - 24}
           Q ${W} ${H} ${W - 24} ${H}
           L 0 ${H}
           Z"
        fill="url(#leverCab)"/>
  <!-- Hairline scuro tra slot e cabinet della leva (lato sinistro): rinforza
       l'illusione che le due immagini siano la stessa macchina. -->
  <rect x="0" y="0" width="2" height="${H}" fill="#1a0606" opacity="0.85"/>

  <!-- Bordo cromato superiore/inferiore/destro (NON sinistro: il sinistro è la
       linea di giunzione con slot.svg). -->
  <path d="M 6 6
           L ${W - 26} 6
           Q ${W - 6} 6 ${W - 6} 26
           L ${W - 6} ${H - 26}
           Q ${W - 6} ${H - 6} ${W - 26} ${H - 6}
           L 6 ${H - 6}"
        fill="none" stroke="url(#leverBezel)" stroke-width="4"/>

  <!-- Rivetti decorativi sul fianco. -->
  <g fill="#1a0606">
    <circle cx="${W - 18}" cy="80"  r="2.6"/>
    <circle cx="${W - 18}" cy="160" r="2.6"/>
    <circle cx="${W - 18}" cy="240" r="2.6"/>
    <circle cx="${W - 18}" cy="320" r="2.6"/>
    <circle cx="${W - 18}" cy="400" r="2.6"/>
    <circle cx="${W - 18}" cy="480" r="2.6"/>
    <circle cx="${W - 18}" cy="560" r="2.6"/>
    <circle cx="${W - 18}" cy="640" r="2.6"/>
  </g>
  <g fill="#f0c0c0" opacity="0.7">
    <circle cx="${W - 18.6}" cy="79.3"  r="1"/>
    <circle cx="${W - 18.6}" cy="159.3" r="1"/>
    <circle cx="${W - 18.6}" cy="239.3" r="1"/>
    <circle cx="${W - 18.6}" cy="319.3" r="1"/>
    <circle cx="${W - 18.6}" cy="399.3" r="1"/>
    <circle cx="${W - 18.6}" cy="479.3" r="1"/>
    <circle cx="${W - 18.6}" cy="559.3" r="1"/>
    <circle cx="${W - 18.6}" cy="639.3" r="1"/>
  </g>

  <!-- Base / mounting plate del pivot della leva, ancorata al fianco. -->
  <ellipse cx="${PIVOT_X}" cy="${PIVOT_Y + 14}" rx="34" ry="9" fill="#000" opacity="0.5"/>
  <rect x="${PIVOT_X - 32}" y="${PIVOT_Y - 4}" width="64" height="32" rx="6"
        fill="url(#leverBase)" stroke="#000" stroke-width="1"/>
  <rect x="${PIVOT_X - 28}" y="${PIVOT_Y - 1}" width="56" height="6" rx="2"
        fill="#1a1a22" opacity="0.85"/>
  <!-- Bulloni della base -->
  <circle cx="${PIVOT_X - 24}" cy="${PIVOT_Y + 18}" r="2.2" fill="#1a1a22"/>
  <circle cx="${PIVOT_X + 24}" cy="${PIVOT_Y + 18}" r="2.2" fill="#1a1a22"/>
  <circle cx="${PIVOT_X - 24}" cy="${PIVOT_Y + 17.5}" r="0.8" fill="#c0c0c8" opacity="0.7"/>
  <circle cx="${PIVOT_X + 24}" cy="${PIVOT_Y + 17.5}" r="0.8" fill="#c0c0c8" opacity="0.7"/>

  <!-- Pivot ring -->
  <circle cx="${PIVOT_X}" cy="${PIVOT_Y}" r="11" fill="url(#leverChrome)" stroke="#000" stroke-width="1"/>
  <circle cx="${PIVOT_X}" cy="${PIVOT_Y}" r="6" fill="#0a0a10" stroke="#3a3a44" stroke-width="0.8"/>
  <circle cx="${PIVOT_X - 1.4}" cy="${PIVOT_Y - 1.4}" r="1.6" fill="#ffffff" opacity="0.6"/>

  <!-- Leva: gruppo che ruota leggermente attorno al pivot. -->
  <g class="leverArm">
    <!-- Ombra dell'asta (proiettata sul lato del cabinet) -->
    <rect x="${PIVOT_X - 3}" y="${BALL_CY + 4}"
          width="10" height="${SHAFT_LEN - 4}" rx="5"
          fill="#000" opacity="0.4"/>
    <!-- Asta cromata -->
    <rect x="${PIVOT_X - 6}" y="${BALL_CY}"
          width="12" height="${SHAFT_LEN}" rx="6"
          fill="url(#leverChrome)" stroke="#1a1a22" stroke-width="0.8"/>
    <!-- Highlight verticale sull'asta (riflesso) -->
    <rect x="${PIVOT_X - 2.4}" y="${BALL_CY + 4}"
          width="2" height="${SHAFT_LEN - 8}" rx="1"
          fill="#ffffff" opacity="0.6"/>
    <!-- Anelli decorativi sull'asta -->
    <rect x="${PIVOT_X - 8}" y="${BALL_CY + 60}"  width="16" height="4" rx="1.5" fill="#3a3a44"/>
    <rect x="${PIVOT_X - 8}" y="${BALL_CY + 180}" width="16" height="4" rx="1.5" fill="#3a3a44"/>
    <rect x="${PIVOT_X - 8}" y="${BALL_CY + 300}" width="16" height="4" rx="1.5" fill="#3a3a44"/>

    <!-- Halo del pomello (call-to-action) -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R + 14}"
            fill="#ff4040" opacity="0.35"
            class="leverBallHalo"
            filter="url(#leverGlow)"/>
    <!-- Pomello sferico rosso -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R}"
            fill="url(#leverBall)" stroke="#1a0202" stroke-width="1.4"/>
    <!-- Riflesso speculare in alto-sinistra del pomello -->
    <circle cx="${BALL_CX - 9}" cy="${BALL_CY - 11}" r="11"
            fill="url(#leverBallShine)"/>
    <!-- Cintura cromata attorno al pomello -->
    <ellipse cx="${BALL_CX}" cy="${BALL_CY + 2}" rx="${BALL_R + 1}" ry="4"
             fill="none" stroke="#9a9aa3" stroke-width="0.8" opacity="0.55"/>
  </g>

  <!-- Label "PULL!" sotto la leva -->
  <g class="leverLabel" font-family="'Segoe UI','Helvetica Neue',sans-serif"
     text-anchor="middle">
    <rect x="${PIVOT_X - 36}" y="${PIVOT_Y + 44}" width="72" height="26" rx="6"
          fill="#0a0a18" stroke="#ffd700" stroke-width="1.4"/>
    <text x="${PIVOT_X}" y="${PIVOT_Y + 62}" font-size="14" font-weight="900"
          fill="#ffd700" letter-spacing="2">PULL!</text>
  </g>
  <text x="${PIVOT_X}" y="${PIVOT_Y + 84}" text-anchor="middle"
        font-family="'Segoe UI',sans-serif" font-size="9" fill="#f0c0c0"
        font-style="italic" letter-spacing="0.5">click to spin</text>

  <!-- "SPIN" indicator verticale sul fianco (decorativo, vintage) -->
  <g transform="translate(${W - 22} 350) rotate(90)" font-family="'Segoe UI',sans-serif"
     text-anchor="middle">
    <text x="0" y="0" font-size="11" font-weight="800" fill="#ffd700" letter-spacing="6">SPIN</text>
  </g>
</svg>`;
})();

export default function handler(req, res) {
  res.setHeader('Content-Type', 'image/svg+xml');
  // Static asset, but we still avoid aggressive caching so any future
  // refresh (e.g. deploy) propagates immediately to GitHub Camo.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(LEVER_SVG);
}
