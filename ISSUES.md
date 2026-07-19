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

_Nessuno aperto._
