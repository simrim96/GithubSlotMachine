import { describe, test, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadExternalLanguages } from '../api/_lib/config-loader.js';

describe('config-loader debug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('debug path matching', async () => {
    const mockPath = 'languages-external.json';
    
    const originalExistsSync = vi.fn((path) => {
      console.log('[DEBUG] existsSync called with:', path);
      console.log('[DEBUG] Does it end with mockPath?', path?.endsWith(mockPath));
      return typeof path === 'string' && path.endsWith(mockPath);
    });
    
    vi.mocked(existsSync).mockImplementation(originalExistsSync);
    
    const result = await loadExternalLanguages();
    console.log('[DEBUG] Result:', result);
    expect(result).toHaveLength(0);
  });
});
