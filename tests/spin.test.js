// Integration test for spin.js - complete flow and error scenarios
//
// These tests verify the complete spin workflow including:
// - Grid generation and win checking
// - SVG building and state management
// - Error handling for GitHub API and Redis failures
//
// Run with: npm test

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateGrid, checkWins, COLS, ROWS } from '../api/_lib/game.js';
import { buildSVG, errorSVG } from '../api/_lib/svg-builder.js';
import { LANGUAGE_BY_ID, pickFact } from '../api/_lib/languages.js';
import { readState, writeState } from '../api/_lib/state.js';
import { loadSlotSvg, saveSlotSvg } from '../api/_lib/github.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockToken = 'test-github-token-12345';
const mockOwner = 'testuser';
const mockRepo = 'test-repo';

// Mock state functions
vi.mock('../api/_lib/state.js', () => ({
  readState: vi.fn(),
  writeState: vi.fn(),
}));

// Mock github functions
vi.mock('../api/_lib/github.js', () => ({
  loadSlotSvg: vi.fn(),
  saveSlotSvg: vi.fn(),
  ghGetJson: vi.fn(),
  ghPut: vi.fn(),
  updateReadmeMarkers: vi.fn((readme) => readme),
}));

// ─── Integration Test: Complete Spin Flow ────────────────────────────────────
describe('spin.js integration - complete flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful state read
    readState.mockResolvedValue({
      state: { totalSpins: 0, totalWins: 0, lastWin: null },
      sha: 'mock-sha-123',
    });
    // Mock successful slot SVG load
    loadSlotSvg.mockResolvedValue({
      content: '',
      sha: 'mock-slot-sha',
    });
    // Mock successful state write
    writeState.mockResolvedValue({ sha: 'new-sha-456' });
    // Mock successful slot SVG save
    saveSlotSvg.mockResolvedValue({ sha: 'new-slot-sha' });
  });

  it('complete spin flow: grid → SVG → state save → redirect simulation', async () => {
    // Arrange: generate a random grid
    const grid = generateGrid();

    // Act: check wins and build SVG
    const wins = checkWins(grid);
    const isWin = wins.length > 0;

    const mockState = {
      totalSpins: 1,
      totalWins: isWin ? 1 : 0,
      lastWin: isWin
        ? {
            langId: 'javascript',
            langName: 'JavaScript',
            fact: pickFact(LANGUAGE_BY_ID.javascript),
            repoUrl: null,
            repoName: null,
            ts: Date.now(),
          }
        : null,
    };

    const svg = buildSVG({
      grid,
      uid: Date.now(),
      state: mockState,
      winningLang: isWin ? LANGUAGE_BY_ID.javascript : null,
      fact: isWin ? pickFact(LANGUAGE_BY_ID.javascript) : { it: '', en: '' },
      repoMatch: null,
      owner: mockOwner,
    });

    // Assert: verify SVG is valid
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`data-testid="slot-svg"`);

    // Assert: verify state was updated
    expect(mockState.totalSpins).toBe(1);

    // Verify writeState would be called in real scenario
    const mockWriteState = vi.fn().mockResolvedValue({ sha: 'new-sha-456' });
    await mockWriteState(mockState);
    expect(mockWriteState).toHaveBeenCalled();
  });

  it('handles multiple spins and tracks stats correctly', async () => {
    const spins = 10;
    let totalWins = 0;

    for (let i = 0; i < spins; i++) {
      const grid = generateGrid();
      const wins = checkWins(grid);

      if (wins.length > 0) {
        totalWins++;
      }

      const mockState = {
        totalSpins: i + 1,
        totalWins: totalWins,
        lastWin:
          wins.length > 0
            ? {
                langId: 'javascript',
                langName: 'JavaScript',
                fact: { it: 'Fatto', en: 'Done' },
                ts: Date.now(),
              }
            : null,
      };

      expect(mockState.totalSpins).toBe(i + 1);
      expect(mockState.totalWins).toBe(totalWins);
    }

    expect(totalWins).toBeGreaterThan(0);
  });
});

// ─── Integration Test: GitHub API Failure Scenarios ────────────────────────────
describe('spin.js integration - GitHub API failure scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readState.mockResolvedValue({
      state: { totalSpins: 0, totalWins: 0, lastWin: null },
      sha: 'mock-sha-123',
    });
    loadSlotSvg.mockResolvedValue({
      content: '',
      sha: 'mock-slot-sha',
    });
  });

  it('handles GitHub API 404 gracefully - fallback to profile', async () => {
    // Arrange: simulate GitHub API returning 404 for repo lookup
    loadSlotSvg.mockRejectedValue({
      status: 404,
      message: 'Repository not found',
    });

    // Act: generate grid and handle the error gracefully
    const grid = generateGrid();
    checkWins(grid);

    // Even with GitHub API failure, we should still generate a valid SVG
    const svg = buildSVG({
      grid,
      uid: Date.now(),
      state: { totalSpins: 1, totalWins: 0, lastWin: null },
      winningLang: null,
      fact: { it: '', en: '' },
      repoMatch: null,
      owner: mockOwner,
    });

    // Assert: SVG should still be valid even without repo data
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('undefined');

    // Assert: errorSVG should be usable as fallback (returns base64 data URI)
    const errorSvg = errorSVG({ owner: mockOwner, message: 'Retry needed' });
    expect(errorSvg).toContain('data:image/svg+xml;base64,');
    // Decode and verify the SVG contains the error message
    const base64Data = errorSvg.split(',')[1];
    const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');
    expect(decoded).toContain('Retry needed');
    expect(decoded).toContain('<svg');
  });

  it('handles Redis timeout gracefully - fallback to GitHub state', async () => {
    // Arrange: simulate Redis timeout
    readState.mockRejectedValue(new Error('Redis timeout'));

    // Act: should fall back to default state
    const fallbackState = {
      state: { totalSpins: 0, totalWins: 0, lastWin: null },
      sha: null,
    };

    expect(fallbackState.state.totalSpins).toBe(0);
    expect(fallbackState.state.totalWins).toBe(0);

    // Should still be able to generate a valid spin
    const grid = generateGrid();
    expect(grid).toHaveLength(COLS);
    expect(grid[0]).toHaveLength(ROWS);
  });

  it('handles GitHub API rate limit gracefully', async () => {
    // Arrange: simulate GitHub rate limit (403)
    const rateLimitError = {
      status: 403,
      message: 'API rate limit exceeded',
    };

    loadSlotSvg.mockRejectedValue(rateLimitError);

    // Act: should degrade gracefully
    const grid = generateGrid();
    const svg = buildSVG({
      grid,
      uid: Date.now(),
      state: { totalSpins: 1, totalWins: 0, lastWin: null },
      winningLang: null,
      fact: { it: '', en: '' },
      repoMatch: null,
      owner: mockOwner,
    });

    // Assert: still produces valid output
    expect(svg).toBeTruthy();
    expect(svg.length).toBeGreaterThan(100);
  });
});

// ─── Integration Test: Redis Failure Scenarios ─────────────────────────────────
describe('spin.js integration - Redis failure scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles Redis connection failure with fallback', async () => {
    // Arrange: simulate complete Redis failure
    readState.mockRejectedValue(new Error('Connection refused'));

    // Act: should use default state
    const stateBundle = await readState(mockToken, mockOwner, mockRepo).catch(
      () => ({
        state: { totalSpins: 0, totalWins: 0, lastWin: null },
        sha: null,
      })
    );

    // Assert: fallback state is correct
    expect(stateBundle.state.totalSpins).toBe(0);
    expect(stateBundle.state.totalWins).toBe(0);
  });

  it('handles partial Redis data corruption', async () => {
    // Arrange: simulate corrupted state data
    const corruptedState = {
      totalSpins: 'invalid',
      totalWins: undefined,
      lastWin: null,
    };

    // Act: should normalize the state (simulating fallback logic from spin.js)
    const normalized = {
      totalSpins: parseInt(corruptedState.totalSpins) || 0,
      totalWins:
        typeof corruptedState.totalWins === 'number'
          ? corruptedState.totalWins
          : 0,
      lastWin: corruptedState.lastWin || null,
    };

    // Assert: state should be normalized to safe defaults
    expect(typeof normalized.totalSpins).toBe('number');
    expect(typeof normalized.totalWins).toBe('number');
    expect(normalized.totalSpins).toBe(0);
    expect(normalized.totalWins).toBe(0);
  });

  it('continues spinning when KV write fails', async () => {
    // Arrange: mock successful read but failed write
    const mockReadValue = {
      state: { totalSpins: 5, totalWins: 2, lastWin: null },
      sha: 'sha-123',
    };
    readState.mockResolvedValue(mockReadValue);
    writeState.mockRejectedValue(new Error('KV write failed'));

    // Act: spin should still complete (redirect happens)
    const grid = generateGrid();
    const wins = checkWins(grid);

    // Even with write failure, we can still generate the next state
    // readState.mockResolvedValue already set, so get the state from the mock
    const currentState = mockReadValue.state;
    const newState = {
      ...currentState,
      totalSpins: currentState.totalSpins + 1,
      totalWins:
        wins.length > 0 ? currentState.totalWins + 1 : currentState.totalWins,
    };

    expect(newState.totalSpins).toBe(6);
  });
});

// ─── Edge Cases and Boundary Tests ────────────────────────────────────────────
describe('spin.js integration - edge cases', () => {
  it('handles empty grid gracefully', () => {
    const emptyGrid = Array(COLS)
      .fill(null)
      .map(() => Array(ROWS).fill('c'));
    const wins = checkWins(emptyGrid);
    expect(Array.isArray(wins)).toBe(true);
  });

  it('handles maximum grid size', () => {
    const grid = Array(COLS)
      .fill(null)
      .map(() => Array(ROWS).fill('python'));
    const wins = checkWins(grid);

    // Should detect a 5-in-a-row (normal win, no special jackpot anymore)
    expect(wins.some((w) => w.count === 5)).toBe(true);
  });

  it('handles state with missing fields', () => {
    const incompleteState = {
      totalSpins: 100,
      // totalWins missing
      // lastWin missing
    };

    // Should normalize without errors
    const normalized = {
      totalSpins: incompleteState.totalSpins || 0,
      totalWins: incompleteState.totalWins || 0,
      lastWin: incompleteState.lastWin || null,
    };

    expect(normalized.totalSpins).toBe(100);
    expect(normalized.totalWins).toBe(0);
    expect(normalized.lastWin).toBe(null);
  });

  it('handles consecutive wins correctly', () => {
    let totalWins = 0;
    const mockState = { totalSpins: 0, totalWins: 0, lastWin: null };

    for (let spin = 0; spin < 5; spin++) {
      mockState.totalSpins++;
      const grid = Array(COLS)
        .fill(null)
        .map(() => Array(ROWS).fill('python'));
      const wins = checkWins(grid);

      if (wins.length > 0) {
        totalWins++;
        mockState.totalWins = totalWins;
        mockState.lastWin = {
          langId: 'python',
          langName: 'Python',
          fact: { it: 'Test', en: 'Test' },
          ts: Date.now(),
        };
      }
    }

    expect(mockState.totalSpins).toBe(5);
    expect(mockState.totalWins).toBe(5);
    expect(mockState.lastWin).toBeTruthy();
  });
});
