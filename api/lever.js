// ─── Lever endpoint ──────────────────────────────────────────────────────────
// SVG statico raffigurante la classica leva laterale di una slot machine
// in stile cartoon/casino:
//   • Bumper (mounting boss) cromato che sporge dal fianco destro del cabinet
//     della slot, con anelli concentrici a vista per dare volume
//   • Asta cilindrica nera con prospettiva 3D (gradient + striscia di
//     riflesso speculare) che parte dal bumper e va in alto-destra
//   • Pomello sferico giallo con shading 3D (light terminator + highlight
//     speculare + cintura inferiore di riflesso luce ambientale)
//
// Posizionamento: nel README va affiancato a slot.svg (a destra), allineato
// in modo che il bumper si sovrapponga visivamente al fianco destro del
// cabinet rosso. Height matchata a slot.svg (880).
//
// L'unico elemento cliccabile per far partire lo spin è questa immagine.

const W = 180;
const H = 880;

// Bumper sul lato sinistro del SVG = lato destro del cabinet della slot.
// Posizionato a circa 60% di altezza per ricalcare l'altezza tipica della
// leva nelle slot machine reali (circa all'altezza dei pulsanti operatore).
const BUMPER_CX = 22;
const BUMPER_CY = Math.round(H * 0.58);
const BUMPER_R  = 32;

// Asta diagonale: parte dal centro del bumper e va in alto a destra. La
// leggera prospettiva è ottenuta usando un poligono trapezoidale (più largo
// alla base, più stretto in cima) invece di un semplice <line>: questo dà
// l'illusione che l'asta si allontani dall'osservatore mentre sale.
const ARM_BASE_CX = BUMPER_CX + 10;
const ARM_BASE_CY = BUMPER_CY - 4;
const ARM_TOP_CX  = W - 38;
const ARM_TOP_CY  = 150;
const ARM_BASE_W  = 18;   // più larga alla base (più vicina)
const ARM_TOP_W   = 11;   // più stretta in cima (più lontana)

// Pomello sferico in cima all'asta
const BALL_CX = ARM_TOP_CX + 6;
const BALL_CY = ARM_TOP_CY - 30;
const BALL_R  = 38;

// Funzione: data una coppia di punti centrali (base, top) e i due half-width,
// restituisce i 4 angoli del trapezoide perpendicolare alla retta base→top.
function armPolygon() {
  const dx = ARM_TOP_CX - ARM_BASE_CX;
  const dy = ARM_TOP_CY - ARM_BASE_CY;
  const len = Math.hypot(dx, dy);
  // Vettore unitario perpendicolare (ruotato 90°)
  const nx = -dy / len;
  const ny =  dx / len;
  const halfBase = ARM_BASE_W / 2;
  const halfTop  = ARM_TOP_W  / 2;
  const p1x = ARM_BASE_CX + nx * halfBase;
  const p1y = ARM_BASE_CY + ny * halfBase;
  const p2x = ARM_TOP_CX  + nx * halfTop;
  const p2y = ARM_TOP_CY  + ny * halfTop;
  const p3x = ARM_TOP_CX  - nx * halfTop;
  const p3y = ARM_TOP_CY  - ny * halfTop;
  const p4x = ARM_BASE_CX - nx * halfBase;
  const p4y = ARM_BASE_CY - ny * halfBase;
  return `${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)} ${p4x.toFixed(1)},${p4y.toFixed(1)}`;
  // Punto 1: lato sinistro alla base; 2: lato sinistro in cima; 3: destro cima; 4: destro base.
}

// Linea di highlight cilindrica: corre lungo la spina dorsale dell'asta,
// leggermente offsettata sul lato sinistro (lato luce). Restituisce due punti.
function armHighlight() {
  const dx = ARM_TOP_CX - ARM_BASE_CX;
  const dy = ARM_TOP_CY - ARM_BASE_CY;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const offBase = ARM_BASE_W * 0.18;
  const offTop  = ARM_TOP_W  * 0.18;
  const x1 = ARM_BASE_CX + nx * offBase;
  const y1 = ARM_BASE_CY + ny * offBase;
  const x2 = ARM_TOP_CX  + nx * offTop;
  const y2 = ARM_TOP_CY  + ny * offTop;
  return { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) };
}

const armPts = armPolygon();
const armHl = armHighlight();

const LEVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Pomello giallo: gradient con sorgente luce in alto-sinistra -->
    <radialGradient id="leverBall" cx="32%" cy="28%" r="78%">
      <stop offset="0%"  stop-color="#fff8c0"/>
      <stop offset="20%" stop-color="#ffe066"/>
      <stop offset="55%" stop-color="#f5a623"/>
      <stop offset="85%" stop-color="#a85a00"/>
      <stop offset="100%" stop-color="#5a3000"/>
    </radialGradient>
    <!-- Highlight speculare (luce concentrata) -->
    <radialGradient id="leverBallShine" cx="32%" cy="28%" r="22%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <!-- Riflesso luce ambientale dalla cabinet rossa (in basso al pomello) -->
    <radialGradient id="leverBallBounce" cx="55%" cy="85%" r="40%">
      <stop offset="0%" stop-color="#ff6a4a" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ff6a4a" stop-opacity="0"/>
    </radialGradient>

    <!-- Bumper cromato: gradient radiale con highlight in alto -->
    <radialGradient id="leverBumper" cx="35%" cy="30%" r="80%">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="20%" stop-color="#d8d8e0"/>
      <stop offset="55%" stop-color="#7a7a85"/>
      <stop offset="100%" stop-color="#2a2a32"/>
    </radialGradient>

    <!-- Asta nera: gradient laterale con highlight cilindrico al centro-sinistra
         (perpendicolare alla luce) per simulare un cilindro reale. -->
    <linearGradient id="leverArm" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0a0a"/>
      <stop offset="35%"  stop-color="#2a2a2e"/>
      <stop offset="55%"  stop-color="#5a5a64"/>
      <stop offset="70%"  stop-color="#1a1a1e"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>

  <style>
    /* Idle: oscillazione MOLTO lieve dell'asta+pomello attorno al pivot
       (centro del bumper). Non muoviamo il bumper: è ancorato al cabinet. */
    @keyframes leverIdle {
      0%, 100% { transform: rotate(-1.2deg); }
      50%      { transform: rotate(1.6deg); }
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

  <!-- ── Bumper (mounting boss) ──
       Anelli concentrici per dare volume: ombra esterna, base scura,
       pomolo cromato, ring chiaro, riflesso speculare. È la "boccola"
       da cui esce l'asta della leva. Resta fisso (non oscilla). -->
  <ellipse cx="${BUMPER_CX + 4}" cy="${BUMPER_CY + 6}" rx="${BUMPER_R + 4}" ry="${BUMPER_R - 4}"
           fill="#000" opacity="0.45"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R}"
          fill="#1a0606" stroke="#000" stroke-width="1.4"/>
  <circle cx="${BUMPER_CX}" cy="${BUMPER_CY}" r="${BUMPER_R - 5}"
          fill="url(#leverBumper)" stroke="#3a3a44" stroke-width="0.8"/>
  <!-- Highlight speculare in alto-sinistra del bumper -->
  <ellipse cx="${BUMPER_CX - 8}" cy="${BUMPER_CY - 10}" rx="11" ry="6"
           fill="#ffffff" opacity="0.7"/>
  <!-- Cuore scuro (foro da cui esce l'asta) -->
  <circle cx="${BUMPER_CX + 4}" cy="${BUMPER_CY - 2}" r="6"
          fill="#0a0a0a" stroke="#3a3a44" stroke-width="0.6"/>

  <!-- ── Leva (gruppo che oscilla attorno al bumper) ── -->
  <g class="leverArm">
    <!-- Halo del pomello (richiamo visivo per il click) -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R + 18}"
            fill="#ffd84a" opacity="0.32" class="leverBallHalo"/>

    <!-- Asta: trapezoide (perspettiva), poi gradient cilindrico, poi striscia
         di riflesso speculare, poi outline scuro. -->
    <!-- Ombra dell'asta (sfumata, leggermente offset) -->
    <polygon points="${armPts}" fill="#000" opacity="0.45"
             transform="translate(2 4)"/>
    <!-- Corpo cilindrico dell'asta -->
    <polygon points="${armPts}" fill="url(#leverArm)"
             stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>
    <!-- Highlight speculare (linea sottile lungo la "spina" dell'asta) -->
    <line x1="${armHl.x1}" y1="${armHl.y1}" x2="${armHl.x2}" y2="${armHl.y2}"
          stroke="#c8c8d0" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
    <line x1="${armHl.x1}" y1="${armHl.y1}" x2="${armHl.x2}" y2="${armHl.y2}"
          stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" opacity="0.75"/>

    <!-- Anello cromato decorativo a metà asta (dettaglio classico) -->
    ${(() => {
      const mx = (ARM_BASE_CX + ARM_TOP_CX) / 2;
      const my = (ARM_BASE_CY + ARM_TOP_CY) / 2;
      const dx = ARM_TOP_CX - ARM_BASE_CX;
      const dy = ARM_TOP_CY - ARM_BASE_CY;
      const len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const halfMid = ((ARM_BASE_W + ARM_TOP_W) / 2) / 2 + 2.5;
      const ringLen = 4;
      const r1x = mx + ux * (-ringLen) + nx * halfMid;
      const r1y = my + uy * (-ringLen) + ny * halfMid;
      const r2x = mx + ux * ringLen   + nx * halfMid;
      const r2y = my + uy * ringLen   + ny * halfMid;
      const r3x = mx + ux * ringLen   - nx * halfMid;
      const r3y = my + uy * ringLen   - ny * halfMid;
      const r4x = mx + ux * (-ringLen) - nx * halfMid;
      const r4y = my + uy * (-ringLen) - ny * halfMid;
      return `<polygon points="${r1x.toFixed(1)},${r1y.toFixed(1)} ${r2x.toFixed(1)},${r2y.toFixed(1)} ${r3x.toFixed(1)},${r3y.toFixed(1)} ${r4x.toFixed(1)},${r4y.toFixed(1)}"
                       fill="url(#leverBumper)" stroke="#000" stroke-width="0.8"/>`;
    })()}

    <!-- Tappo cromato dove l'asta si innesta nel pomello -->
    <circle cx="${ARM_TOP_CX + (BALL_CX - ARM_TOP_CX) * 0.5}" cy="${ARM_TOP_CY + (BALL_CY - ARM_TOP_CY) * 0.5}"
            r="7" fill="url(#leverBumper)" stroke="#000" stroke-width="0.8"/>

    <!-- ── Pomello sferico giallo ── -->
    <!-- Base scura per dare profondità -->
    <circle cx="${BALL_CX + 2}" cy="${BALL_CY + 3}" r="${BALL_R}"
            fill="#000" opacity="0.4"/>
    <!-- Corpo principale del pomello -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R}"
            fill="url(#leverBall)" stroke="#5a3000" stroke-width="2"/>
    <!-- Riflesso ambientale dalla cabinet rossa (basso) -->
    <circle cx="${BALL_CX}" cy="${BALL_CY}" r="${BALL_R - 1}"
            fill="url(#leverBallBounce)"/>
    <!-- Cintura inferiore di riflesso (lustro) -->
    <ellipse cx="${BALL_CX}" cy="${BALL_CY + BALL_R * 0.55}"
             rx="${BALL_R * 0.7}" ry="3" fill="#ff8a4a" opacity="0.45"/>
    <!-- Highlight speculare (sorgente luce in alto-sinistra) -->
    <circle cx="${BALL_CX - 12}" cy="${BALL_CY - 14}" r="13"
            fill="url(#leverBallShine)"/>
    <!-- Punto di luce intenso -->
    <circle cx="${BALL_CX - 14}" cy="${BALL_CY - 16}" r="3.5"
            fill="#ffffff" opacity="0.95"/>
  </g>

  <!-- ── Label "PULL!" sotto il bumper ── -->
  <g class="leverLabel" font-family="'Segoe UI','Helvetica Neue',sans-serif"
     text-anchor="middle">
    <rect x="${BUMPER_CX + 6}" y="${BUMPER_CY + BUMPER_R + 22}"
          width="92" height="30" rx="6"
          fill="#0a0a18" stroke="#ffd84a" stroke-width="1.8"/>
    <text x="${BUMPER_CX + 52}" y="${BUMPER_CY + BUMPER_R + 43}"
          font-size="16" font-weight="900" fill="#ffd84a" letter-spacing="2">PULL!</text>
  </g>
  <text x="${BUMPER_CX + 52}" y="${BUMPER_CY + BUMPER_R + 66}" text-anchor="middle"
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
