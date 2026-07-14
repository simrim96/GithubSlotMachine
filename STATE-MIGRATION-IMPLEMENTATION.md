# State Migration System Implementation

## Overview

Implementazione di un sistema di versioning e migrazione per lo stato della slot machine. Il sistema garantisce che i dati dello stato possano essere migrati in modo sicuro quando la struttura cambia.

## Versioning

- **STATE_VERSION**: `2` (attuale)
- I dati dello stato contengono sempre un campo `version` che indica la versione dello schema

## Schema Changes

### Version 1 → Version 2

**Nuovi campi aggiunti:**

```javascript
{
  // ... campi esistenti ...
  version: 2,
  settings: {
    theme: 'auto',  // 'auto' | 'light' | 'dark'
    sound: true,
  },
  stats: {
    longestStreak: 0,
    currentStreak: 0,
    winsByLang: {}, // { python: 10, rust: 5, ... }
  },
}
```

**Campi preservati:**
- `totalSpins`
- `totalWins`
- `lastWin` (se presente)

## Migration Logic

La migrazione viene eseguita automaticamente in `readState()`:

1. **Se `state.version < STATE_VERSION`**: esegue la migrazione
2. **Dopo la migrazione**: salva lo stato migrato nel storage (Redis/GitHub)
3. **Se `state.version >= STATE_VERSION`**: restituisce lo stato così com'è

### Code Flow

```javascript
export async function readState(token, owner, repo) {
  // ... leggere stato da storage ...
  
  const currentVersion = state.version || 1;
  if (currentVersion < STATE_VERSION) {
    const migrated = migrateState(state, currentVersion);
    await kvSet(STATE_KEY, migrated); // Salva stato migrato
    return { state: migrated, sha: null };
  }
  
  return { state: { ...DEFAULTS, ...state }, sha: null };
}
```

## Migration Function

```javascript
function migrateState(state, fromVersion) {
  if (fromVersion === 1) {
    return {
      ...state,
      version: 2,
      settings: { theme: 'auto', sound: true },
      stats: {
        longestStreak: 0,
        currentStreak: 0,
        winsByLang: {},
      },
    };
  }
  return { ...state, version: STATE_VERSION };
}
```

## Testing

Test file: `tests/state-migration.test.js`

Test coperti:
- ✅ Migrazione da v1 a v2 preserva dati esistenti
- ✅ Nuovi campi sono inizializzati con valori default
- ✅ Stati già v2 non vengono migrati ripetutamente
- ✅ `STATE_VERSION` è correttamente definito come 2
- ✅ `DEFAULTS` usa `STATE_VERSION`

## Backward Compatibility

Il sistema è completamente backward compatible:
- Stati v1 vengono migrati automaticamente al primo `readState()`
- Stati v2+ sono leggibili senza modifiche
- Nuovi campi hanno valori default sicuri

## Future Migrations

Per migrare da v2 a v3 in futuro:

1. Aggiornare `STATE_VERSION = 3`
2. Aggiungere casi nella funzione `migrateState()`:
```javascript
if (fromVersion === 2) {
  // Migrazione v2 → v3
  return { ...state, /* nuovi campi */ };
}
```

## Files Modified

- `api/_lib/state.js`: Aggiunto sistema di migrazione
- `tests/state-migration.test.js`: Nuovo file di test

## Test Results

```
✓ tests/state-migration.test.js (5 tests)
✓ tests/state-local.test.js (5 tests)
```

Tutti i test di migrazione superati con successo.
