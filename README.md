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
  spin.js                 # main handler: spin → update slot.svg + state + README, then redirect
  image.js                # serves slot.svg (read-only, aggressive no-cache headers)
  lever.js                # serves the side lever SVG (the actual spin trigger)
  health.js               # diagnostics: measures Upstash round-trip + GitHub README GET latencies
  ratelimit-status.js     # JSON snapshot of the GitHub API rate-limit tracker (consumed by the frontend badge)
  _lib/
    game.js               # PURE game logic: reel, paylines, grid generation, win / near-miss engineering
    svg-builder.js        # assembles the full slot SVG from the svg/ submodules
    svg-builder-accessible.js  # accessibility variant (aria-live regions) of the slot SVG
    languages.js          # language config + SVG SYMBOL RENDERER (buildSymbolDefs/symbolUse) + external loader
    repos.js              # cached lookup: language → best matching repo (≥30% of that language)
    state.js              # read/write state (spin + win counters) with retry/backoff resilience
    github.js             # GitHub Contents API client + README marker update + PAT audit (S4)
    kv.js                 # Upstash / Vercel-KV REST client (read/write with timeout + read-only token fallback)
    cors.js               # centralized CORS policy (ACAO allowlist) + applyCors()
    ratelimit.js          # per-IP spin rate-limit gate (isValidUser)
    ratelimit-tracker.js  # GitHub API rate-limit tracker (remaining/limit/reset)
    spin-cooldown.js      # per-IP time-based spin cooldown (mirrored client-side)
    config-loader.js      # loads languages-external.json (extra languages)
    response-bridge.js    # unified Response primitive (buildResponse / sendResponse) used by every handler
    svg/                  # SVG section modules: defs, reels, panel, effects, marquee, cabinet, screen, paytable, header, jackpot, css, constants, coordinates, utils, analysis
state.json          # auto-generated/updated by the API
slot.svg            # auto-generated/updated by the API (live on every spin)
public/
  index.html        # accessible slot viewer (uses /api/image + /api/lever, shows rate-limit badge + cooldown)
legacy/             # deprecated Python + GitHub-Action implementation (history only)
```

Folders prefixed with `_` are ignored by Vercel's serverless routing — they're
treated as private libs. The five top-level `api/*.js` files are the only
Vercel serverless function entry points; everything in `api/_lib/` (and its
`svg/` subtree) is a private library imported by them.

---

## 🚀 Deploy (Vercel)

This is a **Vercel serverless** project. Zero config needed beyond the files
already in the repo (`vercel.json` + `package.json` declare the runtime).

1. **Import the repo** into Vercel (New Project → Git → `simrim96/GithubSlotMachine`).
2. **Set the environment variable** `GITHUB_PAT`. **Security (S4): use a
   *fine-grained* PAT, not a classic one.**
   - Go to GitHub → Settings → Developer settings → **Fine-grained PATs** →
     *Generate new token*.
   - **Repository access:** "Only select repositories" → select **both**:
     - your slot repo (`GithubSlotMachine`)
     - your profile repo (`<your-user>/<your-user>`)
   - **Repository permissions → Contents:** **Read and write**
   - Leave the account-level `repo` scope **off** — that's exactly what S4
     protects against (a classic `ghp_…` PAT with `repo` can touch every
     repo you own if leaked).
   - Set an **expiration** and rotate it periodically.
   - The app detects a classic/unknown PAT and emits a Sentry + log warning.
     For fail-closed behaviour (writes refused, read-only mode) set
     `GITHUB_PAT_REQUIRE_FINEGRAINED=true`.
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

This project is configured for the `simrim96` profile. Every value is **optional**
unless noted; unset vars fall back to the defaults shown below (a minimal fork
only needs `GITHUB_PAT` to actually run).

#### Environment Variables

| Env var | Default | Purpose |
| --- | --- | --- |
| `GITHUB_PAT` | _(required for writes)_ | Fine-grained PAT used for reads **and** writes (see Deploy § for scoping). |
| `GITHUB_PAT_REQUIRE_FINEGRAINED` | `false` | Set `true` to **refuse writes** (fail-closed, read-only) when the PAT is NOT fine-grained. Default = warn only (S4). |
| `SLOT_OWNER` | `simrim96` | Owner of the slot repo **and** whose repos are scanned. |
| `SLOT_REPO` | `GithubSlotMachine` | Repo that hosts `slot.svg` / `state.json`. |
| `PROFILE_REPO` | `= SLOT_OWNER` | Profile README repo (`<user>/<user>`). |
| `GITHUB_API_TIMEOUT_MS` | `5000` | Timeout for generic GitHub API calls. |
| `GH_CONTENTS_TIMEOUT_MS` | `800` | Strict timeout for the README read on the spin hot path. |
| `UPSTASH_REDIS_REST_URL` | _(empty)_ | Standalone Upstash Redis REST URL (enables Redis if set with the token). |
| `UPSTASH_REDIS_REST_TOKEN` | _(empty)_ | Standalone Upstash Redis REST token. |
| `KV_REST_API_URL` | _(empty)_ | Vercel KV REST URL (auto-set by the Vercel KV integration). |
| `KV_REST_API_TOKEN` | _(empty)_ | Vercel KV REST token. |
| `KV_REST_API_READ_ONLY_TOKEN` | _(empty, optional)_ | Read-only Upstash token used as a fallback for the read path when the write token is absent. |
| `KV_TIMEOUT_MS` | `500` | KV network timeout before falling back to GitHub. |
| `ALLOWED_CORS_ORIGINS` | `https://github-slot-machine.vercel.app,http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173` | CSV allowlist of origins that receive an `Access-Control-Allow-Origin` echo (cross-origin embed). |
| `SLOT_ALLOWED_HOSTS` | `github-slot-machine.vercel.app,github.com` (+ `localhost`,`127.0.0.1`) | CSV allowlist of hosts the `/api/spin` redirect target may point to (open-redirect protection, S1). |
| `SPIN_COOLDOWN_MS` | `3000` | Per-IP cooldown after a spin (mirrored client-side in `public/_spin-cooldown.js`). |
| `STATE_SYNC_FAILURE_ALERT_THRESHOLD` | `5` | Consecutive state-sync failures before an alert is raised. |
| `STATE_SYNC_MAX_RETRIES` | `3` | Retries for a failed state write, with exponential backoff. |
| `STATE_SYNC_BACKOFF_BASE_MS` | `200` | Base delay (`× 2^n`) for the state-sync backoff. |
| `SENTRY_DSN` | _(empty)_ | Sentry DSN for error monitoring. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.0` | Tracing sample rate (0 = off). |
| `SENTRY_PROFILES_SAMPLE_RATE` | `0.0` | Profiling sample rate (0 = off). |
| `SENTRY_DEBUG` | `false` | Set `true` to enable Sentry debug logging. |

> **Note on `LOG_LEVEL` / `VERCEL_ENV` / `NODE_ENV`:** these are referenced by
> third-party tooling (Sentry, Vercel) but are **not** read by the slot's own code,
> so setting them has no effect on slot behaviour. Tracing levels are controlled
> exclusively via the `SENTRY_*` vars above.

> **Tuning the odds:** the win-engineering probability (`FORCED_WIN_PROB = 0.35`)
> and the near-miss probability (`0.55`) are **code constants** in
> `api/_lib/game.js`, not env vars — edit that file (and redeploy) to change them.

### ⚡ Upstash Redis (optional but recommended)

By default the slot persists `slot.svg` and the community counters by **committing
to the GitHub repo** (`state.json` + `slot.svg` via the Contents API). This works,
but every spin does 2–3 GitHub writes (slow on cold starts, clutters git history,
and can hit rate limits).

To make the slot **instant** (the screen shows the reels in ~10ms instead of
~300ms per image load), point it at an **Upstash Redis** database (set either the
standalone `UPSTASH_REDIS_REST_*` pair **or** the Vercel KV `KV_REST_API_*`
pair — both enable Redis):

| Env var | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | REST URL of your Upstash Redis DB |
| `UPSTASH_REDIS_REST_TOKEN` | REST token of your Upstash Redis DB |
| `KV_REST_API_URL` | Vercel KV REST URL (alternative to the pair above) |
| `KV_REST_API_TOKEN` | Vercel KV REST token |
| `KV_REST_API_READ_ONLY_TOKEN` | Optional read-only token (read-path fallback) |

When enabled, the following move to Redis (free tier: 10k commands/day is
plenty for a profile widget):

- `slot.svg` live image — read by `api/image`, written by `api/spin`
- community counters (`totalSpins` / `totalWins`) — `state.json` becomes a Redis key
- the language→repo lookup cache — survives Vercel cold starts, so the **first
  spin no longer stalls for up to 1–3s** fetching `/languages`

> ⚠️ **Region is pinned to `fra1` — a lot.** `vercel.json` hard-codes
> `regions: ["fra1"]`, so your Vercel functions **always run in `fra1` (Frankfurt)**.
> Upstash REST calls are plain HTTPS round-trips, so the Upstash DB **MUST be
> created in `fra1`** as well. If it's in a different region (e.g. `us-east-1`),
> every KV read/write pays a cross-continent latency tax and the slot gets
> **slower** than the GitHub-only version. Create the Upstash DB **in the same
> region (`fra1`)** as your Vercel project. A same-region Redis is ~10–20ms per
> call; cross-region can be 150ms+ and dominate the spin time.

> 🚀 **Non-blocking spin.** Once Redis is configured, `api/spin` no longer waits
> for every write before redirecting. It writes `slot.svg` + the counters to Redis
> (~10–20ms), then redirects **immediately**; the profile-README update happens in
> the background. The redirect target is computed _before_ any slow write, and the
> language→repo cache refreshes in the background on a cold cache, so the time from
> _click → page reload_ is bounded only by the fast KV writes, never by a GitHub
> PUT or a cold `/languages` scan. Every KV call also has a **timeout** (`KV_TIMEOUT_MS`,
> default 500ms) with automatic fallback to GitHub, so a slow/down Redis can never
> make the slot slower than the original.

If the env vars are **absent**, the code transparently falls back to the original
GitHub-Contents behaviour, so local `vercel dev` keeps working unchanged. No code
changes needed to toggle between the two.

> **Get an Upstash DB:** upstash.com → "Redis" → create a free database **in the
> `fra1` region** → copy the `UPSTASH_REDIS_REST_URL` and
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
