import { checkWins, WILD_ID } from './api/spin.js';

// Il test originale di game.test.js (righe 107-116)
// WILD come primo simbolo, poi python, WILD, python, c
// SULLA PAYLINE CENTRALE (row=1)
const g1 = [
  ['wild', 'c', 'c'],  // grid[0][1] = wild
  ['python', 'c', 'c'], // grid[1][1] = python
  ['wild', 'c', 'c'],  // grid[2][1] = wild
  ['python', 'c', 'c'], // grid[3][1] = python
  ['c', 'c', 'c'],     // grid[4][1] = c
];

console.log('Payline centrale (row=1):');
for (let c = 0; c < 5; c++) {
  console.log(`  grid[${c}][1] = ${g1[c][1]}`);
}

const wins = checkWins(g1);
console.log('\nRisultato checkWins:');
for (const w of wins) {
  console.log(`  payline ${w.payline}: symbol=${w.symbol}, count=${w.count}`);
}

const hasPythonWin = wins.some(w => w.symbol === 'python' && w.count >= 3);
console.log(`\nTest: python win con count >= 3? ${hasPythonWin ? 'PASS' : 'FAIL'}`);

// Verifica manuale della logica
console.log('\n--- Analisi manuale della payline centrale ---');
const payline = [1, 1, 1, 1, 1]; // center payline
let anchor = null;
for (let c = 0; c < 5; c++) {
  const s = g1[c][payline[c]];
  console.log(`c=${c}: symbol=${s}`);
  if (s !== WILD_ID && s !== 'scat') {
    anchor = s;
    console.log(`  -> anchor trovato: ${anchor}`);
    break;
  }
}
if (!anchor && g1[0][payline[0]] === WILD_ID) {
  anchor = WILD_ID;
  console.log(`  -> anchor impostato a WILD`);
}
console.log(`Anchor finale: ${anchor}`);

let count = 0;
for (let c = 0; c < 5; c++) {
  const s = g1[c][payline[c]];
  console.log(`c=${c}: s=${s}, anchor=${anchor}`);
  if (anchor === WILD_ID && s === WILD_ID) {
    count++;
    console.log(`  -> count++ (wild matches wild)`);
  } else if (s === anchor) {
    count++;
    console.log(`  -> count++ (exact match)`);
  } else if (s === WILD_ID && anchor !== 'scat' && anchor !== null) {
    count++;
    console.log(`  -> count++ (wild matches anchor)`);
  } else {
    console.log(`  -> BREAK`);
    break;
  }
}
console.log(`Count finale: ${count}`);
