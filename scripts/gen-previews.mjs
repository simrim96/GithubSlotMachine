// Genera slot_before.svg (versione corrente dei file) e slot_after.svg (modifiche
// di centraggio gia' applicate) a partire dallo stesso grid, cosi' il confronto
// e' 1:1 sulle sole coordinate.
import { buildSVG } from '../api/_lib/svg-builder.js';
import { LANGUAGES } from '../api/_lib/languages.js';
import { generateGrid } from '../api/_lib/game.js';
import { writeFileSync } from 'fs';

const grid = generateGrid();
const uid = 'x1';
const state = { totalSpins: 12345, totalWins: 678 };
const winningLang = LANGUAGES.find((l) => l.id === 'c') || LANGUAGES[0];
const fact = {
  en: 'The most recent C standard is C23 (2024): it introduces typeof, standard attributes',
  it: 'Lo standard C piu recente e C23 (2024): introduce typeof, attributi standard',
};

const svg = buildSVG({ grid, uid, state, winningLang, fact });
const out = process.argv[2];
writeFileSync(out, svg);
console.log('scritto', out, svg.length, 'bytes');
