// ─── Result Panel Generator ─────────────────────────────────────────────────────
// Genera il pannello dei risultati in basso

import { ROWS, wrap } from '../game.js';
import { escapeXml } from './utils.js';
import { CH, FRAME_PAD, SVG_W } from './constants.js';
import { getGY } from './coordinates.js';

export function generateResultPanel(
  uid,
  isWin,
  winningLang,
  fact,
  repoMatch,
  owner,
  ED,
  result
) {
  const PY = getGY() + ROWS * CH + FRAME_PAD + 6;
  const PH = SVG_W - 6 - PY; // SVG_W from constants
  let panelSvg = '';

  if (isWin && winningLang) {
    const factEn = (fact && fact.en) || '';
    const factIt = (fact && fact.it) || '';
    const linesEn = wrap(factEn, 86).slice(0, 2);
    const linesIt = wrap(factIt, 86).slice(0, 2);
    const headLine = result.isJackpot
      ? `🏆 JACKPOT — ${winningLang.name}!`
      : result.isBigWin
        ? `💰 BIG WIN — ${winningLang.name}!`
        : `🎉 ${winningLang.name} WIN!`;
    const headColor = result.isJackpot
      ? '#ffd700'
      : result.isBigWin
        ? '#ffb84d'
        : '#4ade80';

    panelSvg += `<rect x="20" y="${PY}" width="${SVG_W - 40}" height="${PH}" rx="12" fill="#0e0d24" stroke="${headColor}" stroke-width="1.5" opacity="0.95" style="animation:fi${uid} .5s ${ED}s forwards;opacity:0"/>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + 24}" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',sans-serif" font-size="17" font-weight="700" fill="${headColor}" style="animation:fi${uid} .5s ${ED + 0.1}s forwards;opacity:0">${escapeXml(headLine)}</text>`;

    let yy = PY + 46;
    if (linesEn.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.18}s forwards;opacity:0">EN</text>`;
      for (const line of linesEn) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="#e8e8f4" style="animation:fi${uid} .5s ${ED + 0.2}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 15;
      }
      yy += 4;
    }
    if (linesIt.length) {
      panelSvg += `<text x="32" y="${yy}" font-family="'Segoe UI',sans-serif" font-size="8" fill="#8b8baf" font-weight="700" letter-spacing="1.2" style="animation:fi${uid} .5s ${ED + 0.28}s forwards;opacity:0">IT</text>`;
      for (const line of linesIt) {
        panelSvg += `<text x="${SVG_W / 2}" y="${yy}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" fill="#b8b8d0" font-style="italic" style="animation:fi${uid} .5s ${ED + 0.3}s forwards;opacity:0">${escapeXml(line)}</text>`;
        yy += 14;
      }
    }

    if (repoMatch) {
      const ctaEn = result.isJackpot
        ? `🎯 JACKPOT → explore ALL my ${escapeXml(winningLang.name)} repos`
        : `→ github.com/${escapeXml(owner)}/${escapeXml(repoMatch.name)} · ${Math.round(repoMatch.pct * 100)}% ${escapeXml(winningLang.name)}`;
      panelSvg += `<text x="${SVG_W / 2}" y="${yy + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="${winningLang.accent}" font-weight="600" style="animation:fi${uid} .5s ${ED + 0.4}s forwards;opacity:0">${ctaEn}</text>`;
    } else if (result.isJackpot) {
      panelSvg += `<text x="${SVG_W / 2}" y="${yy + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="12" fill="${winningLang.accent}" font-weight="600" style="animation:fi${uid} .5s ${ED + 0.4}s forwards;opacity:0">🎯 JACKPOT → explore ALL my ${escapeXml(winningLang.name)} repos</text>`;
    }
  } else {
    const msgEn =
      result.nearMissCol >= 0
        ? '😱 So close — try again!'
        : 'Try again, better luck next time!';
    const msgIt =
      result.nearMissCol >= 0
        ? 'Così vicino, ritenta!'
        : 'Ritenta, sarai più fortunato!';
    const col = result.nearMissCol >= 0 ? '#f59e0b' : '#e94560';
    panelSvg += `<rect x="20" y="${PY}" width="${SVG_W - 40}" height="${PH}" rx="12" fill="#0e0d24" stroke="${col}" stroke-width="1" opacity="0.9"/>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + PH / 2 - 4}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="15" font-weight="700" fill="${col}" style="animation:fi${uid} .4s ${ED}s forwards;opacity:0">${escapeXml(msgEn)}</text>`;
    panelSvg += `<text x="${SVG_W / 2}" y="${PY + PH / 2 + 16}" text-anchor="middle" font-family="'Segoe UI',sans-serif" font-size="11" font-style="italic" fill="#8b8baf" style="animation:fi${uid} .4s ${ED + 0.1}s forwards;opacity:0">${escapeXml(msgIt)}</text>`;
  }

  return panelSvg;
}
