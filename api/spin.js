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
  checkWins,
  countScatters,
  winningLangId,
  wrap,
} from './_lib/game.js';
import { buildSVG, errorSVG, errorSVGString } from './_lib/svg-builder.js';
import { buildAccessibleSVG, buildAccessibleSVGWithTimeout } from './_lib/svg-builder-accessible.js';
import {
  ghGetJson,
  ghPut,
  saveSlotSvg,
  loadSlotSvg,
  updateReadmeMarkers,
  clearReadmeMarkers,
  auditToken,
  GH_CONTENTS_TIMEOUT_MS,
} from './_lib/github.js';
import { kvGet, kvSet, kvEnabled } from './_lib/kv.js';
import { applyCors } from './_lib/cors.js';
import { sendResponse } from './_lib/response-bridge.js';
import { WILD_ID, SCATTER_ID } from './_lib/languages.js';
import { getRepoForLanguage } from './_lib/repos.js';
import { getRandomRepo } from './_lib/repos.js';
import { readState, writeState } from './_lib/state.js';
import { isValidUser } from './_lib/ratelimit.js';
import { checkSpinCooldown } from './_lib/spin-cooldown.js';
import { logger } from './_lib/logger.js';
// Graceful shutdown per M4: gestione segnali SIGTERM/SIGINT
import { gracefulShutdown, trackOperation } from './_lib/shutdown.js';
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
  logger.debug('Security: Allowed validated redirect to:', { url: r });
  return r;
  }
  if (r && !isValidRedirectUrl(r)) {
  logger.warn('[Security] Blocked open redirect attempt to:', { url: r });
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
  checkWins,
  countScatters,
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
  getRandomRepo,
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
// M4: Registra handler di graceful shutdown una sola volta all'inizio
gracefulShutdown();

export default async function handler(req, res) {
  // M4: Traccia lo spin come operazione in-flight per graceful shutdown
  const spinOp = trackOperation('spin');
  
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
      logger.error('[S4]', { error: e.message });
      token = null;
    }
  }
  
  try {
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
    

    const spinStart = Date.now();
    // Se manca il token di GitHub, NON rispondere con un 500 nudo (che
    // "rompe" la leva): facciamo comunque un redirect verso il profilo
    // dell'owner così l'utente non vede mai una pagina rotta. Lo spin non
    // persistito non è critico (il contatore si aggiorna al giro dopo).
    if (!token) {
      logger.error('spin handler: GITHUB_PAT non configurato — redirect graceful');
      const redirectUrl = resolveRedirectUrl(
        req.query?.redirect ? String(req.query.redirect).trim() : '',
        `https://github.com/${OWNER}`
      );
      sendResponse(res, { status: 302, redirect: redirectUrl });
      return;
    }

    // generateGrid è DENTRO il try: se lancia, degrada a errore graceful.
    const grid = generateGrid();

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

    // ── README: GET ANTICIPATA (spin a "freddo" più veloce) ────────────────
    // La GET della README (cache KV → GitHub, ~150-400ms) è la lettura lenta
    // del percorso critico. PRIMA partiva solo DOPO la build SVG, aggiungendo
    // la sua latenza IN SERIE al tempo percepito dello spin — ed è proprio il
    // caso peggiore sullo spin a freddo (cache README scaduta dopo inattività,
    // quindi GET GitHub quasi certa). Ora parte SUBITO, in parallelo alla
    // lettura di slot.svg + stato e alla repo lookup: su spin a freddo la GET
    // esce dal percorso critico e il redirect aspetta solo la PUT invece di
    // GET+PUT in serie. Timeout STRETTO (800ms, come la lettura di state.json):
    // una GitHub lenta non deve allungare lo spin fino ai 2s di default.
    const README_GET_TIMEOUT_MS = GH_CONTENTS_TIMEOUT_MS; // 800ms
    const README_MAX_RETRIES = 2;
    const README_RETRY_DELAY_MS = 500;
    const readmeGetPromise = (async () => {
      // Lettura da cache KV (P1). Se presente, saltiamo la GET GitHub.
      if (kvEnabled) {
        try {
          const cached = await kvGet(README_CACHE_KEY);
          if (cached) {
            const parsed =
              typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (parsed && parsed.content) {
              logger.info('[readme-update] cache HIT — skip GitHub GET');
              return { content: parsed.content, sha: parsed.sha ?? null };
            }
          }
        } catch (e) {
          logger.warn('[readme-update] cache read failed, fallback GET:', { error: e.message });
        }
      }

      let lastGetError = null;
      for (let attempt = 0; attempt < README_MAX_RETRIES; attempt++) {
        try {
          logger.info('[readme-update] ghGetJson', { owner: PROFILE_REPO, repo: PROFILE_REPO, attempt: attempt + 1 });
          const rf = await ghGetJson(
            token,
            PROFILE_REPO,
            PROFILE_REPO,
            'README.md',
            README_GET_TIMEOUT_MS
          );
          if (!rf) {
            logger.info('[readme-update] ghGetJson returned null (README assente/illegibile)');
            return null;
          }
          if (kvEnabled) {
            try {
              await kvSet(
                README_CACHE_KEY,
                { content: rf.content, sha: rf.sha },
                README_CACHE_TTL_SEC
              );
              logger.info('[readme-update] cache populated from GitHub GET');
            } catch (e) {
              logger.warn('[readme-update] cache set failed:', { error: e.message });
            }
          }
          return rf;
        } catch (e) {
          lastGetError = e;
          logger.warn('README GET attempt failed', { attempt: attempt + 1, error: e.message });
          if (attempt < README_MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, README_RETRY_DELAY_MS));
          }
        }
      }
      logger.warn('README GET failed', { max_retries: README_MAX_RETRIES, last_error: lastGetError?.message });
      return null;
    })();

    // Letture CRITICHE (percorso click→reload): solo slot.svg (KV) + stato (KV).
    // La GET del README su GitHub (readmeGetPromise qui sopra) parte IN
    // PARALLELO a queste letture, così la sua latenza non si somma in serie.
    const [slotFile, stateBundle] = await Promise.all([
      loadSlotSvg(token, OWNER, SLOT_REPO),
      readState(token, OWNER, SLOT_REPO).catch(() => ({
        state: { totalSpins: 0, totalWins: 0, lastWin: null },
        sha: null,
      })),
    ]);

    const { state, sha: stateSha } = stateBundle;
    state.totalSpins = (state.totalSpins || 0) + 1;
    // Impostiamo lastPullTimestamp al tempo reale dello spin
    // Questo permette all'animazione di pull di essere mostrata per ~3 secondi dopo lo spin
    state.lastPullTimestamp = spinStart;

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
        logger.warn('repo lookup failed:', { error: e.message });
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

    // ── TEST MODE (SLOT_TEST_RANDOM_REPO=1) ──────────────────────────────────
    // MODALITÀ DI TEST: quando c'è UNA VINCITA ma il repo reale non è stato
    // trovato (cache fredda, linguaggio <30%, o nessun repo valido), forza un
    // link a un progetto casuale dell'owner così la catena
    // spin→repo→link nel README resta verificabile. SU SPIN PERDENTI (nessun
    // winningLang) NON scrive nulla — il link compare SOLO su vincita, come in
    // produzione. Il redirect resta sul profilo owner. Disattivabile con
    // env vuoto/0. Da NON usare in produzione.
    if (
      process.env.SLOT_TEST_RANDOM_REPO === '1' &&
      winningLang &&
      !repoMatch
    ) {
      try {
        const randomRepo = await getRandomRepo(token, OWNER);
        if (randomRepo) {
          repoMatch = randomRepo;
          logger.info('[test-mode] link forzato a repo casuale', {
            name: repoMatch.name,
          });
        }
      } catch (e) {
        logger.warn('[test-mode] getRandomRepo failed:', { error: e.message });
      }
    }

    // M3: Build SVG con timeout di sicurezza (3s default)
    // Se il timeout scade, viene servito un SVG di degrado invece di bloccare.
    const svg = await buildAccessibleSVGWithTimeout({
      grid,
      uid: spinStart,
      state,
      winningLang,
      fact,
      owner: OWNER,
      isWin,
    });

    // Calcola la destinazione del redirect PRIMA di scrivere qualsiasi cosa.
    // ?user= è validato con isValidUser(): solo login GitHub [A-Za-z0-9-]{1,39}.
    // Qualsiasi valore non valido (path, slash, caratteri strani) cade sul
    // proprietario di default → chiude l'open-redirect verso altri host/percorsi.
    //
    // NOTA (comportamento voluto): NON reindirizziamo più verso la repo
    // vincente. La leva riporta sempre al profilo dell'owner, dove il marker
    // "🏆 Last win → [repo](url)" nel README mostra il link cliccabile alla
    // repo del linguaggio uscito (vedi updateReadmeMarkers in github.js).
    // Nei README di GitHub lo slot è servito come <img>, quindi i link
    // dentro l'SVG non sarebbero cliccabili: il link cliccabile vive quindi
    // nel marker del README, non nel redirect.
    const rawUser = req.query?.user ? String(req.query.user).trim() : '';
    const targetOwner = rawUser && isValidUser(rawUser) ? rawUser : OWNER;
    let dest;
    // (RIMOSSO) Il redirect "jackpot → tutte le repo del linguaggio" è stato
    // disattivato: la vincita è ora sempre "normale" e non si distingue per
    // il target del redirect. Tutto resta sul profilo owner.
    dest = `https://github.com/${OWNER}`;

    // ── Scritture ────────────────────────────────────────────────────────────
    // Eseguite IN PARALLELO nel flusso principale (rete VIVA), PRIMA del
    // redirect, così GitHub risponde davvero (waitUntil post-redirect su Vercel
    // non ha rete in uscita verso api.github.com → timeout 5000ms, bug "stessa
    // svg più volte"). La latenza totale è il max dei task, non la somma:
    //   - slot.svg (KV): ~10-20ms
    //   - state (KV):    ~10-20ms
    //   - README PUT GitHub: ~270ms (la GET è già stata anticipata sopra e si
    //     sovrappone a repo lookup + build SVG — vedi readmeGetPromise)
    // Timeout di sicurezza per il path README: copre clear + fill (PUT
    // GitHub, ~1.5s) con margine. Non deve mai bloccare il redirect.
    const README_TIMEOUT_MS = 4000;

    // ── README: UNICA GET+PUT (clear + fill insieme, senza delay) ──────────
    // 1) Svuota i marker (rimuove il link della vittoria PRECEDENTE) così
    //    durante la rotazione dei rulli NON compare nessun link vecchio.
    // 2) Li riempie subito con il link della vittoria corrente.
    // La GET è stata ANTICIPATA (readmeGetPromise, subito dopo la lettura
    // dello stato): qui si attende il suo esito e si scrive la PUT.
    // NESSUN setTimeout artificiale: il link viene scritto il prima possibile,
    // in parallelo al redirect. La "comparsione dopo la rotazione" è ottenuta
    // gratis dalla latenza di re-render del README su GitHub (alcuni secondi
    // dopo il redirect, quando i rulli hanno già finito): non serve (e non si
    // deve) bloccare l'SVG o il redirect con un timer.
    const readmePromise = (async () => {
      logger.info('[readme-update] START', { spin: spinStart });
      const rf = await readmeGetPromise;
      if (!rf) {
        logger.info('[readme-update] ghGetJson returned null (README assente/illegibile)');
        return;
      }
      logger.info('[readme-update] ghGetJson OK', { sha_present: Boolean(rf.sha) });

      let lastError = null;
      for (let attempt = 0; attempt < README_MAX_RETRIES; attempt++) {
        try {
          const oldReadme = Buffer.from(rf.content, 'base64').toString('utf-8');
          // (1) svuota i marker della vittoria precedente
          let newReadme = clearReadmeMarkers(oldReadme);
          // (2) aggiorna versione + riempie con la vittoria corrente
          // FIX "risultato precedente" (t_690b8db0): se l'embed di api/image è
          // SENZA query (?v assente, es. embed aggiunto a mano), il vecchio
          // replace non lo toccava → l'URL non cambiava mai → GitHub Camo
          // serviva per sempre la PRIMA immagine cacheata. La seconda passata
          // aggiunge ?v agli embed senza query (senza toccare URL con altri
          // parametri o path estesi, es. api/image-2, api/image/foo).
          newReadme = newReadme.replace(
            /api\/image\?(?:v|cache_buster)=[0-9]*/g,
            `api/image?v=${spinStart}`
          );
          newReadme = newReadme.replace(
            /api\/image(?![\w?/.\-])/g,
            `api/image?v=${spinStart}`
          );
          newReadme = newReadme.replace(
            /api\/lever(?:\?(?:v|cache_buster)=[0-9]*)?/g,
            `api/lever?v=${spinStart}`
          );
          newReadme = updateReadmeMarkers(
            newReadme,
            state,
            winningLang,
            repoMatch,
            spinStart,
            OWNER
          );
          if (newReadme !== oldReadme) {
            const newSha = await ghPut(
              token,
              PROFILE_REPO,
              PROFILE_REPO,
              'README.md',
              newReadme,
              rf.sha,
              '🎰 Update slot'
            );
            logger.info('[readme-update] ghPut OK', { version: spinStart });
            // Refresh cache con il contenuto appena scritto (P1). Salviamo lo
            // sha POST-PUT (ghPut ora lo ritorna): prima si salvava lo sha
            // PRE-PUT, quindi OGNI cache HIT faceva PUT → 409 "sha mismatch"
            // → GET + PUT (una GET inutile a ogni spin entro il TTL).
            if (kvEnabled) {
              try {
                await kvSet(
                  README_CACHE_KEY,
                  {
                    content: Buffer.from(newReadme, 'utf-8').toString('base64'),
                    sha: newSha ?? rf.sha,
                  },
                  README_CACHE_TTL_SEC
                );
                logger.info('[readme-update] cache refreshed after PUT');
              } catch (e) {
                logger.warn('[readme-update] cache refresh failed:', { error: e.message });
              }
            }
          } else {
            logger.info('[readme-update] README unchanged, skip PUT');
          }
          return; // Successo
        } catch (e) {
          lastError = e;
          logger.warn('README update attempt failed', { attempt: attempt + 1, error: e.message });
          if (attempt < README_MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, README_RETRY_DELAY_MS));
          }
        }
      }
      logger.error('README update failed', { max_retries: README_MAX_RETRIES, last_error: lastError?.message });
    })();

    // slot.svg + state + README girano in parallelo. Se la README supera il
    // timeout di sicurezza, non blocchiamo il redirect: lo slot funziona lo
    // stesso (solo la combinazione nel profilo si aggiorna al giro dopo).
    // Il timer viene cancellato quando readmePromise termina (via .finally)
    // per evitare warning fantasma quando il test termina prima che i timer
    // di 4s scattino.
    let readmeTimeoutId = null;
    const readmeWithTimeout = Promise.race([
      readmePromise,
      new Promise((res) => {
        readmeTimeoutId = setTimeout(() => {
          logger.warn('[readme] timeout di sicurezza, skip per non bloccare redirect');
          res();
        }, README_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (readmeTimeoutId) clearTimeout(readmeTimeoutId);
    });

    const [slotResult] = await Promise.allSettled([
      saveSlotSvg(token, OWNER, SLOT_REPO, svg, slotFile?.sha),
      writeState(token, OWNER, SLOT_REPO, state, stateSha),
      readmeWithTimeout,
    ]);

    if (slotResult.status === 'rejected') {
      logger.warn('slot.svg write failed (redirect anyway)', { reason: slotResult.reason?.message });
      // Redirect anche se slot.svg fallisce (l'utente vede il risultato
      // precedente una volta, ma lo slot non esplode con un 500).
      const rawRedirect = req.query?.redirect
        ? String(req.query.redirect).trim()
        : '';
      let redirectUrl = dest;
      if (rawRedirect && isValidRedirectUrl(rawRedirect)) {
        redirectUrl = rawRedirect;
        logger.debug('Security: Allowed validated redirect to:', { url: redirectUrl });
      } else if (rawRedirect && !isValidRedirectUrl(rawRedirect)) {
        logger.warn('[Security] Blocked open redirect attempt to:', { url: rawRedirect });
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
    logger.debug('Security: Redirecting to:', { url: redirectUrl });
  } catch (err) {
    logger.error('spin handler error:', { error: err?.message || err });
    // Sentry integration handled by logger
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
    // M4: Termina traccia operazione spin (sempre, anche in caso di errore)
    spinOp.end();
  }
}
