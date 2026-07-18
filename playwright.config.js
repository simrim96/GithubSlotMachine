// Playwright configuration for the GithubSlotMachine E2E suite.
//
// The `webServer` block boots the dependency-free preview server
// (scripts/preview-server.mjs) before the tests run and tears it down
// afterwards. This means `npm run test:e2e` works locally AND in CI without
// needing `vercel dev` (which requires Vercel auth) or any network access.
//
// CI must install the browser binaries first — see .github/workflows/ci.yml
// (`npx playwright install --with-deps chromium`).

import { defineConfig, devices } from '@playwright/test';

// PORT drives both the preview server and the base URL so they stay in sync.
// Override with PORT=4173 (and optionally BASE_URL) to run alongside other
// local servers.
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.js',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Boots the preview server automatically. `reuseExistingServer` lets a dev
  // reuse a manually-started server when not in CI.
  webServer: {
    command: `node scripts/preview-server.mjs ${PORT}`,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
