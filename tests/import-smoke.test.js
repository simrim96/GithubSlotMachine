// Smoke test di import (ISSUE "Miglioramenti" #1).
// Verifica che ogni modulo serverless e _lib si importi senza errori a
// livello di modulo (sintassi, import circolari, export mancanti). Un
// `node -e "import(...)"` fallito qui darebbe feedback immediato su rotture
// di modulo prima ancora di arrivare ai test funzionali o al deploy.
//
// Nota: alcuni moduli leggono process.env a livello top-level (es. kv.js,
// spin.js, health.js) ma NON lanciano se le env sono assenti — si limitano a
// disabilitare il percorso Redis o a usare valori di default. Lo smoke test
// gira quindi senza bisogno di alcuna env configurata.

const MODULES = [
  // Entry-point serverless (Vercel functions)
  '../api/spin.js',
  '../api/image.js',
  '../api/health.js',
  '../api/lever.js',
  '../api/ratelimit-status.js',
  // Libreria condivisa (_lib)
  '../api/_lib/github.js',
  '../api/_lib/repos.js',
  '../api/_lib/kv.js',
  '../api/_lib/game.js',
  '../api/_lib/languages.js',
  '../api/_lib/state.js',
  '../api/_lib/ratelimit.js',
  '../api/_lib/ratelimit-tracker.js',
  '../api/_lib/config-loader.js',
  '../api/_lib/svg-builder.js',
  '../api/_lib/svg-builder-accessible.js',
  // Sotto-moduli SVG
  '../api/_lib/svg/css.js',
  '../api/_lib/svg/analysis.js',
  '../api/_lib/svg/paytable.js',
  '../api/_lib/svg/coordinates.js',
  '../api/_lib/svg/screen.js',
  '../api/_lib/svg/panel.js',
  '../api/_lib/svg/effects-helpers.js',
  '../api/_lib/svg/reels.js',
  '../api/_lib/svg/effects.js',
  '../api/_lib/svg/defs.js',
  '../api/_lib/svg/marquee.js',
  '../api/_lib/svg/utils.js',
  '../api/_lib/svg/header.js',
  '../api/_lib/svg/cabinet.js',
  '../api/_lib/svg/constants.js',
];

describe('smoke test di import dei moduli', () => {
  it.each(MODULES)('importa senza errori: %s', async (mod) => {
    await expect(import(mod)).resolves.toBeDefined();
  });
});
