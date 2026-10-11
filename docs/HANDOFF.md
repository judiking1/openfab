# OpenFab current development handoff

## Current state

- This public repository is the single active development source.
- OpenFab Builder is a `0.x` preview; Editor V1 static authoring remains incomplete.
- The active app is `src/App.tsx -> src/tilefab/editor/TileFabApp.tsx`.
- The canonical document, compiled physical paths, atomic history, and typed Worker mirror
  remain the common boundary for editing, rendering, and read-only 3D inspection.
- v0.1.111 is published; AISLE-to-Bay integration is committed locally and remains unpublished.
  A synchronized rail mirror does not authorize simulation.
- CI builds pushes and pull requests. Full regression and authoring checks run only when
  `run_full_validation` is enabled in a manual workflow dispatch.
- Pages publication continues through `gh-pages`; CI build completion alone is not publication.
- Infrastructure checks passed: complete public working-tree/index audits and hook, 26 isolated
  safety/hook scenarios, 6 additional hook/index-flag checks, and 10 fixture-provenance tests. App and release checks are separate.

- 0.1.111 adds rail-structure descriptions, certified default metrics and one fixed crossover rail skeleton (808 cells; no Bay organizations or equipment).
- Candidate verification: ordinary build and source Biome/ESLint PASS; full unit suite 460 files / 5,835 tests PASS, 2 existing tests skipped, no failures.
- AISLE implementation: 36 focused tests, TypeScript, ordinary build, public safety and independent core review PASS. Earlier candidate Chrome 1440/390 Apply/Undo/Redo/cancel/Escape PASS; switch-fixture 1440 and final compact-action/draft-preservation 390 checks PASS. Full unit/authoring/scale/native-OS suites not run for this change.

## Development commands

Use the Node and pnpm versions declared in `package.json`.

```sh
pnpm install --frozen-lockfile
git config --local core.hooksPath .githooks
pnpm dev -- --host 127.0.0.1 --port 5181
pnpm check:core
pnpm test -- --run
pnpm check:public-safety
pnpm check:public-release
pnpm build
```

The commit hook runs `node scripts/openfab-public-safety-audit.mjs --staged` against
all index entries and their staged content, including the staged manifest.
The hook and audit code must match their staged bytes before the hook executes.
The ordinary audit checks all tracked working-tree files. Untracked files are not publication
inputs; stage reviewed files before the final audit. Keep local projects and evidence ignored.

Manual area checks reuse `check:authoring`, `check:project`, `check:scale`, and `check:3d`.
The authoring CI job runs the existing authoring, public-bundle, and live-demo checks directly
in this repository. Routine development does not export or reinstall a second source snapshot.

## Next work and completion conditions

1. Review compact tool discovery as the next small V1 task; preserve the verified
   production build. Preserve unfinished work and saved user data outside public commits.
2. Record the candidate's actual checks and any omissions here. Do not carry private execution
   logs or claim unrun suites passed.
3. Publish only a reviewed release bundle using the existing Pages path. Verify the deployed
   version, asset loading, and a simple authored edit with undo. Release tags may identify
   reviewed bundles; a development commit is not an automatic release.
4. Continue the Editor V1 guided 2D authoring gates defined in the public release baseline.
   Keep simulation gated and use independently authored synthetic layouts.

Read `AGENTS.md`, the public release baseline, rail construction rules, and FAB layout rules
before implementation. `VISION.md` and `DEPLOYMENT_STRATEGY.md` govern architectural decisions.
