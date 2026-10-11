# OpenFab repository instructions

This public repository is the single active development source for OpenFab, a web-first,
open-source Factory Digital Twin Platform. The current Builder is the static-authoring stage.
Work on `main`; create other branches or worktrees only when the owner requests them.

## Read before changing code

1. `docs/HANDOFF.md` — current state, commands, and next work.
2. `docs/openfab-editor-v1-release-baseline.md` — product and release gates.
3. `docs/rail-construction-v3.md` and `docs/fab-layout-authoring-rules.md`.
4. `VISION.md` and `DEPLOYMENT_STRATEGY.md` for architectural or platform decisions.

The strategy documents govern direction; the release baseline governs the product gate.
Update the short HANDOFF when current state, next work, or verification status changes.
Keep historical execution logs, local paths, and private review material outside this repository.

## Code and product boundaries

- The active app is `src/App.tsx -> src/tilefab/editor/TileFabApp.tsx`.
  Keep work within `src/tilefab/**` unless the current task explicitly expands it.
- Preserve the directed 1 m TileMap grammar and compiled physical paths.
  The serializable project is the source of truth; rendering objects are derived.
- Keep domain logic outside React and free of direct browser or platform APIs.
  Access storage and files through interfaces and adapters.
- Authored mutations must be atomic, undoable, and mirrored through typed Worker patches.
  Add focused tests for topology, persistence, and Worker contract changes.
- Complete modular rail construction, native save/load, port-first equipment authoring,
  and complete 2D static editing/validation before a derived 3D product and OHT simulation.
  The existing read-only 2D/3D inspection switch is permitted while V1 authoring continues;
  it must preserve the canonical document, unfinished edits, and safe return to 2D.
- A synchronized rail Worker is not simulation approval. Keep the simulation-readiness gate.
  Do not introduce a second editable 3D map, resume legacy editor paths, or add desktop
  packaging, marketplaces, or simulation ahead of the product gate.

## Public-source safety

- Independently implement algorithms. Never copy company source, comments, identifiers,
  or file structure. Use independently authored synthetic fixtures only.
- Never commit customer/company layouts, maps, operational data, internal documents,
  credentials, saved user projects, or local evidence. Report suspect material instead.
- Every tracked file must be covered by the public manifest. Review new file categories
  before adding them to `docs/openfab-public-export-manifest.json`.
- Configure this clone with `git config --local core.hooksPath .githooks`.
  The pre-commit hook checks the complete staged snapshot; do not bypass it.
- Do not merge private repository history into this public repository.

## Verification and publication

Use the existing commands and focused tests; avoid duplicate harnesses or relaxed budgets.
`pnpm check:public-release` and the ordinary `pnpm build` precede Builder publication.
Full unit and authoring suites are manual diagnostics and do not block publication.
Preserve existing assertions and record omitted checks as not run, never as passed.
Validate actual Pages loading and a simple edit after publication. Use the existing
`gh-pages` publication path and a verified release bundle; do not publish every development
commit or change release timing without owner direction. Keep release versions and
CHANGELOG consistent; a `0.x` preview does not declare V1 complete.
