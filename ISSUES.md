# Issues & Miglioramenti del Progetto GithubSlotMachine

**Data analisi:** 2026-07-13  
**Stato progetti:** Il problema #1 (Slot.svg TTL Non Gestito) è stato risolto con l'aggiunta di TTL di 7 giorni per gli SVG salvati in Redis. Il problema #2 (Testing Incompleto - Integrazione ed E2E) è il prossimo da affrontare.  
**Focus:** Nuove criticità identificate e aree di miglioramento avanzato.

---

## 📋 INDICE

1. [Testing Incompleto - Integrazione ed E2E](#1-testing-incompleto---integrazione-ed-e2e)
2. [Nessun CI/CD Pipeline](#2-nessun-cicd-pipeline)
3. [Accessibility Issues](#3-accessibility-issues)
4. [Security - Open Redirect Potential](#4-security---open-redirect-potential)
5. [Nessun Error Tracking](#5-nessun-error-tracking)
6. [Memory Leak Potential in Async Background Tasks](#6-memory-leak-potential-in-async-background-tasks)
7. [Language Config Non Estensibile](#7-language-config-non-estensibile)
8. [SVG Builder Non Modular](#8-svg-builder-non-modular)
9. [State Migration Versioning Assente](#9-state-migration-versioning-assente)
10. [GitHub API Rate Limit Non Tracciato](#10-github-api-rate-limit-non-tracciato)

---

## 1. Testing Incompleto - Integrazione ed E2E

### Stato Attuale
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

### Test Manchanti Critici

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

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per complete flow integration
- [ ] `spin.test.js` - test per GitHub API failure scenarios
- [ ] `spin.test.js` - test per Redis failure scenarios
- [ ] `e2e/spin.e2e.js` - test per browser automation
- [ ] `repos.test.js` - test per language matching
- [ ] `svg-builder.test.js` - test per SVG generation logic

---

## 2. Nessun CI/CD Pipeline

### Descrizione
Il progetto non ha una CI/CD pipeline automatizzata. Solo `npm test` manuale prima di deploy.

### File Correlati
- Nessuna directory `.github/workflows/`
- Nessuna directory `vercel.json` config avanzata
- Nessun `package.json` script per deployment

### Impatto
- **ALTA** - Errori possono essere deployati in produzione senza essere rilevati
- **MEDIA** - Nessun deployment automatico su push a main
- **BASSA** - Nessuna preview deployment per PR

### Mancanti:
1. **GitHub Actions** per:
   - Test automatici su push/PR
   - Linting automatico (ESLint, Prettier)
   - Security scanning (Dependabot, Snyk)
   - Build verification
   - Deployment automatico su Vercel

2. **Vercel Preview Deployments** per ogni PR

3. **Staging Environment** per testing prima di production

### Soluzione Proposta

#### GitHub Actions Workflow
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Run linting
        run: npm run lint
      
      - name: Security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      
      - name: Build
        run: npm run build

  preview:
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Vercel Preview
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

---

## 3. Accessibility Issues

### Descrizione
La slot machine non è accessibile agli utenti con disabilità.

### File Correlati
- `api/_lib/svg-builder.js` - genera SVG senza ARIA labels
- `public/index.html` (se esiste) - nessuna meta accessibility
- CSS animations - nessuna opzione per "reduce motion"

### Problemi Identificati

#### 1. SVG Non ha ARIA Labels
```javascript
// In svg-builder.js:
// SVG generato senza aria-label, aria-describedby, etc.
// Gli screen reader non possono descrivere cosa sta succedendo
```

#### 2. Animazioni Senza Riduzione Movimento
```css
/* In svg-builder.js: */
css += `@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`;
/* Nessuna media query per prefers-reduced-motion */
```

#### 3. Nessun Supporto Screen Reader
- Niente live regions per annunciare win/loss
- Niente ARIA live regions per aggiornamenti dinamici
- Niente focus management

### Soluzione Proposta

#### Aggiungere ARIA Labels agli SVG
```javascript
export function buildSVG({ grid, uid, state, winningLang, fact, repoMatch, owner }) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     role="img" 
     aria-label="Slot machine: ${state.totalSpins} spins total"
     viewBox="0 0 600 400">
  <title>Slot Machine - ${owner}</title>
  <desc>
    This is an interactive slot machine. 
    Total spins: ${state.totalSpins}. 
    ${winningLang ? `Last win: ${winningLang.name}` : ''}
  </desc>
  <!-- ... existing content ... -->
</svg>`;
  
  return svg;
}
```

#### Aggiungere Opzione per Ridurre Movimento
```css
/* In svg-builder.js: */
css += `
  @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
  
  @media (prefers-reduced-motion: reduce) {
    @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(0deg)}}
  }
`;
```

### Test Case da Aggiungere
- [ ] `svg-builder.test.js` - test per ARIA labels
- [ ] `e2e/accessibility.e2e.js` - test per screen reader compatibility

---

## 4. Security - Open Redirect Potential

### Descrizione
La funzione di redirect dopo uno spin potrebbe essere vulnerabile a open redirect attacks.

### File Correlato
- `api/spin.js` - redirect logic

### Impatto
- **ALTA** - Attacchi di phishing possono usare la trust del dominio principale

### Scenario di Failure
```javascript
// Se l'URL di redirect è controllato dall'utente senza validation
const redirectUrl = req.query.redirect; // Male!
return NextResponse.redirect(redirectUrl);
```

### Soluzione Proposta
```javascript
// Validare che l'URL sia nello stesso dominio
const redirectUrl = new URL(req.query.redirect || '/', req.url);
if (redirectUrl.origin !== req.url.split('/')[2]) {
  return NextResponse.redirect('/');
}
return NextResponse.redirect(redirectUrl.toString());
```

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per open redirect prevention

---

## 5. Nessun Error Tracking

### Descrizione
Il progetto non ha error tracking (Sentry, LogRocket, etc.).

### File Correlati
- Nessuna configurazione di error tracking

### Impatto
- **MEDIA** - Difficile debug di errori in produzione
- **BASSA** - Nessuna visibilità su errori degli utenti

### Soluzione Proposta

#### Integrazione Sentry
```bash
npm install @sentry/nextjs
```

```javascript
// sentry.config.js
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

### Test Case da Aggiungere
- [ ] Integrazione manual test in produzione

---

## 6. Memory Leak Potential in Async Background Tasks

### Descrizione
Le funzioni asincrone che gestiscono state e Redis potrebbero non gestire correttamente gli errori, causando memory leak.

### File Correlato
- `api/_lib/state.js` - state management

### Scenario di Failure
```javascript
// Se Redis fallisce e non viene gestito l'errore
await kvSet(STATE_KEY, state); // Potrebbe non risolversi mai
```

### Soluzione Proposta
```javascript
// Aggiungere timeout e fallback
const timeout = setTimeout(() => {
  console.warn('KV write timeout, falling back to GitHub');
  writeStateGitHub(token, owner, repo, state);
}, 200);

try {
  await kvSet(STATE_KEY, state);
  clearTimeout(timeout);
} catch (err) {
  clearTimeout(timeout);
  await writeStateGitHub(token, owner, repo, state);
}
```

### Test Case da Aggiungere
- [ ] `state.test.js` - test per timeout handling
- [ ] `kv.test.js` - test per error fallback

---

## 7. Language Config Non Estensibile

### Descrizione
Il configuration delle lingue è hardcoded, non supporta lingue custom o configurazioni dinamiche.

### File Correlato
- `api/_lib/languages.js` - language definitions

### Impatto
- **MEDIA** - Nuove lingue richiedono code changes
- **BASSA** - Nessuna way per aggiungere repo specifici per lingue

### Soluzione Proposta
```javascript
// Language config esterno (JSON o YAML)
const LANGUAGE_CONFIG = {
  default: ['en', 'it'],
  priority: {
    'python': ['en'],
    'rust': ['en'],
  },
  custom: {
    // Mappatura custom repo → lingua
    'org/custom-repo': 'fr'
  }
};
```

### Test Case da Aggiungere
- [ ] `languages.test.js` - test per config estensibile

---

## 8. SVG Builder Non Modular

### Descrizione
Il SVG builder è un singolo file monolitico che genera tutto il codice SVG.

### File Correlato
- `api/_lib/svg-builder.js`

### Impatto
- **MEDIA** - Difficile manutenzione e testing
- **BASSA** - Logica di business mescolata con rendering

### Soluzione Proposta
```javascript
// Split in moduli separati
export { buildGrid } from './svg-grid.js';
export { buildAnimations } from './svg-animations.js';
export { buildIcons } from './svg-icons.js';
export { buildSVG } from './svg-builder.js';
```

### Test Case da Aggiungere
- [ ] `svg-grid.test.js` - test per grid generation
- [ ] `svg-animations.test.js` - test per animations
- [ ] `svg-icons.test.js` - test per icons

---

## 9. State Migration Versioning Assente

### Descrizione
Se la struttura dello stato cambia (nuovi campi, rename), non c'è way per migrare lo stato esistente.

### File Correlato
- `api/_lib/state.js` - state definitions

### Impatto
- **MEDIA** - Breaking changes rompono state esistente
- **BASSA** - Niente rollback o migration path

### Soluzione Proposta
```javascript
const STATE_VERSION = 2;

export async function readState(token, owner, repo) {
  const { state, sha } = await readStateInternal(token, owner, repo);
  
  // Migrate if version mismatch
  if (state.version < STATE_VERSION) {
    return { state: migrateState(state, state.version), sha };
  }
  
  return { state, sha };
}

function migrateState(state, fromVersion) {
  if (fromVersion === 1) {
    // Migrate da versione 1 a 2
    return { ...state, version: 2, newField: defaultValue };
  }
  return state;
}
```

### Test Case da Aggiungere
- [ ] `state-migration.test.js` - test per state migration
- [ ] `state-migration.test.js` - test per version compatibility

---

## 10. GitHub API Rate Limit Non Tracciato

### Descrizione
Il progetto non traccia i rate limit di GitHub API, rischiando di esaurire le chiamate.

### File Correlato
- `api/_lib/github.js` - API calls

### Impatto
- **ALTA** - Rate limit exhaustion blocca tutti gli spin
- **MEDIA** - Nessuna way per prevedere quando raggiungere il limite

### Scenario di Failure
```
GitHub API: 5000/hour per authenticated user
User spins → 5000 calls → 403 Forbidden → Slot down
```

### Soluzione Proposta

#### Tracciare Rate Limit Header
```javascript
export async function ghGet(token, owner, repo, path) {
  const r = await fetch(...);
  
  // Parse rate limit headers
  const remaining = r.headers.get('X-RateLimit-Remaining');
  const reset = r.headers.get('X-RateLimit-Reset');
  
  if (remaining === '0') {
    console.warn(`GitHub API rate limit reached, reset at ${reset}`);
    // Queue requests until reset
  }
  
  return r.ok ? r.json() : null;
}
```

#### Implementare Request Queue
```javascript
class RateLimitQueue {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.requests = [];
  }
  
  async add(fn) {
    // Wait if at limit
    await this.waitForSlot();
    const result = await fn();
    this.requests.push(Date.now());
    return result;
  }
}
```

### Test Case da Aggiungere
- [ ] `github.test.js` - test per rate limit handling
- [ ] `ratelimit.test.js` - test per request queue

---
