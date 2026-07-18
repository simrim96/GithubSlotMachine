// ─── GitHub API + README markers (estratto da spin.js) ───────────────────────
// Tutte le funzioni qui prendono `owner` come parametro esplicito (prima era
// una const globale OWNER) così sono testabili e riusabili senza stato globale.
import { kvEnabled, kvGet, kvSet } from './kv.js';
import { getDefaultTracker, getDefaultQueue } from './ratelimit-tracker.js';
import * as Sentry from '@sentry/node';

// Timeout per le chiamate GitHub API (5 secondi default, overrideabile via env)
const GITHUB_API_TIMEOUT_MS =
  parseInt(process.env.GITHUB_API_TIMEOUT_MS) || 5000;

// TTL per slot.svg: 7 giorni (604800 secondi)
// Gli SVG sono persistenti per definizione, ma vogliamo che scadeano dopo un periodo
// ragionevole in caso di Redis reset, così non diventano permanentemente obsoleti
const SLOT_SVG_TTL_SEC = 60 * 60 * 24 * 7; // 7 giorni

// ─── Circuit Breaker per GitHub API ──────────────────────────────────────────
// Previene failure cascading quando GitHub API ha outage o rate limit.
// Stati: 'closed' (normale), 'open' (bloccato), 'half-open' (tentativo recupero)
// Con fallback: quando il circuit è open, le chiamate passano comunque direttamente
// all'API senza passare dal circuit breaker, per evitare blocchi completi.
export class GitHubCircuitBreaker {
  constructor(failureThreshold = 3, resetTimeout = 60000) {
    this.failures = 0;
    this.threshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.lastFailure = 0;
    this.state = 'closed'; // 'closed', 'open', 'half-open'
  }

  isOpen() {
    if (this.state === 'closed') return false;
    if (this.state === 'half-open') return false; // half-open permette una chiamata di prova
    if (
      this.state === 'open' &&
      Date.now() - this.lastFailure > this.resetTimeout
    ) {
      this.reset();
      return false;
    }
    return true;
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.warn(`GitHub API circuit open after ${this.failures} failures`);
    }
  }

  reset() {
    this.failures = 0;
    this.state = 'half-open';
  }

  async call(fn) {
    if (this.isOpen()) {
      console.warn('GitHub API circuit open - falling back to direct API call');
      // Fallback: esegui direttamente la funzione senza passare dal circuit breaker
      // Questo mantiene il sistema operativo anche quando il circuit è aperto
      try {
        const result = await fn();
        return result;
      } catch (err) {
        // Se il fallback fallisce, conta comunque come fallimento
        this.onFailure();
        throw err;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
}

export const githubCircuitBreaker = new GitHubCircuitBreaker(3, 60000);

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeMarkdown(s) {
  return String(s).replace(/[*_`\[\]]/g, '\\$&');
}

// ghGet: GET /repos/{owner}/{repo}/contents/{path} -> json o null (anche su 404)
// Le chiamate passano attraverso la queue per gestire il rate limit
export async function ghGet(token, owner, repo, path) {
  const queue = getDefaultQueue();

  return queue.add(async () => {
    return githubCircuitBreaker.call(async () => {
      try {
        // Applica timeout alla chiamata
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          GITHUB_API_TIMEOUT_MS
        );

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'GithubSlotMachine',
            },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        // Traccia i rate limit headers
        getDefaultTracker().updateFromResponse(response);

        return response.ok ? await response.json() : null;
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn(
            `GitHub API timeout for ${owner}/${repo}/${path} after ${GITHUB_API_TIMEOUT_MS}ms`
          );
        }
        Sentry.captureException(error);
        throw error;
      }
    });
  });
}

export async function ghPut(
  token,
  owner,
  repo,
  path,
  content,
  sha,
  message,
  _retry = false
) {
  const queue = getDefaultQueue();

  return queue.add(async () => {
    return githubCircuitBreaker.call(async () => {
      try {
        const encoded = Buffer.from(content).toString('base64');
        const body = { message, content: encoded };
        if (sha) body.sha = sha;

        // Applica timeout alla chiamata
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          GITHUB_API_TIMEOUT_MS
        );

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
              'User-Agent': 'GithubSlotMachine',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        // Traccia i rate limit headers
        getDefaultTracker().updateFromResponse(response);

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
    });
  });
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
