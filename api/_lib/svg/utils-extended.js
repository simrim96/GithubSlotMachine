// ─── Extended Utility Functions ──────────────────────────────────────────────────
// Utility functions aggiuntive per SVG generation

// Funzione wrap per il text wrapping nel result panel
export function wrap(text, maxWidth) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let line = '';
  
  for (const word of words) {
    if ((line + word).length <= maxWidth) {
      line += (line ? ' ' : '') + word;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
