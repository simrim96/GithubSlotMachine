// Persistenza dello stato della community (contatore spin + last win).
//
// Priorità: Upstash Redis (veloce, same-region ~10ms, nessuno spam nella git
// history). Fallback: file state.json committato nel repo della slot (usato
// solo se Redis non è configurato E GITHUB_PAT è presente. In locale/dev,
// lo stato viene scritto su /tmp/GithubSlotMachine_state.json per non
// inquina re la git history.
//
// Tutte le chiamate KV passano dai wrapper con timeout in kv.js, così Redis
// lento/cross-region non blocca mai lo spin.

import { kvGet, kvSet, kvEnabled } from './kv.js';
import fs from 'node:fs';
import path from 'node:path';

const STATE_KEY = 'gsm:state';
const STATE_VERSION_KEY = 'gsm:state:version';
const STATE_PATH = 'state.json';
const TMP_STATE_PATH = '/tmp/GithubSlotMachine_state.json';

const DEFAULTS = {
  totalSpins: 0,
  totalWins: 0,
  lastWin: null, // { langId, langName, fact, repoUrl, repoName, ts }
  version: 1,
};

// ── Local fallback (senza git spam) ───────────────────────────────────────────
// Se GITHUB_PAT non è configurato, evitiamo di scrivere nello repo della slot.
// Scriviamo su /tmp/... che non viene committato.
async function readStateLocal() {
  try {
    const raw = await fs.promises.readFile(TMP_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { state: { ...DEFAULTS, ...parsed }, sha: null };
  } catch {
    return { state: { ...DEFAULTS }, sha: null };
  }
}

async function writeStateLocal(state) {
  try {
    const encoded = JSON.stringify(state, null, 2);
    await fs.promises.writeFile(TMP_STATE_PATH, encoded);
  } catch {
    // ignora: non possiamo salvare, ma lo spin continua lo stesso
  }
}

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
    const state = await kvGet(STATE_KEY);
    if (state) {
      // Se lo stato esiste ma non ha version, inizializzala
      if (state.version === undefined) {
        state.version = 1;
      }
      return { state: { ...DEFAULTS, ...state }, sha: null };
    }
    // Primo avvio (o KV vuoto/timeout): importa lo storico da GitHub per non
    // perderlo, poi seed-a KV. Se anche GitHub fallisce, torniamo ai default.
    const gh = await readStateGitHub(token, owner, repo).catch(() => null);
    if (gh) {
      // Seed Redis con stato da GitHub, assicurando version
      const stateToSeed = { ...gh.state };
      if (stateToSeed.version === undefined) {
        stateToSeed.version = 1;
      }
      await kvSet(STATE_KEY, stateToSeed);
      return { state: stateToSeed, sha: null };
    }
    return { state: { ...DEFAULTS }, sha: null };
  }
  // Se Redis non è attivo, usa GitHub solo se c'è un token valido (dev/prod).
  // Altrimenti, usa il fallback locale (nessun git spam).
  if (!token) {
    return readStateLocal();
  }
  return readStateGitHub(token, owner, repo);
}

export async function writeState(token, owner, repo, state, _sha) {
  if (kvEnabled) {
    // Assicurati che la version sia presente e incrementala
    const stateToSave = { ...state };
    if (stateToSave.version === undefined) {
      stateToSave.version = 1;
    }
    await kvSet(STATE_KEY, stateToSave);
    // Sync asincrono su GitHub per backup (non blocca lo spin)
    // Se fallisce, viene logged ma non interrompe l'esecuzione
    writeStateGitHub(token, owner, repo, stateToSave, _sha)
      .catch(e => console.warn('Redis state sync to GitHub failed:', e.message));
    return;
  }
  // Se non c'è token, scrivi su /tmp (locale) invece che nel repo.
  if (!token) {
    await writeStateLocal(state);
    return;
  }
  return writeStateGitHub(token, owner, repo, state, _sha);
}
