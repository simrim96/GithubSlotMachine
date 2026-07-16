import { checkWins, WILD_ID, SCATTER_ID } from './api/spin.js';

console.log('=== TEST COMPRENSIVI WILDCARD LOGIC ===\n');

function test(name, grid, paylineIndex, expectedSymbol, expectedMinCount, expectedMaxCount) {
  const wins = checkWins(grid);
  const paylineWin = wins.find(w => w.payline === paylineIndex);
  
  if (!paylineWin) {
    console.log(`✗ ${name}: NO WIN TROVATA`);
    console.log(`  Atteso: symbol=${expectedSymbol}, count=${expectedMinCount}-${expectedMaxCount}`);
    return false;
  }
  
  const symbolMatch = paylineWin.symbol === expectedSymbol;
  const countMatch = paylineWin.count >= expectedMinCount && paylineWin.count <= expectedMaxCount;
  
  if (symbolMatch && countMatch) {
    console.log(`✓ ${name}: symbol=${paylineWin.symbol}, count=${paylineWin.count}`);
    return true;
  } else {
    console.log(`✗ ${name}: symbol=${paylineWin.symbol}, count=${paylineWin.count}`);
    console.log(`  Atteso: symbol=${expectedSymbol}, count=${expectedMinCount}-${expectedMaxCount}`);
    return false;
  }
}

// Helper per creare griglia
function createGrid(col0, col1, col2, col3, col4) {
  return [
    ['x', col0[0], 'x'],
    ['x', col1[0], 'x'],
    ['x', col2[0], 'x'],
    ['x', col3[0], 'x'],
    ['x', col4[0], 'x'],
  ];
}

console.log('--- PAYLINE CENTRALE (row=1) ---');
let passed = 0, failed = 0;

// Test 1: Tutti WILD
if (test('Tutti WILD', createGrid('wild', 'wild', 'wild', 'wild', 'wild'), 0, 'wild', 5, 5)) passed++; else failed++;

// Test 2: WILD + simboli reali
if (test('wild, python, wild, python, c', createGrid('wild', 'python', 'wild', 'python', 'c'), 0, 'python', 3, 4)) passed++; else failed++;

// Test 3: WILD che completa una sequenza
if (test('python, python, wild, python, c', createGrid('python', 'python', 'wild', 'python', 'c'), 0, 'python', 4, 4)) passed++; else failed++;

// Test 4: WILD in testa con solo 1 simbolo reale
if (test('wild, wild, wild, wild, python', createGrid('wild', 'wild', 'wild', 'wild', 'python'), 0, 'python', 5, 5)) passed++; else failed++;

// Test 5: SCATTER in testa interrompe
if (test('scatter, python, wild, python, c', createGrid('scatter', 'python', 'wild', 'python', 'c'), 0, null, 0, 0)) passed++; else failed++;

// Test 6: WILD in mezzo, SCATTER dopo
if (test('python, wild, scatter, python, c', createGrid('python', 'wild', 'scatter', 'python', 'c'), 0, null, 0, 0)) passed++; else failed++;

// Test 7: WILD + SCATTER misti
if (test('wild, scatter, wild, python, c', createGrid('wild', 'scatter', 'wild', 'python', 'c'), 0, null, 0, 0)) passed++; else failed++;

// Test 8: Solo 2 simboli (non win)
if (test('python, wild, c, c, c', createGrid('python', 'wild', 'c', 'c', 'c'), 0, null, 0, 0)) passed++; else failed++;

// Test 9: 3 simboli WILD+real+real
if (test('wild, python, python, c, c', createGrid('wild', 'python', 'python', 'c', 'c'), 0, 'python', 3, 3)) passed++; else failed++;

// Test 10: WILD come unico win
if (test('wild, wild, wild, c, c', createGrid('wild', 'wild', 'wild', 'c', 'c'), 0, 'wild', 3, 3)) passed++; else failed++;

console.log(`\n=== RISULTATI: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
