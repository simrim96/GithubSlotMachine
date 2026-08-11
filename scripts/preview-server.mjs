// Minimal, dependency-free HTTP server to drive the E2E (Playwright) suite in
// CI without requiring `vercel dev` (which needs Vercel auth/token) or any
// network access.
//
// It serves:
//   GET /                     -> public/index.html (the real UI)
//   GET /api/image[?mode=...] -> a freshly built slot SVG via buildSVG()
//
// The SVG is produced by the project's own pure builder (api/_lib/svg-builder.js)
// so the E2E tests exercise the exact same rendering code that runs in production.
//
// Usage:  node scripts/preview-server.mjs [port]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

import { buildSVG } from '../api/_lib/svg-builder.js';
import {
  generateGrid,
  checkWins,
  winningLangId,
  SYMBOL_IDS,
} from '../api/_lib/game.js';
import { LANGUAGE_BY_ID } from '../api/_lib/languages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

// Pick a real language for the "win" rendering path so buildSVG gets a full
// winningLang object (name + accent are required by the panel module).
const sampleLang = LANGUAGE_BY_ID[SYMBOL_IDS.find((id) => LANGUAGE_BY_ID[id])];
const winningLang = sampleLang
  ? { ...sampleLang }
  : { id: 'python', name: 'Python', accent: '#3776ab', githubLang: 'Python' };

const repoMatch = {
  name: 'GithubSlotMachine',
  url: 'https://github.com/simrim96/GithubSlotMachine',
  pct: 0.62,
  description: 'Slot machine',
};
const fact = { en: 'A fun fact.', it: 'Un fatto divertente.' };

function buildSlotSvg() {
  const grid = generateGrid();
  const wins = checkWins(grid);
  const wlId = wins.length ? winningLangId(wins) : null;
  const wl = wlId && LANGUAGE_BY_ID[wlId] ? { ...LANGUAGE_BY_ID[wlId] } : null;
  const state = {
    totalSpins: 42,
    totalWins: wl ? 7 : 0,
    lastWin: wl ? wl.name : null,
  };
  return buildSVG({
    grid,
    uid: Date.now(),
    state,
    winningLang: wl,
    fact,
    repoMatch,
    owner: 'simrim96',
  });
}

// The current slot is PERSISTED between requests, exactly like production
// (where /api/spin rewrites slot.svg on GitHub and /api/image serves it back).
// This lets the TASK-2 e2e test genuinely assert that two consecutive spins
// produce two different slot SVGs — not just that /api/image is non-deterministic.
let currentSlotSvg = buildSlotSvg();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/image') {
      const svg = currentSlotSvg;
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(svg);
    }

    // /api/spin — simulates a real spin for the E2E preview.
    // In production this handler generates a fresh grid, rewrites slot.svg on
    // GitHub and then 302-redirects. Here (no GitHub token, no Vercel) we
    // regenerate the persisted slot so /api/image immediately serves the NEW
    // reels. The click handler in public/index.html does
    // window.location.assign('/api/spin'), so this route MUST exist (and change
    // the slot) for the "real spin" path to be exercisable.
    if (url.pathname === '/api/spin') {
      currentSlotSvg = buildSlotSvg(); // regenerate the persisted slot
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      return res.end();
    }

    // Static files from public/ (index.html, _spin-cooldown.js, _vercel/…):
    // il frontend fa import dinamico di _spin-cooldown.js, quindi senza
    // questa route il modulo non si carica (MIME text/html) e la leva non
    // si collega — i test E2E sullo spin falliscono.
    const ext = extname(url.pathname);
    if (ext && MIME[ext]) {
      const staticPath = join(ROOT, 'public', url.pathname);
      const data = await readFile(staticPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      return res.end(data);
    }

    // Default to index.html
    const filePath = join(ROOT, 'public', 'index.html');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Preview server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`[preview-server] listening on http://localhost:${PORT}`);
});
