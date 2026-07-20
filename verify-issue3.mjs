// Verifica funzionale reale del miglioramento #3 (nessun mock delle funzioni
// core: importa i moduli veri e ne esercita il comportamento).
import assert from 'node:assert';

import {
  errorSVG,
  errorSVGString,
} from './api/_lib/svg-builder-accessible.js';

// resolveRedirectUrl vive in spin.js (helper di quel modulo).
import { resolveRedirectUrl } from './api/spin.js';

let failures = 0;
let warnings = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL  ' + name + ' :: ' + e.message);
  }
}
function warn(msg) {
  warnings++;
  console.log('  WARN  ' + msg);
}

console.log('\n[1] errorSVGString restituisce SVG GREZZO (non data-URI)');
check('errorSVGString e\' markup SVG grezzo (inizia con <svg o <?xml)', () => {
  const s = errorSVGString({ owner: 'simrim96', message: 'Ops!' });
  assert.ok(
    s.startsWith('<svg') || s.startsWith('<?xml'),
    'non e\' SVG grezzo: ' + s.slice(0, 40)
  );
});
check('errorSVGString NON e\' un data-URI', () => {
  const s = errorSVGString({ owner: 'simrim96', message: 'Ops!' });
  assert.ok(!s.startsWith('data:'), 'e\' un data-URI, non grezzo');
});
check('errorSVG (confronto) resta data-URI come prima', () => {
  const d = errorSVG({ owner: 'simrim96', message: 'Ops!' });
  assert.ok(d.startsWith('data:image/svg+xml'), 'forma data-URI cambiata');
});
check('errorSVGString contiene il messaggio', () => {
  const s = errorSVGString({ owner: 'simrim96', message: 'Ops!' });
  assert.ok(s.includes('Ops!'), 'messaggio non presente nel SVG');
});
check('errorSVGString e\' SVG ben formato (chiusura </svg>)', () => {
  const s = errorSVGString({ owner: 'simrim96', message: 'x' });
  assert.ok(s.trim().endsWith('</svg>'), 'non termina con </svg>');
});

console.log('\n[2] resolveRedirectUrl — anti open-redirect (helper reale)');
check('redirect valido https su github.com e\' permesso', () => {
  const u = resolveRedirectUrl('https://github.com/simrim96', 'https://github.com/');
  assert.strictEqual(u, 'https://github.com/simrim96');
});
check('redirect verso host estraneo e\' BLOCCATO (cade sul default)', () => {
  const def = 'https://github.com/simrim96';
  const u = resolveRedirectUrl('https://evil.example.com/phish', def);
  assert.strictEqual(u, def, 'open-redirect verso host estraneo NON bloccato!');
});
check('redirect vuoto/assente cade sul default', () => {
  const def = 'https://github.com/simrim96';
  assert.strictEqual(resolveRedirectUrl('', def), def);
  assert.strictEqual(resolveRedirectUrl(undefined, def), def);
});
check('host estraneo anche su http e\' bloccato', () => {
  const def = 'https://github.com/simrim96';
  const u = resolveRedirectUrl('http://evil.example.com/x', def);
  assert.strictEqual(u, def, 'open-redirect http verso host estraneo NON bloccato!');
});

// NOTA: il progetto (pre-esistente, fuori scope #3) permette http:// su host
// consentiti. Lo segnaliamo come WARNING, non come failure del #3.
const httpOnTrusted = resolveRedirectUrl(
  'http://github.com/x',
  'https://github.com/simrim96'
);
if (httpOnTrusted === 'http://github.com/x') {
  warn(
    'isValidRedirectUrl ACCETTA http:// su host fidato (es. http://github.com/x). ' +
      'Possibile downgrade/MITM su redirect. Fuori scope #3: va rafforzato a https-only ' +
      'se vuoi (modifica isValidRedirectUrl in spin.js).'
  );
} else {
  check('http su host fidato e\' bloccato', () => {
    assert.strictEqual(httpOnTrusted, 'https://github.com/simrim96');
  });
}

console.log('\n========================================');
console.log('FALLIMENTI: ' + failures + '   AVVISI: ' + warnings);
console.log(failures === 0 ? 'VERIFICA #3: TUTTO OK' : 'VERIFICA #3: PRESENTI FALLIMENTI');
console.log('========================================');
process.exit(failures === 0 ? 0 : 1);
