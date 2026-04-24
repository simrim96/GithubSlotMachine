// Look-up cache per (linguaggio → miglior repo dell'owner con ≥30% di quel lang).
// La cache è module-level: persiste finché l'istanza Vercel resta calda.

const TTL_MS = 1000 * 60 * 30; // 30 min
const cache = { ts: 0, byLangId: {} };

function ghHeaders(token) {
  const h = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GithubSlotMachine',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
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
}

export async function getRepoForLanguage(token, owner, lang, languages) {
  const fresh = Date.now() - cache.ts < TTL_MS;
  if (!fresh) {
    try {
      await refreshCache(token, owner, languages);
    } catch (e) {
      // In caso di errore non bloccare lo spin.
      console.warn('repos cache refresh failed:', e.message);
    }
  }
  return cache.byLangId[lang.id] || null;
}
