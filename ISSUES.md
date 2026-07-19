# ISSUES.md — Analisi del progetto GithubSlotMachine

Data analisi: 18 luglio 2026
Scope: architettura runtime (Vercel serverless + Upstash Redis + GitHub Contents API),
logica di gioco, persistenza stato, caching repo, sicurezza CORS/open-redirect.

Stato dei check automatici (aggiornato al commit corrente):
- `npx vitest run` → 139 test passati (16 file), nessun fallimento.
- `npx eslint .` → 0 problemi segnalati.
- `npm audit --audit-level=moderate` → 31 vulnerabilità (2 low, 12 moderate, 17 high),
  quasi tutte transitive dentro la dependency tree di `vercel` (undici, tar, smol-toml).

NOTA: i test verdi non coprono i bug critici sotto, perché i casi limite non sono
testati (vedi "Copertura dei test" in fondo).


================================================================================
## BASSI / MANUTENZIONE
================================================================================

### ISSUE-4  [BASSO] MIGRATIONS[2] placeholder crea stato "ahead" (v3 > STATE_VERSION=2)
File: `api/_lib/state.js` — `MIGRATIONS[2]` (righe ~63-73)

La migrazione per v2→v3 è un placeholder che setta `version: 3`, ma
`STATE_VERSION` è 2. Se mai raggiunta, produce uno stato con versione superiore
a quella corrente, rompendo il confronto `currentVersion < STATE_VERSION` in
`readState`. Va rimossa finché non serve davvero una v3.

--------------------------------------------------------------------------------
### ISSUE-5  [BASSO] config-loader: YAML non veramente supportato in produzione
File: `api/_lib/config-loader.js` — `loadYAML()` (righe ~44-55)

Usa `await import('yaml')` ma `yaml` NON è nelle `dependencies` di package.json.
In produzione l'import fallisce → ritorna `null` silenziosamente → i file
`.yaml`/`.yml` di lingue esterne vengono ignorati senza errore chiaro. La
documentazione promette il supporto YAML.

Fix: aggiungere `yaml` alle `dependencies` oppure rimuovere il riferimento YAML
da README/doc.

--------------------------------------------------------------------------------
### ISSUE-6  [BASSO] health.js stampa mezzo header Authorization nel log
File: `api/health.js` — riga 72

    Authorization: *** ' + token,

È un typo/concatenazione errata: il prefisso letterale `'*** '` viene unito al
token invece di `'Bearer ' + token` (o meglio, di non logarlo affatto). Così il
log mostra comunque il token PAT in chiaro nei log di diagnostica. Anche se è
solo su `/api/health`, è una fuoriuscita di segreto nei log.

Fix: non loggare MAI il token. Usare `Authorization: *** ${token}\`` nelle
request e non stamparlo. Controllare anche `github.js`/`state.js` (leggi
il file per i dettagli del mask — nel source qui presente il token è
correttamente mascherato come `Bearer ***`, ma in health.js il concat è rotto).

--------------------------------------------------------------------------------
### ISSUE-7  [BASSO] file runtime (slot.svg, state.json) nel repo ma gitignati solo parzialmente
File: `.gitignore` (righe 23-24) + root

`slot.svg` e `state.json` sono gitignati (giusto: cambiano a ogni spin), ma
sono PRESENTI nella working dir (committati? no, ignorati). Il `.gitignore`
ignora `state.json` ma NON `/tmp/GithubSlotMachine_state.json` (che è fuori repo,
ok). Piccolo rischio: se qualcuno fa `git add -f`, ricomincia a sporcare la
history. Verificare che non siano mai stati committati (al momento non lo sono).

--------------------------------------------------------------------------------
### ISSUE-8  [BASSO] dipendenze vulnerabilities (31, di cui 17 high)
`npm audit` riporta 31 vulnerabilità, quasi tutte transitive dentro `vercel`
(undici <=6.26.0: header injection, request smuggling, DoS WebSocket; tar
<=7.5.15: path traversal all'estrazione; smol-toml via @vercel/rust).

Fix:
- `npm audit fix` (non-breaking) per tar/smol-toml dove possibile.
- Per undici/vercel servirebbe `npm audit fix --force` che porta `vercel` a
  una major diversa (breaking, attenzione al deploy). Valutare l'aggiornamento
  di `vercel` alla versione più recente in un commit dedicato con test e2e.
Nota: queste vulnerabilità impattano principalmente il CLI di dev/build, non il
runtime serverless, ma vanno comunque risolte prima di un rilascio ufficiale.

================================================================================
## COPERTURA DEI TEST / BUCHE
================================================================================

- `tests/state-migration.test.js` ora copre `migrateState` con stato v1 (v1→v2), verifica terminazione entro 3s e schema corretto. BUCA COLMATA (ex ISSUE-1).
- BUCA COLMATA (ex ISSUE-2a image.js): `image.js` ora usa `kvGet` da `./_lib/kv.js` (con timeout), rimuovendo la chiamata diretta `kv.get`. Test mancante su `image.js` ancora da aggiungere per prevenire regressioni.
- BUCA COLMATA (ex ISSUE-3, repos.js): `tests/repos.test.js` ora copre timeout (AbortController + GITHUB_API_TIMEOUT_MS), concorrenza limitata a batch da 20, ed errore catturato su fetch fallita, con fetch GitHub simulata.
- `config-loader` è testato ma solo lato unit; il caricamento YAML reale senza
  il package `yaml` non è coperto da nessun check di integrazione (ISSUE-5).
- Resta da aggiungere un test su `image.js` per prevenire regressioni (vedi sopra).

================================================================================
## RIEPILOGO PRIORITÀ
================================================================================
1. ISSUE-4..8 (basso) — pulizia, segreti nei log, audit dep
