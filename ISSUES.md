# Issues & Criticità del Progetto
Questo documento documenta le criticità identificate nel progetto GithubSlotMachine, con analisi dettagliata, impatti e possibili soluzioni.
---

## 📋 INDICE

1. [State su GitHub Public](#1-state-su-github-public)
2. [Near-Miss Logic Fragile](#2-near-miss-logic-fragile)
3. [Missing Error Handling in SVG Builder](#3-missing-error-handling-in-svg-builder)
4. [Language Matching Aggressivo](#4-language-matching-aggressivo)
5. [Test Coverage Incompleta](#5-test-coverage-incompleta)
6. [Missing Monitoring/Logging](#6-missing-monitoringlogging)
7. [GitHub API Rate Limit Vulnerability](#7-github-api-rate-limit-vulnerability)

---

## 1. State su GitHub Public ⚠️

### Descrizione
Lo stato del gioco (`totalSpins`, `totalWins`, `lastWin`, `slot.svg`) viene salvato su `state.json` pubblico nel repository GitHub. Questo file è accessibile a chiunque e modificabile via commit manuale o fork.

### File Correlati
- `api/_lib/state.js` - Gestione persistenza stato
- `state.json` - File pubblico di stato community
- `api/github.js` - Funzioni `saveSlotSvg`, `updateReadmeMarkers`

### Vulnerabilità Identificate

### Soluzioni Proposte

#### Soluzione A: Upstash Redis Come Primary Storage (RACCOMANDATO)

**Vantaggi:**
- No race conditions (atomic operations)
- No SHA conflict
- No GitHub API rate limit consumo
- Persistenza cross-session affidabile
- TTL automatico per dati temporanei

**Implementazione:**
```javascript
// In state.js:
export async function loadState() {
  if (kvEnabled) {
    const data = await kvGet('gsm:state');
    if (data) return data;
  }
  // Fallback GitHub solo se Redis unavailable
  return loadFromGitHub();
}

export async function saveState(state) {
  if (kvEnabled) {
    await kvSet('gsm:state', state);
    // Sync asincrono su GitHub per backup
    saveToGitHub(state).catch(console.warn);
    return;
  }
  await saveToGitHub(state);
}
```

**Configurazione:**
- Variabili ENV: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Chiavi Redis:
  - `gsm:state` - stato completo (JSON string)
  - `gsm:slotSvg` - SVG generato (cached per 30min)
  - `gsm:rl:{ip}` - rate limit per IP

#### Soluzione B: GitHub Optimistic Locking

**Implementazione:**
```javascript
export async function ghPutWithRetry(token, owner, repo, path, content, message, maxAttempts = 3) {
  let current = await ghGet(token, owner, repo, path);
  let sha = current?.sha || null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const encoded = Buffer.from(content).toString('base64');
    const body = { message, content: encoded };
    if (sha) body.sha = sha;
    
    const r = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      { method: 'PUT', headers: {...}, body: JSON.stringify(body) }
    );
    
    if (r.ok) return true;
    if (r.status === 409) {
      // Conflict: fetch SHA aggiornato e riprova
      current = await ghGet(token, owner, repo, path);
      sha = current?.sha || null;
      continue;
    }
    throw new Error(`PUT ${path}: ${r.status}`);
  }
  return false;
}
```

#### Soluzione C: Stateless (Solo Redis)

**Architettura:**
- **Nessun stato su GitHub**
- Tutto su Upstash Redis (state, SVG, cache)
- `state.json` rimosso dal repo
- README non aggiornato con markers

**Vantaggi:**
- Sicurezza massima (nessun token GitHub necessario per scrittura)
- Performance migliori (no API GitHub per stato)
- Zero race conditions

**Svantaggi:**
- Niente persistenza del "last win" sul README
- Dipendenza 100% su Upstash (single point of failure)

### Raccomandazione Finale

**Adottare Soluzione A (Redis come primary)** con fallback GitHub per SVG. Questo:
- Elimina le race conditions sullo stato
- Riduce il consumo di GitHub API rate limit
- Mantiene SVG persistente (per UX) su GitHub come backup
- Riduce la superficie di attacco (token GitHub meno critico)

---

## 2. Near-Miss Logic Fragile

### Descrizione
Due funzioni `engineerNearMiss` e `detectNearMiss` sono strettamente accoppiate. Se una cambia, l'altra potrebbe non riconoscere il near-miss generato.

### File Correlati
- `api/_lib/game.js` - righe 66-92 (`engineerNearMiss`), 134-160 (`detectNearMiss`)
- `tests/game.test.js` - righe 208-270 (test suite near-miss)

### Problema Identificato

Il test "invariant: a detected near-miss column matches the near-miss geometry" (righe 237-269) esiste **proprio perché** la coupling è notoriamente fragile.

**Flusso di near-miss:**
1. `engineerNearMiss` modifica la grid in-place:
   - 2 simboli consecutivi sulla payline centrale
   - 1 simbolo diverso (breaker) nel rullo successivo
   - 1 simbolo adiacente nello stesso rullo (near-miss visivo)
2. `detectNearMiss` scansiona la grid per trovare near-miss:
   - Cerca 2+ symbol consecutivi + anchor adiacente nel rullo successivo
3. Se i due algoritmi divergono → near-miss generato ma non evidenziato

### Test Case Esistenti
```javascript
it('invariant: a detected near-miss column matches the near-miss geometry', () => {
  for (let i = 0; i < 400; i++) {
    const g = generateGrid();
    const col = detectNearMiss(g, checkWins(g));
    if (col < 0) continue;
    // Replicate la scan e conferma che col corrisponde a near-miss reale
    // ...
    expect(ok).toBe(true);
  }
});
```

### Miglioramenti Proposti

1. **Unificare la logica**: `engineerNearMiss` dovrebbe chiamare `detectNearMiss` per verificare che il near-miss sia riconosciuto
2. **Aggiungere test di regressione** che testano casi edge (wild, scatter, multiple paylines)
3. **Documentare esplicitamente** il contratto tra le due funzioni in commenti

---

## 3. Missing Error Handling in SVG Builder

### Descrizione
Il file `svg-builder.js` (571 righe) ha pochissimi `try-catch` blocchi. Qualsiasi errore nella generazione SVG crasha la function completamente.

### File Correlati
- `api/_lib/svg-builder.js`

### Vulnerabilità Identificate

#### 3.1 Nessuno Fallback per SVG Malformato
Se `buildSVG` fallisce:
- L'handler `spin.js` restituisce 500 error
- Niente SVG generato
- Niente indicazione visiva di cosa è andato storto

#### 3.2 Errori nelle Animazioni CSS
Le animazioni SVG sono hardcoded come stringhe:
```javascript
css += `@keyframes rs${uid}c${c}{0%{transform:translateY(-${scroll}px)}...`;
```

Se `scroll` è `NaN` o infinito (es. da `Math.floor` su valore non numerico), l'SVG risultante è invalido.

### Test Case Manchanti
- [ ] `svg-builder.test.js` - test per SVG valido (XML parsing)
- [ ] `svg-builder.test.js` - test per input malformed (grid corrotta)
- [ ] `svg-builder.test.js` - test per near-miss highlight visibile
- [ ] `spin.test.js` - test per fallback SVG di errore

### Soluzione Proposta

Aggiungere wrapper con try-catch in `spin.js`:
```javascript
export default async function handler(req, res) {
  try {
    const svg = buildSVG({ /* ... */ });
    res.status(200).send(svg);
  } catch (err) {
    console.error('SVG build failed:', err);
    // Restituire SVG di errore
    const errorSvg = buildErrorSvg('Generation failed: ' + err.message);
    res.status(500).send(errorSvg);
  }
}
```

---

## 4. Language Matching Aggressivo

### Descrizione
Il matching tra linguaggio vincente e repo dell'owner usa soglie fisse troppo permissive:
- ≥30% del codice del linguaggio
- Topic filter **opzionale**

### File Correlati
- `api/_lib/repos.js` - righe 78-97

### Problema Identificato

**Esempio reale:**
- User vince con `C++`
- Repository `simrim96/simrim96` (profile repo) ha 35% C++ (config, scripts vari)
- Viene mostrato come "Ultima vincita" → `C++` → `simrim96/simrim96`

**Problema:**
- Il repo `simrim96/simrim96` è **il profilo stesso**, non un progetto C++
- L'utente potrebbe essere confuso: "perché mi mostra il mio profilo come repo C++?"

### Logica Attuale (repos.js, righe 94-97)
```javascript
// Privilegia repo non-profile e con percentuale più alta, poi più stelle.
const isProfile = rep.name.toLowerCase() === owner.toLowerCase();
if (!cur || (!isProfile && (pct > cur.pct || (pct === cur.pct && candidate.stars > cur.stars)))) {
  byLangId[lang.id] = candidate;
}
```

**Problema:** La logica è corretta ma non sufficientemente aggressiva:
- Se il PRIMO candidate è il profile repo, non viene sostituito da un repo non-profile con % uguale
- Dovrebbe essere: `if (!isProfile && cur) return cur` (preferring non-profile)

### Miglioramenti Proposti

1. **Tag esplicito per "profile repo"** nel config
2. **Threshold più alto per profile repos** (es. ≥50% vs ≥30%)
3. **Fallback a repo secondario** se il top match è il profile

---

## 5. Test Coverage Incompleta

### Stato Attuale
- **6 file test** per ~15 moduli
- Solo test su logica pura (no network, no Redis, no GitHub API)
- Nessun test per error handling e edge cases

### Test Coverage Mappatura

| Modulo | Test Esistente? | Copertura |
|--------|-----------------|-----------|
| `game.js` | ✅ `game.test.js` | 85% (logica principale) |
| `languages.js` | ❌ | 0% |
| `svg-builder.js` | ❌ | 0% |
| `github.js` | ❌ | 0% (test mockato in `game.test.js`) |
| `repos.js` | ❌ | 0% |
| `kv.js` | ❌ | 0% |
| `ratelimit.js` | ❌ | 0% |
| `spin.js` | ❌ | 0% |
| `state.js` | ✅ `state-local.test.js` | Parziale |

### Test Suite Esistenti
```
tests/
├── error-svg.test.js      # SVG di errore (shape validation)
├── game.test.js           # Game logic pura (completo)
├── github.test.js         # Mock GitHub API calls
├── ratelimit.test.js      # Rate limiting
├── state-local.test.js    # Local state persistence
└── svg.test.js            # SVG structure (shape only)
```

### Test Manchanti Critici

1. **Integration Test per spin.js**
   - Test flow completo: request → grid → SVG → state save
   - Test per GitHub API failure (404, 403, 409, timeout)
   - Test per Redis failure (timeout, connection error)

2. **Test per Near-Miss Edge Cases**
   - Near-miss con WILD symbol
   - Near-miss su payline V/Λ (non centrale)
   - Near-miss con SCATTER nel rullo di "rottura"

3. **Test per Race Conditions**
   - Due spin simultanei sullo stesso stato
   - Redis timeout + fallback GitHub
   - GitHub conflict + retry

4. **Test per Error Handling**
   - SVG build failure (input malformed)
   - Language not found in LANGUAGES config
   - Invalid user parameter (open redirect)

### Strumentazione Consigliata

- **Vitest** (già usato) per unit test
- **MSW (Mock Service Worker)** per mocking GitHub API
- **upstash/redis-mock** per test Redis senza Redis reale
- **Playwright/Cypress** per end-to-end tests

---

## 6. Missing Monitoring/Logging

### Descrizione
Nessun sistema di monitoraggio o logging per la produzione. Solo `console.warn` per errori.

### File Correlati
- `api/spin.js` - unico punto di logging
- `vercel.json` - deployment config

### Metriche Non Tracciate

| Metrica | Importanza | Stato |
|---------|------------|-------|
| Tempo di risposta GitHub API | ALTA | ❌ |
| Tempo di risposta Redis | ALTA | ❌ |
| Win rate reale | ALTA | ❌ (solo su state.json) |
| Near-miss rate | MEDIA | ❌ |
| Redis hit rate | ALTA | ❌ |
| GitHub API rate limit consumo | ALTA | ❌ |
| Errori per tipo (404, 403, 409, timeout) | ALTA | ❌ |
| User IP distribution | BASSA | ❌ |

### Soluzione Proposta

#### Opzione A: Vercel Analytics + Custom Metrics
- Usare Vercel Analytics per pagine/view
- Custom metrics via `vercel.json` `experimental` o API

#### Opzione B: OpenTelemetry + Backend
- Iniettare OpenTelemetry SDK
- Esportare a Jaeger/Tempo/Zipkin
- Dashboard Grafana per visualizzazione

#### Opzione C: Log Semplice su S3/CloudWatch
- Log JSON per ogni spin
- Include: timestamp, IP, win/loss, latency, error_type
- Queryable via CloudWatch Logs Insights

### Log Entry Template Suggerito
```json
{
  "timestamp": "2026-07-13T12:34:56Z",
  "event": "spin",
  "user_ip_hash": "abc123...",
  "result": "win",
  "win_type": "jackpot",
  "lang_id": "cpp",
  "latency_ms": {
    "github_get": 123,
    "github_put": 456,
    "redis_get": 12,
    "redis_set": 15,
    "svg_build": 45
  },
  "error": null
}
```

---

## 7. GitHub API Rate Limit Vulnerability

### Descrizione
Il sistema non protegge il GitHub API rate limit (5000/h per token auth).

### File Correlati
- `api/spin.js` - handler principale
- `api/_lib/github.js` - GitHub API calls
- `api/_lib/repos.js` - cache refresh (100+ calls per refresh)

### Problema Identificato

**Scenario di saturazione:**
1. 100 utenti fanno spin in 1 ora
2. Ogni spin fa 2-3 chiamate GitHub (GET state, GET languages, PUT state)
3. Cache refresh fa 100+ chiamate (100 repo × 1 call each)
4. **Totale**: 5000+ chiamate in 1 ora → **rate limit raggiunto**
5. Tutti gli spin successivi falliscono con 403

### Rate Limit Attuale
```javascript
// spin.js, rateLimit function:
export const RL_WINDOW_SEC = 3; // 1 spin ogni 3s per IP
```

**Problema**: Questo protegge da abuso singolo IP, MA non protegge da:
- Molti IP diversi (botnet, utenti reali)
- Cache refresh (che consuma molte chiamate in una volta)

### Soluzione Proposta

#### 1. Rate Limit Basato su GitHub Quota
```javascript
// In spin.js:
let githubQuotaUsed = 0;
const GITHUB_QUOTA_MAX = 4500; // 5000 - 500 buffer

export async function canUseGitHubAPI() {
  if (githubQuotaUsed >= GITHUB_QUOTA_MAX) return false;
  
  // Ottieni quota attuale (GitHub API /user)
  const user = await fetch('https://api.github.com/user', { headers }).then(r => r.json());
  const remaining = user.rate_limit.resources.core.remaining;
  
  return remaining >= 10; // 10 chiamate buffer
}
```

#### 2. Cache Refresh con Backoff Esponenziale
```javascript
// In repos.js:
async function refreshCache(token, owner, languages) {
  const headers = ghHeaders(token);
  const r = await fetch(
    `https://api.github.com/users/${owner}/repos?per_page=100&sort=updated&type=owner`,
    { headers }
  );
  if (!r.ok && r.status === 403) {
    console.warn('GitHub rate limit during repos refresh');
    return; // Skip refresh, usa cache vecchia
  }
  // ...
}
```

#### 3. Circuit Breaker per GitHub API
```javascript
class GitHubCircuitBreaker {
  constructor(failureThreshold = 3, resetTimeout = 60000) {
    this.failures = 0;
    this.threshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.lastFailure = 0;
  }
  
  async call(fn) {
    if (this.isOpen()) throw new Error('GitHub API circuit open');
    
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
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.reset();
        return false;
      }
      return true;
    }
    return false;
  }
  
  onSuccess() {
    this.failures = 0;
  }
  
  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
  }
}
```

---

## 📌 PRIORITÀ DI RISOLUZIONE

| Issue | Priorità | Tempo Stimato |
|-------|----------|---------------|
|1. State su GitHub Public | **CRITICA** | 2-3 giorni |
|6. Missing Monitoring/Logging | ALTA | 1 giorno |
|7. GitHub API Rate Limit | ALTA | 1-2 giorni |
|5. Test Coverage Incompleta | MEDIA | 2-3 giorni |
|2. Near-Miss Logic Fragile | MEDIA | 1-2 giorni |
|3. Missing Error Handling | BASSA | 1 giorno |
|4. Language Matching | BASSA | 1 giorno |

---

## 📝 NOTE AGGIUNTIVE

### Documentazione Correlata
- [README.md](./README.md) - Documentazione principale del progetto
- [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) - Deployment guide (se esiste)

### Riferimenti Tecnici
- GitHub API Rate Limit: https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api
- Upstash Redis Docs: https://upstash.com/docs
- Vercel Serverless Functions: https://vercel.com/docs/functions

---

*Documento creato: 2026-07-13*
*Ultima revisione: 2026-07-13*
