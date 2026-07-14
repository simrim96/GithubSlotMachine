# Task T2: CI/CD Pipeline - GitHub Actions + Vercel

## Stato
- Task ID: `t_c4954885`
- Assignee: `default`
- Stato: `blocked` (attende completamento T1)
- Dipendenza: `parents: [t_7f2937fd]`

## Problema
Il progetto non ha una CI/CD pipeline automatizzata. Solo `npm test` manuale prima di deploy.

## File Correlati
- Nessuna directory `.github/workflows/`
- Nessuna directory `vercel.json` config avanzata
- Nessun `package.json` script per deployment

## Impatto
- **ALTA** - Errori possono essere deployati in produzione senza essere rilevati
- **MEDIA** - Nessun deployment automatico su push a main
- **BASSA** - Nessuna preview deployment per PR

## Soluzione Proposta

### 1. GitHub Actions Workflow
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Run linting
        run: npm run lint
      
      - name: Security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      
      - name: Build
        run: npm run build

  preview:
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Vercel Preview
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

### 2. Vercel Preview Deployments per ogni PR
- Configurare automaticamente su ogni PR
- Link diretto alla preview per review

### 3. Staging Environment
- Deployment automatico su branch di staging
- Testing prima di production

## Acceptance Criteria
- [ ] `.github/workflows/ci.yml` creato e funzionante
- [ ] Tests automatici su push/PR
- [ ] Linting automatico (ESLint, Prettier)
- [ ] Security scanning (Dependabot, Snyk)
- [ ] Build verification
- [ ] Vercel Preview Deployments per ogni PR
- [ ] Staging environment configurato

## Note
Questo task deve essere completato PRIMA di T3 (Security) per garantire che qualsiasi fix venga testato automaticamente.
