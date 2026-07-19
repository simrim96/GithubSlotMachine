# ISSUES.md — GitHub Slot Machine

Analisi statica + test eseguite il 19/07/2026.
Stato test: `npx vitest run` → 208/208 passati.
Stato lint: `npx eslint .` → 0 errori, 0 warning (gate attivo in CI, ISSUE-26 risolto).

Gli ID "ISSUE-N" già usati nei commenti del codice (ISSUE-1, ISSUE-3, ISSUE-7,
ISSUE-11, ISSUE-12) si riferiscono a fix già chiusi: qui sotto si usano nuovi ID
(ISSUE-20+) per problemi ancora aperti.

================================================================================
# C) MIGLIORAMENTI / NICE-TO-HAVE
================================================================================

- M5: Documentare nel README il comportamento della cache repo (ISSUE-28) e il
     fatto che il primo spin può puntare al profilo.
- M6: Uniformare la gestione CORS (ISSUE-25) e scrivere un test che verifichi
     gli header CORS sugli endpoint /api/*.
- M7: Separare token di lettura/scrittura Upstash (ISSUE-23) e testare il
     fallimento silenzioso delle scritture.
