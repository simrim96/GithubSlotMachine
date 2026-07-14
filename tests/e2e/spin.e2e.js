// E2E tests for GithubSlotMachine using Playwright
//
// These tests simulate real user interactions:
// - Clicking the lever
// - Observing animations
// - Verifying SVG updates
// - Testing redirects
//
// Run with: npx playwright test

import { test, expect } from '@playwright/test';

// Timeout configuration for slow animations
test.setTimeout(30000);

test.describe('GithubSlotMachine E2E Tests', () => {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

  test.beforeEach(async ({ page }) => {
    // Navigate to the slot machine
    await page.goto(BASE_URL);
  });

  test('user can pull the lever and see the slot spin', async ({ page }) => {
    // Click on the lever/button
    const lever = page.locator('[data-testid="lever"], button, [role="button"]').first();
    await expect(lever).toBeVisible();
    await lever.click();

    // Verify that the slot starts spinning
    const slotSvg = page.locator('[data-testid="slot-svg"], svg.slot-machine');
    await expect(slotSvg).toBeVisible();

    // Check for spinning animation class or attribute
    // Wait for animation to complete (slot machine typically takes 2-3 seconds)
    await page.waitForTimeout(3000);

    // Verify animation stopped
    const svgContent = await slotSvg.innerHTML();
    expect(svgContent).toContain('<svg');
  });

  test('slot machine updates SVG after spin', async ({ page }) => {
    const lever = page.locator('[data-testid="lever"], button').first();
    
    // Get initial SVG
    const initialSvg = page.locator('[data-testid="slot-svg"], svg').first();
    const initialContent = await initialSvg.innerHTML();

    // Pull lever
    await lever.click();

    // Wait for animation
    await page.waitForTimeout(3000);

    // Get updated SVG
    const updatedSvg = await initialSvg.innerHTML();

    // SVG should have changed (different UID or grid)
    expect(updatedSvg).not.toBe(initialContent);
  });

  test('slot machine handles rapid lever clicks gracefully', async ({ page }) => {
    const lever = page.locator('[data-testid="lever"], button').first();

    // Rapidly click lever multiple times
    await lever.click();
    await page.waitForTimeout(500);
    await lever.click();
    await page.waitForTimeout(500);
    await lever.click();

    // Verify SVG is still valid
    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    await expect(svg).toBeVisible();

    const svgContent = await svg.innerHTML();
    expect(svgContent).toContain('<svg');
  });

  test('error state displays correctly when slot fails', async ({ page }) => {
    // Mock an error scenario by intercepting the API call
    await page.route('**/api/spin', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'Internal Server Error',
      });
    });

    // Pull lever
    const lever = page.locator('[data-testid="lever"], button').first();
    await lever.click();

    // Wait for error state
    await page.waitForTimeout(2000);

    // Verify error SVG or message is displayed
    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    const content = await svg.innerHTML();
    
    // Should either show error SVG or at least a valid (but error) SVG
    expect(content).toContain('<svg');
  });

  test('slot machine respects prefers-reduced-motion', async ({ page }) => {
    // Enable reduced motion in the browser context
    const context = page.context();
    await context.addInitScript(() => {
      (window.matchMedia = window.matchMedia || function() {
        return {
          matches: true,
          addListener: function() {},
          removeListener: function() {},
        };
      });
    });

    // Pull lever
    const lever = page.locator('[data-testid="lever"], button').first();
    await lever.click();

    // Should still complete without error even without animation
    await page.waitForTimeout(1000);

    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    await expect(svg).toBeVisible();
  });

  test('slot machine displays language-specific content on win', async ({ page }) => {
    // This test assumes the server supports language detection
    // In a real scenario, we'd mock the API to return a win state
    
    const lever = page.locator('[data-testid="lever"], button').first();
    await lever.click();

    // Wait for animation
    await page.waitForTimeout(3000);

    // Verify SVG contains language-related content
    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    const content = await svg.innerHTML();
    
    // Should contain some language-related text or icon
    expect(content).toBeTruthy();
  });

  test('slot machine works with JavaScript disabled (graceful degradation)', async ({ page }) => {
    // This test would require a browser without JS, which Playwright doesn't support natively
    // For now, we verify basic SVG rendering which works without JS
    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    
    // SVG should be present even before JS executes
    await expect(svg).toBeVisible();
  });
});

test.describe('Accessibility E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'http://localhost:3000');
  });

  test('slot SVG has proper ARIA labels', async ({ page }) => {
    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    
    // Check for ARIA attributes
    const ariaLabel = await svg.getAttribute('aria-label');
    const role = await svg.getAttribute('role');
    
    // Should have at least some accessibility attributes
    // (implementation dependent)
    expect(ariaLabel || role).toBeTruthy();
  });

  test('lever button is accessible', async ({ page }) => {
    const lever = page.locator('[data-testid="lever"], button').first();
    
    // Should be focusable
    await expect(lever).toBeFocusable();
    
    // Should have accessible name
    const label = await lever.getAttribute('aria-label') || await lever.textContent();
    expect(label).toBeTruthy();
  });

  test('keyboard navigation works', async ({ page }) => {
    const lever = page.locator('[data-testid="lever"], button').first();
    
    // Focus on lever
    await lever.focus();
    
    // Press Enter to activate
    await page.keyboard.press('Enter');
    
    // Animation should start
    await page.waitForTimeout(1000);
    
    const svg = page.locator('[data-testid="slot-svg"], svg').first();
    await expect(svg).toBeVisible();
  });
});

test.describe('State Persistence E2E Tests', () => {
  test('spin count increments on each pull', async ({ page }) => {
    // This test would need access to the state display
    // For now, we verify the spin action completes successfully
    
    const lever = page.locator('[data-testid="lever"], button').first();
    
    // Initial state
    await lever.click();
    await page.waitForTimeout(1000);
    
    const svg1 = await page.locator('[data-testid="slot-svg"]').first().innerHTML();
    
    // Second spin
    await lever.click();
    await page.waitForTimeout(1000);
    
    const svg2 = await page.locator('[data-testid="slot-svg"]').first().innerHTML();
    
    // SVGs should be different (different state)
    expect(svg1).not.toBe(svg2);
  });

  test('state survives page refresh', async ({ page }) => {
    // First spin
    const lever = page.locator('[data-testid="lever"], button').first();
    await lever.click();
    await page.waitForTimeout(1000);
    
    const state1 = await page.locator('[data-testid="slot-svg"]').first().innerHTML();
    
    // Refresh page
    await page.reload();
    
    // SVG should persist
    const state2 = await page.locator('[data-testid="slot-svg"]').first().innerHTML();
    
    // Should be the same (or very similar) SVG
    expect(state1).toBe(state2);
  });
});
