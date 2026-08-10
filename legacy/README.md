# Legacy (deprecated)

This folder holds the **original** implementation of the slot, built as a
standalone Python script (`GenerateSlot.py`) driven by a GitHub Action
(`play.yml`) that committed a classic emoji slot (`SlotTemplate.svg`) back to
the repo.

It has been **superseded** by the Vercel serverless version under `api/`, which
is what the project actually runs today (see the root `README.md`). The Python
version has no language/repo-discovery logic and is kept here only for
reference/history.

Do not run it from the root repo paths — the moved files still reference
`SlotTemplate.svg` relative to where they now sit.

The GitHub Action (`play.yml`) that drove the script is **inert**: it lives at
`legacy/.github/workflows/play.yml`, a path GitHub does not scan for workflows
(only the root `.github/workflows/` is picked up), so it can never run. The
current production path is `api/spin.js` → `api/_lib/game.js` → SVG builders.

**Decision (2026-08-10): kept for history.** No code or config references these
files; the root `README.md` documents this folder as history only. Removal was
considered but rejected: the archive is intentionally referenced by the root
README as the deprecated Python/GitHub-Action implementation.
