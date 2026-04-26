const OWNER = 'simrim96';
const SLOT_REPO = 'GithubSlotMachine';
const PROFILE_REPO = 'simrim96';
const ICONS = ['🍒', '💎', '🍋', '7️⃣', '🔔', '⭐'];

export default async function handler(req, res) {
  const token = process.env.GITHUB_PAT;
  const results = Array.from({ length: 3 }, () =>
    ICONS[Math.floor(Math.random() * ICONS.length)]
  );
  const ts = Date.now();

  try {
    const svg = buildSVG(results, ts);

    // Scarica i file correnti in parallelo
    const [slotFile, readmeFile] = await Promise.all([
      ghGet(token, SLOT_REPO, 'slot.svg'),
      ghGet(token, PROFILE_REPO, 'README.md'),
    ]);

    // Committa entrambi in parallelo
    const updates = [
      ghPut(token, SLOT_REPO, 'slot.svg', svg, slotFile?.sha, '🎰 Spin'),
    ];

    if (readmeFile) {
      const oldReadme = Buffer.from(readmeFile.content, 'base64').toString('utf-8');
      const newReadme = oldReadme.replace(
        /api\/image\?(?:v|cache_buster)=[0-9]*/g,
        `api/image?v=${ts}`
      );
      if (newReadme !== oldReadme) {
        updates.push(
          ghPut(token, PROFILE_REPO, 'README.md', newReadme, readmeFile.sha, '🎰 Update slot')
        );
      }
    }

    await Promise.all(updates);
    res.redirect(302, `https://github.com/${OWNER}`);
  } catch (err) {
    res.status(500).send('Errore: ' + err.message);
  }
}

// --- GitHub API ---

async function ghGet(token, repo, path) {
  const r = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SlotMachine',
      },
    }
  );
  return r.ok ? r.json() : null;
}

async function ghPut(token, repo, path, content, sha, message) {
  const body = { message, content: Buffer.from(content).toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'SlotMachine',
      },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`PUT ${repo}/${path}: ${r.status}`);
}

// --- Generatore SVG con animazione slot machine ---

function buildSVG(results, uid) {
  const FILLERS = 10;        // simboli di riempimento per rullo
  const SH = 80;             // altezza simbolo (spacing verticale)
  const WY = 58;             // Y finestra rullo
  const WH = 80;             // altezza finestra rullo
  const BY = WY + WH / 2 + 18; // baseline testo centrata nella finestra
  const RX = [75, 200, 325]; // posizioni X centrali dei rulli
  const DUR = [1.8, 2.6, 3.4]; // durata animazione per rullo (secondi)

  const isJackpot = results[0] === results[1] && results[1] === results[2];

  let defs = '';
  let css = '';
  let reelsSvg = '';

  for (let i = 0; i < 3; i++) {
    const cid = `c${uid}r${i}`;
    const aid = `a${uid}r${i}`;
    const x = RX[i];
    const scroll = FILLERS * SH;

    // Clip path per la finestra del rullo
    defs += `<clipPath id="${cid}"><rect x="${x - 50}" y="${WY}" width="100" height="${WH}"/></clipPath>`;

    // Striscia: simboli random + risultato finale in fondo
    const strip = Array.from({ length: FILLERS }, () =>
      ICONS[Math.floor(Math.random() * ICONS.length)]
    );
    strip.push(results[i]);

    let texts = '';
    for (let j = 0; j < strip.length; j++) {
      // Risultato (ultimo) a BY quando translateY=0; gli altri sopra
      const y = BY - (strip.length - 1 - j) * SH;
      texts += `<text x="${x}" y="${y}" text-anchor="middle" font-size="50" font-family="sans-serif">${strip[j]}</text>`;
    }

    // Animazione: scroll veloce → overshoot → bounce → fermo
    css += `@keyframes ${aid}{` +
      `0%{transform:translateY(${scroll}px)}` +
      `88%{transform:translateY(-12px)}` +
      `96%{transform:translateY(4px)}` +
      `100%{transform:translateY(0)}}`;

    reelsSvg += `<g clip-path="url(#${cid})">` +
      `<g style="animation:${aid} ${DUR[i]}s cubic-bezier(.1,.7,.3,1) forwards">` +
      texts + `</g></g>`;
  }

  // Effetto jackpot lampeggiante
  const jpCss = isJackpot
    ? `@keyframes j${uid}{0%,100%{opacity:0}50%{opacity:.35}}`
    : '';
  const jpEl = isJackpot
    ? `<rect x="20" y="${WY}" width="360" height="${WH}" rx="8" fill="gold" ` +
      `style="animation:j${uid} .6s ${DUR[2] + 0.3}s infinite;opacity:0"/>`
    : '';

  // Testo risultato (appare dopo che l'ultimo rullo si ferma)
  const resultLabel = isJackpot ? '🏆 JACKPOT! 🏆' : 'Tenta la fortuna!';
  const resultColor = isJackpot ? '#ffd700' : '#e94560';
  const fadeCss = `@keyframes f${uid}{from{opacity:0}to{opacity:1}}`;

  return `<svg width="400" height="195" xmlns="http://www.w3.org/2000/svg">
<defs>${defs}</defs>
<style>${css}${jpCss}${fadeCss}</style>
<rect width="400" height="195" rx="18" fill="#1a1a2e"/>
<rect x="4" y="4" width="392" height="187" rx="16" fill="none" stroke="#e94560" stroke-width="2"/>
<text x="200" y="38" text-anchor="middle" font-size="20" font-weight="bold" fill="#e94560" font-family="sans-serif">🎰 SLOT MACHINE 🎰</text>
<line x1="30" y1="47" x2="370" y2="47" stroke="#e94560" stroke-width="1" opacity=".3"/>
<rect x="22" y="${WY}" width="106" height="${WH}" rx="8" fill="#0f0f23"/>
<rect x="147" y="${WY}" width="106" height="${WH}" rx="8" fill="#0f0f23"/>
<rect x="272" y="${WY}" width="106" height="${WH}" rx="8" fill="#0f0f23"/>
${reelsSvg}
<rect x="22" y="${WY}" width="106" height="${WH}" rx="8" fill="none" stroke="#e94560" stroke-width="1.5"/>
<rect x="147" y="${WY}" width="106" height="${WH}" rx="8" fill="none" stroke="#e94560" stroke-width="1.5"/>
<rect x="272" y="${WY}" width="106" height="${WH}" rx="8" fill="none" stroke="#e94560" stroke-width="1.5"/>
${jpEl}
<text x="200" y="170" text-anchor="middle" font-size="14" fill="${resultColor}" font-family="sans-serif" style="animation:f${uid} .5s ${DUR[2] + 0.2}s both;opacity:0">${resultLabel}</text>
<text x="200" y="189" text-anchor="middle" font-size="10" fill="#444" font-family="sans-serif">github.com/simrim96</text>
</svg>`;
}
