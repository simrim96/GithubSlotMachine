const OWNER = 'simrim96';
const SLOT_REPO = 'GithubSlotMachine';
const PROFILE_REPO = 'simrim96';
const ICONS = ['🍒', '💎', '🍋', '7️⃣', '🔔', '⭐'];
const WILD = '💎';
const SCATTER = '⭐';
const COLS = 5;
const ROWS = 3;
const PAYLINES = [
  [1, 1, 1, 1, 1], // center
  [0, 0, 0, 0, 0], // top
  [2, 2, 2, 2, 2], // bottom
  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2], // Λ
];
const PL_COLORS = ['#ffd700', '#ff6b6b', '#4ecdc4', '#a855f7', '#fb923c'];

export default async function handler(req, res) {
  const token = process.env.GITHUB_PAT;
  const grid = generateGrid();
  const ts = Date.now();

  try {
    const svg = buildSVG(grid, ts);

    // Scarica i file correnti in parallelo
    const [slotFile, readmeFile] = await Promise.all([
      ghGet(token, SLOT_REPO, 'slot.svg'),
      ghGet(token, PROFILE_REPO, 'README.md'),
    ]);

    // Committa entrambi in parallelo
    const updates = [
      ghPut(token, SLOT_REPO, 'slot.svg', svg, slotFile?.sha, '🎰 Spin'),
    ];

    if (readmeFile) {
      const oldReadme = Buffer.from(readmeFile.content, 'base64').toString('utf-8');
      const newReadme = oldReadme.replace(
        /api\/image\?(?:v|cache_buster)=[0-9]*/g,
        `api/image?v=${ts}`
      );
      if (newReadme !== oldReadme) {
        updates.push(
          ghPut(token, PROFILE_REPO, 'README.md', newReadme, readmeFile.sha, '🎰 Update slot')
        );
      }
    }

    await Promise.all(updates);
    res.redirect(302, `https://github.com/${OWNER}`);
  } catch (err) {
    res.status(500).send('Errore: ' + err.message);
  }
}

// --- GitHub API ---

async function ghGet(token, repo, path) {
  const r = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SlotMachine',
      },
    }
  );
  return r.ok ? r.json() : null;
}

async function ghPut(token, repo, path, content, sha, message) {
  const body = { message, content: Buffer.from(content).toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'SlotMachine',
      },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`PUT ${repo}/${path}: ${r.status}`);
}

// ─── Grid generation with near-miss ───

function generateGrid() {
  const grid = [];
  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[c][r] = ICONS[Math.floor(Math.random() * ICONS.length)];
    }
  }
  const wins = checkWins(grid);
  const scatCnt = countScatters(grid).length;
  if (wins.length === 0 && scatCnt < 3 && Math.random() < 0.25) {
    engineerNearMiss(grid);
  }
  return grid;
}

function engineerNearMiss(grid) {
  const pl = PAYLINES[0];
  const anchor = grid[0][pl[0]];
  if (anchor === SCATTER) return;
  grid[1][pl[1]] = anchor;
  const others = ICONS.filter(i => i !== anchor && i !== WILD && i !== SCATTER);
  if (others.length === 0) return;
  grid[2][pl[2]] = others[Math.floor(Math.random() * others.length)];
  const adjR = pl[2] > 0 ? pl[2] - 1 : pl[2] + 1;
  if (adjR >= 0 && adjR < ROWS) grid[2][adjR] = anchor;
}

// ─── Game logic ───

function checkWins(grid) {
  const wins = [];
  for (let p = 0; p < PAYLINES.length; p++) {
    const pl = PAYLINES[p];
    let anchor = null;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s !== WILD && s !== SCATTER) { anchor = s; break; }
    }
    if (!anchor) {
      if (grid[0][pl[0]] === WILD) anchor = WILD; else continue;
    }
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s === anchor || (s === WILD && anchor !== SCATTER)) count++;
      else break;
    }
    if (count >= 3) {
      wins.push({
        payline: p, count, symbol: anchor,
        positions: Array.from({ length: count }, (_, c) => ({ c, r: pl[c] })),
        color: PL_COLORS[p],
      });
    }
  }
  return wins;
}

function countScatters(grid) {
  const pos = [];
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      if (grid[c][r] === SCATTER) pos.push({ c, r });
  return pos;
}

function detectNearMiss(grid, wins) {
  if (wins.length > 0) return -1;
  const pl = PAYLINES[0];
  let anchor = null;
  for (let c = 0; c < COLS; c++) {
    const s = grid[c][pl[c]];
    if (s !== WILD && s !== SCATTER) { anchor = s; break; }
  }
  if (!anchor) return -1;
  let count = 0;
  for (let c = 0; c < COLS; c++) {
    const s = grid[c][pl[c]];
    if (s === anchor || s === WILD) count++; else break;
  }
  if (count < 2 || count >= COLS) return -1;
  const missCol = count;
  const missRow = pl[missCol];
  for (const adj of [missRow - 1, missRow + 1]) {
    if (adj >= 0 && adj < ROWS && grid[missCol][adj] === anchor) return missCol;
  }
  return -1;
}

// ─── SVG Generator ───

function buildSVG(grid, uid) {
  const CW = 78, CH = 56, GAP = 4;
  const SVG_W = 500, SVG_H = 330;
  const GY = 55;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const MX = Math.floor((SVG_W - GW) / 2);
  const TYO = 38, FS = 32, FILLERS = 14;
  const DUR = [1.4, 1.9, 2.4, 2.9, 3.4];
  const LDUR = DUR[COLS - 1];
  const scroll = FILLERS * CH;

  const colL = c => MX + c * (CW + GAP);
  const colC = c => colL(c) + CW / 2;
  const rowB = r => GY + r * CH + TYO;
  const cellCY = r => GY + r * CH + CH / 2;

  // ── Analyze ──
  const wins = checkWins(grid);
  const scatPos = countScatters(grid);
  const isFreeSpins = scatPos.length >= 3;
  const nearMissCol = detectNearMiss(grid, wins);
  const maxWin = wins.length > 0 ? Math.max(...wins.map(w => w.count)) : 0;
  const isJackpot = wins.some(w => w.count === 5 && w.symbol === '7️⃣');
  const isBigWin = maxWin >= 4 && !isJackpot;
  const isWin = wins.length > 0;
  const winCells = new Set();
  for (const w of wins) for (const p of w.positions) winCells.add(`${p.c},${p.r}`);

  const ED = LDUR + 0.4; // effect delay

  // ── CSS ──
  let css = '';

  // Border lights
  const bln = `bl${uid}`;
  css += isWin
    ? `@keyframes ${bln}{0%,100%{fill:#ffd700;opacity:1}50%{fill:#e94560;opacity:.3}}`
    : `@keyframes ${bln}{0%,15%{fill:#ffd700;opacity:.9}25%,100%{fill:#444;opacity:.2}}`;

  // Reel spins
  for (let c = 0; c < COLS; c++) {
    const a = `rs${uid}c${c}`;
    if (c === nearMissCol) {
      css += `@keyframes ${a}{0%{transform:translateY(-${scroll}px)}` +
        `65%{transform:translateY(22px)}75%{transform:translateY(-16px)}` +
        `84%{transform:translateY(9px)}92%{transform:translateY(-4px)}100%{transform:translateY(0)}}`;
    } else {
      css += `@keyframes ${a}{0%{transform:translateY(-${scroll}px)}` +
        `85%{transform:translateY(10px)}94%{transform:translateY(-3px)}100%{transform:translateY(0)}}`;
    }
  }

  // Win cell pulse
  css += `@keyframes wp${uid}{0%,100%{opacity:0}50%{opacity:.55}}`;
  // Payline line
  css += `@keyframes pf${uid}{from{opacity:0;stroke-width:1}to{opacity:.9;stroke-width:3}}`;
  // Overlays
  css += `@keyframes ov${uid}{from{opacity:0}to{opacity:.88}}`;
  css += `@keyframes ot${uid}{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}`;
  css += `@keyframes os${uid}{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}`;
  // Scatter glow
  css += `@keyframes sg${uid}{0%,100%{opacity:0;transform:scale(1)}50%{opacity:.6;transform:scale(1.08)}}`;
  // Fade in
  css += `@keyframes fi${uid}{from{opacity:0}to{opacity:1}}`;
  // Jackpot border flash
  css += `@keyframes jb${uid}{0%,100%{stroke:#ffd700}50%{stroke:#e94560}}`;
  // Jackpot rainbow shimmer
  css += `@keyframes jr${uid}{0%{fill:#ffd700}25%{fill:#ff6b6b}50%{fill:#4ecdc4}75%{fill:#a855f7}100%{fill:#ffd700}}`;
  // Near miss column flash
  css += `@keyframes nm${uid}{0%,100%{opacity:0}30%{opacity:.4}60%{opacity:0}}`;
  // Coins falling
  css += `@keyframes cf${uid}{0%{transform:translateY(-20px);opacity:1}100%{transform:translateY(180px);opacity:0}}`;
  // Big win zoom pulse
  css += `@keyframes bz${uid}{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}`;

  // ── Defs ──
  let defs = '';
  for (let c = 0; c < COLS; c++) {
    defs += `<clipPath id="cp${uid}c${c}"><rect x="${colL(c)}" y="${GY}" width="${CW}" height="${GH}"/></clipPath>`;
  }

  // ── Border lights ──
  const bulbs = [];
  for (let i = 0; i < 10; i++) { bulbs.push({ x: 25 + i * 50, y: 6 }); bulbs.push({ x: 25 + i * 50, y: SVG_H - 6 }); }
  for (let i = 0; i < 5; i++) { bulbs.push({ x: 6, y: 50 + i * 58 }); bulbs.push({ x: SVG_W - 6, y: 50 + i * 58 }); }
  const lightsSvg = bulbs.map((b, i) => {
    const dur = isWin ? 0.35 : 1.8;
    const dl = isWin ? ED + (i % 3) * 0.08 : i * (1.8 / bulbs.length);
    return `<circle cx="${b.x}" cy="${b.y}" r="4" fill="#444" opacity=".2" style="animation:${bln} ${dur}s ${dl}s infinite"/>`;
  }).join('');

  // ── Reels ──
  let colBGs = '', reelsSvg = '', colBordersSvg = '';
  for (let c = 0; c < COLS; c++) {
    const x = colL(c), cx = colC(c);
    colBGs += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="6" fill="#0f0f23"/>`;

    let texts = '';
    for (let r = 0; r < ROWS; r++) {
      texts += `<text x="${cx}" y="${rowB(r)}" text-anchor="middle" font-size="${FS}" font-family="sans-serif">${grid[c][r]}</text>`;
    }
    for (let f = 0; f < FILLERS; f++) {
      const y = rowB(ROWS - 1) + (f + 1) * CH;
      texts += `<text x="${cx}" y="${y}" text-anchor="middle" font-size="${FS}" font-family="sans-serif">${ICONS[Math.floor(Math.random() * ICONS.length)]}</text>`;
    }

    const dur = c === nearMissCol ? DUR[c] + 0.7 : DUR[c];
    reelsSvg += `<g clip-path="url(#cp${uid}c${c})"><g style="animation:rs${uid}c${c} ${dur}s cubic-bezier(.1,.7,.3,1) forwards">${texts}</g></g>`;
    colBordersSvg += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="6" fill="none" stroke="#e94560" stroke-width="1.5"/>`;
  }

  // ── Payline markers (left side) ──
  const plMarkers = PAYLINES.map((pl, i) => {
    const y = cellCY(pl[0]);
    return `<polygon points="${MX - 12},${y} ${MX - 4},${y - 5} ${MX - 4},${y + 5}" fill="${PL_COLORS[i]}" opacity=".35"/>`;
  }).join('');

  // ── Winning paylines ──
  let winLinesSvg = '';
  for (const w of wins) {
    const pts = [];
    for (let c = 0; c < w.count; c++) pts.push(`${colC(c)},${cellCY(w.positions[c].r)}`);
    winLinesSvg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${w.color}" stroke-width="3" stroke-linecap="round" style="animation:pf${uid} .4s ${ED}s forwards;opacity:0"/>`;
  }

  // ── Win cell glow ──
  let winGlowSvg = '';
  for (const key of winCells) {
    const [c, r] = key.split(',').map(Number);
    winGlowSvg += `<rect x="${colL(c)}" y="${GY + r * CH}" width="${CW}" height="${CH}" rx="4" fill="#ffd700" style="animation:wp${uid} .7s ${ED}s infinite;opacity:0"/>`;
  }

  // ── Scatter glow ──
  let scatGlowSvg = '';
  if (isFreeSpins) {
    for (const p of scatPos) {
      scatGlowSvg += `<rect x="${colL(p.c)}" y="${GY + p.r * CH}" width="${CW}" height="${CH}" rx="4" fill="#8b5cf6" style="animation:sg${uid} .5s ${ED}s infinite;opacity:0"/>`;
    }
  }

  // ── Near miss flash ──
  let nearMissSvg = '';
  if (nearMissCol >= 0) {
    nearMissSvg = `<rect x="${colL(nearMissCol)}" y="${GY}" width="${CW}" height="${GH}" rx="6" fill="#f59e0b" style="animation:nm${uid} 1.2s ${ED}s 2;opacity:0"/>`;
  }

  // ── Coins (on big win / jackpot) ──
  let coinsSvg = '';
  if (isBigWin || isJackpot) {
    const coinCount = isJackpot ? 12 : 6;
    for (let i = 0; i < coinCount; i++) {
      const cx = MX + 20 + Math.floor(Math.random() * (GW - 40));
      const dl = ED + 0.2 + i * 0.15;
      coinsSvg += `<text x="${cx}" y="${GY}" font-size="18" font-family="sans-serif" style="animation:cf${uid} 1.5s ${dl}s forwards;opacity:0">🪙</text>`;
    }
  }

  // ── Overlay ──
  let overlaySvg = '';
  let resultText = '', resultColor = '#e94560';

  if (isJackpot) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="8" fill="#1a1a2e" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<rect x="${MX + 2}" y="${GY + 2}" width="${GW - 4}" height="${GH - 4}" rx="6" fill="none" stroke="#ffd700" stroke-width="2" style="animation:jb${uid} .3s ${ED}s infinite;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 - 15}" text-anchor="middle" font-size="30" font-weight="bold" fill="#ffd700" font-family="sans-serif" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">🏆 JACKPOT! 🏆</text>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 18}" text-anchor="middle" font-size="14" fill="#ffd700" font-family="sans-serif" style="animation:fi${uid} .4s ${ED + 0.4}s forwards;opacity:0">5× 7️⃣ — Vincita leggendaria!</text>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 40}" text-anchor="middle" font-size="20" font-family="sans-serif" style="animation:jr${uid} 1s ${ED + 0.5}s infinite;opacity:0;animation-fill-mode:forwards">★ ★ ★ ★ ★</text>`;
    resultColor = '#ffd700';
  } else if (isFreeSpins && isWin) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="8" fill="#16a34a" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 - 12}" text-anchor="middle" font-size="24" font-weight="bold" fill="white" font-family="sans-serif" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">🎉 HAI VINTO! 🎉</text>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 18}" text-anchor="middle" font-size="18" fill="#ffd700" font-family="sans-serif" style="animation:os${uid} .4s ${ED + 0.35}s forwards;opacity:0">⭐ + FREE SPIN! ⭐</text>`;
    resultColor = '#16a34a';
  } else if (isFreeSpins) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="8" fill="#6d28d9" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 - 8}" text-anchor="middle" font-size="28" font-weight="bold" fill="white" font-family="sans-serif" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">⭐ FREE SPIN! ⭐</text>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 22}" text-anchor="middle" font-size="13" fill="#ddd" font-family="sans-serif" style="animation:fi${uid} .4s ${ED + 0.4}s forwards;opacity:0">${scatPos.length} scatter — Clicca di nuovo!</text>`;
    resultColor = '#8b5cf6';
  } else if (isBigWin) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="8" fill="#92400e" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 8}" text-anchor="middle" font-size="28" font-weight="bold" fill="#ffd700" font-family="sans-serif" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0;animation:bz${uid} .8s ${ED + 0.6}s infinite,ot${uid} .5s ${ED + 0.15}s forwards">💰 GRANDE VINCITA! 💰</text>`;
    resultColor = '#ffd700';
  } else if (isWin) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="8" fill="#16a34a" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 8}" text-anchor="middle" font-size="28" font-weight="bold" fill="white" font-family="sans-serif" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">🎉 HAI VINTO! 🎉</text>`;
    resultColor = '#16a34a';
  } else if (nearMissCol >= 0) {
    resultText = '😱 Così vicino! Ritenta!';
    resultColor = '#f59e0b';
  } else {
    resultText = 'Ritenta, sarai più fortunato!';
    resultColor = '#e94560';
  }

  // ── Win summary line ──
  let winSummary = '';
  if (wins.length > 0 && !isJackpot) {
    const desc = wins.map(w => `Linea ${w.payline + 1}: ${w.count}×${w.symbol}`).join('  ');
    winSummary = `<text x="${SVG_W / 2}" y="${GY + GH + 22}" text-anchor="middle" font-size="11" fill="#aaa" font-family="sans-serif" style="animation:fi${uid} .4s ${ED + 0.2}s forwards;opacity:0">${desc}</text>`;
  }

  // ── Payline info header ──
  const plInfo = `<text x="${SVG_W / 2}" y="${GY + GH + 38}" text-anchor="middle" font-size="9" fill="#555" font-family="sans-serif">💎 Wild  ·  ⭐ Scatter (3+ = Free Spin)  ·  5 paylines</text>`;

  // ── Border ──
  const borderAttr = isJackpot
    ? `stroke="#ffd700" stroke-width="3" style="animation:jb${uid} .3s ${ED}s infinite"`
    : isWin
      ? `stroke="#16a34a" stroke-width="2.5"`
      : `stroke="#e94560" stroke-width="2"`;

  // ── Assemble ──
  return `<svg width="${SVG_W}" height="${SVG_H}" xmlns="http://www.w3.org/2000/svg">
<defs>${defs}</defs>
<style>${css}</style>
<rect width="${SVG_W}" height="${SVG_H}" rx="18" fill="#1a1a2e"/>
<rect x="4" y="4" width="${SVG_W - 8}" height="${SVG_H - 8}" rx="16" fill="none" ${borderAttr}/>
${lightsSvg}
<text x="${SVG_W / 2}" y="38" text-anchor="middle" font-size="20" font-weight="bold" fill="#e94560" font-family="sans-serif">🎰 SLOT MACHINE 🎰</text>
<line x1="30" y1="47" x2="${SVG_W - 30}" y2="47" stroke="#e94560" stroke-width="1" opacity=".3"/>
${colBGs}
${reelsSvg}
${colBordersSvg}
${plMarkers}
${winLinesSvg}
${winGlowSvg}
${scatGlowSvg}
${nearMissSvg}
${coinsSvg}
${overlaySvg}
${winSummary}
${resultText ? `<text x="${SVG_W / 2}" y="${GY + GH + 22}" text-anchor="middle" font-size="14" fill="${resultColor}" font-family="sans-serif" style="animation:fi${uid} .4s ${ED}s forwards;opacity:0">${resultText}</text>` : ''}
${plInfo}
<text x="${SVG_W / 2}" y="${SVG_H - 8}" text-anchor="middle" font-size="10" fill="#444" font-family="sans-serif">github.com/simrim96</text>
</svg>`;
}
