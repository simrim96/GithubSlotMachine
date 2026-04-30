import {
  LANGUAGES,
  WILD_ID,
  SCATTER_ID,
  LANGUAGE_BY_ID,
  buildSymbolDefs,
  symbolUse,
  pickFact,
  escapeXml,
} from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';

// ─── Owner / repo config ─────────────────────────────────────────────────────
const OWNER = 'simrim96';
const SLOT_REPO = 'GithubSlotMachine';
const PROFILE_REPO = 'simrim96';

// ─── Slot config ─────────────────────────────────────────────────────────────
const SYMBOL_IDS = LANGUAGES.map((l) => l.id);
// Reel "weights": ogni linguaggio appare N volte, wild/scatter più rari.
// Wild count maggiore = più chance di completare combo (slot "recruiter-friendly").
const REEL = [
  ...LANGUAGES.flatMap((l) => Array(5).fill(l.id)),
  WILD_ID, WILD_ID, WILD_ID, WILD_ID,
  SCATTER_ID,
];
// Probabilità di forzare una vincita garantita su una payline (post-RNG rigging).
const FORCED_WIN_PROB = 0.35;
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

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    res.status(500).send('GITHUB_PAT non configurato.');
    return;
  }

  const grid = generateGrid();
  const ts = Date.now();

  try {
    const [slotFile, readmeFile, stateBundle] = await Promise.all([
      ghGet(token, SLOT_REPO, 'slot.svg'),
      ghGet(token, PROFILE_REPO, 'README.md'),
      readState(token, OWNER, SLOT_REPO).catch(() => ({
        state: { totalSpins: 0, totalWins: 0, lastWin: null },
        sha: null,
      })),
    ]);

    let { state, sha: stateSha } = stateBundle;
    state.totalSpins = (state.totalSpins || 0) + 1;

    const wins = checkWins(grid);
    const isWin = wins.length > 0;
    const winningLang = isWin ? LANGUAGE_BY_ID[winningLangId(wins)] : null;

    let repoMatch = null;
    let fact = { it: '', en: '' };
    if (winningLang) {
      state.totalWins = (state.totalWins || 0) + 1;
      fact = pickFact(winningLang);
      try {
        repoMatch = await getRepoForLanguage(token, OWNER, winningLang, LANGUAGES);
      } catch (e) {
        console.warn('repo lookup failed:', e.message);
      }
      state.lastWin = {
        langId: winningLang.id,
        langName: winningLang.name,
        fact,
        repoUrl: repoMatch?.url || null,
        repoName: repoMatch?.name || null,
        repoDesc: repoMatch?.description || null,
        ts,
      };
    }

    const svg = buildSVG({ grid, uid: ts, state, winningLang, fact, repoMatch });

    const updates = [
      ghPut(token, SLOT_REPO, 'slot.svg', svg, slotFile?.sha, '🎰 Spin'),
      writeState(token, OWNER, SLOT_REPO, state, stateSha).catch((e) =>
        console.warn('state write:', e.message)
      ),
    ];

    if (readmeFile) {
      const oldReadme = Buffer.from(readmeFile.content, 'base64').toString('utf-8');
      let newReadme = oldReadme.replace(
        /api\/image\?(?:v|cache_buster)=[0-9]*/g,
        `api/image?v=${ts}`
      );
      newReadme = updateReadmeMarkers(newReadme, state, winningLang, repoMatch, fact);
      if (newReadme !== oldReadme) {
        updates.push(
          ghPut(token, PROFILE_REPO, 'README.md', newReadme, readmeFile.sha, '🎰 Update slot')
        );
      }
    }

    await Promise.all(updates);

    // Su vincita: redirect alla repo del linguaggio. Altrimenti al profilo.
    const dest = repoMatch?.url || `https://github.com/${OWNER}`;
    res.redirect(302, dest);
  } catch (err) {
    res.status(500).send('Errore: ' + err.message);
  }
}

// ─── README markers ──────────────────────────────────────────────────────────
function updateReadmeMarkers(readme, state, lang, repoMatch, fact) {
  const START = '<!-- SLOT_LAST_WIN_START -->';
  const END = '<!-- SLOT_LAST_WIN_END -->';
  if (!readme.includes(START) || !readme.includes(END)) return readme;

  const total = state.totalSpins || 0;
  const wins = state.totalWins || 0;
  let block = `${START}\n`;
  block += `> 🎰 **Total community spins:** \`${total.toLocaleString('en-US')}\` · **Wins:** \`${wins.toLocaleString('en-US')}\`\n`;
  // Helper: estrae le due lingue dal fact (string o {it,en}) per retro-compat.
  const factLines = (f) => {
    if (!f) return [];
    if (typeof f === 'string') return [f];
    return [f.it, f.en].filter(Boolean);
  };
  if (lang && repoMatch) {
    block += `>\n> 🏆 **Last win:** \`${lang.name}\` → [${repoMatch.name}](${repoMatch.url})  \n`;
    for (const line of factLines(fact)) {
      block += `> _${escapeMarkdown(line)}_  \n`;
    }
  } else if (lang) {
    // Win senza repo pubblica ≥30%: mostriamo solo il fact, niente messaggi sospetti.
    block += `>\n> 🏆 **Last win:** \`${lang.name}\`  \n`;
    for (const line of factLines(fact)) {
      block += `> _${escapeMarkdown(line)}_  \n`;
    }
  } else if (state.lastWin) {
    const lw = state.lastWin;
    block += `>\n> 🏆 **Last win:** \`${lw.langName}\`${lw.repoUrl ? ` → [${lw.repoName}](${lw.repoUrl})` : ''}  \n`;
    for (const line of factLines(lw.fact)) {
      block += `> _${escapeMarkdown(line)}_  \n`;
    }
  }
  block += END;

  return readme.replace(
    new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}`),
    block
  );
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeMarkdown(s) { return String(s).replace(/[*_`[\]]/g, '\\$&'); }

// ─── GitHub API ──────────────────────────────────────────────────────────────
async function ghGet(token, repo, path) {
  const r = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GithubSlotMachine',
      },
    }
  );
  return r.ok ? r.json() : null;
}

async function ghPut(token, repo, path, content, sha, message, _retry = false) {
  const encoded = Buffer.from(content).toString('base64');
  const body = { message, content: encoded };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GithubSlotMachine',
      },
      body: JSON.stringify(body),
    }
  );
  if (r.status === 409 && !_retry) {
    // SHA stale o mancante: rifetch il file per ottenere lo SHA aggiornato e riprova.
    const fresh = await ghGet(token, repo, path);
    return ghPut(token, repo, path, content, fresh?.sha ?? null, message, true);
  }
  if (!r.ok) throw new Error(`PUT ${repo}/${path}: ${r.status}`);
}

// ─── Grid generation ─────────────────────────────────────────────────────────
function generateGrid() {
  const grid = [];
  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[c][r] = REEL[Math.floor(Math.random() * REEL.length)];
    }
  }
  let wins = checkWins(grid);
  const scatCnt = countScatters(grid).length;

  // Forza una vincita con probabilità configurabile, per non frustrare i recruiter.
  if (wins.length === 0 && scatCnt < 3 && Math.random() < FORCED_WIN_PROB) {
    engineerWin(grid);
    wins = checkWins(grid);
  }

  // Altrimenti, ogni tanto regaliamo un near-miss (suspense).
  if (wins.length === 0 && scatCnt < 3 && Math.random() < 0.25) {
    engineerNearMiss(grid);
  }
  return grid;
}

// Forza 3-4 simboli uguali sulla payline centrale per garantire una win.
function engineerWin(grid) {
  const pl = PAYLINES[0];
  const lang = SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
  // 3 di base; con 30% chance ne aggiunge un 4°.
  const count = Math.random() < 0.3 ? 4 : 3;
  for (let c = 0; c < count; c++) grid[c][pl[c]] = lang;
  // Spezza la sequenza con un simbolo diverso per evitare 5-in-a-row accidentale.
  if (count < COLS) {
    const others = SYMBOL_IDS.filter((i) => i !== lang);
    if (others.length) {
      grid[count][pl[count]] = others[Math.floor(Math.random() * others.length)];
    }
  }
}

function engineerNearMiss(grid) {
  const pl = PAYLINES[0];
  const anchor = grid[0][pl[0]];
  if (anchor === SCATTER_ID) return;
  grid[1][pl[1]] = anchor;
  const others = SYMBOL_IDS.filter((i) => i !== anchor);
  if (others.length === 0) return;
  grid[2][pl[2]] = others[Math.floor(Math.random() * others.length)];
  const adjR = pl[2] > 0 ? pl[2] - 1 : pl[2] + 1;
  if (adjR >= 0 && adjR < ROWS) grid[2][adjR] = anchor;
}

// ─── Game logic ──────────────────────────────────────────────────────────────
function checkWins(grid) {
  const wins = [];
  for (let p = 0; p < PAYLINES.length; p++) {
    const pl = PAYLINES[p];
    let anchor = null;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s !== WILD_ID && s !== SCATTER_ID) { anchor = s; break; }
    }
    if (!anchor) {
      if (grid[0][pl[0]] === WILD_ID) anchor = WILD_ID; else continue;
    }
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s === anchor || (s === WILD_ID && anchor !== SCATTER_ID)) count++;
      else break;
    }
    if (count >= 3) {
      wins.push({
        payline: p,
        count,
        symbol: anchor,
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
      if (grid[c][r] === SCATTER_ID) pos.push({ c, r });
  return pos;
}

function detectNearMiss(grid, wins) {
  if (wins.length > 0) return -1;
  const pl = PAYLINES[0];
  let anchor = null;
  for (let c = 0; c < COLS; c++) {
    const s = grid[c][pl[c]];
    if (s !== WILD_ID && s !== SCATTER_ID) { anchor = s; break; }
  }
  if (!anchor) return -1;
  let count = 0;
  for (let c = 0; c < COLS; c++) {
    const s = grid[c][pl[c]];
    if (s === anchor || s === WILD_ID) count++; else break;
  }
  if (count < 2 || count >= COLS) return -1;
  const missCol = count;
  const missRow = pl[missCol];
  for (const adj of [missRow - 1, missRow + 1]) {
    if (adj >= 0 && adj < ROWS && grid[missCol][adj] === anchor) return missCol;
  }
  return -1;
}

function winningLangId(wins) {
  let best = null;
  for (const w of wins) {
    if (w.symbol === WILD_ID || w.symbol === SCATTER_ID) continue;
    if (!best || w.count > best.count) best = w;
  }
  if (best) return best.symbol;
  for (const w of wins) if (w.symbol !== SCATTER_ID) return w.symbol;
  return null;
}

// ─── Word wrap ───────────────────────────────────────────────────────────────
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur ? cur + ' ' : '') + w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── SVG Generator ───────────────────────────────────────────────────────────
function buildSVG({ grid, uid, state, winningLang, fact, repoMatch }) {
  const CW = 78, CH = 56, GAP = 6;
  const SVG_W = 560, SVG_H = 470;
  const HDR_H = 92;
  const GY = HDR_H + 12;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const MX = Math.floor((SVG_W - GW) / 2);
  const FILLERS = 14;
  const DUR = [1.4, 1.9, 2.4, 2.9, 3.4];
  const LDUR = DUR[COLS - 1];
  const scroll = FILLERS * CH;

  const colL = (c) => MX + c * (CW + GAP);
  const colC = (c) => colL(c) + CW / 2;
  const cellY = (r) => GY + r * CH;
  const cellCY = (r) => GY + r * CH + CH / 2;

  const wins = checkWins(grid);
  const scatPos = countScatters(grid);
  const isFreeSpins = scatPos.length >= 3;
  const nearMissCol = detectNearMiss(grid, wins);
  const maxWin = wins.length > 0 ? Math.max(...wins.map((w) => w.count)) : 0;
  const isJackpot = wins.some((w) => w.count === 5);
  const isBigWin = maxWin >= 4 && !isJackpot;
  const isWin = wins.length > 0;
  const winCells = new Set();
  for (const w of wins) for (const p of w.positions) winCells.add(`${p.c},${p.r}`);

  const ED = LDUR + 0.4;

  // ── CSS / animations ──
  let css = '';
  const bln = `bl${uid}`;
  css += isWin
    ? `@keyframes ${bln}{0%,100%{fill:#ffd700;opacity:1}50%{fill:#e94560;opacity:.3}}`
    : `@keyframes ${bln}{0%,15%{fill:#ffd700;opacity:.9}25%,100%{fill:#444;opacity:.2}}`;
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
  css += `@keyframes wp${uid}{0%,100%{opacity:0}50%{opacity:.55}}`;
  css += `@keyframes pf${uid}{from{opacity:0;stroke-width:1}to{opacity:.9;stroke-width:3}}`;
  css += `@keyframes ov${uid}{from{opacity:0}to{opacity:.92}}`;
  css += `@keyframes ot${uid}{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}`;
  css += `@keyframes sg${uid}{0%,100%{opacity:0;transform:scale(1)}50%{opacity:.6;transform:scale(1.08)}}`;
  css += `@keyframes fi${uid}{from{opacity:0}to{opacity:1}}`;
  css += `@keyframes jb${uid}{0%,100%{stroke:#ffd700}50%{stroke:#e94560}}`;
  css += `@keyframes nm${uid}{0%,100%{opacity:0}30%{opacity:.4}60%{opacity:0}}`;
  css += `@keyframes cf${uid}{0%{transform:translateY(-20px);opacity:1}100%{transform:translateY(180px);opacity:0}}`;

  // ── Defs ──
  let defs = '';
  defs += `<radialGradient id="bg${uid}" cx="50%" cy="0%" r="120%"><stop offset="0%" stop-color="#2a2754"/><stop offset="55%" stop-color="#171530"/><stop offset="100%" stop-color="#0b0a1f"/></radialGradient>`;
  defs += `<linearGradient id="hdr${uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="33%" stop-color="#ffd700"/><stop offset="66%" stop-color="#4ecdc4"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>`;
  defs += `<linearGradient id="reelbg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0b0b1f"/><stop offset="100%" stop-color="#1a1a35"/></linearGradient>`;
  defs += `<filter id="glow${uid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  for (let c = 0; c < COLS; c++) {
    defs += `<clipPath id="cp${uid}c${c}"><rect x="${colL(c)}" y="${GY}" width="${CW}" height="${GH}"/></clipPath>`;
  }
  defs += buildSymbolDefs(uid);

  // ── Border bulbs ──
  const bulbs = [];
  for (let i = 0; i < 11; i++) { bulbs.push({ x: 25 + i * 51, y: 8 }); bulbs.push({ x: 25 + i * 51, y: SVG_H - 8 }); }
  for (let i = 0; i < 7; i++) { bulbs.push({ x: 8, y: 50 + i * 60 }); bulbs.push({ x: SVG_W - 8, y: 50 + i * 60 }); }
  const lightsSvg = bulbs.map((b, i) => {
    const dur = isWin ? 0.35 : 1.8;
    const dl = isWin ? ED + (i % 3) * 0.08 : i * (1.8 / bulbs.length);
    return `<circle cx="${b.x}" cy="${b.y}" r="3.5" fill="#444" opacity=".25" style="animation:${bln} ${dur}s ${dl}s infinite"/>`;
  }).join('');

  // ── Reels ──
  let colBGs = '', reelsSvg = '', colBordersSvg = '';
  for (let c = 0; c < COLS; c++) {
    const x = colL(c);
    colBGs += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="9" fill="url(#reelbg${uid})"/>`;
    let cells = '';
    for (let r = 0; r < ROWS; r++) {
      cells += symbolUse(uid, grid[c][r], x, GY + r * CH);
    }
    for (let f = 0; f < FILLERS; f++) {
      const y = GY + (ROWS + f) * CH;
      const fid = REEL[Math.floor(Math.random() * REEL.length)];
      cells += symbolUse(uid, fid, x, y);
    }
    const dur = c === nearMissCol ? DUR[c] + 0.7 : DUR[c];
    reelsSvg += `<g clip-path="url(#cp${uid}c${c})"><g style="animation:rs${uid}c${c} ${dur}s cubic-bezier(.1,.7,.3,1) forwards">${cells}</g></g>`;
    colBordersSvg += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="9" fill="none" stroke="#e94560" stroke-width="1.4" opacity="0.55"/>`;
  }

  // ── Payline markers ──
  const plMarkers = PAYLINES.map((pl, i) => {
    const y = cellCY(pl[0]);
    return `<polygon points="${MX - 14},${y} ${MX - 4},${y - 5} ${MX - 4},${y + 5}" fill="${PL_COLORS[i]}" opacity=".45"/>`;
  }).join('');

  // ── Winning paylines ──
  let winLinesSvg = '';
  for (const w of wins) {
    const pts = [];
    for (let c = 0; c < w.count; c++) pts.push(`${colC(c)},${cellCY(w.positions[c].r)}`);
    winLinesSvg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${w.color}" stroke-width="3" stroke-linecap="round" filter="url(#glow${uid})" style="animation:pf${uid} .4s ${ED}s forwards;opacity:0"/>`;
  }

  // ── Win glow ──
  let winGlowSvg = '';
  for (const key of winCells) {
    const [c, r] = key.split(',').map(Number);
    winGlowSvg += `<rect x="${colL(c)}" y="${cellY(r)}" width="${CW}" height="${CH}" rx="9" fill="#ffd700" style="animation:wp${uid} .7s ${ED}s infinite;opacity:0"/>`;
  }
  let scatGlowSvg = '';
  if (isFreeSpins) {
    for (const p of scatPos) {
      scatGlowSvg += `<rect x="${colL(p.c)}" y="${cellY(p.r)}" width="${CW}" height="${CH}" rx="9" fill="#a855f7" style="animation:sg${uid} .5s ${ED}s infinite;opacity:0"/>`;
    }
  }
  let nearMissSvg = '';
  if (nearMissCol >= 0) {
    nearMissSvg = `<rect x="${colL(nearMissCol)}" y="${GY}" width="${CW}" height="${GH}" rx="9" fill="#f59e0b" style="animation:nm${uid} 1.2s ${ED}s 2;opacity:0"/>`;
  }
  let coinsSvg = '';
  if (isBigWin || isJackpot) {
    const coinCount = isJackpot ? 14 : 8;
    for (let i = 0; i < coinCount; i++) {
      const cx = MX + 20 + Math.floor(Math.random() * (GW - 40));
      const dl = ED + 0.2 + i * 0.12;
      coinsSvg += `<text x="${cx}" y="${GY}" font-size="20" font-family="sans-serif" style="animation:cf${uid} 1.5s ${dl}s forwards;opacity:0">🪙</text>`;
    }
  }

  // ── Result panel ──
  const PY = GY + GH + 14;
  const PH = SVG_H - PY - 32;
  let panelSvg = '';
  if (isWin && winningLang) {
    const factIt = (fact && fact.it) || '';
    const factEn = (fact && fact.en) || '';
    const linesIt = wrap(factIt, 78).slice(0, 2);
    const linesEn = wrap(factEn, 78).slice(0, 2);
    const headLine = isJackpot ? `🏆 JACKPOT — ${winningLang.name}!`
                  : isBigWin ? `💰 BIG WIN — ${winningLang.name}!`
                  : `🎉 ${winningLang.name} WIN!`;
    const headColor = isJackpot ? '#ffd700' : isBigWin ? '#ffb84d' : '#4ade80';

    panelSvg += `<rect x="20" y="${PY}" width="${SVG_W - 40}" height="${PH}" rx="12" fill="#0e0d24" stroke="${headColor}" stroke-width="1.5" opacity="0.95" style="animation:fi${uid} .5s ${ED}s forwards;opacity:0"/>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + 22}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="16" font-weight="700" fill="${headColor}" style="animation:fi${uid} .5s ${ED + 0.1}s forwards;opacity:0">${escapeXml(headLine)}</text>`;
    let yy = PY + 42;
    // Italiano
    if (linesIt.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.18}s forwards;opacity:0">IT</text>`;
      for (const line of linesIt) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" fill="#e2e2f0" style="animation:fi${uid} .5s ${ED + 0.2}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 13;
      }
      yy += 2;
    }
    // English
    if (linesEn.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.28}s forwards;opacity:0">EN</text>`;
      for (const line of linesEn) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" fill="#b8b8d0" font-style="italic" style="animation:fi${uid} .5s ${ED + 0.3}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 13;
      }
    }
    if (repoMatch) {
      panelSvg += `<text x="${SVG_W / 2}" y="${yy + 14}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="${winningLang.accent}" font-weight="600" style="animation:fi${uid} .5s ${ED + 0.4}s forwards;opacity:0">→ github.com/${escapeXml(OWNER)}/${escapeXml(repoMatch.name)} · ${Math.round(repoMatch.pct * 100)}% ${escapeXml(winningLang.name)}</text>`;
    }
    // Se non c'è una repo pubblica con ≥30% del linguaggio: silenzio totale.
  } else {
    const msg = nearMissCol >= 0 ? '😱 Così vicino! Ritenta!' : 'Ritenta, sarai più fortunato!';
    const col = nearMissCol >= 0 ? '#f59e0b' : '#e94560';
    panelSvg += `<rect x="20" y="${PY}" width="${SVG_W - 40}" height="${PH}" rx="12" fill="#0e0d24" stroke="${col}" stroke-width="1" opacity="0.9"/>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + PH / 2 + 5}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="14" fill="${col}" style="animation:fi${uid} .4s ${ED}s forwards;opacity:0">${escapeXml(msg)}</text>`;
  }

  // ── Overlay sopra griglia (jackpot / freespin) ──
  let overlaySvg = '';
  if (isJackpot) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="10" fill="#1a1a2e" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<rect x="${MX + 2}" y="${GY + 2}" width="${GW - 4}" height="${GH - 4}" rx="9" fill="none" stroke="#ffd700" stroke-width="2" style="animation:jb${uid} .3s ${ED}s infinite;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 6}" text-anchor="middle" font-size="34" font-weight="800" fill="#ffd700" font-family="'Segoe UI',sans-serif" filter="url(#glow${uid})" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">🏆 JACKPOT 🏆</text>`;
  } else if (isFreeSpins && !isWin) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="10" fill="#6d28d9" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 8}" text-anchor="middle" font-size="28" font-weight="800" fill="#fff" font-family="'Segoe UI',sans-serif" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">⭐ FREE SPIN ⭐</text>`;
  }

  // ── Header ──
  // Layout verticale: titolo → sottotitolo → (label + numero) sulla stessa riga,
  // ma con il numero spostato più in basso rispetto al label per evitare sovrapposizioni.
  const total = (state.totalSpins || 0).toLocaleString('en-US');
  const wonTotal = (state.totalWins || 0).toLocaleString('en-US');
  const headerSvg = `
<rect x="14" y="14" width="${SVG_W - 28}" height="${HDR_H - 6}" rx="14" fill="#13122d" opacity="0.85"/>
<text x="${SVG_W / 2}" y="40" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="22" font-weight="800" fill="url(#hdr${uid})" filter="url(#glow${uid})">DEV STACK SLOT MACHINE</text>
<text x="${SVG_W / 2}" y="58" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="10" fill="#8b8baf" letter-spacing="3">SPIN · LEARN · DISCOVER MY PROJECTS</text>
<g font-family="'Segoe UI',sans-serif">
  <text x="32" y="72" font-size="9" fill="#6d6d8e" letter-spacing="1.2">COMMUNITY SPINS</text>
  <text x="32" y="88" font-size="14" font-weight="700" fill="#ffd700">${total}</text>
  <text x="${SVG_W - 32}" y="72" text-anchor="end" font-size="9" fill="#6d6d8e" letter-spacing="1.2">WINS</text>
  <text x="${SVG_W - 32}" y="88" text-anchor="end" font-size="14" font-weight="700" fill="#4ade80">${wonTotal}</text>
</g>`;

  // ── Border ──
  const borderAttr = isJackpot
    ? `stroke="#ffd700" stroke-width="3" style="animation:jb${uid} .3s ${ED}s infinite"`
    : isWin
      ? `stroke="#16a34a" stroke-width="2.5"`
      : `stroke="#3a3666" stroke-width="2"`;

  const footer = `
<text x="${SVG_W / 2}" y="${SVG_H - 14}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="9" fill="#5d5d80">★ Wild  ·  ✦ Scatter (3+ = Free Spin)  ·  5 paylines  ·  github.com/${escapeXml(OWNER)}</text>`;

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>${defs}</defs>
<style>${css}</style>
<rect width="${SVG_W}" height="${SVG_H}" rx="20" fill="url(#bg${uid})"/>
<rect x="4" y="4" width="${SVG_W - 8}" height="${SVG_H - 8}" rx="18" fill="none" ${borderAttr}/>
${lightsSvg}
${headerSvg}
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
${panelSvg}
${footer}
</svg>`;
}
