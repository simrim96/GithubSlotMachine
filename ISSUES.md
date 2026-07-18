# ISSUES.md — Analisi del progetto GithubSlotMachine

Data analisi: 18 luglio 2026
Scope: architettura runtime (Vercel serverless + Upstash Redis + GitHub Contents API),
logica di gioco, persistenza stato, caching repo, sicurezza CORS/open-redirect.

Stato dei check automatici (aggiornato dopo fix ISSUE-1):
- `npx vitest run` → 150 test passati (15 file), nessun fallimento.
- `npx eslint .` → 0 problemi segnalati.
- `npm audit --audit-level=moderate` → 31 vulnerabilità (2 low, 12 moderate, 17 high),
  quasi tutte transitive dentro la dependency tree di `vercel` (undici, tar, smol-toml).

NOTA: i test verdi non coprono i bug critici sotto, perché i casi limite non sono
testati (vedi "Copertura dei test" in fondo).

================================================================================
## BLOCCANTI / CRITICI
================================================================================

### ISSUE-2  [CRITICO] image.js bypassa i wrapper KV con timeout
File: `api/image.js` — righe 27-39

    if (kvEnabled) {
      const svg = await kv.get('gsm:slotSvg');   // <- kv.get diretto!
      ...

`kv.get` è chiamato DIRETTAMENTE sull'oggetto Redis di @upstash/redis, anziché
usare `kvGet('gsm:slotSvg')` esportato da `kv.js` (che avvolge la chiamata in
`withTimeout(KV_TIMEOUT_MS)`). Tutto il resto del progetto usa `kvGet`/`kvSet`
proprio per evitare che Redis lento/cross-region blocchi lo spin. Qui il
timeout di sicurezza NON esiste: se Upstash è lento, `/api/image` può attendere
secondi (il default di undici è molto più alto) prima di fallire.

Impatto: il widget della slot (che embedda `/api/image`) può impallarsi quando
Redis è sotto carico o cross-region, contraddicendo l'intero design KV-timeout.

Fix: importare e usare `kvGet` da `./_lib/kv.js`:
    const svg = await kvGet('gsm:slotSvg');
(e togliere l'import di `kv`).

================================================================================
## ALTI
================================================================================

### ISSUE-3  [ALTO] repos.js: refresh cache senza timeout né circuit breaker
File: `api/_lib/repos.js` — `refreshCache()` (righe ~48-108)

Le `fetch` verso `users/{owner}/repos` e verso ogni `rep.languages_url` (fino a
~100 chiamate in parallelo su cold cache) NON usano né `AbortController` (come fa
`github.js` con `GITHUB_API_TIMEOUT_MS`) né il `GitHubCircuitBreaker`. Se GitHub
è lento, il refresh gira in background ma la sua `Promise` può restare appesa
molto a lungo; inoltre lanciare 100 fetch in parallelo a freddo è un picco di
carico che può consumare il rate-limit di 5000/h (il commento in `ratelimit.js`
dice che per una slot personale "non è mai un vincolo", ma 100 call/subito è
esattamente il caso che lo esaurisce).

Impatto: cold-cache burst può esaurire i rate-limit GitHub e/o appesantire
l'istanza; nessun fallback grace se una fetch si pianta.

Fix: riusare `ghGet`/circuit breaker da `github.js`, o almeno aggiungere
`AbortController` + `GITHUB_API_TIMEOUT_MS`, e limitare la concorrenza (es.
`Promise.all` a batch di 10-20).

--------------------------------------------------------------------------------
### ISSUE-4  [ALTO] state.js: writeStateGitHub parte un'ulteriore fetch GitHub
non protetta
File: `api/_lib/state.js` — `writeStateGitHub` / `readStateGitHub` (righe ~126-184)

Queste funzioni fanno `fetch` dirette a `api.github.com` SENZA `AbortController`
e SENZA circuit breaker (a differenza di `github.js`). Sono usate sia come
fallback (quando Redis non c'è) sia come sync asincrono in `writeState`. Se
GitHub è lento, lo spin principale (nel percorso fallback) può bloccarsi oltre
il previsto, e il sync asincrono può generare un 409-loop se lo SHA va stale
(ce un retry solo su 409, ma la rilettura stessa può fallire silenziosamente).

Fix: centralizzare TUTTE le chiamate GitHub in `github.js` (con timeout +
circuit breaker + retry 409 già presenti) e rimuovere i fetch duplicati qui.

================================================================================
## MEDI
================================================================================

### ISSUE-5  [MEDIO] Circuit breaker è di fatto un no-op (fallback disabilita la protezione)
File: `api/_lib/github.js` — `GitHubCircuitBreaker.call()` (righe ~63-86)

Quando il circuito è `open`, invece di rifiutare la chiamata (comportamento
standard di un circuit breaker), il codice la esegue COMUNQUE via fallback
diretto. Il commento dice "per evitare blocchi completi", ma così il breaker
non protegge mai da failure cascading: alle prime 3 chiamate fallite apre il
circuito, ma la chiamata successiva passa lo stesso. Il `failureThreshold=3` e
il `resetTimeout=60s` non hanno effetto pratico sulla disponibilità.

Impatto: durante un outage GitHub, si continuano a martellare le API invece di
fare backoff. Non è un bug di crash, ma vanifica il design del breaker.

Fix: decidere se il breaker deve davvero aprirsi (ritornare errore/usare cache)
oppure rimuoverlo e tenere solo i timeout. Lo stato attuale è fuorviante.

--------------------------------------------------------------------------------
### ISSUE-6  [MEDIO] RateLimitTracker: solo logging, nessun blocco reale
File: `api/_lib/ratelimit-tracker.js` — `GITHUB_RATE_LIMIT_BLOCK_THRESHOLD` (riga 12)

I metodi `isBelowBlockThreshold()` e le costanti `GITHUB_RATE_LIMIT_BLOCK_THRESHOLD`
(=2) / `GITHUB_RATE_LIMIT_WARNING_THRESHOLD` (=10) sono definiti ma NON usati da
nessuna logica che fermi le chiamate. Il tracker aggiorna `remaining`/`reset` e
stampa warning, ma non influenza mai se una chiamata GitHub parte o meno.

Impatto: falso senso di sicurezza. Se restano pochi rate-limit, il codice
continua a scrivere su GitHub (slot.svg + state + README a ogni spin) e rischia
un 403 che fa cascare nel graceful-fallback.

Fix: collegare `isBelowBlockThreshold()` al percorso di spin (es. saltare la
scrittura README quando remaining è basso) oppure rimuovere la logica morta.

--------------------------------------------------------------------------------
### ISSUE-7  [MEDIO] analytics trackSpin invia a endpoint Vercel non documentato
File: `api/spin.js` — `trackSpin()` (righe ~148-168)

`fetch('https://api.vercel.com/v1/analytics', {method:'POST'})` viene chiamato
ad ogni spin quando `process.env.VERCEL` è vero. Questo endpoint NON è la Web
Analytics ufficiale di Vercel (che si inietta lato client), e non è documentato
come API pubblica affidabile. Le richieste probabilmente finiscono in 404/401
silenziosi (il `.catch(()=>{})` maschera tutto).

Impatto: traffico di rete inutile a ogni spin + log di warning nascosti. Nessun
dato analitico reale viene raccolto.

Fix: usare Vercel Web Analytics (script lato client nel README embed) oppure
rimuovere `trackSpin`. Non chiamare un endpoint server-side non documentato.

================================================================================
## BASSI / MANUTENZIONE
================================================================================

### ISSUE-8  [BASSO] MIGRATIONS[2] placeholder crea stato "ahead" (v3 > STATE_VERSION=2)
File: `api/_lib/state.js` — `MIGRATIONS[2]` (righe ~63-73)

La migrazione per v2→v3 è un placeholder che setta `version: 3`, ma
`STATE_VERSION` è 2. Se mai raggiunta, produce uno stato con versione superiore
a quella corrente, rompendo il confronto `currentVersion < STATE_VERSION` in
`readState`. Va rimossa finché non serve davvero una v3.

--------------------------------------------------------------------------------
### ISSUE-9  [BASSO] config-loader: YAML non veramente supportato in produzione
File: `api/_lib/config-loader.js` — `loadYAML()` (righe ~44-55)

Usa `await import('yaml')` ma `yaml` NON è nelle `dependencies` di package.json.
In produzione l'import fallisce → ritorna `null` silenziosamente → i file
`.yaml`/`.yml` di lingue esterne vengono ignorati senza errore chiaro. La
documentazione promette il supporto YAML.

Fix: aggiungere `yaml` alle `dependencies` oppure rimuovere il riferimento YAML
da README/doc.

--------------------------------------------------------------------------------
### ISSUE-10  [BASSO] health.js stampa mezzo header Authorization nel log
File: `api/health.js` — riga 72

    Authorization: *** ' + token,

È un typo/concatenazione errata: il prefisso letterale `'*** '` viene unito al
token invece di `'Bearer ' + token` (o meglio, di non logarlo affatto). Così il
log mostra comunque il token PAT in chiaro nei log di diagnostica. Anche se è
solo su `/api/health`, è una fuoriuscita di segreto nei log.

Fix: non loggare MAI il token. Usare `Authorization: \`Bearer ${token}\`` nelle
request e non stamparlo. Controllare anche `github.js`/`state.js` (leggi
il file per i dettagli del mask — nel source qui presente il token è
correttamente mascherato come `Bearer ***`, ma in health.js il concat è rotto).

--------------------------------------------------------------------------------
### ISSUE-11  [BASSO] file runtime (slot.svg, state.json) nel repo ma gitignati solo parzialmente
File: `.gitignore` (righe 23-24) + root

`slot.svg` e `state.json` sono gitignati (giusto: cambiano a ogni spin), ma
sono PRESENTI nella working dir (committati? no, ignorati). Il `.gitignore`
ignora `state.json` ma NON `/tmp/GithubSlotMachine_state.json` (che è fuori repo,
ok). Piccolo rischio: se qualcuno fa `git add -f`, ricomincia a sporcare la
history. Verificare che non siano mai stati committati (al momento non lo sono).

--------------------------------------------------------------------------------
### ISSUE-12  [BASSO] dipendenze vulnerabilities (31, di cui 17 high)
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
- Nessun test su `image.js` che verifichi l'uso di `kvGet` vs `kv.get` (ISSUE-2).
- Nessun test sulle chiamate GitHub in `state.js`/`repos.js` con timeout simulati.
- `config-loader` è testato ma solo lato unit; il caricamento YAML reale senza
  il package `yaml` non è coperto da nessun check di integrazione (ISSUE-9).

================================================================================
## RIEPILOGO PRIORITÀ
================================================================================
1. ISSUE-2  (critico) — image.js senza KV timeout → fix immediato
2. ISSUE-3  (alto)     — repos.js senza timeout/breaker
3. ISSUE-4  (alto)     — state.js fetch GitHub non protetti
4. ISSUE-5/6 (medio)   — circuit breaker e rate-limit tracker inefficaci
5. ISSUE-7  (medio)    — analytics endpoint fasullo
6. ISSUE-8..12 (basso) — pulizia, segreti nei log, audit dep
