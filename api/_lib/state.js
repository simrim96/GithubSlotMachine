// Persistenza dello stato della community (contatore spin + last win).
//
// Priorità: Upstash Redis (veloce, same-region ~10ms, nessuno spam nella git
// history). Fallback: scrittura remota su state.json nel repo della slot via
// GitHub Contents API (usata solo se Redis non è configurato E GITHUB_PAT è
// presente). In locale/dev (senza token), lo stato viene scritto su
// /tmp/GithubSlotMachine_state.json per non inquinare la git history.
// NOTA: non esiste alcuna lettura/scrittura di state.json dal filesystem
// locale del repo (vedi ISSUE-7 — qualsiasi copia locale è un artefatto).
//
// Tutte le chiamate KV passano dai wrapper con timeout in kv.js, così Redis
// lento/cross-region non blocca mai lo spin.

import { kvGet, kvSet, kvEnabled, kvIncr } from './kv.js';
import { ghGetContentsJson, ghPut } from './github.js';
import { promises as fsp } from 'fs';
import { logger } from '../_lib/logger.js';

// ── Monitoring del sync Redis→GitHub (Miglioramento M4, ISSUES.md) ───────────
// Lo stato vivo risiede in Redis (kvSet, ~10ms). Per avere un backup
// leggibile da umani e resiliente a un'eventuale perdita di Redis, ogni
// writeState() fa anche un sync asincrono su state.json nel repo via
// GitHub Contents API. Quel sync è volutamente fire-and-forget (non blocca
// lo spin), ma se fallisce ripetutamente in modo silenzioso non ce ne
// accorgiamo: lo stato "ufficiale" persistito smette di aggiornarsi mentre
// Redis continua a crescere, e a un certo punto il backup su GitHub resta
// fermo a una vecchia snapshot.
//
// Qui teniamo un contatore di *fallimenti consecutivi* a livello di modulo.
// Ogni volta che lo sync GitHub fallisce lo incrementiamo; al primo successo
// lo azzeriamo. Quando supera la soglia STATE_SYNC_FAILURE_ALERT_THRESHOLD
// emettiamo un alert esplicito (log + Sentry) una sola volta, così chi
// monitora i log/Sentry vede subito che lo stato non si sta salvando su
// GitHub. Usiamo un flag `_alertRaised` per non inondare Sentry a ogni spin.
const STATE_SYNC_FAILURE_ALERT_THRESHOLD =
  parseInt(process.env.STATE_SYNC_FAILURE_ALERT_THRESHOLD) || 5;

// ── R2: retry + backoff sul sync Redis→GitHub (ISSUES.md §3) ────────────────
// Il sync su state.json era fire-and-forget senza retry: se GitHub era down
// a lungo, state.json divergeva permanentemente dallo stato vivo (Redis)
// senza possibilità di recupero. Ora il sync ritenta fino a
// STATE_SYNC_MAX_RETRIES volte con backoff esponenziale. Se anche l'ultimo
// tentativo fallisce, marciamo lo stato come "stale" (persistito in KV o, in
// fallback, su /tmp) così il *prossimo* sync riuscito scrive un campo
// `"stale": true` nel body di state.json, segnalando al frontend/profilo
// che c'è stata una divergenza temporanea.
const STATE_SYNC_MAX_RETRIES =
  parseInt(process.env.STATE_SYNC_MAX_RETRIES) || 3;
// Backoff esponenziale: tentativo n → attesa STATE_SYNC_BACKOFF_BASE_MS * 2^n.
// Default 200ms → 200, 400, 800ms (≈1.4s totali al massimo).
const STATE_SYNC_BACKOFF_BASE_MS =
  parseInt(process.env.STATE_SYNC_BACKOFF_BASE_MS) || 200;

// Marker di stale persistito su /tmp quando KV non è disponibile.
const STATE_STALE_MARKER_LOCAL = '/tmp/GithubSlotMachine_state.stale';
// Chiave KV per il marker di stale (fonte di verità preferita, sopravvive al
// riavvio dell'istanza serverless).
const STATE_STALE_KV_KEY = 'gsm:stateStale';

let _syncFailureCount = 0;
let _alertRaised = false;
// Flag di stale a livello di modulo: true se l'ultimo sync GitHub ha fallito
// in modo persistente. Viene azzerato al primo sync riuscito.
let _stateStale = false;

// Carica il flag di stale da KV (preferito) o dal marker /tmp (fallback).
// Chiamato all'inizio di ogni sync così lo stato sopravvive ai riavvii.
async function loadStaleFlag() {
  if (_stateStale) return; // già marcato in memoria
  try {
    if (kvEnabled) {
      const v = await kvGet(STATE_STALE_KV_KEY);
      if (v === '1') {
        _stateStale = true;
        return;
      }
    }
  } catch {
    /* KV non disponibile: prosegui col fallback /tmp */
  }
  try {
    await fsp.access(STATE_STALE_MARKER_LOCAL);
    _stateStale = true;
  } catch {
    /* nessun marker: stato non stale */
  }
}

// Persiste il flag di stale (KV + /tmp) così resta valido tra i riavvii.
async function persistStaleFlag(value) {
  _stateStale = value;
  if (kvEnabled) {
    try {
      await kvSet(STATE_STALE_KV_KEY, value ? '1' : '0');
    } catch {
      /* KV non scrivibile: il /tmp fallback basta per il segnale */
    }
  }
  try {
    if (value) {
      await fsp.writeFile(STATE_STALE_MARKER_LOCAL, String(Date.now()));
    } else {
      await fsp.rm(STATE_STALE_MARKER_LOCAL, { force: true });
    }
  } catch {
    /* /tmp non scrivibile: il flag in memoria resta valido per il processo */
  }
}

// Sentry è opzionale (il DSN può non essere configurato in dev/test):
// lo importiamo in modo dinamico/lazy così un'eventuale assenza del modulo
// non rompe lo spin. In spin.js Sentry è già usato, quindi è una dipendenza
// presente; qui lo carichiamo ma lo usiamo solo se il DSN è settato.
function reportStateSyncAlert(failures, lastError) {
  const msg =
    `[state] ALERT: sync Redis→GitHub fallito ${failures} volte di fila. ` +
    `Lo stato persistito su GitHub (state.json) NON si sta aggiornando. ` +
    `Ultimo errore: ${lastError || 'sconosciuto'}`;
  logger.error(msg);
  // Sentry integration handled by logger
}

function recordStateSyncFailure(err) {
  _syncFailureCount += 1;
  if (
    !_alertRaised &&
    _syncFailureCount >= STATE_SYNC_FAILURE_ALERT_THRESHOLD
  ) {
    _alertRaised = true;
    reportStateSyncAlert(_syncFailureCount, err?.message || String(err));
  } else if (_alertRaised) {
    // Continuiamo a loggare (a livello warn, meno rumoroso) finché l'alert
    // è già stato sollevato, così chi guarda i log vede la persistenza.
    logger.warn('state sync Redis→GitHub failed', { consecutive_failures: _syncFailureCount, error: err?.message || err });
  }
}

function recordStateSyncSuccess() {
  if (_syncFailureCount !== 0 || _alertRaised) {
    logger.info('state sync Redis→GitHub recovered', { consecutive_failures: _syncFailureCount });
  }
  _syncFailureCount = 0;
  _alertRaised = false;
  // R2: se eravamo in stato stale (sync fallito in modo persistente in
  // precedenza), un sync riuscito significa che la divergenza è risolta:
  // abbassiamo il flag così il prossimo writeState NON rimarcherà più
  // state.json come stale.
  if (_stateStale) {
    logger.info('state sync Redis→GitHub recovered after stale period');
    persistStaleFlag(false);
  }
}

// R2: sync con retry + backoff esponenziale verso GitHub (state.json).
// Ritorna true se ALMENO uno dei tentativi è andato a buon fine, false se
// tutti i STATE_SYNC_MAX_RETRIES tentativi sono falliti (in tal caso il
// chiamante marca lo stato come stale). Non lancia mai: gli errori sono
// catturati e conteggiati dal monitor M4 (fallimenti consecutivi + alert).
async function syncStateToGitHub(token, owner, repo, state, sha) {
  await loadStaleFlag();
  let lastErr;
  for (let attempt = 0; attempt < STATE_SYNC_MAX_RETRIES; attempt++) {
    try {
      // Se siamo in stato stale, scriviamo il campo "stale": true nel body
      // così chi legge state.json (frontend/profilo) sa che c'è stata una
      // divergenza temporanea che è stata recuperata.
      const stateToSync = _stateStale ? { ...state, stale: true } : state;
      await writeStateGitHub(token, owner, repo, stateToSync, sha);
      // Sync riuscito: la divergenza è risolta. Azzeriamo il flag stale
      // DOPO la scrittura, così questo body porta ancora "stale": true (per
      // segnalare il recupero) ma i sync successivi non lo rimarcheranno.
      await persistStaleFlag(false);
      return true;
    } catch (err) {
      lastErr = err;
      logger.warn('state sync Redis→GitHub attempt failed', { attempt: attempt + 1, max_retries: STATE_SYNC_MAX_RETRIES, error: err?.message || err });
      if (attempt < STATE_SYNC_MAX_RETRIES - 1) {
        const delay = STATE_SYNC_BACKOFF_BASE_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  // Tutti i tentativi falliti: marca lo stato come stale in modo persistente
  // (sopravvive ai riavvii) così il prossimo sync riuscito segnalerà
  // "stale": true nel body.
  await persistStaleFlag(true);
  recordStateSyncFailure(lastErr);
  return false;
}

const STATE_KEY = 'gsm:state';
const STATE_PATH = 'state.json';
const TMP_STATE_PATH = '/tmp/GithubSlotMachine_state.json';

// Versione attuale dello schema di stato
export const STATE_VERSION = 2;

const DEFAULTS = {
  totalSpins: 0,
  totalWins: 0,
  lastWin: null, // { langId, langName, fact, repoUrl, repoName, ts }
  version: STATE_VERSION,
  // v2 fields:
  settings: {
    theme: 'auto', // 'auto' | 'light' | 'dark'
    sound: true,
  },
  stats: {
    longestStreak: 0,
    currentStreak: 0,
    winsByLang: {}, // { python: 10, rust: 5, ... }
  },
};

// ── Migration System ───────────────────────────────────────────────────────────
// Multi-version state migration framework
// Supporta migrazioni da qualsiasi versione a quella corrente
const MIGRATIONS = {
  1: (state) => {
    const migrated = {
      ...state,
      version: 2,
      settings: {
        theme: 'auto',
        sound: true,
      },
      stats: {
        longestStreak: 0,
        currentStreak: 0,
        winsByLang: {},
      },
    };
    logger.info('state migrated from v1 to v2');
    return migrated;
  },
};

/**
 * Migrate state from any version to the current version
 * @param {Object} state - Current state object
 * @param {number} fromVersion - Starting version (default: inferred from state)
 * @returns {Object} Migrated state at current STATE_VERSION
 * @throws {Error} If no migration path exists for a version step
 */
export function migrateState(state, fromVersion) {
  const startVersion = state.version || fromVersion || 1;
  let result = { ...state };

  // Loop attraverso tutte le versioni intermedie fino alla corrente.
  // IMPORTANTE (ISSUE-1): usiamo un indice esplicito `v` che avanza a ogni
  // step. La migrazione aggiorna `result.version`, ma avanziamo `v`
  // esplicitamente per evitare il loop infinito causato dal non-incremento
  // di `currentVersion` (bug originario). `v = result.version || v + 1`
  // gestisce sia le migrazioni che settano la versione, sia quelle che
  // non la settano (fallback +1).
  let v = startVersion;
  while (v < STATE_VERSION) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      throw new Error(
        `No migration defined for version ${v} → ${v + 1}. ` +
          `Please implement MIGRATIONS[${v}] in state.js`
      );
    }

    result = migration(result);
    v = result.version || v + 1;
  }

  return result;
}

// ── Local fallback (senza git spam) ───────────────────────────────────────────
// Se GITHUB_PAT non è configurato, evitiamo di scrivere nello repo della slot.
// Scriviamo su /tmp/... che non viene committato.
async function readStateLocal() {
  try {
    const raw = await fsp.readFile(TMP_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { state: { ...DEFAULTS, ...parsed }, sha: null };
  } catch {
    return { state: { ...DEFAULTS }, sha: null };
  }
}

async function writeStateLocal(state) {
  try {
    const encoded = JSON.stringify(state, null, 2);
    await fsp.writeFile(TMP_STATE_PATH, encoded);
  } catch {
    // ignora: non possiamo salvare, ma lo spin continua lo stesso
  }
}

// ── Fallback GitHub ───────────────────────────────────────────────────────────
// ISSUE-1: tutte le chiamate GitHub sono centralizzate in github.js (ghGetJson/ghPut)
// che applica già AbortController (timeout) e retry su 409.
// Niente più fetch diretti non protetti qui.
// ISSUE/R4: la lettura di state.json (percorso critico quando KV è disabilitato)
// usa ghGetContentsJson() con timeout STRETTO (800ms, GH_CONTENTS_TIMEOUT_MS) così
// lo spin NON si appoggia per secondi interi se GitHub è lento: scaduto il
// timeout, readState() applica il fallback ai default e lo spin prosegue.
async function readStateGitHub(token, owner, repo) {
  const data = await ghGetContentsJson(token, owner, repo, STATE_PATH);
  if (!data) return { state: { ...DEFAULTS }, sha: null };
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  } catch {
    parsed = {};
  }
  return { state: { ...DEFAULTS, ...parsed }, sha: data.sha };
}

async function writeStateGitHub(token, owner, repo, state, sha) {
  const encoded = JSON.stringify(state, null, 2);
  await ghPut(
    token,
    owner,
    repo,
    STATE_PATH,
    encoded,
    sha,
    '🎰 Update slot stats'
  );
}

// ── API pubblica ───────────────────────────────────────────────────────────────
export async function readState(token, owner, repo) {
  if (kvEnabled) {
    const state = await kvGet(STATE_KEY);
    if (state) {
      // Esegui la migrazione se necessario
      const currentVersion = state.version || 1;
      if (currentVersion < STATE_VERSION) {
        const migrated = migrateState(state, currentVersion);
        // Salva lo stato migrato in KV
        await kvSet(STATE_KEY, migrated);
        return { state: migrated, sha: null };
      }
      // Assicurati che la version sia presente
      if (state.version === undefined) {
        state.version = 1;
      }
      return { state: { ...DEFAULTS, ...state }, sha: null };
    }
    // Primo avvio (o KV vuoto/timeout): importa lo storico da GitHub per non
    // perderlo, poi seed-a KV. Se anche GitHub fallisce, torniamo ai default.
    const gh = await readStateGitHub(token, owner, repo).catch(() => null);
    if (gh) {
      // Migrate se necessario prima di salvare in KV
      let stateToSeed = { ...gh.state };
      if (stateToSeed.version === undefined) {
        stateToSeed.version = 1;
      }
      if (stateToSeed.version < STATE_VERSION) {
        stateToSeed = migrateState(stateToSeed, stateToSeed.version);
      }
      await kvSet(STATE_KEY, stateToSeed);
      return { state: stateToSeed, sha: null };
    }
    return { state: { ...DEFAULTS }, sha: null };
  }
  // Se Redis non è attivo, usa GitHub solo se c'è un token valido (dev/prod).
  // Altrimenti, usa il fallback locale (nessun git spam).
  if (!token) {
    const res = await readStateLocal();
    // Migrazione per state locale
    if (res.state.version < STATE_VERSION) {
      res.state = migrateState(res.state, res.state.version);
    }
    return res;
  }
  const res = await readStateGitHub(token, owner, repo);
  // Migrazione per state GitHub
  if (res.state.version < STATE_VERSION) {
    res.state = migrateState(res.state, res.state.version);
  }
  return res;
}

export async function writeState(token, owner, repo, state, _sha) {
  if (kvEnabled) {
    // Assicurati che la version sia presente
    const stateToSave = { ...state };
    if (stateToSave.version === undefined) {
      stateToSave.version = 1;
    }
    
    // ISSUE-4 fix: usa operazioni ATOMICHE INCR per evitare race condition
    // Quando due spin arrivano contemporaneamente, se usassimo "leggi->
    // incrementa->scrivi", entrambi leggerebbero lo stesso valore,
    // incrementerebbero, e il secondo sovrascriverebbe il primo.
    // Usando INCR di Redis (atomica), ogni incremento è indipendente.
    //
    // Approccio:
    // 1. Incrementa atomicamente i contatori con INCR (ritorna il NUOVO valore)
    // 2. Usa i valori restituiti da INCR direttamente, senza leggere-
    //    modificare-scrivere separato
    // 3. NON fare kvSet separato: l'INCR è già la scrittura atomica
    try {
      // INCR è ATOMICO: nessun'altra richiesta può modificare il contatore
      // mentre questo incremento è in corso
      const newTotalSpins = await kvIncr('gsm:counter:spins');
      const newTotalWins = await kvIncr('gsm:counter:wins');
      
      // Aggiorna lo stato con i valori RESTITUITI da INCR
      // (NON usare lo stato precedente come base)
      stateToSave.totalSpins = newTotalSpins ?? 0;
      stateToSave.totalWins = newTotalWins ?? 0;
      
      // Scrivi lo stato completo (usa mset per atomicità su più chiavi)
      // Se mset non è disponibile, INCR su contatori separati + mset su stato
      // è sufficiente per evitare race condition
      await kvSet(STATE_KEY, stateToSave);
    } catch (err) {
      // Fallback: se INCR fallisce, usa il vecchio comportamento
      logger.warn('atomic counter increment failed, fallback to normal write', {
        error: err?.message || err,
      });
      await kvSet(STATE_KEY, stateToSave);
    }
    
    // Sync asincrono su GitHub per backup (non blocca lo spin).
    // R2: ora con retry + backoff esponenziale (syncStateToGitHub). Se tutti
    // i tentativi falliscono, lo stato viene marcato "stale" (persistito) e
    // il prossimo sync riuscito scriverà "stale": true nel body. Il monitor
    // M4 continua a contare i fallimenti consecutivi + alert Sentry/log.
    syncStateToGitHub(token, owner, repo, stateToSave, _sha)
      .then((ok) => {
        if (ok) recordStateSyncSuccess();
      })
      .catch((e) => {
        logger.warn('Redis state sync to GitHub failed', { error: e.message });
        recordStateSyncFailure(e);
      });
    return;
  }
  // Se non c'è token, scrivi su /tmp (locale) invece che nel repo.
  if (!token) {
    await writeStateLocal(state);
    return;
  }
  // Percorso senza KV (solo GitHub): applichiamo la stessa resilienza R2
  // (retry + backoff); se fallisce marciamo stale e registriamo il fallimento.
  const ok = await syncStateToGitHub(token, owner, repo, state, _sha);
  if (ok) recordStateSyncSuccess();
}

// ── Export del monitor M4 (per testabilità) ───────────────────────────────────
// Esposti per i test: permettono di verificare il conteggio dei fallimenti
// consecutivi e il sollevamento dell'alert senza dover chiamare GitHub reali.
export {
  recordStateSyncFailure,
  recordStateSyncSuccess,
  reportStateSyncAlert,
  syncStateToGitHub,
  persistStaleFlag,
  loadStaleFlag,
  STATE_SYNC_FAILURE_ALERT_THRESHOLD,
  STATE_SYNC_MAX_RETRIES,
  STATE_SYNC_BACKOFF_BASE_MS,
  STATE_STALE_KV_KEY,
  STATE_STALE_MARKER_LOCAL,
};
// Getter dello stato corrente del monitor (utile per assertions nei test).
export function getSyncFailureCount() {
  return _syncFailureCount;
}
export function isAlertRaised() {
  return _alertRaised;
}
// Getter del flag stale (utile per assertions nei test R2).
export function isStateStale() {
  return _stateStale;
}
