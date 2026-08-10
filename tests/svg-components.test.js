// Test unitari DEDICATI ai componenti SVG in api/_lib/svg/.
// Prima questi componenti avevano solo copertura indiretta via
// tests/svg.test.js (buildSVG intero); la paytable ha già il suo
// tests/paytable.test.js. Qui si verificano i singoli componenti:
// rendering di base, presenza degli elementi attesi, assenza di rotture
// con input limite (state/result assenti, grid piene di scatter, ecc.)
// e assenza di 'undefined'/'NaN' nel markup generato.
import { describe, it, expect } from 'vitest';
import { analyzeResult } from '../api/_lib/svg/analysis.js';
import { generateCSS } from '../api/_lib/svg/css.js';
import { generateDefs } from '../api/_lib/svg/defs.js';
import { generateHeader } from '../api/_lib/svg/header.js';
import { generateReels } from '../api/_lib/svg/reels.js';
import { generateWinEffects } from '../api/_lib/svg/effects.js';
import {
  generateWinGlowSVG,
  generateCoinsSVG,
} from '../api/_lib/svg/effects-helpers.js';
import { generateMarqueeBulbs } from '../api/_lib/svg/marquee.js';
import { generateCabinet } from '../api/_lib/svg/cabinet.js';
import { generateScreenFrame } from '../api/_lib/svg/screen.js';
import { generateResultPanel } from '../api/_lib/svg/panel.js';
import { getMX, colL, cellY, getGY } from '../api/_lib/svg/coordinates.js';
import { escapeXml } from '../api/_lib/svg/utils.js';
import {
  CW,
  CH,
  GAP,
  SVG_W,
  SVG_H,
  HDR_H,
  HDR_TOP,
  PT_H,
  PT_Y,
  FRAME_PAD,
  FILLERS,
  DUR,
} from '../api/_lib/svg/constants.js';
import {
  checkWins,
  COLS,
  ROWS,
  SYMBOL_IDS,
  SCATTER_ID,
} from '../api/_lib/game.js';
import { ALL_SYMBOLS, WILD_ID } from '../api/_lib/languages.js';

// ─── Griglie di test (stesse convenzioni di tests/svg.test.js) ─────────────
function emptyGrid() {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = SCATTER_ID;
  }
  return g;
}

// 3 simboli uguali sulla payline centrale → win normale (count=3).
function winGrid(langId = SYMBOL_IDS[0]) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c <= 2; c++) g[c][pl[c]] = langId;
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[3][pl[3]] = other;
  g[4][pl[4]] = other;
  return g;
}

// 4 simboli uguali sulla payline centrale → count=4 → BIG WIN.
function bigWinGrid(langId = SYMBOL_IDS[0]) {
  const g = emptyGrid();
  const pl = [1, 1, 1, 1, 1];
  for (let c = 0; c < 4; c++) g[c][pl[c]] = langId;
  const other = SYMBOL_IDS.find((i) => i !== langId) || langId;
  g[4][pl[4]] = other;
  return g;
}

const state = { totalSpins: 4200, totalWins: 7 };
const winningLang = {
  id: SYMBOL_IDS[0],
  name: 'Python',
  accent: '#3776ab',
  githubLang: 'Python',
};
const fact = { en: 'Fact about Python', it: 'Fatto su Python' };

describe('analyzeResult (analysis.js)', () => {
  it('no-win: isWin=false, nessuna cella vincente, messaggio generico', () => {
    const r = analyzeResult(emptyGrid(), state, null);
    expect(r.isWin).toBe(false);
    expect(r.isBigWin).toBe(false);
    expect(r.winCells).toEqual([]);
    expect(r.resultStatus).toBe('no-win');
    expect(r.ariaLabel).toContain('Try again, better luck next time!');
  });

  it('win: isWin=true, winCells sulle posizioni della payline, ED = ultimo rullo + 0.4', () => {
    const grid = winGrid();
    expect(checkWins(grid).length).toBeGreaterThan(0);
    const r = analyzeResult(grid, state, winningLang);
    expect(r.isWin).toBe(true);
    expect(r.isBigWin).toBe(false);
    expect(r.winCells).toEqual(['0,1', '1,1', '2,1']);
    expect(r.ED).toBe(DUR[COLS - 1] + 0.4);
    expect(r.resultStatus).toBe('win');
    expect(r.ariaLabel).toContain('Python WIN!');
    expect(r.ariaLabel).toContain('Total spins: 4,200, total wins: 7.');
  });

  it('big win: 4-in-a-row → isBigWin=true', () => {
    const grid = bigWinGrid();
    const r = analyzeResult(grid, state, winningLang);
    expect(r.isBigWin).toBe(true);
    expect(r.winCells).toEqual(['0,1', '1,1', '2,1', '3,1']);
  });

  it('state assente: contatori a zero, nessuna eccezione', () => {
    const r = analyzeResult(emptyGrid(), undefined, null);
    expect(r.isWin).toBe(false);
    expect(r.ariaLabel).toContain('Total spins: 0, total wins: 0.');
  });

  it("escapa il nome del linguaggio vincente nell'ariaLabel", () => {
    const r = analyzeResult(winGrid(), state, { name: '<Python&Co>' });
    expect(r.ariaLabel).toContain('&lt;Python&amp;Co&gt;');
    expect(r.ariaLabel).not.toContain('<Python');
  });
});

describe('generateCSS (css.js)', () => {
  it('win: keyframes base + co/ci del counter ritardato', () => {
    const css = generateCSS('u', { isWin: true });
    expect(css).toContain('@keyframes blu');
    for (let c = 0; c < COLS; c++) {
      expect(css).toContain(`@keyframes rsuc${c}`);
    }
    expect(css).toContain('@keyframes wpu');
    expect(css).toContain('@keyframes wru');
    expect(css).toContain('@keyframes ovu');
    expect(css).toContain('@keyframes otu');
    expect(css).toContain('@keyframes fiu');
    expect(css).toContain('@keyframes cfu');
    // counter ritardato SOLO su vincita
    expect(css).toContain('@keyframes cou');
    expect(css).toContain('@keyframes ciu');
  });

  it('no-win: nessuna animazione co/ci del counter', () => {
    const css = generateCSS('u', { isWin: false });
    expect(css).not.toContain('@keyframes cou');
    expect(css).not.toContain('@keyframes ciu');
    expect(css).toContain('@keyframes blu');
  });

  it('contiene il blocco prefers-reduced-motion', () => {
    const css = generateCSS('u', { isWin: false });
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('non lascia undefined/NaN nel markup', () => {
    const css = generateCSS('u', { isWin: true });
    expect(css).not.toContain('undefined');
    expect(css).not.toContain('NaN');
  });
});

describe('generateDefs (defs.js)', () => {
  it('dichiara i gradienti principali con id univoco per uid', () => {
    const defs = generateDefs('u');
    for (const id of [
      'bg',
      'hdr',
      'reelbg',
      'cab',
      'cabHi',
      'frame',
      'bulbOn',
      'bulbRed',
      'goldBar',
      'banner',
      'red7',
      'darkPanel',
      'scrGlow',
      'shg',
    ]) {
      expect(defs).toContain(`id="${id}u"`);
    }
  });

  it('crea un clip-path per ogni colonna (cp u c0..4)', () => {
    const defs = generateDefs('u');
    for (let c = 0; c < COLS; c++) {
      expect(defs).toContain(`<clipPath id="cpuc${c}">`);
    }
  });

  it('definisce il clip-path della paytable', () => {
    const defs = generateDefs('u');
    expect(defs).toContain('<clipPath id="paytable">');
  });

  it('definisce i <symbol> di tutti i simboli (linguaggi + wild + scatter)', () => {
    const defs = generateDefs('u');
    for (const s of ALL_SYMBOLS) {
      expect(defs).toContain(`<symbol id="sym_u_${s.id}"`);
    }
    expect(defs).toContain(`<symbol id="sym_u_${WILD_ID}"`);
  });

  it('non lascia undefined/NaN nel markup', () => {
    const defs = generateDefs('u');
    expect(defs).not.toContain('undefined');
    expect(defs).not.toContain('NaN');
  });
});

describe('generateHeader (header.js)', () => {
  it('no-win: etichette ai bordi e valori centrati, formattati en-US', () => {
    const svg = generateHeader('u', state, { isWin: false }, null);
    expect(svg).toContain('COMMUNITY SPINS');
    expect(svg).toContain('WINS');
    expect(svg).toContain('>4,200<');
    expect(svg).toContain('>7<');
    expect(svg).toContain('x="98.5"'); // centro etichetta sinistra
    expect(svg).toContain('x="537"'); // centro etichetta destra
    // Nessuna animazione co/ci
    expect(svg).not.toContain('animation:cou');
    expect(svg).not.toContain('animation:ciu');
  });

  it('win: counter ritardato col valore PRECEDENTE (co) e NUOVO (ci) al delay ED', () => {
    const svg = generateHeader('u', state, { ED: 6.6 }, winningLang);
    expect(svg).toContain(
      'style="opacity:0;animation:cou .5s 6.60s both">6</text>'
    );
    expect(svg).toContain(
      'style="opacity:1;animation:ciu .5s 6.66s both">7</text>'
    );
  });

  it('win ma totalWins=0: counter statico (nessun fantasma +1)', () => {
    const svg = generateHeader(
      'u',
      { totalSpins: 1, totalWins: 0 },
      { ED: 6.6 },
      winningLang
    );
    expect(svg).toContain('>0<');
    expect(svg).not.toContain('animation:cou');
    expect(svg).not.toContain('animation:ciu');
  });

  it('state assente: contatori a zero senza eccezioni', () => {
    const svg = generateHeader('u', undefined, {}, null);
    expect(svg).toContain('>0<');
    expect(svg).not.toContain('undefined');
  });

  it('non lascia undefined/NaN nel markup', () => {
    const svg = generateHeader('u', state, { ED: 6.6 }, winningLang);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });
});

describe('generateReels (reels.js)', () => {
  it('restituisce colBGs, reelsSvg e colBordersSvg', () => {
    const out = generateReels('u', emptyGrid());
    expect(typeof out.colBGs).toBe('string');
    expect(typeof out.reelsSvg).toBe('string');
    expect(typeof out.colBordersSvg).toBe('string');
  });

  it('disegna COLS colonne: sfondi, clip-path e bordi per ogni colonna', () => {
    const { colBGs, reelsSvg, colBordersSvg } = generateReels('u', emptyGrid());
    const bgCount = (colBGs.match(/fill="url\(#reelbgu\)"/g) || []).length;
    expect(bgCount).toBe(COLS);
    for (let c = 0; c < COLS; c++) {
      expect(reelsSvg).toContain(`clip-path="url(#cpuc${c})"`);
    }
    const borderCount = (colBordersSvg.match(/stroke="#e94560"/g) || []).length;
    expect(borderCount).toBe(COLS);
  });

  it('renderizza ogni cella della griglia + FILLERS per colonna', () => {
    const grid = emptyGrid();
    for (let c = 0; c < COLS; c++)
      for (let r = 0; r < ROWS; r++) grid[c][r] = SYMBOL_IDS[0];
    const { reelsSvg } = generateReels('u', grid);
    const uses = (reelsSvg.match(/<use href="#sym_u_[a-z]+"/g) || []).length;
    expect(uses).toBe(ROWS * COLS + FILLERS * COLS);
    // La cella della griglia è davvero renderizzata
    const target = (
      reelsSvg.match(/<use href="#sym_u_[a-z]+" x="[\d.]+" y="214"/g) || []
    ).length;
    expect(target).toBe(COLS);
  });

  it('non rompe con una griglia piena di scatter', () => {
    const { reelsSvg } = generateReels('u', emptyGrid());
    expect(reelsSvg).toContain('sym_u_');
    expect(reelsSvg).not.toContain('undefined');
    expect(reelsSvg).not.toContain('NaN');
  });
});

describe('generateWinEffects (effects.js) + helpers', () => {
  it('win: glow sulle celle vincenti, nessuna moneta per vincite normali', () => {
    const { winGlowSvg, coinsSvg } = generateWinEffects(
      'u',
      ['0,1', '1,1'],
      6.6,
      false
    );
    const glows = (winGlowSvg.match(/fill="#ffd700"/g) || []).length;
    expect(glows).toBe(2);
    expect(winGlowSvg).toContain('animation:wpu .7s 6.6s infinite');
    expect(winGlowSvg).toContain('opacity:0');
    expect(coinsSvg).toBe('');
  });

  it('nessun glow senza celle vincenti', () => {
    const { winGlowSvg } = generateWinEffects('u', [], 6.6, false);
    expect(winGlowSvg).toBe('');
  });

  it('generateWinGlowSVG posiziona il glow sulla cella (c,r) corretta', () => {
    const svg = generateWinGlowSVG('u', ['1,2'], 0);
    const x = colL(1);
    const y = cellY(2, getGY());
    expect(svg).toContain(`x="${x}"`);
    expect(svg).toContain(`y="${y}"`);
    expect(svg).toContain(`width="${CW}"`);
    expect(svg).toContain(`height="${CH}"`);
  });

  it('generateCoinsSVG: vuoto se non big-win, 9 monete con delay da ED se big-win', () => {
    expect(generateCoinsSVG('u', false, 6.6)).toBe('');
    const coins = generateCoinsSVG('u', true, 6.6);
    const emojiCount = (coins.match(/🪙/g) || []).length;
    expect(emojiCount).toBe(9);
    // Prima moneta a ED+0.2, poi +0.12 a moneta (formato senza zeri finali)
    expect(coins).toContain('animation:cfu 1.6s 6.8s forwards');
    expect(coins).toContain('animation:cfu 1.6s 6.92s forwards');
    // Tutti i delay sono numeri finiti (mai NaN)
    const delays = [
      ...coins.matchAll(/animation:cfu 1\.6s ([\d.]+)s forwards/g),
    ].map((m) => parseFloat(m[1]));
    expect(delays.length).toBe(9);
    for (const d of delays) expect(Number.isFinite(d)).toBe(true);
  });

  it('big-win via generateWinEffects: delay numerici validi (niente NaN)', () => {
    const { coinsSvg } = generateWinEffects('u', ['0,1'], 6.6, true);
    expect(coinsSvg).toContain('🪙');
    expect(coinsSvg).not.toContain('NaN');
    expect(coinsSvg).not.toContain('undefined');
  });

  it('non lascia undefined/NaN nel markup', () => {
    const { winGlowSvg, coinsSvg } = generateWinEffects(
      'u',
      ['0,1'],
      6.6,
      true
    );
    expect(winGlowSvg + coinsSvg).not.toContain('undefined');
    expect(winGlowSvg + coinsSvg).not.toContain('NaN');
  });
});

describe('generateMarqueeBulbs (marquee.js)', () => {
  it('genera una corona di lampadine (gruppi animati bl uid)', () => {
    const svg = generateMarqueeBulbs('u', false, 0);
    const bulbs = (svg.match(/<g style="animation:blu /g) || []).length;
    expect(bulbs).toBeGreaterThan(40);
    // ogni lampadina = 3 cerchi (alone, corpo, riflesso)
    const circles = (svg.match(/<circle /g) || []).length;
    expect(circles).toBe(bulbs * 3);
    expect(svg).toContain('url(#bulbOnu)');
    expect(svg).toContain('url(#bulbRedu)');
  });

  it('win: animazione veloce (0.45s); no-win: lenta (1.4s)', () => {
    expect(generateMarqueeBulbs('u', true, 6.6)).toContain(
      'animation:blu 0.45s'
    );
    expect(generateMarqueeBulbs('u', false, 0)).toContain('animation:blu 1.4s');
  });

  it('non lascia undefined/NaN nel markup', () => {
    const svg = generateMarqueeBulbs('u', false, 0);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });
});

describe('generateCabinet (cabinet.js)', () => {
  it('corpo, riflessi e borchie con i gradienti del cabinet', () => {
    const svg = generateCabinet('u');
    expect(svg).toContain('fill="url(#cabu)"');
    expect(svg).toContain('fill="url(#cabHiu)"');
    expect(svg).toContain('stroke="#ffd84a"'); // pinstripe dorata
    const studs = (svg.match(/fill="url\(#frameu\)"/g) || []).length;
    expect(studs).toBe(4);
    // Il cabinet è un frammento (non un <svg> root): usa SVG_W/SVG_H nella
    // geometria, estendendosi su tutta la larghezza del canvas.
    expect(svg).toContain(`L ${SVG_W - 50} 0`); // bordo superiore del corpo
    expect(svg).toContain(`Q ${SVG_W - 24} 0 ${SVG_W - 24} 24`); // angolo destro
    expect(svg).toContain(`L ${SVG_W - 24} ${SVG_H - 22}`); // bordo destro
  });

  it('non lascia undefined/NaN nel markup', () => {
    const svg = generateCabinet('u');
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });
});

describe('generateScreenFrame (screen.js)', () => {
  it('frame dorato, bezel nero, glow interno e strisce LED', () => {
    const svg = generateScreenFrame('u');
    expect(svg).toContain('fill="url(#frameu)"');
    expect(svg).toContain('fill="#7a4400"'); // bordo esterno
    expect(svg).toContain('fill="#0a0612"'); // bezel nero
    expect(svg).toContain('fill="url(#scrGlowu)"');
    const ledStrips = (svg.match(/fill="#ffd84a" opacity="0.7"/g) || []).length;
    expect(ledStrips).toBe(2); // striscia sopra + sotto
  });

  it('non lascia undefined/NaN nel markup', () => {
    const svg = generateScreenFrame('u');
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });
});

describe('generateResultPanel (panel.js)', () => {
  it('win: titolo 🎉, pannello verde, righe EN/IT del fact', () => {
    const svg = generateResultPanel(
      'u',
      true,
      winningLang,
      fact,
      'simrim96',
      6.6,
      { isBigWin: false }
    );
    expect(svg).toContain('🎉 Python WIN!');
    expect(svg).toContain('stroke="#4ade80"');
    expect(svg).toContain('>EN</text>');
    expect(svg).toContain('>IT</text>');
    expect(svg).toContain('Fact about Python');
    expect(svg).toContain('Fatto su Python');
    expect(svg).toContain('animation:fiu');
  });

  it('big win: titolo 💰 con colore dedicato', () => {
    const svg = generateResultPanel('u', true, winningLang, fact, 'o', 6.6, {
      isBigWin: true,
    });
    expect(svg).toContain('💰 BIG WIN — Python!');
    expect(svg).toContain('stroke="#ffb84d"');
  });

  it('no-win: messaggi generici bilingue', () => {
    const svg = generateResultPanel('u', false, null, fact, 'o', 0, {
      isBigWin: false,
    });
    expect(svg).toContain('Try again, better luck next time!');
    expect(svg).toContain('Ritenta, sarai più fortunato!');
    expect(svg).toContain('stroke="#e94560"');
  });

  it('escapa i caratteri pericolosi nel titolo e nei fatti', () => {
    const svg = generateResultPanel(
      'u',
      true,
      { ...winningLang, name: '<Python>' },
      { en: '<script>&"\'', it: 'x' },
      'o',
      0,
      { isBigWin: false }
    );
    expect(svg).toContain('&lt;Python&gt;');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('non rompe con fact assente o vuoto', () => {
    for (const f of [undefined, {}, null]) {
      const svg = generateResultPanel('u', true, winningLang, f, 'o', 0, {
        isBigWin: false,
      });
      expect(svg).not.toContain('undefined');
      expect(svg).not.toContain('NaN');
    }
  });
});

describe('coordinate helpers (coordinates.js)', () => {
  it('getMX centra la griglia (74 = (600 - (5*84 + 4*8)) / 2)', () => {
    expect(getMX()).toBe(
      Math.floor((SVG_W - (COLS * CW + (COLS - 1) * GAP)) / 2)
    );
    expect(getMX()).toBe(74);
  });

  it('colL avanza di CW+GAP per colonna', () => {
    expect(colL(0)).toBe(getMX());
    expect(colL(1) - colL(0)).toBe(CW + GAP);
  });

  it('cellY scala di CH per riga', () => {
    const GY = getGY();
    expect(cellY(0, GY)).toBe(GY);
    expect(cellY(2, GY) - cellY(1, GY)).toBe(CH);
  });

  it('getGY lascia spazio tra paytable e rulli', () => {
    expect(getGY()).toBe(PT_Y + PT_H + 52);
    // la paytable finisce prima del frame dei rulli
    expect(getGY() - FRAME_PAD).toBeGreaterThan(PT_Y + PT_H);
  });
});

describe('constants (constants.js)', () => {
  it('geometria coerente con la griglia di gioco', () => {
    // la griglia (CW*COLS + GAP*(COLS-1)) sta dentro l'SVG con margini
    expect(COLS * CW + (COLS - 1) * GAP).toBeLessThan(SVG_W);
    expect(ROWS * CH).toBeLessThan(SVG_H);
    // header e paytable non si sovrappongono
    expect(PT_Y).toBe(HDR_TOP + HDR_H + 4);
    expect(PT_Y + PT_H).toBeLessThan(getGY());
  });

  it('DUR ha un valore per ogni colonna e cresce (ultimo rullo = più lento)', () => {
    expect(DUR.length).toBe(COLS);
    for (let i = 1; i < DUR.length; i++) {
      expect(DUR[i]).toBeGreaterThan(DUR[i - 1]);
    }
  });

  it('FILLERS garantisce simboli extra per la rotazione', () => {
    expect(FILLERS).toBeGreaterThanOrEqual(ROWS);
  });
});

describe('escapeXml (utils.js)', () => {
  it('escapa i 5 caratteri pericolosi XML', () => {
    expect(escapeXml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
  });

  it('lascia intatte le stringhe innocue', () => {
    expect(escapeXml('Python WIN!')).toBe('Python WIN!');
  });

  it('null/undefined → stringa vuota (nessuna eccezione)', () => {
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });
});

describe('sweep: nessun componente lascia undefined/NaN nel markup', () => {
  const components = [
    ['analyzeResult', () => analyzeResult(emptyGrid(), state, null).ariaLabel],
    ['generateCSS', () => generateCSS('u', { isWin: true })],
    ['generateDefs', () => generateDefs('u')],
    ['generateHeader', () => generateHeader('u', {}, {}, null)],
    [
      'generateReels',
      () => {
        const { colBGs, reelsSvg, colBordersSvg } = generateReels(
          'u',
          emptyGrid()
        );
        return colBGs + reelsSvg + colBordersSvg;
      },
    ],
    [
      'generateWinEffects',
      () => {
        const { winGlowSvg, coinsSvg } = generateWinEffects('u', [], 0, false);
        return winGlowSvg + coinsSvg;
      },
    ],
    ['generateMarqueeBulbs', () => generateMarqueeBulbs('u', false, 0)],
    ['generateCabinet', () => generateCabinet('u')],
    ['generateScreenFrame', () => generateScreenFrame('u')],
    [
      'generateResultPanel',
      () =>
        generateResultPanel('u', false, null, {}, 'o', 0, { isBigWin: false }),
    ],
  ];

  it.each(components)('%s — markup pulito', (_name, render) => {
    const out = render();
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('NaN');
  });
});
