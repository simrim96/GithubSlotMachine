// E2E tests for GithubSlotMachine using Playwright.
//
// These drive the REAL UI served by scripts/preview-server.mjs (or `npm start`).
// The page is public/index.html: an <img id="slot-svg"> whose src points at the
// /api/image endpoint (which builds the slot SVG) and a <button id="spin-btn">
// that reloads that image with a cache-busting query param.
//
// Run with:  npm run test:e2e
// (playwright.config.js boots the preview server automatically via webServer)

/* eslint-env browser */
import { test, expect } from '@playwright/test';

test.describe('GithubSlotMachine E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the slot SVG renders on page load', async ({ page }) => {
    const slot = page.locator('#slot-svg');
    await expect(slot).toBeVisible();

    // The image must resolve to a real SVG, not a broken 404.
    const src = await slot.getAttribute('src');
    expect(src).toBeTruthy();

    // Wait for the image to actually load (naturalWidth > 0).
    await expect
      .poll(async () => slot.evaluate((el) => el.naturalWidth), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);
  });

  test('the spin button is present and accessible', async ({ page }) => {
    const lever = page.locator('#spin-btn');
    await expect(lever).toBeVisible();
    await expect(lever).toBeEnabled();

    // Focusable: focusing it should make it the active element.
    await lever.focus();
    await expect(lever).toBeFocused();

    const label =
      (await lever.getAttribute('aria-label')) || (await lever.textContent());
    expect(label).toBeTruthy();
  });

  test('clicking the lever triggers a real spin (requests /api/spin)', async ({
    page,
  }) => {
    const slot = page.locator('#slot-svg');

    // TASK-2 fix: the lever now performs a REAL spin via /api/spin (a full
    // navigation), not a no-op image reload. The preview server answers
    // /api/spin with a 302 back to the slot page, so a successful spin is
    // detected by (a) the /api/spin request firing and (b) the slot still
    // rendering after the redirect.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/spin'), {
        timeout: 10000,
      }),
      page.locator('#spin-btn').click(),
    ]);

    expect(response.status()).toBe(302);

    // The slot must still be present and valid after the redirect back.
    await page.waitForLoadState('load');
    await expect(slot).toBeVisible();
    await expect
      .poll(async () => slot.evaluate((el) => el.naturalWidth), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);
  });

  test('slot SVG carries accessibility attributes', async ({ page }) => {
    const slot = page.locator('#slot-svg');
    await expect(slot).toBeVisible();

    const alt = await slot.getAttribute('alt');
    expect(alt).toBeTruthy();

    // The SVG document itself exposes role="img" + aria-label once loaded.
    const role = await slot.getAttribute('role');
    expect(role).toBe('img');
  });

  test('prefers-reduced-motion does not break the UI', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.matchMedia =
        window.matchMedia ||
        function () {
          return { matches: true, addListener() {}, removeListener() {} };
        };
    });

    await page.goto('/');
    const slot = page.locator('#slot-svg');
    await expect(slot).toBeVisible();

    // Reduced-motion must not break the real-spin path: the lever still fires
    // /api/spin (302 -> back to slot) and the slot still renders.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/spin'), {
        timeout: 10000,
      }),
      page.locator('#spin-btn').click(),
    ]);
    expect(response.status()).toBe(302);

    await page.waitForLoadState('load');
    await expect(slot).toBeVisible();
    await expect
      .poll(async () => slot.evaluate((el) => el.naturalWidth), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);
  });

  test('slot SVG changes between two consecutive GIRA ORA spins', async ({
    page,
  }) => {
    // TASK-2 acceptance test. The original bug: the GIRA ORA button only
    // reloaded the *existing* image (api/image?v=Date.now()) and never called
    // /api/spin, so the slot never advanced — the same reels showed forever.
    // Now GIRA ORA performs a real spin (window.location.assign('/api/spin'))
    // and the preview server rewrites the persisted slot, so two consecutive
    // spins MUST produce two different slot SVGs.
    const slot = page.locator('#slot-svg');

    // Wait for the first slot to render.
    await expect
      .poll(async () => slot.evaluate((el) => el.naturalWidth), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);

    // Capture the full SVG markup of the current slot.
    const svgOf = () =>
      slot.evaluate(async (el) => {
        const res = await fetch(el.currentSrc || el.src, {
          cache: 'no-store',
        });
        const text = await res.text();
        return text;
      });

    const before = await svgOf();

    // Fire the second spin by clicking GIRA ORA (real /api/spin + 302).
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/spin'), {
        timeout: 10000,
      }),
      page.locator('#spin-btn').click(),
    ]);
    expect(response.status()).toBe(302);

    // After the redirect back to '/', the slot re-renders the NEW spin.
    await page.waitForLoadState('load');
    await expect(slot).toBeVisible();
    await expect
      .poll(async () => slot.evaluate((el) => el.naturalWidth), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);

    const after = await svgOf();

    // The two spins must not be byte-identical — this is the actual
    // regression guard for TASK-2 (repeated reels).
    expect(after).not.toEqual(before);
  });

  test('keyboard activation (Enter) triggers a spin', async ({ page }) => {
    const slot = page.locator('#slot-svg');

    await page.locator('#spin-btn').focus();

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/spin'), {
        timeout: 10000,
      }),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBe(302);

    await page.waitForLoadState('load');
    await expect(slot).toBeVisible();
    await expect
      .poll(async () => slot.evaluate((el) => el.naturalWidth), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);
  });
});
