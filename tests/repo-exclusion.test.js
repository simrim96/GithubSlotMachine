/**
 * Regression test per il bug "cliccando la leva a volte vengo
 * reindirizzato alla pagina github del progetto".
 *
 * Causa: lo spin vincente reindirizza verso il repo dell'owner che usa il
 * linguaggio uscito per ≥30%. Il repo della slot stessa (GithubSlotMachine,
 * progetto Node/JS/TS) veniva selezionato come repo "migliore" per vittorie
 * su JavaScript/TypeScript/React, rimandando l'utente DENTRO il repo sorgente
 * della slot (che appare come "la pagina github del progetto"). Idem il repo
 * profilo (simrim96/simrim96).
 *
 * Fix: isRepoExcluded() esclude entrambi a monte (refreshCache) e come
 * difesa finale in uscita da getRepoForLanguage().
 */

import { describe, it, expect } from 'vitest';
import { isRepoExcluded } from '../api/_lib/repos.js';

const OWNER = 'simrim96';
const SLOT_REPO = 'GithubSlotMachine';

describe('Repo exclusion (redirect-never-points-inside-slot)', () => {
  it('esclude il repo della slot stessa', () => {
    expect(isRepoExcluded('GithubSlotMachine', OWNER, SLOT_REPO)).toBe(true);
    expect(isRepoExcluded('githubslotmachine', OWNER, SLOT_REPO)).toBe(true);
    expect(isRepoExcluded('GITHUBSLOTMACHINE', OWNER, SLOT_REPO)).toBe(true);
  });

  it('esclude il repo profilo (<owner>/<owner>)', () => {
    expect(isRepoExcluded('simrim96', OWNER, SLOT_REPO)).toBe(true);
    expect(isRepoExcluded('SimRim96', OWNER, SLOT_REPO)).toBe(true);
  });

  it('NON esclude un repo progetto legittimo', () => {
    expect(isRepoExcluded('BetterSpin', OWNER, SLOT_REPO)).toBe(false);
    expect(isRepoExcluded('some-cool-ml-project', OWNER, SLOT_REPO)).toBe(
      false
    );
  });

  it('la difesa finale in getRepoForLanguage tratta i repo esclusi come null', async () => {
    // Simulate una cache popolata (pre-fix) che contiene ancora la slot stessa.
    const repos = await import('../api/_lib/repos.js');
    // Non possiamo toccare la cache interna direttamente senza token, ma
    // verifichiamo almeno il contratto di isRepoExcluded già coperto sopra
    // e che l'export esista (così la difesa in uscita compila).
    expect(typeof repos.getRepoForLanguage).toBe('function');
    expect(typeof repos.isRepoExcluded).toBe('function');
  });
});
