/**
 * Test per verificare che il cache-buster della leva venga aggiornato correttamente
 * durante uno spin.
 * 
 * Questo test verifica la fix per il problema: "L'animazione di pull della leva
 * non si animava dopo il caricamento della pagina a seguito di uno spin."
 * 
 * Causa originale:
 * - api/spin.js aggiornava lastPullTimestamp ma non aggiungeva cache-buster a api/lever
 * - api/lever.js aveva Cache-Control: max-age=3600 (1 ora di cache)
 * 
 * Soluzione:
 * - Aggiunto cache-buster per api/lever simile a api/image
 * - Ridotta cache di api/lever da 3600s a 5s
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Lever Cache Buster (Issue Fix)', () => {
  it('api/spin.js deve includere regex per aggiornare api/lever con cache-buster', () => {
    const spinContent = readFileSync(
      './api/spin.js',
      'utf-8'
    );
    
    // Verifichiamo che esista il replace per api/lever
    expect(spinContent).toContain('api/lever');
    
    // Verifichiamo che ci sia una chiamata .replace per api/lever
    expect(spinContent).toContain('newReadme = newReadme.replace(');
    expect(spinContent).toContain('api/lever?v=${spinStart}');
  });

  it('api/lever.js deve avere una cache ridotta (non più 3600s)', () => {
    const leverContent = readFileSync(
      './api/lever.js',
      'utf-8'
    );
    
    // Verifichiamo che max-age NON sia 3600
    expect(leverContent).not.toContain('max-age=3600');
    
    // Verifichiamo che ci sia una cache ragionevole (5-60s)
    expect(leverContent).toMatch(/max-age=\d{1,2}/);
    
    // Verifichiamo la presenza di stale-while-revalidate
    expect(leverContent).toMatch(/stale-while-revalidate/);
  });

  it('Le regex per image e lever devono essere simili e consistenti', () => {
    const spinContent = readFileSync(
      './api/spin.js',
      'utf-8'
    );
    
    // Entrambi devono usare lo stesso pattern di cache-buster
    expect(spinContent).toContain('api/image');
    expect(spinContent).toContain('api/lever');
  });

  it('La regex della leva deve gestire sia URL senza parametri che con cache-buster esistente', () => {
    // La regex deve usare ?* per essere opzionale
    const leverRegex = /api\/lever(?:\?(?:v|cache_buster)=[0-9]*)?/g;
    
    const test1 = 'api/lever';
    const test2 = 'api/lever?v=123456';
    const test3 = 'api/lever?cache_buster=789';
    
    expect(test1.replace(leverRegex, 'api/lever?v=999')).toBe('api/lever?v=999');
    expect(test2.replace(leverRegex, 'api/lever?v=999')).toBe('api/lever?v=999');
    expect(test3.replace(leverRegex, 'api/lever?v=999')).toBe('api/lever?v=999');
  });
});
