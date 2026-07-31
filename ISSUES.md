# ISSUES - GithubSlotMachine

## Indice

- [🐛 Bug & Criticità](#-bug--criticità)
- [⚡ Miglioramenti Architetturali](#-miglioramenti-architetturali)
- [🛡️ Sicurezza](#-sicurezza)
- [📊 Metriche Progetto](#-metriche-progetto)
- [🐛 Issue Risolte](#-issue-risolute)

---

## 🐛 Bug & Criticità

### BUG-1: `Math.random()` per selezione repo — distribuzione non uniforme + prevedibile

**Status:** ✅ **FIXED**

**File:** `api/_lib/repos.js` riga 267

**Fix:** Sostituito `Math.random()` con `crypto.randomInt(repos.length)` — distribuzione uniforme e non prevedibile.

**File:** `api/spin.js` riga 382

**Problema:**
```js
const rand = Math.floor(Math.random() * repos.length);
const selected = repos[rand];
```
`Math.random()` non è crittograficamente sicuro e ha distribuzione non uniforme su intervalli non interi. Per un progetto "slot machine" è un bug minore, ma:
1. A `repos.length` grande, il modulo non intero distorce le probabilità.
2. Il seed è il timer del processo Node — un adversario che conosce il tempo di avvio della lambda può predire il prossimo repo estratto.

**Suggerimento:** Usare `crypto.randomInt(repos.length)` (Node built-in) per distribuzione uniforme e non prevedibile.

---

### BUG-2: Health endpoint lancia errore → 500 FUNCTION_INVOCATION_FAILED su Vercel

**Status:** ✅ **FIXED**

**File:** `api/health.js` righe 61-66

**Fix:** Rimosso `throw new Error(...)` — ora il health endpoint ritorna sempre 200. Quando `kv_roundtrip_ms > 60` imposta `severity: "warning"` e un messaggio descrittivo in `kv_note` invece di crashare.

**File:** `api/health.js` riga 61-66

**Problema:**
```js
if (steps.kv_roundtrip_ms > 60) {
  throw new Error(slowMsg);
}
```
Il health endpoint lancia un'eccezione quando Upstash è lento (>60ms). Su Vercel, questo si traduce in `500 FUNCTION_INVOCATION_FAILED` — la stessa sintomatologia del bug già risolto del cold-start. Il cron di warmup che punta a `/api/health` potrebbe quindi fallire silenziosamente.

**Fix suggerito:** Sostituire `throw` con un campo di stato nella response JSON e status 200 con `severity: "warning"`. Il health endpoint deve essere puramente informativo, non deve mai fallire.

---

### BUG-3: Race condition nella lettura della leva — `lastPullTimestamp` perso tra spin e lettura

**Status:** 🔷 **MITIGATO**

**File:** `api/lever.js`, `api/spin.js`, `api/_lib/state.js`

**Problema:**
`spin.js` scrive `lastPullTimestamp` via `Promise.allSettled` con `kvSet` + `commitReadme`. Se `kvSet` fallisce (ma `commitReadme` riesce, o viceversa), la leva potrebbe non avere la fonte di verità. La triple-fallback (`?v` → KV → raw GitHub) copre la maggior parte dei casi, ma:
- Se KV è down e `?v` non è presente (README non ancora aggiornato), la fetch raw a GitHub ha timeout 800ms → latenza percepita alta.
- Il 30s di finestra (`PULL_RECENCY_WINDOW_MS`) è hardcoded e non configurabile.

**Mitigazione attuale:** Il 3° fallback (raw GitHub) è fuori dal percorso caldo dopo il fix del 2026-07-23.

---

## ⚡ Miglioramenti Architetturali

### PERF-1: Cache repo in-memory si resettata a ogni cold-start

**Status:** ✅ **FIXED** — 2026-07-31

**File:** `api/_lib/repos.js`

**Fix:** Aggiunto `loadFromKv()` a livello di modulo (top-level after import). La cache in-memory viene popolata da KV al caricamento del modulo, eliminando il primo spin lento dopo il cold-start di Vercel Edge.

---

### PERF-2: SVG rebuilding completo a ogni request

**Status:** 🔷 **ACCETTABILE**

**File:** `api/_lib/svg-builder.js`

La cache L1 esiste (`gsm:svgCache`) e accelera i casi ripetuti (stesso owner/repo/language), ma ogni combinazione nuova ricostruisce l'SVG da zero (SVGOMG + building procedurale). Dato che l'SVG è tipicamente <50KB e SVGOMG è veloce, il trade-off è ragionevole. Non è urgente ma sarebbe interessante:
- Pre-build SVG per i top-20 repo più comuni a cold-start.
- Invalidation automatica quando un repo cambia (webhook GitHub — complesso, bassa ROI).

---

### PERF-3: State sync parallelo — `commitReadme` + `kvSet` in `Promise.allSettled`

**Status:** 🔶 **DA MONITORARE**

**File:** `api/spin.js` righe 520-530

`Promise.allSettled` permette che uno dei due fallisca silenziosamente. Se `commitReadme` fallisce (GitHub rate limit), l'utente viene rediretto ma lo spin non è visibile sul profilo. Se `kvSet` fallisce, la leva non si anima. In entrambi i casi l'utente non vede errori.

**Suggerimento:** Loggare separatamente l'esito di ciascun operazione in `Promise.allSettled` e considerare un fallback sequenziale: se `kvSet` fallisce, provare `commitState` (che usa lo stesso token GitHub ma via API Contents invece di raw).

---

## 🛡️ Sicurezza

### SEC-1: `GITHUB_PAT_REQUIRE_FINEGRAINED` documentato ma non implementato

**Status:** ✅ **IMPLEMENTATO**

**File:** `api/_lib/github.js` (`auditToken`, `detectTokenType`), `api/spin.js:204-211`

**Dettaglio:** Il rilevamento token esiste già: `detectTokenType` identifica `fine-grained`, `classic`, `unknown`, `none`. `auditToken` emette warning per token insicuri e opzionalmente lancia errore con `enforce=true` (controllato da `GITHUB_PAT_REQUIRE_FINEGRAINED=true`). Chiamato a ogni spin in `spin.js`. Test: `tests/s4-token.test.js` (8 test).

**File:** `ISSUES.md` (Config Env Necessari, riga 204-205)

**Problema:**
Nel file ISSUES.md è documentata l'env var `GITHUB_PAT_REQUIRE_FINEGRAINED=false`, ma nessun controllo nel codice verifica che il PAT sia fine-grained. Se un PAT classico con troppi permessi viene accidentalmente configurato, non c'è enforcement.

**Fix:** Aggiungere in `spin.js` o `api/_lib/github.js`:
```js
// Verifica che il PAT sia fine-grained (inizia con `github_pat_`)
if (process.env.GITHUB_PAT && !process.env.GITHUB_PAT.startsWith('github_pat_')) {
  logger.error('GITHUB_PAT sembra un PAT classico (inizia con "ghp_"). '
    + 'Usare un fine-grained token (github_pat_) è fortemente raccomandato.');
}
```

---

### SEC-2: CORS wildcard `*` — accettabile ma documentare il rischio

**Status:** ✅ **FIXED** — 2026-07-31

**File:** `api/_lib/cors.js` (righe 2-18, commento esplicito SEC-2)

**Dettaglio:** Aggiunto blocco commento in testa a `cors.js` che documenta perché il wildcard `*` è necessario per `/api/image` e `/api/lever` (SVG embeddati in README GitHub su dominio non sotto nostro controllo) e perché è sicuro (nessun dato sensibile, nessun cookie, nessuna modifica stato, solo risorse statiche pubbliche).

---

### SEC-3: Open redirect — protezione esistente ma base URL non valida

**Status:** ✅ **IMPLEMENTATO**

**File:** `api/spin.js`

La validazione `isValidRedirectUrl` controlla che:
- Inizio con `/` (same-origin)
- O sia un dominio allowlisted (`github.com`, `*.github.com`, `*.github.io`)
- Non contenga sequenze di escape URL

Funziona bene. L'allowlist è esplicita e non apre a domini arbitrari.

---

## 📊 Metriche Progetto

### Statistiche Codice (2026-07-31)

| Metrica | Valore |
|---------|--------|
| **Test Files** | 41 |
| **Total Tests** | 357 |
| **Test Status** | ✅ Tutti passati (357/357) |
| **Build** | ✅ Nessun build step (serverless) |
| **Lint** | Pulito (0 errori, 0 warning) |
| **API Endpoints** | 8 (`spin`, `image`, `lever`, `health`, `ratelimit-status`, `cron-populate-repo-cache`) |
| **Librerie Shared** | 9 (`github`, `state`, `kv`, `repos`, `game`, `svg-builder`, `cors`, `ratelimit`, `spin-cooldown`, `languages`, `response-bridge`, `logger`) |

### Performance Stimate (Vercel Edge + Upstash Redis same-region)

| Operazione | Tempo |
|-----------|-------|
| Spin (warm, KV HIT) | 200-400ms |
| Spin (cold, KV miss) | 500-1200ms |
| SVG (cache HIT) | <10ms |
| SVG (cache MISS) | 100-300ms |
| Health (KV enabled) | 10-30ms |
| Health (KV disabled) | 5-10ms |
| Lever (con KV) | 10-50ms |
| Lever (fallback raw GH) | 40-800ms |

### Env Variables Necessari

```bash
# Obbligatorio per production
GITHUB_PAT=github_pat_...                    # fine-grained, repo scope minimo
GITHUB_OWNER=simrim96                        # owner dei repo da scansionare

# Upstash Redis (altrettanto raccomandato — senza si perde stato community)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
# oppure
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...

# Opzionali
SLOT_OWNER=simrim96                          # owner del profilo GitHub
SLOT_REPO=GithubSlotMachine                  # repo della slot machine
SENTRY_DSN=https://...                       # per error tracking
```

---

## 🐛 Issue Risolte

### Health endpoint `?full=1` → 500 FUNCTION_INVOCATION_FAILED (bug warmup morto)

**Status:** ✅ **FIXED** — 2026-07-23

**Problema:** `health?full` chiamava `getRepoForLanguage()` → `refreshCache()` → fetch GitHub pendenti → Vercel terminava la lambda → `FUNCTION_INVOCATION_FAILED`.

**Fix:** Riscritto health per usare solo `getRepoCacheStats()` — nessuna fetch GitHub, nessun crash.

**File:** `api/health.js`, `api/_lib/repos.js`

---

### Lever Animation Cache Issue

**Status:** ✅ **FIXED** — Animazione della leva non si aggiornava dopo lo spin

**Fix:** Aggiunto cache-buster `api/lever?v=<spinStart>` in `spin.js`, ridotto cache a 5s in `lever.js`.

**File:** `api/spin.js`, `api/lever.js`

---

### M11: Lever Pull Animation Timing Fix

**Status:** ✅ **FIXED** — Animazione di pull non visibile dopo refresh pagina

**Fix:** `lastPullTimestamp = spinStart + 500ms` estende la finestra di animazione a 3s totali.

**File:** `api/spin.js`, `api/lever.js`

---

### Regressione velocità leva — fetch rete a raw.githubusercontent.com sul percorso caldo

**Status:** ✅ **FIXED** — 2026-07-23

**Fix:** Riordinato le fonti in `getPullState()`: `?v` → KV → raw GitHub. Il percorso caldo ora usa solo fonti in-memory/Redis.

**File:** `api/lever.js`

---

### BUG: Redirect dentro il repo della slot (isRepoExcluded)

**Status:** ✅ **FIXED** — 2026-07-24

**Fix:** Aggiunta `isRepoExcluded()` che filtra `simrim96/simrim96` e `GithubSlotMachine` dalla selezione dei repo.

**File:** `api/_lib/repos.js`

---

### BUG: Animazione leva non funzionava localmente

**Status:** ✅ **FIXED**

**Fix:** Creato `api/ratelimit-status.js`, aggiornato `public/index.html` con lever animation, implementato endpoint in `scripts/simple-dev.mjs`.

**File:** `api/ratelimit-status.js`, `public/index.html`, `scripts/simple-dev.mjs`

---

## 📝 Note Finali

### Stato Generale del Progetto

**BUONO** — Il progetto è ben architettato e testato. Le principali criticità sono state risolte. I punti rimanenti sono miglioramenti minori.

**Punti di forza:**
- ✅ 357 test passati — buona copertura
- ✅ Multi-layer fallback (spin, leva, SVG)
- ✅ Caching tiered (L1 in-memory + Redis)
- ✅ CORS configurato correttamente per embedding cross-origin
- ✅ Rate limiting + spin cooldown
- ✅ Health endpoint diagnostico

**Aree di miglioramento:**
- 🟡 BUG-3: Race condition leva — mitigato, da monitorare
- 🟡 PERF-3: State sync parallelo — da monitorare
- 🟡 SVG pre-build per i top repo (PERF-2) — accettabile

---

*Ultima modifica: 2026-07-31 — Analisi completa codice sorgente, ISSUES.md riscritto con criticità reali*
