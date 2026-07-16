import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { loadExternalLanguages } from '../api/_lib/config-loader.js';

describe('vi mock test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('use vi.spyOn instead', async () => {
    const mockFn = vi.fn((path) => {
      console.log('[SPY] existsSync called with:', path);
      return false;
    });
    
    vi.spyOn(fs, 'existsSync').mockImplementation(mockFn);
    
    const result = await loadExternalLanguages();
    console.log('[RESULT] Result:', result);
    expect(result).toEqual([]);
  });
});
