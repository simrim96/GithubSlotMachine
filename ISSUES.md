# ISSUES.md — GitHub Slot Machine

Analisi statica + test eseguite il 19/07/2026.
Stato test: `npx vitest run` → 208/208 passati.
Stato lint: `npx eslint .` → 0 errori, 0 warning (gate attivo in CI, ISSUE-26 risolto).

Gli ID "ISSUE-N" già usati nei commenti del codice (ISSUE-1, ISSUE-3, ISSUE-7,
ISSUE-11, ISSUE-12) si riferiscono a fix già chiusi: qui sotto si usano nuovi ID
(ISSUE-20+) per problemi ancora aperti.

================================================================================
# B) DEBOLEZZE ARCHITETTURALI / QUALITÀ
================================================================================

## ISSUE-31 · [BASSA] Sentry `debug:true` in development
- File: sentry.config.js:22-24
- Sintomo: se `SENTRY_DSN` è impostato in dev, `debug:true` invia eventi/logger
  a Sentry anche in locale. Minore, ma rumoroso.
- Fix: `debug` solo se `SENTRY_DEBUG === 'true'` (già così) — togliere il
  fallthrough su `NODE_ENV === 'development'`.

================================================================================
# C) MIGLIORAMENTI / NICE-TO-HAVE
================================================================================

- M2: Aggiungere ESLint come gate CI (✅ fatto, ISSUE-26) e un job di `npm audit` /
     secret-scan per la sicurezza (almeno documentare che non esiste, ISSUE-27).
- M3: ✅ fatto — tutti gli header GitHub centralizzati su `ghHeaders`
     (ISSUE-22 risolta); tests/header-contract.test.js copre già
     image/health/ratelimit-status.
- M4: Monitoring: log/alert quando il sync Redis→GitHub (state.js:222) fallisce
     ripetutamente, così ci si accorge se lo stato non si sta salvando.
- M5: Documentare nel README il comportamento della cache repo (ISSUE-28) e il
     fatto che il primo spin può puntare al profilo.
- M6: Uniformare la gestione CORS (ISSUE-25) e scrivere un test che verifichi
     gli header CORS sugli endpoint /api/*.
- M7: Separare token di lettura/scrittura Upstash (ISSUE-23) e testare il
     fallimento silenzioso delle scritture.
