# Changelog

All notable public OpenFab changes will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and public releases will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.101] - 2026-10-09

Builder preview; V1 remains incomplete and simulation stays disabled.

- Edit an existing EQ's Port pitch from 1–5 m while keeping the selected Port fixed and preserving
  Port count, IDs, barcodes, service direction and Process Loop ownership. Preview the change,
  then apply or cancel it; one Undo/Redo restores the complete edit.
- Preserve explicitly authored body dimensions and reject insufficient length, unsafe slots or
  collisions with a clear reason. Automatic body dimensions follow the new pitch, and saved
  projects reopen with the same editable Port configuration.

## [0.1.100] - 2026-10-09

Builder preview; V1 remains incomplete and simulation stays disabled.

- Keep the exact corner or projected straight center selected through the latest reshape and
  its direct Undo/Redo, reusing endpoint selection safeguards. Preserve other selections and
  explicit deselection; clear unsupported older context instead of guessing a nearby rail.
- Share one latest-move correspondence across corner, straight and endpoint edits without
  changing rail identity, history data or existing edit eligibility.

## [0.1.99] - 2026-10-09

Builder preview; V1 remains incomplete and simulation stays disabled.

- Keep the actual endpoint selected through its latest reshape and direct Undo/Redo, using the
  command's exact before/after endpoints. Preserve a different selection or explicit deselection.
- Discard selection correspondence after another edit, a history branch or project replacement.
  When replaying older moves, clear an endpoint selection that would become an unrelated straight.

## [0.1.98] - 2026-10-09

Builder preview; V1 remains incomplete and simulation stays disabled.

- Show corner and endpoint move availability before entry, sharing each planner's existing
  source checks across Inspector, context menu and the entry guard. Unavailable commands remain
  keyboard reachable with a short reason.
- Refresh availability after rail edits and Undo/Redo while preserving corner terminal boundaries,
  endpoint direction checks, final target validation and atomic Apply.

## [0.1.97] - 2026-10-09

Builder preview; V1 remains incomplete and simulation stays disabled.

- Show straight parallel-move availability and a short reason before entering the command.
  Inspector, context menu and entry guard share the planner's source checks, and unavailable
  commands remain keyboard reachable so their reason can be read.
- Refresh availability after rail edits and Undo/Redo while retaining final target collision
  validation and atomic Apply.

## [0.1.96] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Move straight, corner and endpoint reshape targets with arrow keys in 1 m steps, apply with
  Enter, and cancel with Escape. Command entry restores Canvas focus and shows matching key hints.
- Keep the rejected preview and keyboard guidance when applying a target at its original position,
  so another arrow movement continues the same edit safely.

## [0.1.95] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Keep touch rail reshape targets in preview until an explicit Apply. Straight, corner and
  endpoint moves retain their target while reaching Apply or Cancel, with fresh validation
  and one undoable edit on confirmation.
- Return to Inspect when opening another project during a rail reshape, so the new project's
  first Canvas input selects normally. Mouse and pen release behavior remains unchanged.

## [0.1.94] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Restore the current rail reshape guidance after correcting a rejected target, including
  returning to Canvas after the preview disappears. Clear only that reshape's failure once,
  preserving other task messages and completed edits.

## [0.1.93] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Cancelling an uncommitted BROWSER LOCAL blueprint card placement restores the previous
  area selection, matching PROJECT behavior while preserving the current mode, search and focus.
- Reuse the existing document, edit-sequence and membership guards so confirmed placements and
  intervening edits cannot restore an outdated selection.

## [0.1.92] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Cancelling an uncommitted PROJECT blueprint placement restores the previous area selection
  when its document, edit sequence and selected members are still current. Assemble mode,
  library search and Canvas focus retain their existing behavior.
- Confirmed placements keep their edits; cancellation after an intervening edit or project
  replacement cannot restore a stale selection.

## [0.1.91] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Return to the original rail selection and inspection tool when cancelling an unplaced module
  copy with Escape, the cancel button or right-click.
- Restore only a current source from the same document and edit sequence, preserving completed
  copies, repeat placement and Undo/Redo.

## [0.1.90] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Reach equipment move/copy Cancel and Apply directly from Canvas with Tab, and return with
  Shift+Tab from Cancel while preserving normal navigation outside the edit.
- Keep ownership information keyboard-accessible after Apply, with native disclosure controls
  and matching visual order. Disabled Apply remains skippable.

## [0.1.89] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Preview EQ/STK group copies on touch, then confirm with the existing Copy action or cancel.
  Target taps and touch drags preserve original equipment and history until explicit placement.
- Retain fresh copied IDs, Undo/Redo, mouse and keyboard confirmation, and separate OHB and
  new-equipment placement behavior.

## [0.1.88] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Preview EQ/STK group moves on touch, then confirm with the existing Apply action or cancel.
  Repeated target taps preserve equipment and history until an explicit application.
- Retain mouse, keyboard, copy and separate OHB movement behavior.

## [0.1.87] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Open existing Loop registration directly from unowned equipment on one closed rail component.
  Select only that rail, preserve equipment and pending dimensions, and assign membership separately.
- Follow all Ports of the selected equipment without crossing other equipment to unrelated loops.
  Keep registration entry in 2D and retain ordinary whole-connected selection behavior.

## [0.1.86] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Save a portable RECENT copy directly to Project or Browser Local from its own fixed payload.
  Preserve copied rail, equipment, Ports and organizations even after the current selection changes.
- Reuse existing blueprint names, duplicate checks and storage without entering placement mode.

## [0.1.85] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Add a direct ownership-management action beside an equipment group’s current owner.
  Open and focus the existing membership controls without changing ownership or edit history.

## [0.1.84] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Offer explicit project download and file-input open in the Guided save/reopen steps, alongside
  native file actions. A download request keeps current changes and waits for the actual file to
  be reopened and checked before completing the journey.
- Show the completed FAB chapter as 8/8 while retaining the overall 13/13 result.

## [0.1.83] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Preserve unapplied EQ body dimensions when selecting another Port of the same equipment.
- Ask users to apply or cancel pending dimensions before leaving the equipment inspector for
  another selection, movement, Port configuration or FAB navigation. Applying dimensions and
  Undo/Redo retain their existing validation and history behavior.
- Clear obsolete dimension drafts when opening a different project.

## [0.1.82] - 2026-10-08

Builder preview; this correction does not declare V1 complete and simulation stays disabled.

- Release keyboard listeners and renderer-owned texture resources when leaving 3D inspection,
  including repeated visits, a held Control key and another active renderer sharing the texture.
- Clean up the remaining resources after a rendering or disposal failure and return safely to
  2D while preserving the authored project and history.

## [0.1.81] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Rename a project blueprint in place while preserving its identity, favorite and complete content.
  Apply or cancel in the shared library editor; empty and duplicate names are rejected before saving.
- Discard outdated rename drafts when projects change, and keep the renamed item reachable after search.

## [0.1.80] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Reach all saved organizations through paged lists, with selection, detail return and pending
  edits preserved across pages and search filters.
- Keep applied organization names synchronized with Undo/Redo while retaining unapplied drafts.
  Preserve newer input and selection when a pending history operation finishes.
- Clear an obsolete page-navigation warning after the pending draft is resolved and navigation succeeds.

## [0.1.79] - 2026-10-08

Builder preview; V1 remains incomplete and simulation stays disabled.

- Keep compact camera controls clear of selection/edit commands while the FAB Checks panel
  remains open, so inspection can continue after reopening a project.

## [0.1.78] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Keep rejected rail reshapes visible with short Korean clearance guidance, highlighted conflict
  cells and the diagnosed contact point. Preserve the existing clearance and shape rules.
- Add a visible cancel action for corner, straight and endpoint movement, restoring the original
  selection without changing authored data or history.
- Keep compact camera controls clear of open Blueprint Library and FAB Assemble close buttons
  when a selected rail's Inspector remains open.

## [0.1.77] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Reuse common prepared Port-slot binding checks within each synchronous drawing query, reducing
  repeated work while panning large FABs. Keep mutable row geometry and live occupancy checks,
  fall back to individual queries for unsupported or changed inputs, and retain independent
  hit-test and authored-action validation.

## [0.1.76] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Avoid redrawing the static FAB during repeated whole-map framing when the final camera is
  unchanged. Keep Port draft overlays responsive and preserve fitting after actual camera,
  viewport or equipment-panel size changes.

## [0.1.75] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Focus the 3D Canvas after the deferred module and scene are ready, so first-entry keyboard camera
  controls and Escape work. Cancel the pending focus transfer when the user focuses another control,
  exits the view, changes project or encounters a loading failure.
- Fit the full scene around the retained 2D camera target, keeping short off-center rails inside the
  initial 3D viewport while preserving the chosen focus and close-up zoom limit.
- Refresh camera clipping when zooming or panning and before rendering, preventing an old fit's
  near/far planes from cutting visible rail geometry at another permitted camera distance.

## [0.1.74] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Connect a read-only 3D inspection view to the same authored document with a compact 2D/3D switch.
  Keep pending edits in 2D and provide a safe return when the deferred inspector fails to load.
- Search project blueprints by name, folder and kind; distinguish storage locations and empty results,
  retain placement commands and clear the query after adding a blueprint or opening another project.
- Review Port draft completion against the final body-size and Loop rules before enabling Apply;
  keep the draft and show the existing rejection reason without enlarging equipment automatically.
- Reuse progressive indexed keyboard navigation for whole-equipment movement and copying, including
  compatible destination rails beyond the former 16 m search window. Retain destination validation.

## [0.1.73] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Show existing Bay flow support limits beside its disabled detail action. Put short supplementary
  help behind an information icon supporting hover, keyboard focus and touch tap; keep essential
  reasons visible and connection/deletion review separately reachable.
- Reuse declared-relationship restrictions and the existing legacy gateway recognizer before flow
  review. Cache guidance by document, selected Bay and source revision; retain certified Apply.

## [0.1.72] - 2026-10-07

Builder preview; V1 remains incomplete and simulation stays disabled.

- Open selected structures in a dedicated detail view with a return to the retained list and search.
  Keep editing first, place copy/blueprint tools in a disclosure, and show existing Bank support limits.
- Reduce New FAB to layout, production and review; retain all editable settings and show automatic
  connection policies in the review disclosure.
- Group the selected Checks cause, location and direct repair action before secondary repair choices,
  follow-up issues and item summaries. Keep compact repair controls unobscured.
- Return applied Bay flow edits to the same Bay detail with its atomic command and history intact.
  Return cancelled reviews to their originating detail with search/filter context preserved, and
  keep unverified change and preservation claims out of failed-review summaries.

## [0.1.71] - 2026-10-07

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Show the current equipment placement step, Port summary and explicit EQ/group Apply actions.
  Keep recovery notices clear of mobile placement and copy controls.
- Put selected-equipment editing, copying and body dimensions before ownership details and next tasks.
  Keep EQ dimensions and their Apply/Cancel controls together on compact screens.
- Default mobile navigation to icons with names and collapse rail settings to the current mode.
  Name the selection activity explicitly and show unassigned Loop status in neutral colors.
- Show rejected EQ body-size changes beside Apply and clear stale feedback when editing or changing selection.
  Keep expanded recovery lists collapsible after recovery leaves one entry, preserving remaining data.
- Use concise activity/tool labels and expandable Guide/keyboard help while retaining error reasons,
  accessible commands and the existing atomic editing, history and project contracts.

## [0.1.70] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Keep the latest project download request visible with filename and time in the Project menu.
  Preserve true save status, dirty state and file reference; clear stale feedback on project reopen.
- Explain that changing Loop ownership or demolishing owned equipment requires detachment,
  while valid same-Loop movement and Port editing remain available.

## [0.1.69] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Allow selection inspectors and explicit Loop registration while Guided Build is minimized,
  keeping the current Guide available to resume.
- Describe closed-rail practice as rail closure, with Process Loop organization registration separate.
- Keep a visible registration entry above compact selection details and focus the next required
  rail-only selection or name field. Atomic registration and equipment membership remain unchanged.

## [0.1.68] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Restore the previous editor tool and activity when organization blueprint placement ends,
  including copied Process Loops and Recent placement. Keep placement history and repeat behavior.
- Add an explicit placement Apply button using the existing validated command. On compact screens,
  prioritize mode/apply/exit controls, compact the tool rail and keep recovery clear of placement.

## [0.1.67] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Explain when a preset Bank connection does not support individual detach/delete and provide
  the existing New Fab entry for supported Bank editing. Preserve the connection policy and guards.
- Bring the selected Bank command block, including refusal reasons, into view on compact screens.

## [0.1.66] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Lead Bank detach/delete and FAB deletion reviews with named removal and preservation summaries.
  Resolve organization names from the reviewed document revision, disambiguate duplicate names
  with IDs, and retain certified counts and technical samples in collapsed details.
- Keep successful Undo/Redo feedback visible after synchronization even if a new selection cleared
  the preceding command result. New selections and actions continue to show their own guidance.

## [0.1.65] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Keep Bank/FAB command results visible when Worker synchronization restores the same selection.
  Resume selection guidance on a new user action instead of replacing a completed detach with copy advice.
- Expose Redo in the project menu for compact screens using the existing history command.
- Open the existing FAB deletion review entry from the selected FAB's structure details, matching
  the Bank command shortcut while preserving explicit review and cancellation.

## [0.1.64] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Identify a rejected equipment move/copy by its failed Port and known target position. Highlight
  the named Port or conflicting body extents, preserve the original equipment, and explain how to
  choose another target or cancel. Unlocated failures keep their reason without a guessed marker.
- Match movement hints to Enter/click apply and Space-drag camera movement. Explain that moving
  equipment already owned by a Process Loop preserves that ownership.

## [0.1.63] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Save explicit Bank attachment relationships when creating a new FAB. Review supported Bank
  detach or deletion through the existing separate, source-bound commands with atomic Undo/Redo.
  Existing files keep their authored relationships; missing connections are never inferred.
- Open Bank detach/delete commands directly from the selected Bank's structure details, retaining
  the selection and focusing the command area. Unsaved organization edits must be resolved first.
- Distinguish closed-rail practice from Process Loop registration and label equipment progress as
  minimum Port goals. Exclude selected equipment from the selection in one step before explicit
  Loop registration, preserving the authored equipment and its membership.
- Offer explicit file-input opening and project downloads even when native pickers are available.
  A download request keeps the current file reference, unsaved changes, recovery and pending
  project transition; only confirmed file writes report saved. Preserve cancellation and failures.
- Keep schema-15 recovery compatible with authored EQ dimensions after the schema-16 upgrade;
  reject recovery content whose checksum was changed.

## [0.1.62] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Review and delete one root Fab's exclusive organization, rail, equipment and Port subtree in
  one atomic action with exact Undo/Redo. Show removed and preserved counts with bounded samples,
  including when the deletion leaves an empty canvas.
- Preserve other roots, unowned content and ID cursors. Reject shared or external references,
  partial equipment, legacy CUSTOM Stockers and operational references to removed objects.
  Fab deletion uses its own source-bound Worker authority, separate from Bank deletion and detach.

## [0.1.61] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Delete a standalone Bank's exclusive subtree, or remove a supported terminal Bank's Fab
  connection and subtree in one reviewed action with one-step Undo/Redo. Show exact removed and
  preserved organization, rail, equipment and Port counts with bounded samples before applying.
- Preserve siblings, other Fab roots, unowned content and ID cursors. Reject shared ownership,
  partial equipment groups, legacy CUSTOM Stockers and operational references to deleted objects.
  Delete uses its own source-bound Worker certification; root Fab deletion remains unavailable.

## [0.1.60] - 2026-10-06

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Detach a terminal Bay Bank joined to a retained Fab by one explicit Connector relationship.
  Review preserved and removed content before applying one independently validated change with
  exact Undo/Redo. Preserve the Bank subtree, equipment and Ports; reject shared relationships,
  connector Ports and cuts that would invalidate the retained Fab. Bank/Fab deletion is not enabled.
- Explain equipment service-direction and body-size editing in Help and command search. Show
  unapplied EQ dimension input and allow cancelling that input without changing project history.
- Reuse clearance preparation within one Port-slot catalog compilation and release organization
  placement preview references when the session ends or the project changes.

## [0.1.59] - 2026-10-05

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Edit supported single-EQ body length and width while keeping every Port's position, identity,
  barcode, service direction and organization membership fixed.
- Preserve existing derived body dimensions for older projects; carry authored dimensions through
  atomic history, project files, copies, blueprints and the Worker mirror.

## [0.1.58] - 2026-10-05

Builder preview candidate; V1 remains incomplete and simulation stays disabled.

- Reverse every Port's service direction in a selected equipment group through one atomic action,
  preserving routes, stations, IDs, barcodes and organization membership with one-step Undo/Redo.
- Keep the existing F shortcut for rail-flow reversal; equipment service direction is a separate action.

## [0.1.57] - 2026-10-05

Builder preview; V1 remains incomplete and simulation stays disabled.

- Move EQ, OHB and supported Stocker equipment within its single owning Process Loop without
  detaching the group. Edit EQ/Stocker Port membership while keeping every resulting Port inside
  that same Loop, preserving equipment identity and one-step Undo/Redo.
- Reject targets outside the owning Loop, multiple owners, non-Loop ownership and unsupported
  legacy CUSTOM transforms. Validate the same transition in the document and Worker mirror.
- Show current refusal reasons and keep rejected edits atomic; retain the draft for correction.
  Owned equipment deletion still requires explicit detachment.

## [0.1.56] - 2026-10-05

R2 Builder preview; publication uses a production build, public safety and actual Pages verification.
V1 remains incomplete and simulation stays disabled.

- Move full regression and authoring CI to explicit manual runs; publish from the ordinary
  production build without waiting for the long validation matrix. Keep tests and assertions.

- Show the current straight, corner or endpoint reshape action and its actual controls;
  cancel through Escape or right-click and return to inspection without changing rails.
- Keep reshape hints and camera/menu controls usable on narrow screens.
- Show disabled equipment command reasons in the context menu and focus its close button when
  every command is unavailable, preserving Escape's return to Canvas.
- Label Process Loop dimensions as loop length and lane spacing while preserving stored keys.
- Share equipment move/copy/Port-edit/delete availability between Inspector, menu and execution;
  recheck the current source when acting and preserve ownership and legacy CUSTOM restrictions.
- Report the current rail command's refusal, with collision, protected-Port and stale-source recovery
  in resize/Loop editing; retain rejected resize feedback until the draft changes or is cancelled.

## [0.1.55] - 2026-10-05

Accumulated public preview candidate including the 0.1.47–0.1.54 checkpoints below.
Publication requires exact-source CI and Pages verification; V1 remains incomplete.

- Keep IME confirmation Enter separate from Loop registration and organization naming.
- Preserve OHB access direction when moving or copying equipment, including Undo/Redo.
- Disable unsupported legacy CUSTOM Stocker move/copy consistently and explain the FLEX
  replacement path; keep deletion and Undo available.
- Apply recognized standalone Loop dimension edits through the existing atomic Loop repair
  command, preserving identity, membership, history and Worker checks. Keep selected-Port
  and protected-organization restrictions, and retain failure reasons in the resize panel.
- Fit resize labels, inputs, units and feedback inside the narrow Inspector.

## [0.1.54] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Describe rail construction in the accessible first-OHB handoff without claiming the
  project file has already been saved.
- Make Build Help explain selection of intersected rail modules and whole equipment groups,
  explicitly stored as a blueprint. Preserve existing commands, layout and Loop ownership.
- Reuse existing keyboard and Help acceptance paths; no new harness or timing budget changes.

## [0.1.53] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Extract complete Organization Library presentation while retaining App filtering, source
  guards, commands, refs, timers and focus ownership. Remove 543 lines from the main editor.
- Preserve original organization rows, role/detail tabs, events and visibility conditions;
  existing held Connector, Arrangement and registered Loop flows pass at three widths.
- Keep actual OS write/reopen and independent first-use validation open; retain whole
  authoring for the accumulated public release instead of inventing speculative product work.

## [0.1.52] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Extract Blueprint Library presentation while retaining App queries, command ownership,
  storage, focus, refs and history. Remove 1,102 lines from the main editor.
- Make empty BROWSER LOCAL guidance name the actual save buttons and explain the first
  authoring step; preserve the existing dialog's automatically selected local destination.
- Reuse existing focused Library flows, correct stale recovery startup/error expectations
  and route their output outside user artifacts. Remove four inactive historical build copies.

## [0.1.51] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Reuse the prepared equipment presentation during model publication instead of compiling
  it again in React render. Pair source and presentation atomically with exact provenance.
- Prepare incoming project and scale presentation before promotion, dispose rejected project
  candidates, and retain current-tool slot correction without another presentation compile.
- Preserve serialized source, typed Worker messages, commands and Undo/Redo; existing repeat,
  equipment, project and full scale checks pass without changing performance budgets.

## [0.1.50] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Preserve native Enter/Space activation for focused buttons while moving or copying an
  equipment group. Apply/navigation shortcuts remain available with Canvas focus.
- Extract unchanged rail and advanced-switch Inspector presentation while retaining App
  selection, commands, refs and editing ownership.
- Condense the current roadmap summary after losslessly archiving its previous form;
  retain phase contracts and historical evidence.

## [0.1.49] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Explain that drag selection includes intersected rail modules and whole equipment groups,
  with Ctrl/⌘+click to exclude equipment, in Help and the selection Inspector.
- Extract unchanged activity-tool presentation from the App while retaining commands,
  current button launchers, guide/disclosure behavior and disabled conditions.
- Archive the exact roadmap and remove only reviewed historical verification receipts;
  retain all phase contracts, sequencing, performance and publication gates.

## [0.1.48] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Recheck a failed Bay flow review while keeping the selected Bay and explicit target.
  Discard old authority, capture the current document and retain all admission checks.
- Keep keyboard focus inside Bay review while rechecking, and show blocked reasons there.
- Clear Station READY evaluation after its idle Worker fails, preserving the review draft
  for explicit reevaluation. Keep retired callbacks and accepted Apply completion isolated.

## [0.1.47] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Split equipment placement, group transforms, Port configuration editing and the equipment
  Inspector into explicit presentation components, preserving the existing commands and state.
- Offer explicit current-document mirror recovery after a terminal synchronization fault,
  retaining authored data and Undo/Redo. Keep the existing recovery limits and timeout.
- Show an accessible recovery notice and 44 px Retry button on compact screens where the
  diagnostic footer is hidden.

## [0.1.46] - 2026-10-04

Local validation passes for this development checkpoint. Public deployment is recorded
separately; this entry does not establish V1 completion.

- Match equipment Help to OHB, EQ and Stocker move/copy and Port configuration editing,
  with the current confirmation and cancellation controls.
- Keep initial forward and reverse keyboard navigation inside the Help dialog.
- Extract the unchanged action-hint resolver and shared editor tool type from the main App.

## [0.1.45] - 2026-10-03

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Extract Station Review request and state ownership from the main App into an editor
  controller, retaining synchronous command locking and the original source admission.
- Keep Canvas tools, focus and measurements in App adapters and retain the existing atomic
  Apply, typed mirror patch and Undo/Redo path.
- Suppress late evaluation and Apply feedback after cancellation or terminal editor disposal,
  while preserving an already accepted commit and normal completion feedback.

## [0.1.44] - 2026-10-03

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Prepare Checks and Map inspection snapshots asynchronously through the existing mirror
  capture, preserving exact source identity, cancellation and invalid-layout diagnostics.
- Retry inspection after mirror generation recovery and validate the capture at publication.
- Reserve the desktop placement controls beneath an open Checks panel so repeated FAB
  placement can be ended with the visible button.
- End silent mirror readiness waits, recover unreadable responses and ignore retired Worker
  callbacks while preserving authored data and the existing automatic-resync limit.

## [0.1.43] - 2026-10-03

Local validation passes for this development checkpoint. Public deployment is deferred
to the next accumulated release; this entry does not establish V1 completion.

- Make the existing Checks save action visible before detailed results, with an explicit
  “프로젝트 저장 (.openfab)” label. Extract the unchanged current-result summary presentation.
- Use Stocker consistently in Guide progress, keyboard instructions and equipment commands;
  preserve serialized STK kinds, identifiers and user equipment names.
- Extract blueprint menus and miniature presentation without changing their implementation.
- Bound startup Worker response waits and recover from unreadable responses. Ignore callbacks
  from replaced Workers and release response timers on success, failure and cancellation.
- Keep full failure diagnostics while hashing repeated source/physical graphs in successful
  acceptance receipts to reduce generated data.

## [0.1.42] - 2026-10-03

Local validation passes for this development candidate. Exact public export and deployment
are deferred until the next accumulated release; this entry does not establish V1 completion.

- Block Bay flow, disconnection and deletion before side effects while cooperative Loop or
  editing-history work is pending. Show the same current wait/cancel reason on all Bay actions.
- Preserve the original pending operation until explicit cancellation or completion, then
  restore the existing atomic Undo/Redo and typed mirror publication path.
- Deliver repair-return keyboard focus after the owning Checks panel mounts, with project
  and navigation guards. Keep fresh inspection and focus requirements separate in acceptance.


## [0.1.41] - 2026-10-03

Prepared as the 0.1.41 release candidate. Local acceptance and exact public release remain
separate gates; this entry does not establish deployment or V1 completion.

- Choose an explicit registered Process Loop or compatible Bay/Bank pair from Checks, with
  bounded search, exact organization IDs and persistent selection across filters.
- Prepare hierarchy, gateway and bounds cooperatively before entering the existing typed
  rail/connector editor. Do not infer ownership from diagnosis coordinates.
- Return to a fresh inspection after Loop exit or Connector cancellation/application,
  preserving authored data and cancelling obsolete navigation on project or tool changes.
- Keep rail repair controls available before equipment exists and separate compact Loop
  instructions from camera controls. Preserve the Checks panel's keyboard focus on return.
- Use one Checks scroll area on short screens so the focused instructions and issue list
  remain reachable without clipping their controls.
- Reserve selection hints below small side Inspectors and keep the canvas workspace fixed
  when panel focus or scrolling changes, preserving reachable rail repair actions.
- Keep camera controls beside expanded compact menus and reserve their space in Loop
  instructions and rail action hints, so the whole Inspect target remains usable.


## [0.1.40] - 2026-10-03

Prepared as the 0.1.40 release candidate. Full local and exact public verification remain
separate from this version entry.

- Keep Guided OHB/EQ targets bound to the current Port source through camera movement.
  Start each new equipment guide at a usable Port scale and reserve the actual visible panels.
- Leave a real map input area above short-screen Guided EQ and Stocker docks while keeping Stocker
  completion controls outside the scrolling content. Label the EQ recommendation separately
  from a keyboard-selected endpoint and provide current-Port zoom recovery in every guide.
  Recover recommendations explicitly after panning, preserving selected Stocker Ports.
- Keep equipment Help readable and scrollable on short landscape screens, and leave
  selected Ports clear of the recovery reminder during the equipment guide.
- Block Checks repair/navigation, project replacement and saving before they change UI state
  while cooperative Loop or editing-history work is pending. Preserve existing explicit
  Connector/Arrangement project-transition cancellation.
- Publish a cancellable pending turn before even a small Loop Undo/Redo prepares its
  source, while preserving one atomic history command and one typed Worker patch.
- Correct assembly gateway instructions to the existing twelve-metre minimum.

## [0.1.39] - 2026-10-03

Prepared as the 0.1.39 release candidate. Deployment is verified separately through exact-source
CI and served-file checks; this version entry alone does not establish publication.

- Register a manually drawn closed rail selection as an explicit standalone Process Loop,
  then attach OHB, EQ and Stocker through their existing ownership actions.
- Edit the registered Loop's cardinal rails while preserving its ID, name, declaration and
  equipment membership. Rail changes and Loop membership commit and replay atomically;
  other owners and required equipment Port routes remain protected.
- Keep failed keyboard repair drafts editable, explain refusals in Korean, and clear old
  repair and Port scopes when reopening a project.
- Keep the Loop edit bar clear of the current menu width and keep short-screen Stocker
  completion controls outside its scrolling content.
- Verify actual blank-canvas drawing, registration, all three equipment kinds, rail repair,
  Undo/Redo, Checks and save/reopen at 390, 760 and 1440 px. Native OS picker verification
  and overall V1 completion retain their separate gates.

## [0.1.38] - 2026-10-03

- Preserve explicit standalone Process Loop intent across project, Worker, blueprint and library
  formats. Older records migrate without inferring roles from rail shape or names.
- Authenticate recovery input against the original project's checksum format before promotion.
  Compare the loaded recovery's full JSON before cleanup so a changed recovery survives.
- Bind organization declarations to move, connector, Bay edit/delete and blueprint-placement
  authentication; relocation cannot change a Loop declaration.
- Renew immutable certified synthetic preset artifacts for the updated data contract and retain
  strict original-format migration fixtures. The visible standalone registration flow follows
  in a separate authoring milestone.

## [0.1.37] - 2026-10-02

- Cancelled save metadata can no longer overwrite a newer recent file or remove a newer recovery;
  recent file/handle updates and conditional recovery cleanup use abortable atomic transactions.
- Choose a native project save destination before preparing the Worker snapshot and serialized
  file. Keep cancellation separate from permission and activation failures.
- Preserve the actual written file receipt when the source changes during close, while keeping
  current changes dirty and blocking automatic project replacement.
- After saving for Open, retain the transition dialog and start the file chooser on a fresh
  Continue click. Keep the current project and retry action when file selection is cancelled.
- Offer an explicit Save As retry inside the transition dialog when an existing write handle
  is unavailable, without starting a delayed replacement chooser.

## [0.1.36] - 2026-10-02

- Keep an active Guided rail keyboard endpoint visible when the guide, dock or viewport
  changes size after a mission transition. Cancelled or stale sessions do not move the camera.
- Verify the same endpoint through a short-phone resize and return, preserving the authored
  project and Worker state. Record each cursor hit-test and the surrounding panel bounds.
- Defer layout framing during manual panning and restore an obscured endpoint after the drag
  ends. Ordinary panning without a layout change remains under the user's control.

## [0.1.35] - 2026-10-02

- Keep ordinary EQ feedback at a stable height so an invalid endpoint's explanation
  cannot grow the equipment dock over the point being clicked. Longer feedback scrolls.
- Continue Guided keyboard construction at the same endpoint when a short draft plus
  an extension completes First Rail, with an explicit transition to Process Loop.
- Verify actual keyboard and pointer-to-keyboard continuation on phone, tablet and desktop,
  and verify a surviving Loop, reopening through Undo, and restoration through Redo.
- Keep the keyboard endpoint visible after layout changes, avoid reserving an obscured
  compact camera toolbar twice, and explain why editing can reopen the Loop guide mission.

## [0.1.34] - 2026-10-02

- Preserve the current First Rail repair and Process Loop guide's arrow direction, forward
  endpoint, clearance and closure coaching when the Canvas is the next pointer target. The visible guide and
  accessible target description use the same instruction.
- Verify repeated wrong-lane OHB/EQ pointer release announcements through their actual
  footer or retained-EQ live region, alongside unchanged source, Worker and draft anchors.
- Verify compact guide coaching and rejected reverse rail input before valid Loop closure.
- Keep the rail guide scrollable on short phone screens so it leaves room for
  actual Canvas input while preserving the current direction instruction.
- Check cooperative bundle preparation deadlines more frequently across state, history
  and Worker packet construction, preserving the 2 ms target and 8 ms release gate.
- Require the same measured 15 m First Rail target in guide evaluation, pointer feedback
  and keyboard construction. A valid shorter draft stays editable in the current mission;
  extending its forward endpoint to 15 m advances without changing Network Link geometry.

## [0.1.33] - 2026-10-02

- Show whether every proposed equipment Port belongs to one Process Loop during whole-group
  Move or Copy. A valid placement with no eligible Loop now explains that geometry and Loop
  membership are separate. Membership still requires an explicit action after placement.
- Replace the Stocker recovery's Loop-map hint with the actual Move preview guidance, and
  give compact screens a separate line for placement and Loop eligibility feedback.
- Verify connected synthetic Stocker Move, explicit attachment, Undo/Redo, zero Checks,
  native save/reopen and owned-source Copy at 390 and 1440 px. Exhaust every legal anchor
  for a wider rigid group with no single-Loop fit, preserving project state on cancellation.

## [0.1.32] - 2026-09-29

- Expose the existing whole-Stocker Move command in the primary Inspector row when an
  editable, unowned multi-Port Stocker has no eligible Process Loop. The 44 px recovery
  control is visible in the compact peek, updates the mounted live status with the missing
  Loop, and points to the Process Loop map. Move remains transient until committed; Loop
  membership still requires a separate explicit action.
- Verify a synthetic Stocker whose two Ports lie on different Process Loops at 390 and
  1440 px. Entering and cancelling Move preserves its group, Port IDs, Worker state, and
  history without assigning ownership.
- Correct the ordinary EQ pointer acceptance to require the visible invalid-row reason
  and unchanged anchor instead of one transient status-bar phrase. The public 0.1.31
  candidate was withheld from Pages after that brittle CI assertion failed.
- Force history-independent public export acceptance to use the built preview even when
  a diagnostic shell sets `OPENFAB_AUTHORING_DEV_SERVER=1`.

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
