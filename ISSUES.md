# GithubSlotMachine - Documentazione dei Problemi

**Data analisi:** 2026-07-17  
**Stato:** Problemi critici da risolvere

---

## 🔴 PROBLEMI CRITICI (Priorità ALTA)

---

## 1. Paytable Non Visibile nell'UI

**Data rilevamento:** 2026-07-17  
**Stato:** **CONFERMATO** - Clip-path mancante

### Descrizione tecnica

La paytable non è visibile per l'utente perché:

1. **Clip-path #paytable NON è definito** in `api/_lib/svg/defs.js`
2. L'SVG usa `clip-path="url(#paytable)"` ma il clip-path non esiste
3. Senza clip-path definito, il contenitore è completamente invisibile

### Root Cause Analysis

**File:** `api/_lib/svg-builder.js:82-87`
```xml
<!-- PROBLEMA: Clip-path #paytable NON definito da nessuna parte -->
<g clip-path="url(#paytable)">
  <rect x="120" y="${124}" width="360" height="${112}" rx="12" fill="#13122d" stroke="#4ecdc4" stroke-width="1.5"/>
  <text x="300" y="${152}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#4ecdc4">PAYTABLE</text>
  ${paytableSvg}
</g>
```

**File:** `api/_lib/svg/defs.js` - **NON CONTIENE** `<clipPath id="paytable">`!

### Impatto: CRITICO
- ❌ Utenti non vedono MAI la paytable
- ❌ Mancano informazioni fondamentali sulle combinazioni vincenti
- ❌ Riduce drasticamente l'engagement
- ❌ La slot machine sembra "rotta"

### Fix Richiesto

**File:** `api/_lib/svg/defs.js`

Aggiungere dopo la riga 85 (dopo i clip-path per colonne):

```javascript
// Clip-path per paytable - DEFINIZIONE OBBLIGATORIA
// Coordinate basate su paytable.js: x=120, y=124, width=360, height=112, rx=12
defs += `<clipPath id="paytable"><rect x="120" y="124" width="360" height="112" rx="12"/></clipPath>`;
```

---

## 2. Rulli Non Ruotano Correttamente - Disallineamento Durate Animazioni

**Data rilevamento:** 2026-07-17  
**Stato:** **CONFERMATO** - DUR ridifinito con valori sbagliati

### Descrizione tecnica

Le durate delle animazioni sono definite in **DUE POSTI DIVERSI** con valori **DIVERSI**:

- **`api/_lib/svg/constants.js:18`** (SINGLE SOURCE OF TRUTH): `DUR = [3.0, 3.8, 4.6, 5.4, 6.2]`
- **`api/_lib/svg/analysis.js:23`** (SBAGLIATO): `const DUR = [1.8, 2.0, 2.2, 2.4, 2.6]`

### Root Cause Analysis

**File:** `api/_lib/svg/constants.js:18`
```javascript
// VALORI CORRETTI - DURATE LENTE E FLUIDE
export const DUR = [3.0, 3.8, 4.6, 5.4, 6.2];
```

**File:** `api/_lib/svg/analysis.js:22-27`
```javascript
// PROBLEMA: RIDIFINIZIONE DI DUR CON VALORI SBAGLIATI
const COLS = 5;
const DUR = [1.8, 2.0, 2.2, 2.4, 2.6];  // ❌ TROPPO VELOCI
const NM_DUR_EXTRA_LAST = 0.5;          // ❌ SBAGLIATO (dovrebbe essere 1.2)

const LDUR = DUR[COLS - 1];             // Usa 2.6 invece di 6.2!
const ED = LDUR + (nearMissCol === COLS - 1 ? NM_DUR_EXTRA_LAST : 0) + 0.4;
```

**File:** `api/_lib/svg/constants.js:17-18`
```javascript
// VALORI CORRETTI DA USARE
export const NM_DUR_EXTRA_LAST = 1.2;
export const DUR = [3.0, 3.8, 4.6, 5.4, 6.2];
```

### Impatto: CRITICO
- ❌ Animazioni **40% più veloci** del previsto (es. 2.6s invece di 6.2s)
- ❌ Rulli sembrano "scattare" invece di scorrere fluidamente
- ❌ Utenti potrebbero non vedere i simboli correttamente
- ❌ Effetto "near-miss" compromesso
- ❌ Esperienza di gioco rotta

### Fix Richiesto

**File:** `api/_lib/svg/analysis.js`

1. **Aggiungere import** all'inizio del file (dopo `import { checkWins, detectNearMiss } from '../game.js';`)

```javascript
import { checkWins, detectNearMiss } from '../game.js';
import { DUR, NM_DUR_EXTRA_LAST } from './constants.js';  // ✅ IMPORTARE DA CONSTANTS
```

2. **Rimuovere la ridifinizione** di DUR e NM_DUR_EXTRA_LAST (righe 22-24)

```javascript
// Rimuovere completamente queste righe:
// const COLS = 5;
// const DUR = [1.8, 2.0, 2.2, 2.4, 2.6];
// const NM_DUR_EXTRA_LAST = 0.5;

// Usare COLS come hardcoded (5), DUR e NM_DUR_EXTRA_LAST importati da constants.js
const LDUR = DUR[COLS - 1];  // Ora userà 6.2 invece di 2.6!
const ED = LDUR + (nearMissCol === COLS - 1 ? NM_DUR_EXTRA_LAST : 0) + 0.4;
```

---

## 📋 CHECKLIST DI VALIDAZIONE

- [ ] **FIX 1:** Aggiungere `<clipPath id="paytable">` in `api/_lib/svg/defs.js`
- [ ] **FIX 2:** Importare `DUR` e `NM_DUR_EXTRA_LAST` da `constants.js` in `analysis.js`
- [ ] **FIX 3:** Rimuovere `const DUR = [1.8, 2.0, 2.2, 2.4, 2.6]` in `analysis.js`
- [ ] Verificare che `npm test` passi al 100%
- [ ] Testare visivamente che i rulli ruotino correttamente (durate fluide)
- [ ] Testare visualmente che la paytable sia visibile dopo una vincita
- [ ] `npm run lint` senza errori
- [ ] Build su Vercel senza errori
- [ ] Deploy e verifica in produzione

---

## 📝 NOTE TECNICHE AGGIUNTIVE

### Dipendenze Critiche

Le funzioni coinvolte:
- `api/_lib/svg/defs.js` → `generateDefs()` → `buildSVG()` → `api/_lib/svg-builder.js`
- `api/_lib/svg/analysis.js` → `analyzeResult()` → `generateCSS()` e `generateReels()`
- `api/_lib/svg/constants.js` → **SINGLE SOURCE OF TRUTH** per DUR, NM_DUR_EXTRA_LAST

### Pattern da Evitare

1. ❌ **NON** ridefinire costanti globali in file secondari
2. ❌ **NON** usare valori hardcoded quando esistono costanti centralizzate
3. ✅ **SÌ** importare costanti da `constants.js`
4. ✅ **SÌ** mantenere single source of truth

---

*Data aggiornamento: 2026-07-17*
