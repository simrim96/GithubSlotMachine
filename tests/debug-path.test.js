import { describe, test, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadExternalLanguages } from '../api/_lib/config-loader.js';

describe('config-loader path debug', () => {
  test('check what path is passed', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      console.log('[PATH DEBUG] existsSync called with:', path);
      console.log('[PATH DEBUG] typeof path:', typeof path);
      return false;
    });
    
    const result = await loadExternalLanguages();
    console.log('[PATH DEBUG] Result:', result);
    expect(result).toEqual([]);
  });
});
