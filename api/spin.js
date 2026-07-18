// ─── GithubSlotMachine — orchestratore dello spin ────────────────────────────
// Il file è stato spacchettato (punto D):
//   • api/_lib/game.js      → logica pura (generateGrid, checkWins, engineer*, …)
//   • api/_lib/svg-builder.js → buildSVG (generazione slot SVG)
//   • api/_lib/github.js    → API GitHub + marker README
// Qui resta solo l'handler Vercel: legge stato, calcola la griglia, genera
// l'SVG, aggiorna slot.svg/state/README e fa il redirect.
import { LANGUAGE_BY_ID, pickFact, LANGUAGES } from './_lib/languages.js';
import {
  SYMBOL_IDS,
  REEL,
  FORCED_WIN_PROB,
  COLS,
  ROWS,
  PAYLINES,
  PL_COLORS,
  generateGrid,
  engineerWin,
  engineerNearMiss,
  checkWins,
  countScatters,
  detectNearMiss,
  winningLangId,
  wrap,
} from './_lib/game.js';
import { buildSVG } from './_lib/svg-builder.js';
import { buildAccessibleSVG, errorSVG } from './_lib/svg-builder-accessible.js';
import {
  ghGet,
  ghPut,
  saveSlotSvg,
  loadSlotSvg,
  updateReadmeMarkers,
} from './_lib/github.js';
import { WILD_ID, SCATTER_ID } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';
import { isValidUser, rateLimit } from './_lib/ratelimit.js';
import { kvEnabled } from './_lib/kv.js';
import * as Sentry from '../sentry.config.js';
// ─── Security: Allowed Origins for Redirect Validation ────────────────────────
const ALLOWED_ORIGINS = [
  'github-slot-machine.vercel.app',
  'localhost',
  'github.com',
];

// ─── Security: CORS policy ──────────────────────────────────────────────────
// /api/spin è raggiungibile anche in cross-origin (es. embed su github.com o
// fork su altri domini). Specifichiamo una policy esplicita anziché il
// wildcard '*' (che sarebbe insicuro su redirect/state con credenziali).
// Gli origin ammessi sono configurabili via env ALLOWED_CORS_ORIGINS (CSV),
// con fallback ai domini noti dell'app. Se l'Origin non è fra quelli
// consentiti, NON viene emesso l'header Access-Control-Allow-Origin (così il
// browser blocca la lettura cross-origin ma la navigazione diretta funziona).
const CORS_ALLOWED = (
  process.env.ALLOWED_CORS_ORIGINS ||
  'https://github-slot-machine.vercel.app,http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req?.headers?.origin;
  if (origin && CORS_ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Header di sicurezza generici: riducono la superficie di attacco anche su
  // richieste same-origin (es. click della leva da github.com).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

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
  SYMBOL_IDS,
  REEL,
  FORCED_WIN_PROB,
  COLS,
  ROWS,
  PAYLINES,
  PL_COLORS,
  generateGrid,
  engineerWin,
  engineerNearMiss,
  checkWins,
  countScatters,
  detectNearMiss,
  winningLangId,
  wrap,
  buildSVG,
  buildAccessibleSVG,
  errorSVG,
  isValidRedirectUrl,
  WILD_ID,
  SCATTER_ID,
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
          events: [
            {
              event: 'spin',
              timestamp: Date.now(),
              ...metrics,
            },
          ],
        }),
      }).catch(() => {}); // Silently ignore analytics failures
    } catch (e) {
      console.warn('analytics track failed:', e.message);
    }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── CORS + preflight ─────────────────────────────────────────────────────
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // ── Rate-limit per-IP (token-bucket 1 spin / RL_WINDOW_SEC) ──────────────
  // Protegge l'endpoint che fa WRITE su GitHub/Redis a ogni chiamata da un
  // abuso che esaurirebbe il rate-limit globale GitHub (5000/h) o i write
  // Redis. Il limite è per-IP e viene calcolato PRIMA di qualsiasi lavoro
  // (token, letture, scritture) così lo spin bloccato non tocca GitHub/Redis.
  const rl = await rateLimit(req);
  if (!rl.ok) {
    res
      .status(429)
      .setHeader('Retry-After', String(rl.retryAfter))
      .setHeader('Content-Type', 'text/plain; charset=utf-8')
      .send(`Troppe richieste. Riprova tra ${rl.retryAfter} secondi.`);
    return;
  }

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

    const { state, sha: stateSha } = stateBundle;
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
        repoMatch = await getRepoForLanguage(
          token,
          OWNER,
          winningLang,
          LANGUAGES
        );
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
      grid,
      uid: spinStart,
      state,
      winningLang,
      fact,
      repoMatch,
      owner: OWNER,
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
      const ghLang = encodeURIComponent(
        winningLang.githubLang || winningLang.name
      );
      dest = `https://github.com/${targetOwner}?tab=repositories&language=${ghLang}`;
    } else {
      dest = repoMatch?.url || `https://github.com/${OWNER}`;
    }

    const githubLatency = Date.now() - spinStart;

    // ── Scritture ────────────────────────────────────────────────────────────
    // Eseguite IN PARALLELO nel flusso principale (rete VIVA), PRIMA del
    // redirect, così GitHub risponde davvero (waitUntil post-redirect su Vercel
    // non ha rete in uscita verso api.github.com → timeout 5000ms, bug "stessa
    // svg più volte"). La latenza totale è il max dei task, non la somma:
    //   - slot.svg (KV): ~10-20ms
    //   - state (KV):    ~10-20ms
    //   - README GET+PUT GitHub: ~270ms (vedi /api/health github_readme_get_ms)
    // Quindi lo spin aggiunge ~270-350ms, NON i "secondi" della regressione
    // causata dalla coda serializzante di RateLimitQueue (rimossa).
    const README_TIMEOUT_MS = 3500;

    const readmePromise = (async () => {
      console.log(`[readme-update] START spin=${spinStart}`);
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 500;
      let lastError = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          console.log(
            `[readme-update] ghGet owner=${PROFILE_REPO} repo=${PROFILE_REPO} attempt=${attempt + 1}`
          );
          const rf = await ghGet(token, PROFILE_REPO, PROFILE_REPO, 'README.md');
          if (!rf) {
            console.log('[readme-update] ghGet returned null (README assente/illegibile)');
            return;
          }
          console.log('[readme-update] ghGet OK, sha present:', Boolean(rf.sha));

          const oldReadme = Buffer.from(rf.content, 'base64').toString('utf-8');
          let newReadme = oldReadme.replace(
            /api\/image\?(?:v|cache_buster)=[0-9]*/g,
            `api/image?v=${spinStart}`
          );
          newReadme = updateReadmeMarkers(
            newReadme,
            state,
            winningLang,
            repoMatch,
            fact
          );
          if (newReadme !== oldReadme) {
            await ghPut(
              token,
              PROFILE_REPO,
              PROFILE_REPO,
              'README.md',
              newReadme,
              rf.sha,
              '🎰 Update slot'
            );
            console.log(`[readme-update] ghPut OK, new ?v=${spinStart}`);
          } else {
            console.log('[readme-update] README unchanged, skip PUT');
          }
          return; // Successo
        } catch (e) {
          lastError = e;
          console.warn(`README update attempt ${attempt + 1} failed:`, e.message);
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }
      console.error('README update failed after', MAX_RETRIES, 'attempts:', lastError?.message);
    })();

    // slot.svg + state + README girano in parallelo. Se la README supera il
    // timeout di sicurezza, non blocchiamo il redirect: lo slot funziona lo
    // stesso (solo la combinazione nel profilo si aggiorna al giro dopo).
    const readmeWithTimeout = Promise.race([
      readmePromise,
      new Promise((res) =>
        setTimeout(() => {
          console.warn('[readme-update] timeout di sicurezza, skip per non bloccare redirect');
          res();
        }, README_TIMEOUT_MS)
      ),
    ]);

    const [slotResult] = await Promise.allSettled([
      saveSlotSvg(token, OWNER, SLOT_REPO, svg, slotFile?.sha),
      writeState(token, OWNER, SLOT_REPO, state, stateSha),
      readmeWithTimeout,
    ]);

    if (slotResult.status === 'rejected') {
      console.warn('slot.svg write failed (redirect anyway):', slotResult.reason?.message);
      // Redirect anche se slot.svg fallisce (l'utente vede il risultato
      // precedente una volta, ma lo slot non esplode con un 500).
      const rawRedirect = req.query?.redirect
        ? String(req.query.redirect).trim()
        : '';
      let redirectUrl = dest;
      if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
        redirectUrl = rawRedirect;
        console.log('Security: Allowed validated redirect to:', redirectUrl);
      } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
        console.warn(`[Security] Blocked open redirect attempt to: ${rawRedirect}`);
      }
      res.redirect(302, redirectUrl);
      await trackSpin({
        win: isWin ? 'win' : 'loss',
        win_type: isJackpot ? 'jackpot' : isWin ? 'near-miss' : 'loss',
        lang_id: winningLang?.id || null,
        redis_hit: kvEnabled,
        github_latency_ms: githubLatency,
        error: null,
      });
      return;
    }

    // Redirect con validazione Open Redirect
    const rawRedirect = req.query?.redirect
      ? String(req.query.redirect).trim()
      : '';
    let redirectUrl = dest; // default al redirect calcolato

    if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
      redirectUrl = rawRedirect;
      console.log('Security: Allowed validated redirect to:', redirectUrl);
    } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
      console.warn(
        `[Security] Blocked open redirect attempt to: ${rawRedirect}`
      );
    }

    res.redirect(302, redirectUrl);
    console.log('Security: Redirecting to:', redirectUrl);

    // Track analytics (non bloccante)
    await trackSpin({
      win: isWin ? 'win' : 'loss',
      win_type: isJackpot ? 'jackpot' : isWin ? 'near-miss' : 'loss',
      lang_id: winningLang?.id || null,
      redis_hit: kvEnabled,
      github_latency_ms: githubLatency,
      error: null,
    });
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
    const fallback = errorSVG({
      owner: OWNER,
      message: 'Ops, riprova un attimo!',
    });
    try {
      await saveSlotSvg(token, OWNER, SLOT_REPO, fallback).catch(() => {});
    } catch {
      /* ignora: non blocchiamo il redirect per il fallback */
    }

    // Redirect in caso di errore con validazione Open Redirect
    const rawRedirect = req.query?.redirect
      ? String(req.query.redirect).trim()
      : '';
    let redirectUrl = `https://github.com/${OWNER}`; // default

    if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
      redirectUrl = rawRedirect;
      console.log('Security: Allowed validated redirect to:', redirectUrl);
    } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
      console.warn(
        `[Security] Blocked open redirect attempt to: ${rawRedirect}`
      );
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
