# Kanban Task: Tutti i Problemi da ISSUES.md

**Task ID:** t_new_issues_list  
**Stato:** todo  
**Priorità:** ALTA  
**Dipendenze:** Nessuna  
**Data creazione:** 2026-07-14  

## Descrizione

Questo task raccoglie TUTTI i problemi elencati nel file ISSUES.md in un'unica lista completa.  
Serve come riferimento centrale per tracciare tutti i bug, limiti architetturali e miglioramenti necessari.

---

## 🔴 PROBLEMI CRITICI (Priorità ALTA)

### 1. Test WILD Non Funziona Come Wildcard
- **File:** `tests/game.test.js:107-116`
- **Problema:** checkWins() non gestisce WILD_ID come wildcard
- **Impatto:** ALTA - logica di gioco base corrotta
- **Fix:** Modificare checkWins() per trattare WILD_ID come wildcard

### 2. SCATTER Non Viene Contato Correttamente
- **File:** `tests/game.test.js:174-179`
- **Problema:** countScatters() ritorna 0 invece di 2
- **Impatto:** MEDIA - scatter trigger non funzionano
- **Fix:** Correggere l'iterazione in countScatters()

### 3. Near-Miss Geometry Violato
- **File:** `tests/game.test.js:237-269`
- **Problema:** Invariant tra engineerNearMiss() e detectNearMiss() violato
- **Impatto:** ALTA - near-miss non evidenziato visivamente
- **Fix:** Allineare detectNearMiss() con la geometria di engineerNearMiss()

### 4. SVG Manca data-testid="slot-svg"
- **File:** `tests/spin.test.js`
- **Problema:** SVG generati senza data-testid
- **Impatto:** MEDIA - niente E2E testing possibile
- **Fix:** Aggiungere data-testid="slot-svg" in svg-builder.js

### 5. CI/CD Pipeline Assente
- **File:** Mancante
- **Problema:** Nessuna directory `.github/workflows/`
- **Impatto:** ALTA - nessun test automatico, deploy rischioso
- **Fix:** Creare `.github/workflows/ci.yml` con:
  - Test suite
  - Linting (ESLint, Prettier)
  - Security scanning (npm audit, Snyk)
  - Preview deployments per PR
  - Production deployment su main

### 6. Accessibility - SVG Senza ARIA Labels
- **File:** `api/_lib/svg-builder.js`
- **Problema:** SVG senza role, aria-label, aria-describedby
- **Impatto:** MEDIA-ALTA - utenti cieci esclusi
- **Fix:** Aggiungere ARIA labels completi agli SVG

### 7. Accessibility - Animazioni Senza prefers-reduced-motion
- **File:** `api/_lib/svg-builder.js` (CSS generato)
- **Problema:** Nessuna media query per utenti sensibili al movimento
- **Impatto:** MEDIA - epilessia fotosensibile, vertigini
- **Fix:** Aggiungere `@media (prefers-reduced-motion: reduce)`

### 8. Accessibility - Nessun Supporto Screen Reader
- **File:** `public/index.html` o componente client
- **Problema:** Nessun live region per annunciare win/loss
- **Impatto:** MEDIA - screen reader non aggiornati
- **Fix:** Aggiungere ARIA live regions

### 9. Rate Limit GitHub Non Esposto
- **File:** Mancanti (`api/metrics.js`, `public/metrics.html`)
- **Problema:** Rate limit tracking interno, non accessibile
- **Impatto:** ALTA - utenti bloccati senza avviso
- **Fix:** Creare endpoint `/api/metrics` e dashboard pubblica

---

## 🟡 PROBLEMI SECONDARI (Priorità MEDIA)

### 10. Focus Management Mancante
- **File:** Client-side code
- **Problema:** Nessuna gestione focus dopo aggiornamento slot
- **Impatto:** MEDIA - screen reader disorientati
- **Fix:** Implementare focus management con ARIA

### 11. State Migration Solo v1→v2
- **File:** `api/_lib/state.js`
- **Problema:** Solo migrazione singola, nessun framework multi-version
- **Impatto:** MEDIA - future migrazioni difficili
- **Fix:** Creare sistema MIGRATIONS con array di funzioni

### 12. Language Config Hardcoded
- **File:** `api/_lib/languages.js`
- **Problema:** ~24K char di config hardcodata
- **Impatto:** MEDIA - difficile estendere senza editare codice
- **Fix:** Creare `languages-external.json` con config esterna

### 13. SVG Builder Monolitico
- **File:** `api/_lib/svg-builder.js`
- **Problema:** Tutto in un singolo file
- **Impatto:** MEDIA - difficile manutenibilità
- **Fix:** Refactor in moduli separati:
  - `svg-grid.js`
  - `svg-animations.js`
  - `svg-icons.js`

### 14. Memory Leak in Background Tasks
- **File:** `api/spin.js`
- **Problema:** Nessun timeout, nessun cleanup
- **Impatto:** MEDIA - leak di memoria nel tempo
- **Fix:** Aggiungere timeout e clearTimeout per background tasks

### 15. Circuit Breaker Timeout Lungo
- **File:** `api/_lib/github.js`
- **Problema:** 60 secondi di attesa dopo 3 failure
- **Impatto:** MEDIA - utente vede loading per troppo tempo
- **Fix:** Ridurre a 10s e aggiungere fallback path

---

## 🟢 NICE-TO-HAVE (Priorità BASSA)

### 16. Theme System UI
- **File:** `public/index.html`, componenti UI
- **Problema:** Nessuna possibilità di cambiare tema
- **Fix:** Aggiungere toggle tema UI

### 17. Espandere i18n
- **File:** `api/_lib/i18n.js` (o equivalente)
- **Problema:** Solo IT/EN supportati
- **Fix:** Aggiungere più lingue

### 18. Diagramma Architetturale
- **File:** `README.md`
- **Problema:** Nessuna documentazione visiva architettura
- **Fix:** Aggiungere diagramma architetturale

### 19. Documentare /api/metrics
- **File:** `README.md` o docs/
- **Problema:** Endpoint metrics non documentato
- **Fix:** Aggiungere documentazione API

### 20. Script Deploy Manuale
- **File:** `scripts/deploy.sh`
- **Problema:** Deploy manuale complesso
- **Fix:** Creare script di deploy semplificato

### 21. Sentry Dashboard
- **File:** Configurazione Sentry
- **Problema:** Error tracking ma senza alert
- **Fix:** Configurare alert Sentry

---

## 📊 Statistiche

| Priorità | Count |
|----------|-------|
| ALTA     | 9     |
| MEDIA    | 6     |
| BASSA    | 6     |
| **Totale** | **21** |

---

## ✅ Checklist di Completamento

### Fase 1: Critical Fixes (Priorità ALTA)
- [ ] Fix WILD wildcard in checkWins()
- [ ] Fix SCATTER counting in countScatters()
- [ ] Fix near-miss geometry invariant
- [ ] Aggiungere data-testid="slot-svg"
- [ ] Creare CI/CD pipeline (.github/workflows/ci.yml)
- [ ] Aggiungere ARIA labels agli SVG
- [ ] Aggiungere prefers-reduced-motion
- [ ] Aggiungere live regions per screen reader
- [ ] Creare endpoint /api/metrics

### Fase 2: Improvements (Priorità MEDIA)
- [ ] Implementare focus management
- [ ] Creare framework multi-version state migration
- [ ] Creare languages-external.json
- [ ] Refactor SVG builder in moduli
- [ ] Fix memory leak in background tasks
- [ ] Ridurre Circuit Breaker timeout a 10s

### Fase 3: Nice-to-Have (Priorità BASSA)
- [ ] Aggiungere toggle theme UI
- [ ] Espandere i18n
- [ ] Aggiungere diagramma architetturale
- [ ] Documentare /api/metrics
- [ ] Creare script deploy manuale
- [ ] Configurare Sentry alert

---

## 📈 Metriche di Successo

Dopo il completamento di tutti i task:

| Metrica | Attuale | Obiettivo |
|---------|---------|-----------|
| Test Pass Rate | 92.5% (62/67) | 100% |
| Test Coverage | ~65% | ≥80% |
| CI/CD | 0% automatico | 100% automatico |
| Accessibility | 0% ARIA labels | WCAG 2.1 AA |
| Error Tracking | Sentry (log) | Sentry (alert) |
| Rate Limit Visibility | 0% esposto | Dashboard pubblica |
| Response Time (p95) | ~150ms | <100ms |

---

## 📝 Note

- Questo task è una **lista di riferimento** per tutti i problemi
- Per ogni problema specifico, creare un task kanban separato se necessario
- Priorità può essere riaggiornata in base al contesto
- Referenza principale: `ISSUES.md`

*Ultima modifica: 2026-07-14*
