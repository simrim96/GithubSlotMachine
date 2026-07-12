// Look-up cache per (linguaggio → miglior repo dell'owner con ≥30% di quel lang).
//
// Cache a due livelli:
//   1. in-memory (module-level) — velocissima finché l'istanza Vercel resta calda
//   2. Upstash Redis — persiste TRA i cold start di Vercel, quindi il primo spin
//      a freddo NON fa più lo stall di 1-3s (fino a 100 chiamate /languages).
//
// Se Redis non è configurato, la cache resta solo in-memory (comportamento
// originale, con stall possibile sui cold start).
//
// NON-BLOCCANTE: se la cache è fredda, NON aspettiamo lo stall di refresh — lo
// lanciamo in background e ritorniamo subito il valore corrente (spesso null al
// primo giro → il redirect punta al profilo). La cache si popola per il prossimo
// spin. Così il tempo tra click e reload non dipende mai dallo stall GitHub.

import { kvGet, kvSet, kvEnabled } from './kv.js';

const TTL_MS = 1000 * 60 * 30; // 30 min
const KV_KEY = 'gsm:repoCache';
const cache = { ts: 0, byLangId: {} };
let kvLoaded = false;

function ghHeaders(token) {
  const h = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GithubSlotMachine',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function loadFromKv() {
  if (!kvEnabled || kvLoaded) return;
  const data = await kvGet(KV_KEY);
  if (data && data.ts) {
    cache.ts = data.ts;
    cache.byLangId = data.byLangId || {};
  }
  kvLoaded = true;
}

function saveToKv() {
  if (!kvEnabled) return;
  // Fire-and-forget: non blocchiamo lo spin per il salvataggio della cache.
  kvSet(KV_KEY, { ts: cache.ts, byLangId: cache.byLangId }).catch(() => {});
}

async function refreshCache(token, owner, languages) {
  const headers = ghHeaders(token);
  const r = await fetch(
    `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated&type=owner`,
    { headers }
  );
  if (!r.ok) throw new Error(`repos list: ${r.status}`);
  const repos = (await r.json()).filter((rep) => !rep.fork && !rep.archived);

  // Per ogni repo, fetch /languages in parallelo (cap pratico: 100 repo × 1 call).
  const langMaps = await Promise.all(
    repos.map(async (rep) => {
      try {
        const lr = await fetch(rep.languages_url, { headers });
        if (!lr.ok) return null;
        return await lr.json();
      } catch {
        return null;
      }
    })
  );

  const byLangId = {};
  repos.forEach((rep, i) => {
    const langs = langMaps[i];
    if (!langs) return;
    const total = Object.values(langs).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const topics = (rep.topics || []).map((t) => t.toLowerCase());

    for (const lang of languages) {
      const ghName = lang.githubLang || lang.name;
      const bytes = langs[ghName] || 0;
      const pct = bytes / total;
      if (pct < 0.30) continue;
      if (lang.topic && !topics.includes(lang.topic.toLowerCase())) continue;

      const candidate = {
        url: rep.html_url,
        name: rep.name,
        description: rep.description || '',
        stars: rep.stargazers_count || 0,
        pct,
      };
      const cur = byLangId[lang.id];
      // Privilegia repo non-profile e con percentuale più alta, poi più stelle.
      const isProfile = rep.name.toLowerCase() === owner.toLowerCase();
      if (!cur || (!isProfile && (pct > cur.pct || (pct === cur.pct && candidate.stars > cur.stars)))) {
        byLangId[lang.id] = candidate;
      }
    }
  });

  cache.ts = Date.now();
  cache.byLangId = byLangId;
  saveToKv();
}

export async function getRepoForLanguage(token, owner, lang, languages) {
  await loadFromKv();
  const fresh = Date.now() - cache.ts < TTL_MS;
  if (!fresh) {
    // NON bloccare il redirect: popola la cache in background, ritorna subito.
    refreshCache(token, owner, languages).catch((e) =>
      console.warn('repos cache refresh failed:', e.message)
    );
  }
  return cache.byLangId[lang.id] || null;
}
