// Look-up cache per (linguaggio → miglior repo dell'owner con ≥30% di quel lang).
//
// Cache a TRE livelli (R5 — resilienza cross-region):
//   1. in-memory (module-level) — velocissima finché l'istanza Vercel resta calda
//   2. Upstash Redis "fresh" (gsm:repoCache, TTL 30m) — persiste TRA i cold start
//   3. Upstash Redis "lastgood" (gsm:repoCache:lastgood, SENZA TTL) — snapshot
//      sempre disponibile dei repo recenti, scritto in parallelo al fresh.
//
// Il tier lastgood è il fix di R5: anche se Upstash è in una regione diversa
// da Vercel (fra1) e il round-trip supera i timeout, lo spin continua a
// ricevere i repo dall'ultimo snapshot buono invece di cascare nel fallback
// "nessun repo". Solo al cold-start GENUINO (nessun dato da nessuna parte) si
// attende la GitHub API (globale, veloce da qualsiasi regione), mai Upstash.
//
// Se Redis non è configurato, la cache resta solo in-memory (comportamento
// originale, con stall possibile sui cold starts).
//
// NON-BLOCCANTE: se la cache è stale ma già stata popolata una volta (memoria
// o lastgood), NON aspettiamo lo stall di refresh — lo lanciamo in background
// e ritorniamo subito il valore ancora valido. Solo al COLD START GENUINO
// (cache mai popolata, nessun lastgood) facciamo un breve await (ISSUE-28,
// timeout 800ms) così il PRIMO spin ha già i repo se la rete risponde.

import { kvGet, kvSet, kvEnabled } from './kv.js';
import { GITHUB_API_TIMEOUT_MS, ghHeaders } from './github.js';
import { logger } from '../_lib/logger.js';

const TTL_MS = 1000 * 60 * 30; // 30 min
// Al cold start (cache mai popolata) aspettiamo al massimo questo timeout prima
// di arrenderci e ritornare null — così il PRIMO spin ha i repo se la rete
// risponde (ISSUE-28), senza però appenderci all'infinito sullo stall GitHub.
const COLD_START_WAIT_MS = 800;
const KV_KEY = 'gsm:repoCache';
// Tier "lastgood" (R5): snapshot SEMPRE disponibile dei repo, scritto in
// parallelo al layer fresh ma SENZA TTL. Sopravvive ai cold start e anche se
// il layer fresh è scaduto/stale, così lo spin ha SEMPRE i repo recenti anche
// quando Upstash è cross-region o la refresh GitHub fallisce.
const KV_LASTGOOD_KEY = 'gsm:repoCache:lastgood';
// Concorrenza massima per la fetch dei /languages: evita il burst di ~100
// richieste parallele a freddo che esaurirebbe il rate-limit GitHub (5000/h).
// Rappresenta quanti repo possiamo interrogare in parallelo durante la
// ricerca repo (search), non la dimensione di un batch di lingue.
export const REPO_SEARCH_CONCURRENCY = 20;
const cache = { ts: 0, byLangId: {} };
let kvLoaded = false;

// Fetch con timeout (AbortController) riusando l'infrastruttura
// di github.js così lo stall GitHub NON può restare appeso all'infinito.
async function ghFetchWithTimeout(url, headers) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Esegue i task in batch di `size` elementi, così non lanciamo mai più di `size`
// fetch in parallelo (limita il picco di carico e il consumo dei rate-limit).
async function mapBatch(items, size, worker) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const settled = await Promise.all(
      slice.map((item, j) => worker(item, i + j))
    );
    settled.forEach((val, j) => {
      results[i + j] = val;
    });
  }
  return results;
}

async function loadFromKv() {
  if (!kvEnabled || kvLoaded) return;
  kvLoaded = true; // marchiamo come tentato anche in caso di timeout parziale
  // Leggiamo entrambi i tier in parallelo. Ogni lettura è incapsulata in un
  // catch: se Upstash è down/lento e kvGet LANCIA (non solo timeout→null),
  // l'errore NON deve propagarsi e rompere lo spin (R5). Un timeout su uno
  // non deve uccidere l'altro; il tier "lastgood" è il fallback tiered.
  const safeGet = (key) =>
    kvGet(key).catch((e) => {
      logger.warn('repos loadFromKv kvGet failed', { error: e?.message });
      return null;
    });
  const [fresh, lastgood] = await Promise.all([
    safeGet(KV_KEY),
    safeGet(KV_LASTGOOD_KEY),
  ]);
  if (fresh && fresh.ts && fresh.byLangId) {
    // Tier fresh (TTL 30m) ancora valido → usiamo quello.
    cache.ts = fresh.ts;
    cache.byLangId = fresh.byLangId;
  } else if (lastgood && lastgood.byLangId) {
    // Tier lastgood: dati semi-stale ma SEMPRE servibili. Non azzeriamo
    // cache.ts (resta = lastgood.ts) così la refresh gira in background
    // nel branch !fresh, mantenendo i repo disponibili nel frattempo.
    cache.ts = lastgood.ts || 0;
    cache.byLangId = lastgood.byLangId;
  }
}

function saveToKv() {
  if (!kvEnabled) return;
  // Fire-and-forget: non blocchiamo lo spin per il salvataggio della cache.
  // Scriviamo SIA il tier fresh (con TTL) SIA il tier lastgood (senza TTL,
  // R5) così i repo recenti restano sempre disponibili anche a cold start
  // e anche se Upstash è cross-region.
  kvSet(KV_KEY, { ts: cache.ts, byLangId: cache.byLangId }, Math.round(TTL_MS / 1000)).catch(
    () => {}
  );
  kvSet(KV_LASTGOOD_KEY, { ts: cache.ts, byLangId: cache.byLangId }).catch(() => {});
}

async function refreshCache(token, owner, languages) {
  const headers = ghHeaders(token);
  const r = await ghFetchWithTimeout(
    `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated&type=owner`,
    headers
  );
  if (!r.ok) throw new Error(`repos list: ${r.status}`);
  const repos = (await r.json()).filter((rep) => !rep.fork && !rep.archived);

  // Per ogni repo, fetch /languages a BATCH (cap pratico: 100 repo × 1 call,
  // ma mai più di REPO_SEARCH_CONCURRENCY in parallelo). Una fetch
  // lenta/piantata è protetta da AbortController (timeout).
  const langMaps = await mapBatch(repos, REPO_SEARCH_CONCURRENCY, async (rep) => {
    try {
      const lr = await ghFetchWithTimeout(rep.languages_url, headers);
      if (!lr.ok) return null;
      return await lr.json();
    } catch {
      return null;
    }
  });

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
      if (pct < 0.3) continue;
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
      if (
        !cur ||
        (!isProfile &&
          (pct > cur.pct || (pct === cur.pct && candidate.stars > cur.stars)))
      ) {
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
  const hasData = Object.keys(cache.byLangId).length > 0;
  const fresh = Date.now() - cache.ts < TTL_MS;

  if (!hasData) {
    // COLD START GENUINO: nessun dato in memoria né in KV (né fresh né
    // lastgood). È l'UNICO punto in cui attendiamo la rete, e lo facciamo
    // solo su GitHub (globale, veloce da qualsiasi regione Vercel) → NON
    // dipende da Upstash/Redis, quindi un DB cross-region NON fa più abortire
    // TUTTE le ricerche repo (R5). Se scade l'800ms ritorniamo subito (spesso
    // null → redirect al profilo), senza appenderci all'infinito.
    try {
      await Promise.race([
        refreshCache(token, owner, languages),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('cold-start timeout')),
            COLD_START_WAIT_MS
          )
        ),
      ]);
    } catch (e) {
      if (e.message !== 'cold-start timeout') {
        logger.warn('repos cache refresh failed', { error: e.message });
      }
    }
  } else if (!fresh) {
    // Abbiamo dati (memoria o KV lastgood) ma sono stale: li serviamo SUBITO
    // e refreschiamo in background. Mai bloccare il redirect su uno stall KV
    // o GitHub (R5: neanche un round-trip Upstash cross-region ci ferma).
    refreshCache(token, owner, languages).catch((e) =>
      logger.warn('repos cache refresh failed', { error: e.message })
    );
  }
  // Se hasData && fresh → serviamo immediatamente, nessuna refresh.
  return cache.byLangId[lang.id] || null;
}
