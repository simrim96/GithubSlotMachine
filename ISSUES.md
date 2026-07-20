# ISSUES.md — Analisi tecnica del progetto GithubSlotMachine

_Generato il 2026-07-20 da analisi statica + verifica runtime (Node 18+)._
_Metodologia: lettura di tutti i moduli in `api/` e `api/_lib/`, `sentry.config.js`,
`vercel.json`, `.eslintrc.json`, `.github/workflows/ci.yml`, `.gitignore`; esecuzione
della suite `vitest` (227 test, tutti verdi) e import runtime di `languages.js`._

> Nota di metodo: il file `README.md` è parzialmente obsoleto (vedi D1) e NON è stato
> usato come fonte di verità. Tutti i punti sotto citano il codice effettivo.

---

## Indice delle priorità

| ID  | Area            | Gravità | Titolo breve |
|-----|-----------------|---------|--------------|
| S2  | Sicurezza       | P1      | Nessun rate-limit per-IP su `/api/spin` (esaurimento budget GitHub) |
| D1  | Documentazione  | P1      | README.md obsoleto (struttura, simboli, env vars) |
| R5  | Affidabilità    | P1      | Spin senza repo se Upstash è cross-region (timeout 800ms) |
| S1  | Sicurezza       | P2      | Redirect `explain` con blocklist di host arbitraria (non allowlist) |
| R4  | Affidabilità    | P2      | `ghGetContents` senza timeout esplicito (possibile hang) |
| M1  | Manutenibilità  | P2      | Stile handler misto: `(req,res)` vs `new Response()` |
| B1  | Bug             | P2      | `continueSpin` codice morto (e con bug latente) |
| M5  | Manutenibilità  | P2      | Costanti duplicate `REPO_LANG_BATCH_SIZE` / `REPO_LANG_CONCURRENCY` |
| P1  | Performance     | P2      | README GitHub letta a ogni spin (+150–400ms) non cacheata in KV |
| S3  | Sicurezza       | P2      | Wildcard CORS su `/api/image` e `/api/lever` (tradeoff noto, da sanitizzare) |
| T1  | Testing         | P2      | Mancano test end-to-end di `spin.js` con mock KV/GitHub |
| T3  | Testing         | P2      | Script one-off `verify-issue*.mjs` in root (clutter) |
| R2  | Affidabilità    | P2      | Sync state.json su GitHub: nessun retry/backoff, diverge se GitHub down |
| D2/D3| Documentazione | P2      | README non documenta contratto API né registro ISSUE-N |
| B2  | Bug             | P3      | `continueSpin` accede a `grid[i][COLS]` fuori range |
| B4  | Bug             | P3      | `image.js` 404 in chiaro senza content-type/Sentry |
| B5  | Bug             | P3      | `cacheTtl` in `spin.js` calcolato ma mai usato |
| M2  | Manutenibilità  | P3      | Variabile `fs` = `fs/promises` (ingannevole) in `state.js` |
| M4  | Manutenibilità  | P3      | Nomi confusionari minori |
| R3  | Affidabilità    | P3      | Scritture KV silenziose in read-only mode |
| O2/O3| Operatività    | P3      | Sentry error sampling 1.0; logger non strutturato |

---

## 1. Bug / Correttezza

### B1 — `continueSpin` è codice morto  · P2
`api/_lib/game.js` esporta `continueSpin`, ma `grep -rn continueSpin` su tutto il
repo (escluso `node_modules`) NON trova alcun riferimento: non è mai importato né
chiamato. Aumenta la superficie di manutenzione e confonde chi legge (sembra la
continuazione logica dello spin, ma non lo è).
**Fix:** rimuovere l'export e la funzione.

### B2 — `continueSpin` ha un bug latente (indice fuori range)  · P3
Nella funzione (morta) `continueSpin` di `game.js`:
```js
for (let i = 0; i < grid.length; i++) {
  reps.push(grid[i][COLS]);   // COLS = num colonne; indice valido 0..COLS-1
}
```
`grid[i][COLS]` accede alla colonna *oltre* l'ultima (`COLS` è la lunghezza, non un
indice valido) → `undefined`. Se la funzione venisse mai attivata, produrrebbe
rulli vuoti. (Risolto di conseguenza rimuovendo la funzione — vedi B1.)

### B4 — `image.js` risponde 404 in chiaro  · P3
`api/image.js`:
```js
if (!r.ok) return res.status(r.status).send('Slot image not found');
```
Nessun `Content-Type` impostato e nessun `Sentry.captureException`. In caso di
errore GitHub il client riceve testo senza tipo, e l'evento non finisce in Sentry.
**Fix:** impostare `Content-Type: text/plain`, catturare l'errore in Sentry e
servire l'`errorSVGString` di degrado come negli altri path.

### B5 — `cacheTtl` calcolato ma mai usato in `spin.js`  · P3
`api/spin.js` calcola `const cacheTtl = parseLocationHeader(...)` ma la variabile
non viene mai utilizzata (solo `cacheHeader`/`ageHeader` servono per il log).
Variabile morta; segnalata anche da lint in modalità `error`.
**Fix:** rimuovere `cacheTtl` (e `parseLocationHeader` se non usato altrove).

---

## 2. Sicurezza

### S2 — Nessun rate-limit per-IP su `/api/spin`  · P1  (ISSUE-1)
Lo spin legge la README GitHub e (se PAT presente) sincronizza `state.json`. Non
esiste alcun throttle per IP. Un attaccante può inviare centinaia di richieste al
secondo ed esaurire il budget GitHub API autenticato (5000/h) → la slot smette di
funzionare per TUTTI gli utenti. La suite `tests/cors-ratelimit.test.js` lo
conferma esplicitamente: spin ripetuti dello stesso IP non producono MAI 429.
**Fix:** token-bucket per IP in KV (`gsm:ratelimit:<ip_hash>`) con finestra es.
10 req/min/IP; rispondere `429` con `Retry-After` oltre soglia. Il rate-limit va
applicato PRIMA della chiamata GitHub.

### S1 — Redirect `explain` con blocklist di host arbitraria  · P2
`api/spin.js` valida il parametro `url` dell'`explain` solo contro `BLOCKED_HOSTS`
(`github.io`, `vercel.app`, `raw.githubusercontent.com`, `localhost`, `127.0.0.1`).
È una blocklist, non un'allowlist: un fork con dominio personalizzato (es.
`myslot.example.com`) non verrebbe bloccato, e la blocklist non è allineata con i
dominii reali di deploy (`~owner.github.io`, dominio Vercel). Open-redirect verso
host non previsti è teoricamente possibile.
**Fix:** invertire la logica → allowlist derivata da env (`SLOT_ALLOWED_HOSTS`),
con default al solo dominio di deploy della slot. Validare anche protocollo
(https) e path atteso (`/?l=...`).

### S3 — Wildcard CORS su `/api/image` e `/api/lever`  · P2  (ISSUE-25)
`applyCorsWildcard('*')` su entrambi gli endpoint. È INTENZIONALE (l'SVG è
embeddato cross-origin su `github.com` e domini non deterministici) e documentato
nel codice, quindi è un tradeoff accettabile — ma l'SVG servito come
`image/svg+xml` con origine `*` dovrebbe essere sanificato in uscita per evitare
che eventuali injection future (oggi l'SVG è generato internamente, non da input
utente) diventino eseguibili. Rischio attuale: BASSO.
**Fix:** mantenere il wildcard solo se necessario, ma introdurre una funzione di
sanitizzazione SVG (strip di `<script>`/`on*`/`<foreignObject>`) applicata a
`buildSVG`/`errorSVGString`.

### S4 — `GITHUB_PAT` con scope ampio  · P3  (hardening)
Il token è usato per leggere la README (`contents:read`) e scrivere `state.json`
(`contents:write`) sul repo del profilo. Se il token è un PAT classico con scope
`repo`, espone tutti i repo dell'utente in caso di leak.
**Fix:** usare un **fine-grained token** con permessi solo sul repo `simrim96`
(`Contents: Read and write`), ruotato periodicamente; non serve `repo` globale.

---

## 3. Affidabilità / Resilienza

### R5 — Spin senza repo se Upstash è cross-region  · P1
`getRepoForLanguage` (`api/_lib/repos.js`) ha un timeout globale di **800ms**
(AbortController). Se Upstash/Redis è in una region diversa da Vercel (`fra1` in
`vercel.json`), il round-trip supera 800ms e TUTTE le ricerche repo abortiscono →
lo spin cade nel fallback "nessun repo". `api/health.js` esiste proprio per
diagnosticare questo caso (`kv_roundtrip_ms > 60` → "LENTO: cross-region").
**Fix:** creare il DB Upstash nella stessa region `fra1` di Vercel (documentato in
`health.js` ma non nell'ops). Aggiungere un fallback a cache KV "tiered" (repo
recenti sempre disponibili anche a cold start).

### R4 — `ghGetContents` senza timeout esplicito  · P2
`api/_lib/state.js` → `loadState()` legge da KV (timeout 500ms via `kvGet`) ma, se
KV è disabilitato, legge `state.json` dal repo remoto tramite `ghGet`/`ghGetContents`
**senza AbortController**. Se GitHub è lento, lo spin si blocca in attesa della
risposta GitHub (nessun tetto).
**Fix:** avvolgere `ghGetContents` in un `AbortController` con timeout (es. 800ms),
coerente con `repos.js`.

### R2 — Sync `state.json` su GitHub senza retry  · P2
`api/_lib/state.js` → `syncStateToGitHub` è fire-and-forget e, dopo 5 fallimenti
consecutivi, invia solo un alert Sentry (`SENTRY_ALERT_THRESHOLD`). Non c'è
backoff né retry: se GitHub è down a lungo, `state.json` diverge permanentemente
dallo stato live senza possibilità di recupero automatico.
**Fix:** retry con backoff esponenziale (max 3 tentativi) e, in caso di fallimento
persistente, scrivere un marker `state.json.stale` o un campo `"stale": true` nel
prossimo sync riuscito, così il frontend può segnalarlo.

### R3 — Scritture KV silenziose in read-only mode  · P3
Se è presente solo `KV_REST_API_READ_ONLY_TOKEN` (`kvWritable === false`), le
scritture falliscono silenziosamente (solo `console.warn` in `kv.js`). Comportamento
accettabile, ma va documentato nel deploy (già fatto in `health.js`). Nessun
cambiamento richiesto, solo consapevolezza operativa.

---

## 4. Performance

### P1 — README GitHub letta a ogni spin  · P2
Quando `GITHUB_PAT` è configurato, `spin.js` fa un `GET /readme` a GitHub a OGNI
spin (stimato +150–400ms). L'endpoint `/api/image` ha già una cache KV
(`gsm:slotSvg`), ma lo spin non cachea la README.
**Fix:** cacheare la README in KV con TTL breve (es. 60s, `gsm:readme:<owner>`);
invalidare alla scrittura di `state.json`.

### R5 (vedi sopra) — concorrenza repo: batch size 20 (OK)
`REPO_LANG_CONCURRENCY` limita a 20 richieste parallele; con 8 lingue il primo spin
cold fa 8 chiamate gestite. Non è un problema, ma il valore va reso coerente con
`REPO_LANG_BATCH_SIZE` (vedi M5).

---

## 5. Manutenibilità

### M1 — Stile handler misto  · P2
`spin.js`, `health.js`, `image.js`, `lever.js` usano la firma Node/Vercel
`(req, res)`; `ratelimit-status.js` usa invece `new Response(...)` (Web API). Su
Vercel entrambi funzionano, ma il misto complica refactoring, middleware condivisi
e testing (i test devono mockare due API diverse).
**Fix:** standardizzare TUTTI gli handler su `export default async (req) =>
new Response(...)` (Web API, direzione futura di Vercel). Spostare la gestione
CORS/status in un wrapper comune.

### M5 — Costanti duplicate in `repos.js`  · P2
`api/_lib/repos.js` definisce `REPO_LANG_BATCH_SIZE` (non usata da nessuna parte) e
`REPO_LANG_CONCURRENCY` (usata). La prima è morta.
**Fix:** rimuovere `REPO_LANG_BATCH_SIZE`; rinominare la seconda in
`REPO_SEARCH_CONCURRENCY` per chiarezza.

### M2 — Nomina ingannevole in `state.js`  · P3
`import { promises as fs } from 'fs'` → la variabile si chiama `fs` ma è in realtà
`fs.promises`. Funziona, ma chi legge si aspetta `fs.readFileSync` sincrono.
**Fix:** rinominare in `fsp` per evidenziare la natura async.

### M4 — Altri nomi confusionari  · P3
- `ghGet`/`ghGetContents`/`ghGetRaw` hanno comportamento simile ma nomi che non
  chiariscono il formato di ritorno (JSON vs raw vs base64).
**Fix:** uniformare i nomi (`ghGetJson`, `ghGetRaw`, `ghGetBase64`) e il tipo di
ritorno documentato.

---

## 6. Documentazione

### D1 — README.md obsoleto  · P1
Il README non riflette l'architettura corrente:
- Riga 47 e 258 citano `languages.js` come file dei **simboli**, ma i simboli sono
  stati spostati in `api/_lib/svg/symbols.js`; `languages.js` ora contiene solo la
  configurazione lingue + caricamento esterno (`languages-external.json`).
- Non documenta la cartella `api/_lib/` né i moduli `kv.js`, `state.js`, `github.js`,
  `repos.js`, `game.js`, `cors.js`, `ratelimit-tracker.js`, `config-loader.js`.
- Le env var non sono tutte elencate: mancano `SLOT_OWNER`, `SLOT_REPO`,
  `GITHUB_PAT` (scopo), `UPSTASH_REDIS_REST_URL/_TOKEN`, `KV_REST_API_URL/_TOKEN`,
  `KV_REST_API_READ_ONLY_TOKEN`, `LOG_LEVEL`, `SENTRY_*`, e la dipendenza di
  regione `fra1` (Upstash deve essere `fra1`).
**Fix:** riscrivere la sezione "Architettura" e "Environment Variables" dal vero
codice; rimuovere i riferimenti a `languages.js` come renderer di simboli.

### D2 — Contratto API non documentato  · P2
Il README non spiega che:
- `/api/spin?l=<lingua>` ritorna un **redirect 302** a `/?l=<lang>&v=<svgVersion>`
  (non un body), e che l'SVG "vivo" si ottiene da `/api/image`.
- Il parametro `explain` abilita la modalità esplora (redirect a `?explain=1`).
- `/api/lever` e `/api/image` servono SVG statici/dinamici.
**Fix:** aggiungere una sezione "API Reference" con esempi di chiamata/risposta.

### D3 — Nessun registro centralizzato degli ISSUE-N  · P2
Il codice referenzia decine di `ISSUE-N` (ISSUE-1 … ISSUE-31) nei commenti, ma non
c'è un indice che colleghi ogni numero alla descrizione. Questo file (`ISSUES.md`)
è il candidato naturale, ma va tenuto allineato: ogni nuovo `ISSUE-N` nel codice
dovrebbe avere qui una voce corrispondente.
**Fix:** adottare la convenzione "ogni `ISSUE-N` nel codice → voce in ISSUES.md"
e aggiungere qui le voci mancanti (es. ISSUE-22 header centralizzati, ISSUE-23
read-only KV, ISSUE-25 wildcard CORS, ISSUE-26 lint gate, ISSUE-31 Sentry debug).

---

## 7. Testing / CI

### T1 — Mancano test end-to-end di `spin.js`  · P2
La suite copre SVG, KV, state, repos, cors, ratelimit — ma NON `spin.js` come
handler (redirect, graceful fallback senza PAT, validazione `explain`). Il bug S1
non sarebbe intercettato da alcun test.
**Fix:** aggiungere `tests/spin.test.js` con `fetch` mockato (GitHub + KV), che
verifichino: redirect 302 con `Location` valido, fallback SVG quando PAT assente,
rifiuto di `url` in blocklist.

### T3 — Script one-off `verify-issue*.mjs` in root  · P2
`verify-issue20.mjs` e `verify-issue21.mjs` sono script di verifica una-tantum,
non test automatizzati, e vivono nella root del repo (clutter, rischiano di essere
committati e di confondere).
**Fix:** spostarli in `tests/` (o `scripts/`) oppure eliminarli se i corrispondenti
`*.test.js` li coprono già.

### T2 — CI OK ma senza integrazione  · P3
`ci.yml` esegue import-smoke + `npm test` + `npm run lint` su Node 18/20/22.
Nessun build/preview Vercel né test contro API reali (giustificabile). La copertura
è buona ma concentrata sulla generazione SVG; mancano test sui percorsi GitHub/KV
(vedi T1).
**Fix:** nessun blocco, ma aggiungere i test di T1 per alzare la copertura dei
percorsi di rete.

---

## 8. Operatività / Deploy

### O1 — Dipendenza di regione Upstash↔Vercel  · P2  (collegato a R5)
`vercel.json` fissa `regions: ["fra1"]`. Upstash DEVE essere crea nella stessa
regione, altrimenti gli spin cold sono lenti/without-repo. Questo vincolo è
nascosto nei commenti di `health.js` e non documentato nell'ops/deploy.
**Fix:** documentarlo in README (D1) e, se possibile, misurarlo in CI (alert se
`kv_roundtrip_ms > 60`).

### O2 — Sentry error sampling al 100%  · P3
`sentry.config.js` imposta `tracesSampleRate`/`profilesSampleRate` a 0 di default
(ok), ma `captureException` invia SEMPRE (error sampling 1.0). Su traffico alto
aumenta i costi Sentry. Per una slot personale è accettabile; se il traffico cresce,
valutare `sampleRate` su `Sentry.init`.

### O3 — Logger non strutturato  · P3
Il codice mescola `console.log`/`console.warn`/`Sentry.captureException` senza un
logger unico. `LOG_LEVEL` è letto ma non centralizza l'output.
**Fix:** introdurre un piccolo `logger.js` (`_lib/logger.js`) con livelli e output
JSON, usato ovunque al posto di `console.*`.

---

## 9. Miglioramenti proposti (roadmap)

1. **Rate-limit per-IP (S2)** — token-bucket in KV, P0 funzionale.
2. **Allowlist redirect (S1)** — sostituire `BLOCKED_HOSTS` con `SLOT_ALLOWED_HOSTS`.
3. **Cache README in KV (P1)** — evita il GET GitHub a ogni spin.
4. **Timeout su `ghGetContents` (R4)** — AbortController 800ms coerente con repos.
5. **Standardizza handler su Web API `Response` (M1)** — un solo stile, wrapper CORS comune.
6. **Riscrivi README (D1/D2/D3)** — architettura reale + env vars + API Reference + registro ISSUE-N.
7. **Test e2e `spin.js` (T1)** — mock GitHub/KV, copre S1.
8. **Rimuovi codice morto (B1/M5/M2)** — `continueSpin`, `REPO_LANG_BATCH_SIZE`, `cacheTtl`.
9. **Sanitizza SVG in uscita (S3)** — strip `<script>`/`on*`/`foreignObject`.
10. **Token GitHub fine-grained (S4)** — scope minimo, rotazione.
11. **Retry/backoff sync state.json (R2)** — recupero automatico dopo outage GitHub.
12. **Logger strutturato (O3)** — `_lib/logger.js`, livelli + JSON.
13. **Alert rate-limit GitHub (T2+)** — `ratelimit-status` già espone `remaining`; aggiungere
    notifica (Sentry/Telegram) quando `< soglia`, oltre al solo frontend badge.
14. **Documenta vincolo regione fra1 (O1/D1)** — nel README e (opzionale) alert CI.

---

## Allegato — Verifiche eseguite (evidence)

- `npx vitest run` → **227 passed / 227** (25 file). Nessun test fallito.
- `node -e "import('./api/_lib/languages.js')..."` → carica 10 lingue (8 interne + 2
  esterne da `languages-external.json`); `config-loader.js` esiste e funziona
  (i presunti "bug" di import e `await` erano falsi allarmi, verificati a runtime).
- `grep -rn continueSpin` → 0 riferimenti attivi (conferma codice morto B1).
- `grep` su `README.md` → riferimenti a `languages.js` come renderer simboli (D1).
- `.gitignore` ignora `state.json`/`slot.svg`; hook pre-commit in `.githooks/`
  rafforza (ISSUE-7, già gestito).
