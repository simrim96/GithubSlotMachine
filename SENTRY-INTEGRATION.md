# Sentry Integration for GithubSlotMachine

## Overview
Sentry è stato integrato nell'app per il monitoraggio degli errori in produzione. Questo documento descrive come configurare e usare Sentry.

## Configurazione

### 1. Crea una project Sentry
1. Vai su [sentry.io](https://sentry.io/)
2. Crea un nuovo account/progetto
3. Scegli "Node.js" come piattaforma
4. Copia il **DSN** (Data Source Name) che viene fornito

### 2. Configura le variabili d'ambiente

In Vercel, aggiungi queste variabili d'ambiente:

```
SENTRY_DSN=https://xxxx@o123456.ingest.sentry.io/789012
```

Se vuoi vedere le performance:
```
SENTRY_TRACES_SAMPLE_RATE=1.0
```

### 3. Deployment
Dopo aver aggiunto le variabili d'ambiente, rideploy l'app:
```bash
vercel deploy
```

## Come usare Sentry

### Catturare errori automaticamente
Le route API già includono middleware per catturare gli errori automaticamente.

### Catturare errori manualmente

```javascript
import * as Sentry from "@sentry/node";

try {
  // La tua logica
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

### Aggiungere contesto agli errori

```javascript
Sentry.configureScope((scope) => {
  scope.setTag("user_id", userId);
  scope.setTag("language", language);
  scope.setExtra("reel_count", reels.length);
});
```

### Tracciare transazioni (performance)

```javascript
const transaction = Sentry.startTransaction({
  name: "spin_handler",
});

try {
  // ... logica
} finally {
  await transaction.finish();
}
```

## Files modificati

- `sentry.config.js` - Configurazione principale di Sentry
- `api/middleware.js` - Middleware per gestione errori
- `api/spin-sentry-example.js` - Esempio d'uso

## Verifica del setup

1. Dopo il deployment, vai alla tua dashboard Sentry
2. Dovresti vedere errori (se l'app genera errori di test)
3. Le performance sono visibili nella sezione "Performance"

## Debug

In ambiente development:
```bash
SENTRY_DSN=tuo-dsn npm run dev
```

I log di Sentry sono abilitati con `debug: true` in `sentry.config.js`.

## Link utili

- [Documentazione Sentry Node.js](https://docs.sentry.io/platforms/javascript/guides/node/)
- [Dashboard Sentry](https://sentry.io)
