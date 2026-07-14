# CI/CD Pipeline - GithubSlotMachine

## Struttura Pipeline

Questa repo utilizza GitHub Actions per automatizzare:

1. **Test automatici** su ogni PR e push a main
2. **Linting** con ESLint
3. **Security scanning** con Snyk (su produzione)
4. **Build verification** prima del deploy
5. **Vercel Preview Deployments** per ogni PR
6. **Auto-deploy** a produzione su push a main
7. **Staging environment** su branch `staging`

## Workflows

### `.github/workflows/ci.yml`

```
Job Flow:
├── test (Ubuntu, Node 18)
│   ├── Unit tests (vitest)
│   ├── Integration tests (Playwright)
│   └── E2E tests (Playwright)
│
├── quality (Ubuntu, Node 18)
│   ├── ESLint
│   ├── npm audit
│   └── Snyk security scan
│
├── build (needs: test, quality)
│   └── Build verification
│
├── preview (needs: test, quality, build) - solo PR
│   └── Vercel Preview Deployment
│
├── deploy-prod (needs: test, quality, build) - solo main push
│   └── Vercel Production Deployment
│
└── deploy-staging (needs: test, quality, build) - solo staging push
    └── Vercel Staging Deployment
```

## Setup Vercel

### Variabili d'ambiente necessarie su GitHub Secrets:

| Secret | Descrizione |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API Token (crealo su vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Vercel Organization ID |
| `VERCEL_PROJECT_ID` | Vercel Project ID |
| `SNYK_TOKEN` | Snyk API Token (opzionale, per security scan) |

### Come ottenere le credenziali Vercel:

1. **VERCEL_TOKEN**: Vai su `vercel.com/account/tokens`, crea un "Personal Access Token"
2. **VERCEL_ORG_ID**: Esegui `vercel org ls` o guarda su `vercel.com/account/organizations`
3. **VERCEL_PROJECT_ID**: Esegui `vercel projects` o guarda su `vercel.com/projects`

### Configurazione ambiente su Vercel:

Crea tre ambienti:
- **Production** (main branch)
- **Preview** (PRs)
- **Staging** (staging branch)

Vai su `vercel.com/project/your-project-id/settings/environment` e crea:
- Production environment con accessi alle variabili d'ambiente
- Preview environment
- Staging environment

## Variabili d'ambiente del progetto

Il progetto richiede:

- `GITHUB_PAT` (obbligatorio): GitHub Personal Access Token
- `UPSTASH_REDIS_REST_URL` (opzionale): Upstash Redis URL
- `UPSTASH_REDIS_REST_TOKEN` (opzionale): Upstash Redis Token

Le variabili d'ambiente devono essere configurate su:
1. **Vercel Dashboard** → Settings → Environment Variables
2. **GitHub Repository Settings** → Secrets and variables → Actions

## Script NPM disponibili

```bash
# Test
npm test              # Unit tests
npm run test:watch    # Test in modalità watch
npm run test:integration  # Integration tests
npm run test:e2e      # E2E tests

# Linting
npm run lint          # ESLint
npm run lint:fix      # ESLint auto-fix
npm run prettier      # Prettier check
npm run prettier:fix  # Prettier fix

# Build & Dev
npm run dev           # Vercel dev server
npm run build         # Vercel build
npm start             # Alias per dev
```

## Branch Strategy

| Branch | Deploy | Ambiente |
|--------|--------|----------|
| `main` | ✅ Auto | Production |
| `staging` | ✅ Auto | Staging |
| `feature/*`, `fix/*`, etc. | ⏳ Preview | Vercel Preview |

## Debug

Se la pipeline fallisce:

1. Controlla i log del job specifico su GitHub Actions
2. Verifica le variabili d'ambiente di Vercel
3. Esegui localmente: `npm run lint && npm test`
4. Testa il build: `npm run build`

## Troubleshooting

**Errore: "No Vercel account found"**
- Assicurati che `VERCEL_TOKEN` sia correttamente impostata nei GitHub Secrets

**Errore: "Tests failed"**
- Esegui `npm test` localmente per debug
- Controlla i log dettagliati del test

**Errore: "Build failed"**
- Esegui `npm run build` localmente per debug

## Security

- **Snyk scan** viene eseguito solo su push a main
- **Dependabot** è configurato per aggiornamenti automatici
- I segreti non sono mai esposti nei log
