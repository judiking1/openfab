# Changelog

All notable public OpenFab changes will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and public releases will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.31] - 2026-09-29

- Keep the exact legal Port marker when switching from a Process Loop scope back to all Port
  slots. The scope change remains transient: no project mutation, history entry, or Worker patch.
- Name the `다른 Port` action's local X/Z ±32 m search area and provide visible recovery when
  its candidates are exhausted, including projects without a Process Loop. Keep keyboard focus
  on the action after failure and announce the reason to assistive technology, including when
  the same failure happens twice in a row. Match its accessible name to the visible label.
- Exercise unscoped EQ and two-Port FLEX Stocker creation, explicit Loop ownership, Checks,
  Save, and native reopen through visible 390/760/1440px controls. Candidate discovery can still
  cross Loop boundaries; a successful Port slot alone does not guarantee group ownership.
- Keep six-Port and B2B Stocker draft labels clear of the compact camera controls at 390×600.
  A frame that cannot contain the whole vertical group still keeps the feasible horizontal
  selection together and places the current Port caption beside the obstruction.

## [0.1.30] - 2026-09-29

Private `e57a01c` and exact public `ba67428` were normally pushed. Both public CI jobs passed
in `36500412735`; Pages `3bc62bf` deployed in `36503025124`. All 65 live files and both entry
URLs matched the reviewed build SHA-256. V1 remains incomplete.

- Let an unscoped OHB, EQ, or Stocker use an explicit Inspector action to join its sole
  route-eligible Process Loop. When none is eligible, explain the missing route. Valid
  projects cannot have several eligible Loops because same-kind rail ownership is exclusive.
  Ownership still changes only after a user action and remains undoable.
- Update the Checks footer when asynchronous validation passes, finds issues, or fails, and
  identify the scrollable equipment and organization results on a short compact screen.

## [0.1.29] - 2026-09-29

Private `2bca6a1` and exact public `d027de8` were normally pushed. Both public CI jobs
passed in `36486220607`, and Pages `995ec44` deployed in `36489224740`; all 65 live
files and both entry URLs matched the reviewed build SHA-256. V1 remains incomplete.

- Complete a visible-control browser journey from both Blank Canvas and Verified Template at
  390×600, 760×900, and 1440×900: build rails, place OHB, three-Port EQ, and two-Port FLEX
  Stocker, assign each directly to a Process Loop, pass Checks, save, and reopen the exact
  equipment and ownership in a fresh session. Input choices come from rendered controls and
  painted Port targets rather than diagnostic model coordinates.
- Keep the Stocker completion action visible for every short-screen draft, including a full
  six-Port draft without a selected Process Loop, while leaving clearance for the active Port
  caption beside the 390px camera controls. Let expanded EQ settings scroll on a short screen
  while checking that every pitch control and Recipe input remains visible and clickable.

## [0.1.28] - 2026-09-29

Private `fd6c633` and public `acf01ff` were normally pushed. The exact 1,039-file public
export and ordinary public build passed, but public CI `36475041557` failed its `authoring`
job on a 390×600 Linux EQ settings dock assertion. This source was not deployed to Pages;
the verified 0.1.27 build remains live.

- Show a direct shortcut to the exact OHB group just placed, while keeping repeat placement
  available. The shortcut opens the Inspector and focuses its Process Loop ownership action.
  It expires after another authored change, Undo/Redo, or project replacement.
- Keep the shortcut in the existing action row at compact widths. Check the 390/760/1440px
  touch route from a verified template through OHB creation, Inspector handoff, direct Loop
  ownership, and Undo/Redo without a Canvas reselection; also check a second OHB, Undo before
  shortcut activation, repeated keyboard placement and Tab order at 15 widths. The final-source
  authoring gate passed 72 steps with 579 screenshots and no browser errors.

## [0.1.27] - 2026-09-29

Private `bfa76f9` and public `75ee0c2` were normally pushed. Both public CI jobs passed in
run `36468419905`; Pages `c12f039` deployed in run `36472282936`. All 65 served files
(26,999,989 bytes) and both entry URLs matched the reviewed build SHA-256. V1 remains incomplete.

- Add a visible “다른 Port 보기” action for ordinary OHB, EQ, and Stocker placement. It moves
  the current Canvas target within the selected Process Loop without changing authored data,
  keeps EQ endpoints on the same directed lane, and preserves Stocker drafts. Search stays
  within 32 m and checks at most 64 dynamic candidates per tap; another tap continues an
  unfinished local sweep. Restore Canvas focus and explain a full Stocker draft or missing
  nearby candidate in context.
- Exercise first OHB placement from Blank Canvas and a verified synthetic template at
  390×600, 760×900, and 1440×900 using the visible action and real touch input. Keep the
  existing scoped EQ/Stocker draft and Loop-ownership browser checks.
  The final-source authoring gate passed 72 steps with 576 screenshots and no browser errors;
  4,754 unit tests passed across 428 files with two existing skips. The strict public-release,
  initial bundle, four-width live smoke, and 10k/50k/100k-cell scale checks also passed.

## [0.1.26] - 2026-09-29

Private `06333d8` and public `dddd4ba` were normally pushed. Both public CI jobs passed in
run `36458506306`; Pages `649ab87` deployed in run `36462287378`. All 65 served files
(26,995,600 bytes) and both entry URLs matched the reviewed build SHA-256. V1 remains incomplete.

- Clarify the start chooser when an authored FAB is already open: `BLANK CANVAS` returns to
  the current project without clearing it, and a new empty project starts from the Project menu.
  Explain that verified templates contain synthetic rail/FAB structure but equipment must be
  placed separately; from an existing project the template dialog offers new-project and
  in-place placement paths.
- Raise start chooser card, recovery, and introduction text sizes while preserving reachable
  controls on short screens. Browser acceptance exercises all three choices at 390×600,
  760×900, and 1440×900, including hit areas, horizontal overflow, unchanged project/Worker/
  history on return and cancellation, and actual template-dialog actions.

## [0.1.25] - 2026-09-29

Public `main` `47fdb49` passed both CI jobs; Pages `74dd2d1` deployed successfully.
All 65 served files and both entry URLs matched the reviewed build SHA-256.

- Keep the Stocker completion actions visible inside a short, Loop-scoped equipment dock.
  Reserve scroll room for its wrapped action row and bring Loop refusal feedback above that row,
  so the message remains visible while the template selector and enabled completion button
  remain clickable.
- Add a self-generated three-rectangle, two-Process-Loop acceptance fixture with adjacent Port
  candidates inside the same hit radius. Exercise OHB, EQ, and FLEX Stocker wrong-Loop refusal
  without project, Worker, history, or visible draft mutation; then verify legal creation, direct Loop ownership, Undo/Redo, and
  native save/reopen with all three groups in one project. Reject dynamically occupied Stocker
  routes even when their static slot remains legal. Recheck refusal after both FLEX Ports are
  drafted: the message stays visible, the enabled completion control stays clear, and the
  template remains reachable by keyboard without changing the visible draft.

## [0.1.24] - 2026-09-28

- Show the current project name and save state in the compact header. Distinguish an untouched
  Blank Canvas, a newly generated preset that still needs a file, unsaved edits, an active save,
  and a downloaded or read-only file copy without changing the existing dirty-project protection.
  Keep project, Checks, Guide Resume, Save, and Help actions reachable on narrow screens. Truncate
  long filenames before the save state and use a short visible `사본 있음` label on narrow screens.
- For a Process Loop with no directly eligible Port slots, show the scoped zero count and a
  specific recovery action in the main OHB/EQ/Stocker instructions. Suppress unrelated global
  Port marks on the Canvas while that Loop is selected. Browser acceptance uses an independently
  generated turn-only Loop to verify refusal without project/Worker/history changes, recovery
  to all slots, one atomic OHB creation, and Undo/Redo at 390×600.
- Scope candidate wording only to ordinary Port placement; Guided Build and OHB move/copy keep
  their own instructions when an ordinary Loop choice was left selected. Keep Port targets visible
  during EQ/Stocker group edits, and recommend adding straight rail when even the global slot
  count is zero.
- Bound compact header commands to an internally scrollable track so an offscreen action cannot
  shift the entire app root and misplace the derived 3D Inspector. Cover phone widths below
  390px and the paused Guide breakpoint around 450px.

## [0.1.23] - 2026-09-28

Public `main` `5eb25dc` passed both jobs of CI `36419502758`; Pages `b142873` deployed
successfully. All 65 served files and both entry URLs matched the reviewed build SHA-256.
V1 authoring remains incomplete.

- Put an explicit “이 Process Loop에 소속” action directly below the selected OHB, EQ, or
  Stocker Inspector header. It remains visible with compact details closed, appears only for
  an eligible unowned group in the selected Loop, and reuses the atomic membership command.
  After attachment, show the owned Loop in the same place and move keyboard focus to it.
- Exercise an ordinary two-Port FLEX Stocker from two real Canvas Port clicks inside one Loop.
  Both draft clicks leave the project and Worker unchanged; completion creates one group and
  two exact-barcode Ports in one patch. Verify placement and direct ownership through Undo/Redo,
  Checks, native save, and reopen in the three-width Blank Canvas journey. The first-screen
  template journey also verifies EQ ownership Undo/Redo.
- Describe the visible `검사` tab's zero badge and the passing panel heading in the Guided
  Checks instruction, including after file reopen. Browser acceptance checks the prompt against
  those rendered controls.
- The final-source authoring acceptance passed 68 steps / 560 screenshots with no browser errors.
  Core, 428 test files / 4,750 passing tests (two existing skips), build, zero-warning lint,
  Biome (zero errors), and the public bundle audit passed with zero measured swaps.

## [0.1.22] - 2026-09-28

Public `main` `cd9ec7f` passed both jobs of CI `36411689639`; Pages `f7767a0` deployed
successfully. All 65 served files and both entry URLs matched the reviewed build SHA-256.
V1 authoring remains incomplete.

- Keep the ordinary Port marker hidden while a Process Loop change replaces its cursor, then
  repaint after the selected Loop commits even when React reuses the same marker and keyboard
  state. This prevents a previous Loop target from appearing during a rapid Stocker scope switch.
- Make the 390×600 recovery check wait for the selected Loop's rendered name and the matching
  Canvas target, marker row, and screen position. Evaluate the Loop identity, expected camera
  position, and complete visible target in one browser read so a transition between reads
  cannot produce a false pass or failure.
- Final-source authoring acceptance passed 68 steps with 558 screenshots and no browser errors;
  the 428-file unit suite passed 4,750 tests with two existing skips. Core, production build,
  lint, Biome, release safety, public bundle audit, and four-width live smoke also passed.

## [0.1.21] - 2026-09-28

Public `main` `1477205` passed local and exact-export gates, but CI `36402627212` failed
`authoring` during the rapid 390×600 Stocker Loop recovery. The assertion read an old valid
marker, then a new Canvas row in separate browser calls. The last verified Pages release is
still 0.1.19 until the corrected source passes public CI and served-file verification.

- Complete the actual first-screen Verified Template journey at 390 px: configure and create a
  14-Bay FAB, place OHB, three-Port EQ, and FLEX Stocker through visible Port targets, attach all
  three groups directly to a Process Loop, pass Checks, save a native `.openfab` file, and reopen
  with the same relationships, ownership, equipment, and Worker checksum.
- Put an explicit project-file Save action in the successful Checks panel. Keep it fully clickable
  at 390×844 and 390×600 by reducing the compact success row and scrolling the detailed pass
  results inside the short panel.
- Repaint the ordinary Port keyboard marker after React commits it. This closes a Linux CI race
  where changing a Stocker Process Loop updated the Canvas target but left the old marker offscreen.
  The same readiness and save checks still apply. Final local authoring passed 68 steps / 558
  screenshots / zero browser errors, and the 428-file suite passed 4,750 tests (two existing
  skips). Core, build, lint, Biome and public safety checks also passed. V1 remains incomplete.

## [0.1.20] - 2026-09-28

This source was pushed as public `b173943` but not deployed. CI `36393825757` passed `verify`
and failed `authoring` on the Stocker Loop marker race fixed in 0.1.21. The last verified live
Pages release remains 0.1.19 until a later exact-source CI and served-file check succeeds.

- Keep an EQ endpoint or Stocker Port draft intact when a user clicks a valid Port outside the
  selected Process Loop. Explain the scope mismatch beside the Loop picker and offer a different
  Loop or all Port slots as a recovery path. Compare the nearest original slot before applying
  the Loop mask so an adjacent in-Loop slot cannot be selected instead.
- Explain that changing the Loop discards an unfinished EQ endpoint or Stocker Port selection,
  including when switching back to all Port slots. Show the selected Loop's full name, disable
  keyboard and pointer start actions for a Loop with no eligible slots, and clear recovery text
  when placement resumes.
- When a Loop name or recovery feedback expands the equipment dock on a short compact screen,
  limit its height so the current keyboard Port marker remains in a visible Canvas band. Keep
  the dock scrollable for remaining Stocker controls. Reveal recovery feedback within that
  internal scroll area after a Loop change, including with Ubuntu font metrics at 390×600.
  Reveal the notice again when the same wrong-Port warning is repeated after manual scrolling.
- Extend the three-width ordinary equipment browser journey with EQ scope-refusal and recovery,
  unchanged project/Worker/history checks, and 390 px Stocker draft/all-slots recovery plus
  visible-marker boundary checks. The local full authoring gate passed 68 steps / 556 screenshots /
  zero browser errors; 428 test files passed 4,750 tests (two existing skips), Core, build, lint,
  Biome, public safety, bundle audit, and production smoke. Exact public export passed for
  private `7202977` / public `c8cf380`, but the first public CI exposed clipped recovery text;
  the first follow-up source passed all 68 authoring steps / 556 screenshots, 4,750 tests,
  build, lint, release safety, bundle and four-width smoke. A later read-only review found
  the repeated-warning gap; its focused 390px regression, final-source full 68-step gate,
  4,750 tests, Core, build, lint, public safety, bundle and four-width smoke all pass.
  Exact export passed for the final source; public CI found the separate marker race above.
  V1 authoring remains incomplete.

## [0.1.19] - 2026-09-28

Published Pages preview. Public `main` `f50b6cf`, CI `36379659268` (both jobs), and Pages
`1c71cb4` / deployment `36381897154` passed. All 65 served files (26,982,749 bytes) and
both entry URLs matched the reviewed build SHA-256. V1 authoring remains incomplete.

- Choose a Process Loop before ordinary OHB, EQ, or Stocker Port placement. Targeting and
  previews use that Loop's direct rail ownership; edits, OHB move/copy, and Station Proposal
  exact-slot review retain their own scopes. The picker is labeled `Port 배치 범위` to separate
  location targeting from the later ownership action, preserves keyboard focus, has an
  explicit 44 px action to return to Canvas placement, and uses one compact row below 520 px.
- Reuse the current organization role and record while the immutable organization state is
  unchanged, avoiding full hierarchy recomputation for each pointer candidate.
- Verify the visible Blank Canvas → Twin Bay → EQ/OHB/FLEX Stocker → direct Loop ownership →
  Checks → native save/reopen journey at 390×600, 760×900, and 1440×900. The focused run passes
  all three widths. Reopening the same project ID also clears the transient Loop scope while
  retaining exact authored equipment and Worker parity. The regular authoring run passed 68
  steps, 552 screenshots, and zero browser errors; final unit tests passed 4,750 tests with two
  skipped. Core, build, lint, project round trip, strict public safety, initial bundle audit,
  and four-width production smoke also passed locally. The exact public export, CI, and Pages
  verification passed as recorded above.

## [0.1.18] - 2026-09-28

Published Pages preview. Public `main` `4a2a89e`, CI `36372132693` (both jobs), and Pages
`5cc26f5` / deployment `36373764806` passed. All 65 served files (26,976,298 bytes) and
both entry URLs matched the reviewed build SHA-256. V1 authoring remains incomplete.

- Let a selected OHB, EQ, or Stocker group join an existing Process Loop explicitly from its
  Equipment Inspector. Offer only Loops whose direct rail or switch membership covers every Port
  route; show the current direct owner and require explicit separation before reassignment.
- Make attach and detach one undoable organization edit each, mirrored by the existing typed Worker
  patch. Preserve equipment, Ports, rail ownership, organization IDs, and the native project format.
- Keep the new choice collapsed after the ordinary equipment continuation action. Verify keyboard
  open/Escape focus, a 390×600 OHB attach/detach/Undo/Redo journey, and same-width native reopen.
  The complete first-user V1 journey and public release checks remain open.
- Reject an attach/detach click when the selected Port or group changed after the choice rendered.
  For directly owned equipment, disable move, Port membership edit, and delete until its ownership
  is explicitly cleared; ordinary copy remains available.
- Include Process Loop equipment membership as step 67 of the full authoring browser gate. The
  local run passed 67 steps, 548 screenshots, and zero browser errors. Strict public safety and
  provenance, the 20-file initial bundle (1,028,558 gzip bytes, with Three.js deferred), and
  production smoke at 1440/1280/886/390px also passed locally. Private `4ffd2b7` and exact
  public `4a2a89e` were normally pushed after the 1,037-file safe export. Public build/smoke,
  CI and Pages verification passed.

## [0.1.17] - 2026-09-28

Published Pages preview. Public `main` `1b0de9c`, CI `36366966395` (both jobs), and Pages
`2e0ff06` / deployment `36368903514` passed. All 65 served files (26,963,991 bytes) and both
entry URLs matched the reviewed build SHA-256. V1 authoring remains incomplete.

- Start short blank-project Rail authoring with a compact activity menu so the first pointer
  drag remains on the canvas at 390×600. Keep explicit menu-density choices across resizing
  and activity changes.
- Verify that an ordinary project retaining hand-authored OHB/EQ/Stocker also reaches final
  FAB assembly, then preserves its equipment, declared relationships, Worker parity, and
  settled Checks result through same-width native save/reopen at 390, 760, and 1440px.

## [0.1.16] - 2026-09-28

Published Pages preview. The 0.1.14 and 0.1.15 candidate changes below are included in this
verified release; those candidates were not separately deployed.

- Add a reachable Settings action for compact FAB presets and patterns, including the
  first-screen Verified Template path. Return keyboard focus to the canvas or preset
  launcher after closing the dialog.
- Check a nondefault 14-Bay preset from the first screen through creation, declared
  relationships, compact save, and file reopen.
- Resume Guided Stocker keyboard input from a freshly painted target after clearing a Port
  draft, including same-row targets and rapid Escape. Preserve an intentional focus change.

### Preview candidate 0.1.15

- Keep a direct Save action visible on compact public 2D screens after the first edit. Preserve
  the 2D/3D switch and FAB preset entry in development builds that enable derived 3D.
- Restore keyboard focus to the Guided Bay placement marker after responsive resizing, even
  when the marker is briefly hidden, while respecting a move to Help or Exit.

### Preview candidate 0.1.14

- Add previous/next, position, and Settings controls to the compact New Project starter;
  keep its preview and keyboard order aligned.
- Support a four-row OHB/EQ/Stocker Station Proposal review with exact slot selection,
  Worker evaluation, one undoable Apply, save/reopen, and failed-Apply recovery.
- Stabilize Help Escape and Guided EQ-to-Inspector handoff on short screens.

## [0.1.13] - 2026-09-28

Earlier published Pages preview. Older candidate notes below record the milestones included
before this release.

- Allow the last individually managed Bay in a declared Bank connection to be disconnected
  after an impact review. Preserve the other relationships, Bay content, Undo/Redo, Worker
  mirror, and native project round trip; shared or contact-only connections still refuse.
- Bind a Worker-prepared Bay disconnection to the live relationship and its exact rail cut
  before it can gain commit authority, including when a response has a self-consistent
  fingerprint and checksum.
- Load the derived Three.js view only when a user opens 3D inspection, reducing first-load
  JavaScript gzip by about 156 KiB in the measured fixed-baseline build. Audit the initial
  JavaScript graph to prevent accidental static inclusion of Three.js.
- Improve compact Bay review controls, text contrast, and short-screen Guided Build completion
  scrolling. Restore zero-error Biome/ESLint checks, and require own blueprint fields with safe
  canonical JSON key sorting.

### Preview candidate 0.1.12

- Reject edits and project activation outside V1's supported X/Z rail coordinate range
  of -130,048 to 130,048 metres, including advanced-switch reserved areas and blueprint previews.
  Keep the current project and history when an unsupported file cannot open; never recenter or
  truncate its coordinates. Native coordinate encoding is unchanged. This range is an authoring
  admission limit, not a simulation or clearance accuracy certification.

### Preview candidate 0.1.11

- Refuse rail edits that exceed equipment placement capacity before changing the project.
  Keep Undo/Redo, Worker state and native save/reopen intact, with a visible limit explanation.
- Wrap rail preview explanations within the unobstructed canvas so compact screens retain
  the full reason beside the authoring menu.

### Preview candidate 0.1.10

- Preserve every Central Spine Bay's envelope and two Process Loop contacts through native
  projects, certified preparation and portable copies, retaining existing geometry and ownership.
  These contact records do not enable Bay detachment or simulation.

### Preview candidate 0.1.9

- Preserve four declared Bank-to-FAB contacts in Full FAB presets through native projects,
  certified preparation and rotated assembly copies. Validate the planned junctions and owners
  across both halls while preserving the existing rail geometry.
- Verify equipment repeat/return against the selected Inspector device after its display is ready,
  independently of the earlier Worker synchronization snapshot.

### Preview candidate 0.1.8

- Reduce redundant work in rail ownership and checksum calculation while preserving exact
  fingerprints, module partitions, source validation and cooperative scheduling boundaries.

### Preview candidate 0.1.7

- Preserve every declared Paired FAB Bank contact through native projects and portable copies,
  including the Bay that directly owns each gateway connection.

### Preview candidate 0.1.6

- Keep Bay flow review cards tall enough for their text on short screens and preserve
  scrolling content with fixed action buttons at 390×600.

### Preview candidate 0.1.5

- Explain Bay disconnect/delete consequences in Korean, show retained and removed content first,
  and place detailed topology measurements in an accessible disclosure.
- Show failed or stale topology evidence truthfully and keep rejection reasons visible.
- Retry a blocked review from a fresh document snapshot and permit while preserving modal focus
  and the atomic apply boundary.

### Preview candidate 0.1.4

- Preserve two explicitly declared Bank-to-FAB contact relationships in Parallel Hall presets,
  including configured sizes, certified preparation, native save/load and rotated assembly copies.
- Bind inner gateways to exact planned junctions, directions and owners. Reject altered connection
  metadata or organization identity before accepting a prepared project.
- Reduce repeated large assembly placement delays by using the existing browser yield adapter
  during cooperative commit; retain cancellation checks, atomic publication and timing limits.

### Preview candidate 0.1.3

- Preserve explicitly declared Bank-to-FAB contact relationships in generated Production FABs,
  including project save/load, certified presets and complete portable assembly copies.
- Validate the exact producer records during preparation and certification. Shared circulation
  remains infrastructure; automatic Detach and simulation remain unavailable.
- Measure placement hint clearance and reset menu scrolling through the existing resize observers,
  avoiding forced whole-page layout during the editor's initial React commit.

### Preview candidate 0.1.2

- Make expanded authoring tool descriptions readable at 12px, wrap full names and instructions,
  and size each button to its content. Compact equipment placement retains its canvas space.
- Clarify that reference study informs modular rail rules, port-derived equipment and later
  comparison playback. CAD import is outside the product plan; CAD export is an optional idea.

### Preview candidate 0.1.1

- Show the package update version in the footer, including compact screens. This preview version
  does not indicate completion of the V1 authoring milestone.
- Use readable Korean inspection tabs, summary categories and correction actions; keep diagnostic
  codes and current-project validation unchanged.
- Document port/slot identity, derived equipment 3D, reproducible comparison and the distinction
  between demand replay and recorded-result playback as future requirements. The proposed CAD
  import milestone was withdrawn in 0.1.2 after clarification of the reference study purpose.

### Changed

- Stocker configuration uses a labeled native menu. Selection-range review and current-port zoom
  share a compact action row, with camera-only fitting for drafts and membership edits.
- Wall-clock unit-test budgets run in a serial group after functional tests, retaining every
  existing threshold and test case while avoiding competition with unrelated fixture compilation.

- Project Save shortcuts now save the whole project regardless of selection. Held area and FAB
  organization Blueprints have explicit storage buttons, with clearer storage destinations and
  visible save/cancel actions on short screens.
- Arrangement preserves explicit assembly relationships through certified Apply and cancellable
  Undo/Redo. Large result snapshots use owned columns and cooperative admission.

- Guided Build groups the existing journey into Quick Start, Equip, Reuse, and Advanced FAB
  chapters, with clearer pause/resume, Help, keyboard focus, and recovery through ordinary commands.
- Ordinary Rail and Port authoring, Assembly handoffs, Checks, and project menus provide clearer
  keyboard feedback and compact layouts while preserving the same atomic edit and Undo/Redo paths.
- Native project schema v13 preserves explicit assembly relationship state and allocator cursors
  through save/load, history, and Worker synchronization. Projects older than schema v11 migrate to empty
  relationship state; explicit Connector, Production FAB, Parallel Hall, Paired FAB and Full FAB contacts are supported, while other
  generator producers and Detach remain pending.
- Relationship snapshot hydration and checksums run in cancellable bounded steps. Final document
  adoption reuses completed relationship validation, and whole-map copying retains less memory.

### Fixed

- Canvas diagnostic attributes recover after another UI publisher changes them, preventing stale
  organization-hover readings after menu or viewport transitions.

- Stocker selection review uses clear space beside camera controls on short screens. Numbered
  draft markers remain upright on opposing rails and camera rotations, and hover markers no longer
  obscure selected-port labels. Closing the native configuration menu preserves the current draft.
- Deferred Stocker actions preserve newly focused controls; Guided placement keeps supporting
  buttons focused while the viewport changes.

- Center alignment uses a shared snapped frame, preventing a one-meter offset between equal-size
  blocks and allowing Guided Build to advance from Bank alignment to Interbay connection.
  Mixed-size blocks keep at most half a meter of center error; repeated alignment is a no-op.

- Whole View fits widely spaced projects inside the available workspace, with screen-space
  margins for rail strokes, and retains the full view when equipment panels resize. Native v13 preserves the full camera range and migrates v12 without
  changing authored data. Zoom controls and saved views share that range.
- Direct rail drawing, erasing and reshaping reject gestures longer than 4,096m before allocating
  a path, with instructions to zoom in and split the edit. Project and Blueprint sizes are unchanged.
- First port picking prepares marker lookup independently of equipment-body lookup. Body selection
  retains complete section membership validation and stable-ID tie resolution.

- Large relationship validation avoids long temporary visitation-table pauses. Organization
  bundle placement yields earlier during ownership and membership checks before atomic publication.

- Sparse layout overview queries skip empty regions, and the overview grid keeps readable
  spacing when zoomed out. Authored rail, port, and equipment identities are unchanged.

- Large FAB compilation indexes directed turnout connections once instead of scanning every
  physical path for each junction. Clearance ownership and compiled geometry remain identical.

- Optional operational settings load only when opened, keeping their editor and stylesheet out
  of initial loading. Loading and download failure remain closeable with keyboard focus retained.

- Equipment menus, Guide and Help explain the physical meaning of ports and the distinct OHB,
  EQ and Stocker creation actions. Stocker configurations use readable names without changing
  persisted template values; rejected additions explain when the existing selection is still usable.
- Stocker creation and port membership editing keep the complete selected range visible when it
  fits at the current zoom, including compact screens. Oversized ranges retain cursor following.

- Automatic recovery and native Project Save obtain validated snapshots from the mirror without
  synchronously copying the full authored map on the UI thread. Incomplete layouts remain saveable,
  and obsolete recovery requests cannot publish late success/error feedback.
- Next-step FAB guidance clears wrapped copy controls at intermediate and compact screen widths.

- Native Save cancellation preserves the pending user action and exposes a truthful retry path.
- Guided and ordinary FAB editing retain exact selection, placement, and recovery context through
  Bay/Bank/Fab duplication, connection, Undo/Redo, and native reopen.
- Asynchronous startup rejects an existing document edited after validation, including an
  edit/rollback cycle, without reverting the user's newer state.

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
