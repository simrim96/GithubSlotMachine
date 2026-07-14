import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadExternalLanguages, validateLanguageSchema, mergeLanguages } from '../api/_lib/config-loader.js';

// Mock file system
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:path', () => {
  const actualPath = vi.importActual('node:path');
  return {
    ...actualPath,
    join: vi.fn((...args) => actualPath.join(...args)),
    dirname: vi.fn((path) => actualPath.dirname(path)),
    fileURLToPath: vi.fn((url) => actualPath.fileURLToPath(url)),
  };
});

describe('config-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateLanguageSchema', () => {
    test('validates required fields correctly', () => {
      const validLang = {
        id: 'rust',
        name: 'Rust',
        short: 'Rust',
        color: '#DEA584',
        accent: '#F0C7A5',
        text: '#ffffff',
        githubLang: 'Rust',
      };
      expect(validateLanguageSchema(validLang)).toBe(true);
    });

    test('rejects missing required field', () => {
      const invalidLang = {
        id: 'rust',
        // name missing
        short: 'Rust',
        color: '#DEA584',
        accent: '#F0C7A5',
        text: '#ffffff',
        githubLang: 'Rust',
      };
      expect(validateLanguageSchema(invalidLang)).toBe(false);
    });

    test('accepts optional fields', () => {
      const langWithOptional = {
        id: 'rust',
        name: 'Rust',
        short: 'Rust',
        color: '#DEA584',
        accent: '#F0C7A5',
        text: '#ffffff',
        githubLang: 'Rust',
        topic: 'rust-lang',
        competence: 3,
        icon: '<svg>...</svg>',
        facts: [{ it: 'Fact', en: 'Fact' }],
      };
      expect(validateLanguageSchema(langWithOptional)).toBe(true);
    });
  });

  describe('mergeLanguages', () => {
    test('merges base and external languages without duplicates', () => {
      const base = [
        { id: 'cpp', name: 'C++', short: 'C++', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'C++' },
        { id: 'python', name: 'Python', short: 'Py', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Python' },
      ];
      const external = [
        { id: 'rust', name: 'Rust', short: 'Rust', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Rust' },
        { id: 'go', name: 'Go', short: 'Go', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Go' },
      ];
      const merged = mergeLanguages(base, external);
      expect(merged).toHaveLength(4);
      expect(merged.map((l) => l.id)).toEqual(['cpp', 'python', 'rust', 'go']);
    });

    test('filters out duplicate IDs', () => {
      const base = [
        { id: 'rust', name: 'Rust', short: 'Rust', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Rust' },
        { id: 'python', name: 'Python', short: 'Py', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Python' },
      ];
      const external = [
        { id: 'rust', name: 'Rust Override', short: 'RO', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Rust' }, // Duplicate!
        { id: 'go', name: 'Go', short: 'Go', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Go' },
      ];
      const merged = mergeLanguages(base, external);
      expect(merged).toHaveLength(3);
      expect(merged.find((l) => l.id === 'rust').name).toBe('Rust'); // Base wins
    });

    test('filters out invalid schemas', () => {
      const base = [{ id: 'cpp', name: 'C++', short: 'C++', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'C++' }];
      const external = [
        { id: 'rust', name: 'Rust', short: 'Rust', color: '#fff', accent: '#fff', text: '#fff', githubLang: 'Rust' }, // valid
        { id: 'invalid' }, // invalid - missing required fields
      ];
      const merged = mergeLanguages(base, external);
      expect(merged).toHaveLength(2);
    });
  });

  describe('loadExternalLanguages integration', () => {
    test('returns empty array when no config file exists', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      
      const result = await loadExternalLanguages();
      expect(result).toEqual([]);
      expect(existsSync).toHaveBeenCalled();
    });

    test('parses JSON config correctly', async () => {
      const mockConfig = {
        languages: [
          {
            id: 'rust',
            name: 'Rust',
            short: 'Rust',
            color: '#DEA584',
            accent: '#F0C7A5',
            text: '#ffffff',
            githubLang: 'Rust',
            facts: [{ it: 'Fact', en: 'Fact' }],
          },
        ],
      };

      const mockPath = '/home/simonerimenti/Progetti/GithubSlotMachine/languages-external.json';
      vi.mocked(existsSync).mockImplementation((path) => path === mockPath);
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (path === mockPath) return JSON.stringify(mockConfig);
        return '';
      });

      const result = await loadExternalLanguages();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rust');
      expect(result[0].name).toBe('Rust');
      expect(result[0].facts).toEqual([{ it: 'Fact', en: 'Fact' }]);
    });

    test('handles invalid JSON gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

      const result = await loadExternalLanguages();
      expect(result).toEqual([]);
    });

    test('handles missing languages field gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ otherField: 'value' }));

      const result = await loadExternalLanguages();
      expect(result).toEqual([]);
    });
  });
});
