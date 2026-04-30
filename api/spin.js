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
  const SVG_W = 600, SVG_H = 624;
  const HDR_H = 64;
  // Niente crown: top compatto.
  const CROWN_H = 0;
  const HDR_TOP = 2;
  // PAYTABLE in alto, sotto l'header: spiega che le icone con più pallini
  // sono quelle che il proprietario padroneggia meglio → e quindi "pagano" di più.
  const PT_H = 112;
  const PT_Y = HDR_TOP + HDR_H + 4;
  // Margine extra prima dei rulli per ospitare la cornice gialla a lampadine
  // attorno allo "screen" (FRAME_PAD viene definito più in basso).
  const GY = PT_Y + PT_H + 18;
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
  // Evidenzia solo le celle della payline vincente "migliore" (= count
  // più alto, a parità la prima trovata). Così lo schermo non si riempie
  // di glow quando lo stesso simbolo capita anche su V/Λ accidentalmente:
  // viene evidenziata solo UNA linea per spin.
  const bestWin = wins.length
    ? wins.reduce((a, b) => (b.count > a.count ? b : a))
    : null;
  if (bestWin) {
    for (const p of bestWin.positions) winCells.add(`${p.c},${p.r}`);
  }

  // ED = end-of-spin time. Solo se il near-miss è l'ultimo rullo prolunghiamo;
  // altrimenti l'ultimo rullo è già il più lento e termina di suo dopo.
  const ED = LDUR + (nearMissCol === COLS - 1 ? NM_DUR_EXTRA_LAST : 0) + 0.4;

  // ── CSS / animations ──
  let css = '';
  const bln = `bl${uid}`;
  css += isWin
    ? `@keyframes ${bln}{0%,100%{opacity:1}50%{opacity:.35}}`
    : `@keyframes ${bln}{0%,18%{opacity:1}30%,100%{opacity:.32}}`;
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
  // Classic cartoon slot-machine palette: flat lacquered red cabinet,
  // thick golden marquee frame, glowing yellow bulbs.
  defs += `<linearGradient id="cab${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#e8331f"/>` +
    `<stop offset="50%" stop-color="#c41e1e"/>` +
    `<stop offset="100%" stop-color="#7a0f0f"/>` +
    `</linearGradient>`;
  defs += `<linearGradient id="cabHi${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ff6a4a" stop-opacity=".55"/>` +
    `<stop offset="100%" stop-color="#ff6a4a" stop-opacity="0"/>` +
    `</linearGradient>`;
  defs += `<linearGradient id="frame${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffd84a"/>` +
    `<stop offset="50%" stop-color="#f5a623"/>` +
    `<stop offset="100%" stop-color="#c47a07"/>` +
    `</linearGradient>`;
  defs += `<radialGradient id="bulbOn${uid}" cx="35%" cy="30%" r="70%">` +
    `<stop offset="0%" stop-color="#fffbe6"/>` +
    `<stop offset="40%" stop-color="#ffd84a"/>` +
    `<stop offset="100%" stop-color="#a85a00"/>` +
    `</radialGradient>`;
  defs += `<linearGradient id="goldBar${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffe066"/>` +
    `<stop offset="55%" stop-color="#f5a623"/>` +
    `<stop offset="100%" stop-color="#a86610"/>` +
    `</linearGradient>`;
  // Banner JACKPOT: gradient arancio-oro con punte luminose.
  defs += `<linearGradient id="banner${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#fff4a8"/>` +
    `<stop offset="30%" stop-color="#ffd84a"/>` +
    `<stop offset="70%" stop-color="#f5a623"/>` +
    `<stop offset="100%" stop-color="#a85a00"/>` +
    `</linearGradient>`;
  // "7" rosso bombato: classico simbolo da slot machine.
  defs += `<linearGradient id="red7${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ff5a5a"/>` +
    `<stop offset="50%" stop-color="#e11d1d"/>` +
    `<stop offset="100%" stop-color="#7a0707"/>` +
    `</linearGradient>`;
  // Pannello scuro per finestrelle decorative (scoreboard / coin slot).
  defs += `<linearGradient id="darkPanel${uid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#0a0612"/>` +
    `<stop offset="100%" stop-color="#1a0d2a"/>` +
    `</linearGradient>`;
  // Bulb "rosso" alternato per la marquee.
  defs += `<radialGradient id="bulbRed${uid}" cx="35%" cy="30%" r="70%">` +
    `<stop offset="0%" stop-color="#ffd0d0"/>` +
    `<stop offset="40%" stop-color="#ff4040"/>` +
    `<stop offset="100%" stop-color="#7a0707"/>` +
    `</radialGradient>`;
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

  // ── Marquee bulbs (golden frame around the reel screen) ──
  // Stile cartoon classico: una cornice gialla spessa attorno ai SOLI rulli
  // (lo "schermo" della slot) con lampadine dorate distribuite uniformemente
  // sui quattro lati. È la firma visiva delle slot machine vintage.
  // In stato "win" pulsano rapidamente; in idle scorrono in chase sequenziale.
  const FRAME_PAD = 22;            // spessore della cornice gialla
  const SCR_X = MX - FRAME_PAD;
  const SCR_Y = GY - FRAME_PAD;
  const SCR_W = GW + 2 * FRAME_PAD;
  const SCR_H = GH + 2 * FRAME_PAD;
  const bulbR = 5.5;
  const bulbStep = 26;
  const bulbInset = FRAME_PAD / 2; // lampadine al centro della cornice
  const bulbs = [];
  // Top + bottom rows
  const colsCount = Math.max(2, Math.round((SCR_W - 2 * bulbInset) / bulbStep));
  const colDx = (SCR_W - 2 * bulbInset) / colsCount;
  for (let i = 0; i <= colsCount; i++) {
    const x = SCR_X + bulbInset + i * colDx;
    bulbs.push({ x, y: SCR_Y + bulbInset });
    bulbs.push({ x, y: SCR_Y + SCR_H - bulbInset });
  }
  // Left + right columns (skip corners, already added)
  const rowsCount = Math.max(2, Math.round((SCR_H - 2 * bulbInset) / bulbStep));
  const rowDy = (SCR_H - 2 * bulbInset) / rowsCount;
  for (let i = 1; i < rowsCount; i++) {
    const y = SCR_Y + bulbInset + i * rowDy;
    bulbs.push({ x: SCR_X + bulbInset,           y });
    bulbs.push({ x: SCR_X + SCR_W - bulbInset,   y });
  }
  const lightsSvg = bulbs.map((b, i) => {
    const dur = isWin ? 0.45 : 1.4;
    const dl = isWin ? ED + (i % 4) * 0.09 : (i * 0.06) % 1.4;
    // Bulbs alternati rosso/oro in pattern classico da casino marquee.
    const isRed = i % 2 === 0;
    const fillRef = isRed ? `bulbRed${uid}` : `bulbOn${uid}`;
    const haloC = isRed ? '#ff4040' : '#ffd84a';
    const ringC = isRed ? '#5a0606' : '#7a3a00';
    return `<g style="animation:${bln} ${dur}s ${dl.toFixed(2)}s infinite">` +
      `<circle cx="${b.x}" cy="${b.y}" r="${bulbR + 2.2}" fill="${haloC}" opacity="0.22"/>` +
      `<circle cx="${b.x}" cy="${b.y}" r="${bulbR}" fill="url(#${fillRef})" stroke="${ringC}" stroke-width="0.9"/>` +
      `<circle cx="${b.x - 1.6}" cy="${b.y - 1.8}" r="1.4" fill="#ffffff" opacity="0.9"/>` +
      `</g>`;
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
  // Pannello in basso, ultimo elemento del cabinet. Ospita: headline, fact
  // EN/IT (2 righe ciascuna), CTA repo match.
  const PY = GY + GH + FRAME_PAD + 6;
  const PH = (SVG_H - 6) - PY;
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
    if (linesEn.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.18}s forwards;opacity:0">EN</text>`;
      for (const line of linesEn) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="#e8e8f4" style="animation:fi${uid} .5s ${ED + 0.2}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 15;
      }
      yy += 4;
    }
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
<rect x="32" y="${HDR_TOP}" width="${SVG_W - 64}" height="${HDR_H - 6}" rx="14" fill="#13122d" opacity="0.92" stroke="#7a4400" stroke-width="1.2"/>
<text x="${SVG_W / 2}" y="${HDR_TOP + 22}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="19" font-weight="800" fill="url(#hdr${uid})" filter="url(#glow${uid})">DEV STACK SLOT MACHINE</text>
<text x="${SVG_W / 2}" y="${HDR_TOP + 36}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="8.5" fill="#8b8baf" letter-spacing="2.6">SPIN · LEARN · DISCOVER MY PROJECTS</text>
<g font-family="'Segoe UI',sans-serif">
  <text x="50" y="${HDR_TOP + 53}" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">COMMUNITY SPINS</text>
  <text x="50" y="${HDR_TOP + 68}" font-size="14" font-weight="800" fill="#ffd700">${total}</text>
  <text x="${SVG_W - 50}" y="${HDR_TOP + 53}" text-anchor="end" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">WINS</text>
  <text x="${SVG_W - 50}" y="${HDR_TOP + 68}" text-anchor="end" font-size="14" font-weight="800" fill="#4ade80">${wonTotal}</text>
</g>`;

  // ── Border ──
  const borderAttr = isJackpot
    ? `stroke="#ffd700" stroke-width="3" style="animation:jb${uid} .3s ${ED}s infinite"`
    : isWin
      ? `stroke="#16a34a" stroke-width="2.5"`
      : `stroke="#3a3666" stroke-width="2"`;

  // ── Cabinet (corpo rosso laccato) ──
  // Struttura minimale: niente crown/JACKPOT/7-7-7/ornamenti laterali — solo
  // il corpo principale a spalle arrotondate, su cui poggiano header,
  // paytable, screen frame e pannello risultato.
  const BODY_Y = 0;

  let cabinetSvg = '';

  // Corpo principale.
  cabinetSvg +=
    `<path d="
       M 24 ${BODY_Y + 24}
       Q 24 ${BODY_Y} 50 ${BODY_Y}
       L ${SVG_W - 50} ${BODY_Y}
       Q ${SVG_W - 24} ${BODY_Y} ${SVG_W - 24} ${BODY_Y + 24}
       L ${SVG_W - 24} ${SVG_H - 22}
       Q ${SVG_W - 24} ${SVG_H} ${SVG_W - 50} ${SVG_H}
       L 50 ${SVG_H}
       Q 24 ${SVG_H} 24 ${SVG_H - 22}
       Z"
       fill="url(#cab${uid})" stroke="#5a0606" stroke-width="2"/>`;
  cabinetSvg +=
    `<path d="
       M 36 ${BODY_Y + 28}
       Q 36 ${BODY_Y + 8} 60 ${BODY_Y + 8}
       L ${SVG_W - 60} ${BODY_Y + 8}
       Q ${SVG_W - 36} ${BODY_Y + 8} ${SVG_W - 36} ${BODY_Y + 28}
       L ${SVG_W - 36} ${BODY_Y + 56}
       L 36 ${BODY_Y + 56} Z"
       fill="url(#cabHi${uid})"/>`;

  // Cornice gialla attorno allo schermo (i rulli) — è il telaio della
  // marquee dove vivono le lampadine.
  const screenFrameSvg =
    `<rect x="${SCR_X - 4}" y="${SCR_Y - 4}" width="${SCR_W + 8}" height="${SCR_H + 8}" rx="14"
           fill="#7a4400"/>` +
    `<rect x="${SCR_X}" y="${SCR_Y}" width="${SCR_W}" height="${SCR_H}" rx="12"
           fill="url(#frame${uid})"/>` +
    // Inner black bezel (lo "schermo" effettivo dove scorrono i rulli)
    `<rect x="${MX - 8}" y="${GY - 8}" width="${GW + 16}" height="${GH + 16}" rx="6"
           fill="#0a0612"/>` +
    `<rect x="${MX - 6}" y="${GY - 6}" width="${GW + 12}" height="${GH + 12}" rx="5"
           fill="none" stroke="#3a1a05" stroke-width="1.4" opacity="0.9"/>`;

  // Coin tray rimosso: il pannello risultato \u00e8 ora l'ultimo elemento del cabinet.
  const coinTraySvg = '';

  // \u2500\u2500 Paytable (TOP) \u2500\u2500
  // Sezione in alto, sotto l'header e prima dei rulli. Comunica esplicitamente
  // che si tratta delle competenze del proprietario: più pallini = miglior
  // padronanza = simbolo che "paga di più" nella slot.
  const ptCount = LANGUAGES.length;
  const ptInner = SVG_W - 64;
  const ptCellW = ptInner / ptCount;
  const ptIconSize = 38;
  const PT_MAX = 5;
  let paytableSvg = '';
  paytableSvg += `<rect x="32" y="${PT_Y}" width="${SVG_W - 64}" height="${PT_H}" rx="14"
                         fill="#13122d" stroke="#7a4400" stroke-width="1.2" opacity="0.92"/>`;
  paytableSvg += `<text x="46" y="${PT_Y + 16}" font-family="'Segoe UI',sans-serif" font-size="10" font-weight="800" fill="#ffd700" letter-spacing="2">MY DEV STACK \u00b7 MORE DOTS = MORE EXPERIENCE</text>`;
  paytableSvg += `<text x="46" y="${PT_Y + 28}" font-family="'Segoe UI',sans-serif" font-size="8" font-style="italic" fill="#8b8baf" letter-spacing="0.5">Più pallini = livello di padronanza dell'owner = simbolo che paga di più nella slot</text>`;
  paytableSvg += `<text x="${SVG_W - 46}" y="${PT_Y + 16}" text-anchor="end" font-family="'Segoe UI',sans-serif" font-size="8" fill="#6d6d8e" letter-spacing="0.5">EXPERT</text>`;
  paytableSvg += `<text x="${SVG_W - 46 - 88}" y="${PT_Y + 16}" text-anchor="end" font-family="'Segoe UI',sans-serif" font-size="8" fill="#6d6d8e" letter-spacing="0.5">FAMILIAR</text>`;
  for (let i = 0; i < ptCount; i++) {
    const lang = LANGUAGES[i];
    const cx = 32 + ptCellW * i + ptCellW / 2;
    const iconX = cx - ptIconSize / 2;
    const iconY = PT_Y + 36;
    paytableSvg += symbolUse(uid, lang.id, iconX, iconY, ptIconSize, ptIconSize);
    paytableSvg += `<text x="${cx}" y="${iconY + ptIconSize + 11}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="9" font-weight="700" fill="#d4d4e8">${escapeXml(lang.name)}</text>`;
    const lvl = Math.max(0, Math.min(PT_MAX, lang.competence ?? 0));
    const dotR = 2.2;
    const dotGap = 5.4;
    const dotsTotalW = PT_MAX * dotGap - (dotGap - 2 * dotR);
    const dotsX0 = cx - dotsTotalW / 2 + dotR;
    const dotsY = iconY + ptIconSize + 22;
    for (let d = 0; d < PT_MAX; d++) {
      const filled = d < lvl;
      paytableSvg += `<circle cx="${(dotsX0 + d * dotGap).toFixed(2)}" cy="${dotsY}" r="${dotR}" `
        + `fill="${filled ? lang.accent : '#2a2754'}" `
        + `stroke="${filled ? lang.accent : '#3a3666'}" stroke-width="0.6"/>`;
    }
  }

  const footer = '';

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs>${defs}</defs>
<style>${css}</style>
${cabinetSvg}
${headerSvg}
${paytableSvg}
${screenFrameSvg}
${colBGs}
${reelsSvg}
${nmShineSvg}
${colBordersSvg}
${winGlowSvg}
${nearMissSvg}
${coinsSvg}
${overlaySvg}
${lightsSvg}
${panelSvg}
${coinTraySvg}
${footer}
</svg>`;
}
