// ─── Paytable Generator ──────────────────────────────────────────────────────────
// Genera la paytable in basso a sinistra - Mostra i simboli dei rulli con indicatori visivi

// Definizione completa dei simboli e della loro competenza
const ALL_SYMBOLS = [
  { id: 'cpp', color: '#00599C', accent: '#9FD3F0', text: '#ffffff', short: 'C++', competence: 4 },
  { id: 'c', color: '#283593', accent: '#A8B9CC', text: '#ffffff', short: 'C', competence: 3 },
  { id: 'glsl', color: '#5586A4', accent: '#F5B642', text: '#ffffff', short: 'GLSL', competence: 3 },
  { id: 'react', color: '#20232A', accent: '#61DAFB', text: '#61DAFB', short: 'React', competence: 4 },
  { id: 'javascript', color: '#F7DF1E', accent: '#000000', text: '#1a1a1a', short: 'JS', competence: 5 },
  { id: 'python', color: '#3776AB', accent: '#FFD43B', text: '#ffffff', short: 'Py', competence: 4 },
  { id: 'typescript', color: '#3178C6', accent: '#235A97', text: '#ffffff', short: 'TS', competence: 4 },
  { id: 'qt', color: '#0F3D26', accent: '#41CD52', text: '#ffffff', short: 'Qt', competence: 3 },
  { id: 'wild', color: '#fde047', accent: '#a16207', text: '#1a1a2e', short: 'WILD', competence: 5 },
  { id: 'scatter', color: '#a855f7', accent: '#f0abfc', text: '#ffffff', short: 'BONUS', competence: 5 },
];

export function generatePaytable(uid, winningLang, gridSymbols) {
  const PT_X_START = 160;
  const PT_Y_START = 360;
  const PT_W = 400;
  const PT_H_TOTAL = 150;
  const CELL_SIZE = 32;
  const CELL_SPACING = 12;
  const MAX_SYMBOLS = 8;
  
  let paytable = '';
  
  // ─── SFONDO PANNELLO PAYTABLE ──────────────────────────────────────────────
  paytable += `<g transform="translate(${PT_X_START}, ${PT_Y_START})">`;
  
  // Bordo principale con effetto glassmorphism
  paytable += `
    <rect width="${PT_W}" height="${PT_H_TOTAL}" rx="16" ry="16" 
          fill="rgba(20, 20, 35, 0.95)" 
          stroke="#41CD52" 
          stroke-width="2" 
          opacity="0.9"
          filter="url(#glow${uid})"/>
    <rect width="${PT_W}" height="${PT_H_TOTAL}" rx="16" ry="16" 
          fill="url(#grad_paytable_highlight)" 
          opacity="0.1"/>
    
    <!-- Sottile bordo interno per profondità -->
    <rect x="1" y="1" width="${PT_W-2}" height="${PT_H_TOTAL-2}" rx="14" ry="14" 
          fill="none" 
          stroke="rgba(255,255,255,0.1)" 
          stroke-width="1"/>
  `;
  
  // ─── HEADER "LEVEL KNOWLEDGE" ──────────────────────────────────────────────
  paytable += `
    <g transform="translate(24, 20)">
      <text x="0" y="0" 
            font-family="'Segoe UI', sans-serif" 
            font-size="11" 
            font-weight="700" 
            fill="#ffffff" 
            letter-spacing="2.5"
            text-anchor="start">LEVEL KNOWLEDGE</text>
      <line x1="0" y1="14" x2="150" y2="14" 
            stroke="#41CD52" 
            stroke-width="1.5" 
            opacity="0.6"/>
      <text x="0" y="26" 
            font-family="'Segoe UI', sans-serif" 
            font-size="8" 
            fill="#61DAFB" 
            opacity="0.95">
        ${winningLang ? `Current: ${winningLang.name.toUpperCase()}` : 'READY TO SPIN!'}
      </text>
    </g>
  `;
  
  // ─── SEZIONE SIMBOLI ATTUALI ───────────────────────────────────────────────
  const symbolsSectionY = 48;
  
  paytable += `
    <g transform="translate(24, ${symbolsSectionY})">
      <text x="0" y="0" 
            font-family="'Segoe UI', sans-serif" 
            font-size="8" 
            font-weight="600" 
            fill="#8b8baf" 
            letter-spacing="1.5"
            opacity="0.8">SYMBOLS ON REELS</text>
    </g>
  `;
  
  // Mostra i simboli unici dalla griglia (max 8)
  if (gridSymbols && gridSymbols.length > 0) {
    const uniqueSymbols = [...new Set(gridSymbols)].slice(0, MAX_SYMBOLS);
    const startX = 24;
    const startY = symbolsSectionY + 12;
    
    uniqueSymbols.forEach((symbolId, index) => {
      const colIndex = index % 5;
      const rowIndex = Math.floor(index / 5);
      const colX = startX + colIndex * (CELL_SIZE + CELL_SPACING);
      const colY = startY + rowIndex * (CELL_SIZE + 18);
      
      paytable += renderSymbolWithCompetence(uid, symbolId, colX, colY, CELL_SIZE);
    });
  } else {
    // Nessun simbolo: mostra placeholder
    const startX = 24;
    const startY = symbolsSectionY + 12;
    paytable += `<text x="${startX}" y="${startY + 10}" font-family="'Segoe UI',sans-serif" font-size="7" fill="#61DAFB" opacity="0.6">Spin to see symbols...</text>`;
  }
  
  // ─── LEGENDA COMPETENZA ─────────────────────────────────────────────────────
  const legendY = 105;
  
  paytable += `
    <g transform="translate(24, ${legendY})">
      <text x="0" y="0" 
            font-family="'Segoe UI', sans-serif" 
            font-size="8" 
            font-weight="600" 
            fill="#8b8baf" 
            letter-spacing="1.5"
            opacity="0.8">KNOWLEDGE LEVEL</text>
      
      <!-- Indicatore livello 5 (massimo - verde pieno) -->
      <g transform="translate(0, 14)">
        <circle cx="5" cy="5" r="3" fill="#41CD52" opacity="1"/>
        <text x="12" y="6" 
              font-family="'Segoe UI', sans-serif" 
              font-size="7" 
              fill="#41CD52" 
              font-weight="700"
              letter-spacing="0.5">MAX KNOWLEDGE</text>
      </g>
      
      <!-- Indicatore livello 4 (alto - verde brillante) -->
      <g transform="translate(0, 26)">
        <circle cx="5" cy="5" r="3" fill="#41CD52" opacity="1"/>
        <circle cx="9" cy="5" r="3" fill="#41CD52" opacity="1"/>
        <circle cx="13" cy="5" r="3" fill="#41CD52" opacity="0.7"/>
        <circle cx="17" cy="5" r="3" fill="#41CD52" opacity="0.4"/>
        <circle cx="21" cy="5" r="3" fill="#41CD52" opacity="0.1"/>
        <text x="28" y="6" 
              font-family="'Segoe UI', sans-serif" 
              font-size="7" 
              fill="#61DAFB" 
              font-weight="600"
              letter-spacing="0.5">HIGH</text>
      </g>
      
      <!-- Indicatore livello 3 (medio - giallo/oro) -->
      <g transform="translate(0, 38)">
        <circle cx="5" cy="5" r="3" fill="#41CD52" opacity="1"/>
        <circle cx="9" cy="5" r="3" fill="#41CD52" opacity="0.7"/>
        <circle cx="13" cy="5" r="3" fill="#41CD52" opacity="0.4"/>
        <circle cx="17" cy="5" r="3" fill="#41CD52" opacity="0.2"/>
        <circle cx="21" cy="5" r="3" fill="#41CD52" opacity="0.05"/>
        <text x="28" y="6" 
              font-family="'Segoe UI', sans-serif" 
              font-size="7" 
              fill="#F5B642" 
              font-weight="600"
              letter-spacing="0.5">MEDIUM</text>
      </g>
      
      <!-- Indicatore livello 2 (basso - arancione) -->
      <g transform="translate(0, 50)">
        <circle cx="5" cy="5" r="3" fill="#41CD52" opacity="0.5"/>
        <circle cx="9" cy="5" r="3" fill="#41CD52" opacity="0.3"/>
        <circle cx="13" cy="5" r="3" fill="#41CD52" opacity="0.15"/>
        <circle cx="17" cy="5" r="3" fill="#41CD52" opacity="0.08"/>
        <circle cx="21" cy="5" r="3" fill="#41CD52" opacity="0.03"/>
        <text x="28" y="6" 
              font-family="'Segoe UI', sans-serif" 
              font-size="7" 
              fill="#F0C7A5" 
              font-weight="500"
              letter-spacing="0.5">LOW</text>
      </g>
      
      <!-- Indicatore livello 1 (base - grigio) -->
      <g transform="translate(0, 62)">
        <circle cx="5" cy="5" r="3" fill="#41CD52" opacity="0.3"/>
        <circle cx="9" cy="5" r="3" fill="#41CD52" opacity="0.15"/>
        <circle cx="13" cy="5" r="3" fill="#41CD52" opacity="0.08"/>
        <circle cx="17" cy="5" r="3" fill="#41CD52" opacity="0.04"/>
        <circle cx="21" cy="5" r="3" fill="#41CD52" opacity="0.02"/>
        <text x="28" y="6" 
              font-family="'Segoe UI', sans-serif" 
              font-size="7" 
              fill="#A8B9CC" 
              font-weight="500"
              letter-spacing="0.5">NEW</text>
      </g>
      
      <!-- Spiegazione -->
      <text x="0" y="80" 
            font-family="'Segoe UI', sans-serif" 
            font-size="7" 
            fill="#61DAFB" 
            opacity="0.7">
        More green dots = more mastery over this language
      </text>
    </g>
  `;
  
  paytable += `</g>`;
  
  return paytable;
}

// Helper: Renderizza un simbolo con indicatore di competenza
function renderSymbolWithCompetence(uid, symbolId, x, y, size) {
  const symbolInfo = ALL_SYMBOLS.find(s => s.id === symbolId);
  
  if (!symbolInfo) {
    // Fallback per simboli sconosciuti
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="#61DAFB" opacity="0.2"/>
            <text x="${x + size/2}" y="${y + size/2 + 3}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#61DAFB" text-anchor="middle">${symbolId.substring(0, 3)}</text>`;
  }
  
  const competence = symbolInfo.competence || 3;
  const padding = 2;
  const innerSize = size - padding * 2;
  
  let symbolSvg = '';
  
  // Sfondo gradiente (usa i gradienti definiti in defs.js)
  symbolSvg += `<rect x="${x + padding}" y="${y + padding}" width="${innerSize}" height="${innerSize}" rx="6" fill="url(#grad_${uid}_${symbolInfo.id})" opacity="0.95"/>`;
  
  // Bordo brillante
  symbolSvg += `<rect x="${x + padding}" y="${y + padding}" width="${innerSize}" height="${innerSize}" rx="6" fill="none" stroke="${symbolInfo.accent}" stroke-width="1.8" opacity="0.85" filter="url(#glow${uid})"/>`;
  
  // Icona base semplificata per paytable
  switch (symbolId) {
    case 'cpp':
      symbolSvg += `<polygon points="${x+6},${y+4} ${x+14},${y+8} ${x+14},${y+28} ${x+6},${y+32} ${x+2},${y+28} ${x+2},${y+8}" fill="${symbolInfo.color}"/>`;
      symbolSvg += `<text x="${x+8}" y="${y+20}" font-family="'Segoe UI',sans-serif" font-size="5" font-weight="900" fill="${symbolInfo.text}">C++</text>`;
      break;
    case 'c':
      symbolSvg += `<polygon points="${x+6},${y+4} ${x+14},${y+8} ${x+14},${y+28} ${x+6},${y+32} ${x+2},${y+28} ${x+2},${y+8}" fill="${symbolInfo.color}"/>`;
      symbolSvg += `<text x="${x+8}" y="${y+21}" font-family="'Segoe UI',sans-serif" font-size="7" font-weight="900" fill="${symbolInfo.text}">C</text>`;
      break;
    case 'glsl':
      symbolSvg += `<polygon points="${x+6},${y+4} ${x+14},${y+8} ${x+14},${y+28} ${x+6},${y+32} ${x+2},${y+28} ${x+2},${y+8}" fill="${symbolInfo.color}"/>`;
      symbolSvg += `<polygon points="${x+6},${y+10} ${x+11},${y+13} ${x+11},${y+25} ${x+6},${y+28} ${x+1},${y+25} ${x+1},${y+13}" fill="none" stroke="${symbolInfo.accent}" stroke-width="0.8" opacity="0.6"/>`;
      symbolSvg += `<text x="${x+7}" y="${y+19}" font-family="'Segoe UI',sans-serif" font-size="4" font-weight="900" fill="${symbolInfo.text}">GL</text>`;
      break;
    case 'react':
      symbolSvg += `<ellipse cx="${x+16}" cy="${y+16}" rx="9" ry="3.5" fill="none" stroke="${symbolInfo.accent}" stroke-width="1.2"/>`;
      symbolSvg += `<ellipse cx="${x+16}" cy="${y+16}" rx="9" ry="3.5" fill="none" stroke="${symbolInfo.accent}" stroke-width="1.2" transform="rotate(60 ${x+16} ${y+16})"/>`;
      symbolSvg += `<ellipse cx="${x+16}" cy="${y+16}" rx="9" ry="3.5" fill="none" stroke="${symbolInfo.accent}" stroke-width="1.2" transform="rotate(120 ${x+16} ${y+16})"/>`;
      symbolSvg += `<circle cx="${x+16}" cy="${y+16}" r="1.8" fill="${symbolInfo.accent}"/>`;
      break;
    case 'javascript':
    case 'wild':
      symbolSvg += `<rect x="${x+3}" y="${y+3}" width="${size-6}" height="${size-6}" rx="5" fill="${symbolInfo.color}"/>`;
      symbolSvg += `<text x="${x+size-4}" y="${y+16}" font-family="'Fira Code',monospace" font-size="7" font-weight="900" fill="${symbolInfo.text}">&lt;/&gt;</text>`;
      break;
    case 'python':
      symbolSvg += `<path d="M${x+3},${y+8} Q${x+6},${y+8} ${x+6},${y+11} L${x+6},${y+14} L${x+12},${y+14} L${x+12},${y+11} Q${x+12},${y+8} ${x+15},${y+8} L${x+18},${y+8} Q${x+21},${y+8} ${x+21},${y+11} L${x+21},${y+14} Q${x+21},${y+17} ${x+18},${y+17} L${x+12},${y+17} L${x+12},${y+20} Q${x+12},${y+23} ${x+9},${y+23} L${x+6},${y+23} Q${x+3},${y+23} ${x+3},${y+20} L${x+3},${y+17} Q${x+3},${y+14} ${x+6},${y+14}" fill="${symbolInfo.color}"/>`;
      break;
    case 'typescript':
      symbolSvg += `<rect x="${x+3}" y="${y+3}" width="${size-6}" height="${size-6}" rx="5" fill="${symbolInfo.color}"/>`;
      symbolSvg += `<text x="${x+size-4}" y="${y+19}" font-family="'Segoe UI',sans-serif" font-size="7" font-weight="900" fill="${symbolInfo.text}">TS</text>`;
      break;
    case 'qt':
      symbolSvg += `<circle cx="${x+16}" cy="${y+16}" r="10" fill="${symbolInfo.accent}" stroke="${symbolInfo.color}" stroke-width="1.2"/>`;
      symbolSvg += `<text x="${x+16}" y="${y+19}" font-family="'Segoe UI',serif" font-size="7" font-weight="900" fill="${symbolInfo.text}" font-style="italic">Qt</text>`;
      break;
    case 'scatter':
      symbolSvg += `<path d="M${x+16},${y+2} L${x+19},${y+10} L${x+27},${y+13} L${x+19},${y+16} L${x+16},${y+24} L${x+13},${y+16} L${x+5},${y+13} L${x+13},${y+10} Z" fill="${symbolInfo.color}" stroke="${symbolInfo.accent}" stroke-width="1"/>`;
      break;
    default:
      // Simbolo generico
      symbolSvg += `<rect x="${x+3}" y="${y+3}" width="${size-6}" height="${size-6}" rx="5" fill="${symbolInfo.color}"/>`;
      symbolSvg += `<text x="${x+16}" y="${y+20}" font-family="'Segoe UI',sans-serif" font-size="5" font-weight="700" fill="${symbolInfo.text}" text-anchor="middle">${(symbolInfo.short || symbolId).substring(0, 3)}</text>`;
  }
  
  // ─── INDICATORE DI COMPETENZA (5 cerchi verdi) ─────────────────────────────
  const indicatorX = x + 4;
  const indicatorY = y + size - 6;
  const circleRadius = 2;
  const circleSpacing = 2.8;
  
  for (let i = 0; i < 5; i++) {
    const opacity = i < competence ? Math.max(0.4, competence - i * 0.15) : 0.08;
    const cx = indicatorX + i * circleSpacing;
    
    symbolSvg += `<circle cx="${cx}" cy="${indicatorY}" r="${circleRadius}" 
                    fill="#41CD52" 
                    opacity="${opacity}"/>`;
  }
  
  return symbolSvg;
}
