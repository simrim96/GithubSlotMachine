// Persistenza minimale dello stato della community (contatore spin + last win).
// Usa un file `state.json` committato direttamente nel repo della slot.

const STATE_PATH = 'state.json';

const DEFAULTS = {
  totalSpins: 0,
  totalWins: 0,
  lastWin: null, // { langId, langName, fact, repoUrl, repoName, ts }
};

export async function readState(token, owner, repo) {
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

export async function writeState(token, owner, repo, state, sha) {
  const body = {
    message: '🎰 Update slot stats',
    content: Buffer.from(JSON.stringify(state, null, 2)).toString('base64'),
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
  if (!r.ok) throw new Error(`state put: ${r.status}`);
}
