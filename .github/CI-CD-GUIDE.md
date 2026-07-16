# CI/CD Pipeline - GitHub Actions

Questa directory contiene le configurazioni per la CI/CD pipeline del progetto.

## Workflow Overview

Il file `.github/workflows/ci.yml` definisce una pipeline completa con 5 job:

### Job 1: `test` - Test, Linting & Build
- **Trigger**: Push su `main`/`master`, PR su `main`/`master`
- **Funzionalità**:
  - Checkout del repository
  - Setup Node.js 20
  - Installazione dipendenze (`npm ci`)
  - Linting con ESLint
  - Verifica formatting con Prettier
  - Esecuzione test suite (Vitest)
  - Build del progetto
  - Upload dei test results come artifact

### Job 2: `security` - Security Scan
- **Trigger**: Push su `main`/`master`, Schedule (ogni giorno alle 2 AM UTC)
- **Funzionalità**:
  - `npm audit` per dipendenze vulnerabili
  - Snyk security scan (richiede `SNYK_TOKEN`)
  - Secret scanning con Gitleaks
  - Upload report Gitleaks come artifact

### Job 3: `preview` - Preview Deployment
- **Trigger**: Pull Request su `main`/`master`
- **Dipendenze**: Job `test` deve passare
- **Funzionalità**:
  - Deploy automatico su Vercel Preview
  - Commento con URL preview sul PR
  - **Secreti richiesti**: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

### Job 4: `production` - Production Deployment
- **Trigger**: Push su `main` o `master`
- **Dipendenze**: Job `test` e `security` devono passare
- **Funzionalità**:
  - Deploy automatico su Vercel Production
  - Creazione commit status con URL
  - Ambiente Vercel configurato
  - **Secreti richiesti**: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

### Job 5: `dependabot` - Auto-Approval & Auto-Merge
- **Trigger**: PR creato da `dependabot[bot]`
- **Funzionalità**:
  - Auto-approval delle PR di dipendenze
  - Aggiunta labels (`dependencies`, `automated`)
  - Auto-merge per aggiornamenti minor/patch solo

## Configurazione Necessaria

### Secreti GitHub Repository

Aggiungere questi secreti in **Settings > Secrets and variables > Actions**:

| Secret Name | Description |
|-------------|-------------|
| `VERCEL_TOKEN` | Token Vercel per deployment |
| `VERCEL_ORG_ID` | Vercel Organization ID |
| `VERCEL_PROJECT_ID` | Vercel Project ID |
| `SNYK_TOKEN` | Token Snyk per security scan (opzionale) |

### Setup Vercel

1. Installare Vercel CLI: `npm install -g vercel`
2. Login: `vercel login`
3. Creare progetto: `vercel`
4. Ottenere IDs:
   - `vercel ls` per vedere i progetti
   - Trovare `orgId` e `projectId`

### Script NPM

Il progetto include questi script per la CI:

```bash
npm test        # Esegui test suite
npm run lint    # Esegui ESLint
npm run prettier # Verifica formatting
npm run format:check # Alias per prettier
npm run format:fix # Formatta automaticamente
npm run security # Security audit
```

## Testing la Pipeline Localmente

### Testare il Workflow YAML

```bash
# Verificare sintassi YAML
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

### Testare Script Localmente

```bash
# Test completo locale
npm test
npm run lint
npm run prettier
```

### Simulare GitHub Actions Localmente

```bash
# Installare act (GitHub Actions local runner)
brew install act  # macOS
# oppure
docker run --rm -v $PWD:/workdir -e GITHUB_TOKEN=xxx acts/act

# Eseguire workflow localmente
act push -j test
```

## Debugging

### Vedere i Log dei Workflow

1. Aprire repository GitHub
2. Andare su **Actions** tab
3. Selezionare il workflow run
4. Espandere ogni step per vedere i log dettagliati

### Troubleshooting Comuni

#### Workflow non viene triggerato
- Controllare che il branch sia `main` o `master`
- Verificare i pattern `on:` nel YAML
- Controllare che i secreti siano configurati

#### Deploy fallisce
- Verificare `VERCEL_TOKEN` nei secreti
- Controllare che `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` siano corretti
- Eseguire manualmente `vercel pull` localmente

#### Test falliscono in CI ma passano localmente
- Verificare che le versioni Node siano le stesse (20)
- Controllare che tutte le dipendenze siano installate (`npm ci` vs `npm install`)
- Verificare variabili d'ambiente

## Best Practices

1. **Keep it Fast**: Usare caching per dipendenze (già configurato)
2. **Cancel In-Progress**: Workflow duplicate vengono cancellate automaticamente
3. **Fail Fast**: Security scan fallisce se trova vulnerabilità critiche
4. **Artifacts**: Test results mantenuti per 7 giorni
5. **Concurrency**: Evitare deploy multipli simultanei sullo stesso branch

## Modificare la Pipeline

### Aggiungere un nuovo Job

```yaml
jobs:
  # ... jobs esistenti ...
  
  my-new-job:
    name: My New Job
    runs-on: ubuntu-latest
    needs: [test, security]  # Dipendenze
    steps:
      - name: Do something
        run: echo "Hello World"
```

### Modificare i Trigger

```yaml
on:
  push:
    branches:
      - main
      - master
      - develop  # Aggiungere branch
  pull_request:
    branches:
      - main
      - master
  # Trigger manuale
  workflow_dispatch:
```

### Aggiungere un nuovo Stage al Workflow

Usare `needs` per creare dipendenze tra job:

```yaml
deploy-staging:
  needs: [test, security]
  if: github.ref == 'refs/heads/develop'
  # ...
```

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel GitHub Integration](https://vercel.com/docs/deploy/github-actions)
- [Snyk GitHub Action](https://github.com/marketplace/actions/snyk)
- [Gitleaks](https://gitleaks.io/)
