// ─── GithubSlotMachine — orchestratore dello spin ────────────────────────────
// Il file è stato spacchettato (punto D):
//   • api/_lib/game.js      → logica pura (generateGrid, checkWins, engineer*, …)
//   • api/_lib/svg-builder.js → buildSVG (generazione slot SVG)
//   • api/_lib/github.js    → API GitHub + marker README
// Qui resta solo l'handler Vercel: legge stato, calcola la griglia, genera
// l'SVG, aggiorna slot.svg/state/README e fa il redirect.
import {
  LANGUAGE_BY_ID,
  pickFact,
  LANGUAGES,
} from './_lib/languages.js';
import {
  SYMBOL_IDS, REEL, FORCED_WIN_PROB, COLS, ROWS, PAYLINES, PL_COLORS,
  generateGrid, engineerWin, engineerNearMiss,
  checkWins, countScatters, detectNearMiss, winningLangId, wrap,
} from './_lib/game.js';
import { buildSVG } from './_lib/svg-builder.js';
import {
  ghGet, ghPut, saveSlotSvg, loadSlotSvg, updateReadmeMarkers,
} from './_lib/github.js';
import { WILD_ID, SCATTER_ID } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';
import { rateLimit, isValidUser, clientIp } from './_lib/ratelimit.js';

// ─── Owner / repo config ─────────────────────────────────────────────────────
// Fork-ready: every value falls back to the original owner's repos, but you can
// override them with environment variables on Vercel (or in vercel.json) so the
// slot points at YOUR profile and repo without editing the code. Optionally a
// `?user=OTHERNAME` query string overrides OWNER for the redirect target.
const OWNER = process.env.SLOT_OWNER || 'simrim96';
const SLOT_REPO = process.env.SLOT_REPO || 'GithubSlotMachine';
const PROFILE_REPO = process.env.PROFILE_REPO || OWNER;

// ─── Re-export della logica pura per i test (tests/ importa da qui) ──────────
export {
  SYMBOL_IDS, REEL, FORCED_WIN_PROB, COLS, ROWS, PAYLINES, PL_COLORS,
  generateGrid, engineerWin, engineerNearMiss,
  checkWins, countScatters, detectNearMiss, winningLangId, wrap,
  WILD_ID, SCATTER_ID,
};

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    res.status(500).send('GITHUB_PAT non configurato.');
    return;
  }

  // Rate-limit per IP (token-bucket 1 spin / 3s). Risposta 429 + Retry-After.
  const ip = clientIp(req);
  const { allowed, retryAfter } = rateLimit(ip);
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).send('Too many spins, slow down!');
    return;
  }

  const grid = generateGrid();
  const ts = Date.now();

  try {
    // Letture CRITICHE (percorso click→reload): solo slot.svg (KV) + stato (KV).
    // La GET del README su GitHub (~150-400ms) è stata SPOSTATA fuori dal
    // percorso critico: serve solo ad aggiornare i marker nel profilo, NON
    // per calcolare né l'SVG né il redirect. Viene fatta in background dopo
    // il redirect, così non allunga più il tempo percepito.
    const [slotFile, stateBundle] = await Promise.all([
      loadSlotSvg(token, OWNER, SLOT_REPO),
      readState(token, OWNER, SLOT_REPO).catch(() => ({
        state: { totalSpins: 0, totalWins: 0, lastWin: null },
        sha: null,
      })),
    ]);

    let { state, sha: stateSha } = stateBundle;
    let readmeFile = null; // caricato in background per l'update README
    state.totalSpins = (state.totalSpins || 0) + 1;

    const wins = checkWins(grid);
    const isWin = wins.length > 0;
    const winningLang = isWin ? LANGUAGE_BY_ID[winningLangId(wins)] : null;

    let repoMatch = null;
    let fact = { it: '', en: '' };
    if (winningLang) {
      state.totalWins = (state.totalWins || 0) + 1;
      fact = pickFact(winningLang);
      // Repo lookup: se la cache è fredda, getRepoForLanguage la popola in
      // background e ritorna subito (spesso null → redirect al profilo).
      // Il redirect NON aspetta mai lo stall di 1-3s delle GitHub API.
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

    const svg = buildSVG({
      grid, uid: ts, state, winningLang, fact, repoMatch, owner: OWNER,
    });

    // Calcola la destinazione del redirect PRIMA di scrivere qualsiasi cosa.
    // ?user= è validato con isValidUser(): solo login GitHub [A-Za-z0-9-]{1,39}.
    // Qualsiasi valore non valido (path, slash, caratteri strani) cade sul
    // proprietario di default → chiude l'open-redirect verso altri host/percorsi.
    const rawUser = req.query?.user ? String(req.query.user).trim() : '';
    const targetOwner = rawUser && isValidUser(rawUser) ? rawUser : OWNER;
    const isJackpot = wins.some((w) => w.count === 5);
    let dest;
    if (winningLang && isJackpot) {
      const ghLang = encodeURIComponent(winningLang.githubLang || winningLang.name);
      dest = `https://github.com/${targetOwner}?tab=repositories&language=${ghLang}`;
    } else {
      dest = repoMatch?.url || `https://github.com/${OWNER}`;
    }

    // ── Scritture ────────────────────────────────────────────────────────────
    // 1) slot.svg DEVE essere aggiornato PRIMA del reload, altrimenti la slot
    //    mostrerebbe il risultato precedente. Su KV è ~10-20ms.
    // 2) Contatori su KV (~10-20ms).
    // 3) README (GET + PUT GitHub, ~300-600ms) è NON critico per il reload →
    //    tutto in background, fuori dal percorso click→reload.
    await saveSlotSvg(token, OWNER, SLOT_REPO, svg, slotFile?.sha);
    await writeState(token, OWNER, SLOT_REPO, state, stateSha).catch((e) =>
      console.warn('state write:', e.message)
    );

    // Redirect IMMEDIATO: l'utente vede il reload appena slot.svg+state sono
    // scritti (~10-40ms), senza aspettare GitHub (README) né scan repo.
    res.redirect(302, dest);

    // ── Aggiornamento README in background (non blocca il redirect) ──────────
    // Carica il README solo ora, in parallelo all'update, senza aspettare il
    // redirect. Se il fetch fallisce, skip silenzioso: il profilo non è critico.
    (async () => {
      try {
        const rf = await ghGet(token, PROFILE_REPO, 'README.md');
        if (!rf) return;
        const oldReadme = Buffer.from(rf.content, 'base64').toString('utf-8');
        let newReadme = oldReadme.replace(
          /api\/image\?(?:v|cache_buster)=[0-9]*/g,
          `api/image?v=${ts}`
        );
        newReadme = updateReadmeMarkers(newReadme, state, winningLang, repoMatch, fact);
        if (newReadme !== oldReadme) {
          await ghPut(token, PROFILE_REPO, 'README.md', newReadme, rf.sha, '🎰 Update slot');
        }
      } catch (e) {
        console.warn('readme background update skipped:', e.message);
      }
    })();
  } catch (err) {
    res.status(500).send('Errore: ' + err.message);
  }
}
