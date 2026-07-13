1|# Issues & Criticità del Progetto
2|Questo documento documenta le criticità identificate nel progetto GithubSlotMachine, con analisi dettagliata, impatti e possibili soluzioni.
3|---
4|
5|## 📋 INDICE
6|
7|1. [Near-Miss Logic Fragile](#1-near-miss-logic-fragile)
8|2. [Language Matching Aggressivo](#2-language-matching-aggressivo)
9|3. [Missing Monitoring/Logging](#3-missing-monitoringlogging)
10|
11|---
12|
13|## 1. Near-Miss Logic Fragile
14|
15|### Descrizione
16|Due funzioni `engineerNearMiss` e `detectNearMiss` sono strettamente accoppiate. Se una cambia, l'altra potrebbe non riconoscere il near-miss generato.
17|
18|### File Correlati
19|- `api/_lib/game.js` - righe 66-92 (`engineerNearMiss`), 134-160 (`detectNearMiss`)
20|- `tests/game.test.js` - righe 208-270 (test suite near-miss)
21|
22|### Problema Identificato
23|
24|Il test "invariant: a detected near-miss column matches the near-miss geometry" (righe 237-269) esiste **proprio perché** la coupling è notoriamente fragile.
25|
26|**Flusso di near-miss:**
27|1. `engineerNearMiss` modifica la grid in-place:
28|   - 2 simboli consecutivi sulla payline centrale
29|   - 1 simbolo diverso (breaker) nel rullo successivo
30|   - 1 simbolo adiacente nello stesso rullo (near-miss visivo)
31|2. `detectNearMiss` scansiona la grid per trovare near-miss:
32|   - Cerca 2+ symbol consecutivi + anchor adiacente nel rullo successivo
33|3. Se i due algoritmi divergono → near-miss generato ma non evidenziato
34|
35|### Test Case Esistenti
36|```javascript
37|it('invariant: a detected near-miss column matches the near-miss geometry', () => {
38|  for (let i = 0; i < 400; i++) {
39|    const g = generateGrid();
40|    const col = detectNearMiss(g, checkWins(g));
41|    if (col < 0) continue;
42|    // Replicate la scan e conferma che col corrisponde a near-miss reale
43|    // ...
44|    expect(ok).toBe(true);
45|  }
46|});
47|```
48|
49|### Miglioramenti Proposti
50|
51|1. **Unificare la logica**: `engineerNearMiss` dovrebbe chiamare `detectNearMiss` per verificare che il near-miss sia riconosciuto
52|2. **Aggiungere test di regressione** che testano casi edge (wild, scatter, multiple paylines)
53|3. **Documentare esplicitamente** il contratto tra le due funzioni in commenti
54|
55|---
56|
57|## 2. Language Matching Aggressivo
58|
59|### Descrizione
60|Il matching tra linguaggio vincente e repo dell'owner usa soglie fisse troppo permissive:
61|- ≥30% del codice del linguaggio
62|- Topic filter **opzionale**
63|
64|### File Correlati
65|- `api/_lib/repos.js` - righe 78-97
66|
67|### Problema Identificato
68|
69|**Esempio reale:**
70|- User vince con `C++`
71|- Repository `simrim96/simrim96` (profile repo) ha 35% C++ (config, scripts vari)
72|- Viene mostrato come "Ultima vincita" → `C++` → `simrim96/simrim96`
73|
74|**Problema:**
75|- Il repo `simrim96/simrim96` è **il profilo stesso**, non un progetto C++
76|- L'utente potrebbe essere confuso: "perché mi mostra il mio profilo come repo C++?"
77|
78|### Logica Attuale (repos.js, righe 94-97)
79|```javascript
80|// Privilegia repo non-profile e con percentuale più alta, poi più stelle.
81|const isProfile = rep.name.toLowerCase() === owner.toLowerCase();
82|if (!cur || (!isProfile && (pct > cur.pct || (pct === cur.pct && candidate.stars > cur.stars)))) {
83|  byLangId[lang.id] = candidate;
84|}
85|```
86|
87|**Problema:** La logica è corretta ma non sufficientemente aggressiva:
88|- Se il PRIMO candidate è il profile repo, non viene sostituito da un repo non-profile con % uguale
89|- Dovrebbe essere: `if (!isProfile && cur) return cur` (preferring non-profile)
90|
91|### Miglioramenti Proposti
92|
93|1. **Tag esplicito per "profile repo"** nel config
94|2. **Threshold più alto per profile repos** (es. ≥50% vs ≥30%)
95|3. **Fallback a repo secondario** se il top match è il profile
96|
97|---
98|
99|## 3. Missing Monitoring/Logging
100|
101|### Descrizione
102|Nessun sistema di monitoraggio o logging per la produzione. Solo `console.warn` per errori.
103|
104|### File Correlati
105|- `api/spin.js` - unico punto di logging
106|- `vercel.json` - deployment config
107|
108|### Metriche Non Tracciate
109|
110|| Metrica | Importanza | Stato |
111||---------|------------|-------|
112|| Tempo di risposta GitHub API | ALTA | ❌ |
113|| Tempo di risposta Redis | ALTA | ❌ |
114|| Win rate reale | ALTA | ❌ (solo su state.json) |
115|| Near-miss rate | MEDIA | ❌ |
116|| Redis hit rate | ALTA | ❌ |
117|| GitHub API rate limit consumo | ALTA | ❌ |
118|| Errori per tipo (404, 403, 409, timeout) | ALTA | ❌ |
119|| User IP distribution | BASSA | ❌ |
120|
121|### Soluzione Proposta
122|
123|#### Opzione A: Vercel Analytics + Custom Metrics
124|- Usare Vercel Analytics per pagine/view
125|- Custom metrics via `vercel.json` `experimental` o API
126|
127|#### Opzione B: OpenTelemetry + Backend
128|- Iniettare OpenTelemetry SDK
129|- Esportare a Jaeger/Tempo/Zipkin
130|- Dashboard Grafana per visualizzazione
131|
132|#### Opzione C: Log Semplice su S3/CloudWatch
133|- Log JSON per ogni spin
134|- Include: timestamp, IP, win/loss, latency, error_type
135|- Queryable via CloudWatch Logs Insights
136|
137|### Log Entry Template Suggerito
138|```json
139|{
140|  "timestamp": "2026-07-13T12:34:56Z",
141|  "event": "spin",
142|  "user_ip_hash": "abc123...",
143|  "result": "win",
144|  "win_type": "jackpot",
145|  "lang_id": "cpp",
146|  "latency_ms": {
147|    "github_get": 123,
148|    "github_put": 456,
149|    "redis_get": 12,
150|    "redis_set": 15,
151|    "svg_build": 45
152|  },
153|  "error": null
154|}
155|```
156|
157|---
158|
159|## 📌 PRIORITÀ DI RISOLUZIONE
160|
160|| Issue | Priorità | Tempo Stimato |
161||-------|----------|---------------|
162||1. Near-Miss Logic Fragile | MEDIA | 1-2 giorni |
163||2. Language Matching | BASSA | 1 giorno |
164||3. Missing Monitoring/Logging | ALTA | 1 giorno |
165|
166|---
167|
168|## 📝 NOTE AGGIUNTIVE
169|
170|### Documentazione Correlata
171|- [README.md](./README.md) - Documentazione principale del progetto
172|- [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) - Deployment guide (se esiste)
173|
174|### Riferimenti Tecnici
175|- GitHub API Rate Limit: https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api
176|- Upstash Redis Docs: https://upstash.com/docs
177|- Vercel Serverless Functions: https://vercel.com/docs/functions
178|
179|---
180|
181|*Documento creato: 2026-07-13*
182|*Ultima revisione: 2026-07-13*
183|
