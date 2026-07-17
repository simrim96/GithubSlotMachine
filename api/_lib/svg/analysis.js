// ─── Result Analysis ────────────────────────────────────────────────────────────
// Analizza i risultati della slot e determina win/near-miss/jackpot

import { checkWins, detectNearMiss, COLS } from '../game.js';
import { DUR, NM_DUR_EXTRA_LAST } from './constants.js';

export function analyzeResult(grid, state, winningLang) {
  const wins = checkWins(grid);
  const nearMissCol = detectNearMiss(grid, wins);
  const winCells = [];
  const isWin = wins.length > 0;
  const maxWin = wins.length > 0 ? Math.max(...wins.map((w) => w.count)) : 0;
  const isJackpot = wins.some((w) => w.count === 5);
  const isBigWin = maxWin >= 4 && !isJackpot;
  
  const bestWin = isWin ? wins.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  if (bestWin) {
    for (const p of bestWin.positions) {
      winCells.push(`${p.c},${p.r}`);
    }
  }
  
  const LDUR = DUR[COLS - 1];
  const ED = LDUR + (nearMissCol === COLS - 1 ? NM_DUR_EXTRA_LAST : 0) + 0.4;
  
  const totalSpins = (state?.totalSpins || 0).toLocaleString('en-US');
  const totalWins = (state?.totalWins || 0).toLocaleString('en-US');
  const resultStatus = isJackpot ? 'jackpot' : isWin ? 'win' : (nearMissCol >= 0 ? 'near-miss' : 'no-win');
  const resultMessage = isJackpot ? `🏆 JACKPOT — ${winningLang?.name || ''}!`
                  : isBigWin ? `💰 BIG WIN — ${winningLang?.name || ''}!`
                  : isWin ? `🎉 ${winningLang?.name || ''} WIN!`
                  : nearMissCol >= 0 ? '😱 So close — try again!'
                  : 'Try again, better luck next time!';
  const ariaLabel = `Dev Stack Slot Machine. ${resultMessage} Total spins: ${totalSpins}, total wins: ${totalWins}.`;
  
  return { wins, nearMissCol, isJackpot, isBigWin, isWin, winCells, ED, ariaLabel, resultStatus };
}
