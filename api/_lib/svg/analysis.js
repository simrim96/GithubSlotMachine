// ─── Result Analysis ────────────────────────────────────────────────────────────
// Analizza i risultati della slot e determina win/big-win.
// NOTA: near-miss e jackpot sono stati RIMOSSI su richiesta. Il rullo gira
// normalmente (nessun effetto "quasi vinto") e ogni vincita è "normale"
// (mai jackpot).

import { checkWins, COLS } from '../game.js';
import { DUR } from './constants.js';

import { escapeXml } from './utils.js';

export function analyzeResult(grid, state, winningLang) {
  const wins = checkWins(grid);
  // (RIMOSSO) near-miss disattivato: il rullo gira normalmente.
  // (RIMOSSO) jackpot disattivato: ogni vincita è "normale", mai jackpot.
  const winCells = [];
  const isWin = wins.length > 0;
  const maxWin = wins.length > 0 ? Math.max(...wins.map((w) => w.count)) : 0;
  const isBigWin = maxWin >= 4;

  const bestWin = isWin
    ? wins.reduce((a, b) => (b.count > a.count ? b : a))
    : null;
  if (bestWin) {
    for (const p of bestWin.positions) {
      winCells.push(`${p.c},${p.r}`);
    }
  }

  const LDUR = DUR[COLS - 1];
  const ED = LDUR + 0.4;

  const totalSpins = (state?.totalSpins || 0).toLocaleString('en-US');
  const totalWins = (state?.totalWins || 0).toLocaleString('en-US');
  const resultStatus = isWin ? 'win' : 'no-win';
  const langName = escapeXml(winningLang?.name || '');
  const resultMessage = isBigWin
    ? `💰 BIG WIN — ${langName}!`
    : isWin
      ? `🎉 ${langName} WIN!`
      : 'Try again, better luck next time!';
  const ariaLabel = `Dev Stack Slot Machine. ${resultMessage} Total spins: ${totalSpins}, total wins: ${totalWins}.`;

  return {
    wins,
    isBigWin,
    isWin,
    winCells,
    ED,
    ariaLabel,
    resultStatus,
  };
}
