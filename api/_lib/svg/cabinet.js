// ─── Cabinet Generator ───────────────────────────────────────────────────────────
// Genera il cabinet esterno della slot machine

import { SVG_W, SVG_H } from './constants.js';

export function generateCabinet(uid) {
  let cabinetSvg = '';
  const BODY_Y = 0;
  
  // Corpo principale
  cabinetSvg +=
    `<path d="
       M 24 ${BODY_Y + 24}
       Q 24 ${BODY_Y} 50 ${BODY_Y}
       L ${SVG_W - 50} ${BODY_Y}
       Q ${SVG_W - 24} ${BODY_Y} ${SVG_W - 24} ${BODY_Y + 24}
       L ${SVG_W - 24} ${SVG_H - 22}
       Q ${SVG_W - 24} ${SVG_H} ${SVG_W - 50} ${SVG_H}
       L 50 ${SVG_H}
       Q 24 ${SVG_H} 24 ${SVG_H - 22}
       Z"
       fill="url(#cab${uid})" stroke="#5a0606" stroke-width="2"/>`;
  cabinetSvg +=
    `<path d="
       M 36 ${BODY_Y + 28}
       Q 36 ${BODY_Y + 8} 60 ${BODY_Y + 8}
       L ${SVG_W - 60} ${BODY_Y + 8}
       Q ${SVG_W - 36} ${BODY_Y + 8} ${SVG_W - 36} ${BODY_Y + 28}
       L ${SVG_W - 36} ${BODY_Y + 56}
       L 36 ${BODY_Y + 56} Z"
       fill="url(#cabHi${uid})"/>`;
  
  // Pinstripe dorata
  cabinetSvg +=
    `<path d="
       M 32 ${BODY_Y + 26}
       Q 32 ${BODY_Y + 4} 54 ${BODY_Y + 4}
       L ${SVG_W - 54} ${BODY_Y + 4}
       Q ${SVG_W - 32} ${BODY_Y + 4} ${SVG_W - 32} ${BODY_Y + 26}
       L ${SVG_W - 32} ${SVG_H - 24}
       Q ${SVG_W - 32} ${SVG_H - 4} ${SVG_W - 54} ${SVG_H - 4}
       L 54 ${SVG_H - 4}
       Q 32 ${SVG_H - 4} 32 ${SVG_H - 24} Z"
       fill="none" stroke="#ffd84a" stroke-width="0.8" opacity="0.55"/>`;
  
  // Riflessi laterali
  cabinetSvg +=
    `<rect x="30" y="${BODY_Y + 30}" width="3" height="${SVG_H - 60}" rx="1.5"
           fill="#ffffff" opacity="0.10"/>` +
    `<rect x="${SVG_W - 33}" y="${BODY_Y + 30}" width="3" height="${SVG_H - 60}" rx="1.5"
           fill="#000000" opacity="0.18"/>`;
  
  // Borchie decorative
  const studs = [
    [42, BODY_Y + 18], [SVG_W - 42, BODY_Y + 18],
    [42, SVG_H - 18],  [SVG_W - 42, SVG_H - 18],
  ];
  for (const [sx, sy] of studs) {
    cabinetSvg +=
      `<circle cx="${sx}" cy="${sy}" r="3.5" fill="url(#frame${uid})" stroke="#7a4400" stroke-width="0.8"/>` +
      `<circle cx="${sx - 0.8}" cy="${sy - 0.8}" r="1.2" fill="#fff5b8" opacity="0.85"/>`;
  }
  
  return cabinetSvg;
}
