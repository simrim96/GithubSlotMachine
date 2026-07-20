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

import { kvGet, kvSet, kvEnabled } from './kv.js';
import { ghGetContents, ghPut } from './github.js';
import { promises as fs } from 'fs';
import * as Sentry from '../../sentry.config.js';

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

let _syncFailureCount = 0;
let _alertRaised = false;

// Sentry è opzionale (il DSN può non essere configurato in dev/test):
// lo importiamo in modo dinamico/lazy così un'eventuale assenza del modulo
// non rompe lo spin. In spin.js Sentry è già usato, quindi è una dipendenza
// presente; qui lo carichiamo ma lo usiamo solo se il DSN è settato.
function reportStateSyncAlert(failures, lastError) {
  const msg =
    `[state] ALERT: sync Redis→GitHub fallito ${failures} volte di fila. ` +
    `Lo stato persistito su GitHub (state.json) NON si sta aggiornando. ` +
    `Ultimo errore: ${lastError || 'sconosciuto'}`;
  console.error(msg);
  // Best-effort: Sentry cattura l'evento come errore applicativo (solo se
  // il DSN è configurato; altrimenti captureMessage è un no-op silenzioso).
  try {
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage(msg, 'error');
    }
  } catch {
    /* Sentry non disponibile: il console.error sopra basta */
  }
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
    console.warn(
      `[state] sync Redis→GitHub ancora fallito (totale ${_syncFailureCount} consecutivi): ` +
        `${err?.message || err}`
    );
  }
}

function recordStateSyncSuccess() {
  if (_syncFailureCount !== 0 || _alertRaised) {
    console.log(
      `[state] sync Redis→GitHub recuperato dopo ${_syncFailureCount} ` +
        `fallimenti consecutivi — contatore azzerato.`
    );
  }
  _syncFailureCount = 0;
  _alertRaised = false;
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
    console.log(`[state] Migrated state from v1 to v2`);
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
// ISSUE-1: tutte le chiamate GitHub sono centralizzate in github.js (ghGet/ghPut)
// che applica già AbortController (timeout) e retry su 409.
// Niente più fetch diretti non protetti qui.
// ISSUE/R4: la lettura di state.json (percorso critico quando KV è disabilitato)
// usa ghGetContents() con timeout STRETTO (800ms, GH_CONTENTS_TIMEOUT_MS) così
// lo spin NON si appoggia per secondi interi se GitHub è lento: scaduto il
// timeout, readState() applica il fallback ai default e lo spin prosegue.
async function readStateGitHub(token, owner, repo) {
  const data = await ghGetContents(token, owner, repo, STATE_PATH);
  if (!data) return { state: { ...DEFAULTS }, sha: null };
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  } catch {
    parsed = {};
  }
  return { state: { ...DEFAULTS, ...parsed }, sha: data.sha };
}

async function writeStateGitHub(
  token,
  owner,
  repo,
  state,
  sha
) {
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
    // Assicurati che la version sia presente e incrementala
    const stateToSave = { ...state };
    if (stateToSave.version === undefined) {
      stateToSave.version = 1;
    }
    await kvSet(STATE_KEY, stateToSave);
    // Sync asincrono su GitHub per backup (non blocca lo spin).
    // Se fallisce, viene registrato dal monitor M4 (conteggio fallimenti
    // consecutivi + alert su Sentry/log quando supera la soglia) così ci si
    // accorge se lo stato persistito su GitHub smette di aggiornarsi.
    writeStateGitHub(token, owner, repo, stateToSave, _sha)
      .then(() => recordStateSyncSuccess())
      .catch((e) => {
        console.warn('Redis state sync to GitHub failed:', e.message);
        recordStateSyncFailure(e);
      });
    return;
  }
  // Se non c'è token, scrivi su /tmp (locale) invece che nel repo.
  if (!token) {
    await writeStateLocal(state);
    return;
  }
  return writeStateGitHub(token, owner, repo, state, _sha);
}

// ── Export del monitor M4 (per testabilità) ───────────────────────────────────
// Esposti per i test: permettono di verificare il conteggio dei fallimenti
// consecutivi e il sollevamento dell'alert senza dover chiamare GitHub reali.
export {
  recordStateSyncFailure,
  recordStateSyncSuccess,
  reportStateSyncAlert,
  STATE_SYNC_FAILURE_ALERT_THRESHOLD,
};
// Getter dello stato corrente del monitor (utile per assertions nei test).
export function getSyncFailureCount() {
  return _syncFailureCount;
}
export function isAlertRaised() {
  return _alertRaised;
}
