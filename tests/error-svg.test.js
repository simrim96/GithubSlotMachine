// Test su errorSVG: deve essere un SVG di degrado SEMPRE valido, anche con
// input strani, e non propagare mai un'eccezione (così lo slot non esplode).
import { describe, it, expect } from 'vitest';
import { errorSVG, escapeXml } from '../api/_lib/svg-builder.js';

describe('errorSVG — degrado graceful', () => {
  it('restituisce un data-URI SVG valido', () => {
    const out = errorSVG();
    expect(out.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const b64 = out.slice('data:image/svg+xml;base64,'.length);
    const svg = Buffer.from(b64, 'base64').toString('utf-8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('600');
    expect(svg).toContain('624');
  });

  it('non lascia undefined nel markup (owner di default)', () => {
    const out = errorSVG();
    expect(out).not.toContain('undefined');
  });

  it('inietta l\'owner parametrico', () => {
    const out = errorSVG({ owner: 'octocat' });
    const svg = Buffer.from(out.split(',')[1], 'base64').toString('utf-8');
    expect(svg).toContain('github.com/octocat');
  });

  it('escapa caratteri pericolosi nel messaggio (no XSS/XML break)', () => {
    const out = errorSVG({ message: '<script>&"\'</script>' });
    const svg = Buffer.from(out.split(',')[1], 'base64').toString('utf-8');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('tronca messaggi troppo lunghi senza rompere l\'SVG', () => {
    const longMsg = 'x'.repeat(500);
    const out = errorSVG({ message: longMsg });
    const svg = Buffer.from(out.split(',')[1], 'base64').toString('utf-8');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    // il messaggio nello SVG è troncato a 80 char
    const decoded = escapeXml(longMsg.slice(0, 80));
    expect(svg).toContain(decoded);
  });

  it('non lancia mai con input assenti/undefined', () => {
    expect(() => errorSVG(undefined)).not.toThrow();
    expect(() => errorSVG({})).not.toThrow();
    expect(() => errorSVG({ owner: undefined, message: undefined })).not.toThrow();
  });
});
