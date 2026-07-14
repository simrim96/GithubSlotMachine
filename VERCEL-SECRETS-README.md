# Variabili d'ambiente Vercel per CI/CD Pipeline

## Setup delle GitHub Secrets

Per la CI/CD pipeline funzionante, devi configurare le seguenti **GitHub Secrets** nel tuo repository:

### Secrets Obbligatori

| Secret Name | Descrizione | Come ottenerlo |
|-------------|-------------|----------------|
| `VERCEL_TOKEN` | Vercel API Token | 1. Vai su [vercel.com/account/tokens](https://vercel.com/account/tokens)<br>2. Clicca "Add Token"<br>3. Dai un nome (es: "GitHub CI/CD")<br>4. Copia il token generato |
| `VERCEL_ORG_ID` | Vercel Organization ID | 1. Vai su [vercel.com/account/organizations](https://vercel.com/account/organizations)<br>2. Clicca sulla tua organizzazione<br>3. Copia l'ID dalla URL o usa `vercel org ls`<br>4. Oppure: `vercel ls --token $VERCEL_TOKEN` e trova l'organization ID |
| `VERCEL_PROJECT_ID` | Vercel Project ID | 1. Vai su [vercel.com/projects](https://vercel.com/projects)<br>2. Clicca sul tuo progetto<br>3. Copia l'ID dalla URL<br>4. Oppure: `vercel ls --token $VERCEL_TOKEN` e trova il project ID |

### Secrets Opzionali (per funzionalità avanzate)

| Secret Name | Descrizione | Quando usarlo |
|-------------|-------------|---------------|
| `SNYK_TOKEN` | Snyk API Token | Per security scanning aggiuntivo su push a main |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL | Per migliorare le performance (cache stato) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis Token | Se usi Upstash Redis |

## Come configurare le GitHub Secrets

1. Vai sul tuo repository GitHub
2. Clicca su **Settings**
3. Nella sidebar sinistra, clicca su **Secrets and variables** → **Actions**
4. Clicca su **New repository secret**
5. Per ogni secret obbligatorio:
   - **Name**: inserisci il nome esatto del secret (es: `VERCEL_TOKEN`)
   - **Secret**: incolla il valore
   - Clicca **Add secret**

## Verifica della configurazione

Dopo aver configurato i secret, puoi verificare che siano impostati correttamente:

```bash
# Vai su Actions → CI/CD Pipeline
# Seleziona un run e controlla che non ci siano errori di secret mancanti
```

## Ambienti Vercel

La pipeline CI/CD supporta tre ambienti:

### 1. Production (branch `main`)
- Deploy automatico su ogni push a `main`
- URL: `https://your-app.vercel.app`
- Ambiente: Production

### 2. Staging (branch `staging`)
- Deploy automatico su push a `staging`
- URL: `https://your-app-staging.vercel.app`
- Ambiente: Staging

### 3. Preview (PRs)
- Deploy automatico su ogni PR a `main`
- URL: `https://your-app-[pr-number]-vercel.vercel.app`
- Ambiente: Preview

## Configurazione ambientale su Vercel Dashboard

Oltre ai secret GitHub, puoi configurare variabili d'ambiente direttamente su Vercel:

1. Vai su [vercel.com/projects](https://vercel.com/projects)
2. Clicca sul tuo progetto
3. Vai su **Settings** → **Environment Variables**
4. Aggiungi le variabili d'ambiente del progetto:
   - `GITHUB_PAT` (obbligatorio per il funzionamento dello slot)
   - `SLOT_OWNER` (opzionale, default: `simrim96`)
   - `SLOT_REPO` (opzionale, default: `GithubSlotMachine`)
   - `PROFILE_REPO` (opzionale, default: `simrim96/simrim96`)
   - `UPSTASH_REDIS_REST_URL` (opzionale)
   - `UPSTASH_REDIS_REST_TOKEN` (opzionale)

## Esempio di setup completo

```bash
# 1. Installa Vercel CLI
npm install --global vercel@latest

# 2. Login
vercel login

# 3. Collega il progetto
cd /home/simonerimenti/Progetti/GithubSlotMachine
vercel

# 4. Ottieni Organization ID
vercel org ls

# 5. Ottieni Project ID
vercel ls

# 6. Configura environment su Vercel Dashboard
#    vai su Settings → Environment Variables
```

## Risoluzione problemi comuni

### "No Vercel account found"
- Verifica che `VERCEL_TOKEN` sia correttamente impostato nei GitHub Secrets
- Il token deve avere permessi di lettura/scrittura sul progetto

### "Build failed"
- Esegui `npm install` localmente per verificare tutte le dipendenze
- Controlla i log di GitHub Actions per i dettagli specifici

### "Tests failed"
- Esegui `npm test` localmente per debug
- Verifica che tutte le dipendenze siano installate

## Sicurezza

- I secret GitHub **non sono mai** esposti nei log di GitHub Actions
- Usa token con permessi minimi necessari (solo read/write sul tuo repo)
- Non commit mai file `.env` con dati sensibili nel repository
- Il file `.env.example` è solo un template e non contiene dati reali

## Link utili

- [Vercel API Tokens](https://vercel.com/account/tokens)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
