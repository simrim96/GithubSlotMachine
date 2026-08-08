// Test unitari sulla paytable (api/_lib/svg/paytable.js).
// Verifica che la paytable contenga solo i linguaggi della slot (niente wild
// e scatter), che stiano agevolmente nel pannello allargato e che ogni
// linguaggio mostri un numero di pallini (1-5) pari alla propria competenza.
// L'anello dorato sul vincitore deve comparire animato SOLO dopo la fine
// della rotazione (delay = ED).
import { describe, it, expect } from 'vitest';
import { generatePaytable } from '../api/_lib/svg/paytable.js';
import { LANGUAGES } from '../api/_lib/languages.js';

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
  it('include solo i linguaggi della slot (niente wild e scatter)', () => {
    const svg = generatePaytable('u', null);
    for (const lang of LANGUAGES) {
      expect(svg).toContain(`href="#sym_u_${lang.id}"`);
    }
    // Wild e scatter rimossi: non compaiono nella paytable
    expect(svg).not.toContain('href="#sym_u_wild"');
    expect(svg).not.toContain('href="#sym_u_scatter"');
  });

  it('usa le stesse icone dei rulli (stesso <symbol> della slot)', () => {
    const svg = generatePaytable('u', null);
    // Nessun glifo testuale artificiale: le icone sono i <use> dei simboli
    expect(svg).not.toContain('font-size="7"');
    expect(svg).not.toContain('grad_u_');
  });

  it('dispone le icone in una fila dentro il pannello allargato (x 80..520)', () => {
    const svg = generatePaytable('u', null);
    const uses = [
      ...svg.matchAll(/<use href="#sym_u_[a-z]+" x="([\d.]+)" y="([\d.]+)"/g),
    ];
    expect(uses.length).toBe(LANGUAGES.length);
    for (const m of uses) {
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      expect(x).toBeGreaterThanOrEqual(80);
      expect(x + 38).toBeLessThanOrEqual(520);
      expect(y).toBe(108); // PT_Y + 38
    }
  });
});

describe('generatePaytable — pallini di competenza (1-5)', () => {
  it('mostra per ogni linguaggio un numero di pallini 1-5 pari alla competenza', () => {
    const svg = generatePaytable('u', null);
    for (const lang of LANGUAGES) {
      const dots = litDotsInCell(svg, lang.id);
      expect(lang.competence).toBeGreaterThanOrEqual(1);
      expect(lang.competence).toBeLessThanOrEqual(5);
      expect(dots).toBe(lang.competence);
    }
  });

  it('al massimo 5 pallini per simbolo', () => {
    const svg = generatePaytable('u', null);
    for (const lang of LANGUAGES) {
      expect(litDotsInCell(svg, lang.id)).toBeLessThanOrEqual(5);
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

  it("l'anello è animato e compare solo dopo la rotazione (delay = ED)", () => {
    const winning = LANGUAGES[0];
    const svg = generatePaytable('u', winning, 6.6);
    // Parte invisibile (opacity:0) e animazione con delay pari a ED
    expect(svg).toContain('animation:wr');
    expect(svg).toContain('6.6s forwards');
    expect(svg).toContain('opacity:0');
    // Senza vincita: nessun anello animato
    expect(generatePaytable('u', null, 6.6)).not.toContain('animation:wr');
  });
});
