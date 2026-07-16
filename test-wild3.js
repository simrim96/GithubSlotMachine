import { checkWins, WILD_ID } from './api/spin.js';

// Griglia corretta: grid[col][row]
// Payline centrale: grid[0][1], grid[1][1], grid[2][1], grid[3][1], grid[4][1]

// Test 1: WILD come primo sulla payline centrale, ma ci sono simboli reali
// Payline centrale: wild, python, wild, python, c
const g1 = [
  ['x', 'wild', 'x'],   // grid[0]: row 1 = wild
  ['x', 'python', 'x'], // grid[1]: row 1 = python
  ['x', 'wild', 'x'],   // grid[2]: row 1 = wild
  ['x', 'python', 'x'], // grid[3]: row 1 = python
  ['x', 'c', 'x'],      // grid[4]: row 1 = c
];

console.log('Test 1 - Payline centrale: wild, python, wild, python, c');
for (let c = 0; c < 5; c++) {
  console.log(`  grid[${c}][1] = ${g1[c][1]}`);
}

const wins1 = checkWins(g1);
console.log('\nRisultato:');
for (const w of wins1) {
  if (w.payline === 0) { // center payline
    console.log(`  Payline centrale: symbol=${w.symbol}, count=${w.count}`);
  }
}

const hasPythonWin = wins1.some(w => w.payline === 0 && w.symbol === 'python' && w.count >= 3);
console.log(`\nTest: python win sulla payline centrale con count >= 3? ${hasPythonWin ? 'PASS ✓' : 'FAIL ✗'}`);

// Test 2: WILD come unico simbolo sulla payline centrale (tutti wild)
const g2 = [
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
];

console.log('\n\nTest 2 - Payline centrale: wild, wild, wild, wild, wild');
const wins2 = checkWins(g2);
console.log('Risultato:');
for (const w of wins2) {
  if (w.payline === 0) {
    console.log(`  Payline centrale: symbol=${w.symbol}, count=${w.count}`);
  }
}

const hasWildWin = wins2.some(w => w.payline === 0 && w.symbol === 'wild' && w.count === 5);
console.log(`\nTest: wild win sulla payline centrale con count=5? ${hasWildWin ? 'PASS ✓' : 'FAIL ✗'}`);

// Test 3: WILD che completa una sequenza di python
// Payline centrale: python, python, wild, python, c
const g3 = [
  ['x', 'python', 'x'],
  ['x', 'python', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];

console.log('\n\nTest 3 - Payline centrale: python, python, wild, python, c');
const wins3 = checkWins(g3);
console.log('Risultato:');
for (const w of wins3) {
  if (w.payline === 0) {
    console.log(`  Payline centrale: symbol=${w.symbol}, count=${w.count}`);
  }
}

const hasPythonWin3 = wins3.some(w => w.payline === 0 && w.symbol === 'python' && w.count === 4);
console.log(`\nTest: python win sulla payline centrale con count=4? ${hasPythonWin3 ? 'PASS ✓' : 'FAIL ✗'}`);
