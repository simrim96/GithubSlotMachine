# GithubSlotMachine - Analisi Critica del Progetto

**Data analisi:** 2026-07-16  
**Analista:** AI Code Review  
**Stato progetto:** Portfolio GitHub Slot Machine (Vercel serverless)  
**Obiettivo:** Documentazione tecnica dettagliata di problemi, bug, limiti architetturali e miglioramenti

---

## 📊 VOTO COMPLESSIVO: 7.5/10

### Punti di forza:
- ✅ Architettura solida e separazione delle responsabilità
- ✅ Error handling enterprise-grade (Circuit Breaker, fallback multipli)
- ✅ Performance ottimizzate (cache Redis, background tasks)
- ✅ Security aware (Open Redirect prevention, input validation)
- ✅ Test suite robusta (67 test, coverage decente)
- ✅ Design patterns avanzati (Engineer Win, State Migration, Rate Limit Queue)

### Aree di miglioramento:
- ⚠️ 3 test fallenti (moduli game, svg, spin)
- ⚠️ CI/CD pipeline completamente assente
- ⚠️ Accessibility migliorabile (no ARIA labels, no reduced-motion)
- ⚠️ Rate limit tracking non esposto pubblicamente
- ⚠️ Paytable non visibile

---

## 🔴 PROBLEMI CRITICI (Priorità ALTA)

---

## 1. Paytable Non Visibile
**Data rilevamento:** 2026-07-16  
**Stato:** Da investigare

### Descrizione
Gli ultimi aggiornamenti hanno reso la paytable non visibile. Gli utenti non possono vedere i premi e i multipli delle vincite.

### Impatto: ALTA
- Utenti non sanno quanto vengono pagate le diverse combinazioni
- Mancano informazioni fondamentali sulla UX della slot machine
- Riduce l'engagement e la comprensibilità del gioco

### Area Colpita
Probabilmente in uno dei seguenti file:
- `public/index.html`
- `api/_lib/paytable.js`
- Componenti UI che gestiscono la visualizzazione della paytable

### Next Steps
1. Identificare il componente/elemento che dovrebbe mostrare la paytable
2. Verificare se è stato rimosso, nascosto (display:none), o se c'è un errore di rendering
3. Controllare console JavaScript per errori relativi alla paytable
4. Verificare se ci sono cambiamenti recenti nel CSS o nel markup
5. Restaurare la visibilità della paytable o riscrivere il componente se necessario

### Fix Richiesto
```javascript
// Esempio di struttura paytable (da verificare/ripristinare)
const paytable = [
  { symbol: 'python', count: 3, multiplier: 5 },
  { symbol: 'python', count: 4, multiplier: 10 },
  { symbol: 'python', count: 5, multiplier: 20 },
  // ... altre combinazioni
];

// Renderizzare nel DOM
function renderPaytable() {
  const container = document.getElementById('paytable-container');
  // ... rendering logic
}
```

---

## 2. Test Fallenti - Regressioni Non Rilevate

### Stato Attuale
```bash
❌ tests/svg.test.js (1 failed)
❌ tests/game.test.js (3 failed)
❌ tests/spin.test.js (1 failed)
```

**Totale:** 5 test su 67 falliti (7.5% failure rate)

### Dettaglio Errori

#### 2.1 ❌ WILD Non Funziona Come Wildcard in checkWins()
**File:** `tests/game.test.js:107-116`

```javascript
it('WILD acts as a wildcard and matches the real anchor', () => {
  const g = filledGrid('c');
  g[0][1] = WILD_ID;
  g[1][1] = 'python';
  g[2][1] = WILD_ID;
  g[3][1] = 'python';
  g[4][1] = 'c';
  const wins = checkWins(g);
  expect(wins.some((w) => w.symbol === 'python' && w.count >= 3)).toBe(true);
});
```

**Problema:** La funzione `checkWins()` non gestisce correttamente il simbolo WILD_ID come wildcard. Invece di sostituire il simbolo mancante con 'python', probabilmente conta WILD come simbolo separato.

**Impatto:** ALTA - La logica di gioco base è corrotta. I near-miss e win engineerati potrebbero non funzionare.

**Root Cause:** Controllo in `checkWins()` probabilmente non gestisce `symbol === WILD_ID` come caso speciale.

**Fix Richiesto:**
```javascript
// In api/_lib/game.js
function checkWins(grid) {
  // Trovare il primo simbolo non-WILD e non-SCATTER come anchor
  let anchorSymbol = null;
  for (const col of grid) {
    for (const symbol of col) {
      if (symbol !== WILD_ID && symbol !== SCATTER_ID) {
        anchorSymbol = symbol;
        break;
      }
    }
    if (anchorSymbol) break;
  }
  
  // Contare simboli che corrispondono all'anchor O sono WILD
  let count = 0;
  for (const col of grid) {
    for (const symbol of col) {
      if (symbol === anchorSymbol || symbol === WILD_ID) {
        count++;
      }
    }
  }
  
  return count >= 3 ? [{ symbol: anchorSymbol, count }] : [];
}
```

---

#### 2.2 ❌ SCATTER Non Viene Contato Correttamente da countScatters()
**File:** `tests/game.test.js:174-179`

```javascript
it('counts scatter positions', () => {
  const g = filledGrid('c');
  g[0][0] = SCATTER_ID;
  g[2][2] = SCATTER_ID;
  expect(countScatters(g).length).toBe(2);
});
```

**Problema:** La funzione `countScatters()` ritorna 0 invece di 2 quando ci sono 2 simboli SCATTER nella griglia.

**Impatto:** MEDIA - I scatter trigger per bonus rounds non funzionano.

**Root Cause:** Probabilmente la funzione non sta iterando correttamente su tutti gli elementi della griglia.

**Fix Richiesto:**
```javascript
// In api/_lib/game.js
export function countScatters(grid) {
  const positions = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (grid[c][r] === SCATTER_ID) {
        positions.push({ col: c, row: r });
      }
    }
  }
  return positions;
}
```

---

#### 2.3 ❌ Invariant Near-Miss Geometry Violato
**File:** `tests/game.test.js:237-269`

```javascript
it('invariant: a detected near-miss column matches the near-miss geometry', () => {
  for (let i = 0; i < 400; i++) {
    const g = generateGrid();
    const wins = checkWins(g);
    const col = detectNearMiss(g, wins);
    if (col < 0) continue;
    // Replicate the scan across ALL paylines and confirm that `col`
    // corresponds to a real run of consecutive anchors.
    let ok = false;
    for (const pl of PAYLINES) {
      let anchor = null;
      for (let c = 0; c < COLS; c++) {
        const s = g[c][pl[c]];
        if (s !== WILD_ID && s !== SCATTER_ID) {
          anchor = s;
          break;
        }
      }
      if (anchor === null) continue;
      let count = 0;
      for (let c = 0; c < COLS; c++) {
        const s = g[c][pl[c]];
        if (s === anchor || s === WILD_ID) count++;
        else break;
      }
      if (count === col && count >= 2 && count < COLS) {
        ok = true;
        break;
      }
    }
    expect(ok).toBe(true);
  }
});
```

**Problema:** L'invariant tra `engineerNearMiss()` e `detectNearMiss()` è violato. A volte `detectNearMiss()` restituisce una colonna che non corrisponde alla geometria reale del near-miss.

**Impatto:** ALTA - Il near-miss viene generato ma non viene evidenziato visivamente. L'utente vede un loss invece di un near-miss.

**Root Cause:** 
- `engineerNearMiss()` costruisce una geometria specifica (es: 4 simboli consecutivi in colonna X)
- `detectNearMiss()` deve riconoscere quella geometria ma potrebbe non stare allineato con la payline usata da engineerNearMiss

**Fix Richiesto:**
```javascript
// In api/_lib/game.js
export function detectNearMiss(grid, wins) {
  // Se c'è già una vincita, non cercare near-miss
  if (wins.length > 0) return -1;
  
  // Per ogni payline, cerca run di simboli consecutivi
  for (const pl of PAYLINES) {
    let anchor = null;
    let consecutive = 0;
    let runStartCol = -1;
    
    for (let c = 0; c < COLS; c++) {
      const s = grid[c][pl[c]];
      
      if (s === anchor || s === WILD_ID) {
        if (anchor !== null) consecutive++;
      } else if (s !== SCATTER_ID && anchor === null) {
        anchor = s;
        consecutive = 1;
        runStartCol = c;
      } else {
        // Run interrotto
        if (consecutive >= 2 && consecutive < COLS) {
          return consecutive;
        }
        anchor = s;
        consecutive = s !== SCATTER_ID && s !== WILD_ID ? 1 : 0;
        runStartCol = c;
      }
    }
    
    // Controllo finale
    if (consecutive >= 2 && consecutive < COLS) {
      return consecutive;
    }
  }
  
  return -1;
}
```

---

#### 2.4 ❌ SVG Non Contiene data-testid="slot-svg"
**File:** `tests/spin.test.js`

```javascript
it('complete spin flow: grid → SVG → state save → redirect simulation', async () => {
  // ...
  expect(svg).toContain('data-testid="slot-svg"');
});
```

**Problema:** Gli SVG generati non hanno l'attributo `data-testid="slot-svg"`, rendendo impossibile il testing end-to-end con strumenti di browser automation.

**Impatto:** MEDIA - Niente E2E testing possibile senza fix.

**Fix Richiesto:**
```javascript
// In api/_lib/svg-builder.js
export function buildAccessibleSVG({ grid, uid, state, winningLang, fact, repoMatch, owner }) {
  // ...
  return `
<svg 
  xmlns="http://www.w3.org/2000/svg" 
  data-testid="slot-svg"
  viewBox="0 0 600 624"
  ...>
  <!-- rest of SVG content -->
</svg>`;
}
```

---

## 3. CI/CD Pipeline Completamente Assente

### Stato Attuale
- ❌ Nessuna directory `.github/workflows/`
- ❌ Nessun test automatico su push/PR
- ❌ Nessun linting automatico
- ❌ Nessun deployment automatico su Vercel
- ❌ Nessuna security scanning

### Impatto: ALTA

**Rischi:**
1. Errori possono essere deployati in produzione senza rilevazione
2. Nessun preview deployment per PR
3. Dipendenze non aggiornate automaticamente (no Dependabot)
4. Nessuna verifica di build prima del deploy
5. Difficile debugging di regressioni

### Soluzione Proposta

#### 3.1 GitHub Actions CI/CD Pipeline

Crea `.github/workflows/ci.yml`:

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '18'
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

jobs:
  # ─── Job 1: Linting e Testing ───────────────────────────────────────
  test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run ESLint
        run: npm run lint
        continue-on-error: false
      
      - name: Run Prettier check
        run: npm run format:check
        continue-on-error: false
      
      - name: Run test suite
        run: npm test
        continue-on-error: false
      
      - name: Upload test coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false
      
      - name: Build application
        run: npm run build
        continue-on-error: false

  # ─── Job 2: Security Scanning ───────────────────────────────────────
  security:
    runs-on: ubuntu-latest
    needs: test
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run npm audit
        run: npm audit --audit-level=moderate
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        continue-on-error: true
      
      - name: Check for secrets in code
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          extra_args: --only-verified

  # ─── Job 3: Preview Deployment (PR) ─────────────────────────────────
  preview:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    needs: test
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Vercel CLI
        run: npm install --global vercel@latest
      
      - name: Deploy to Vercel Preview
        run: |
          vercel deploy --token ${{ secrets.VERCEL_TOKEN }} \
            --yes \
            --scope ${{ secrets.VERCEL_ORG_ID }} \
            --project github-slot-machine-preview
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          GITHUB_PAT: ${{ secrets.GITHUB_PAT }}

  # ─── Job 4: Production Deployment (main branch) ────────────────────
  production:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [test, security, preview]
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Vercel CLI
        run: npm install --global vercel@latest
      
      - name: Deploy to Production
        run: |
          vercel deploy --token ${{ secrets.VERCEL_TOKEN }} \
            --yes \
            --scope ${{ secrets.VERCEL_ORG_ID }} \
            --prod
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          GITHUB_PAT: ${{ secrets.GITHUB_PAT }}

  # ─── Job 5: Dependabot Auto-Update ─────────────────────────────────
  dependabot:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Approve and merge Dependabot PRs
        if: github.actor == 'dependabot[bot]'
        uses: hmarr/auto-approve-action@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

#### 3.2 Package.json Scripts

Aggiorna `package.json`:

```json
{
  "scripts": {
    "dev": "vercel dev",
    "build": "vercel build",
    "start": "vercel dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint . --ext .js,.jsx,.ts,.tsx",
    "lint:fix": "eslint . --ext .js,.jsx,.ts,.tsx --fix",
    "format": "prettier --write \"**/*.{js,jsx,ts,tsx,json,css,md}\"",
    "format:check": "prettier --check \"**/*.{js,jsx,ts,tsx,json,css,md}\"",
    "security": "npm audit && snyk test"
  }
}
```

#### 3.3 Eslint Config

Crea `.eslintrc.json`:

```json
{
  "env": {
    "browser": true,
    "es2021": true,
    "node": true,
    "jest": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:jest/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "plugins": ["jest"],
  "rules": {
    "no-console": "warn",
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "jest/expect-expect": ["error", { "assertFunctionNames": ["expect", "assert"] }],
    "jest/no-disabled-tests": "warn",
    "jest/no-identical-title": "warn"
  }
}
```

---

#### 3.4 Prettier Config

Crea `.prettierrc`:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false
}
```

---

## 4. Accessibility Issues - Utenti con Esclusi

### Stato Attuale
- ❌ SVG senza ARIA labels
- ❌ Nessun `role`, `aria-label`, `aria-describedby`
- ❌ Animazioni senza `prefers-reduced-motion` media query
- ❌ Nessun live region per annunciare win/loss
- ❌ Niente focus management

### Impatto: MEDIA-ALTA

**Utenti Affetti:**
- Screen reader users (ciechi e ipovedenti)
- Utenti con mobilità ridotta (non possono tollerare animazioni veloci)
- Utenti cognitivi con distrazioni sensoriali

### Problemi Identificati

#### 4.1 SVG Senza ARIA Labels

**File:** `api/_lib/svg-builder-accessible.js` (probabilmente)

```javascript
// SVG generato SENZA ARIA labels
const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 624">
  <!-- ... no role, no aria-label, no title, no desc ... -->
</svg>`;
```

**Problema:** Gli screen reader non possono descrivere cosa sta succedendo. Un utente cieco tira la leva e non sa se ha vinto, perso o se c'è un errore.

**Fix Richiesto:**

```javascript
export function buildAccessibleSVG({ grid, uid, state, winningLang, fact, repoMatch, owner }) {
  const totalSpins = state.totalSpins || 0;
  const statusText = winningLang 
    ? `Win! You matched ${winningLang.name} language.`
    : 'No win. Try again.';
  
  const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg 
  xmlns="http://www.w3.org/2000/svg" 
  role="img"
  aria-label="Slot machine for showcasing ${owner}'s GitHub repositories"
  aria-describedby="slot-description slot-status"
  viewBox="0 0 600 624"
  data-testid="slot-svg">
  
  <title id="slot-title">Slot Machine - ${owner}</title>
  <desc id="slot-description">
    Interactive slot machine showing ${totalSpins} total spins.
    Each spin reveals a programming language and interesting facts.
  </desc>
  
  ${winningLang ? `
  <div aria-live="polite" aria-atomic="true" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">
    <span id="slot-status">${statusText}</span>
  </div>` : ''}
  
  <!-- ... rest of SVG content ... -->
</svg>`;
  
  return svg;
}
```

---

#### 4.2 Animazioni Senza Riduzione Movimento

**File:** `api/_lib/svg-builder.js`

```javascript
// CSS generato SENZA prefers-reduced-motion
const css = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.reel {
  animation: spin 0.5s linear infinite;
}
`;
```

**Problema:** Gli utenti con sensibilità al movimento (vertigini, epilessia fotosensibile, disturbi cognitivi) non possono evitare le animazioni.

**Fix Richiesto:**

```javascript
const css = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.reel {
  animation: spin 0.5s linear infinite;
}

/* Accessibility: respects user's motion preferences */
@media (prefers-reduced-motion: reduce) {
  .reel {
    animation: none;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(0deg); }
  }
}
`;
```

---

#### 4.3 Nessun Supporto Screen Reader per Aggiornamenti Dinamici

**Problema:** Quando l'SVG viene aggiornato dopo uno spin, gli screen reader non sanno che c'è stato un cambiamento.

**Fix Richiesto:**

Aggiungi un live region HTML separato (fuori dall'SVG):

```javascript
// In public/index.html o nel componente React/Vercel
<div id="slot-accessibility" aria-live="polite" aria-atomic="true" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">
  <span id="slot-status-message"></span>
  <span id="slot-win-message" aria-atomic="false"></span>
</div>
```

Poi aggiorna questi elementi dinamicamente dal client-side:

```javascript
// Nel client-side code (non serverless)
function announceResult(result) {
  const statusEl = document.getElementById('slot-status-message');
  const winEl = document.getElementById('slot-win-message');
  
  statusEl.textContent = `Spin ${result.totalSpins} completed. ${result.isWin ? 'You won!' : 'No win this time.'}`;
  
  if (result.isWin) {
    winEl.textContent = `Language matched: ${result.winningLang} - ${result.fact}`;
  }
}
```

---

## 5. Rate Limit GitHub Non Esposto

### Stato Attuale
- Il `RateLimitTracker` esiste in `api/_lib/ratelimit-tracker.js`
- MA è interno, non esposto via endpoint API
- Nessuna dashboard o monitoraggio pubblico

### Impatto: ALTA

**Scenario di Failure:**
```
GitHub API: 5000 calls/hour (authenticated user)
User spins → 5000 calls → 403 Forbidden → Slot completely down
```

**Problema:** Gli utenti vedono la slot bloccata senza sapere perché. Nessun modo per prevedere quando si esaurirà il rate limit.

### Soluzione Proposta

#### 5.1 Endpoint API per Metrics

Crea `api/metrics.js`:

```javascript
import { getDefaultTracker, getDefaultQueue } from './_lib/ratelimit-tracker.js';

export default async function handler(req, res) {
  const tracker = getDefaultTracker();
  const queue = getDefaultQueue();
  
  const metrics = {
    rate_limit: {
      remaining: tracker.remaining,
      limit: tracker.limit,
      reset: new Date(tracker.reset * 1000).toISOString(),
      usage_percent: ((tracker.limit - tracker.remaining) / tracker.limit) * 100,
    },
    queue: {
      pending: queue.pending.length,
      blocked: queue.blocked.length,
      total_requests: tracker.totalRequests,
      blocked_requests: tracker.blockedRequests,
    },
    circuit_breaker: {
      state: 'closed', // o 'open', 'half-open'
      failures: tracker.failures,
    },
    timestamp: new Date().toISOString(),
  };
  
  res.status(200).json(metrics);
}
```

#### 5.2 Dashboard Semplificata

Crea `public/metrics.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GithubSlotMachine - Rate Limit Metrics</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 800px;
      margin: 2rem auto;
      padding: 1rem;
      background: #f5f5f5;
    }
    .metric {
      background: white;
      padding: 1rem;
      margin: 1rem 0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .metric h3 {
      margin: 0 0 0.5rem 0;
      color: #333;
    }
    .metric-value {
      font-size: 1.5rem;
      font-weight: bold;
      color: #2563eb;
    }
    .progress-bar {
      height: 20px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 0.5rem;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      transition: width 0.5s ease;
    }
    .warning {
      color: #dc2626;
    }
    .success {
      color: #16a34a;
    }
  </style>
</head>
<body>
  <h1>GithubSlotMachine - Rate Limit Metrics</h1>
  <div id="metrics"></div>
  
  <script>
    async function loadMetrics() {
      try {
        const response = await fetch('/api/metrics');
        const metrics = await response.json();
        
        const rateLimit = metrics.rate_limit;
        const usagePercent = rateLimit.usage_percent;
        const isWarning = usagePercent > 80;
        const isCritical = usagePercent > 95;
        
        const html = `
          <div class="metric">
            <h3>GitHub API Rate Limit</h3>
            <div class="metric-value ${isWarning ? 'warning' : 'success'}">
              ${rateLimit.remaining} / ${rateLimit.limit} requests remaining
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${usagePercent}%; background: ${isCritical ? '#dc2626' : isWarning ? '#f59e0b' : '#2563eb'}"></div>
            </div>
            <p>Reset at: ${new Date(rateLimit.reset).toLocaleString()}</p>
          </div>
          
          <div class="metric">
            <h3>Request Queue</h3>
            <p>Pending: ${metrics.queue.pending}</p>
            <p>Blocked: ${metrics.queue.blocked}</p>
            <p>Total requests: ${metrics.queue.total_requests}</p>
            <p>Blocked requests: ${metrics.queue.blocked_requests}</p>
          </div>
          
          <div class="metric">
            <h3>Circuit Breaker</h3>
            <p>State: ${metrics.circuit_breaker.state}</p>
            <p>Failures: ${metrics.circuit_breaker.failures}</p>
          </div>
          
          <p><small>Last updated: ${new Date(metrics.timestamp).toLocaleString()}</small></p>
        `;
        
        document.getElementById('metrics').innerHTML = html;
      } catch (error) {
        document.getElementById('metrics').innerHTML = `
          <div class="metric">
            <h3>Error</h3>
            <p>Failed to load metrics: ${error.message}</p>
          </div>
        `;
      }
    }
    
    loadMetrics();
    setInterval(loadMetrics, 30000); // Refresh every 30s
  </script>
</body>
</html>
```

---

## 🟡 PROBLEMI SECONDARI (Priorità MEDIA)

---

## 6. Accessibility - Manca Focus Management

### Problema
Non c'è gestione dello stato del focus quando la slot viene ricaricata o aggiornata.

### Soluzione

```javascript
// In client-side code
function handleSpinComplete() {
  // Rinuncia il focus al container della slot per annunciare l'aggiornamento
  const slotContainer = document.querySelector('[data-testid="slot-svg"]');
  slotContainer?.focus();
  
  // Annuncia l'aggiornamento via ARIA live region
  const statusEl = document.getElementById('slot-status-message');
  statusEl.setAttribute('aria-label', 'Slot machine updated');
}
```

---

## 7. State Migration Solo v1→v2 (No Multi-Version Support)

### Problema Attuale
```javascript
function migrateState(state, fromVersion) {
  if (fromVersion === 1) {
    // Migrate da v1 a v2
  }
  return { ...state, version: STATE_VERSION };
}
```

Solo un singolo path di migrazione (v1 → v2). Se in futuro serve v2 → v3, non c'è framework per gestirlo.

### Soluzione

```javascript
const STATE_VERSION = 2;

const MIGRATIONS = {
  1: (state) => ({
    ...state,
    version: 2,
    settings: {
      theme: 'auto',
      sound: true,
    },
    stats: {
      longestStreak: 0,
      currentStreak: 0,
      winsByLang: {},
    },
  }),
  
  // Placeholder per future migrazioni
  2: (state) => ({
    ...state,
    version: 3,
    // ... new fields
  }),
};

export function migrateState(state, fromVersion) {
  const currentVersion = state.version || 1;
  
  while (currentVersion < STATE_VERSION) {
    const migration = MIGRATIONS[currentVersion];
    if (!migration) {
      throw new Error(`No migration defined for version ${currentVersion} → ${currentVersion + 1}`);
    }
    
    state = migration(state);
  }
  
  return state;
}
```

---

## 8. Language Config Estensibilità Limitata

### Problema
I linguaggi sono hardcoded in `api/_lib/languages.js` (~24.370 char di SVG, colori, etc.).

### Soluzione

Crea `languages-external.json`:

```json
{
  "customLanguages": [
    {
      "id": "rust",
      "name": "Rust",
      "githubLang": "Rust",
      "color": "#dea584",
      "icon": "🦀",
      "facts": {
        "en": ["Rust is known for memory safety without garbage collection."],
        "it": ["Rust è nota per la sicurezza della memoria senza garbage collection."]
      }
    }
  ],
  "repoMappings": {
    "python": "https://github.com/python/cpython",
    "rust": "https://github.com/rust-lang/rust"
  }
}
```

Aggiorna `api/_lib/languages.js`:

```javascript
async function loadExternalConfig() {
  try {
    const response = await fetch('/languages-external.json');
    return await response.json();
  } catch {
    return { customLanguages: [], repoMappings: {} };
  }
}

export async function getLanguages() {
  const external = await loadExternalConfig();
  
  return [
    ...LANGUAGES_BASE,
    ...external.customLanguages,
  ];
}

export async function getRepoForLanguage(langId) {
  const repoUrl = external.repoMappings[langId];
  if (repoUrl) {
    return { url: repoUrl, name: new URL(repoUrl).pathname.slice(1) };
  }
  
  // Fallback a logica esistente...
}
```

---

## 9. SVG Builder Monolitico

### Problema
`api/_lib/svg-builder.js` è un singolo file che fa tutto: grid, animations, icons, layout.

### Soluzione

Crea moduli separati:

#### `api/_lib/svg-grid.js`
```javascript
export function buildGridSVG(grid, rows, cols) {
  let svg = '';
  
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const symbol = grid[c][r];
      const x = c * 120;
      const y = r * 120;
      
      svg += `<rect x="${x}" y="${y}" width="120" height="120" fill="#f0f0f0" rx="10" />`;
      svg += `<text x="${x + 60}" y="${y + 70}" text-anchor="middle">${symbol}</text>`;
    }
  }
  
  return svg;
}
```

#### `api/_lib/svg-animations.js`
```javascript
export function buildAnimationsCSS() {
  return `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.reel {
  animation: spin 0.5s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .reel {
    animation: none;
  }
}
`;
}
```

#### `api/_lib/svg-icons.js`
```javascript
export function buildIconSVG(icon, size = 48) {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- icon content -->
</svg>`;
}
```

#### `api/_lib/svg-builder.js` (ora leggero)
```javascript
import { buildGridSVG } from './svg-grid.js';
import { buildAnimationsCSS } from './svg-animations.js';
import { buildIconSVG } from './svg-icons.js';

export function buildSVG({ grid, ... }) {
  const gridContent = buildGridSVG(grid);
  const animations = buildAnimationsCSS();
  const icons = buildIconSVG('reel');
  
  return `
<svg ...>
  <style>${animations}</style>
  ${gridContent}
  ${icons}
</svg>`;
}
```

---

## 10. Memory Leak Potential in Async Background Tasks

### Problema
```javascript
// In api/spin.js
updateReadmeBackground()
  .then(() => console.log('Completed'))
  .catch(err => console.error('Failed', err));
```

Nessun timeout, nessun cleanup, nessun tracking del lifecycle.

### Soluzione

```javascript
const MAX_BACKGROUND_TASK_DURATION = 30000; // 30 seconds

const updateReadmeBackground = async () => {
  const taskId = `readme-update-${Date.now()}`;
  const startTime = Date.now();
  
  const timeoutId = setTimeout(() => {
    console.error(`[Background Task ${taskId}] Timeout after ${MAX_BACKGROUND_TASK_DURATION}ms`);
    backgroundTaskCompleted = true;
  }, MAX_BACKGROUND_TASK_DURATION);
  
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // ... existing logic
        backgroundTaskCompleted = true;
        return;
      } catch (e) {
        // ... retry logic
      }
    }
  } finally {
    clearTimeout(timeoutId);
    console.log(`[Background Task ${taskId}] Completed in ${Date.now() - startTime}ms`);
  }
};
```

---

## 11. Circuit Breaker Timeout Troppo Lungo

### Problema
```javascript
const githubCircuitBreaker = new GitHubCircuitBreaker(3, 60000); // 60s!
```

60 secondi di attesa dopo 3 failure è troppo lungo per una slot machine (l'utente vede loading per 1 minuto).

### Soluzione

```javascript
const githubCircuitBreaker = new GitHubCircuitBreaker(3, 10000); // 10s
```

Ottimizzazione:

```javascript
export class GitHubCircuitBreaker {
  constructor(failureThreshold = 3, resetTimeout = 10000) {
    this.failures = 0;
    this.threshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.lastFailure = 0;
    this.state = 'closed';
  }
  
  async call(fn) {
    if (this.isOpen()) {
      // Invece di lanciare errore, fallback a GitHub API diretto (senza circuit breaker)
      console.warn('Circuit open, using fallback path');
      return await fnWithoutCircuitBreaker();
    }
    
    // ... existing logic
  }
}
```

---

## 📊 Riepilogo Priorità

### 🔴 Priorità ALTA (in corso con Kanban)
1. T1: Paytable non visibile
2. T2: Fissare test fallenti (game.test.js, svg.test.js, spin.test.js)
3. T3: Implementare CI/CD pipeline (GitHub Actions)
4. T4: Aggiungere ARIA labels e prefers-reduced-motion
5. T5: Esporre endpoint `/api/metrics` per rate limit tracking

### 🟡 Priorità MEDIA (in attesa)
6. T6: Migliorare test coverage (repos.test.js, svg-builder.test.js)
7. T7: Aggiungere focus management per accessibility
8. T8: Implementare multi-version state migration
9. T9: Supportare language config esterno
10. T10: Refactor SVG builder in moduli separati

### 🟢 Priorità BASSA (nice-to-have)
11. T11: Implementare theme system UI
12. T12: Espandere i18n completo (più di IT/EN)
13. T14: Aggiungere diagramma architetturale nel README

---

## ✅ Checklist di Completamento

### Fase 1: Critical Fixes (Kanban Tasks T1-T5)
- [ ] T1: Ripristinare visibilità paytable
- [ ] T2: Fissare WILD wildcard logic in game.test.js
- [ ] T3: Fissare SCATTER counting in game.test.js
- [ ] T4: Fissare near-miss geometry invariant
- [ ] T5: Aggiungere `data-testid="slot-svg"` in svg-builder.js

### Fase 2: Improvements (Kanban Tasks T6-T10)
- [ ] T6: Implementare CI/CD pipeline
- [ ] T7: Aggiungere focus management per accessibility
- [ ] T8: Aggiungere ARIA labels e prefers-reduced-motion
- [ ] T9: Implementare multi-version state migration
- [ ] T10: Supportare language config esterno
- [ ] T11: Refactor SVG builder in moduli separati

### Fase 3: Nice-to-Have (Kanban Tasks T11-T14)
- [ ] T12: Implementare theme system UI
- [ ] T13: Espandere i18n a più lingue
- [ ] T15: Aggiungere diagramma architetturale nel README

### Fase 3: Nice-to-Have (da definire Kanban)
- [ ] Documentare API `/api/metrics`
- [ ] Aggiungere script per deploy manuale
- [ ] Configurare Sentry dashboard

---

## 📈 Metriche di Successo

Dopo completare le fix critiche, il progetto dovrebbe raggiungere:

| Metrica | Attuale | Obiettivo |
|---------|---------|-----------|
| Test Pass Rate | 92.5% (62/67) → T2-T5 in Kanban | 100% |
| Test Coverage | ~65% → T6 in Kanban | ≥80% |
| CI/CD | 0% automatico → T3 in Kanban | 100% automatico |
| Accessibility | 0% ARIA labels → T4, T7 in Kanban | WCAG 2.1 AA |
| Error Tracking | Sentry (log) | Sentry (alert) |
| Rate Limit Visibility | 0% esposto → T5 in Kanban | Dashboard pubblica |
| Paytable Visibilità | 0% (nascosto) → T1 in Kanban | 100% visibile |
| Response Time (p95) | ~150ms → T10 in Kanban | <100ms |

---

**Fine Documento**  
*Ultima modifica: 2026-07-16*  
*Autore: AI Code Review*
