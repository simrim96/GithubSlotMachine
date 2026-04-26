const OWNER = 'simrim96';
const SLOT_REPO = 'GithubSlotMachine';
const PROFILE_REPO = 'simrim96';
const ICONS = ['🍒', '💎', '🍋', '7️⃣', '🔔', '⭐'];
const COLS = 5;
const ROWS = 3;

export default async function handler(req, res) {
  const token = process.env.GITHUB_PAT;
  // Griglia 5 colonne × 3 righe
  const grid = [];
  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[c][r] = ICONS[Math.floor(Math.random() * ICONS.length)];
    }
  }
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

// --- Generatore SVG con animazione slot machine 5×3 ---

function buildSVG(grid, uid) {
  const FILLERS = 12;
  const CELL_W = 80;
  const CELL_H = 58;
  const COL_GAP = 5;
  const SVG_W = 500;
  const SVG_H = 280;
  const GRID_Y = 52;
  const FONT_SIZE = 32;
  const TEXT_Y_OFF = 38;  // offset da row top a text baseline
  const GRID_W = COLS * CELL_W + (COLS - 1) * COL_GAP;
  const MARGIN_X = Math.floor((SVG_W - GRID_W) / 2);
  const DUR = [1.6, 2.1, 2.6, 3.1, 3.6];
  const LAST_DUR = DUR[COLS - 1];
  const scroll = FILLERS * CELL_H;

  const colLeft = (c) => MARGIN_X + c * (CELL_W + COL_GAP);
  const colCenter = (c) => colLeft(c) + Math.floor(CELL_W / 2);
  const rowBaseline = (r) => GRID_Y + r * CELL_H + TEXT_Y_OFF;
  const gridH = ROWS * CELL_H;

  // Vittoria: riga centrale con ≥3 simboli uguali consecutivi da sinistra
  const midRow = grid.map(col => col[1]);
  let matchCount = 1;
  for (let i = 1; i < midRow.length; i++) {
    if (midRow[i] === midRow[0]) matchCount++;
    else break;
  }
  const isWin = matchCount >= 3;

  let defs = '';
  let css = '';
  let colBgs = '';
  let reelsSvg = '';
  let colBorders = '';

  for (let c = 0; c < COLS; c++) {
    const cid = `cl${uid}c${c}`;
    const aid = `an${uid}c${c}`;
    const x = colLeft(c);
    const cx = colCenter(c);

    // Clip: copre le 3 righe visibili
    defs += `<clipPath id="${cid}"><rect x="${x}" y="${GRID_Y}" width="${CELL_W}" height="${gridH}"/></clipPath>`;
    colBgs += `<rect x="${x}" y="${GRID_Y}" width="${CELL_W}" height="${gridH}" rx="6" fill="#0f0f23"/>`;

    // Striscia: 3 simboli finali (in alto) + FILLERS sotto
    let texts = '';
    for (let r = 0; r < ROWS; r++) {
      texts += `<text x="${cx}" y="${rowBaseline(r)}" text-anchor="middle" font-size="${FONT_SIZE}" font-family="sans-serif">${grid[c][r]}</text>`;
    }
    for (let f = 0; f < FILLERS; f++) {
      const y = rowBaseline(ROWS - 1) + (f + 1) * CELL_H;
      texts += `<text x="${cx}" y="${y}" text-anchor="middle" font-size="${FONT_SIZE}" font-family="sans-serif">${ICONS[Math.floor(Math.random() * ICONS.length)]}</text>`;
    }

    // Animazione verso il basso: da translateY(-scroll) a translateY(0)
    css += `@keyframes ${aid}{` +
      `0%{transform:translateY(-${scroll}px)}` +
      `85%{transform:translateY(10px)}` +
      `94%{transform:translateY(-3px)}` +
      `100%{transform:translateY(0)}}`;

    reelsSvg += `<g clip-path="url(#${cid})">` +
      `<g style="animation:${aid} ${DUR[c]}s cubic-bezier(.1,.7,.3,1) forwards">` +
      texts + `</g></g>`;

    colBorders += `<rect x="${x}" y="${GRID_Y}" width="${CELL_W}" height="${gridH}" rx="6" fill="none" stroke="#e94560" stroke-width="1.5"/>`;
  }

  // Indicatore payline (riga centrale)
  const payY = GRID_Y + CELL_H;
  const paylineSvg = `<rect x="${MARGIN_X - 4}" y="${payY}" width="${GRID_W + 8}" height="${CELL_H}" rx="3" fill="none" stroke="#ffd700" stroke-width="1.5" stroke-dasharray="4,3" opacity=".4"/>`;

  // Overlay vittoria
  let winCss = '';
  let winSvg = '';
  if (isWin) {
    winCss = `@keyframes w${uid}{from{opacity:0}to{opacity:.82}}` +
      `@keyframes wt${uid}{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}`;
    const oy = GRID_Y - 2;
    const oh = gridH + 4;
    winSvg = `<rect x="${MARGIN_X - 2}" y="${oy}" width="${GRID_W + 4}" height="${oh}" rx="8" fill="#16a34a" style="animation:w${uid} .5s ${LAST_DUR + 0.3}s forwards;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GRID_Y + gridH / 2 + 12}" text-anchor="middle" font-size="36" font-weight="bold" fill="white" font-family="sans-serif" style="animation:wt${uid} .4s ${LAST_DUR + 0.5}s forwards;opacity:0">🏆 HAI VINTO! 🏆</text>`;
  }

  // Testo risultato
  const fadeCss = `@keyframes f${uid}{from{opacity:0}to{opacity:1}}`;
  const resultLabel = isWin ? '💰 Congratulazioni! 💰' : 'Ritenta, sarai più fortunato!';
  const resultColor = isWin ? '#16a34a' : '#e94560';

  return `<svg width="${SVG_W}" height="${SVG_H}" xmlns="http://www.w3.org/2000/svg">
<defs>${defs}</defs>
<style>${css}${winCss}${fadeCss}</style>
<rect width="${SVG_W}" height="${SVG_H}" rx="18" fill="#1a1a2e"/>
<rect x="4" y="4" width="${SVG_W - 8}" height="${SVG_H - 8}" rx="16" fill="none" stroke="#e94560" stroke-width="2"/>
<text x="${SVG_W / 2}" y="38" text-anchor="middle" font-size="20" font-weight="bold" fill="#e94560" font-family="sans-serif">🎰 SLOT MACHINE 🎰</text>
<line x1="30" y1="47" x2="${SVG_W - 30}" y2="47" stroke="#e94560" stroke-width="1" opacity=".3"/>
${colBgs}
${reelsSvg}
${colBorders}
${paylineSvg}
${winSvg}
<text x="${SVG_W / 2}" y="250" text-anchor="middle" font-size="13" fill="${resultColor}" font-family="sans-serif" style="animation:f${uid} .5s ${LAST_DUR + 0.3}s both;opacity:0">${resultLabel}</text>
<text x="${SVG_W / 2}" y="270" text-anchor="middle" font-size="10" fill="#444" font-family="sans-serif">github.com/simrim96</text>
</svg>`;
}
