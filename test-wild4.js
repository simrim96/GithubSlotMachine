import { checkWins, WILD_ID, SCATTER_ID } from './api/spin.js';

// Test: WILD come primo simbolo, ma non c'è nessun altro simbolo non-WILD/scatter
// Questo è il caso critico: l'anchor diventa WILD_ID
const g1 = [
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'c', 'x'], // c è un simbolo reale, ma non è sulla payline centrale
];

console.log('Test 1 - Payline centrale: wild, wild, wild, wild, c');
const wins1 = checkWins(g1);
console.log('Risultato payline centrale:');
for (const w of wins1) {
  if (w.payline === 0) {
    console.log(`  symbol=${w.symbol}, count=${w.count}`);
  }
}
// L'anchor dovrebbe essere 'wild' e count dovrebbe essere 4 (non 5 perché c non è wild)
const correct1 = wins1.some(w => w.payline === 0 && w.symbol === 'wild' && w.count === 4);
console.log(`Expected: wild win con count=4, Result: ${correct1 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test: WILD + SCATTER sulla payline
const g2 = [
  ['x', 'wild', 'x'],
  ['x', 'scatter', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];

console.log('\n\nTest 2 - Payline centrale: wild, scatter, wild, python, c');
const wins2 = checkWins(g2);
console.log('Risultato payline centrale:');
for (const w of wins2) {
  if (w.payline === 0) {
    console.log(`  symbol=${w.symbol}, count=${w.count}`);
  }
}
// Anchor dovrebbe essere python (primo non-wild/non-scat dopo wild e scatter)
// Ma wild dovrebbe matchare python solo se viene dopo python, non prima
console.log('Expected: nessuna win (scatter interrompe la sequenza)');
const correct2 = !wins2.some(w => w.payline === 0 && w.symbol === 'python');
console.log(`Result: ${correct2 ? 'PASS ✓' : 'FAIL ✗'}`);

// Test: WILD che matcha con anchor trovato dopo SCATTER
const g3 = [
  ['x', 'scatter', 'x'],
  ['x', 'python', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];

console.log('\n\nTest 3 - Payline centrale: scatter, python, wild, python, c');
const wins3 = checkWins(g3);
console.log('Risultato payline centrale:');
for (const w of wins3) {
  if (w.payline === 0) {
    console.log(`  symbol=${w.symbol}, count=${w.count}`);
  }
}
// Anchor dovrebbe essere python (il primo non-wild/non-scat)
// Wild dovrebbe matchare python
console.log('Expected: python win con count=3 (python, wild, python)');
const correct3 = wins3.some(w => w.payline === 0 && w.symbol === 'python' && w.count === 3);
console.log(`Result: ${correct3 ? 'PASS ✓' : 'FAIL ✗'}`);
