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
import { buildSVG, errorSVG, errorSVGString } from './_lib/svg-builder.js';
import { buildAccessibleSVG } from './_lib/svg-builder-accessible.js';
import {
  ghGet,
  ghPut,
  saveSlotSvg,
  loadSlotSvg,
  updateReadmeMarkers,
} from './_lib/github.js';
import { applyCors } from './_lib/cors.js';
import { WILD_ID, SCATTER_ID } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';
import { isValidUser } from './_lib/ratelimit.js';
import * as Sentry from '../sentry.config.js';
// ─── Security: Allowed Origins for Redirect Validation ────────────────────────
const ALLOWED_ORIGINS = [
  'github-slot-machine.vercel.app',
  'localhost',
  'github.com',
];

// ─── Security: CORS policy ──────────────────────────────────────────────────
// La policy CORS è ora centralizzata in api/_lib/cors.js (Miglioramento #4,
// ISSUES.md): applyCors(req, res) è importata da lì. /api/spin resta
// raggiungibile in cross-origin (es. embed su github.com) con una policy
// esplicita (no wildcard '*'). Gli origin ammessi sono configurabili via env
// ALLOWED_CORS_ORIGINS (CSV), con fallback ai domini noti dell'app.

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

// ─── Security: Resolve validated redirect URL ───────────────────────────────
// Centralizza la logica di redirect convalidato (evita l'open-redirect verso
// altri host/percorsi). Se ?(redirect)=<url> è presente ed è un URL valido
// (dominio consentito, protocollo sicuro), lo usa; altrimenti cade sul
// `defaultUrl` (sempre stesso-origin o il profilo dell'owner).
function resolveRedirectUrl(rawRedirect, defaultUrl) {
  const r = rawRedirect && typeof rawRedirect === 'string' ? rawRedirect.trim() : '';
  if (r && isValidRedirectUrl(r)) {
    console.log('Security: Allowed validated redirect to:', r);
    return r;
  }
  if (r && !isValidRedirectUrl(r)) {
    console.warn(`[Security] Blocked open redirect attempt to: ${r}`);
  }
  return defaultUrl;
}
// Configurazione: i valori di default puntano al profilo dell'autore
// (simrim96). Overridabili via env var su Vercel.
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
  errorSVGString,
  isValidRedirectUrl,
  resolveRedirectUrl,
  WILD_ID,
  SCATTER_ID,
};

// ─── Analytics ───────────────────────────────────────────────────────────────
// ISSUE-3 fix: rimosso il tracking server-side verso l'endpoint non documentato
// `https://api.vercel.com/v1/analytics` (risposte 404/401 silenziose, nessun
// dato reale raccolto, traffico di rete inutile a ogni spin).
// Ora l'analytics è gestita lato client tramite Vercel Web Analytics, iniettata
// in `public/index.html` (il frontend della leva servito da Vercel). Lo script
// traccia automaticamente le page view e, al click della leva, un evento
// `spin` custom via `window.va('track', 'spin', {...})`. Nessuna chiamata
// server-side residua.

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── CORS + preflight ─────────────────────────────────────────────────────
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Nessun rate-limit per-IP (ISSUE-1): l'utente può effettuare tutti gli
  // spin che vuole, anche di fila. La protezione contro l'abuso del
  // rate-limit globale GitHub (5000/h) resta demandata al graceful-fallback
  // in state.js / github.js (timeout via AbortController), non a un blocco 429
  // sugli spin.
  const token = process.env.GITHUB_PAT;

  const spinStart = Date.now();

  try {
    // Se manca il token di GitHub, NON rispondere con un 500 nudo (che
    // "rompe" la leva): facciamo comunque un redirect verso il profilo
    // dell'owner così l'utente non vede mai una pagina rotta. Lo spin non
    // persistito non è critico (il contatore si aggiorna al giro dopo).
    if (!token) {
      console.error('spin handler: GITHUB_PAT non configurato — redirect graceful');
      const redirectUrl = resolveRedirectUrl(
        req.query?.redirect ? String(req.query.redirect).trim() : '',
        `https://github.com/${OWNER}`
      );
      res.redirect(302, redirectUrl);
      return;
    }

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
    const isJackpot = wins.some((w) => w.count === 5);
    const nearMissCol = detectNearMiss(grid, wins);
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
      isWin,
      isJackpot,
      nearMissCol,
    });

    // Calcola la destinazione del redirect PRIMA di scrivere qualsiasi cosa.
    // ?user= è validato con isValidUser(): solo login GitHub [A-Za-z0-9-]{1,39}.
    // Qualsiasi valore non valido (path, slash, caratteri strani) cade sul
    // proprietario di default → chiude l'open-redirect verso altri host/percorsi.
    const rawUser = req.query?.user ? String(req.query.user).trim() : '';
    const targetOwner = rawUser && isValidUser(rawUser) ? rawUser : OWNER;
    let dest;
    if (winningLang && isJackpot) {
      const ghLang = encodeURIComponent(
        winningLang.githubLang || winningLang.name
      );
      dest = `https://github.com/${targetOwner}?tab=repositories&language=${ghLang}`;
    } else {
      dest = repoMatch?.url || `https://github.com/${OWNER}`;
    }

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
      return;
    }

    // Redirect con validazione Open Redirect (helper centralizzato)
    const rawRedirect = req.query?.redirect
      ? String(req.query.redirect).trim()
      : '';
    const redirectUrl = resolveRedirectUrl(rawRedirect, dest);

    res.redirect(302, redirectUrl);
    console.log('Security: Redirecting to:', redirectUrl);
  } catch (err) {
    // Cattura l'errore su Sentry
    Sentry.captureException(err);

    // Degrado graceful: invece di un 500 che "rompe" la leva, proviamo a
    // salvare un SVG di errore su slot.svg (best-effort, stringa GREZZA così
    // l'immagine si vede davvero) e poi facciamo comunque il redirect verso
    // il profilo dell'owner. L'utente non vede mai una pagina rotta; al
    // prossimo spin (se l'errore era transitorio) torna tutto normale. Lo
    // stato dei contatori è già stato incrementato in memoria ma non
    // persistito, quindi non si perdono dati critici.
    console.error('spin handler error:', err?.message || err);
    const fallbackSvg = errorSVGString({
      owner: OWNER,
      message: 'Ops, riprova un attimo!',
    });
    try {
      // Salva l'SVG di errore come slot.svg (best-effort). Se il token è
      // assente (dalla guardia qui sopra non ci arriveremmo, ma per
      // robustezza evitiamo di chiamare saveSlotSvg senza token).
      if (token) {
        await saveSlotSvg(token, OWNER, SLOT_REPO, fallbackSvg).catch(() => {});
      }
    } catch {
      /* ignora: non blocchiamo il redirect per il fallback */
    }

    // Redirect in caso di errore con validazione Open Redirect (helper
    // centralizzato). In extremis, se anche res.redirect fallisse (es.
    // headers già inviati), rispondiamo con l'SVG di errore grezzo anziché
    // un 500 nudo — così il client vede almeno la slot di errore.
    const rawRedirect = req.query?.redirect
      ? String(req.query.redirect).trim()
      : '';
    const redirectUrl = resolveRedirectUrl(
      rawRedirect,
      `https://github.com/${OWNER}`
    );

    try {
      res.redirect(302, redirectUrl);
    } catch {
      // Ultimo baluardo: niente 500 nudo, ma un SVG di errore valido.
      res
        .status(200)
        .setHeader('Content-Type', 'image/svg+xml')
        .send(fallbackSvg);
    }
  }
}
