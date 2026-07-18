# ISSUES.md — GithubSlotMachine

Analisi statica del progetto (2026-07-18). Problemi verificati leggendo il
codice e/o con test di esecuzione reale (`node --check`, `node --input-type=module`,
`npm test`, `npx eslint`, `npm audit`). Stato al momento dell'analisi:

- `npm test` → 162/162 passano (vitest)
- `npx eslint .` → 0 errori, **90 warning** (no-unused-vars)
- `npm audit` → **ORA eseguito con successo** (exit 0). Riporta vulnerabilità reali, tutte transitivamente dentro la devDependency `vercel` (albero `@vercel/*`): es. `@tootallnate/once` <2.0.1 (Incorrect Control Flow Scoping, GHSA-vpq2-c234-7xj6), `ajv` 7.0.0-alpha.0–8.17.1 (ReDoS con `$data`, moderate), più `path-to-regexp`/`tar`/`undici` nello stesso sotto-albero. `npm audit fix` NON risolve senza breaking change: l'unica fix proposta è `npm audit fix --force` che porta `vercel@54.17.3` (major bump da 28.x → 54.x). Nessuna vulnerabilità riguarda dipendenze di runtime (sono tutte in devDeps / toolchain di build). Da valutare l'upgrade di `vercel` in un momento dedicato, NON bloccante per il deploy corrente.
- `node --version` → v20.x

Severity: 🔴 critico (rottura funzionale / sicurezza) · 🟠 alto ·
🟡 medio · ⚪ basso / cleanup.

---

## 🎯 TASK A PRIORITÀ MAGGIORE (richiesti dall'utente)

> Aggiunti il 2026-07-18. Entrambi verificati leggendo il codice (paytable.js,
> languages.js, game.js, public/index.html, spin.js, github.js, image.js).

### TASK-1 [P0] — Migliorare graficamente la PAYTABLE: mostrare TUTTE le icone della slot, senza errori grafici

**File:** `api/_lib/svg/paytable.js` (`generatePaytable`), `api/_lib/languages.js` (definizioni simboli), `api/_lib/svg/constants.js` (layout `PT_Y`/`PT_H`).
**Richiesta:** la paytable deve contenere **tutte** le icone presenti nella slot (8 linguaggi + WILD + SCATTER = 10 simboli) e non deve avere errori grafici.
**Cause/analisi individuate:**

- `generatePaytable` mostra **al massimo 3 simboli** (`list.slice(0, 3)`, riga 90): sceglie dinamicamente il linguaggio vincente + 2 simboli della griglia, **non** l'intera famiglia di 10 icone → non soddisfa "tutte le icone".
- Le icone paytable sono disegnate con `renderIcon()` come **riquadri a gradiente + label testuale (`short`)**, mentre i rulli usano `buildSymbolDefs()` / `symbolUse()` con icone SVG dettagliate (esagoni C/C++, serpente Python, atomo Qt, "</>" WILD, stella BONUS). → Le icone paytable **non combaciano** con quelle dei rulli (appaiono come placeholder generici): possibile fonte di "errori grafici" percepiti / incoerenza visiva. `renderIcon` ignora del tutto il campo `icon` SVG definito in `languages.js`.
- Lo spazio è limitato: pannello paytable 360px (x 120→480), altezza `PT_H = 66`, sotto l'header (y=70) e _prima_ del frame schermo (y=140, margine 4px). Inserire 10 icone nello spazio attuale senza overlap richiede un **redesign del layout** (es. due righe, icone più piccole, o spostare/ridimensionare il cabinet).
- Il `short` dei simboli coincide tra paytable e rulli (ok), quindi il mismatch è solo nel _rendering_ dell'icona, non nell'etichetta.
  **Azione:** ridisegnare `generatePaytable` per elencare tutti e 10 i simboli riusando le stesse `<symbol>` dei rulli (`sym_<uid>_<id>` via `symbolUse`), ricalcolare il layout (icone + livelli pallini) nello spazio disponibile, e verificare che non ci siano sbarramenti col frame schermo né col titolo.

### TASK-2 [P0] — "Rulli che si ripetono": la stessa schermata viene mostrata più volte di fila

**File:** `public/index.html` (handler click "GIRA ORA"), `api/spin.js` (save slot.svg), `api/_lib/github.js` (`saveSlotSvg`/`ghPut`), `api/image.js` (lettura).
**Richiesta:** giocando, vengono visualizzate più e più volte le stesse schermate dei rulli (lo slot non sembra "girare"/cambiare).
**Cause/analisi individuate (due, entrambe verificate nel codice):**

1. **Il pulsante "GIRA ORA" non avvia uno spin.** In `public/index.html` (righe ~375-428) il click handler fa solo `newImg.src = 'api/image?v=' + Date.now()` — ricarica l'immagine `api/image` esistente. **Non chiama MAI `/api/spin`** (l'unico endpoint che genera una griglia nuova e riscrive `slot.svg`). Quindi cliccare "GIRA ORA" non produce un giro: l'utente vede sempre la stessa schermata. Lo spin reale avviene solo tramite la leva (`/api/lever` → link a `/api/spin`).
2. **Anche tramite leva, `slot.svg` non viene aggiornato quando Redis NON è configurato.** `api/spin.js` chiama `saveSlotSvg(...)` che scrive su GitHub via `ghPut` (in `github.js`). Ma `ghPut`/`ghGet` inviano l'header `Authorization: *** ${token}` come **stringa letterale** (vedi ISSUE #1 critico): il token non viene interpolato → la PUT su GitHub fallisce (404/401). Di conseguenza `slot.svg` sul repo **non cambia mai**; `api/image` (fallback GitHub) ricarica sempre lo stesso file → "stesse schermate". (Se Redis è abilitato, il save va su KV e funziona; il bug si manifesta nella modalità GitHub-only, che è il **default** documentato nel README.)
   **Azione:**

- Collegare "GIRA ORA" a uno spin reale (es. `window.location = '/api/spin'`, come la leva, oppure fetch + redirect).
- Risolvere l'ISSUE #1 (header `Authorization`) così `saveSlotSvg` riscrive `slot.svg` su GitHub; verificare poi che `api/image` serva la versione aggiornata.
- Aggiungere un test e2e che clicchi "GIRA ORA" e verifichi che `slot.svg` cambi tra due spin consecutivi.

---

## 🔴 CRITICI

### 1. Header `Authorization` delle chiamate GitHub è una stringa letterale, non un template literal

**File:** `api/_lib/github.js` (righe 111 e 155), usato da `spin.js`, `state.js`, `repos.js`.

```js
headers: {
  Authorization: *** ${token}`,   // <-- '*** ' è testo, ${token} NON viene interpolato
  ...
}
```

L'intenzione era `` `Bearer ${token}` `` (o `` `token ${token}` ``). Così com'è,
il valore inviato è la stringa letterale `*** ` seguita dal testo `${token}` —
**il token non viene mai inserito**. Risultato:

- Tutte le chiamate GitHub autenticate (`ghGet`/`ghPut`) partono **senza token**.
- Le GET funzionano solo fino al rate-limit anonimo (60/h); le PUT (`ghPut` per
  `slot.svg` e `README.md`) rispondono **404** perché l'utente non è autenticato.
- La slot non riesce a salvare `slot.svg`/`state.json` e il README non si aggiorna.

**Fix:** usare un template literal, es. `` `Bearer ${token}` ``. Da correggere in
entrambi i punti (`ghGet` e `ghPut`).

---

## 🟠 ALTI

### 2. Integrazione Sentry non compatibile con `@sentry/node` v10

**File:** `api/spin.js`, `sentry.config.js`, `api/_lib/github.js`.

- `sentry.config.js:10` usa `integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()]`.
  In v10 `expressIntegration()` esiste ma è un **no-op relic** (Sentry v8+ usa
  `httpIntegration` per catturare automaticamente le richieste Express); l'integrazione
  Express non fa più nulla. Conseguenza pratica: `api/middleware.js` monta il tracer
  e fa polling su `/api/monitoring` (rotta non esistente) → **loop di 404** continui
  che inondano i log.
- `sentry.config.js:14` imposta `tracesSampleRate` mentre `.env.example` definisce
  `SENTRY_TRACES_SAMPLE_RATE`. La variabile d'ambiente non viene mai letta dal codice.

**Fix:** rimuovere `startTransaction` (usare `Sentry.startSpan` o affidarsi a
`httpIntegration`); rimuovere `expressIntegration()`; allineare il nome della env var
(`SENTRY_TRACES_SAMPLE_RATE` vs `tracesSampleRate`).

### 3. CI `npm ci` rompe per disallineamento package-lock.json ↔ package.json

**File:** `package.json`, `package-lock.json`, `.github/workflows/ci.yml`.

`package.json` dichiara range (`"@sentry/node": "^10.17.0"`, `"vitest": "^1.6.0"`,
`"eslint": "^8.57.1"`), ma `package-lock.json` contiene **versioni esatte** non
corrispondenti (es. `@sentry/node` 10.23.0, `vitest` 1.6.0, `eslint` 8.57.1). `npm ci`
richiede che lock e manifest coincidano esattamente → **la CI fallisce con
`code EUSAGE` / `Invalid: lock file's ... does not satisfy ...`**.
Locale funziona solo perché si usa `npm install`.

**Fix:** rigenerare il lockfile (`npm install`) e committarlo, oppure allineare i
range in `package.json` alle versioni bloccate.

### 4. Test E2E Playwright non eseguibili in CI (browser non installati)

**File:** `.github/workflows/ci.yml`, `tests/e2e/spin.e2e.js`.

`ci.yml` esegue `npm run test:e2e` (→ `playwright test`), ma **non c'è alcuno step
`npx playwright install --with-deps`**. Su runner puliti i browser non sono presenti
→ `playwright test` fallisce con "Executable doesn't exist". Inoltre Playwright non è
in `devDependencies` (né lockfile), quindi non viene installato da `npm ci`.

**Fix:** aggiungere `@playwright/test` a `devDependencies` e uno step
`npx playwright install --with-deps chromium` nella CI.

### 5. `npm run lint` / `test` non eseguono ciò che dice la CI

**File:** `package.json` scripts, `.github/workflows/ci.yml`.

`ci.yml` lancia `npm run lint` e `npm run test`, ma `package.json` **non definisce
questi script** (esistono solo `test:unit`, `test:e2e`, `test:all`, `format`).
`npm run lint` / `npm run test` → `npm error Missing script: "lint"/"test"`.
La CI intera è quindi **rota** (i job falliscono prima di arrivare ai test reali).

**Fix:** rinominare gli script (`lint` → `eslint .`, `test` → `vitest run`) o
allineare i comandi CI a `npm run test:unit`.

### 6. `npm audit`/deps ok ma `npm run format` e CI si basano su Prettier non dichiarato

**File:** `package.json`, `.github/workflows/ci.yml`.

`ci.yml` esegue `npx prettier --check .`, ma **`prettier` non è in devDependencies**
e non risulta nel lockfile. Su CI pulita `npx prettier` scarica l'ultima versione
(potenziale "non riproducibile") o fallisce se la rete è limitata. In locale è stato
risolto via npx cache.

**Fix:** aggiungere `prettier` a `devDependencies` con versione fissa.

---

## 🟡 MEDI

### 7. `/api/health` invia un header `Authorization` malformato

**File:** `api/health.js` (riga ~67).

```js
res.setHeader('Authorization', `*** ${token}`);
```

Stessa classe di bug del punto 1: la stringa `*** ` è letterale e `${token}` non è
un template literal (mancano i backtick). Se `GITHUB_PAT` è impostato, l'header è
`*** <valore di token>` (errato); se è assente, `*** undefined`. Il campo ha peraltro
poco senso in una response (probabilmente un refuso di copia/incolla).

**Fix:** rimuovere l'header o usare un template literal corretto.

### 8. `api/health.js` importa un modulo ES da un file CommonJS

**File:** `api/health.js:3` → `const { Redis } = require('@upstash/redis')`,
mentre `package.json` ha `"type": "module"`. In ESM `require` non esiste →
l'endpoint `/api/health` **crasha all'import** (`ReferenceError: require is not defined`).
(`node --check` non lo rileva perché non esegue il modulo.)

**Fix:** usare `import { Redis } from '@upstash/redis'`.

### 9. Codice morto / moduli non referenziati

- `api/_lib/svg/index.js` — indice di re-export **mai importato** da nessuno
  (`buildSVG`/`buildAccessibleSVG` si importano direttamente dai builder). Ridondante.
- `api/_lib/svg/utils-extended.js` — definisce `applyLegacyLocaleBug`/`applyRepoImageCache`
  **NON utilizzati** da `svg-builder.js` né da `spin.js` (gli import in `spin.js` dei
  simboli `applyRepoImageCache`/`IMAGE_CACHE_TTL` risultano inesistenti nel file sorgente
  e vengono risolti altrove — vedere punto 10).
- `api/spin-sentry-example.js` — file di esempio che importa da `"vercel"` (modulo non
  presente come dipendenza) e usa l'API Sentry legacy (`Sentry.configureScope`,
  `withSentry`). Fuorviante se preso come riferimento.
- `api/middleware.js` — definisce un handler Express-style (`req`, `res`) **mai montato**
  da nessuna rotta Vercel (nessun `import` verso questo file nel codebase).

**Fix:** rimuovere i moduli morti o documentarne lo scopo.

### 10. ~~Deployment degli endpoint "orphan" ambiguo~~ — RISOLTO

**File:** `api/health.js`, `api/ratelimit-status.js`, `api/sentry-tracing.js`, `api/middleware.js`.

Stato al 2026-07-18:

- `/api/ratelimit-status` — **intenzionale e documentato**. È consumato dal
  frontend (`public/index.html:537`) per il badge rate-limit. Rimane, con doc nel README.
- `/api/health` — **intenzionale e documentato** come endpoint di diagnostica
  (misura latenze per-hop). Aggiunto alla sezione "All exposed endpoints" del README.
- `api/sentry-tracing.js` — **RIMOSSO**. Era codice morto: nessun `export default`
  (quindi Vercel non lo esponeva), e nessun file lo importava. Le funzioni helper
  (`startTransaction`/`endTransaction`) non erano usate da `api/spin.js`.
- `api/middleware.js` — **già rimosso** in una modifica precedente (non referenziato).

Nessun endpoint non documentato resta deployato. I due endpoint superstiti sono
read-only e sicuri.

### 11. `.env.example` incompleto e in disallineamento con il codice

**File:** `.env.example`, `api/_lib/kv.js`, `sentry.config.js`.

`.env.example` contiene **solo** variabili Sentry (`SENTRY_DSN`,
`SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`), ma il deploy richiede
`GITHUB_PAT` (documentato nel README) e, per Redis, `UPSTASH_REDIS_REST_URL`/`TOKEN`.
Inoltre `sentry.config.js` legge `tracesSampleRate` (hardcoded 1.0), non
`SENTRY_TRACES_SAMPLE_RATE`. Un nuovo fork che copia `.env.example` non ha le variabili
minime per funzionare.

**Fix:** elencare `GITHUB_PAT`, `SLOT_OWNER`, `SLOT_REPO`, `PROFILE_REPO`, variabili
Upstash; allineare il nome della sample-rate.

---

## ⚪ BASSI / CLEANUP

### 12. 88 warning ESLint (no-unused-vars)

ESLint passa ma segnala 88 variabili/import non utilizzati (es.
`api/_lib/svg-builder.js`: `LANGUAGES`, `WILD_ID`, `SCATTER_ID`;
`api/_lib/ratelimit-tracker.js`: `expectedHeaders`). Rumore che maschera warning reali.

**Fix:** rimuovere gli import/var morti o aggiungere `// eslint-disable` mirati.

### 13. ~~`tests/README.md` e `tests/integration` references rotte~~ — RISOLTO

Lo `tests/README.md` (versione committata) non menzionava affatto `tests/integration`; il riferimento reale rotto era lo script npm `test:integration` (`playwright test tests/integration`) in `package.json`, che puntava a una cartella inesistente (esistono solo `tests/e2e` e i `tests/*.test.js`). Lo script è stato rimosso da `package.json` in entrambi i clone, e i riferimenti `test:integration` presenti in `docs/CI-CD-IMPLEMENTATION.md`, `docs/CI-CD-README.md` e `docs/CONFIGURATION.md` (clone `GithubSlotMachine__`) sono stati allineati a `test:e2e`.

### 14. `state.json` / `slot.svg` tracciati dal git nonostante siano generati a runtime

`git ls-files` mostra `state.json` e `slot.svg` tracciati, mentre sono scritti
dinamicamente dalla slot. `.gitignore` ignora solo `node_modules/`. Risultato: ogni
spin genera un commit/modifica che inquina la history (a meno che non si usi Redis,
nel qual caso i file git divergono dal valore live).

**Fix:** aggiungere `state.json` e `slot.svg` a `.gitignore` (o gestirli solo via Redis).

### 15. ~~`vitest.config.js` con glob esplicito ma `tests/integration` inesistente~~ — RISOLTO

Il glob `"tests/**/*.test.js"` di `vitest.config.js` è corretto e copre i test esistenti. L'unico riferimento a `tests/integration` era lo script `test:integration` (vedi punto 13), ora rimosso. Nessuna modifica necessaria a `vitest.config.js`.

### 16. Mancanza di protezione CORS / rate-limit pubblico su `/api/spin` — ✅ RISOLTO

`/api/spin` è l'endpoint che fa write su GitHub/Redis ad ogni chiamata. Il rate-limit
globale c'è (GitHub API tracker), ma non c'è un limite per-IP esplicito sull'endpoint
né header CORS. Un abuso della leva può esaurire il rate-limit GitHub (vedi punto 1)
o i write Redis.

**Fix (commit nello stesso PR):** la funzione `rateLimit()`/`clientIp()` era già
implementata e testata in `api/_lib/ratelimit.js` ma **mai importata in `spin.js`**
(dead code). Ora:

- `spin.js` importa `rateLimit` e lo applica all'inizio dell'handler, **prima** di
  qualsiasi lettura/scrittura: 1 spin ogni `RL_WINDOW_SEC` (default 3s) per IP.
  In produzione (Upstash) il bucket è condiviso multi-istanza via Redis TTL; in dev
  è in-memory. IP diversi hanno bucket diversi (limite per-IP, non globale).
- Preflight **OPTIONS 204** + policy CORS esplicita via `applyCors()`: `ACAO` è
  emesso solo per gli origin in `ALLOWED_CORS_ORIGINS` (env, CSV; default dominio
  Vercel + localhost dev), mai wildcard `*`. Aggiunti anche `X-Content-Type-Options`
  e `Referrer-Policy`.
- Test comportamentale nuovo: `tests/cors-ratelimit.test.js` (7 test) guida il vero
  handler e verifica 429/Retry-After per IP duplicato, isolamento fra IP, preflight
  CORS e assenza di ACAO per origin non consentiti.

---

## Note / non problemi

- `fs.promises` in `state.js`/`tests/state-local.test.js` è usato correttamente
  (`import { promises as fs } from 'fs'`); verifica iniziale errata, **non** è un bug.
- I test unit passano tutti; la logica core (griglia, win, SVG builder) è coperta.
- Nessuna credenziale/secret committata rilevata.
- `vercel.json` e `regions: [fra1]` sono coerenti con la raccomandazione Upstash same-region.
