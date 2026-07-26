# Test della game logic

La suite copre le funzioni **pure** di `api/spin.js` (niente rete, niente
GitHub, niente Redis): `generateGrid`, `checkWins`, `engineerWin`,
`countScatters`, `winningLangId`, `wrap`.

> **Nota:** `engineerNearMiss` e `detectNearMiss` sono stati **rimossi**
> (il near-miss è stato disattivato: i rulli girano normalmente). `engineerWin`
> ora NON produce MAI un 5-in-a-row (il concetto di "jackpot" è stato rimosso:
> ogni vincita è "normale").

I test vivono in `tests/game.test.js` e usano [Vitest](https://vitest.dev).

## Perché esiste

Il generatore della slot era un monolite senza test. La logica di gioco è la
parte più facile da rompere e la più difficile da verificare a occhio (wild/scatter,
payline a V/Λ). Questa suite è un "contratto" che permette di
toccare `spin.js` senza introdurre regressioni invisibili.

## Come si eseguono

```bash
# dalla root del repo
npm install        # serve solo la prima volta (installa vitest)
npm test           # esecuzione singola (CI-friendly)
npm run test:watch # modalità watch, ricarica ad ogni modifica
```

## Cosa proteggono i test (e i bug che hanno già trovato)

- **`engineerWin`** non deve MAI produrre un 5-in-a-row (era l'equivalente di
  un "jackpot involontario", ora rimosso). Il test verifica che ogni vincita
  forzata sia di 3 o 4 simboli consecutivi.
- **`checkWins`** su tutte le geometrie di payline (top/bottom/center/V/Λ),
  wildcard `WILD`, esclusione `SCATTER`.
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
