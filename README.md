# 🎰 GithubSlotMachine

An animated, recruiter-friendly **slot machine** for your GitHub profile README.

Reels of the programming languages from your stack — every win surfaces a
**fun fact** (🇮🇹/🇬🇧) about the language and links straight to one of your
repos that uses it for **≥ 30%** of its codebase. A persistent **community spin
counter** is shown on the slot and (optionally) inside your profile README.

> _"Show, don't tell"_ — instead of a static tech list, visitors **pull the
> lever** and discover what you actually build.

---

## ✨ Features

- 🎯 **Programming languages as icons** — `C++`, `C`, `GLSL`, `React`,
  `JavaScript`, `Python`, `TypeScript`, `Qt`. Easy to extend (see below).
- 🧠 **Educational wins** — each language ships with a curated list of
  bilingual (`it`/`en`) fun facts; a random one is shown on every win.
- 🔗 **Auto-discovery of your repos** — on a win, the API scans your public
  repos and picks the best one that's at least 30% the winning language (per
  the GitHub Languages API). You're then redirected to that repo.
- 💎 **Polished visuals** — gradient cabinet, neon marquee, glowing bulbs,
  animated reels, win / jackpot / near-miss overlays. Pure hand-written SVG +
  CSS, **zero runtime dependencies, zero build step**.
- 📊 **Live community counter** — total spins (and wins) are persisted in
  `state.json` and displayed on every render.

> ⚠️ **Transparency note — it's a showcase, not a fair casino.** To keep the
> experience engaging for recruiters, the spin is _rigged_ on purpose:
> `FORCED_WIN_PROB` (≈ 0.35) guarantees a win when there isn't one, and a
> `near-miss` teaser is shown ~55% of the time. It's a portfolio piece designed
> to surface your stack, not a random number generator. Tune or remove those
> constants in `api/spin.js` if you prefer honest odds.

---

## 🧩 Architecture

```
api/
  spin.js           # main endpoint: spin, update slot.svg + state + README
  image.js          # serves slot.svg with aggressive no-cache headers
  lever.js          # serves the side lever SVG (the actual click target)
  _lib/
    languages.js    # languages config + SVG symbol renderer (extensible)
    repos.js        # cached lookup: language → best matching repo (≥30%)
    state.js        # read/write state.json (spin counter, last win)
state.json          # auto-generated/updated by the API
slot.svg            # auto-generated/updated by the API (live on every spin)
legacy/             # deprecated Python + GitHub-Action implementation (history only)
```

Folders prefixed with `_` are ignored by Vercel's serverless routing — they're
treated as private libs.

---

## 🚀 Deploy (Vercel)

This is a **Vercel serverless** project. Zero config needed beyond the files
already in the repo (`vercel.json` + `package.json` declare the runtime).

1. **Import the repo** into Vercel (New Project → Git → `simrim96/GithubSlotMachine`).
2. **Set the environment variable** `GITHUB_PAT`:
   - A fine-grained PAT with `Contents: read & write` on **this** repo
     (`GithubSlotMachine`) **and** on your profile repo (`<your-user>`), plus
     `Metadata: read` so it can list your repos.
3. **Deploy.** Your endpoints are live at:
   - `https://<your-app>.vercel.app/api/image`
   - `https://<your-app>.vercel.app/api/lever`
   - `https://<your-app>.vercel.app/api/spin`

> The first time someone spins, `slot.svg` is generated on the fly. Until then
> `api/image` returns a friendly "🎰 Pull the lever to spin!" placeholder.

### 🔌 All exposed endpoints

Besides the three endpoints above, the deployment also exposes two diagnostic
endpoints. They have `export default` handlers, so Vercel serves them as
serverless functions; they are **intentional**, just not part of the README
embed flow.

| Endpoint                    | Method | Purpose                                                                                                                                                               |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`           | GET    | Diagnostics: measures per-hop latency (Upstash round-trip, GitHub README GET). `?full=1` adds a cold-cache repo scan. Useful to spot cross-region Upstash latency.    |
| `GET /api/ratelimit-status` | GET    | JSON snapshot of the GitHub API rate-limit tracker (remaining/limit/reset/status). **Consumed by the frontend** (`public/index.html`) to render the rate-limit badge. |

> Neither endpoint writes to your repo or Redis — both are read-only and safe to
> call. `/api/health` reads the GitHub README only when `GITHUB_PAT` is set.

### Configuration

This project is configured for the `simrim96` profile. The relevant env vars
have the following defaults:

| Env var        | Default             | Purpose                                          |
| -------------- | ------------------- | ------------------------------------------------ |
| `SLOT_OWNER`   | `simrim96`          | Owner of the slot repo + whose repos are scanned |
| `SLOT_REPO`    | `GithubSlotMachine` | The repo that hosts `slot.svg` / `state.json`    |
| `PROFILE_REPO` | `= SLOT_OWNER`      | The profile README repo (`<user>/<user>`)       |
| `GITHUB_PAT`   | _(required)_        | Token used for both reads and writes             |

### ⚡ Upstash Redis (optional but recommended)

By default the slot persists `slot.svg` and the community counters by **committing
to the GitHub repo** (`state.json` + `slot.svg` via the Contents API). This works,
but every spin does 2–3 GitHub writes (slow on cold starts, clutters git history,
and can hit rate limits).

To make the slot **instant** (the screen shows the reels in ~10ms instead of
~300ms per image load), point it at an **Upstash Redis** database:

| Env var                    | Purpose                             |
| -------------------------- | ----------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | REST URL of your Upstash Redis DB   |
| `UPSTASH_REDIS_REST_TOKEN` | REST token of your Upstash Redis DB |

When both are set, the following move to Redis (free tier: 10k commands/day is
plenty for a profile widget):

- `slot.svg` live image — read by `api/image`, written by `api/spin`
- community counters (`totalSpins` / `totalWins`) — `state.json` becomes a Redis key
- the language→repo lookup cache — survives Vercel cold starts, so the **first
  spin no longer stalls for up to 1–3s** fetching `/languages`

> ⚠️ **Region matters — a lot.** Upstash REST calls are plain HTTPS round-trips.
> If your Upstash database is in a **different region** from your Vercel
> deployment (e.g. Upstash on `us-east-1`, Vercel on `fra1`/Europe), every KV
> read/write pays a cross-continent latency tax and the slot gets **slower** than
> the GitHub-only version. **Create the Upstash DB in the SAME region as your
> Vercel project** (Vercel → Project → Settings → General shows the region;
> pick the matching Upstash region at DB creation). A same-region Redis is ~10–20ms
> per call; cross-region can be 150ms+ and dominate the spin time.

> 🚀 **Non-blocking spin.** Once Redis is configured, `api/spin` no longer waits
> for every write before redirecting. It writes `slot.svg` + the counters to Redis
> (~10–20ms), then redirects **immediately**; the profile-README update happens in
> the background. The redirect target is computed _before_ any slow write, and the
> language→repo cache refreshes in the background on a cold cache, so the time from
> _click → page reload_ is bounded only by the fast KV writes, never by a GitHub
> PUT or a cold `/languages` scan. Every KV call also has a **200ms timeout** with
> automatic fallback to GitHub, so a slow/down Redis can never make the slot slower
> than the original.

If the env vars are **absent**, the code transparently falls back to the original
GitHub-Contents behaviour, so local `vercel dev` keeps working unchanged. No code
changes needed to toggle between the two.

> **Get an Upstash DB:** upstash.com → "Redis" → create a free database **in the
> same region as your Vercel project** → copy the `UPSTASH_REDIS_REST_URL` and
> `UPSTASH_REDIS_REST_TOKEN` into Vercel's env vars.

You can also override the redirect target per-request with
`/api/spin?user=OTHERNAME` (handy for demos).

---

## 🗄️ Repo cache (language → repo lookup)

The "best repo for language X" lookup (`api/_lib/repos.js`) is cached so a spin
never has to wait for up to ~100 sequential `/languages` calls on a cold Vercel
instance. This is the **ISSUE-28** behaviour.

- **Two-level cache.** An in-memory (module-level) map is the fast path while the
  Vercel instance stays warm. When Upstash Redis is configured, the cache is also
  persisted there, so it survives Vercel cold starts — the first spin after a cold
  boot no longer stalls for 1–3 s scanning `/languages`.
- **Non-blocking refresh.** Once the cache has been populated at least once, a
  stale read triggers a background refresh and immediately returns the still-valid
  value. The redirect never waits on a slow GitHub scan.
- **Cold-start wait (ISSUE-28).** On the very first request after boot — when the
  cache has never been populated (`ts === 0`) — the handler awaits the refresh for
  at most **800 ms**. If GitHub answers in time, the first spin already has a repo
  to link to; if the network is slow or down, an `AbortController` enforces the
  800 ms cap and the call returns immediately rather than hanging.
- **First spin can point to the profile.** Because of that 800 ms cap, when GitHub
  is slow or unreachable on a cold start the lookup returns `null` and the
  win/redirect falls back to your **GitHub profile** instead of a specific repo
  (the same fallback used when no repo qualifies). On every subsequent spin — once
  the cache is warm or Redis-backed — the repo links are available again. This is
  expected, not a bug: the spin counter and slot image still update normally.

---

## 🎰 Embedding the slot in a README

The slot is split into **two side-by-side images**: the cabinet
(`api/image`, read-only, shows the reels + result) and the side lever
(`api/lever`, the actual spin trigger). They dock visually so they look like a
single classic slot machine.

Use a markdown table to keep them on the same row with no gap:

```markdown
<table><tr>
  <td><img src="https://YOUR-VERCEL-APP.vercel.app/api/image?v=1" width="600" alt="slot"/></td>
  <td><a href="https://YOUR-VERCEL-APP.vercel.app/api/spin"><img src="https://YOUR-VERCEL-APP.vercel.app/api/lever" width="140" alt="pull to spin"/></a></td>
</tr></table>
```

Only the lever is wrapped in the spin link — the slot itself is read-only, which
makes the call-to-action explicit and prevents accidental clicks while reading
the result. The `?v=` query busts GitHub Camo's image cache after each spin.

> **⏱️ Performance note — GitHub Camo proxy.** When the slot is embedded in a
> README, the `<img>` is served through **GitHub's Camo proxy** (not directly from
> Vercel). Camo adds its own latency and caches aggressively, so the _fastest_
> experience is on your **Vercel app URL** (`https://YOUR-VERCEL-APP.vercel.app/api/image`)
> — open that link to see the slot update instantly. With Upstash Redis the image
> read itself drops from ~300ms to ~10ms; Camo is the only hop left in front when
> viewed from the README. Animated CSS inside the SVG runs fine on the Vercel URL
> and is generally preserved by Camo, but treat the README embed as a live preview
> rather than a guaranteed real-time view.

---

## 🏷️ Auto-updated section in your profile README (optional)

If your profile README contains these markers:

```markdown
<!-- SLOT_LAST_WIN_START -->
<!-- SLOT_LAST_WIN_END -->
```

…the API keeps the block between them in sync after every spin:

```markdown
<!-- SLOT_LAST_WIN_START -->

> 🎰 **Total community spins:** `1,234` · **Wins:** `89`
>
> 🏆 **Last win:** `Python` → [my-cool-ml-project](https://github.com/you/my-cool-ml-project)
> _Python prende il nome dai Monty Python's Flying Circus, non dal serpente..._

<!-- SLOT_LAST_WIN_END -->
```

If the markers aren't present, the README is left untouched (the slot SVG still
shows everything inline).

---

## 🚦 Behavior on click

- **No win** → redirect to your GitHub profile.
- **Win** → redirect to the matching repo (≥ 30% of the winning language).
  Falls back to the profile if no repo qualifies.
- **Jackpot** (5 in a row) → redirect to the filtered repo list for that
  language (`?tab=repositories&language=…`).

---

## ➕ Adding a new language

Open `api/_lib/languages.js` and append an entry to the `LANGUAGES` array:

```js
{
  id: 'rust',
  name: 'Rust',
  short: 'Rust',
  color: '#dea584',
  accent: '#000000',
  text: '#1a1a1a',
  githubLang: 'Rust',           // exact name from GitHub Languages API
  // topic: 'wasm',              // optional: require this topic on the repo
  competence: 4,                // 1–5, shown as dots in the paytable
  facts: [
    { it: '…', en: '…' },
  ],
}
```

That's it — the symbol is rendered automatically, the reels are reweighted, and
on a Rust win the API picks one of your Rust-heavy repos.

For frameworks that aren't strictly a language (e.g. React), set `githubLang`
to the host language (`'JavaScript'` / `'TypeScript'`) and `topic` to require
a GitHub topic on the repo (e.g. `'react'`).

---

## 📄 License

[MIT](./LICENSE) — see the file for details.
