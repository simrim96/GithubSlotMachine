// Persistenza dello stato della community (contatore spin + last win).
//
// Priorità: Upstash Redis (veloce, same-region ~10ms, nessuno spam nella git
// history). Fallback: file state.json committato nel repo della slot (usato
// solo se Redis non è configurato, es. dev locale).

import { kv, kvEnabled } from './kv.js';

const STATE_KEY = 'gsm:state';
const STATE_PATH = 'state.json';

const DEFAULTS = {
  totalSpins: 0,
  totalWins: 0,
  lastWin: null, // { langId, langName, fact, repoUrl, repoName, ts }
};

// ── Fallback GitHub ───────────────────────────────────────────────────────────
async function readStateGitHub(token, owner, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${STATE_PATH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'GithubSlotMachine',
      },
    }
  );
  if (r.status === 404) return { state: { ...DEFAULTS }, sha: null };
  if (!r.ok) throw new Error(`state get: ${r.status}`);
  const data = await r.json();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  } catch {
    parsed = {};
  }
  return { state: { ...DEFAULTS, ...parsed }, sha: data.sha };
}

async function writeStateGitHub(token, owner, repo, state, sha, _retry = false) {
  const encoded = Buffer.from(JSON.stringify(state, null, 2)).toString('base64');
  const body = {
    message: '🎰 Update slot stats',
    content: encoded,
  };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${STATE_PATH}`,
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
    // SHA stale: rifetch e riprova una volta.
    const { sha: freshSha } = await readStateGitHub(token, owner, repo);
    return writeStateGitHub(token, owner, repo, state, freshSha, true);
  }
  if (!r.ok) throw new Error(`state put: ${r.status}`);
}

// ── API pubblica ───────────────────────────────────────────────────────────────
export async function readState(token, owner, repo) {
  if (kvEnabled) {
    try {
      const state = await kv.get(STATE_KEY);
      if (state) return { state: { ...DEFAULTS, ...state }, sha: null };
      // Primo avvio: importa lo storico da GitHub per non perderlo, poi seed-a KV.
      const gh = await readStateGitHub(token, owner, repo).catch(() => null);
      if (gh) {
        await kv.set(STATE_KEY, gh.state).catch(() => {});
        return { state: gh.state, sha: null };
      }
      return { state: { ...DEFAULTS }, sha: null };
    } catch (e) {
      console.warn('kv state read failed, falling back to github:', e.message);
    }
  }
  return readStateGitHub(token, owner, repo);
}

export async function writeState(token, owner, repo, state, _sha) {
  if (kvEnabled) {
    try {
      await kv.set(STATE_KEY, state);
      return;
    } catch (e) {
      console.warn('kv state write failed, falling back to github:', e.message);
    }
  }
  return writeStateGitHub(token, owner, repo, state, _sha);
}
