// ─── GitHub API + README markers (estratto da spin.js) ───────────────────────
// Tutte le funzioni qui prendono `owner` come parametro esplicito (prima era
// una const globale OWNER) così sono testabili e riusabili senza stato globale.
import { kvEnabled, kvGet, kvSet } from './kv.js';
import { logRateLimit } from './ratelimit-tracker.js';
import { logger } from '../_lib/logger.js';

// Timeout per le chiamate GitHub API (2 secondi, più ragionevole per Edge)
export const GITHUB_API_TIMEOUT_MS =
  parseInt(process.env.GITHUB_API_TIMEOUT_MS) || 2000;

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

// Emette un allarme logger quando è configurato un token insicuro
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
  logger.error(msg);
  // Sentry integration handled by logger
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
  return String(s).replace(/[.*+?^${}()|\\[\]]/g, '\\$&');
}

export function escapeMarkdown(s) {
  return String(s).replace(/[*_`\[\]]/g, '\\$&');
}

// ghGetJson: GET /repos/{owner}/{repo}/contents/{path} -> json o null (anche su 404)
// Chiamata diretta con timeout (AbortController): niente coda di rate limiting. Per una slot
// personale il limite di 5000 req/h non è mai un vincolo reale, e la coda
// aggiungeva solo latenza e log fuorvianti sugli AbortError di timeout.
// `timeoutMs` è opzionale: default GITHUB_API_TIMEOUT_MS (5s). Nel percorso
// critico dello spin usa ghGetContentsJson() che passa il timeout stretto di 800ms.
// Ritorna l'oggetto JSON della Contents API (con campo `content` in base64) o null.
//
// FIX ISSUE-M3: retry su errori transienti (5xx, 408, 429).
// Non retry su 404, 401, 403 (errori permanenti).
// I timeout di rete/AbortError NON vengono retry: propagati al caller.
export async function ghGetJson(token, owner, repo, path, timeoutMs = GITHUB_API_TIMEOUT_MS) {
  const RETRY_MAX = 1;

  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

      // 429 rate limit: log e fallisci subito (no retry).
      if (response.status === 429) {
        logger.warn('GitHub rate limit hit (429), failing fast', { owner, repo, path });
        return null;
      }

      // 5xx o 408: errori transienti, ritenta (se possibile)
      if (response.status >= 500 || response.status === 408) {
        logger.debug('[ghGetJson] retrying on transient error', { attempt, status: response.status, owner, repo, path });
        if (attempt < RETRY_MAX) {
          await new Promise(r => setTimeout(r, 1000)); // breve backoff
          continue;
        }
        return null;
      }

      return response.ok ? await response.json() : null;
    } catch (err) {
      // Timeout di rete o AbortError: NON retry — propaghi al caller
      // che sa decidere il fallback (es. readState usa default).
      logger.warn('[ghGetJson] network error', { error: err?.message, owner, repo, path });
      throw err;
    }
  }

  return null;
}

// ghGetContentsJson: lettura di un file da GitHub Contents API con timeout STRETTO
// (800ms, GH_CONTENTS_TIMEOUT_MS) pensato per il percorso critico dello spin —
// ovvero quando KV è disabilitato e leggiamo state.json dal repo remoto
// (ISSUE/R4). Se GitHub è lento, lo spin NON si appoggia per secondi: il
// timeout scade e il chiamante applica il fallback (default di readState).
// Ritorna l'oggetto JSON della Contents API (con campo `content` in base64)
// o null su 404/timeout/errore.
export async function ghGetContentsJson(token, owner, repo, path) {
  return ghGetJson(token, owner, repo, path, GH_CONTENTS_TIMEOUT_MS);
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
  const RETRY_MAX = 1;
  const RETRYABLE_4XX = new Set([408, 429]); // retry su 408/429 (ma non su 409 che è handled diversamente)

  for (let attempt = 0; attempt <= (_retry ? 0 : RETRY_MAX); attempt++) {
    const encoded = Buffer.from(content).toString('base64');
    const body = { message, content: encoded };
    if (sha) body.sha = sha;

    // Applica timeout alla chiamata
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

    // 429 rate limit: log e fallisci subito (stessa logica di ghGetJson).
    if (response.status === 429) {
      logger.warn('GitHub rate limit hit on PUT (429), failing fast', { owner, repo, path });
      throw new Error(`PUT ${owner}/${repo}/${path}: 429 rate limited`);
    }

    // 409 SHA mismatch: rifetch e riprova
    if (response.status === 409 && !_retry) {
      const fresh = await ghGetJson(token, owner, repo, path);
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

    // 422 "sha wasn't supplied": file già esistente ma sha assente/null.
    // Succede quando il chiamante arriva dal percorso KV (readState KV non
    // propaga lo sha GitHub — es. gsm:state letto da Redis). Rifetch lo sha
    // corrente e riprova una volta, come per il 409.
    if (response.status === 422 && !_retry) {
      const fresh = await ghGetJson(token, owner, repo, path);
      if (fresh?.sha) {
        return ghPut(token, owner, repo, path, content, fresh.sha, message, true);
      }
      throw new Error(`PUT ${owner}/${repo}/${path}: 422 e sha non recuperabile`);
    }

    // 5xx o 408: errori transienti, ritenta (se non siamo già in retry)
    if (!response.ok && response.status >= 500 && !_retry && attempt < RETRY_MAX) {
      logger.debug('[ghPut] retrying on transient error', { attempt, status: response.status, owner, repo, path });
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if (!response.ok)
      throw new Error(`PUT ${owner}/${repo}/${path}: ${response.status}`);

    return;
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
      logger.warn('kv slotSvg save failed/timed out, falling back to github');
      // Sentry handled by logger
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
  const data = await ghGetJson(token, owner, repo, 'slot.svg');
  if (!data) return { content: null, sha: null };
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  };
}

// SVUOTA il blocco tra i marker SENZA condizioni (usato all'inizio dello
// spin, prima del redirect, così durante la rotazione dei rulli il README
// non mostra il link della vincita precedente). Il riempimento avviene
// solo DOPO la rotazione (vedi updateReadmeMarkers, chiamato in fillPromise).
export function clearReadmeMarkers(readme) {
  const START = '<!-- SLOT_LAST_WIN_START -->';
  const END = '<!-- SLOT_LAST_WIN_END -->';
  if (!readme.includes(START) || !readme.includes(END)) return readme;
  const cleared = `${START}\n${END}`;
  return readme.replace(
    new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}`),
    cleared
  );
}

// Aggiorna SOLO il blocco tra i marker con il badge della vittoria.
// Nessun contatore ("Total community spins"), nessun "Last win:", nessun
// funfact — l'utente vuole vedere ESCLUSIVAMENTE il link alla repo vincente.
// REGOLA: il badge compare SOLO quando c'è una vincita (lang presente) E un
// repo vincente (repoMatch). Su spin perdenti il blocco resta vuoto.
//
// Formato (valido sia per test che per produzione): un'immagine SVG embeddata
// wrappata in un link verso la repo vincente, al posto del vecchio testo+link
// markdown. L'SVG (api/badge.js) contiene il testo
//   "check out this repo I wrote in <linguaggio>"
// ed è animato: parte invisibile e diventa visibile solo DOPO la rotazione
// dei rulli (il badge è un documento SVG <img> separato, quindi usa un delay
// fisso di 6.5s, poco sopra la durata max dei rulli = 6.2s).
// `spinStart` (il timestamp dello spin) viene passato per forzare il refetch
// dell'immagine a ogni spin (?v=...), così l'animazione parte da 0.
export function updateReadmeMarkers(readme, state, lang, repoMatch, spinStart) {
  const START = '<!-- SLOT_LAST_WIN_START -->';
  const END = '<!-- SLOT_LAST_WIN_END -->';
  if (!readme.includes(START) || !readme.includes(END)) return readme;

  let block = `${START}\n`;
  // Badge SOLO su vincita: serve sia `lang` (il linguaggio vinto) che
  // `repoMatch` (il progetto da linkare). Senza vincita → blocco vuoto.
  if (lang && repoMatch) {
    const langName =
      lang.name || (lang.id != null ? String(lang.id) : '').trim();
    const v = spinStart != null ? `?v=${spinStart}` : '';
    // Stelle della repo vincente (rep.stargazers_count), già valorizzato in
    // repoMatch da repos.js. Le passiamo al badge che le mostrerà accanto
    // alla stella decorativa — così la stella NON è più solo grafica ma
    // riferita al conteggio reale della repo. Sanitizziamo a intero ≥0.
    const starsRaw = Number(repoMatch.stars);
    const stars = Number.isFinite(starsRaw) && starsRaw > 0 ? Math.floor(starsRaw) : 0;
    const badgeUrl = `https://github-slot-machine.vercel.app/api/badge${v}&amp;lang=${encodeURIComponent(
      langName
    )}${stars ? `&amp;stars=${stars}` : ''}`;
    // <a> cliccabile verso la repo, <img> puntante al badge SVG animato.
    // escapeXml su langName è ridondante (già pulito da encodeURIComponent +
    // l'endpoint badge.js fa safeLang), ma lo teniamo per coerenza col README.
    block +=
      `<a href="${repoMatch.url}">` +
      `<img src="${badgeUrl}" alt="check out this repo I wrote in ${langName}" ` +
      `width="340" style="border:0;display:inline-block" />` +
      `</a>\n`;
  }
  block += END;

  return readme.replace(
    new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}`),
    block
  );
}
