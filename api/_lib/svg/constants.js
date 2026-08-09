// ─── SVG Constants & Configuration ──────────────────────────────────────────────
// Valori fissi per la generazione SVG

export const CW = 84;
export const CH = 84;
export const GAP = 8;
export const SVG_W = 600;
export const SVG_H = 624;
export const HDR_H = 64;
export const HDR_TOP = 2;
export const PT_H = 92;
export const PT_Y = HDR_TOP + HDR_H + 4;
// La paytable VERA parte 8px più in basso di PT_Y: i valori dei contatori
// SPINS/WINS (baseline y=70, bbox reale ~57..73 col font di sistema) si
// sovrapponevano al bordo superiore del pannello (stroke #4ecdc4, "area
// blu"). PT_Y resta l'ancora per GY (rulli): il resto della macchina non
// si muove, cambia solo la paytable.
export const PT_PANEL_Y = PT_Y + 8;
export const FRAME_PAD = 22;
export const FILLERS = 18;
export const DUR = [3.0, 3.8, 4.6, 5.4, 6.2];
