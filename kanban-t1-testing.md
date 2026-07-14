# Task T1: Testing - Integration & E2E Tests

## Stato
- Task ID: `t_7f2937fd`
- Assignee: `default`
- Stato: `running`

## Dettaglio Completo

### Problema Attuale
- **67 test** per ~15 moduli
- Solo test su logica pura (no network, no Redis reale, no GitHub API reale)
- Nessun integration test per flow completo
- Nessun e2e test (browser automation)

### Test Coverage Mappatura

| Modulo | Test Esistente? | Copertura |
|--------|-----------------|-----------|
| `game.js` | ✅ `game.test.js` | 85% (logica principale) |
| `languages.js` | ❌ | 0% |
| `svg-builder.js` | ❌ | 0% (solo structure, no logic) |
| `github.js` | ✅ `github.test.js` | 20% (solo markdown escaping) |
| `repos.js` | ❌ | 0% |
| `kv.js` | ✅ `kv.test.js` | 50% (solo wrapper) |
| `ratelimit.js` | ✅ `ratelimit.test.js` | 80% (rate limiting) |
| `spin.js` | ❌ | 0% (nessun test per flow completo) |
| `state.js` | ✅ `state-local.test.js` | 40% (solo local fallback) |

### Test Case da Aggiungere

#### 1. Integration Test per spin.js
```javascript
// spin.test.js
describe('spin.js integration', () => {
  it('complete spin flow: grid → SVG → state save → redirect', async () => {
    // Mock tutti i dependencies (Redis, GitHub API, etc.)
    // Verifica che il flow completo funzioni correttamente
  });
  
  it('handles GitHub API 404 gracefully', async () => {
    // Simula GitHub API che restituisce 404
    // Verifica che lo slot continui a funzionare
  });
  
  it('handles Redis timeout gracefully', async () => {
    // Simula Redis timeout
    // Verifica che il fallback GitHub venga usato
  });
});
```

#### 2. E2E Test con Playwright
```javascript
// e2e/spin.e2e.js
import { test, expect } from '@playwright/test';

test('user can pull the lever and see the slot spin', async ({ page }) => {
  await page.goto('https://github-slot-machine.vercel.app');
  
  // Clicca sul lever
  await page.click('[data-testid="lever"]');
  
  // Verifica che la slot inizi a girare
  await expect(page.locator('[data-testid="reel"]')).toHaveClass(/spinning/);
  
  // Verifica che l'animazione si fermi
  await page.waitForTimeout(3000);
  await expect(page.locator('[data-testid="reel"]')).not.toHaveClass(/spinning/);
  
  // Verifica che l'SVG sia aggiornato
  const svg = await page.locator('[data-testid="slot-svg"]').innerHTML();
  expect(svg).toContain('<svg');
});
```

### File da Creare
- [ ] `api/_lib/spin.test.js` - test per complete flow integration
- [ ] `api/_lib/spin.test.js` - test per GitHub API failure scenarios
- [ ] `api/_lib/spin.test.js` - test per Redis failure scenarios
- [ ] `e2e/spin.e2e.js` - test per browser automation
- [ ] `api/_lib/repos.test.js` - test per language matching
- [ ] `api/_lib/svg-builder.test.js` - test per SVG generation logic

### Acceptance Criteria
- [ ] spin.js: 0% → 90% coverage
- [ ] repos.js: 0% → 100% coverage
- [ ] svg-builder.js: 0% → 100% coverage
- [ ] Playwright E2E tests pass on CI
- [ ] All existing tests still pass

### Note
Inizia esaminando la struttura dei test attuale:
- `__tests__/` or `test/` directory
- `game.test.js`, `github.test.js`, `kv.test.js`, `ratelimit.test.js`, `state-local.test.js`
