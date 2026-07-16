#!/usr/bin/env node
/**
 * Test per il framework multi-version state migration
 * Verifica che sia possibile migrare da qualsiasi versione a quella corrente
 */

import { migrateState, STATE_VERSION } from './api/_lib/state.js';

console.log(`Testing multi-version migration framework (current version: ${STATE_VERSION})\n`);

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  }
}

function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${JSON.stringify(expected)}`);
    console.error(`   Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  } else {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  }
}

// Test 1: Migrazione v1 → v2
console.log('\n--- Test 1: Migrazione da v1 a v2 ---');
const v1State = {
  totalSpins: 100,
  totalWins: 25,
  lastWin: { langId: 'python', langName: 'Python', fact: '...', repoUrl: '...', repoName: 'cpython', ts: Date.now() },
  version: 1,
};

const migratedV1 = migrateState(v1State, 1);
assertEquals(migratedV1.version, 2, 'Versione aggiornata a v2');
assert(migratedV1.settings, 'Campi settings aggiunti');
assertEquals(migratedV1.settings.theme, 'auto', 'Default theme: auto');
assertEquals(migratedV1.settings.sound, true, 'Default sound: true');
assert(migratedV1.stats, 'Campi stats aggiunti');
assertEquals(migratedV1.stats.longestStreak, 0, 'Default longestStreak: 0');
assertEquals(migratedV1.stats.currentStreak, 0, 'Default currentStreak: 0');
assertEquals(migratedV1.stats.winsByLang, {}, 'Default winsByLang: {}');
// Verificare che i dati originali siano preservati
assertEquals(migratedV1.totalSpins, 100, 'totalSpins preservato');
assertEquals(migratedV1.totalWins, 25, 'totalWins preservato');

// Test 2: Stato già aggiornato (nessuna migrazione necessaria)
console.log('\n--- Test 2: Stato già aggiornato (v2) ---');
const v2State = {
  totalSpins: 200,
  totalWins: 50,
  version: 2,
  settings: { theme: 'dark', sound: false },
  stats: { longestStreak: 5, currentStreak: 2, winsByLang: { python: 10 } },
};

const alreadyV2 = migrateState(v2State, 2);
assertEquals(alreadyV2.version, 2, 'Versione rimane v2');
assertEquals(alreadyV2.settings.theme, 'dark', 'Impostazioni preservate');
assertEquals(alreadyV2.stats.winsByLang.python, 10, 'Stats preservate');

// Test 3: Stato senza version field (default a v1)
console.log('\n--- Test 3: Stato senza version field ---');
const noVersionState = {
  totalSpins: 50,
  totalWins: 10,
  lastWin: null,
};

const migratedNoVersion = migrateState(noVersionState, 1);
assertEquals(migratedNoVersion.version, 2, 'Versione impostata a v2 (default)');
assert(migratedNoVersion.settings, 'Campi settings aggiunti');
assert(migratedNoVersion.stats, 'Campi stats aggiunti');

// Test 4: Error handling per migrazione mancante
console.log('\n--- Test 4: Error handling per migrazione mancante ---');
const brokenState = {
  version: 99,
  totalSpins: 0,
};

try {
  migrateState(brokenState, 99);
  console.error('❌ FAIL: Dovrebbe lanciare errore per migrazione non definita');
  testsFailed++;
} catch (error) {
  assert(error.message.includes('No migration defined'), 'Errore corretto per migrazione mancante');
  console.log(`✅ PASS: Errore gestito correttamente: ${error.message}`);
  testsPassed++;
}

// Test 5: Verificare che il placeholder per v2→v3 esista
console.log('\n--- Test 5: Placeholder migrazione v2 → v3 ---');

// Il placeholder esiste già nel codice, testiamo che non causi errori
const v2Minimal = {
  totalSpins: 300,
  version: 2,
};

try {
  const result = migrateState(v2Minimal, 2);
  // STATE_VERSION è 2, quindi il ciclo while non esegue migrazioni
  assert(result.version === 2, 'v2 non migra se STATE_VERSION=2');
  assert(result.totalSpins === 300, 'Dati originali preservati');
  console.log(`✅ PASS: v2 stato gestito correttamente (STATE_VERSION=${STATE_VERSION})`);
  testsPassed++;
} catch (error) {
  console.error(`❌ FAIL: ${error.message}`);
  testsFailed++;
}

// Riepilogo
console.log('\n' + '='.repeat(50));
console.log(`Risultati: ${testsPassed} passati, ${testsFailed} falliti`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 Tutti i test passati! Framework multi-version migration operativo.');
  process.exit(0);
}
