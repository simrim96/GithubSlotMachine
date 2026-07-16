import { checkWins, WILD_ID, SCATTER_ID, PAYLINES } from './api/spin.js';

console.log('=== ULTIMI TEST WILDCARD LOGIC ===\n');

function createGrid(row0, row1, row2) {
  return [
    [row0[0], row0[1], row0[2]],
    [row1[0], row1[1], row1[2]],
    [row2[0], row2[1], row2[2]],
    [row3[0], row3[1], row3[2]],
    [row4[0], row4[1], row4[2]],
  ];
}

// Il test originale di game.test.js (righe 107-116)
const g1 = [
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];
const wins1 = checkWins(g1);
const hasPythonWin1 = wins1.some(w => w.payline === 0 && w.symbol === 'python' && w.count >= 3);
console.log(`Test 1 (game.test.js line 107): ${hasPythonWin1 ? 'PASS ✓' : 'FAIL ✗'}`);

// SCATTER al primo posizione - nessuna win dovrebbe essere rilevata
const g2 = [
  ['x', 'scatter', 'x'],
  ['x', 'python', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];
const wins2 = checkWins(g2);
const noWin2 = !wins2.some(w => w.payline === 0);
console.log(`Test 2 (SCATTER in testa): ${noWin2 ? 'PASS ✓' : 'FAIL ✗'}`);

// WILD + SCATTER misti - SCATTER dovrebbe interrompere
const g3 = [
  ['x', 'wild', 'x'],
  ['x', 'scatter', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'python', 'x'],
  ['x', 'c', 'x'],
];
const wins3 = checkWins(g3);
const noWin3 = !wins3.some(w => w.payline === 0);
console.log(`Test 3 (WILD then SCATTER): ${noWin3 ? 'PASS ✓' : 'FAIL ✗'}`);

// Tutti WILD - dovrebbe essere win di WILD
const g4 = [
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
  ['x', 'wild', 'x'],
];
const wins4 = checkWins(g4);
const hasWildWin4 = wins4.some(w => w.payline === 0 && w.symbol === 'wild' && w.count === 5);
console.log(`Test 4 (Tutti WILD): ${hasWildWin4 ? 'PASS ✓' : 'FAIL ✗'}`);

console.log('\n=== Tutti i test game.test.js dovrebbero passare ===');
