# ISSUES.md — GitHub Slot Machine

Analisi statica + test eseguite il 19/07/2026.
Stato test: `npx vitest run` → 206/206 passati.
Stato lint: `npx eslint .` → 0 errori, 0 warning (gate attivo in CI, ISSUE-26 risolto).

Gli ID "ISSUE-N" già usati nei commenti del codice (ISSUE-1, ISSUE-3, ISSUE-7,
ISSUE-11, ISSUE-12) si riferiscono a fix già chiusi: qui sotto si usano nuovi ID
(ISSUE-20+) per problemi ancora aperti.

================================================================================
# A) BUG CONCRETI (da fixare)
================================================================================

## ISSUE-25 · [RIMOSSO] — vedi cronologia git (fix CORS wildcard su /api/image e /api/lever)

================================================================================
# B) DEBOLEZZE ARCHITETTURALI / QUALITÀ
================================================================================

## ISSUE-28 · [BASSA/MEDIA] Cache repo non-bloccante disabilita il "repo per
##                    lingua" al primo giro
- File: api/_lib/repos.js:135-145 (getRepoForLanguage)
- Sintomo: al primo spin (cache vuota, `ts=0`) la funzione lancia
  `refreshCache` in background e RITORNA SUBITO `cache.byLangId[lang.id] || null`
  → `null`. Quindi lo spin punta sempre al profilo utente, mai a un repo
  specifico, finché la cache non si popola (fino a 1-3s sul cold start). Solo
  dal 2° spin in poi la feature funziona.
- Fix (nice-to-have): al primo spin fare `await` di `refreshCache` con un
  timeout corto (es. 800ms) invece di ritornare subito, così almeno il primo
  giro ha già i repo se la rete risponde.

## ISSUE-29 · [BASSA] errorSVG importato da due percorsi diversi
- File: api/spin.js:27 (da svg-builder-accessible.js) vs
  tests/* (da svg-builder.js che lo re-exporta)
- Sintomo: `errorSVG` vive in `svg-builder-accessible.js` e viene re-importato
  e ri-esposto da `svg-builder.js`. Due sorgenti per lo stesso simbolo →
  confusione su quale sia "quella giusta".
- Fix: scegliere un'unica fonte (probabilmente svg-builder.js) e importare
  sempre da lì.

## ISSUE-30 · [DESIGN CHOICE] Nessun rate-limit per-IP sugli spin
- File: api/_lib/ratelimit.js:7-13 (commento esplicito), api/spin.js
- Nota: è una scelta INTENZIONALE (ISSUE-11) — non si emette mai 429, la
  protezione è demandata al rate-limit globale GitHub (5000/h). Va bene per una
  slot personale, ma se qualcuno embeddesse la slot su molte pagine potenzialmente
  si esaurisce il budget GitHub condiviso. Da rivalutare solo se il traffico cresce.

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
