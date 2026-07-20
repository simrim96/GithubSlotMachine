// Endpoint immagine della slot.
//
// Restituisce lo slot.svg "vivo" (quello generato dall'ultimo spin). Priorità:
//   1. Upstash Redis (kv:gsm:slotSvg) — velocissimo, elimina il GET su GitHub
//      che prima aggiungeva 150-400ms ogni caricamento.
//   2. Fallback: legge slot.svg dal repo REMOTO via GitHub Contents API
//      (per dev locale / Redis non configurato). Non legge dal filesystem
//      locale (vedi ISSUE-7 — la copia locale è solo un artefatto ignorato).
//
// Legge SLOT_OWNER / SLOT_REPO dalle env var come fa spin.js
// (default: simrim96 / GithubSlotMachine se le env non sono impostate).

import { kvGet, kvEnabled } from './_lib/kv.js';
import { ghHeaders } from './_lib/github.js';
import { applyCorsWildcard } from './_lib/cors.js';
import { errorSVGString } from './_lib/svg-builder.js';
import * as Sentry from '@sentry/node';

const SVG_PATH = 'slot.svg';

export default async function handler(req, res) {
  const user = process.env.SLOT_OWNER || 'simrim96';
  const repo = process.env.SLOT_REPO || 'GithubSlotMachine';
  const token = process.env.GITHUB_PAT || '';

  // ── CORS + preflight (ISSUE-25: wildcard `*`, l'SVG è embeddato
  //    cross-origin su github.com e altri domini non deterministici) ──
  applyCorsWildcard(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (kvEnabled) {
    try {
      const svg = await kvGet('gsm:slotSvg');
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
  // ISSUE-24: se `r.ok` è true ma `data.content` è assente (repo esistente ma
  // slot.svg vuoto / risposta inattesa), `Buffer.from(undefined)` lancia.
  // In tal caso servi un SVG di degrado invece di crashare.
  if (!data || !data.content) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(errorSVGString({ owner: user, message: 'Slot image unavailable' }));
  }
  const svg = Buffer.from(data.content, 'base64').toString('utf-8');
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(svg);
}
