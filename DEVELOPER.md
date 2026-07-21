# 🛠️ Developer Guide - GithubSlotMachine

Questa guida documenta tutte le dipendenze del progetto e il loro scopo.

---

## 📦 Dipendenze di Produzione

### `@upstash/redis` (^1.38.0)

**Scopo:** Implementazione cache Redis per stato e repository.

**Utilizzo:**
- Persistenza `slot.svg` live image
- Contatori community (`totalSpins` / `totalWins`)
- Cache linguaggio → repository (language→repo lookup cache)
- Fallback rapido rispetto alle GitHub API (10-20ms vs 300-1500ms)

**Configurazione:**
```bash
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

**Nota:** Per prestazioni ottimali, il database Upstash deve essere nella stessa regione (`fra1`) del progetto Vercel.

---

### `@sentry/node` (^10.65.0)

**Scopo:** Monitoraggio errori lato Node.js.

**Utilizzo:**
- Logging errori in produzione
- Debug di race condition e timeout
- Alert su errori critici (state sync failure)

**Configurazione:**
```bash
SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
```

**Nota:** Il rate default è `0.1` (10%) per evitare costi elevati su traffico alto.

---

### `@sentry/vercel-edge` (^10.65.0)

**Scopo:** Monitoraggio errori per funzioni Vercel Edge.

**Utilizzo:**
- Tracing delle funzioni serverless
- Monitoraggio performance edge functions
- Errori di rate limiting e timeout

**Configurazione:** Automatico su Vercel Edge runtime.

---

### `@vercel/functions` (^3.7.5)

**Scopo:** Funzioni e utilità specifiche per Vercel.

**Utilizzo:**
- `getServerSideIP()` per rate limiting basato su IP
- Utilità per edge functions
- Integrazione con Vercel KV e altre feature

---

### `jsonschema` (^1.4.1)

**Scopo:** Validazione dati in tempo di runtime.

**Utilizzo:**
- Validazione parametri query (`user`, `redirect`)
- Validazione configurazione linguaggi
- Prevenzione input malevoli (security S1)

**Implementazione:**
```javascript
import {validate} from 'jsonschema';
const result = validate(value, schema);
if (result.errors.length > 0) { /* reject */ }
```

---

## 🔧 Dipendenze di Sviluppo

### `eslint` (^8.57.0)

**Scopo:** Linting e quality guard per il codice.

**Utilizzo:**
- Rilevamento errori di sintassi
- Enforcement dello stile di codice
- Security linting (regole custom)

**Comandi:**
```bash
npm run lint          # verifica linting
npm run lint:fix      # applica fix automatici
```

**Configurazione:** `.eslintrc.json` con estensioni `import` per ES modules.

---

### `eslint-plugin-import` (^2.32.0)

**Scopo:** Linting per import ES modules.

**Utilizzo:**
- Validazione percorsi di import
- Rilevamento import duplicati
- Enforcement di `type: module` in `package.json`

---

### `vitest` (^3.0.0)

**Scopo:** Testing unitario e E2E.

**Utilizzo:**
- Test di unità per ogni modulo
- Test di integrazione per gli endpoint
- Test di edge cases e error handling

**Comandi:**
```bash
npm test              # esegue tutti i test (vitest run)
npm run test:watch    # modalità watch
npm run test:e2e      # test E2E con Playwright
```

**Coverage:** 100% (301/301 test passed).

---

### `@playwright/test` (^1.61.1)

**Scopo:** Testing E2E end-to-end.

**Utilizzo:**
- Simulazione interazioni utente reali
- Verifica flussi completi (spin → redirect)
- Test browser compatibilità

**Configurazione:** `playwright.config.ts` con base URL Vercel.

---

### `prettier` (3.9.5)

**Scopo:** Code formatting automatico.

**Utilizzo:**
- Formattazione consistente del codice
- Prevenzione discussioni sullo stile
- Salvatempo su formattazione manuale

**Comandi:**
```bash
npm run format:check  # verifica formattazione
npm run format:fix    # applica formattazione
npm run prettier      # alias per format:check
npm run prettier:fix  # alias per format:fix
```

---

### `vercel` (^56.0.0)

**Scopo:** CLI ufficiale Vercel per deploy e sviluppo locale.

**Utilizzo:**
```bash
npm start             # avvio server locale
vercel deploy         # deploy in produzione
vercel logs           # visualizzazione log produzione
```

**Configurazione:** `vercel.json` con region `fra1`, routing serverless.

---

## 🎯 Dipendenze Critiche (Priorità Alta)

| Dipendenza | Scopo | Criticità |
|------------|-------|-----------|
| `@upstash/redis` | Cache state e repo | 🔴 CRITICO - Performance spin |
| `@sentry/vercel-edge` | Error monitoring | 🟡 IMPORTANTE - Debug production |
| `jsonschema` | Validazione input | 🟡 IMPORTANTE - Security S1 |
| `eslint` | Quality guard | 🟢 STANDARD - Code quality |
| `vitest` | Testing | 🟢 STANDARD - Reliability |

---

## 🔄 Dipendenze Transitive

Il progetto utilizza `tar@7.5.20` (override forzato via `overrides` in `package.json`) per mitigare vulnerabilità di sicurezza nella versione precedente.

---

## 📊 Metriche Dipendenze

- **Total Dependencies:** 10
- **Production:** 5
- **Development:** 5
- **Security Issues:** 0 (tutte le dipendenze aggiornate)
- **Outdated:** 0 (tutte le versioni correnti)

---

## 🚀 Onboarding Nuovo Developer

1. **Installare Node.js 18+**
2. **Clonare repo:** `git clone https://github.com/simrim96/GithubSlotMachine`
3. **Installare dipendenze:** `npm install`
4. **Configurare env:** Copiare variabili da README.md e impostare `GITHUB_PAT`
5. **Avviare dev:** `npm start`
6. **Eseguire test:** `npm test` (dovrebbero passare tutti)
7. **Fare lint:** `npm run lint` (deve essere clean)

---

*Ultima modifica: 2026-07-21 - Implementazione M8: Documentazione delle dipendenze NPM*
