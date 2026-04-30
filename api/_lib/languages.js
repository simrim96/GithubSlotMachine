// ─────────────────────────────────────────────────────────────────────────────
//  LANGUAGES CONFIG
//  Per aggiungere un nuovo linguaggio basta appendere un oggetto a `LANGUAGES`.
//  Ogni voce supporta:
//    id          chiave interna unica
//    name        nome mostrato all'utente
//    short       label compatto sulla slot (max ~5 chars)
//    glyph       glyph decorativo (unicode) accanto al short
//    color       colore di sfondo del simbolo
//    accent      colore secondario (bordo / highlight)
//    text        colore del testo sul simbolo
//    githubLang  nome esatto come riportato dalla GitHub Languages API
//    topic       (opzionale) topic richiesto sul repo (utile per framework)
//    facts       lista di descrizioni / fun-fact (ne viene scelto uno random)
// ─────────────────────────────────────────────────────────────────────────────

export const LANGUAGES = [
  {
    id: 'cpp',
    name: 'C++',
    short: 'C++',
    glyph: '',
    color: '#00599C',
    accent: '#9FD3F0',
    text: '#ffffff',
    githubLang: 'C++',
    facts: [
      'C++ è nato nel 1985 da Bjarne Stroustrup come "C with Classes": oggi alimenta Unreal Engine, Chrome, MongoDB e quasi tutti i motori grafici AAA.',
      'Il principio "zero-cost abstraction" del C++ permette astrazioni di alto livello che non costano nulla a runtime: paghi solo ciò che usi.',
      "C++20 ha introdotto i Concepts, le Coroutines, i Modules e std::ranges: forse l'update più rivoluzionario dai tempi del C++11.",
    ],
  },
  {
    id: 'glsl',
    name: 'GLSL',
    short: 'GLSL',
    glyph: '◈',
    color: '#5586A4',
    accent: '#F5B642',
    text: '#ffffff',
    githubLang: 'GLSL',
    facts: [
      'GLSL gira direttamente sulla GPU: ogni pixel del tuo schermo in un gioco moderno è il risultato di milioni di esecuzioni parallele di un fragment shader.',
      'In GLSL non esistono puntatori né allocazione dinamica: tutto è pensato per il calcolo SIMD massivamente parallelo.',
      "Con un solo fragment shader e una funzione di distanza si possono ray-marciare interi mondi 3D (vedi ShaderToy): è l'arte del demo-scene moderno.",
    ],
  },
  {
    id: 'react',
    name: 'React',
    short: 'React',
    glyph: '⚛',
    color: '#20232A',
    accent: '#61DAFB',
    text: '#61DAFB',
    githubLang: 'JavaScript',
    topic: 'react',
    facts: [
      'React è stato creato nel 2013 da Jordan Walke (Facebook), ispirato a XHP di PHP. Oggi è il framework UI più usato al mondo.',
      'React Fiber è la riscrittura del reconciler che ha reso possibile Suspense, Concurrent Mode e il rendering interrompibile a priorità.',
      'Il Virtual DOM non è "veloce di per sé": è un trade-off intelligente che evita reflow inutili confrontando alberi virtuali invece del DOM reale.',
    ],
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    short: 'JS',
    glyph: '{ }',
    color: '#F7DF1E',
    accent: '#000000',
    text: '#1a1a1a',
    githubLang: 'JavaScript',
    facts: [
      'JavaScript è stato progettato da Brendan Eich in soli 10 giorni, nel maggio 1995, mentre lavorava a Netscape.',
      'Il nome originale era "Mocha", poi "LiveScript" e infine "JavaScript" — una scelta puramente di marketing per cavalcare l\'hype di Java.',
      "ECMAScript è lo standard ufficiale dietro JavaScript, mantenuto dal TC39: un comitato che rilascia una nuova edizione del linguaggio ogni anno.",
    ],
  },
  {
    id: 'python',
    name: 'Python',
    short: 'Py',
    glyph: '🐍',
    color: '#3776AB',
    accent: '#FFD43B',
    text: '#ffffff',
    githubLang: 'Python',
    facts: [
      'Python prende il nome dai Monty Python\'s Flying Circus, non dal serpente: Guido van Rossum era un grande fan dello show.',
      'Digitando `import this` in qualsiasi REPL Python compare lo Zen of Python: 19 aforismi che riassumono la filosofia del linguaggio.',
      "Python è il motore dell'ecosistema AI moderno: PyTorch, TensorFlow, scikit-learn e Hugging Face sono tutti scritti (almeno in parte) in Python.",
    ],
  },
];

export const WILD = {
  id: 'wild',
  short: 'WILD',
  glyph: '★',
  color: '#fde047',
  accent: '#a16207',
  text: '#1a1a2e',
};

export const SCATTER = {
  id: 'scatter',
  short: 'BONUS',
  glyph: '✦',
  color: '#a855f7',
  accent: '#f0abfc',
  text: '#ffffff',
};

export const ALL_SYMBOLS = [...LANGUAGES, WILD, SCATTER];
export const SYMBOL_BY_ID = Object.fromEntries(ALL_SYMBOLS.map((s) => [s.id, s]));
export const LANGUAGE_BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));

export const WILD_ID = WILD.id;
export const SCATTER_ID = SCATTER.id;

// ─── Symbol renderer ──────────────────────────────────────────────────────────
// Ritorna un blocco <symbol> riusabile via <use href="#sym-<id>" .../>.
// Le dimensioni sono quelle di una cella della griglia (viewBox 78x56).
export function buildSymbolDefs(uid) {
  return ALL_SYMBOLS.map((s) => {
    const grad = `g_${uid}_${s.id}`;
    return `
<linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="${s.color}" stop-opacity="1"/>
  <stop offset="100%" stop-color="${shade(s.color, -0.25)}" stop-opacity="1"/>
</linearGradient>
<symbol id="sym_${uid}_${s.id}" viewBox="0 0 78 56">
  <rect x="3" y="3" width="72" height="50" rx="9" fill="url(#${grad})"/>
  <rect x="3" y="3" width="72" height="50" rx="9" fill="none" stroke="${s.accent}" stroke-width="1.6" opacity="0.85"/>
  <rect x="6" y="6" width="66" height="14" rx="5" fill="#ffffff" opacity="0.10"/>
  ${s.glyph ? `<text x="18" y="38" font-family="'Segoe UI Emoji','Apple Color Emoji',sans-serif" font-size="18" fill="${s.text}" opacity="0.85">${escapeXml(s.glyph)}</text>` : ''}
  <text x="${s.glyph ? 40 : 39}" y="36" text-anchor="${s.glyph ? 'start' : 'middle'}" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="15" font-weight="700" fill="${s.text}" letter-spacing="0.5">${escapeXml(s.short)}</text>
</symbol>`;
  }).join('');
}

export function symbolUse(uid, id, x, y, w = 78, h = 56) {
  return `<use href="#sym_${uid}_${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function shade(hex, pct) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const m = (v) => {
    const x = Math.round(v + (pct >= 0 ? (255 - v) : v) * pct);
    return Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0');
  };
  return `#${m(r)}${m(g)}${m(b)}`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

export { escapeXml };

export function pickFact(lang) {
  const facts = lang.facts || [];
  if (!facts.length) return '';
  return facts[Math.floor(Math.random() * facts.length)];
}
