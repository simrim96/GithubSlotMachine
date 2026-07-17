import { describe, test, expect } from 'vitest';
import { LANGUAGES, LANGUAGES_BASE, getLanguages } from '../api/_lib/languages.js';

describe('languages', () => {
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

    test('each language has required fields', () => {
      const requiredFields = ['id', 'name', 'short', 'color', 'accent', 'text', 'githubLang'];
      for (const lang of LANGUAGES_BASE) {
        for (const field of requiredFields) {
          expect(lang).toHaveProperty(field);
        }
      }
    });

    test('LANGUAGES_BASE is constant (not modified)', () => {
      const initialLength = LANGUAGES_BASE.length;
      // Should not be modified by any operation
      expect(LANGUAGES_BASE.length).toBe(initialLength);
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

  describe('getLanguages()', () => {
    test('returns promise', () => {
      expect(getLanguages()).toBeInstanceOf(Promise);
    });

    test('returns base languages when no external config', async () => {
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

    test('caches result after first call', async () => {
      const result1 = await getLanguages();
      const result2 = await getLanguages();
      expect(result1).toBe(result2); // Same object (cached)
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
      expect(rust.facts).toHaveLength(3);

      expect(go).toBeDefined();
      expect(go.name).toBe('Go');
      expect(go.githubLang).toBe('Go');
      expect(go.facts).toHaveLength(3);
    });
  });
});
