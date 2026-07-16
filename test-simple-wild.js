import { checkWins, WILD_ID, SCATTER_ID } from './api/spin.js';

console.log('WILD_ID:', WILD_ID);
console.log('SCATTER_ID:', SCATTER_ID);
console.log('');

// Test semplice: wild, wild, wild, wild, wild
const g1 = [
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
];

console.log('Test 1: wild, wild, wild, wild, wild');
const wins1 = checkWins(g1);
console.log('Wins:', wins1.filter(w => w.payline === 0).map(w => `symbol=${w.symbol}, count=${w.count}`));
console.log('Expected: symbol=wild, count=5');
console.log('');

// Test: wild, python, wild, python, c
const g2 = [
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];

console.log('Test 2: wild, python, wild, python, c');
const wins2 = checkWins(g2);
console.log('Wins:', wins2.filter(w => w.payline === 0).map(w => `symbol=${w.symbol}, count=${w.count}`));
console.log('Expected: symbol=python, count=4 (wilds match python)');
console.log('');

// Test: python, wild, python
const g3 = [
  ['x', 'python', 'x'],
  ['x', 'python', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];

console.log('Test 3: python, python, wild, python, c');
const wins3 = checkWins(g3);
console.log('Wins:', wins3.filter(w => w.payline === 0).map(w => `symbol=${w.symbol}, count=${w.count}`));
console.log('Expected: symbol=python, count=4');
