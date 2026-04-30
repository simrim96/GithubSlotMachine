// ─────────────────────────────────────────────────────────────────────────────
//  LANGUAGES CONFIG
//  Per aggiungere un nuovo linguaggio basta appendere un oggetto a `LANGUAGES`.
//  Ogni voce supporta:
//    id          chiave interna unica
//    name        nome mostrato all'utente
//    short       label compatto sulla slot (max ~5 chars)
//    color       colore di sfondo del simbolo
//    accent      colore secondario (bordo / highlight)
//    text        colore del testo sul simbolo
//    githubLang  nome esatto come riportato dalla GitHub Languages API
//    topic       (opzionale) topic richiesto sul repo (utile per framework)
//    icon        SVG markup interno (centrato in viewBox 78x56) col logo "ufficiale"
//    facts       lista di fun-fact in formato { it, en } — uno scelto random
// ─────────────────────────────────────────────────────────────────────────────

export const LANGUAGES = [
  {
    id: 'cpp',
    name: 'C++',
    short: 'C++',
    color: '#00599C',
    accent: '#9FD3F0',
    text: '#ffffff',
    githubLang: 'C++',
    icon: `
      <g transform="translate(42,38)">
        <path d="M0,-22 L19,-11 L19,11 L0,22 L-19,11 L-19,-11 Z"
              fill="#004482" stroke="#9FD3F0" stroke-width="1.4"/>
        <text x="0" y="6" text-anchor="middle" font-family="'Segoe UI',sans-serif"
              font-size="16" font-weight="900" fill="#ffffff" letter-spacing="-0.5">C++</text>
      </g>`,
    facts: [
      {
        it: 'C++ è nato nel 1985 da Bjarne Stroustrup come "C with Classes": oggi alimenta Unreal Engine, Chrome e MongoDB.',
        en: 'C++ was created in 1985 by Bjarne Stroustrup as "C with Classes": today it powers Unreal Engine, Chrome and MongoDB.',
      },
      {
        it: 'Il principio "zero-cost abstraction" del C++ permette astrazioni di alto livello che non costano nulla a runtime: paghi solo ciò che usi.',
        en: 'C++\'s "zero-cost abstraction" principle lets you build high-level abstractions with no runtime overhead: you only pay for what you use.',
      },
      {
        it: "C++20 ha introdotto Concepts, Coroutines, Modules e std::ranges: forse l'update più rivoluzionario dai tempi del C++11.",
        en: 'C++20 introduced Concepts, Coroutines, Modules and std::ranges: arguably the most revolutionary update since C++11.',
      },
    ],
  },
  {
    id: 'glsl',
    name: 'GLSL',
    short: 'GLSL',
    color: '#5586A4',
    accent: '#F5B642',
    text: '#ffffff',
    githubLang: 'GLSL',
    icon: `
      <g transform="translate(42,38)">
        <polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11"
                 fill="#3a6178" stroke="#F5B642" stroke-width="1.8"/>
        <polygon points="0,-13 11,-6.5 11,6.5 0,13 -11,6.5 -11,-6.5"
                 fill="none" stroke="#F5B642" stroke-width="1.2" opacity="0.6"/>
        <text x="0" y="5" text-anchor="middle" font-family="'Segoe UI',sans-serif"
              font-size="13" font-weight="900" fill="#ffffff">GL</text>
      </g>`,
    facts: [
      {
        it: 'GLSL gira direttamente sulla GPU: ogni pixel del tuo schermo in un gioco moderno è il risultato di milioni di esecuzioni parallele di un fragment shader.',
        en: 'GLSL runs directly on the GPU: every pixel on your screen in a modern game is the result of millions of parallel fragment-shader executions.',
      },
      {
        it: 'In GLSL non esistono puntatori né allocazione dinamica: tutto è pensato per il calcolo SIMD massivamente parallelo.',
        en: 'GLSL has no pointers and no dynamic allocation: everything is designed for massively parallel SIMD computation.',
      },
      {
        it: "Con un solo fragment shader e una signed-distance-function si possono ray-marciare interi mondi 3D (vedi ShaderToy): è l'arte del demoscene moderno.",
        en: 'With a single fragment shader and a signed-distance function you can ray-march entire 3D worlds (see ShaderToy): the art of the modern demoscene.',
      },
    ],
  },
  {
    id: 'react',
    name: 'React',
    short: 'React',
    color: '#20232A',
    accent: '#61DAFB',
    text: '#61DAFB',
    githubLang: 'JavaScript',
    topic: 'react',
    icon: `
      <g transform="translate(42,38)">
        <ellipse cx="0" cy="0" rx="20" ry="7.5" fill="none" stroke="#61DAFB" stroke-width="1.8"/>
        <ellipse cx="0" cy="0" rx="20" ry="7.5" fill="none" stroke="#61DAFB" stroke-width="1.8" transform="rotate(60)"/>
        <ellipse cx="0" cy="0" rx="20" ry="7.5" fill="none" stroke="#61DAFB" stroke-width="1.8" transform="rotate(120)"/>
        <circle cx="0" cy="0" r="3.6" fill="#61DAFB"/>
      </g>`,
    facts: [
      {
        it: 'React è stato creato nel 2013 da Jordan Walke (Facebook), ispirato a XHP di PHP. Oggi è il framework UI più usato al mondo.',
        en: 'React was created in 2013 by Jordan Walke (Facebook), inspired by PHP\'s XHP. Today it\'s the most-used UI framework in the world.',
      },
      {
        it: 'React Fiber è la riscrittura del reconciler che ha reso possibile Suspense, Concurrent Mode e il rendering interrompibile a priorità.',
        en: 'React Fiber is the reconciler rewrite that made Suspense, Concurrent Mode and priority-based interruptible rendering possible.',
      },
      {
        it: 'Il Virtual DOM non è "veloce di per sé": è un trade-off intelligente che evita reflow inutili confrontando alberi virtuali invece del DOM reale.',
        en: 'The Virtual DOM isn\'t "inherently fast": it\'s a smart trade-off that avoids needless reflows by diffing virtual trees instead of the real DOM.',
      },
    ],
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    short: 'JS',
    color: '#F7DF1E',
    accent: '#000000',
    text: '#1a1a1a',
    githubLang: 'JavaScript',
    icon: `
      <g transform="translate(42,38)">
        <rect x="-22" y="-22" width="44" height="44" rx="4" fill="#F7DF1E" stroke="#1a1a1a" stroke-width="1.2"/>
        <text x="16" y="16" text-anchor="end" font-family="'Segoe UI',sans-serif"
              font-size="19" font-weight="900" fill="#1a1a1a" letter-spacing="-0.5">JS</text>
      </g>`,
    facts: [
      {
        it: 'JavaScript è stato progettato da Brendan Eich in soli 10 giorni, nel maggio 1995, mentre lavorava a Netscape.',
        en: 'JavaScript was designed by Brendan Eich in just 10 days, in May 1995, while he was at Netscape.',
      },
      {
        it: 'Il nome originale era "Mocha", poi "LiveScript" e infine "JavaScript" — una scelta di marketing per cavalcare l\'hype di Java.',
        en: 'The original name was "Mocha", then "LiveScript" and finally "JavaScript" — a marketing move to ride the Java hype wave.',
      },
      {
        it: 'ECMAScript è lo standard ufficiale dietro JavaScript, mantenuto dal TC39: un comitato che rilascia una nuova edizione del linguaggio ogni anno.',
        en: 'ECMAScript is the official standard behind JavaScript, maintained by TC39: a committee that ships a new edition of the language every year.',
      },
    ],
  },
  {
    id: 'python',
    name: 'Python',
    short: 'Py',
    color: '#3776AB',
    accent: '#FFD43B',
    text: '#ffffff',
    githubLang: 'Python',
    icon: `
      <g transform="translate(42,38) scale(1.45)">
        <path d="M-2,-14 Q-9,-14 -9,-7 V-3 H1 V-1 H-11 Q-15,-1 -15,5 V9 Q-15,14 -10,14 H-6 V8 Q-6,4 -1,4 H7 Q12,4 12,-1 V-7 Q12,-14 5,-14 Z"
              fill="#3776AB" stroke="#ffffff" stroke-width="0.6"/>
        <circle cx="-5" cy="-10" r="1.4" fill="#ffffff"/>
        <path d="M2,14 Q9,14 9,7 V3 H-1 V1 H11 Q15,1 15,-5 V-9 Q15,-14 10,-14 H6 V-8 Q6,-4 1,-4 H-7 Q-12,-4 -12,1 V7 Q-12,14 -5,14 Z"
              fill="#FFD43B" stroke="#ffffff" stroke-width="0.6"/>
        <circle cx="5" cy="10" r="1.4" fill="#ffffff"/>
      </g>`,
    facts: [
      {
        it: 'Python prende il nome dai Monty Python\'s Flying Circus, non dal serpente: Guido van Rossum era un grande fan dello show.',
        en: 'Python is named after Monty Python\'s Flying Circus, not the snake: Guido van Rossum was a huge fan of the show.',
      },
      {
        it: 'Digitando `import this` in qualsiasi REPL Python compare lo Zen of Python: 19 aforismi che riassumono la filosofia del linguaggio.',
        en: 'Type `import this` in any Python REPL and the Zen of Python appears: 19 aphorisms that capture the language\'s philosophy.',
      },
      {
        it: "Python è il motore dell'ecosistema AI moderno: PyTorch, TensorFlow, scikit-learn e Hugging Face sono tutti scritti (almeno in parte) in Python.",
        en: 'Python is the engine of the modern AI ecosystem: PyTorch, TensorFlow, scikit-learn and Hugging Face are all written (at least partly) in Python.',
      },
    ],
  },
];

export const WILD = {
  id: 'wild',
  short: 'WILD',
  color: '#fde047',
  accent: '#a16207',
  text: '#1a1a2e',
  icon: `
    <g transform="translate(42,38)">
      <polygon points="0,-19 5.2,-6 19,-6 8,2.2 12.5,16 0,8 -12.5,16 -8,2.2 -19,-6 -5.2,-6"
               fill="#1a1a2e" stroke="#a16207" stroke-width="1.2"/>
    </g>`,
};

// SCATTER (BONUS) — mantenuto come export per retro-compat ma non più inserito
// nel reel né usato per logiche di gioco (free spin rimosso in favore del JACKPOT).
export const SCATTER = {
  id: 'scatter',
  short: 'BONUS',
  color: '#a855f7',
  accent: '#f0abfc',
  text: '#ffffff',
  icon: `
    <g transform="translate(42,38)">
      <path d="M0,-19 L5,-5 L19,0 L5,5 L0,19 L-5,5 L-19,0 L-5,-5 Z"
            fill="#ffffff" stroke="#f0abfc" stroke-width="1.2"/>
    </g>`,
};

export const ALL_SYMBOLS = [...LANGUAGES, WILD, SCATTER];
export const SYMBOL_BY_ID = Object.fromEntries(ALL_SYMBOLS.map((s) => [s.id, s]));
export const LANGUAGE_BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));

export const WILD_ID = WILD.id;
export const SCATTER_ID = SCATTER.id;

// ─── Symbol renderer ──────────────────────────────────────────────────────────
// Cella quadrata 84×84: icona centrata in alto (y≈38) + label compatto in basso (y≈73).
export function buildSymbolDefs(uid) {
  return ALL_SYMBOLS.map((s) => {
    const grad = `g_${uid}_${s.id}`;
    return `
<linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="${s.color}" stop-opacity="1"/>
  <stop offset="100%" stop-color="${shade(s.color, -0.25)}" stop-opacity="1"/>
</linearGradient>
<symbol id="sym_${uid}_${s.id}" viewBox="0 0 84 84">
  <rect x="4" y="4" width="76" height="76" rx="11" fill="url(#${grad})"/>
  <rect x="4" y="4" width="76" height="76" rx="11" fill="none" stroke="${s.accent}" stroke-width="1.6" opacity="0.85"/>
  <rect x="7" y="7" width="70" height="14" rx="5" fill="#ffffff" opacity="0.07"/>
  ${s.icon || ''}
  <text x="42" y="73" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif"
        font-size="10" font-weight="700" fill="${s.text}" letter-spacing="0.7" opacity="0.95">${escapeXml(s.short)}</text>
</symbol>`;
  }).join('');
}

export function symbolUse(uid, id, x, y, w = 84, h = 84) {
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

// Ritorna un fact bilingue { it, en } scelto a caso. Per retro-compatibilità,
// se la voce è una stringa la converte in { it: stringa, en: stringa }.
export function pickFact(lang) {
  const facts = lang.facts || [];
  if (!facts.length) return { it: '', en: '' };
  const f = facts[Math.floor(Math.random() * facts.length)];
  if (typeof f === 'string') return { it: f, en: f };
  return { it: f.it || f.en || '', en: f.en || f.it || '' };
}
