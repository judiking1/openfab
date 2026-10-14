# OpenFab current development handoff

## Current state

- This public repository is the single active development source.
- OpenFab Builder is a `0.x` preview; Editor V1 static authoring remains incomplete.
- The active app is `src/App.tsx -> src/tilefab/editor/TileFabApp.tsx`.
- The canonical document, compiled physical paths, atomic history, and typed Worker mirror
  remain the common boundary for editing, rendering, and read-only 3D inspection.
- v0.1.114 bundles guarded-save guidance, safe Blueprint file handling and straight organization placement.
  A synchronized rail mirror does not authorize simulation.
- Unreleased file-open boundary: project, Blueprint and library restore share picker-only
  cancellation handling. Selected-file getFile/text/stream failures remain failures; input
  fallback rejects operation aborts and ignores late cancel/change events after selection.
  Existing failure UI preserves the document, library and unfinished import metadata.
  Verification: 177 adapter tests PASS (51 new stage-specific regressions), ordinary production
  build, changed-file lint, public release checks and independent code review PASS. Controlled
  Chrome 1440/390 picker/read-failure checks preserve project identity/checksum, dirty state,
  library and import drafts; Undo/Redo PASS. All 73 candidate assets load with matching hashes.
  Actual OS file acceptance and full authoring/scale/unit suites were not run for this change.
  Hold this local candidate for the next release bundle; v0.1.114 remains deployed.
- CI builds pushes and pull requests. Full regression and authoring checks run only when
  `run_full_validation` is enabled in a manual workflow dispatch.
- Pages publication continues through `gh-pages`; CI build completion alone is not publication.
- Infrastructure checks passed: complete public working-tree/index audits and hook, 26 isolated
  safety/hook scenarios, 6 additional hook/index-flag checks, and 10 fixture-provenance tests. App and release checks are separate.

- 0.1.111 adds rail-structure descriptions, certified default metrics and one fixed crossover rail skeleton (808 cells; no Bay organizations or equipment).
- 0.1.114 release verification: one full `pnpm test` run, 464 files / 5,911 tests PASS and 2 existing tests skipped; no failures. Ordinary production build (including TypeScript), public release checks and normal staged safety hook PASS. Independent code review and fixed-candidate Chrome 1440/390 Blueprint placement, Undo/Redo and save-cancellation checks PASS. Full authoring/scale/native-OS suites were not run.
- AISLE implementation: 36 focused tests, TypeScript, ordinary build, public safety and independent core review PASS. Earlier candidate Chrome 1440/390 Apply/Undo/Redo/cancel/Escape PASS; switch-fixture 1440 and final compact-action/draft-preservation 390 checks PASS. Full authoring/scale/native-OS suites not run for this change.
- Compact UI candidate: ordinary build, Biome/ESLint, public safety, and Chrome 390/1440 tool-draft preservation and Bay settings/cancel/Apply/Undo/Redo PASS. Bay fields/actions fit without horizontal scrolling; collapsed targets remain 44 px. At 844x390, categories scroll with tools and keyboard-focused rail/FAB actions are fully visible. Independent code review PASS; independent GUI not run because browser launch was blocked.
- Equipment rail return: OHB/EQ/STK prerequisite navigation retains only the current document and requested tool. Missing rail offers construction with a short reason; prepared rail returns to that tool. Explicit tool changes, preparation cancellation, and document replacement clear the intent. No equipment is placed automatically.
- Candidate verification: 5 focused files / 57 tests, ordinary production build, ESLint, Biome (one existing warning), diff check, and public tracked-source audit PASS. Chrome 390/1440 return/cancel/Esc/tool-change, insufficient rail, cancellation followed by Undo/Redo, and new-document checks PASS; primary targets remain 44 px with no horizontal overflow. Independent code review found no blocker. Full authoring suite not run for this change.

- Integrated authoring at 760x1000 PASS: from a fresh blank document, the public FAB-making task created 2 Banks / 12 Twin Bays / 24 Process Loops; EQ pitch and body edits, OHB service reversal with Undo/Redo, and FLEX Stocker placement completed in the same project. Final Checks passed with 6,506 rail cells, 5 Ports, 3 equipment groups and 39 organizations; zero issues/page errors and simulation remained disabled. No blocking defect or code change was needed. Save/reopen/native chooser and full suites were not run; no additional viewport checks were needed for an unobserved defect.

- 0.1.114: guarded project transitions now keep save cancellation, failure, download-request,
  changed-source and Save As guidance inside the dialog, with matching accessible status. Open
  retry guidance preserves the existing saved receipt. Focused persistence tests: 3 files / 136
  PASS; ordinary build, ESLint, changed outcome-file Biome and public safety PASS. Independent
  code review and controlled-picker UI checks at 390/760/1440 px PASS; native OS acceptance
  remains unverified. No change to write completion, dirty/recovery or transition gates.

- 0.1.114 Blueprint file handling distinguishes completed writes, download requests and picker
  cancellation. Quarantined source rows remain until a completed write and the existing comparison
  check permit removal; write failures remain failures. Import metadata and cancel controls are
  disabled during insertion. Straight organization blueprints now pass the same span rule in the
  Worker transport as in the domain validator, including all four rotations.
  Verification: 8 focused files / 263 tests and 2 filtered Worker cleanup tests PASS; ordinary build,
  changed-file lint, public safety and independent code review PASS. Isolated Chrome 390 px checks
  passed for import cancel/busy controls, mocked write outcomes, download-request guidance, and
  synthetic export/import followed by placement, Port/equipment/organization preservation and
  Undo/Redo. File pickers/writes were controlled test doubles; downloads were observed only as
  requests. Actual OS file roundtrip and full authoring/scale suites were not run.

- Isolated automatic recovery PASS: exact project identity/checksum restored, followed by EQ pitch editing, OHB service reversal, and Stocker Port membership editing with Undo/Redo. Native Save/Open remains unverified: the native save action immediately returned cancellation, retained the dirty document and produced no file; the cause was not established and no workaround was attempted.

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

1. Complete actual native file Save/Open acceptance in an environment where the picker can finish.
   Do not treat the cancelled QA attempt as a pass or declare V1 complete; preserve user data.
2. Record the candidate's actual checks and any omissions here. Do not carry private execution
   logs or claim unrun suites passed.
3. Publish only a reviewed release bundle using the existing Pages path. Verify the deployed
   version, asset loading, and a simple authored edit with undo. Release tags may identify
   reviewed bundles; a development commit is not an automatic release.
4. Continue the Editor V1 guided 2D authoring gates defined in the public release baseline.
   Keep simulation gated and use independently authored synthetic layouts.

Read `AGENTS.md`, the public release baseline, rail construction rules, and FAB layout rules
before implementation. `VISION.md` and `DEPLOYMENT_STRATEGY.md` govern architectural decisions.
