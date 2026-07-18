# Test della game logic

La suite copre le funzioni **pure** di `api/spin.js` (niente rete, niente
GitHub, niente Redis): `generateGrid`, `checkWins`, `engineerWin`,
`engineerNearMiss`, `detectNearMiss`, `countScatters`, `winningLangId`, `wrap`.

I test vivono in `tests/game.test.js` e usano [Vitest](https://vitest.dev).

## Perché esiste

Il generatore della slot era un monolite senza test. La logica di gioco è la
parte più facile da rompere e la più difficile da verificare a occhio (near-miss,
wild/scatter, payline a V/Λ). Questa suite è un "contratto" che permette di
toccare `spin.js` senza introdurre regressioni invisibili.

## Come si eseguono

```bash
# dalla root del repo
npm install        # serve solo la prima volta (installa vitest)
npm test           # esecuzione singola (CI-friendly)
npm run test:watch # modalità watch, ricarica ad ogni modifica
```

Output atteso:

```
 RUN  v3.2.7
 ✓ tests/game.test.js (20 tests)
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

## Cosa proteggono i test (e i bug che hanno già trovato)

- **`engineerWin`** non deve MAI produrre un 5-in-a-row (jackpot involontario).
  Il test ha rilevato che la versione precedente allineava fino a 4 simboli e,
  con la griglia di partenza, chiudeva un jackpot. Ora forza 3 simboli e rompe
  esplicitamente le colonne 3-4.
- **`engineerNearMiss` / `detectNearMiss`** devono restare in sync: il near-miss
  generato deve essere riconosciuto da `detectNearMiss` (altrimenti non viene
  mai evidenziato). Il test verifica che ogni board prodotta sia O una win O un
  near-miss riconoscibile — mai "morta". Ha rilevato che la vecchia logica
  allineava 3-4 simboli che `checkWins` leggeva come vittoria vera, annullando
  il near-miss.
- **`checkWins`** su tutte le geometrie di payline (top/bottom/center/V/Λ),
  wildcard `WILD`, esclusione `SCATTER`, e jackpot 5-in-a-row.
- **`countScatters`** e **`winningLangId`** (preferenza simbolo reale vs wild).
- **`wrap`** per il text-wrap dell'SVG.

## Aggiungere un test

Apri `tests/game.test.js`, aggiungi un `it('descrizione', () => { ... })` dentro
il `describe` pertinente. Le funzioni sono importate in cima al file:

```js
import {
  generateGrid,
  checkWins,
  engineerWin,
  engineerNearMiss,
  detectNearMiss,
  countScatters,
  winningLangId,
  wrap,
  WILD_ID,
  SCATTER_ID,
  COLS,
  ROWS,
  PAYLINES,
} from '../api/spin.js';
```
