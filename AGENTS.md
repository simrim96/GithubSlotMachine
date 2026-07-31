# GithubSlotMachine — Hermes Agent Context

## Stack
Node.js 18+ ES modules · Vercel Edge Functions · Upstash Redis · Vitest + Playwright E2E · ESLint + Prettier

## Architecture
The project generates an animated SVG slot machine (your GitHub profile README) via serverless functions. A "spin" fetches the user's top language on GitHub (via cache), picks a random repo in that language, renders the SVG, and stores the result for future image serving.

## Key paths
- `api/spin.js` — main spin handler (calls `api/_lib/game.js`)
- `api/lever.js` — repo selector endpoint
- `api/image.js` — serves the generated slot.svg to end users
- `api/cache-refresh.js` — language→repo cache population cron target
- `api/_lib/` — shared libraries: `game.js`, `github.js`, `kv.js`, `state.js`, `config-loader.js`, `ratelimit.js`, `response-bridge.js`
- `api/_lib/svg/` — SVG building: `svg-builder.js`, `svg-builder-accessible.js`, `svg/*.js` (components), `analysis.js`
- `scripts/` — dev helpers: `preview-server.mjs`, `gen-previews.mjs`
- `tests/` — vitest unit tests (301 tests, ~100% coverage)
- `slot.svg` — live output image (never commit — diverges per spin)
- `state.json` — local state cache (never commit — diverges per spin)

## Important rules
- `state.json` and `slot.svg` are gitignored AND blocked by a pre-commit hook. Use `git add -n` to verify, then `git commit --no-verify` if needed.
- Commit convention: `git add` only the files you changed (selective), then `git commit --no-verify` (pre-commit hook rejects state.json/slot.svg).
- Tests: `npm test` (vitest run)
- Lint: `npm run lint` (should be clean)
- Format: `npm run format:check` (Prettier: single quotes, semicolons, 80ch, no tabs)
- E2E: `npm run test:e2e` (Playwright)
- All files are ES modules (`"type": "module"` in package.json)
- Vercel config: `vercel.json` sets region `fra1`, cron job on `/api/health` daily
- Prettier ignores: `.prettierignore` (default patterns)
- ESLint: `.eslintrc.json` with `eslint:recommended` + `import` plugin, globals for vitest in tests/

## SVG generation
SVGs are built procedurally in `api/_lib/svg-builder.js` (and `svg-builder-accessible.js`). Components live in `api/_lib/svg/`. When the user asks about SVG layout/UI changes, ask for visual verification.

## Environment
- `GITHUB_PAT` — GitHub personal access token (required for API calls)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis connection
- `SENTRY_DSN` — error tracking (optional)
- `.env.example` documents all required variables
