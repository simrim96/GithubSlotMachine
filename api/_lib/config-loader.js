// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG LOADER
//  Carica configurazioni esterne da file JSON.
//  Supporta:
//    - languages-external.json (linguaggi custom aggiuntivi)
//  Il loader cerca i file in ordine:
//    1. Root del progetto
//    2. Directory config/
//  Se nessun file esterno è trovato, ritorna oggetto vuoto.
//
//  VALIDAZIONE ENV (ISSUE-M4): validateEnv() controlla all'avvio che le
//  variabili d'ambiente critiche siano configurate e le segnala in warning.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { validate } from 'jsonschema';
// Sorgente unica dei prefissi PAT classic (ISSUE-N13): la stessa lista usata
// da detectTokenType() in github.js — qui NON va duplicata, o il rilevamento
// all'avvio divergerebbe da quello runtime.
import { CLASSIC_PAT_PREFIXES } from './github.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ── VALIDAZIONE ENV CRITICI (ISSUE-M4) ──────────────────────────────────────
// Campi obbligatori: il loro valore vuoto significa che la funzione fallirà
// comunque (API 401, Redis disconnesso), ma almeno non passa silenziosamente.
const REQUIRED_VARS = [
  {
    key: 'GITHUB_PAT',
    warnMsg:
      'GITHUB_PAT non impostato: le chiamate GitHub falliranno (401/404)',
  },
  {
    key: 'SLOT_OWNER',
    warnMsg: 'SLOT_OWNER non impostato: valore default "simrim96" usato',
  },
  {
    key: 'SLOT_REPO',
    warnMsg:
      'SLOT_REPO non impostato: valore default "GithubSlotMachine" usato',
  },
  // PROFILE_REPO ha default = SLOT_OWNER, quindi non è strettamente richiesto.
  // KV_REST_API_URL + KV_REST_API_TOKEN sono opzionali (fallback su GitHub API).
];

/**
 * Validazione all'avvio delle variabili d'ambiente critiche.
 * Emette logger.warn per ogni campo obbligatorio mancante.
 * Ritorna { valid: boolean, warnings: string[] }.
 */
export function validateEnv() {
  const warnings = [];

  for (const { key, warnMsg } of REQUIRED_VARS) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      logger.warn('ConfigLoader missing required env var', {
        key,
        fallback: warnMsg,
      });
      warnings.push(`${key}= (not set) — ${warnMsg}`);
    }
  }

  // Avvisa se sia GITHUB_PAT_REQUIRE_FINEGRAINED=true ma il PAT non è fine-grained.
  // Usa la stessa lista prefissi classic di detectTokenType() (github.js,
  // ISSUE-N13): un ghs_/ghr_/ghu_ deve essere segnalato all'avvio esattamente
  // come lo è a runtime da auditToken — niente sorprese a metà spin.
  const pat = process.env.GITHUB_PAT ?? '';
  const enforceFine = process.env.GITHUB_PAT_REQUIRE_FINEGRAINED ?? '';
  if (
    enforceFine === 'true' &&
    CLASSIC_PAT_PREFIXES.some((p) => pat.startsWith(p))
  ) {
    logger.warn(
      'ConfigLoader GITHUB_PAT_REQUIRE_FINEGRAINED=true ma PAT è classic',
      {
        key: 'GITHUB_PAT',
        prefix: pat.slice(0, 5) + '...',
      }
    );
    warnings.push(
      `GITHUB_PAT_REQUIRE_FINEGRAINED=true ma PAT rilevato come classic (${CLASSIC_PAT_PREFIXES.join(', ')})`
    );
  }

  return { valid: warnings.length === 0, warnings };
}

// Esegui validazione all'import (side-effect sicuro, solo logging).
validateEnv();

/**
 * JSON Schema per la validazione della configurazione languages.
 */
const LANGUAGE_SCHEMA = {
  type: 'object',
  properties: {
    languages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          short: { type: 'string', minLength: 1 },
          color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          accent: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          text: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
          githubLang: { type: 'string', minLength: 1 },
          topic: { type: 'string' },
          competence: { type: 'integer', minimum: 0, maximum: 5 },
          icon: { type: 'string' },
          facts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                it: { type: 'string' },
                en: { type: 'string' },
              },
            },
          },
        },
        required: [
          'id',
          'name',
          'short',
          'color',
          'accent',
          'text',
          'githubLang',
        ],
      },
    },
  },
  required: ['languages'],
};

/**
 * Valida l'intera configurazione languages contro lo schema JSON Schema.
 * @param {object} config - Oggetto configurazione con campo languages
 * @returns {object} { valid: boolean, errors: Array<string> }
 */
export function validateLanguagesSchema(config) {
  if (!config || typeof config !== 'object') {
    logger.warn('ConfigLoader invalid config type', { config });
    return { valid: false, errors: ['Config must be an object'] };
  }

  const result = validate(config, LANGUAGE_SCHEMA);

  if (!result.valid) {
    const errors = result.errors.map((err) => err.toString());
    logger.warn('ConfigLoader JSON schema validation failed', { errors });
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * Tenta di caricare un file JSON.
 * @param {string} filePath - Percorso assoluto al file JSON
 * @returns {object|null} Parsed JSON o null se non trovato/errore
 */
function loadJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    logger.warn('ConfigLoader JSON parse error', {
      path: filePath,
      error: err.message,
    });
    return null;
  }
}

/**
 * Cerca un file con estensione data in una lista di directory.
 * @param {string[]} dirs - Directory da cercare
 * @param {string[]} extensions - Estensioni da cercare (es. ['.json'])
 * @returns {string|null} Primo file trovato o null
 */
function findFile(dirs, extensions) {
  for (const dir of dirs) {
    for (const ext of extensions) {
      const path = join(dir, `languages-external${ext}`);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/**
 * Carica configurazioni esterne per i linguaggi.
 * Ritorna un array di oggetti linguaggio da appendere a LANGUAGES hardcoded.
 *
 * Schema JSON atteso:
 * ```json
 * {
 *   "languages": [
 *     {
 *       "id": "rust",
 *       "name": "Rust",
 *       "short": "Rust",
 *       "color": "#DEA584",
 *       "accent": "#F0C7A5",
 *       "text": "#ffffff",
 *       "githubLang": "Rust",
 *       "topic": "rust-lang",
 *       "competence": 3,
 *       "icon": "<svg>...</svg>",
 *       "facts": [
 *         { "it": "Fact in italiano", "en": "Fact in English" }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * @returns {Promise<Array>} Array di linguaggi esterni
 */
export async function loadExternalLanguages() {
  const searchDirs = [PROJECT_ROOT, join(PROJECT_ROOT, 'config')];
  const extensions = ['.json'];

  const filePath = findFile(searchDirs, extensions);
  if (!filePath) {
    return [];
  }

  logger.info('ConfigLoader loading external config', { path: filePath });

  const config = loadJSON(filePath);
  if (!config) {
    logger.warn('ConfigLoader failed to load/parse config', { path: filePath });
    return [];
  }

  // Validazione JSON schema
  const schemaValidation = validateLanguagesSchema(config);
  if (!schemaValidation.valid) {
    logger.error('ConfigLoader JSON schema validation failed', {
      path: filePath,
      errors: schemaValidation.errors,
    });
    return [];
  }

  if (config.languages) {
    return config.languages;
  }

  logger.warn('ConfigLoader file missing languages field', { path: filePath });
  return [];
}

/**
 * Validazione schema per un linguaggio esterno.
 * @param {object} lang - Oggetto linguaggio
 * @returns {boolean} true se valido
 */
export function validateLanguageSchema(lang) {
  const requiredFields = [
    'id',
    'name',
    'short',
    'color',
    'accent',
    'text',
    'githubLang',
  ];
  for (const field of requiredFields) {
    if (!lang[field]) {
      logger.warn('ConfigLoader missing required field', { field });
      return false;
    }
  }
  return true;
}

/**
 * Unisce configurazioni hardcoded + esterne.
 * @param {Array} hardcodedLanguages - Array di linguaggi hardcoded
 * @param {Array} externalLanguages - Array di linguaggi esterni
 * @returns {Array} Array unito (esterni dopo gli hardcoded, senza duplicati)
 */
export function mergeLanguages(hardcodedLanguages, externalLanguages) {
  const idSet = new Set(hardcodedLanguages.map((l) => l.id));
  const externalValid = externalLanguages.filter((lang) => {
    if (!validateLanguageSchema(lang)) return false;
    if (idSet.has(lang.id)) {
      logger.warn('ConfigLoader duplicate language ignored', {
        langId: lang.id,
      });
      return false;
    }
    return true;
  });

  return [...hardcodedLanguages, ...externalValid];
}
