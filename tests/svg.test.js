// Test sulla generazione SVG (buildSVG) — verifica FORMA e struttura, non i
// valori casuali dei filler/coins. Usa griglie costruite a mano per coprire
// i casi win / no-win.
// NOTA: jackpot e near-miss sono stati RIMOSSI (su richiesta). Ogni
// vincita è "normale", il rullo gira normalmente.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSVG, clearCache } from '../api/_lib/svg-builder.js';
import {
  checkWins,
  COLS,
  ROWS,
  SYMBOL_IDS,
  SCATTER_ID,
} from '../api/_lib/game.js';

// Griglia vuota (tutti scatter) — nessuna win.
function emptyGrid() {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = SCATTER_ID;
  }
  return g;
}

// Forza 3 linguaggi uguali (count=3) sulla payline centrale → win garantita.
function winGrid(langId) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c <= 2; c++) g[c][pl[c]] = langId;
  // rompi colonne 3-4 con un simbolo diverso (no jackpot)
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[3][pl[3]] = other;
  g[4][pl[4]] = other;
  return g;
}

const state = { totalSpins: 42, totalWins: 7, lastWin: null };
const winningLang = {
  id: SYMBOL_IDS[0],
  name: 'Python',
  accent: '#3776ab',
  githubLang: 'Python',
};
const fact = { en: 'Fact about Python', it: 'Fatto su Python' };
// repoMatch NON viene più passato alla buildSVG: il link alla repo vive
// esclusivamente nel README del profilo (github.js), non nell'SVG.
const repoMatch = {
  name: 'myproj',
  url: 'https://github.com/simrim96/myproj',
  pct: 0.6,
  description: 'd',
};

describe('buildSVG — forma', () => {
  beforeEach(() => {
    clearCache();
  });

  it('restituisce un <svg> ben formato', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    // L'SVG ha un preamble XML prima del tag <svg>
    expect(svg.match(/<\?xml[^?]*\?>/)).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('dichiara le dimensioni 600x624', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    expect(svg).toContain('width="600"');
    expect(svg).toContain('height="624"');
  });

  it('contiene i 5 rulli (clip-path cp1c0..4)', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    for (let c = 0; c < COLS; c++) expect(svg).toContain(`cp1c${c}`);
  });

  it('non lascia undefined nel markup', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 1,
      state,
      winningLang: null,
      fact,
    });
    expect(svg).not.toContain('undefined');
  });
});

describe('buildSVG — casi di gioco', () => {
  beforeEach(() => {
    clearCache();
  });

  it('win: mostra la payline vincente e il pannello linguaggio', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    expect(checkWins(grid).length).toBeGreaterThan(0);
    const svg = buildSVG({ grid, uid: 2, state, winningLang, fact });
    expect(svg).toContain('Python WIN!');
    expect(svg).toContain('Python'); // paytable language name
    // NESSUN overlay jackpot
    expect(svg).not.toContain('JACKPOT');
  });

  it('no-win: messaggio generico (nessun near-miss)', () => {
    const grid = emptyGrid();
    const svg = buildSVG({
      grid,
      uid: 5,
      state,
      winningLang: null,
      fact,
    });
    expect(svg).toContain('Try again, better luck next time!');
    // NESSUN messaggio near-miss
    expect(svg).not.toContain('So close');
    expect(svg).not.toContain('JACKPOT');
    // NESSUNA animazione near-miss (nm shine)
    expect(svg).not.toContain('nm5');
  });

  it("NON contiene alcun link/testo repo nell'SVG (il link vive nel README)", () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({
      grid,
      uid: 6,
      state,
      winningLang,
      fact,
      owner: 'octocat',
    });
    // Il link alla repo NON deve comparire mai nell'SVG (non è cliccabile).
    expect(svg).not.toContain('github.com/octocat/myproj');
    expect(svg).not.toContain('myproj');
    expect(svg).not.toContain('check my work in');
  });
});

describe('buildSVG — counter WINS ritardato (non rivela la vincita prima della fine rotazione)', () => {
  beforeEach(() => {
    clearCache();
  });

  it('win: durante la rotazione mostra il valore PRECEDENTE, poi anima al nuovo a ED', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    expect(checkWins(grid).length).toBeGreaterThan(0);
    // state.totalWins=7 è il valore GIÀ incrementato (spin.js incrementa
    // prima di buildSVG): l'header deve mostrare 6 durante lo spin e
    // animare verso 7 solo a rotazione terminata (ED=6.6s per DUR=6.2s).
    const svg = buildSVG({ grid, uid: 2, state, winningLang, fact });

    // Valore precedente presente nel markup
    expect(svg).toContain('>6<');
    // ...ma ha opacity:0 di BASE (fallback statico = valore nuovo) ed è
    // reso visibile solo dal backwards-fill di co durante il delay fino a
    // ED (fine rotazione): animation-fill-mode:both.
    expect(svg).toContain('opacity:0;animation:co2 .5s 6.60s both');
    // Nuovo valore presente, opacity:1 di BASE (fallback statico corretto)
    // e nascosto da 0→ED+0.06 dal backwards-fill di ci
    expect(svg).toContain('opacity:1;animation:ci2 .5s 6.66s both');
    expect(svg).toContain('>7<');
    // Le keyframes del counter esistono
    expect(svg).toContain('@keyframes co2');
    expect(svg).toContain('@keyframes ci2');
  });

  it('win: fallback statico (rendering senza animazioni CSS) mostra il valore NUOVO', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({ grid, uid: 9, state, winningLang, fact });
    // In un rendering statico (anteprima GitHub, screenshot, img senza
    // animazioni) le animazioni non partono: resta visibile solo ciò che
    // ha opacity di base 1 → il valore NUOVO (7), mai il decrementato (6).
    expect(svg).toContain('>7<');
    expect(svg).toContain('opacity:0;animation:co9');
    expect(svg).toContain('opacity:1;animation:ci9');
  });

  it('no-win: counter statico, nessuna animazione co/ci', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 5,
      state,
      winningLang: null,
      fact,
    });
    // Valore corrente mostrato normalmente
    expect(svg).toContain('>7<');
    // Nessuna animazione di counter ritardato
    expect(svg).not.toContain('animation:co5');
    expect(svg).not.toContain('animation:ci5');
    expect(svg).not.toContain('@keyframes co5');
    expect(svg).not.toContain('@keyframes ci5');
  });
});

describe('buildSVG — header: contatori centrati sotto la propria etichetta', () => {
  beforeEach(() => {
    clearCache();
  });

  it('etichette ai bordi (design originale), valori centrati in corrispondenza', () => {
    const svg = buildSVG({
      grid: emptyGrid(),
      uid: 3,
      state,
      winningLang: null,
      fact,
    });

    // Etichette ancorate ai bordi, INVARIATE rispetto al design originale:
    // COMMUNITY SPINS a sinistra (x=50, anchor start), WINS a destra
    // (x=550 = SVG_W-50, anchor end).
    expect(svg).toContain(
      '<text x="50" y="55" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">COMMUNITY SPINS</text>'
    );
    expect(svg).toContain(
      '<text x="550" y="55" text-anchor="end" font-size="8.5" fill="#8b8bac" font-weight="700" letter-spacing="1.2">WINS</text>'
    );

    // Valori centrati sul centro dell'etichetta sopra (text-anchor="middle"):
    // 98.5 = 50 + 97/2 (larghezza misurata "COMMUNITY SPINS"),
    // 537 = 550 - 26/2 (larghezza misurata "WINS").
    expect(svg).toContain(
      '<text x="98.5" y="70" text-anchor="middle" font-size="14" font-weight="800" fill="#ffd700">42</text>'
    );
    expect(svg).toContain(
      '<text x="537" y="70" text-anchor="middle" font-size="14" font-weight="800" fill="#4ade80">7</text>'
    );
  });

  it('win: anche i due <text> animati del counter WINS restano centrati (x=537, middle)', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({ grid, uid: 4, state, winningLang, fact });
    // Entrambi i testi (vecchio che esce, nuovo che entra) usano la stessa
    // ancora centrale dell'etichetta WINS.
    expect(svg).toContain(
      '<text x="537" y="70" text-anchor="middle" font-size="14" font-weight="800" fill="#4ade80" style="opacity:0;animation:co4 .5s 6.60s both">6</text>'
    );
    expect(svg).toContain(
      '<text x="537" y="70" text-anchor="middle" font-size="14" font-weight="800" fill="#4ade80" style="opacity:1;animation:ci4 .5s 6.66s both">7</text>'
    );
    // E il counter SPINS resta centrato sotto "COMMUNITY SPINS"
    expect(svg).toContain(
      '<text x="98.5" y="70" text-anchor="middle" font-size="14" font-weight="800" fill="#ffd700">42</text>'
    );
  });
});

describe('buildSVG — escape', () => {
  beforeEach(() => {
    clearCache();
  });

  it('escapa i caratteri pericolosi nei fatti', () => {
    const grid = winGrid(SYMBOL_IDS[0]);
    const svg = buildSVG({
      grid,
      uid: 7,
      state,
      winningLang,
      fact: { en: '<script>&"\'', it: 'x' },
      repoMatch,
    });
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});
