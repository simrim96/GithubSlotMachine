// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG LOADER
//  Carica configurazioni esterne da file JSON.
//  Supporta:
//    - languages-external.json (linguaggi custom aggiuntivi)
//  Il loader cerca i file in ordine:
//    1. Root del progetto
//    2. Directory config/
//  Se nessun file esterno è trovato, ritorna oggetto vuoto.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { validate } from 'jsonschema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

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
        required: ['id', 'name', 'short', 'color', 'accent', 'text', 'githubLang'],
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
    logger.warn('ConfigLoader JSON parse error', { path: filePath, error: err.message });
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
      logger.warn('ConfigLoader duplicate language ignored', { langId: lang.id });
      return false;
    }
    return true;
  });

  return [...hardcodedLanguages, ...externalValid];
}
