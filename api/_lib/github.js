// ─── GitHub API + README markers (estratto da spin.js) ───────────────────────
// Tutte le funzioni qui prendono `owner` come parametro esplicito (prima era
// una const globale OWNER) così sono testabili e riusabili senza stato globale.
import { kvEnabled, kvGet, kvSet } from './kv.js';
import { logRateLimit } from './ratelimit-tracker.js';
import * as Sentry from '@sentry/node';

// Timeout per le chiamate GitHub API (5 secondi default, overrideabile via env)
export const GITHUB_API_TIMEOUT_MS =
  parseInt(process.env.GITHUB_API_TIMEOUT_MS) || 5000;

// Timeout STRETTO per le letture di *contenuto* nel percorso critico dello
// spin (state.json quando KV è disabilitato, config della slot, ecc.).
// 800ms coerente con il cold-start wait di repos.js (COLD_START_WAIT_MS) così
// lo spin non si appoggia per secondi interi se GitHub è lento (ISSUE/R4).
// Overridabile via env per test/ambienti particolari.
export const GH_CONTENTS_TIMEOUT_MS =
  parseInt(process.env.GH_CONTENTS_TIMEOUT_MS) || 800;

// ── S4 hardening: token type detection (ISSUES.md §2) ───────────────────────
// Un PAT classico (prefisso `ghp_`) con scope `repo` può leggere/scrivere
// TUTTI i repo dell'utente se viene leakato. S4 richiede un PAT
// *fine-grained* (prefisso `github_pat_`) limitato SOLO al repo della slot e
// al repo del profilo, con `Contents: read & write` (+ `Metadata: read` così
// la lista repo funziona). Questi helper permettono all'app di rilevare una
// configurazione insicura e avvisare rumorosamente — e opzionalmente di
// rifiutarsi di operare con un PAT classico (fail-closed).
const CLASSIC_PAT_PREFIXES = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];

export function detectTokenType(token) {
  if (!token || typeof token !== 'string' || token.length === 0) {
    return { kind: 'none', safe: false };
  }
  if (token.startsWith('github_pat_')) {
    return { kind: 'fine-grained', safe: true };
  }
  if (CLASSIC_PAT_PREFIXES.some((p) => token.startsWith(p))) {
    return { kind: 'classic', safe: false };
  }
  // Formato sconosciuto (OAuth token, GitHub App token, stringa arbitraria…):
  // non possiamo assumerlo sicuro → trattato come insicuro.
  return { kind: 'unknown', safe: false };
}

// Emette un allarme Sentry + console quando è configurato un token insicuro
// (classic/unknown). Ritorna il tipo rilevato così il chiamante può decidere
// se abortire. `enforce` (default false) fa saltare il write GitHub e degrada
// a read-only quando il token NON è fine-grained.
export function auditToken(token, { enforce = false } = {}) {
  const t = detectTokenType(token);
  if (t.safe || t.kind === 'none') return t; // none = dev/read-only atteso
  const msg =
    `[S4] INSECURE GITHUB_PAT detected (kind=${t.kind}). ` +
    `Classic/unknown PATs can expose ALL your repos if leaked. ` +
    `Use a fine-grained PAT scoped to the slot + profile repos only ` +
    `(Contents: read & write, Metadata: read). Rotate the leaked token now.`;
  console.error(msg);
  try {
    if (typeof Sentry !== 'undefined' && Sentry.captureMessage) {
      Sentry.captureMessage(msg, 'warning');
    }
  } catch { /* no-op */ }
  if (enforce) {
    throw new Error(
      'S4 enforcement: refusing to use a non-fine-grained GITHUB_PAT. ' +
        'Set GITHUB_PAT_REQUIRE_FINEGRAINED=false to override (not recommended).'
    );
  }
  return t;
}

// TTL per slot.svg: 7 giorni (604800 secondi)
// Gli SVG sono persistenti per definizione, ma vogliamo che scadeano dopo un periodo
// ragionevole in caso di Redis reset, così non diventano permanentemente obsoleti
const SLOT_SVG_TTL_SEC = 60 * 60 * 24 * 7; // 7 giorni

// Header standard per le chiamate GitHub API. Unica sorgente condivisa
// (evita duplicazioni divergenti in repos.js / image.js / health.js — ISSUE-16).
export function ghHeaders(token, opts = {}) {
  const {
    accept = 'application/vnd.github.v3+json',
    userAgent = 'GithubSlotMachine',
  } = opts;
  const h = { Accept: accept, 'User-Agent': userAgent };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeMarkdown(s) {
  return String(s).replace(/[*_`\[\]]/g, '\\$&');
}

// ghGet: GET /repos/{owner}/{repo}/contents/{path} -> json o null (anche su 404)
// Chiamata diretta con timeout (AbortController): niente coda di rate limiting. Per una slot
// personale il limite di 5000 req/h non è mai un vincolo reale, e la coda
// aggiungeva solo latenza e log fuorvianti sugli AbortError di timeout.
// `timeoutMs` è opzionale: default GITHUB_API_TIMEOUT_MS (5s). Nel percorso
// critico dello spin usa ghGetContents() che passa il timeout stretto di 800ms.
export async function ghGet(token, owner, repo, path, timeoutMs = GITHUB_API_TIMEOUT_MS) {
  try {
      // Applica timeout alla chiamata
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        timeoutMs
      );

      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
          headers: {
            ...ghHeaders(token),
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      // Traccia i rate limit headers (solo logging warning, non blocca)
      logRateLimit(response);

      return response.ok ? await response.json() : null;
    } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(
        `GitHub API timeout for ${owner}/${repo}/${path} after ${GITHUB_API_TIMEOUT_MS}ms`
      );
    } else {
      console.error(
        `[ghGet] ERROR ${owner}/${repo}/${path}:`,
        error?.name,
        error?.message,
        error?.stack?.split('\n').slice(0, 3).join(' | ')
      );
    }
    if (typeof Sentry !== 'undefined') Sentry.captureException(error);
    throw error;
  }
}

// ghGetContents: lettura di un file da GitHub Contents API con timeout STRETTO
// (800ms, GH_CONTENTS_TIMEOUT_MS) pensato per il percorso critico dello spin —
// ovvero quando KV è disabilitato e leggiamo state.json dal repo remoto
// (ISSUE/R4). Se GitHub è lento, lo spin NON si appoggia per secondi: il
// timeout scade e il chiamante applica il fallback (default di readState).
// Ritorna lo stesso oggetto di ghGet (json o null su 404/timeout/errore).
export async function ghGetContents(token, owner, repo, path) {
  return ghGet(token, owner, repo, path, GH_CONTENTS_TIMEOUT_MS);
}

export async function ghPut(
  token,
  owner,
  repo,
  path,
  content,
  sha,
  message,
  _retry = false,
  timeoutMs = GITHUB_API_TIMEOUT_MS
) {
  try {
        const encoded = Buffer.from(content).toString('base64');
        const body = { message, content: encoded };
        if (sha) body.sha = sha;

        // Applica timeout alla chiamata
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          timeoutMs
        );

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          {
            method: 'PUT',
            headers: {
              ...ghHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        // Traccia i rate limit headers
        logRateLimit(response);

        if (response.status === 409 && !_retry) {
          // SHA stale o mancante: rifetch il file per ottenere lo SHA aggiornato e riprova.
          const fresh = await ghGet(token, owner, repo, path);
          return ghPut(
            token,
            owner,
            repo,
            path,
            content,
            fresh?.sha ?? null,
            message,
            true
          );
        }
        if (!response.ok)
          throw new Error(`PUT ${owner}/${repo}/${path}: ${response.status}`);
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn(
            `GitHub API timeout for PUT ${owner}/${repo}/${path} after ${GITHUB_API_TIMEOUT_MS}ms`
          );
        }
        Sentry.captureException(error);
        throw error;
      }
}

// ── Persistenza slot.svg ──────────────────────────────────────────────────────
// Su Upstash Redis (kv:gsm:slotSvg) se configurato: letture/scritture ~10ms
// same-region, eliminando il GET su GitHub (150-400ms) ad ogni caricamento della
// slot. Fallback su GitHub Contents se Redis non è disponibile o in timeout.
// Tutte le chiamate KV passano dai wrapper con timeout (200ms) in kv.js.
export async function saveSlotSvg(token, owner, repo, svg, sha) {
  if (kvEnabled) {
    try {
      const ok = await kvSet('gsm:slotSvg', svg, SLOT_SVG_TTL_SEC);
      if (ok) return;
    } catch (e) {
      Sentry.captureException(e);
      console.warn('kv slotSvg save failed/timed out, falling back to github');
    }
  }
  await ghPut(token, owner, repo, 'slot.svg', svg, sha, '🎰 Update live slot');
}

// Carica lo slot.svg corrente per l'update incrementale (Redis, poi GitHub).
export async function loadSlotSvg(token, owner, repo) {
  if (kvEnabled) {
    const svg = await kvGet('gsm:slotSvg');
    if (svg) return { content: svg, sha: null };
  }
  const data = await ghGet(token, owner, repo, 'slot.svg');
  if (!data) return { content: null, sha: null };
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  };
}

export function updateReadmeMarkers(readme, state, lang, repoMatch, fact) {
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
