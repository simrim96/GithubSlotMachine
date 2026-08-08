// Test unitari sulla paytable (api/_lib/svg/paytable.js).
// Verifica che la paytable contenga TUTTE le icone della slot e che ogni
// linguaggio mostri un numero di pallini (1-5) pari alla propria competenza.
import { describe, it, expect } from 'vitest';
import { generatePaytable } from '../api/_lib/svg/paytable.js';
import { ALL_SYMBOLS, LANGUAGES } from '../api/_lib/languages.js';

// Conta i pallini ACCESI (opacity >= 0.4) nella cella del simbolo dato
function litDotsInCell(svg, symbolId) {
  const start = svg.indexOf(`href="#sym_u_${symbolId}"`);
  expect(start, `simbolo ${symbolId} presente nella paytable`).toBeGreaterThan(
    -1
  );
  const after = svg.slice(start);
  const next = after.indexOf('<use ', 1);
  const cell = next === -1 ? after : after.slice(0, next);
  const dots = [
    ...cell.matchAll(
      /<circle cx="[\d.]+" cy="[\d.]+" r="2.1" fill="#41CD52" opacity="([\d.]+)"/g
    ),
  ];
  return dots.filter((m) => parseFloat(m[1]) >= 0.4).length;
}

describe('generatePaytable — icone', () => {
  it('include tutte le icone presenti nella slot (linguaggi + wild + scatter)', () => {
    const svg = generatePaytable('u', null);
    expect(ALL_SYMBOLS.length).toBeGreaterThanOrEqual(10);
    for (const sym of ALL_SYMBOLS) {
      expect(svg).toContain(`href="#sym_u_${sym.id}"`);
    }
  });

  it('usa le stesse icone dei rulli (stesso <symbol> della slot)', () => {
    const svg = generatePaytable('u', null);
    // Nessun glifo testuale artificiale: le icone sono i <use> dei simboli
    expect(svg).not.toContain('font-size="7"');
    expect(svg).not.toContain('grad_u_');
  });

  it('dispone le 10 icone in una fila dentro il pannello (x 120..480)', () => {
    const svg = generatePaytable('u', null);
    const uses = [
      ...svg.matchAll(/<use href="#sym_u_[a-z]+" x="([\d.]+)" y="([\d.]+)"/g),
    ];
    expect(uses.length).toBe(ALL_SYMBOLS.length);
    for (const m of uses) {
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      expect(x).toBeGreaterThanOrEqual(120);
      expect(x + 28).toBeLessThanOrEqual(480);
      expect(y).toBe(108); // PT_Y + 38
    }
  });
});

describe('generatePaytable — pallini di competenza (1-5)', () => {
  it('mostra per ogni linguaggio un numero di pallini 1-5 pari alla competenza', () => {
    const svg = generatePaytable('u', null);
    const langs = ALL_SYMBOLS.filter(
      (s) => s.id !== 'wild' && s.id !== 'scatter'
    );
    for (const lang of langs) {
      const dots = litDotsInCell(svg, lang.id);
      const competence = lang.competence;
      expect(competence).toBeGreaterThanOrEqual(1);
      expect(competence).toBeLessThanOrEqual(5);
      expect(dots).toBe(competence);
    }
  });

  it('wild e scatter (simboli speciali, non linguaggi) hanno 0 pallini', () => {
    const svg = generatePaytable('u', null);
    expect(litDotsInCell(svg, 'wild')).toBe(0);
    expect(litDotsInCell(svg, 'scatter')).toBe(0);
  });

  it('al massimo 5 pallini per simbolo', () => {
    const svg = generatePaytable('u', null);
    for (const sym of ALL_SYMBOLS) {
      expect(litDotsInCell(svg, sym.id)).toBeLessThanOrEqual(5);
    }
  });
});

describe('generatePaytable — simbolo vincente', () => {
  it('evidenzia con un anello dorato il simbolo del linguaggio vincente', () => {
    const winning = LANGUAGES[0];
    const svg = generatePaytable('u', winning);
    const ringIdx = svg.indexOf('stroke="#ffd700"');
    expect(ringIdx).toBeGreaterThan(-1);
    // L'anello precede immediatamente l'icona del vincitore
    const winnerUse = svg.indexOf(`href="#sym_u_${winning.id}"`);
    expect(ringIdx).toBeLessThan(winnerUse);
    expect(winnerUse - ringIdx).toBeLessThan(200);
  });

  it("nessun anello se non c'è vincita", () => {
    const svg = generatePaytable('u', null);
    expect(svg).not.toContain('#ffd700');
  });
});
