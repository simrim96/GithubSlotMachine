# Issues & Miglioramenti del Progetto GithubSlotMachine

**Data analisi:** 2026-07-13  
**Stato progetti:** I problemi principali (state su GitHub, error handling, test coverage) sono stati risolti.  
**Focus:** Nuove criticità identificate e aree di miglioramento avanzato.

---

## 📋 INDICE

1. [Silent Failure nel README Background Update](#1-silent-failure-nel-readme-background-update)
2. [Nessun Monitoring/Analytics](#2-nessun-monitoringanalytics)
3. [Circuit Breaker per GitHub API Assente](#3-circuit-breaker-per-github-api-assente)
4. [State Sync Race Condition](#4-state-sync-race-condition)
5. [Slot.svg TTL Non Gestito](#5-slotsvg-ttl-non-gestito)
6. [Testing Incompleto - Integrazione ed E2E](#6-testing-incompleto---integrazione-ed-e2e)
7. [Nessun CI/CD Pipeline](#7-nessun-cicd-pipeline)
8. [Accessibility Issues](#8-accessibility-issues)
9. [Security - Open Redirect Potential](#9-security---open-redirect-potential)
10. [Nessun Error Tracking](#10-nessun-error-tracking)
11. [Memory Leak Potential in Async Background Tasks](#11-memory-leak-potential-in-async-background-tasks)
12. [Language Config Non Estensibile](#12-language-config-non-estensibile)
13. [SVG Builder Non Modular](#13-svg-builder-non-modular)
14. [State Migration Versioning Assente](#14-state-migration-versioning-assente)
15. [GitHub API Rate Limit Non Tracciato](#15-github-api-rate-limit-non-tracciato)

---

## 1. Silent Failure nel README Background Update ⚠️

### Descrizione
L'aggiornamento del README avviene in un IIFE asincrono (`async () => { ... }()`) in spin.js (righe 152-168). Se fallisce, il failure è silenzioso:
- `console.warn('readme background update skipped:', e.message)` viene stampato
- Ma non c'è way per l'admin di sapere che il README non si è aggiornato
- Se fallisce ripetutamente, il README rimane vecchio indefinitamente

### File Correlato
- `api/spin.js` - righe 152-168

### Impatto
- **MEDIUM** - L'utente finale non vede i marker aggiornati, ma lo slot continua a funzionare
- **BASSA** - Il fallback su slot.svg persiste comunque, solo il README è vecchio

### Scenario di Fallimento
```javascript
(async () => {
  try {
    const rf = await ghGet(token, PROFILE_REPO, 'README.md');
    if (!rf) return; // Fallisce silenzioso se README non esiste
    // ...
  } catch (e) {
    console.warn('readme background update skipped:', e.message);
    // Nessuna notifica, nessun fallback, nessun retry
  }
})();
// Niente aspetta che questo finisca → redirect immediato
```

### Soluzione Proposta

#### Opzione A: Retry con Backoff Esponenziale
```javascript
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

(async () => {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const rf = await ghGet(token, PROFILE_REPO, 'README.md');
      if (!rf) return;
      
      const oldReadme = Buffer.from(rf.content, 'base64').toString('utf-8');
      let newReadme = oldReadme.replace(
        /api\/image\?(?:v|cache_buster)=[0-9]*/g,
        `api/image?v=${ts}`
      );
      newReadme = updateReadmeMarkers(newReadme, state, winningLang, repoMatch, fact);
      
      if (newReadme !== oldReadme) {
        await ghPut(token, PROFILE_REPO, 'README.md', newReadme, rf.sha, '🎰 Update slot');
      }
      return; // Successo
    } catch (e) {
      lastError = e;
      console.warn(`README update attempt ${attempt + 1} failed:`, e.message);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)));
      }
    }
  }
  // Se tutti i retry falliscono, logga l'errore finale
  console.error('README update failed after', MAX_RETRIES, 'attempts:', lastError?.message);
})();
```

#### Opzione B: Queue di Failed Updates
- Usa Redis per tenere traccia dei README failed
- Job cron che retry periodicamente
- Alert se fail > N volte

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per README update failure con retry
- [ ] `spin.test.js` - test per README update success after retry

---

## 2. Nessun Monitoring/Analytics 🚨

### Descrizione
Nessun sistema di monitoraggio per la produzione. Solo `console.warn` per errori.

### Metriche Non Tracciate

| Metrica | Importanza | Impatto |
|---------|------------|---------|
| Win rate reale | **ALTA** | Non sappiamo se `FORCED_WIN_PROB` sta funzionando correttamente |
| Near-miss rate | MEDIA | Non possiamo ottimizzare l'esperienza utente |
| Redis hit rate | **ALTA** | Non sappiamo se Redis sta aiutando (dovrebbe essere ~90%+) |
| GitHub API latency | **ALTA** | Non possiamo ottimizzare il fallback |
| Error breakdown per tipo | **ALTA** | Non sappiamo cosa fallisce più spesso (404, 403, 409, timeout) |
| User session duration | BASSA | Non sappiamo quanto tempo gli utenti passano sulla slot |
| Redirect success rate | **ALTA** | Non sappiamo se gli utenti arrivano effettivamente ai repo |

### File Correlati
- `api/spin.js` - unico punto di logging
- `api/_lib/github.js` - chiamate GitHub API
- `api/_lib/kv.js` - chiamate Redis

### Soluzione Proposta

#### Opzione A: Vercel Analytics + Custom Metrics
```javascript
// In spin.js, dopo ogni spin:
const metrics = {
  event: 'spin',
  win: isWin ? 'win' : 'loss',
  isJackpot: isJackpot ? 'jackpot' : 'near-miss',
  langId: winningLang?.id,
  redis_hit: kvEnabled,
  github_latency: Date.now() - ts,
  error: null,
};

// Invia a Vercel Analytics custom event
if (process.env.VERCEL) {
  await fetch('https://api.vercel.com/v1/analytics', {
    method: 'POST',
    body: JSON.stringify({ events: [metrics] }),
    headers: { Authorization: `Bearer ${process.env.ANALYTICS_TOKEN}` }
  }).catch(() => {}); // Silently ignore analytics failures
}
```

#### Opzione B: OpenTelemetry + Backend
- Iniettare OpenTelemetry SDK
- Esportare a Jaeger/Tempo/Zipkin
- Dashboard Grafana per visualizzazione

#### Opzione C: Log JSON su S3/CloudWatch
```json
{
  "timestamp": "2026-07-13T12:34:56Z",
  "event": "spin",
  "win": "win",
  "win_type": "jackpot",
  "lang_id": "cpp",
  "latency_ms": {
    "github_get": 123,
    "github_put": 456,
    "redis_get": 12,
    "redis_set": 15,
    "svg_build": 45
  },
  "error": null,
  "user_ip_hash": "abc123..."
}
```

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per metrics logging
- [ ] `spin.test.js` - test per error tracking

---

## 3. Circuit Breaker per GitHub API Assente

### Descrizione
Se GitHub API ha outage o rate limit, tutti gli spin falliscono senza degradazione elegante.

### File Correlati
- `api/_lib/github.js` - chiamate GitHub API
- `api/spin.js` - handler principale

### Impatto
- **ALTA** - Se GitHub API down, l'intera slot diventa inutilizzabile
- **MEDIA** - Niente fallback oltre al timeout di 200-500ms

### Scenario di Failure
```
1. GitHub API ha rate limit (5000/h exhausted)
2. Tutti gli spin fail con 403 Forbidden
3. L'utente vede errore 500 o redirect a GitHub senza slot
4. Nulla di meglio del semplice timeout
```

### Soluzione Proposta

#### Implementazione Circuit Breaker
```javascript
class GitHubCircuitBreaker {
  constructor(failureThreshold = 3, resetTimeout = 60000) {
    this.failures = 0;
    this.threshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.lastFailure = 0;
    this.state = 'closed'; // 'closed', 'open', 'half-open'
  }
  
  async call(fn) {
    if (this.isOpen()) {
      throw new Error('GitHub API circuit open - trying again later');
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
  
  isOpen() {
    if (this.state === 'closed') return false;
    if (this.state === 'open' && Date.now() - this.lastFailure > this.resetTimeout) {
      this.reset();
      return false;
    }
    return true;
  }
  
  onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }
  
  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
  
  reset() {
    this.failures = 0;
    this.state = 'half-open';
  }
}

// Uso in github.js:
export const githubCircuitBreaker = new GitHubCircuitBreaker(3, 60000);

export async function ghGet(token, owner, repo, path) {
  return githubCircuitBreaker.call(async () => {
    // ... existing implementation
  });
}
```

### Test Case da Aggiungere
- [ ] `github.test.js` - test per circuit breaker state transitions
- [ ] `github.test.js` - test per circuit breaker recovery

---

## 4. State Sync Race Condition

### Descrizione
In `state.js`, quando Redis è abilitato:
```javascript
export async function writeState(token, owner, repo, state, _sha) {
  if (kvEnabled) {
    await kvSet(STATE_KEY, state); // Scrive su Redis
    return; // Ritorna subito
  }
  // ...
}
```

Il fallback su GitHub non viene eseguito mai in questo caso. Ma in `loadState`:
```javascript
export async function readState(token, owner, repo) {
  if (kvEnabled) {
    const state = await kvGet(STATE_KEY);
    if (state) return { state, sha: null };
    // Primo avvio: importa da GitHub per non perdere lo storico
    const gh = await readStateGitHub(token, owner, repo);
    if (gh) {
      await kvSet(STATE_KEY, gh.state); // Seed Redis
      return { state: gh.state, sha: null };
    }
    return { state: DEFAULTS, sha: null };
  }
  // ...
}
```

**Problema:** Se Redis viene resettato (es. TTL expire, manutenzione), lo stato viene reimportato da GitHub, ma GitHub non è stato aggiornato con gli ultimi spin.

### Scenario di Failure
1. Spin #1: Redis viene scritto, GitHub non aggiornato
2. Redis viene resettato (es. deployment che resetta KV)
3. Spin #2: Legge da GitHub (vecchio stato), non da Redis
4. **Dati persi** - Gli spin da #1 a #2 non sono contati

### Soluzione Proposta

#### Opzione A: Sync Asincrono su GitHub dopo Redis Write
```javascript
export async function writeState(token, owner, repo, state, _sha) {
  if (kvEnabled) {
    await kvSet(STATE_KEY, state);
    // Sync asincrono su GitHub per backup (non blocca)
    writeStateGitHub(token, owner, repo, state, _sha)
      .catch(e => console.warn('Redis state sync to GitHub failed:', e.message));
    return;
  }
  // ...
}
```

#### Opzione B: Flag di Versioning
```javascript
const STATE_KEY = 'gsm:state';
const STATE_VERSION_KEY = 'gsm:state:version';

export async function writeState(token, owner, repo, state, _sha) {
  if (kvEnabled) {
    const currentVersion = await kvGet(STATE_VERSION_KEY) || 0;
    const newState = { ...state, version: currentVersion + 1 };
    await kvSet(STATE_KEY, newState);
    await kvSet(STATE_VERSION_KEY, newState.version);
    return;
  }
  // ...
}

export async function readState(token, owner, repo) {
  if (kvEnabled) {
    const state = await kvGet(STATE_KEY);
    if (state) return { state, sha: null };
    
    // Se Redis vuoto, importa da GitHub e sincronizza versione
    const gh = await readStateGitHub(token, owner, repo);
    if (gh) {
      const newState = { ...gh.state, version: gh.state.version || 0 };
      await kvSet(STATE_KEY, newState);
      return { state: newState, sha: null };
    }
    return { state: { ...DEFAULTS, version: 0 }, sha: null };
  }
  // ...
}
```

### Test Case da Aggiungere
- [ ] `state-local.test.js` - test per state versioning
- [ ] `state-local.test.js` - test per Redis reset scenario

---

## 5. Slot.svg TTL Non Gestito

### Descrizione
Lo slot.svg viene salvato in Redis senza TTL (permanentemente). Se Redis viene resettato:
- Tutti gli SVG vengono persi
- Gli utenti vedono placeholder "🎰 Pull the lever to spin!" indefinitamente
- Niente way per recuperare l'ultimo stato

### File Correlato
- `api/_lib/github.js` - `saveSlotSvg` e `loadSlotSvg`

### Impatto
- **MEDIA** - Gli utenti possono vedere SVG vecchi o placeholder
- **BASSA** - Il fallback su GitHub Contents esiste ma non viene usato se Redis non è configurato

### Soluzione Proposta

#### Opzione A: TTL per Slot.svg
```javascript
// In github.js:
const SLOT_SVG_TTL_SEC = 60 * 60 * 24 * 7; // 7 giorni

export async function saveSlotSvg(token, owner, repo, svg, sha) {
  if (kvEnabled) {
    const ok = await kvSet('gsm:slotSvg', svg, SLOT_SVG_TTL_SEC);
    if (ok) return;
    console.warn('kv slotSvg save failed/timed out, falling back to github');
  }
  await ghPut(token, owner, repo, 'slot.svg', svg, sha, '🎰 Update live slot');
}
```

#### Opzione B: Cache Multi-Layer
```javascript
// Cache layer: Redis (fast) → GitHub (slow but persistent) → tmp (fallback)

export async function saveSlotSvg(token, owner, repo, svg, sha) {
  // Layer 1: Redis
  if (kvEnabled) {
    const ok = await kvSet('gsm:slotSvg', svg, 604800); // 7 giorni
    if (ok) return;
  }
  
  // Layer 2: GitHub
  await ghPut(token, owner, repo, 'slot.svg', svg, sha, '🎰 Update live slot');
  
  // Layer 3: Local fallback
  await saveSlotSvgLocal(svg);
}
```

### Test Case da Aggiungere
- [ ] `github.test.js` - test per slot.svg TTL
- [ ] `github.test.js` - test per multi-layer cache fallback

---

## 6. Testing Incompleto - Integrazione ed E2E

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

#### 3. Test per GitHub API Failure Scenarios
```javascript
// github.test.js
describe('github.js failure scenarios', () => {
  it('handles 403 Forbidden with circuit breaker', async () => {
    // Simula GitHub API che restituisce 403
    // Verifica che il circuit breaker si apra dopo N failure
  });
  
  it('handles 409 Conflict with retry', async () => {
    // Simula GitHub API che restituisce 409
    // Verifica che il retry con SHA aggiornato funzioni
  });
  
  it('handles network timeout gracefully', async () => {
    // Simula network timeout
    // Verifica che il fallback venga usato
  });
});
```

#### 4. Test per Redis Failure Scenarios
```javascript
// kv.test.js
describe('kv.js failure scenarios', () => {
  it('handles Redis timeout with fallback', async () => {
    // Simula Redis timeout
    // Verifica che il fallback GitHub venga usato
  });
  
  it('handles Redis connection error gracefully', async () => {
    // Simula Redis connection error
    // Verifica che il fallback GitHub venga usato
  });
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

## 7. Nessun CI/CD Pipeline

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

### Test Case da Aggiungere
- [ ] `.github/workflows/ci.yml` - test per CI pipeline
- [ ] `.github/workflows/staging.yml` - test per staging deployment

---

## 8. Accessibility Issues

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
    .reel { animation: none; transform: rotate(0deg); }
  }
`;
```

#### Aggiungere Live Regions
```javascript
/* In public/index.html: */
<div id="slot-status" aria-live="polite" aria-atomic="true"></div>

<script>
// Annuncia win/loss agli screen reader
function announceResult(result) {
  const statusEl = document.getElementById('slot-status');
  statusEl.textContent = result;
}
</script>
```

### Test Case da Aggiungere
- [ ] `a11y.test.js` - test per ARIA labels in SVG
- [ ] `a11y.test.js` - test per prefers-reduced-motion
- [ ] `a11y.test.js` - test per screen reader announcements
- [ ] `e2e/a11y.e2e.js` - test per accessibility con axe-core

---

## 9. Security - Open Redirect Potential

### Descrizione
La validazione di `req.query.user` è presente ma il redirect finale potrebbe essere usato per phishing:
```javascript
const rawUser = req.query?.user ? String(req.query.user).trim() : '';
const targetOwner = rawUser && isValidUser(rawUser) ? rawUser : OWNER;
// ...
dest = `https://github.com/${targetOwner}?tab=repositories&language=${ghLang}`;
```

Se `isValidUser` viene compromesso o bypassato, un attaccante potrebbe:
1. Usare un repo GitHub malevolo con nome simile a un owner legittimo
2. Creare un phishing campaign targeting gli utenti della slot

### File Correlato
- `api/spin.js` - righe 111-112

### Impatto
- **BASSA** - Il redirect è sempre su `github.com`, quindi non c'è redirect arbitrario
- **BUT**: Un utente malevolo potrebbe creare un repo GitHub con nome simile a `simrim96` per phishing

### Soluzione Proposta

#### Opzione A: Whitelist di Owner Validati
```javascript
// In spin.js:
const VALID_OWNERS = new Set(['simrim96', 'other-trusted-owners']);

export default async function handler(req, res) {
  // ...
  const rawUser = req.query?.user ? String(req.query.user).trim() : '';
  const targetOwner = rawUser && isValidUser(rawUser) && VALID_OWNERS.has(rawUser) 
    ? rawUser 
    : OWNER;
  // ...
}
```

#### Opzione B: Canonical Owner Mapping
```javascript
// In spin.js:
const OWNER_MAP = {
  'simrim96': 'simrim96',
  'other-owner': 'other-owner',
  // ...
};

export default async function handler(req, res) {
  // ...
  const rawUser = req.query?.user ? String(req.query.user).trim() : '';
  const targetOwner = rawUser && isValidUser(rawUser) 
    ? OWNER_MAP[rawUser] || OWNER 
    : OWNER;
  // ...
}
```

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per open redirect prevention
- [ ] `spin.test.js` - test per owner whitelist validation

---

## 10. Nessun Error Tracking

### Descrizione
Nessun sistema di error tracking per la produzione. Solo `console.warn` e `console.error`.

### File Correlati
- `api/spin.js` - error handling base
- `api/_lib/github.js` - error handling base
- `api/_lib/state.js` - error handling base

### Impatto
- **ALTA** - Impossibile debuggare errori in produzione
- **MEDIA** - Nessuna notifica per errori critici
- **BASSA** - Nessuna aggregazione di errori per pattern recognition

### Soluzione Proposta

#### Opzione A: Sentry
```javascript
// In spin.js (prime righe):
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV,
  tracesSampleRate: 0.1,
});

export default async function handler(req, res) {
  return Sentry.withActiveSpan(async (span) => {
    try {
      // ... existing code
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  });
}
```

#### Opzione B: Log Aggregator (CloudWatch, Datadog, etc.)
```javascript
// In spin.js:
const logEvent = (event) => {
  fetch('https://logs.example.com/ingest', {
    method: 'POST',
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: err.message,
      stack: err.stack,
      context: {
        user: req.query?.user,
        langId: winningLang?.id,
        isWin,
      },
    }),
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {}); // Silently ignore logging failures
};
```

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per error tracking integration
- [ ] `spin.test.js` - test per error aggregation

---

## 11. Memory Leak Potential in Async Background Tasks

### Descrizione
L'IIFE asincrono per l'aggiornamento del README (spin.js righe 152-168) non gestisce errori correttamente:
```javascript
(async () => {
  try {
    // ...
  } catch (e) {
    console.warn('readme background update skipped:', e.message);
  }
})();
```

Se fallisce ripetutamente:
- Ogni fallimento crea un micro-task non gestito
- I Promise reiettati non vengono gestiti
- Potenziale accumulation di micro-task nel event loop

### File Correlato
- `api/spin.js` - righe 152-168

### Impatto
- **BASSA** - L'impatto è minimo in serverless functions (ogni richiesta è isolate)
- **MEDIA** - Se le richieste sono molto frequenti, può causare memory growth

### Soluzione Proposta

#### Opzione A: Cleanup dei Promise Rejected
```javascript
(async () => {
  try {
    const rf = await ghGet(token, PROFILE_REPO, 'README.md');
    // ...
  } catch (e) {
    console.warn('readme background update skipped:', e.message);
    // Ignora ma non accumula
  }
})().catch(() => {}); // Catch globale per prevenire unhandled rejection
```

#### Opzione B: Debounce per Failed Updates
```javascript
let lastFailedAt = 0;
const MAX_FAILURES_PER_MINUTE = 10;

(async () => {
  const now = Date.now();
  if (now - lastFailedAt < 60000) {
    // Skip if too many recent failures
    return;
  }
  
  try {
    const rf = await ghGet(token, PROFILE_REPO, 'README.md');
    // ...
    lastFailedAt = 0;
  } catch (e) {
    lastFailedAt = now;
    console.warn('readme background update skipped:', e.message);
  }
})().catch(() => {});
```

### Test Case da Aggiungere
- [ ] `spin.test.js` - test per async background task error handling
- [ ] `spin.test.js` - test per unhandled rejection prevention

---

## 12. Language Config Non Estensibile

### Descrizione
La configurazione delle lingue (`api/_lib/languages.js`) è hardcoded. Aggiungere nuove lingue richiede modifiche al codice sorgente.

### File Correlato
- `api/_lib/languages.js` (non letto, ma menzionato in altri file)

### Impatto
- **MEDIA** - Aggiungere nuove lingue richiede codice change
- **BASSA** - Non c'è way per utenti fork di personalizzare le lingue

### Soluzione Proposta

#### Opzione A: Configurazione da File Esterno
```javascript
// languages.js
import languagesConfig from './languages-config.json';

export const LANGUAGES = languagesConfig.languages;
export const LANGUAGE_BY_ID = Object.fromEntries(
  languagesConfig.languages.map(l => [l.id, l])
);
```

#### Opzione B: Overwrite via ENV
```javascript
// languages.js
const CUSTOM_LANGUAGES = process.env.CUSTOM_LANGUAGES;
if (CUSTOM_LANGUAGES) {
  const parsed = JSON.parse(decodeURIComponent(CUSTOM_LANGUAGES));
  LANGUAGES.push(...parsed);
}
```

### Test Case da Aggiungere
- [ ] `languages.test.js` - test per custom language loading
- [ ] `languages.test.js` - test per language config validation

---

## 13. SVG Builder Non Modular

### Descrizione
Il file `svg-builder.js` ha 571 righe in un singolo file. Nessuna separazione concerns.

### File Correlato
- `api/_lib/svg-builder.js` - 571 righe

### Impatto
- **MEDIA** - Difficile mantenere e testare
- **BASSA** - Nessun problema di performance

### Soluzione Proposta

#### Opzione A: Split in Moduli
```
api/_lib/svg-builder/
  ├── index.js          # export buildSVG, errorSVG
  ├── symbols.js        # rendering dei simboli
  ├── reels.js          # rendering dei reels
  ├── animations.js     # CSS animations
  ├── styles.js         # gradienti e stili
  └── utils.js          # helper functions
```

#### Opzione B: Plugin Architecture
```javascript
// In svg-builder.js:
const PLUGINS = [
  symbolRenderer,
  reelRenderer,
  animationRenderer,
  styleRenderer,
];

export function buildSVG(config) {
  let svg = '<svg>...';
  for (const plugin of PLUGINS) {
    svg = plugin(svg, config);
  }
  return svg;
}
```

### Test Case da Aggiungere
- [ ] `svg-builder/symbols.test.js` - test per symbol rendering
- [ ] `svg-builder/reels.test.js` - test per reel rendering
- [ ] `svg-builder/animations.test.js` - test per animation rendering

---

## 14. State Migration Versioning Assente

### Descrizione
Non c'è versioning dello schema dello stato. Se lo stato cambia formato in futuro:
- Gli utenti esistenti non possono migrare
- Lo stato diventa incompatibile
- Perdita di dati storici

### File Correlato
- `api/_lib/state.js` - schema stato hardcoded

### Impatto
- **MEDIA** - Difficile evolvere lo schema dello stato
- **BASSA** - Attualmente lo schema è stabile

### Soluzione Proposta

#### Opzione A: Versioning nel State Schema
```javascript
// In state.js:
const DEFAULTS = {
  version: 1, // Versione dello schema
  totalSpins: 0,
  totalWins: 0,
  lastWin: null,
};

export async function readState(token, owner, repo) {
  const state = await loadState();
  
  if (state.version !== CURRENT_SCHEMA_VERSION) {
    return migrateState(state, CURRENT_SCHEMA_VERSION);
  }
  
  return state;
}

function migrateState(state, targetVersion) {
  if (state.version === 1 && targetVersion === 2) {
    // Migrazione da v1 a v2
    state.totalSpins = state.totalSpins || 0;
    state.totalWins = state.totalWins || 0;
    state.lastWin = state.lastWin || null;
    state.version = 2;
  }
  
  return state;
}
```

### Test Case da Aggiungere
- [ ] `state-local.test.js` - test per state migration
- [ ] `state-local.test.js` - test per state schema versioning

---

## 15. GitHub API Rate Limit Non Tracciato

### Descrizione
Non c'è modo di tracciare quanto GitHub API rate limit viene consumato.

### File Correlati
- `api/spin.js` - chiamate GitHub API
- `api/_lib/github.js` - chiamate GitHub API
- `api/_lib/repos.js` - chiamate GitHub API per cache refresh

### Impatto
- **ALTA** - Se si esaurisce il rate limit, tutti gli spin falliscono
- **MEDIA** - Impossibile ottimizzare il consumo di API calls

### Soluzione Proposta

#### Opzione A: Rate Limit Tracker
```javascript
// In github.js:
let rateLimitUsed = 0;
const GITHUB_QUOTA_MAX = 5000;

export async function ghGet(token, owner, repo, path) {
  const r = await fetch(
    'https://api.github.com/rate_limit',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  const remaining = data.rate.remaining;
  
  if (remaining < 100) {
    console.warn('GitHub API rate limit low:', remaining);
  }
  
  rateLimitUsed += 1;
  
  // ... existing implementation
}

export function getRateLimitUsage() {
  return { used: rateLimitUsed, remaining: GITHUB_QUOTA_MAX - rateLimitUsed };
}
```

### Test Case da Aggiungere
- [ ] `github.test.js` - test per rate limit tracking
- [ ] `github.test.js` - test per rate limit warning

---

## 📌 PRIORITÀ DI RISOLUZIONE

| Issue | Priorità | Tempo Stimato | Impatto |
|-------|----------|---------------|---------|
| 2. Nessun Monitoring/Analytics | **CRITICA** | 1-2 giorni | Alta visibilità |
| 1. Silent Failure README | **ALTA** | 0.5 giorni | UX degradata |
| 3. Circuit Breaker GitHub | **ALTA** | 1 giorno | Resilienza |
| 6. Testing Incompleto | **ALTA** | 3-5 giorni | Qualità |
| 4. State Sync Race | **MEDIA** | 1 giorno | Data integrity |
| 10. Error Tracking | **MEDIA** | 1 giorno | Debuggabilità |
| 15. Rate Limit Tracking | **MEDIA** | 0.5 giorni | Prevention |
| 7. CI/CD Pipeline | **MEDIA** | 2 giorni | Automazione |
| 5. Slot.svg TTL | **BASSA** | 0.5 giorni | Data loss |
| 8. Accessibility | **BASSA** | 2 giorni | Inclusività |
| 9. Security Open Redirect | **BASSA** | 0.5 giorni | Security |
| 11. Memory Leak | **BASSA** | 0.5 giorni | Performance |
| 12. Language Config | **BASSA** | 1 giorno | Usabilità |
| 13. SVG Builder Modular | **BASSA** | 2 giorni | Maintainability |
| 14. State Migration | **BASSA** | 1 giorno | Evolvibilità |

---

## 📝 NOTE AGGIUNTIVE

### Documentazione Correlata
- [README.md](./README.md) - Documentazione principale del progetto
- [ISSUES.md](./ISSUES.md) - Questo documento

### Riferimenti Tecnici
- GitHub API Rate Limit: https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api
- Upstash Redis Docs: https://upstash.com/docs
- Vercel Serverless Functions: https://vercel.com/docs/functions
- Sentry Docs: https://docs.sentry.io/platforms/javascript/
- OpenTelemetry Docs: https://opentelemetry.io/docs/

---

*Documento creato: 2026-07-13*  
*Ultima revisione: 2026-07-13 (nuova analisi)*  
*Problemi precedenti: Risolti (state su GitHub, error handling, test coverage)*
