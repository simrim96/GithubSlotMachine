// Endpoint immagine della slot.
//
// Restituisce lo slot.svg "vivo" (quello generato dall'ultimo spin). Priorità:
//   1. Upstash Redis (kv:gsm:slotSvg) — velocissimo, elimina il GET su GitHub
//      che prima aggiungeva 150-400ms ogni caricamento.
//   2. Fallback: legge slot.svg dal repo (per dev locale / Redis non configurato).
//
// Fork-aware: legge SLOT_OWNER / SLOT_REPO dalle env var come fa spin.js
// (default: simrim96 / GithubSlotMachine se le env non sono impostate).

import { kv, kvEnabled } from './_lib/kv.js';
import * as Sentry from '@sentry/node';

const SVG_PATH = 'slot.svg';

function ghHeaders(token) {
  const h = { 'User-Agent': 'GithubSlotMachine' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default async function handler(req, res) {
  const user = process.env.SLOT_OWNER || 'simrim96';
  const repo = process.env.SLOT_REPO || 'GithubSlotMachine';
  const token = process.env.GITHUB_PAT || '';

  if (kvEnabled) {
    try {
      const svg = await kv.get('gsm:slotSvg');
      if (svg) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(svg);
      }
    } catch (e) {
      Sentry.captureException(e);
      console.warn('kv image read failed, falling back to github:', e.message);
    }
  }

  // Fallback: leggi slot.svg dal repo.
  const r = await fetch(
    `https://api.github.com/repos/${user}/${repo}/contents/${SVG_PATH}`,
    { headers: ghHeaders(token) }
  );
  if (!r.ok) return res.status(r.status).send('Slot image not found');
  const data = await r.json();
  const svg = Buffer.from(data.content, 'base64').toString('utf-8');
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(svg);
}
