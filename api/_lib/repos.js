// Look-up cache per (linguaggio → repo casuale dell'owner con ≥30% di quel lang).
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
// (cache mai popolata, nessun lastgood) facciamo un breve await (1s) così il
// PRIMO spin ha già i repo se la rete risponde.

import { kvGet, kvSet, kvEnabled } from './kv.js';
import { GITHUB_API_TIMEOUT_MS, ghHeaders } from './github.js';
import { logger } from '../_lib/logger.js';
import { randomInt } from 'node:crypto';

// ─── Repo da NON usare MAI come destinazione di redirect (ISSUE) ────────────
// Uno spin vincente reindirizza l'utente verso un repo dell'owner che usa il
// linguaggio uscito per ≥30%. Due repo devono essere ESCLUSI dalla
// candidatura:
//   • il repo profilo (`<owner>/<owner>`, es. simrim96/simrim96) — contiene
//     solo il README, non è un progetto "reale" da mostrare;
//   • il repo della slot stessa (SLOT_REPO, es. GithubSlotMachine) — è un
//     progetto Node/JS/TS, quindi per vittorie su JavaScript/TypeScript/React
//     verrebbe selezionato come repo "migliore" e lo spin rimanderebbe
//     l'utente DENTRO il repo sorgente della slot. Da fuori sembra che la
//     leva "non abbia girato" e ti abbia solo rimbalzato su github.com:
//     è esattamente il bug "cliccando la leva a volte vengo reindirizzato
//     alla pagina github del progetto".
// Escludendoli a monte, la vittoria reindirizza a un repo qualificante reale
// oppure (nessun altro repo idoneo) cade sul profilo, mai dentro la slot.
export function isRepoExcluded(repName, owner, slotRepo) {
  const n = String(repName).toLowerCase();
  return (
    n === String(owner).toLowerCase() || n === String(slotRepo).toLowerCase()
  );
}

const TTL_MS = 1000 * 60 * 30; // 30 min
// Al cold start (cache mai popolata) aspettiamo al massimo questo timeout prima
// di arrenderci e ritornare null — così il PRIMO spin ha i repo se la rete
// risponde (ISSUE-28), senza però appenderci all'infinito sullo stall GitHub.
const COLD_START_WAIT_MS = 1000;
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
// Promise dell'eventuale loadFromKv in corso: i chiamanti concorrenti
// attendono la STESSA load invece di ripartire da zero (e rischiare di
// vederla non ancora completata → falso cold start → stall GitHub di 1s).
let kvLoadPromise = null;

// Popola la cache da KV al caricamento del modulo, per evitare stall GitHub
// al primo spin. Chiamata QUI, DOPO le dichiarazioni di `cache`/`kvLoaded`:
// prima stava in cima al file e lanciava "Cannot access 'kvLoaded' before
// initialization" (TDZ) a OGNI cold start → il preload non è mai partito.
loadFromKv().catch((e) =>
  logger.warn('repos loadFromKv on-init failed', { error: e.message })
);

// Fetch con timeout (AbortController) riusando l'infrastruttura
// di github.js così lo stall GitHub NON può restare appeso all'infinito.
async function ghFetchWithTimeout(url, headers) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);

    // 429 rate limit: log e fallisci subito (non blocca l'utente con 1-7s di attesa).
    if (r.status === 429) {
      logger.warn('GitHub rate limit hit on repos.js (429), failing fast', {
        url,
      });
      return r; // restituisce il 429 così il chiamante vede il codice di stato
    }
    return r;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      logger.warn('GitHub API timeout', {
        url,
        timeout: GITHUB_API_TIMEOUT_MS,
      });
    } else {
      logger.error('ghFetchWithTimeout ERROR', {
        url,
        name: error?.name,
        message: error?.message,
      });
    }
    throw error;
  }
}

// Esegue i task mantenendo sempre al massimo `size` worker attivi in parallelo.
// Un pool concorrente fa sì che non appena un worker finisce il suo task, ne
// prenda uno nuovo — così il throughput è sempre al massimo e non ci sono
// "golfi" tra un batch e l'altro. Limita il picco di carico e il consumo dei
// rate-limit.
async function mapBatch(items, size, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function workerLoop() {
    while (nextIndex < items.length) {
      const idx = nextIndex++; // atomico in JS single-threaded
      const result = await worker(items[idx], idx);
      results[idx] = result;
    }
  }

  const workers = Math.min(size, items.length);
  await Promise.all(Array.from({ length: workers }, () => workerLoop()));
  return results;
}

async function loadFromKv() {
  if (!kvEnabled || kvLoaded) return;
  // Dedup: se una load è già in corso (es. quella al caricamento del modulo),
  // i chiamanti successivi attendono la STESSA promise. Senza questo, il
  // primo getRepoForLanguage dopo un cold start poteva scattare PRIMA che la
  // load avesse popolato la cache e cascare nel falso cold start (stall
  // GitHub fino a 1s) pur avendo i repo in KV.
  if (kvLoadPromise) return kvLoadPromise;
  kvLoadPromise = (async () => {
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
      cache.byLangId = normalizeCacheShape(fresh.byLangId);
    } else if (lastgood && lastgood.byLangId) {
      // Tier lastgood: dati semi-stale ma SEMPRE servibili. Non azzeriamo
      // cache.ts (resta = lastgood.ts) così la refresh gira in background
      // nel branch !fresh, mantenendo i repo disponibili nel frattempo.
      cache.ts = lastgood.ts || 0;
      cache.byLangId = normalizeCacheShape(lastgood.byLangId);
    }
  })();
  return kvLoadPromise;
}

// Normalizza la cache letta da KV: il formato NUOVO conserva un ARRAY di
// candidati per linguaggio (selezione casuale), il formato VECCHIO un singolo
// oggetto (il "migliore"). Converte i vecchi valori singoli in array per
// retro-compatibilità con i dati KV già in produzione.
function normalizeCacheShape(byLangId) {
  const out = {};
  for (const [langId, value] of Object.entries(byLangId || {})) {
    out[langId] = Array.isArray(value) ? value : value ? [value] : [];
  }
  return out;
}

function saveToKv() {
  if (!kvEnabled) return;
  // Fire-and-forget: non blocchiamo lo spin per il salvataggio della cache.
  // Scriviamo SIA il tier fresh (con TTL) SIA il tier lastgood (senza TTL,
  // R5) così i repo recenti restano sempre disponibili anche a cold start
  // e anche se Upstash è cross-region.
  kvSet(
    KV_KEY,
    { ts: cache.ts, byLangId: cache.byLangId },
    Math.round(TTL_MS / 1000)
  ).catch(() => {});
  kvSet(KV_LASTGOOD_KEY, { ts: cache.ts, byLangId: cache.byLangId }).catch(
    () => {}
  );
}

async function refreshCache(token, owner, languages, slotRepo) {
  // I repo pubblici e i loro /languages sono leggibili ANCHE SENZA token
  // (rate-limit anonimo 60/h, più che sufficiente per pochi repo e refresh
  // ogni 30 min). Usiamo il token SOLO se presente, ma se la chiamata
  // autenticata fallisce (es. scope del PAT senza public_repo, o token
  // con soli permessi di lettura README) facciamo FALLBACK ANONIMO così la
  // cache repo si popola comunque e il link alla repo vincente appare.
  const authedHeaders = token ? ghHeaders(token) : {};
  const anonHeaders = { Accept: 'application/vnd.github+json' };

  async function fetchRepos(headers) {
    const r = await ghFetchWithTimeout(
      `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated&type=owner`,
      headers
    );
    if (!r.ok) throw new Error(`repos list: ${r.status}`);
    return (await r.json()).filter(
      (rep) =>
        !rep.fork && !rep.archived && !isRepoExcluded(rep.name, owner, slotRepo)
    );
  }

  let repos;
  try {
    repos = await fetchRepos(authedHeaders);
  } catch (e) {
    logger.warn('repos refresh authed failed, retry anon', {
      error: e.message,
    });
    repos = await fetchRepos(anonHeaders);
  }

  // Per ogni repo, fetch /languages a BATCH (cap pratico: 100 repo × 1 call,
  // ma mai più di REPO_SEARCH_CONCURRENCY in parallelo). Una fetch
  // lenta/piantata è protetta da AbortController (timeout).
  const langMaps = await mapBatch(
    repos,
    REPO_SEARCH_CONCURRENCY,
    async (rep) => {
      try {
        const lr = await ghFetchWithTimeout(rep.languages_url, authedHeaders);
        if (!lr.ok) return null;
        return await lr.json();
      } catch {
        return null;
      }
    }
  );

  // Per ogni linguaggio conserviamo TUTTI i repo qualificanti (≥30% + topic
  // ok): getRepoForLanguage ne pesca uno a caso. PRIMA si teneva solo il
  // "migliore" (pct più alta, poi stelle) → il link della vincita era sempre
  // lo stesso repo. Ora la vincita può linkare a uno qualsiasi dei repo che
  // contengono almeno il 30% del linguaggio vinto (richiesta utente).
  // (Il repo profilo / della slot sono già stati esclusi a monte in
  // refreshCache tramite isRepoExcluded, così non competono mai.)
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
      if (!byLangId[lang.id]) byLangId[lang.id] = [];
      byLangId[lang.id].push(candidate);
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

  // SLOT_REPO: il repo della slot stessa NON deve mai essere candidato come
  // destinazione di redirect (vedi isRepoExcluded + ISSUE sopra). Lo leggiamo
  // da env quando disponibile, altrimenti resta il default del codice.
  const slotRepo = process.env.SLOT_REPO || 'GithubSlotMachine';

  if (!hasData) {
    // COLD START GENUINO: nessun dato in memoria né in KV (né fresh né
    // lastgood). È l'UNICO punto in cui attendiamo la rete, e lo facciamo
    // solo su GitHub (globale, veloce da qualsiasi regione Vercel) → NON
    // dipende da Upstash/Redis, quindi un DB cross-region NON fa più abortire
    // TUTTE le ricerche repo (R5). Se scade l'800ms ritorniamo subito (spesso
    // null → redirect al profilo), senza appenderci all'infinito.
    try {
      await Promise.race([
        refreshCache(token, owner, languages, slotRepo),
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
    refreshCache(token, owner, languages, slotRepo).catch((e) =>
      logger.warn('repos cache refresh failed', { error: e.message })
    );
  }
  // Se hasData && fresh → serviamo immediatamente, nessuna refresh.
  // Selezione CASUALE tra i repo qualificanti (≥30% del linguaggio vinto):
  // la cache conserva un array di candidati per linguaggio e qui ne peschiamo
  // uno a caso. Difesa finale: se anche la cache (memoria/KV, magari popolata
  // prima della fix) contiene ancora il repo della slot o il repo profilo come
  // candidato, lo trattiamo come "nessun repo" → lo spin cade sul profilo
  // invece di rimandare dentro la slot stessa.
  const candidates = (cache.byLangId[lang.id] || []).filter(
    (c) => !isRepoExcluded(c.name, owner, slotRepo)
  );
  if (candidates.length === 0) return null;
  return candidates[randomInt(candidates.length)];
}

// Lettura diagnostica della cache SENZA triggerare refresh GitHub.
// Usata da /api/health?full=1: misura se la cache repo è calda (popolata,
// fresco) senza mai lanciare fetch a api.github.com. Questo evita che
// l'endpoint di health lasci fetch pendenti che, su Vercel, fanno crashare
// la lambda al cleanup con FUNCTION_INVOCATION_FAILED (500).
export async function getRepoCacheStats() {
  await loadFromKv();
  const langIds = Object.keys(cache.byLangId);
  const ageMs = cache.ts ? Date.now() - cache.ts : null;
  return {
    populated: langIds.length > 0,
    lang_count: langIds.length,
    ts: cache.ts || 0,
    age_ms: ageMs,
    fresh: ageMs !== null ? ageMs < TTL_MS : false,
  };
}
