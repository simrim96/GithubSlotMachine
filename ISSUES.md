# ISSUES.md — GitHubSlotMachine

Problemi emersi dalla code review del `2026-07-19`. Ordinati per severità.
I numeri proseguono dalla numerazione esistente (ISSUE-1, ISSUE-3, ISSUE-6/7/8, ISSUE-11
già risolti/chiusi). Tutti i punti qui sotto sono stati verificati a livello di
byte grezzi o con `npm test` (138 test passing).

> Nota metodologica: in una prima bozza erano stati segnalati due "bug critici"
> (`Authorization: *** ` in github.js/health.js e un import mancante di
> `svg-builder-accessible.js`). Entrambi erano **falsi positivi** causati
> dall'output redatto dello strumento di ricerca: i file contengono in realtà
> `Bearer ` corretto e l'import esiste. Verificati con `od -c` e `node -e import()`.
> Non sono stati inclusi in questo file.

---

## 🟡 ISSUE-16 — Header GitHub duplicato in `repos.js` invece di riusare `github.js` — ✅ RISOLTO

`api/_lib/repos.js:28` **e** `api/image.js:18` ridefiniscono localmente
`function ghHeaders(token)` (con `Bearer` corretto) invece di importare un'unica
sorgente da `github.js`. Due (potenzialmente tre) copie dello stesso header in
file diversi moltiplicano il rischio di divergenza (è esattamente il genere di
duplicazione che ha generato falsi allarmi nella review).

**Fix applicato (2026-07-19):** esportata un'unica `ghHeaders(token, opts)` da `api/_lib/github.js` (con valori di default `Accept: application/vnd.github.v3+json` e `User-Agent: GithubSlotMachine`, overridabili via `opts`). Rimosse le copie locali in `api/_lib/repos.js`, `api/image.js` e `api/health.js`; questi ultimi due ora importano `ghHeaders` da `github.js` (health.js passa `accept: application/vnd.github+json` e `userAgent: gsm-health`). Verificato con `npm test` (138 test passing) e grep: resta un'unica definizione in `github.js`.

---

## 💡 Miglioramenti suggeriti (non bug)

1. **CI smoke test di import** — un job `node -e "import('./api/_lib/svg-builder.js')"`
   avrebbe dato feedback immediato su rotture di modulo.
2. **Contract test sull'header** — asserire che ogni `fetch` a `api.github.com`
   usi `Bearer `. Copre eventuali regressioni tipo ISSUE-16.
3. **Gestione errore globale in `spin.js`** — avvolgere la logica in `try/catch`
   e, in caso di eccezione imprevista, rispondere comunque con un redirect o un
   SVG di errore anziché un 500 nudo.
4. **`vercel.json`** ha `"rewrites": []` vuoto: rimuoverlo se non serve.
5. **Centralizzare CORS** — la logica CORS duplicata in `spin.js` può diventare
   un middleware riusabile (o usare l'helper headers di `@vercel/functions`).
6. **`kv.js` legge `KV_REST_API_READ_ONLY_TOKEN`** (riga 31) e lo usa come
   fallback per il token di lettura Upstash — è corretto, ma `.env.example` lo
   documenta in modo ambiguo ("+ KV_REST_API_READ_ONLY_TOKEN" in un commento).
   Chiarire che è opzionale e serve solo per il read-path.
