# GithubSlotMachine - Kanban Board Status

## 📋 Task List Completo

### ✅ T1: Testing - Integration & E2E Tests (ID: t_7f2937fd)
**Stato:** `running`  
**Priorità:** CRITICA  
**Dipendenze:** Nessuna

**Acceptance Criteria:**
- [x] `spin.test.js` - complete flow integration tests ✅ FIXED
- [ ] `spin.test.js` - GitHub API failure scenarios (already exist but verify)
- [ ] `spin.test.js` - Redis failure scenarios (already exist but verify)
- [ ] `e2e/spin.e2e.js` - Playwright browser automation
- [ ] `repos.test.js` - language matching tests
- [ ] `svg-builder.test.js` - SVG generation tests

**File di riferimento:** `kanban-t1-testing.md`

**Status Update:** 12/12 tests in `spin.test.js` now PASSING (was 1 failing)
- Fixed: Import issue - `LANGUAGE_BY_ID`, `pickFact`, `COLS`, `ROWS` now correctly imported
- All edge cases and failure scenarios working
- **Next:** Create E2E tests with Playwright

---

### ⏸️ T2: CI/CD Pipeline (ID: t_c4954885)
**Stato:** `blocked` (attende T1)  
**Priorità:** CRITICA  
**Dipendenze:** T1

**Acceptance Criteria:**
- [ ] `.github/workflows/ci.yml` creato
- [ ] Tests automatici su push/PR
- [ ] Linting automatico (ESLint, Prettier)
- [ ] Security scanning (Dependabot, Snyk)
- [ ] Vercel Preview Deployments per PR
- [ ] Staging environment configurato

**File di riferimento:** `kanban-t2-cicd.md`

---

### ⚪ T3: Security - Open Redirect Fix (ID: t_a23a8de3)
**Stato:** `todo`  
**Priorità:** ALTA  
**Dipendenze:** T2

**Problema:** Vulnerabilità open redirect in `api/spin.js`  
**File:** `api/spin.js`

**Soluzione Proposta:**
```javascript
// Validare che l'URL sia nello stesso dominio
const redirectUrl = new URL(req.query.redirect || '/', req.url);
if (redirectUrl.origin !== req.url.split('/')[2]) {
  return NextResponse.redirect('/');
}
return NextResponse.redirect(redirectUrl.toString());
```

---

### ⚪ T4: Reliability - GitHub API Rate Limit (ID: t_8e5954eb)
**Stato:** `todo`  
**Priorità:** ALTA  
**Dipendenze:** T3

**Problema:** Nessun tracciamento rate limit GitHub API  
**File:** `api/_lib/github.js`

**Soluzione Proposta:**
- Parsing headers `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Implementare `RateLimitQueue` class per request queue
- Warning quando rate limit raggiunto

---

### ⚪ T5: Error Tracking - Sentry (ID: t_907d78a6)
**Stato:** `todo`  
**Priorità:** MEDIA  
**Dipendenze:** T4

**Problema:** Nessun error tracking in produzione  
**Soluzione:** Integrazione `@sentry/nextjs`

---

### ⚪ T6: Stability - Memory Leak Fix (ID: t_0d1b5302)
**Stato:** `todo`  
**Priorità:** MEDIA  
**Dipendenze:** T5

**Problema:** Memory leak in async background tasks  
**File:** `api/_lib/state.js`

**Soluzione Proposta:**
- Timeout per `kvSet()` operazioni
- Fallback a GitHub write su timeout
- Proper error handling con `try/catch`

---

### ⚪ T7: Accessibility - ARIA Labels (ID: t_05aa8165)
**Stato:** `todo`  
**Priorità:** MEDIA  
**Dipendenze:** T6

**Problema:** Slot machine non accessibile  
**File:** `api/_lib/svg-builder.js`

**Soluzione Proposta:**
- Aggiungere `aria-label`, `role="img"`, `title`, `desc` agli SVG
- Media query `prefers-reduced-motion`
- Live regions per annunciare win/loss

---

### ⚪ T8: Configuration - Language Config (ID: t_34982243)
**Stato:** `todo`  
**Priorità:** MEDIA  
**Dipendenze:** T7

**Problema:** Language config hardcoded  
**File:** `api/_lib/languages.js`

**Soluzione Proposta:**
- Config esterno JSON/YAML
- Supporto lingue custom
- Mappatura custom repo → lingua

---

### ⚪ T9: Architecture - SVG Builder Modular (ID: t_e3fd96a8)
**Stato:** `todo`  
**Priorità:** MEDIA  
**Dipendenze:** T8

**Problema:** SVG builder monolitico  
**File:** `api/_lib/svg-builder.js`

**Soluzione Proposta:**
- `svg-grid.js` - grid generation
- `svg-animations.js` - animations
- `svg-icons.js` - icons
- Refactor `svg-builder.js` in modulo principale

---

### ⚪ T10: State Management - Versioning (ID: t_db698a61)
**Stato:** `todo`  
**Priorità:** MEDIA  
**Dipendenze:** T9

**Problema:** Nessuna migration per state changes  
**File:** `api/_lib/state.js`

**Soluzione Proposta:**
|- `STATE_VERSION = 2`
|- Migration system per versioni precedenti
|- Test per version compatibility

**File di riferimento:** `kanban-t10-state-versioning.md`

---

### ⚪ T11: Tutti i Problemi da ISSUES.md (ID: t_11_issues_list)
**Stato:** `todo`  
**Priorità:** ALTA  
**Dipendenze:** Nessuna

**Problema:** Lista completa di 21 problemi da ISSUES.md

**File di riferimento:** `ISSUES.md`, `kanban-t11-all-issues.md`

---

## 📊 Statistiche

|| Priorità | Count |
||----------|-------|
|| CRITICA | 2 |
|| ALTA | 3 |
|| MEDIA | 6 |

|| Stato | Count |
||-------|-------|
|| running | 1 |
|| blocked | 1 |
|| todo | 9 |

---

## 🚀 Prossimi Step Immediati

1. **OCCUPATI SU T1** - Il task è già `running`, inizia a lavorare sui test
2. Quando T1 è `done`, T2 si sblocca automaticamente
3. Procedi sequenzialmente seguendo le dipendenze

---

## 📝 Comandi Utili

```bash
# Vedere tutti i task
cd /home/simonerimenti/Progetti/GithubSlotMachine
hermes kanban list

# Vedere uno specifico task
hermes kanban show t_7f2937fd

# Aggiungere commenti
hermes kanban comment t_7f2937fd "Progresso: test coverage raggiunta al 50%"

# Completare un task
hermes kanban complete t_7f2937fd --summary "Testing completato: 90% coverage raggiunto"
```

---

*Ultimo update: 2026-07-13*
