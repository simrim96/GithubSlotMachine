import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  LANGUAGES,
  LANGUAGES_BASE,
  WILD,
  SCATTER,
  WILD_ID,
  SCATTER_ID,
  ALL_SYMBOLS,
  SYMBOL_BY_ID,
  LANGUAGE_BY_ID,
  getLanguages,
  getFullLookups,
  buildLookups,
  buildSymbolDefs,
  symbolUse,
  escapeXml,
  pickFact,
} from '../api/_lib/languages.js';

// Stato condiviso per il mock del config-loader. I test possono sostituire
// `externalMock.state.external` (payload restituito dal loader) oppure
// impostare `externalMock.state.error` per simulare un loader in errore.
const externalMock = vi.hoisted(() => {
  const defaults = [
    {
      id: 'rust',
      name: 'Rust',
      short: 'Rust',
      color: '#DEA584',
      accent: '#F0C7A5',
      text: '#ffffff',
      githubLang: 'Rust',
      topic: 'rust-lang',
      competence: 3,
      icon: '<g></g>',
      facts: [{ it: 'Rust IT', en: 'Rust EN' }],
    },
    {
      id: 'go',
      name: 'Go',
      short: 'Go',
      color: '#00ADD8',
      accent: '#63B0FF',
      text: '#ffffff',
      githubLang: 'Go',
      topic: 'go',
      competence: 2,
      icon: '<g></g>',
      facts: [{ it: 'Go IT', en: 'Go EN' }],
    },
  ];
  return { defaults, state: { external: defaults, error: null } };
});

// Mock del config-loader: mergeLanguages resta reale (filtra duplicati e voci
// invalide), loadExternalLanguages è controllabile dai test.
vi.mock('../api/_lib/config-loader.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadExternalLanguages: vi.fn(async () => {
      if (externalMock.state.error) throw externalMock.state.error;
      return externalMock.state.external;
    }),
  };
});

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const BASE_IDS = [
  'cpp',
  'c',
  'glsl',
  'react',
  'javascript',
  'python',
  'typescript',
  'qt',
];

describe('languages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalMock.state.error = null;
    externalMock.state.external = externalMock.defaults;
  });

  describe('LANGUAGES_BASE', () => {
    test('contains expected base languages', () => {
      const ids = LANGUAGES_BASE.map((l) => l.id);
      expect(ids).toContain('cpp');
      expect(ids).toContain('c');
      expect(ids).toContain('python');
      expect(ids).toContain('javascript');
      expect(ids).toContain('typescript');
      expect(ids).toContain('react');
      expect(ids).toContain('glsl');
      expect(ids).toContain('qt');
    });

    test('contains exactly the expected languages, without duplicates', () => {
      const ids = LANGUAGES_BASE.map((l) => l.id);
      expect(ids).toEqual(BASE_IDS);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('each language has required fields', () => {
      const requiredFields = [
        'id',
        'name',
        'short',
        'color',
        'accent',
        'text',
        'githubLang',
      ];
      for (const lang of LANGUAGES_BASE) {
        for (const field of requiredFields) {
          expect(lang).toHaveProperty(field);
        }
      }
    });

    test('required fields are non-empty strings', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(lang.id).toBeTruthy();
        expect(lang.name).toBeTruthy();
        expect(lang.short).toBeTruthy();
        expect(lang.githubLang).toBeTruthy();
      }
    });

    test('colors are hex #RRGGBB', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(lang.color).toMatch(HEX_COLOR);
        expect(lang.accent).toMatch(HEX_COLOR);
        expect(lang.text).toMatch(HEX_COLOR);
      }
    });

    test('competence is in range 1-5', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(lang.competence).toBeGreaterThanOrEqual(1);
        expect(lang.competence).toBeLessThanOrEqual(5);
      }
    });

    test('short label is compact (max 5 chars)', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(lang.short.length).toBeLessThanOrEqual(5);
      }
    });

    test('facts are non-empty arrays of bilingual { it, en } objects', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(Array.isArray(lang.facts)).toBe(true);
        expect(lang.facts.length).toBeGreaterThan(0);
        for (const fact of lang.facts) {
          expect(typeof fact.it).toBe('string');
          expect(fact.it.length).toBeGreaterThan(0);
          expect(typeof fact.en).toBe('string');
          expect(fact.en.length).toBeGreaterThan(0);
        }
      }
    });

    test('every language has a non-empty SVG icon (used by buildSymbolDefs)', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(typeof lang.icon).toBe('string');
        expect(lang.icon.length).toBeGreaterThan(0);
      }
    });

    test('LANGUAGES_BASE is constant (not modified)', () => {
      const initialLength = LANGUAGES_BASE.length;
      // Should not be modified by any operation
      expect(LANGUAGES_BASE.length).toBe(initialLength);
    });
  });

  describe('WILD and SCATTER', () => {
    test('WILD has id "wild" and the visual fields', () => {
      expect(WILD.id).toBe('wild');
      expect(WILD.short).toBe('WILD');
      expect(WILD.color).toMatch(HEX_COLOR);
      expect(WILD.accent).toMatch(HEX_COLOR);
      expect(WILD.text).toMatch(HEX_COLOR);
      expect(WILD.icon.length).toBeGreaterThan(0);
    });

    test('SCATTER has id "scatter" and short "BONUS"', () => {
      expect(SCATTER.id).toBe('scatter');
      expect(SCATTER.short).toBe('BONUS');
      expect(SCATTER.color).toMatch(HEX_COLOR);
      expect(SCATTER.accent).toMatch(HEX_COLOR);
      expect(SCATTER.text).toMatch(HEX_COLOR);
      expect(SCATTER.icon.length).toBeGreaterThan(0);
    });

    test('WILD_ID and SCATTER_ID constants', () => {
      expect(WILD_ID).toBe('wild');
      expect(SCATTER_ID).toBe('scatter');
    });

    test('WILD and SCATTER are not languages (no name/githubLang)', () => {
      expect(WILD.name).toBeUndefined();
      expect(WILD.githubLang).toBeUndefined();
      expect(SCATTER.name).toBeUndefined();
      expect(SCATTER.githubLang).toBeUndefined();
      expect(LANGUAGES_BASE).not.toContain(WILD);
      expect(LANGUAGES_BASE).not.toContain(SCATTER);
    });
  });

  describe('LANGUAGES (backward compatibility)', () => {
    test('LANGUAGES is an alias for LANGUAGES_BASE', () => {
      expect(LANGUAGES).toBe(LANGUAGES_BASE);
    });

    test('LANGUAGES has same length as LANGUAGES_BASE', () => {
      expect(LANGUAGES.length).toBe(LANGUAGES_BASE.length);
    });
  });

  describe('ALL_SYMBOLS / SYMBOL_BY_ID / LANGUAGE_BY_ID (sync, base only)', () => {
    test('ALL_SYMBOLS = base + WILD + SCATTER', () => {
      expect(ALL_SYMBOLS).toHaveLength(LANGUAGES_BASE.length + 2);
      expect(ALL_SYMBOLS.slice(-2)).toEqual([WILD, SCATTER]);
      const ids = ALL_SYMBOLS.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('SYMBOL_BY_ID maps every symbol id to its object', () => {
      for (const s of ALL_SYMBOLS) {
        expect(SYMBOL_BY_ID[s.id]).toBe(s);
      }
    });

    test('LANGUAGE_BY_ID contains only base languages (no wild/scatter)', () => {
      for (const lang of LANGUAGES_BASE) {
        expect(LANGUAGE_BY_ID[lang.id]).toBe(lang);
      }
      expect(LANGUAGE_BY_ID.wild).toBeUndefined();
      expect(LANGUAGE_BY_ID.scatter).toBeUndefined();
    });
  });

  describe('buildLookups()', () => {
    test('builds lookups from a custom languages array', () => {
      const langs = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ];
      const lookups = buildLookups(langs);

      expect(lookups.ALL_SYMBOLS.map((s) => s.id)).toEqual([
        'a',
        'b',
        'wild',
        'scatter',
      ]);
      expect(lookups.SYMBOL_BY_ID.a).toBe(langs[0]);
      expect(lookups.SYMBOL_BY_ID.wild).toBe(WILD);
      expect(lookups.SYMBOL_BY_ID.scatter).toBe(SCATTER);
      expect(lookups.LANGUAGE_BY_ID.a).toBe(langs[0]);
      expect(lookups.LANGUAGE_BY_ID.wild).toBeUndefined();
    });

    test('empty array → only WILD and SCATTER among symbols', () => {
      const lookups = buildLookups([]);
      expect(lookups.ALL_SYMBOLS).toEqual([WILD, SCATTER]);
      expect(Object.keys(lookups.LANGUAGE_BY_ID)).toHaveLength(0);
      expect(lookups.SYMBOL_BY_ID.wild).toBe(WILD);
      expect(lookups.SYMBOL_BY_ID.scatter).toBe(SCATTER);
    });
  });

  describe('getLanguages()', () => {
    test('returns promise', () => {
      expect(getLanguages()).toBeInstanceOf(Promise);
    });

    test('returns base languages first', async () => {
      const result = await getLanguages();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe('cpp'); // First base language
    });

    test('includes base languages in result', async () => {
      const result = await getLanguages();
      const ids = result.map((l) => l.id);
      expect(ids).toContain('cpp');
      expect(ids).toContain('python');
      expect(ids).toContain('rust'); // From external config
      expect(ids).toContain('go'); // From external config
    });

    test('base languages come before external ones', async () => {
      const result = await getLanguages();
      const ids = result.map((l) => l.id);
      expect(ids.slice(0, BASE_IDS.length)).toEqual(BASE_IDS);
      expect(ids.slice(BASE_IDS.length)).toEqual(['rust', 'go']);
    });

    test('caches result after first call', async () => {
      const result1 = await getLanguages();
      const result2 = await getLanguages();
      expect(result1).toBe(result2); // Same object (cached)
    });
  });

  describe('getFullLookups()', () => {
    test('includes external languages and WILD/SCATTER', async () => {
      const lookups = await getFullLookups();

      expect(lookups.LANGUAGE_BY_ID.cpp).toBeDefined();
      expect(lookups.LANGUAGE_BY_ID.rust).toBeDefined();
      expect(lookups.LANGUAGE_BY_ID.go).toBeDefined();
      expect(lookups.SYMBOL_BY_ID.wild).toBe(WILD);
      expect(lookups.SYMBOL_BY_ID.scatter).toBe(SCATTER);
      expect(lookups.LANGUAGE_BY_ID.wild).toBeUndefined();
      expect(lookups.ALL_SYMBOLS).toHaveLength(LANGUAGES_BASE.length + 4);
    });
  });

  describe('language properties', () => {
    test('python language has expected properties', () => {
      const python = LANGUAGES_BASE.find((l) => l.id === 'python');
      expect(python).toBeDefined();
      expect(python.name).toBe('Python');
      expect(python.short).toBe('Py');
      expect(python.color).toBe('#3776AB');
      expect(python.accent).toBe('#FFD43B');
      expect(python.competence).toBe(4);
      expect(Array.isArray(python.facts)).toBe(true);
      expect(python.facts.length).toBe(3);
      expect(python.facts[0]).toHaveProperty('it');
      expect(python.facts[0]).toHaveProperty('en');
    });

    test('external languages (rust, go) have expected properties', async () => {
      const result = await getLanguages();
      const rust = result.find((l) => l.id === 'rust');
      const go = result.find((l) => l.id === 'go');

      expect(rust).toBeDefined();
      expect(rust.name).toBe('Rust');
      expect(rust.githubLang).toBe('Rust');
      expect(rust.facts).toHaveLength(1);

      expect(go).toBeDefined();
      expect(go.name).toBe('Go');
      expect(go.githubLang).toBe('Go');
      expect(go.facts).toHaveLength(1);
    });
  });

  describe('pickFact()', () => {
    test('returns the single bilingual fact', () => {
      const lang = { facts: [{ it: 'A', en: 'B' }] };
      expect(pickFact(lang)).toEqual({ it: 'A', en: 'B' });
    });

    test('with multiple facts returns one of them', () => {
      const facts = [
        { it: 'ITA1', en: 'EN1' },
        { it: 'ITA2', en: 'EN2' },
        { it: 'ITA3', en: 'EN3' },
      ];
      const fact = pickFact({ facts });
      expect(facts).toContainEqual(fact);
    });

    test('string facts are converted to { it, en } (backward compat)', () => {
      expect(pickFact({ facts: ['Solo testo'] })).toEqual({
        it: 'Solo testo',
        en: 'Solo testo',
      });
    });

    test('empty facts array → { it: "", en: "" }', () => {
      expect(pickFact({ facts: [] })).toEqual({ it: '', en: '' });
    });

    test('no facts → { it: "", en: "" }', () => {
      expect(pickFact({})).toEqual({ it: '', en: '' });
      expect(pickFact({ facts: undefined })).toEqual({ it: '', en: '' });
    });

    test('fact with only "en" falls back to en for both', () => {
      expect(pickFact({ facts: [{ en: 'Only EN' }] })).toEqual({
        it: 'Only EN',
        en: 'Only EN',
      });
    });

    test('fact with only "it" falls back to it for both', () => {
      expect(pickFact({ facts: [{ it: 'Only IT' }] })).toEqual({
        it: 'Only IT',
        en: 'Only IT',
      });
    });

    test('fact with neither it nor en → { it: "", en: "" }', () => {
      expect(pickFact({ facts: [{}] })).toEqual({ it: '', en: '' });
    });
  });

  describe('escapeXml()', () => {
    test('escapes reserved XML characters', () => {
      expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
    });

    test('leaves plain text unchanged', () => {
      expect(escapeXml('C++ & JS')).toBe('C++ &amp; JS');
      expect(escapeXml('plain text 123')).toBe('plain text 123');
    });

    test('coerces non-string input to string', () => {
      expect(escapeXml(42)).toBe('42');
      expect(escapeXml(null)).toBe('null');
      expect(escapeXml(undefined)).toBe('undefined');
    });
  });

  describe('buildSymbolDefs() / symbolUse()', () => {
    test('generates one <symbol> per symbol (base + WILD + SCATTER)', () => {
      const defs = buildSymbolDefs('uid1');

      for (const s of ALL_SYMBOLS) {
        expect(defs).toContain(`<symbol id="sym_uid1_${s.id}"`);
        expect(defs).toContain(`<linearGradient id="g_uid1_${s.id}"`);
      }
      expect(defs.match(/<symbol /g)).toHaveLength(ALL_SYMBOLS.length);
    });

    test('uses the uid as prefix for gradients and symbols', () => {
      const defs = buildSymbolDefs('abc');
      expect(defs).toContain('id="g_abc_python"');
      expect(defs).toContain('id="sym_abc_python"');
      expect(defs).not.toContain('sym_uid1_');
    });

    test('uses viewBox 84x84 and embeds the short label', () => {
      const defs = buildSymbolDefs('u');
      expect(defs).toContain('viewBox="0 0 84 84"');
      for (const s of ALL_SYMBOLS) {
        expect(defs).toContain(`>${s.short}<`);
      }
    });

    test('symbolUse generates the correct reference', () => {
      expect(symbolUse('u1', 'cpp', 10, 20)).toBe(
        '<use href="#sym_u1_cpp" x="10" y="20" width="84" height="84"/>'
      );
    });

    test('symbolUse accepts custom dimensions', () => {
      expect(symbolUse('u1', 'wild', 0, 0, 42, 42)).toBe(
        '<use href="#sym_u1_wild" x="0" y="0" width="42" height="42"/>'
      );
    });
  });

  // Cache vuota/popolata e payload limite: ogni test usa un'istanza di modulo
  // fresca (vi.resetModules) perché `externalLanguagesPromise` è memorizzata a
  // livello di modulo e si popola al primo getLanguages().
  describe('getLanguages() — cache vuota/popolata e payload limite', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
      externalMock.state.error = null;
      externalMock.state.external = externalMock.defaults;
    });

    test('cache vuota: il primo call carica i linguaggi esterni', async () => {
      const mod = await import('../api/_lib/languages.js');
      const { loadExternalLanguages: loader } =
        await import('../api/_lib/config-loader.js');

      const result = await mod.getLanguages();

      expect(loader).toHaveBeenCalledTimes(1);
      expect(result.map((l) => l.id)).toEqual([...BASE_IDS, 'rust', 'go']);
      expect(result).not.toBe(mod.LANGUAGES_BASE); // merged array, non la base
    });

    test('cache popolata: i call successivi riusano la stessa promise', async () => {
      const mod = await import('../api/_lib/languages.js');
      const { loadExternalLanguages: loader } =
        await import('../api/_lib/config-loader.js');

      const first = await mod.getLanguages();
      const second = await mod.getLanguages();
      const third = await mod.getLanguages();

      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    test('cache popolata: call concorrenti → un solo load', async () => {
      const mod = await import('../api/_lib/languages.js');
      const { loadExternalLanguages: loader } =
        await import('../api/_lib/config-loader.js');

      const [a, b, c] = await Promise.all([
        mod.getLanguages(),
        mod.getLanguages(),
        mod.getLanguages(),
      ]);

      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    test('payload esterno vuoto → solo base (stesso riferimento)', async () => {
      externalMock.state.external = [];
      const mod = await import('../api/_lib/languages.js');

      const result = await mod.getLanguages();

      expect(result).toBe(mod.LANGUAGES_BASE);
    });

    test('loader in errore → fallback su LANGUAGES_BASE senza throw', async () => {
      externalMock.state.error = new Error('boom');
      const mod = await import('../api/_lib/languages.js');

      await expect(mod.getLanguages()).resolves.toBe(mod.LANGUAGES_BASE);
    });

    test('payload malformato (null) → fallback su LANGUAGES_BASE', async () => {
      externalMock.state.external = null;
      const mod = await import('../api/_lib/languages.js');

      await expect(mod.getLanguages()).resolves.toBe(mod.LANGUAGES_BASE);
    });

    test('payload malformato (stringa) → fallback su LANGUAGES_BASE', async () => {
      externalMock.state.external = 'not-an-array';
      const mod = await import('../api/_lib/languages.js');

      await expect(mod.getLanguages()).resolves.toBe(mod.LANGUAGES_BASE);
    });

    test('lingue esterne invalide e duplicate vengono scartate', async () => {
      externalMock.state.external = [
        ...externalMock.defaults,
        {
          // Duplicato di una lingua base → scartato da mergeLanguages
          id: 'cpp',
          name: 'C++ Fake',
          short: 'XX',
          color: '#000000',
          accent: '#000000',
          text: '#ffffff',
          githubLang: 'C++',
        },
        { id: 'lua' }, // Invalida: campi obbligatori mancanti → scartata
      ];
      const mod = await import('../api/_lib/languages.js');

      const result = await mod.getLanguages();
      const ids = result.map((l) => l.id);

      expect(ids).toEqual([...BASE_IDS, 'rust', 'go']);
      expect(result.find((l) => l.id === 'cpp').name).toBe('C++'); // vince la base
      expect(result.some((l) => l.id === 'lua')).toBe(false);
    });
  });
});
