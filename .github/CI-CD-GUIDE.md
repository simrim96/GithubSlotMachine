# CI/CD - GitHub Slot Machine

> **Nota (ISSUE-27, 19/07/2026):** questa guida è stata riscritta per descrivere
> la pipeline **reale**. La versione precedente documentava 5 job (test, security,
> preview, production, dependabot) con ESLint, Prettier, build, Snyk, Gitleaks e
> deploy Vercel automatico che **NON esistono**. Chi leggeva la vecchia guida
> credeva ci fosse un controllo di sicurezza/deploy automatico che invece non c'è.
> Di seguito solo ciò che viene effettivamente eseguito.

## Pipeline attuale

L'unico workflow è `.github/workflows/ci.yml`. Definisce **un solo job** `test`,
eseguito su una matrix di Node `18 / 20 / 22`.

Trigger: push e pull_request su `main` / `master`.

Step del job `test`:
1. **Checkout** (`actions/checkout@v4`)
2. **Setup Node** (`actions/setup-node@v4`, cache npm)
3. **Install dependencies** → `npm ci`
4. **Import smoke test** → `node -e "import('./api/_lib/svg-builder.js')…"`
   Fallisce la CI al primo import non risolvibile, prima dei test funzionali.
5. **Run tests** → `npm test` (Vitest)
6. **Lint gate** (ISSUE-26) → `npm run lint` (ESLint). Gli errori bloccano il
   merge; i warning restano visibili ma non bloccano.

### Cosa NON c'è (e perché)
- **Nessun deploy automatico.** Il deploy su Vercel è gestito dalla **Vercel Git
  Integration** (push su `main`/`master` → build Vercel automatica) oppure in
  manuale con `vercel deploy`. Non c'è alcun step di deploy nel workflow.
- **Nessuno security scan.** Non esiste un job `security`: né `npm audit` in CI,
  né Snyk, né Gitleaks. `npm audit` è disponibile solo come script locale
  (`npm run security`), non gira in CI.
- **Nessun job dependabot / auto-merge.** Non esiste automazione sulle PR di
  dipendenze.
- **Nessun `prettier --check` in CI.** Prettier esiste come script locale
  (`npm run format:check`) ma non è un gate della pipeline.
- **Nessun `build` in CI.** Le serverless functions non richiedono build
  (`build` script è un echo no-op).

## Script NPM disponibili (locali)

```bash
npm test            # Esegue la suite Vitest
npm run lint        # ESLint (gate attivo in CI)
npm run lint:fix    # ESLint --fix
npm run format:check# Prettier --check (locale, NON in CI)
npm run format:fix  # Prettier --write (locale)
npm run security    # npm audit --audit-level=moderate (locale, NON in CI)
npm run preview     # Server di preview locale (node scripts/preview-server.mjs)
npm run dev         # vercel dev
```

## Verificare la CI localmente

```bash
# 1. Import smoke test (come in CI)
node -e "import('./api/_lib/svg-builder.js').then(() => console.log('import smoke OK')).catch((e) => { console.error(e); process.exit(1); })"

# 2. Test suite
npm test

# 3. Lint (gate CI)
npm run lint

# 4. (Opzionale, locale) Security audit e format check
npm run security
npm run format:check
```

Per simulare l'intero workflow con `act`:
```bash
act push -j test
```

## Deploy (manuale / Vercel Git)

- **Vercel Git Integration:** collegando il repo a Vercel, ogni push su
  `main`/`master` triggera automaticamente una build Vercel. Nessuna
  configurazione nel workflow.
- **Manuale:** `vercel deploy` (preview) o `vercel deploy --prod` (production),
  richiede `vercel login` e il progetto Vercel già creato.

## Note per chi contribuisce

- Il merge è bloccato solo da: test falliti, import smoke rotto, errori ESLint.
- Non affidarti a questa CI per la sicurezza: esegui tu `npm run security` e
  `npm run format:check` prima di aprire una PR se vuoi stare sicuro.
- Se in futuro si vuole implementare la pipeline completa (security scan +
  deploy automatico + dependabot), va aggiunto un nuovo workflow: la presente
  guida documenta solo lo stato attuale.
