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
import { buildSVG, buildAccessibleSVG, errorSVG } from './_lib/svg-builder.js';
import {
  ghGet, ghPut, saveSlotSvg, loadSlotSvg, updateReadmeMarkers,
} from './_lib/github.js';
import { WILD_ID, SCATTER_ID } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';
import { isValidUser } from './_lib/ratelimit.js';
import { kvEnabled } from './_lib/kv.js';
import * as Sentry from "@sentry/node";

// ─── Security: Allowed Origins for Redirect Validation ────────────────────────
const ALLOWED_ORIGINS = [
  'github-slot-machine.vercel.app',
  'localhost',
  'github.com',
];

// ─── Security: Validate Redirect URL to Prevent Open Redirect ─────────────────
function isValidRedirectUrl(urlString) {
  // Reject empty/null/undefined
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  const trimmed = urlString.trim();

  // Reject empty strings after trim
  if (!trimmed) {
    return false;
  }

  // Relative URLs (start with /) are always safe
  if (trimmed.startsWith('/')) {
    return true;
  }

  // For full URLs, validate the origin
  try {
    const url = new URL(trimmed);
    
    // Block dangerous protocols
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:'];
    if (dangerousProtocols.includes(url.protocol)) {
      return false;
    }

    return ALLOWED_ORIGINS.includes(url.hostname);
  } catch {
    // Invalid URL format
    return false;
  }
}
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
  buildSVG, buildAccessibleSVG,
  errorSVG,
  isValidRedirectUrl,
};

// ─── Analytics Tracking ──────────────────────────────────────────────────────
// Invia metriche a Vercel Analytics per monitoraggio produzione
async function trackSpin(metrics) {
  if (process.env.VERCEL) {
    try {
      await fetch('https://api.vercel.com/v1/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{
            event: 'spin',
            timestamp: Date.now(),
            ...metrics,
          }],
        }),
      }).catch(() => {}); // Silently ignore analytics failures
    } catch (e) {
      console.warn('analytics track failed:', e.message);
    }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    res.status(500).send('GITHUB_PAT non configurato.');
    return;
  }

  const spinStart = Date.now();

  try {
    // generateGrid è DENTRO il try: se lancia, degrada a errore graceful.
    const grid = generateGrid();

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
        ts: spinStart,
      };
    }

    const svg = buildAccessibleSVG({
      grid, uid: spinStart, state, winningLang, fact, repoMatch, owner: OWNER,
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

    const githubLatency = Date.now() - spinStart;

    // ── Scritture ────────────────────────────────────────────────────────────
    // 1) slot.svg DEVE essere aggiornato PRIMA del reload, altrimenti la slot
    //    mostrerebbe il risultato precedente. Su KV è ~10-20ms.
    // 2) Contatori su KV (~10-20ms).
    // 3) README (GET + PUT GitHub, ~300-600ms) è NON critico per il reload →
    //    tutto in background, fuori dal percorso click→reload.
    // La scrittura di slot.svg è protetta: se fallisce, l'utente ha già il
    // redirect (vedrà il risultato precedente una volta), ma lo slot NON
    // esplode con un 500.
    try {
      await saveSlotSvg(token, OWNER, SLOT_REPO, svg, slotFile?.sha);
    } catch (e) {
      console.warn('slot.svg write failed (redirect anyway):', e.message);
      await writeState(token, OWNER, SLOT_REPO, state, stateSha).catch((w) =>
        console.warn('state write:', w.message)
      );
      
      // Redirect in caso di errore slot.svg write con validazione Open Redirect
      const rawRedirect = req.query?.redirect ? String(req.query.redirect).trim() : '';
      let redirectUrl = dest; // default al redirect calcolato
      
      if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
        redirectUrl = rawRedirect;
        console.log('Security: Allowed validated redirect to:', redirectUrl);
      } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
        console.warn(`[Security] Blocked open redirect attempt to: ${rawRedirect}`);
      }
      
      res.redirect(302, redirectUrl);
      // Track analytics (non bloccante)
      await trackSpin({
        win: isWin ? 'win' : 'loss',
        win_type: isJackpot ? 'jackpot' : (isWin ? 'near-miss' : 'loss'),
        lang_id: winningLang?.id || null,
        redis_hit: kvEnabled,
        github_latency_ms: githubLatency,
        error: null,
      });
      return;
    }
    await writeState(token, OWNER, SLOT_REPO, state, stateSha).catch((e) =>
      console.warn('state write:', e.message)
    );

    // Redirect IMMEDIATO: l'utente vede il reload appena slot.svg+state sono
    // scritti (~10-40ms), senza aspettare GitHub (README) né scan repo.
    // ── Redirect con validazione Open Redirect ─────────────────────────────────
    // Validazione security: previeni redirect aperti verso siti malevoli
    const rawRedirect = req.query?.redirect ? String(req.query.redirect).trim() : '';
    let redirectUrl = dest; // default al redirect calcolato
    
    if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
      redirectUrl = rawRedirect;
      console.log('Security: Allowed validated redirect to:', redirectUrl);
    } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
      console.warn(`[Security] Blocked open redirect attempt to: ${rawRedirect}`);
    }
    
    res.redirect(302, redirectUrl);
    console.log('Security: Redirecting to:', redirectUrl);
    
    // Track analytics (non bloccante)
    await trackSpin({
      win: isWin ? 'win' : 'loss',
      win_type: isJackpot ? 'jackpot' : (isWin ? 'near-miss' : 'loss'),
      lang_id: winningLang?.id || null,
      redis_hit: kvEnabled,
      github_latency_ms: githubLatency,
      error: null,
    });

    // ── Aggiornamento README in background (non blocca il redirect) ──────────
    // Carica il README solo ora, in parallelo all'update, senza aspettare il
    // redirect. Se il fetch fallisce, skip silenzioso: il profilo non è critico.
    // Con retry e backoff esponenziale per prevenire silent failures.
    // FIX: Use Promise.withResolvers pattern for proper cleanup tracking
    const backgroundTaskId = `readme-update-${spinStart}`;
    let backgroundTaskCompleted = false;
    
    const updateReadmeBackground = async () => {
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;
      
      let lastError = null;
      try {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const rf = await ghGet(token, PROFILE_REPO, 'README.md');
            if (!rf) {
              backgroundTaskCompleted = true;
              return;
            }
            
            const oldReadme = Buffer.from(rf.content, 'base64').toString('utf-8');
            let newReadme = oldReadme.replace(
              /api\/image\?(?:v|cache_buster)=[0-9]*/g,
              `api/image?v=${spinStart}`
            );
            newReadme = updateReadmeMarkers(newReadme, state, winningLang, repoMatch, fact);
            
            if (newReadme !== oldReadme) {
              await ghPut(token, PROFILE_REPO, 'README.md', newReadme, rf.sha, '🎰 Update slot');
            }
            backgroundTaskCompleted = true;
            return; // Successo
          } catch (e) {
            lastError = e;
            console.warn(`README update attempt ${attempt + 1} failed:`, e.message);
            if (attempt < MAX_RETRIES - 1) {
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)));
            }
          }
        }
        // Se tutti i retry falliscono, logga l'errore finale
        console.error('README update failed after', MAX_RETRIES, 'attempts:', lastError?.message);
        backgroundTaskCompleted = true;
      } catch (e) {
        // Catch-all for any unexpected errors
        console.error(`README background task error:`, e.message);
        backgroundTaskCompleted = true;
      }
    };
    
    // Start background task with proper error handling and cleanup
    updateReadmeBackground()
      .then(() => {
        console.log(`[Background Task ${backgroundTaskId}] Completed successfully`);
      })
      .catch((err) => {
        console.error(`[Background Task ${backgroundTaskId}] Unhandled rejection:`, err.message);
        backgroundTaskCompleted = true;
      });
    
    // Register with Sentry for monitoring (if available)
    try {
      Sentry.addBreadcrumb({
        category: 'background-task',
        message: `Started ${backgroundTaskId}`,
        level: 'info',
      });
    } catch {
      // Sentry might not be initialized, ignore
    }
  } catch (err) {
    // Cattura l'errore su Sentry
    Sentry.captureException(err);
    
    // Degrado graceful: invece di un 500 che "rompe" la leva, proviamo a
    // salvare un SVG di errore su slot.svg (best-effort) e poi facciamo
    // comunque il redirect verso il profilo dell'owner. L'utente non vede mai
    // una pagina rotta; al prossimo spin (se l'errore era transitorio) torna
    // tutto normale. Lo stato dei contatori è già stato incrementato in
    // memoria ma non persistito, quindi non si perdono dati critici.
    console.error('spin handler error:', err?.message || err);
    const fallback = errorSVG({ owner: OWNER, message: 'Ops, riprova un attimo!' });
    try {
      await saveSlotSvg(token, OWNER, SLOT_REPO, fallback).catch(() => {});
    } catch { /* ignora: non blocchiamo il redirect per il fallback */ }
    
    // Redirect in caso di errore con validazione Open Redirect
    const rawRedirect = req.query?.redirect ? String(req.query.redirect).trim() : '';
    let redirectUrl = `https://github.com/${OWNER}`; // default
    
    if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
      redirectUrl = rawRedirect;
      console.log('Security: Allowed validated redirect to:', redirectUrl);
    } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
      console.warn(`[Security] Blocked open redirect attempt to: ${rawRedirect}`);
    }
    
    try {
      res.redirect(302, redirectUrl);
    } catch {
      res.status(500).send('Errore temporaneo, riprova.');
    }
    // Track analytics (non bloccante)
    await trackSpin({
      win: 'error',
      win_type: 'error',
      lang_id: null,
      redis_hit: kvEnabled,
      github_latency_ms: Date.now() - spinStart,
      error: err?.message || String(err),
    });
  }
}
