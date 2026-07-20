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
  ghGetJson,
  ghPut,
  saveSlotSvg,
  loadSlotSvg,
  updateReadmeMarkers,
  auditToken,
} from './_lib/github.js';
import { kvGet, kvSet, kvEnabled } from './_lib/kv.js';
import { applyCors } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { WILD_ID, SCATTER_ID } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';
import { isValidUser } from './_lib/ratelimit.js';
import { checkSpinCooldown } from './_lib/spin-cooldown.js';
import * as Sentry from '../sentry.config.js';
// ─── Security: Allowlist host per la validazione del redirect (fix S1, ISSUES.md) ─
// Sostituisce la vecchia logica basata su blocklist (BLOCKED_HOSTS) con un'
// ALLOWLIST derivata da env (SLOT_ALLOWED_HOSTS, CSV). Default: solo i domini
// di deploy reali della slot + github.com (destinazione legittima del profilo
// owner) + localhost/127.0.0.1 per il dev locale. Un host NON presente qui viene
// SEMPRE rifiutato → nessun open-redirect verso domini arbitrari (es. un fork
// con dominio personalizzato tipo myslot.example.com).
const DEFAULT_ALLOWED_HOSTS = [
  'github-slot-machine.vercel.app',
  'github.com',
  'localhost',
  '127.0.0.1',
];

function getAllowedHosts() {
  const fromEnv = (process.env.SLOT_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_HOSTS;
}

// ─── Security: CORS policy ──────────────────────────────────────────────────
// La policy CORS è ora centralizzata in api/_lib/cors.js (Miglioramento #4,
// ISSUES.md): applyCors(req, res) è importata da lì. /api/spin resta
// raggiungibile in cross-origin (es. embed su github.com) con una policy
// esplicita (no wildcard '*'). Gli origin ammessi sono configurabili via env
// ALLOWED_CORS_ORIGINS (CSV), con fallback ai domini noti dell'app.

// ─── Security: Validate Redirect URL to Prevent Open Redirect ─────────────────
// Regole (fix S1, ISSUES.md):
//   1. URL relativo (inizia con '/') → sempre sicuro (same-origin).
//   2. URL completo → DEVE usare https (http ammesso SOLO per localhost/127.0.0.1
//      in dev), l'hostname DEVE appartenere all'allowlist, e il pathname NON
//      deve essere protocol-relative ('//') né nascondere uno scheme.
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

  // Relative URLs (start with a single '/') are always safe (same-origin).
  // Reject protocol-relative URLs ('//evil.com') — they would resolve to the
  // current page's scheme and become an open redirect.
  if (trimmed.startsWith('/')) {
    return !trimmed.startsWith('//');
  }

  const allowedHosts = getAllowedHosts();

  // For full URLs, validate the origin
  try {
    const url = new URL(trimmed);

    // Block dangerous protocols
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:'];
    if (dangerousProtocols.includes(url.protocol)) {
      return false;
    }

    // Enforce secure transport: https obbligatorio, salvo host locali in dev.
    const isLocal =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const transportOk =
      url.protocol === 'https:' ||
      (isLocal && url.protocol === 'http:');
    if (!transportOk) {
      return false;
    }

    // Reject protocol-relative / host-smuggling paths (es. //evil.com).
    if (url.pathname.startsWith('//')) {
      return false;
    }

    // Hostname must be on the allowlist
    return allowedHosts.includes(url.hostname.toLowerCase());
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
    sendResponse(res, { status: 204 });
    return;
  }

  // ── Rate-limit per-IP basato sul tempo di rotazione (fix S2, ISSUES.md) ───
  // Un secondo spin dello stesso IP entro la finestra di rotazione viene
  // rifiutato con un redirect GRACEFUL verso il profilo owner (302, ZERO
  // chiamate a GitHub) invece di una pagina di errore: l'utente reale lo vede
  // come il normale ritorno al profilo, e l'attaccante non consuma budget.
  const cooldown = await checkSpinCooldown(req);
  if (!cooldown.allowed) {
    sendResponse(res, {
      status: 302,
      headers: {
        'Retry-After': String(cooldown.retryAfterSec),
        'X-Spin-Cooldown': '1',
      },
      redirect: `https://github.com/${OWNER}`,
    });
    return;
  }

  // S4 hardening: rileva/rifiuta PAT classici (ISSUES.md §2).
  // Default: solo warning. Imposta GITHUB_PAT_REQUIRE_FINEGRAINED=true per
  // fallire in modo "closed" (salta i write GitHub, modalità read-only) quando
  // è configurato un token NON fine-grained.
  const enforceFg = process.env.GITHUB_PAT_REQUIRE_FINEGRAINED === 'true';
  let token = process.env.GITHUB_PAT;
  if (token) {
    try {
      auditToken(token, { enforce: enforceFg });
    } catch (e) {
      // Fail-closed: operiamo in read-only (niente token) così non usiamo mai
      // la credenziale insicura per gli write. Lo spin funziona lo stesso
      // (redirect graceful verso il profilo).
      console.error('[S4]', e.message);
      token = null;
    }
  }

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
      sendResponse(res, { status: 302, redirect: redirectUrl });
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

    // ── P1 (ISSUES.md): cache README in KV ─────────────────────────────────
    // Prima dello spin la README veniva letta da GitHub (GET /readme) a OGNI
    // spin, aggiungendo ~150-400ms. Ora la leggiamo da KV (chiave
    // `gsm:readme:<owner>`, TTL 60s): su cache HIT saltiamo del tutto la GET
    // GitHub; su cache MISS facciamo la GET e popoliamo la cache. Dopo una
    // PUT riuscita refreschiamo la cache col contenuto appena scritto, così
    // gli spin successivi (entro il TTL) non rifanno la GET. Il TTL breve
    // garantisce che modifiche esterne alla README (es. edit manuale sul
    // profilo) vengano rilevate entro ~60s, e ghPut gestisce da solo lo
    // SHA stale (409 → re-fetch) nel caso raro di divergenza.
    //
    // NOTA: non invalidiamo la cache "a ogni scrittura di state.json" come
    // suggerito testualmente dall'ISSUE, perché state.json viene scritto a
    // OGNI spin → invalidare ogni volta riporterebbe la GET a ogni spin,
    // annullando il guadagno. Il refresh-on-PUT qui sotto tiene la cache
    // coerente con lo stato senza mai forzarla vuota tra spin consecutivi.
    const README_CACHE_KEY = `gsm:readme:${PROFILE_REPO}`;
    const README_CACHE_TTL_SEC = 60;

    const readmePromise = (async () => {
      console.log(`[readme-update] START spin=${spinStart}`);
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 500;
      let lastError = null;

      // Lettura da cache KV (P1). Se presente, saltiamo la GET GitHub.
      let rf = null;
      if (kvEnabled) {
        try {
          const cached = await kvGet(README_CACHE_KEY);
          if (cached) {
            const parsed =
              typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (parsed && parsed.content) {
              rf = { content: parsed.content, sha: parsed.sha ?? null };
              console.log('[readme-update] cache HIT — skip GitHub GET');
            }
          }
        } catch (e) {
          console.warn('[readme-update] cache read failed, fallback GET:', e.message);
        }
      }

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          if (!rf) {
            console.log(
              `[readme-update] ghGetJson owner=${PROFILE_REPO} repo=${PROFILE_REPO} attempt=${attempt + 1}`
            );
            rf = await ghGetJson(token, PROFILE_REPO, PROFILE_REPO, 'README.md');
            if (rf && kvEnabled) {
              try {
                await kvSet(
                  README_CACHE_KEY,
                  { content: rf.content, sha: rf.sha },
                  README_CACHE_TTL_SEC
                );
                console.log('[readme-update] cache populated from GitHub GET');
              } catch (e) {
                console.warn('[readme-update] cache set failed:', e.message);
              }
            }
          }
          if (!rf) {
            console.log('[readme-update] ghGetJson returned null (README assente/illegibile)');
            return;
          }
          console.log('[readme-update] ghGetJson OK, sha present:', Boolean(rf.sha));

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
            // Refresh cache con il contenuto appena scritto (P1).
            if (kvEnabled) {
              try {
                await kvSet(
                  README_CACHE_KEY,
                  {
                    content: Buffer.from(newReadme, 'utf-8').toString('base64'),
                    sha: rf.sha,
                  },
                  README_CACHE_TTL_SEC
                );
                console.log('[readme-update] cache refreshed after PUT');
              } catch (e) {
                console.warn('[readme-update] cache refresh failed:', e.message);
              }
            }
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
      sendResponse(res, { status: 302, redirect: redirectUrl });
      return;
    }

    // Redirect con validazione Open Redirect (helper centralizzato)
    const rawRedirect = req.query?.redirect
      ? String(req.query.redirect).trim()
      : '';
    const redirectUrl = resolveRedirectUrl(rawRedirect, dest);

    sendResponse(res, { status: 302, redirect: redirectUrl });
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
      sendResponse(res, { status: 302, redirect: redirectUrl });
    } catch {
      // Ultimo baluardo: niente 500 nudo, ma un SVG di errore valido.
      sendResponse(res, {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' },
        body: fallbackSvg,
      });
    }
  }
}
