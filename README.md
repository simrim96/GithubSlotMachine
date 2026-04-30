# 🎰 GithubSlotMachine

An animated, recruiter-friendly **Slot Machine** for your GitHub profile README.
Reels of programming languages from your stack — every win surfaces a **fun fact** about the language and links to one of your repos that uses it for **≥ 30%** of its codebase. A persistent **community spin counter** is shown on the slot and (optionally) inside your profile README.

---

## ✨ Features

- 🎯 **Programming languages as icons** — currently `C++`, `GLSL`, `React`, `JavaScript`, `Python`. Easy to extend (see below).
- 🧠 **Educational wins** — each language ships with a curated list of fun facts / descriptions; a random one is shown on every win.
- 🔗 **Auto-discovery of your repos** — on a win, the API scans the owner's public repos and picks one that's at least 30% the winning language (per the GitHub Languages API). The user is then redirected straight to that repo.
- 📊 **Live community counter** — total spins (and total wins) are persisted in `state.json` and displayed on every render.
- 💎 **Polished visuals** — gradient background, neon header, glowing paylines, animated reels, win/jackpot/freespin overlays, near-miss tease.

## 🧩 Architecture

```
api/
  spin.js           # main endpoint: spin, update slot.svg + state + README
  image.js          # serves slot.svg with aggressive no-cache headers
  _lib/
    languages.js    # languages config + SVG symbol renderer (extensible)
    repos.js        # cached lookup: language → best matching repo (≥30%)
    state.js        # read/write state.json (spin counter, last win)
state.json          # auto-generated/updated by the API
slot.svg            # auto-generated/updated by the API
```

Folders prefixed with `_` are ignored by Vercel's serverless routing — they're treated as private libs.

## ➕ Adding a new language

Open `api/_lib/languages.js` and append an entry to the `LANGUAGES` array:

```js
{
  id: 'rust',
  name: 'Rust',
  short: 'Rust',
  glyph: '🦀',
  color: '#dea584',
  accent: '#000000',
  text: '#1a1a1a',
  githubLang: 'Rust',           // exact name from GitHub Languages API
  // topic: 'wasm',              // optional: require this topic on the repo
  facts: [
    'Rust è "memory-safe" senza garbage collector grazie al borrow checker.',
    '...',
  ],
}
```

That's it — the symbol is rendered automatically, the reels are reweighted, and on a Rust win the API picks one of your Rust-heavy repos.

For frameworks that aren't strictly a language (e.g. React), set `githubLang` to the host language (`'JavaScript'` / `'TypeScript'`) and `topic` to require a GitHub topic on the repo (e.g. `'react'`).

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
> 🏆 **Last win:** `Python` → [my-cool-ml-project](https://github.com/simrim96/my-cool-ml-project)
> _Python prende il nome dai Monty Python's Flying Circus, non dal serpente..._
<!-- SLOT_LAST_WIN_END -->
```

If the markers aren't present, the README is left untouched (the slot SVG still shows everything inline).

## 🚀 Behavior on click

- **No win** → redirect to the GitHub profile.
- **Win**   → redirect to the matching repo (≥ 30% of the winning language). Falls back to the profile if no repo qualifies.

## 🔐 Configuration

Required env var on Vercel:

- `GITHUB_PAT` — a fine-grained PAT with `Contents: read & write` on both `GithubSlotMachine` and the profile repo, plus `Metadata: read` for the repos list.
