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
