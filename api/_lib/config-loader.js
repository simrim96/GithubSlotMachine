// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG LOADER
//  Carica configurazioni esterne da file JSON o YAML (se disponibile).
//  Supporta:
//    - languages-external.json (linguaggi custom aggiuntivi)
//    - languages-external.yaml / .yml (formato YAML alternativo)
//  Il loader cerca i file in ordine:
//    1. Root del progetto
//    2. Directory config/
//  Se nessun file esterno è trovato, ritorna oggetto vuoto.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

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
    console.warn(
      `[ConfigLoader] Errore nel parsing di ${filePath}:`,
      err.message
    );
    return null;
  }
}

/**
 * Tenta di caricare un file YAML (se yaml module disponibile).
 * @param {string} filePath - Percorso assoluto al file YAML
 * @returns {object|null} Parsed YAML o null se non trovato/errore/non supportato
 */
async function loadYAML(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    // Prova a usare yaml package (se installato)
    const yaml = await import('yaml');
    const content = readFileSync(filePath, 'utf-8');
    return yaml.parse(content);
  } catch (err) {
    // yaml package non installato, ignora
    return null;
  }
}

/**
 * Cerca un file con estensione data in una lista di directory.
 * @param {string[]} dirs - Directory da cercare
 * @param {string[]} extensions - Estensioni da cercare (es. ['.json', '.yaml'])
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
  const extensions = ['.json', '.yaml', '.yml'];

  const filePath = findFile(searchDirs, extensions);
  if (!filePath) {
    return [];
  }

  console.log(`[ConfigLoader] Caricamento config esterna: ${filePath}`);

  // Prova prima JSON
  let config = loadJSON(filePath);
  if (config && config.languages) {
    return config.languages;
  }

  // Se JSON non ha languages, prova YAML
  if (!filePath.endsWith('.json')) {
    config = await loadYAML(filePath);
    if (config && config.languages) {
      return config.languages;
    }
  }

  console.warn(
    `[ConfigLoader] File ${filePath} trovato ma non contiene campo 'languages'`
  );
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
      console.warn(`[ConfigLoader] Campo richiesto mancante: ${field}`);
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
      console.warn(`[ConfigLoader] Lingua duplicata ignorata: ${lang.id}`);
      return false;
    }
    return true;
  });

  return [...hardcodedLanguages, ...externalValid];
}
