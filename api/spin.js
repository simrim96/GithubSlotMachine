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
// Reel: linguaggi più wild. SCATTER non viene più inserito (free-spin rimosso).
const REEL = [
  ...LANGUAGES.flatMap((l) => Array(5).fill(l.id)),
  WILD_ID, WILD_ID, WILD_ID, WILD_ID,
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

    // Redirect:
    //  • Jackpot (5 in fila): porta alla lista filtrata di TUTTE le repo dell'utente
    //    in quel linguaggio → "discover all my projects".
    //  • Win normale: porta alla repo migliore per quel linguaggio.
    //  • Niente win: porta al profilo.
    const isJackpot = wins.some((w) => w.count === 5);
    let dest;
    if (winningLang && isJackpot) {
      const ghLang = encodeURIComponent(winningLang.githubLang || winningLang.name);
      dest = `https://github.com/${OWNER}?tab=repositories&language=${ghLang}`;
    } else {
      dest = repoMatch?.url || `https://github.com/${OWNER}`;
    }
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
  // Output ordinato: EN primario, IT secondario (linea successiva).
  const factLines = (f) => {
    if (!f) return [];
    if (typeof f === 'string') return [f];
    return [f.en, f.it].filter(Boolean);
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

  // Near-miss organico: probabilità alta perché il rilevatore ora scansiona
  // tutte le paylines, ma forziamo comunque la geometria sulla payline centrale
  // per garantire visibilità.
  if (wins.length === 0 && scatCnt < 3 && Math.random() < 0.55) {
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
  let anchor = grid[0][pl[0]];
  // Se l'ancora "naturale" è wild/scatter, sostituiamola con un linguaggio reale
  // — altrimenti detectNearMiss salterebbe il match e il near-miss non verrebbe
  // mai visualizzato.
  if (anchor === WILD_ID || anchor === SCATTER_ID) {
    anchor = SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
    grid[0][pl[0]] = anchor;
  }
  // Costruiamo un near-miss "profondo": 3 (o 4) anchor consecutivi sulla payline
  // centrale e poi un "break" con anchor adiacente al rullo successivo.
  const matchLen = Math.random() < 0.35 ? 4 : 3;
  for (let c = 1; c < matchLen; c++) grid[c][pl[c]] = anchor;
  if (matchLen >= COLS) return;
  const others = SYMBOL_IDS.filter((i) => i !== anchor);
  if (others.length === 0) return;
  // Rullo "di rottura" — quello che evidenziamo come near-miss.
  const breakCol = matchLen;
  grid[breakCol][pl[breakCol]] = others[Math.floor(Math.random() * others.length)];
  // Anchor adiacente nello stesso rullo → near-miss visivo.
  const adjR = pl[breakCol] > 0 ? pl[breakCol] - 1 : pl[breakCol] + 1;
  if (adjR >= 0 && adjR < ROWS) grid[breakCol][adjR] = anchor;
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
  // Scansioniamo TUTTE le paylines, non solo quella centrale: qualsiasi
  // 2+ in fila con un anchor adiacente nel rullo successivo è un near-miss
  // visivamente significativo. Restituiamo il primo rullo "di rottura" trovato.
  for (let p = 0; p < PAYLINES.length; p++) {
    const pl = PAYLINES[p];
    let anchor = null;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s !== WILD_ID && s !== SCATTER_ID) { anchor = s; break; }
    }
    if (!anchor) continue;
    let count = 0;
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      if (s === anchor || s === WILD_ID) count++; else break;
    }
    if (count < 2 || count >= COLS) continue;
    const missCol = count;
    const missRow = pl[missCol];
    for (const adj of [missRow - 1, missRow + 1]) {
      if (adj >= 0 && adj < ROWS && grid[missCol][adj] === anchor) return missCol;
    }
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
  const CW = 84, CH = 84, GAP = 8;
  // Altezza maggiorata per accogliere la PAYTABLE in basso.
  const SVG_W = 600, SVG_H = 700;
  const HDR_H = 92;
  // Striscia paytable: una riga compatta in fondo allo SVG.
  const PT_H = 96;
  const GY = HDR_H + 14;
  const GW = COLS * CW + (COLS - 1) * GAP;
  const GH = ROWS * CH;
  const MX = Math.floor((SVG_W - GW) / 2);
  const FILLERS = 18;
  // Durate "reel" più lunghe: la slot resta visibile più a lungo a fronte
  // del refresh della pagina che può nascondere parte dell'animazione.
  const DUR = [3.0, 3.8, 4.6, 5.4, 6.2];
  const LDUR = DUR[COLS - 1];
  const scroll = FILLERS * CH;
  // Near-miss tuning:
  //  • il rullo "quasi vincente" deve sembrare più veloce → stessa durata
  //    ma molti più cells da scorrere (pixel/s più alti);
  //  • i rulli successivi devono terminare DOPO quello di near-miss →
  //    quindi non aggiungiamo durata extra (DUR è monotonicamente crescente);
  //  • se il near-miss è l'ultimo rullo, possiamo prolungarlo per suspense.
  const NM_FILLERS_EXTRA = 36;
  const NM_DUR_EXTRA_LAST = 1.2;

  const colL = (c) => MX + c * (CW + GAP);
  const colC = (c) => colL(c) + CW / 2;
  const cellY = (r) => GY + r * CH;
  const cellCY = (r) => GY + r * CH + CH / 2;

  const wins = checkWins(grid);
  const nearMissCol = detectNearMiss(grid, wins);
  const maxWin = wins.length > 0 ? Math.max(...wins.map((w) => w.count)) : 0;
  const isJackpot = wins.some((w) => w.count === 5);
  const isBigWin = maxWin >= 4 && !isJackpot;
  const isWin = wins.length > 0;
  const winCells = new Set();
  for (const w of wins) for (const p of w.positions) winCells.add(`${p.c},${p.r}`);

  // ED = end-of-spin time. Solo se il near-miss è l'ultimo rullo prolunghiamo;
  // altrimenti l'ultimo rullo è già il più lento e termina di suo dopo.
  const ED = LDUR + (nearMissCol === COLS - 1 ? NM_DUR_EXTRA_LAST : 0) + 0.4;

  // ── CSS / animations ──
  let css = '';
  const bln = `bl${uid}`;
  css += isWin
    ? `@keyframes ${bln}{0%,100%{fill:#ffd700;opacity:1}50%{fill:#e94560;opacity:.3}}`
    : `@keyframes ${bln}{0%,15%{fill:#ffd700;opacity:.9}25%,100%{fill:#444;opacity:.2}}`;
  for (let c = 0; c < COLS; c++) {
    const a = `rs${uid}c${c}`;
    if (c === nearMissCol) {
      // Near-miss: scroll molto più lungo a parità di tempo → angular velocity
      // visibilmente maggiore. Finale a 4-step di rimbalzo per fingere la quasi-vincita.
      const nmScroll = scroll + NM_FILLERS_EXTRA * CH;
      css += `@keyframes ${a}{0%{transform:translateY(-${nmScroll}px)}` +
        `70%{transform:translateY(-${Math.round(scroll * 0.10)}px)}` +
        `80%{transform:translateY(28px)}87%{transform:translateY(-20px)}` +
        `93%{transform:translateY(11px)}97%{transform:translateY(-5px)}100%{transform:translateY(0)}}`;
    } else {
      css += `@keyframes ${a}{0%{transform:translateY(-${scroll}px)}` +
        `85%{transform:translateY(12px)}94%{transform:translateY(-4px)}100%{transform:translateY(0)}}`;
    }
  }
  css += `@keyframes wp${uid}{0%,100%{opacity:0}50%{opacity:.55}}`;
  css += `@keyframes ov${uid}{from{opacity:0}to{opacity:.92}}`;
  css += `@keyframes ot${uid}{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}`;
  css += `@keyframes fi${uid}{from{opacity:0}to{opacity:1}}`;
  css += `@keyframes jb${uid}{0%,100%{stroke:#ffd700}50%{stroke:#e94560}}`;
  css += `@keyframes nm${uid}{0%,100%{opacity:0}30%{opacity:.4}60%{opacity:0}}`;
  css += `@keyframes cf${uid}{0%{transform:translateY(-20px);opacity:1}100%{transform:translateY(220px);opacity:0}}`;
  // Shine attorno al rullo near-miss: opacità piena e sostenuta per (quasi) tutta
  // la durata della rotazione, poi snap a 0 nell'ultimo 4% → sparisce di colpo
  // quando il rullo si ferma.
  css += `@keyframes sh${uid}{0%{opacity:0;stroke-width:1}` +
    `8%{opacity:1;stroke-width:5}` +
    `50%{opacity:1;stroke-width:4}` +
    `90%{opacity:1;stroke-width:6}` +
    `96%{opacity:1;stroke-width:4}` +
    `100%{opacity:0;stroke-width:0}}`;
  // Pulse interno (alone giallo dietro al rullo) sincronizzato con sh.
  css += `@keyframes shp${uid}{0%{opacity:0}10%{opacity:.45}50%{opacity:.55}` +
    `90%{opacity:.65}97%{opacity:.55}100%{opacity:0}}`;
  // Shimmer interno (gradient sweep) per il rullo near-miss.
  css += `@keyframes shm${uid}{0%{transform:translateY(-100%)}100%{transform:translateY(${GH + 20}px)}}`;

  // ── Defs ──
  let defs = '';
  defs += `<radialGradient id="bg${uid}" cx="50%" cy="0%" r="120%"><stop offset="0%" stop-color="#2a2754"/><stop offset="55%" stop-color="#171530"/><stop offset="100%" stop-color="#0b0a1f"/></radialGradient>`;
  defs += `<linearGradient id="hdr${uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="33%" stop-color="#ffd700"/><stop offset="66%" stop-color="#4ecdc4"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>`;
  defs += `<linearGradient id="reelbg${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0b0b1f"/><stop offset="100%" stop-color="#1a1a35"/></linearGradient>`;
  defs += `<filter id="glow${uid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  // Gradient orizzontale per lo shimmer del near-miss.
  defs += `<linearGradient id="shg${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffd700" stop-opacity="0"/>` +
    `<stop offset="50%" stop-color="#ffd700" stop-opacity=".55"/>` +
    `<stop offset="100%" stop-color="#ffd700" stop-opacity="0"/>` +
    `</linearGradient>`;
  for (let c = 0; c < COLS; c++) {
    defs += `<clipPath id="cp${uid}c${c}"><rect x="${colL(c)}" y="${GY}" width="${CW}" height="${GH}"/></clipPath>`;
  }
  defs += buildSymbolDefs(uid);

  // ── Border bulbs ──
  const bulbs = [];
  for (let i = 0; i < 12; i++) { bulbs.push({ x: 25 + i * 51, y: 8 }); bulbs.push({ x: 25 + i * 51, y: SVG_H - 8 }); }
  for (let i = 0; i < 11; i++) { bulbs.push({ x: 8, y: 50 + i * 60 }); bulbs.push({ x: SVG_W - 8, y: 50 + i * 60 }); }
  const lightsSvg = bulbs.map((b, i) => {
    const dur = isWin ? 0.35 : 1.8;
    const dl = isWin ? ED + (i % 3) * 0.08 : i * (1.8 / bulbs.length);
    return `<circle cx="${b.x}" cy="${b.y}" r="3.5" fill="#444" opacity=".25" style="animation:${bln} ${dur}s ${dl}s infinite"/>`;
  }).join('');

  // ── Reels ──
  let colBGs = '', reelsSvg = '', colBordersSvg = '', nmShineSvg = '';
  for (let c = 0; c < COLS; c++) {
    const x = colL(c);
    const isNm = c === nearMissCol;
    colBGs += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="url(#reelbg${uid})"/>`;
    let cells = '';
    for (let r = 0; r < ROWS; r++) {
      cells += symbolUse(uid, grid[c][r], x, GY + r * CH);
    }
    // Near-miss: più fillers (scroll più lungo) per dare l'effetto "più veloce".
    const fillerCount = isNm ? FILLERS + NM_FILLERS_EXTRA : FILLERS;
    for (let f = 0; f < fillerCount; f++) {
      const y = GY + (ROWS + f) * CH;
      const fid = REEL[Math.floor(Math.random() * REEL.length)];
      cells += symbolUse(uid, fid, x, y);
    }
    const isLastCol = c === COLS - 1;
    // Durata: solo l'ultimo rullo (se near-miss) viene allungato; per gli altri
    // c manteniamo DUR[c] inalterato così da garantire che ogni rullo a destra
    // del near-miss finisca strettamente dopo (DUR è crescente).
    const dur = isNm && isLastCol ? DUR[c] + NM_DUR_EXTRA_LAST : DUR[c];
    reelsSvg += `<g clip-path="url(#cp${uid}c${c})"><g style="animation:rs${uid}c${c} ${dur}s cubic-bezier(.1,.7,.3,1) forwards">${cells}</g></g>`;
    colBordersSvg += `<rect x="${x}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="none" stroke="#e94560" stroke-width="1.4" opacity="0.55"/>`;

    // Near-miss shine: alone interno + bordo dorato spesso, attivi per tutta
    // la rotazione del rullo e poi spariti istantaneamente quando si ferma.
    if (isNm) {
      // Layer 0: alone giallo morbido leggermente più grande del rullo.
      nmShineSvg +=
        `<rect x="${x - 6}" y="${GY - 6}" width="${CW + 12}" height="${GH + 12}" rx="15"
               fill="#ffd700" filter="url(#glow${uid})"
               style="animation:shp${uid} ${dur}s ease-in-out forwards;opacity:0"/>`;
      // Layer 1: bordo dorato "pulsante" che resta su per tutta la rotazione.
      nmShineSvg +=
        `<rect x="${x - 2}" y="${GY - 2}" width="${CW + 4}" height="${GH + 4}" rx="13" fill="none"
               stroke="#ffd700" filter="url(#glow${uid})"
               style="animation:sh${uid} ${dur}s ease-in-out forwards;opacity:0"/>`;
      // Layer 2: shimmer verticale interno (sweep continuo) limitato al rullo.
      nmShineSvg +=
        `<g clip-path="url(#cp${uid}c${c})">
           <rect x="${x}" y="${GY}" width="${CW}" height="${Math.round(CH * 1.2)}"
                 fill="url(#shg${uid})" opacity=".9"
                 style="animation:shm${uid} ${(dur / 2.5).toFixed(2)}s linear infinite"/>
         </g>`;
    }
  }

  // Le linee di vincita (winning paylines + frecce indicatrici a sinistra)
  // sono state rimosse: comparivano in modo poco coerente. La vincita resta
  // comunicata dal glow giallo sulle celle e dai messaggi nel pannello.

  // ── Win glow ──
  let winGlowSvg = '';
  for (const key of winCells) {
    const [c, r] = key.split(',').map(Number);
    winGlowSvg += `<rect x="${colL(c)}" y="${cellY(r)}" width="${CW}" height="${CH}" rx="11" fill="#ffd700" style="animation:wp${uid} .7s ${ED}s infinite;opacity:0"/>`;
  }
  let nearMissSvg = '';
  if (nearMissCol >= 0) {
    nearMissSvg = `<rect x="${colL(nearMissCol)}" y="${GY}" width="${CW}" height="${GH}" rx="11" fill="#f59e0b" style="animation:nm${uid} 1.2s ${ED}s 2;opacity:0"/>`;
  }
  let coinsSvg = '';
  if (isBigWin || isJackpot) {
    const coinCount = isJackpot ? 16 : 9;
    for (let i = 0; i < coinCount; i++) {
      const cx = MX + 24 + Math.floor(Math.random() * (GW - 48));
      const dl = ED + 0.2 + i * 0.12;
      coinsSvg += `<text x="${cx}" y="${GY}" font-size="24" font-family="sans-serif" style="animation:cf${uid} 1.6s ${dl}s forwards;opacity:0">🪙</text>`;
    }
  }

  // ── Result panel ──
  // Lasciamo spazio in basso alla paytable: PY..(SVG_H - PT_H - 32).
  const PY = GY + GH + 14;
  const PH = SVG_H - PY - PT_H - 28;
  let panelSvg = '';
  if (isWin && winningLang) {
    const factEn = (fact && fact.en) || '';
    const factIt = (fact && fact.it) || '';
    const linesEn = wrap(factEn, 86).slice(0, 2);
    const linesIt = wrap(factIt, 86).slice(0, 2);
    const headLine = isJackpot ? `🏆 JACKPOT — ${winningLang.name}!`
                  : isBigWin ? `💰 BIG WIN — ${winningLang.name}!`
                  : `🎉 ${winningLang.name} WIN!`;
    const headColor = isJackpot ? '#ffd700' : isBigWin ? '#ffb84d' : '#4ade80';

    panelSvg += `<rect x="20" y="${PY}" width="${SVG_W - 40}" height="${PH}" rx="12" fill="#0e0d24" stroke="${headColor}" stroke-width="1.5" opacity="0.95" style="animation:fi${uid} .5s ${ED}s forwards;opacity:0"/>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + 24}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="17" font-weight="700" fill="${headColor}" style="animation:fi${uid} .5s ${ED + 0.1}s forwards;opacity:0">${escapeXml(headLine)}</text>`;
    let yy = PY + 46;
    // English (primary)
    if (linesEn.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.18}s forwards;opacity:0">EN</text>`;
      for (const line of linesEn) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="#e8e8f4" style="animation:fi${uid} .5s ${ED + 0.2}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 15;
      }
      yy += 4;
    }
    // Italiano (secondary)
    if (linesIt.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.28}s forwards;opacity:0">IT</text>`;
      for (const line of linesIt) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" fill="#b8b8d0" font-style="italic" style="animation:fi${uid} .5s ${ED + 0.3}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 14;
      }
    }
    if (repoMatch) {
      const ctaEn = isJackpot
        ? `🎯 JACKPOT → explore ALL my ${escapeXml(winningLang.name)} repos`
        : `→ github.com/${escapeXml(OWNER)}/${escapeXml(repoMatch.name)} · ${Math.round(repoMatch.pct * 100)}% ${escapeXml(winningLang.name)}`;
      panelSvg += `<text x="${SVG_W / 2}" y="${yy + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="${winningLang.accent}" font-weight="600" style="animation:fi${uid} .5s ${ED + 0.4}s forwards;opacity:0">${ctaEn}</text>`;
    } else if (isJackpot) {
      panelSvg += `<text x="${SVG_W / 2}" y="${yy + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="${winningLang.accent}" font-weight="600" style="animation:fi${uid} .5s ${ED + 0.4}s forwards;opacity:0">🎯 JACKPOT → explore ALL my ${escapeXml(winningLang.name)} repos</text>`;
    }
    // Se non c'è una repo pubblica con ≥30% del linguaggio: silenzio totale.
  } else {
    const msgEn = nearMissCol >= 0 ? '😱 So close — try again!' : 'Try again, better luck next time!';
    const msgIt = nearMissCol >= 0 ? 'Così vicino, ritenta!' : 'Ritenta, sarai più fortunato!';
    const col = nearMissCol >= 0 ? '#f59e0b' : '#e94560';
    panelSvg += `<rect x="20" y="${PY}" width="${SVG_W - 40}" height="${PH}" rx="12" fill="#0e0d24" stroke="${col}" stroke-width="1" opacity="0.9"/>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + PH / 2 - 4}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="15" font-weight="700" fill="${col}" style="animation:fi${uid} .4s ${ED}s forwards;opacity:0">${escapeXml(msgEn)}</text>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + PH / 2 + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-style="italic" fill="#8b8baf" style="animation:fi${uid} .4s ${ED + 0.1}s forwards;opacity:0">${escapeXml(msgIt)}</text>`;
  }

  // ── Overlay sopra griglia: solo per JACKPOT (5-in-a-row).
  // Free-spin/scatter rimossi: il jackpot ora ha utilità reale (redirect alla
  // lista filtrata di tutte le repo dell'utente in quel linguaggio).
  let overlaySvg = '';
  if (isJackpot) {
    overlaySvg =
      `<rect x="${MX}" y="${GY}" width="${GW}" height="${GH}" rx="11" fill="#1a1a2e" style="animation:ov${uid} .4s ${ED}s forwards;opacity:0"/>` +
      `<rect x="${MX + 2}" y="${GY + 2}" width="${GW - 4}" height="${GH - 4}" rx="10" fill="none" stroke="#ffd700" stroke-width="2" style="animation:jb${uid} .3s ${ED}s infinite;opacity:0"/>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 - 8}" text-anchor="middle" font-size="38" font-weight="800" fill="#ffd700" font-family="'Segoe UI',sans-serif" filter="url(#glow${uid})" style="animation:ot${uid} .5s ${ED + 0.15}s forwards;opacity:0">🏆 JACKPOT 🏆</text>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 16}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffd700" font-family="'Segoe UI',sans-serif" style="animation:ot${uid} .5s ${ED + 0.3}s forwards;opacity:0">Discover ALL my ${escapeXml(winningLang ? winningLang.name : '')} projects →</text>` +
      `<text x="${SVG_W / 2}" y="${GY + GH / 2 + 34}" text-anchor="middle" font-size="11" fill="#ffe88a" font-family="'Segoe UI',sans-serif" font-style="italic" style="animation:ot${uid} .5s ${ED + 0.4}s forwards;opacity:0">Scopri TUTTI i miei progetti ${escapeXml(winningLang ? winningLang.name : '')}</text>`;
  }

  // ── Header ──
  // Etichette EN "primarie" + IT in piccolo sotto. I numeri sono allineati
  // verso l'esterno (sinistra/destra) per non sovrapporsi al titolo centrato.
  const total = (state.totalSpins || 0).toLocaleString('en-US');
  const wonTotal = (state.totalWins || 0).toLocaleString('en-US');
  const headerSvg = `
<rect x="14" y="14" width="${SVG_W - 28}" height="${HDR_H - 6}" rx="14" fill="#13122d" opacity="0.85"/>
<text x="${SVG_W / 2}" y="40" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="22" font-weight="800" fill="url(#hdr${uid})" filter="url(#glow${uid})">DEV STACK SLOT MACHINE</text>
<text x="${SVG_W / 2}" y="58" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="10" fill="#8b8baf" letter-spacing="3">SPIN · LEARN · DISCOVER MY PROJECTS</text>
<g font-family="'Segoe UI',sans-serif">
  <text x="32" y="73" font-size="9" fill="#8b8bac" font-weight="700" letter-spacing="1.2">COMMUNITY SPINS</text>
  <text x="32" y="84" font-size="7" fill="#5d5d80" font-style="italic" letter-spacing="0.6">giri totali</text>
  <text x="32" y="100" font-size="15" font-weight="800" fill="#ffd700">${total}</text>
  <text x="${SVG_W - 32}" y="73" text-anchor="end" font-size="9" fill="#8b8bac" font-weight="700" letter-spacing="1.2">WINS</text>
  <text x="${SVG_W - 32}" y="84" text-anchor="end" font-size="7" fill="#5d5d80" font-style="italic" letter-spacing="0.6">vincite</text>
  <text x="${SVG_W - 32}" y="100" text-anchor="end" font-size="15" font-weight="800" fill="#4ade80">${wonTotal}</text>
</g>`;

  // ── Border ──
  const borderAttr = isJackpot
    ? `stroke="#ffd700" stroke-width="3" style="animation:jb${uid} .3s ${ED}s infinite"`
    : isWin
      ? `stroke="#16a34a" stroke-width="2.5"`
      : `stroke="#3a3666" stroke-width="2"`;

  // ── Paytable ──
  // Striscia in fondo allo SVG: per ogni linguaggio mostriamo
  // [mini-icona] + nome + N pallini pieni / 5 (= competence dell'owner).
  // Il titolo \u00e8 EN primario + IT secondario, in linea con il resto della UI.
  const PTY = SVG_H - PT_H - 8;
  const ptCount = LANGUAGES.length;
  const ptInner = SVG_W - 28;
  const ptCellW = ptInner / ptCount;
  const ptIconSize = 36;
  let paytableSvg = '';
  paytableSvg += `<rect x="14" y="${PTY}" width="${SVG_W - 28}" height="${PT_H}" rx="14" fill="#13122d" opacity="0.85"/>`;
  paytableSvg += `<text x="28" y="${PTY + 16}" font-family="'Segoe UI',sans-serif" font-size="10" font-weight="800" fill="#8b8baf" letter-spacing="2">PAYTABLE \u00b7 SKILL LEVEL</text>`;
  paytableSvg += `<text x="28" y="${PTY + 28}" font-family="'Segoe UI',sans-serif" font-size="8" font-style="italic" fill="#5d5d80" letter-spacing="0.6">tabella valori \u00b7 livello di competenza dell'owner</text>`;
  // Scala max: 5. Pallini pieni = competence, vuoti = 5 - competence.
  const PT_MAX = 5;
  for (let i = 0; i < ptCount; i++) {
    const lang = LANGUAGES[i];
    const cx = 14 + ptCellW * i + ptCellW / 2;
    const iconX = cx - ptIconSize / 2;
    const iconY = PTY + 32;
    paytableSvg += symbolUse(uid, lang.id, iconX, iconY, ptIconSize, ptIconSize);
    // Nome sotto l'icona.
    paytableSvg += `<text x="${cx}" y="${iconY + ptIconSize + 11}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="9" font-weight="700" fill="#d4d4e8">${escapeXml(lang.name)}</text>`;
    // Pallini di competenza.
    const lvl = Math.max(0, Math.min(PT_MAX, lang.competence ?? 0));
    const dotR = 2.1;
    const dotGap = 5.2;
    const dotsTotalW = PT_MAX * dotGap - (dotGap - 2 * dotR);
    const dotsX0 = cx - dotsTotalW / 2 + dotR;
    const dotsY = iconY + ptIconSize + 20;
    for (let d = 0; d < PT_MAX; d++) {
      const filled = d < lvl;
      paytableSvg += `<circle cx="${(dotsX0 + d * dotGap).toFixed(2)}" cy="${dotsY}" r="${dotR}" `
        + `fill="${filled ? lang.accent : '#2a2754'}" `
        + `stroke="${filled ? lang.accent : '#3a3666'}" stroke-width="0.6"/>`;
    }
  }

  const footer = `
<text x="${SVG_W / 2}" y="${SVG_H - 6}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="8" fill="#5d5d80">&lt;/&gt; Wild  \u00b7  5 paylines  \u00b7  5-in-a-row = JACKPOT (all my repos)  \u00b7  github.com/${escapeXml(OWNER)}</text>`;

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>${defs}</defs>
<style>${css}</style>
<rect width="${SVG_W}" height="${SVG_H}" rx="20" fill="url(#bg${uid})"/>
<rect x="4" y="4" width="${SVG_W - 8}" height="${SVG_H - 8}" rx="18" fill="none" ${borderAttr}/>
${lightsSvg}
${headerSvg}
${colBGs}
${reelsSvg}
${nmShineSvg}
${colBordersSvg}
${winGlowSvg}
${nearMissSvg}
${coinsSvg}
${overlaySvg}
${panelSvg}
${paytableSvg}
${footer}
</svg>`;
}
