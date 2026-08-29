# Changelog

All notable public OpenFab changes will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and public releases will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-29

### Added

- Public-release safety allowlist and strict release blocker audit.
- Guided 2D static-FAB journey through rail construction, port-first equipment, Process Loop reuse,
  Bay, Bay Bank, Interbay, Fab circulation, exact Checks, native save, and same-project reopen.
- Exact persistence/recovery and whole-app Worker lifetime acceptance evidence.
- Desktop, 760 px, and 390 px keyboard, focus, target-size, and retained-memory release checks.
- History-independent public-export dry run with exact Git-index identity, clean dependency install,
  public-safety re-audit, and production build.
- Frozen production-dependency license audit with exact platform-neutral rows, constrained native
  optional packages, reviewed license IDs, CI enforcement, and third-party notice reconciliation.
- Synthetic fixture provenance audit with exact generator sources and checksums, plus rejection of
  undeclared public data-bearing files and stale certified preset artifacts.
- Production live-demo browser smoke for first-run Guided entry, Builder capability boundaries,
  static simulation readiness, responsive layout, and browser/network error detection.
- Automated release-identity audit for the `openfab-builder` package name, exact three-part SemVer,
  private npm guard, pre-license `0.x` rule, browser metadata, product-series docs, and Changelog.
- Public pull-request template for user outcome, `release.feature.fix` impact, invariants, complete
  verification evidence, memory/process-swap results, and proprietary-data/IP safeguards.
- Apache License 2.0 with copyright held by 이원배, plus the root OpenFab notice.

### Changed

- Guided Build progressively hides duplicate, Expert, and deferred controls while preserving the
  ordinary project, edit, Canvas, Activity, Help, and command paths.
- Guided missions now reveal Activity owners cumulatively from canonical mission state, keep the
  current active owner reachable during detours, keep the mission panel as the sole current-input
  explanation, and defer duplicate action/Assembly/Blueprint launchers until their learning slice.
- Guided Build hides its redundant single rail subtool until Erase becomes a real alternative, and
  the Ports mission reveals only the currently required OHB, EQ, or STK tool before cumulatively
  restoring all three after completion. Explicit active-tool detours remain visible.
- Guided Build now defers the construction bar through First Rail because Smart Route is already
  active, then presents only Smart Route after the first authored rail while revealing Erase and
  route-bend controls. An explicit numeric-module or Q/E detour temporarily restores the owning
  controls; returning to Smart Route/AUTO hides them again.
- First Rail now defers AUTO/X→Z/Z→X corner choices until a rail exists; Q/E still reveals an
  explicit detour, and returning to AUTO hides the choices while restoring Canvas focus. Guided
  Help, Project-menu Escape, and renamed Browser Library records also retain exact focus ownership.
- Guided Build replaces twelve always-visible locked mission chips with one accessible current-step
  progress bar. The panel announces the exact current title and `step / 12` without exposing future
  locked objectives or consuming a second row at notebook and mobile widths.
- Guided Build no longer repeats a baseline `MISSION n · NAME` eyebrow beneath the current title and
  progressbar. Only meaningful substeps such as `STEP 2/3`, `FIX`, or `WRITING` remain, while the
  progressbar accessibility value follows the exact active substep title.
- Early Guided missions present the header validator as neutral `CHECKS` instead of a premature
  warning. Opening it explicitly restores the real check state, and closing it re-defers the warning
  until the canonical Checks mission while preserving focus and Expert access.
- FAB Presets replace ambiguous public `CERTIFIED` claims with scoped `OPENFAB VERIFIED` evidence.
  Hydrated shipped artifacts name rail geometry, directed topology, and organization as verified
  while explicitly marking Port Service as not checked; stable artifact/protocol names are unchanged.
- Compact Project, Checks, Preset, Undo, and Help controls now meet the 44 px target contract;
  Project actions receive first focus and support Arrow/Home/End navigation with Escape return.
- Recovery notices defer to the open Assemble task surface instead of covering task actions.
- Builder production keeps the 2D state visible while deferring Twin View and simulation controls
  behind explicit later-series capability flags; private 3D/runtime acceptance remains available.
- Public CI locks the initial gzip budget and prevents deferred 3D, simulation configuration,
  readiness, or large preset entries from becoming static initial imports.
- Public-facing documentation now describes OpenFab Builder and the `1.x`/`2.x`/`3.x` product
  series without claiming a completed public release.
- The production web artifact now uses relative asset URLs so the same build can be hosted at a
  domain root or repository subpath; live-demo smoke runs on an owned header-free static server
  under a synthetic subpath and rejects clipped Guided/Checks surfaces and HTTP errors.
- The production document now identifies OpenFab Builder consistently in its title, application
  metadata, Korean language declaration, description, theme color, and request-free inline icon.
- The incubation package is named `openfab-builder`; its version remains `0.1.0` until the public
  release gate and owner license are complete.
- Default Builder development and hosting no longer force simulation-only COOP/COEP headers or a
  Vercel-specific configuration; opt-in runtime mode retains and tests cross-origin isolation.
- Notebook-width topbars no longer let duplicate project/assembly shortcuts overlap project and
  Checks controls; Open, Save, Undo/Redo, 2D, Fit All, and Help remain immediately available.
- Responsive New Project dialogs now restore focus to the stable Project trigger when their menu
  launcher unmounts; long-lived Canvas and organization-outline effects read current lifecycle
  actions without render-time rebinding.

## Release policy

`0.1.0` is the clean public preview. No `1.0.0` entry or tag is permitted until the clean public
export passes its strict release gate and the live demo is built from that exact public commit.
