import { checkWins, WILD_ID } from './api/spin.js';

// Griglia corretta: grid[col][row], 5 colonne x 3 righe
// Payline centrale: grid[0][1], grid[1][1], grid[2][1], grid[3][1], grid[4][1]

// Test 1: WILD come primo simbolo, ma ci sono simboli reali
const g1 = [
  ['wild', 'c', 'c'],  // colonna 0
  ['python', 'c', 'c'], // colonna 1 - payline[1] = 'python'
  ['wild', 'c', 'c'],  // colonna 2
  ['python', 'c', 'c'], // colonna 3 - payline[3] = 'python'
  ['c', 'c', 'c'],     // colonna 4 - payline[4] = 'c'
];
const wins1 = checkWins(g1);
console.log('Test 1 - WILD come primo, poi python, wild, python, c:');
console.log('  Payline centrale:', ['wild', 'python', 'wild', 'python', 'c']);
console.log('  Wins:', wins1);
console.log('  Expected: python win with count=4 (wilds match python)');
console.log('  Result:', wins1.some(w => w.symbol === 'python' && w.count >= 3) ? 'PASS' : 'FAIL');
console.log('');

// Test 2: Tutti WILD
const g2 = [
  ['wild', 'c', 'c'],
  ['wild', 'c', 'c'],
  ['wild', 'c', 'c'],
  ['wild', 'c', 'c'],
  ['wild', 'c', 'c'],
];
const wins2 = checkWins(g2);
console.log('Test 2 - Tutti WILD:');
console.log('  Payline centrale:', ['wild', 'wild', 'wild', 'wild', 'wild']);
console.log('  Wins:', wins2);
console.log('  Expected: wild win with count=5');
console.log('  Result:', wins2.some(w => w.symbol === 'wild' && w.count === 5) ? 'PASS' : 'FAIL');
console.log('');

// Test 3: WILD in mezzo a simboli reali
const g3 = [
  ['python', 'c', 'c'],
  ['python', 'c', 'c'],
  ['wild', 'c', 'c'],
  ['python', 'c', 'c'],
  ['c', 'c', 'c'],
];
const wins3 = checkWins(g3);
console.log('Test 3 - python, python, wild, python, c:');
console.log('  Payline centrale:', ['python', 'python', 'wild', 'python', 'c']);
console.log('  Wins:', wins3);
console.log('  Expected: python win with count=4');
console.log('  Result:', wins3.some(w => w.symbol === 'python' && w.count === 4) ? 'PASS' : 'FAIL');
console.log('');

// Test 4: WILD che completa una win
const g4 = [
  ['python', 'c', 'c'],
  ['python', 'c', 'c'],
  ['wild', 'c', 'c'],
  ['c', 'c', 'c'],
  ['c', 'c', 'c'],
];
const wins4 = checkWins(g4);
console.log('Test 4 - python, python, wild, c, c:');
console.log('  Payline centrale:', ['python', 'python', 'wild', 'c', 'c']);
console.log('  Wins:', wins4);
console.log('  Expected: python win with count=3');
console.log('  Result:', wins4.some(w => w.symbol === 'python' && w.count === 3) ? 'PASS' : 'FAIL');
