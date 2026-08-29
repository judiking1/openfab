# Port-Derived Equipment and Scenario Boundaries

> Architecture note for future import, derived 3D, and simulation work. It records public-safe
> conclusions from a read-only private-reference study. No source body, raw row,
> identifier, coordinate, layout, operational value, asset, credential, or company-specific naming
> rule was copied into OpenFab.

## Status and roadmap gate

This note does not authorize simulation work. Static authoring, native project persistence,
port-first equipment authoring, complete 2D validation, and the derived 3D exit gate must precede
OHT simulation. `simulationReady` stays `false` until the separate simulation-readiness contract is
implemented.

The useful conclusion from the study is not a new editable model. OpenFab's current boundary is the
right one:

- serializable rail, port, equipment-group, and organization records are authored truth;
- a revision/checksum-bound Worker mirror derives expensive analysis but is never an independent
  source of truth;
- 2D, future procedural 3D, import review, and later simulation consume versioned derivatives of
  those records; and
- renderer objects, UI stores, source-file row order, and inferred display groups never become
  project truth.

## Public-safe import conclusions

External station sources may mix attachment, identity, physical grouping, control grouping,
direction, capability, and operational metadata. Every field is therefore an untrusted proposal,
not authored truth. One normalized resolver must feed both interactive preview and Worker
certification so the two paths cannot silently assign different semantics.

The schema reader itself must also be singular. UI and Worker code must consume the same
header/schema-based normalized proposal; a second position-based row parser is prohibited. An
unknown equipment type is an `UNRESOLVED_TYPE` review issue rather than a fallback to a familiar
kind such as STK. Parser byte, row, and issue counts are bounded, cancellation and generation are
explicit, raw buffers are released after normalization, and diagnostics are redacted before they
cross the local import boundary.

Declared attachment and position may disagree. Overloaded direction or grouping fields may also be
insufficient to determine a physical body or operational role. These cases remain bounded,
structured review issues; identifier shape, input order, or proximity must never repair them
silently.

A renewed read-only check against the actual local reference file and its loading/grouping path
confirmed why this boundary matters: a nominal source direction can be non-discriminating, while a
legacy visual layer may compensate through name patterns or proximity clusters. OpenFab does not
carry either compensation forward. It requires explicit direction evidence and an explicit physical
OHB/EQ/STK group decision before ordinary canonical records can be created. No reference row,
identifier, coordinate, naming rule, source structure, or visual-group algorithm was copied.

Import metadata is allowlisted and ephemeral until an explicit commit. Unknown operational,
site-specific, device, or source-system fields are discarded rather than preserved as opaque extras.
Repository fixtures use only synthetic public-safe data.

### Implemented proposal-reader foundation

The first quarantined reader boundary is now implemented without connecting it to project mutation
or the editor UI. It accepts only the OpenFab-owned V1 header schema; it has no positional fallback
and no private-format adapter. The browser gateway returns one exact owned byte buffer plus a
local-only display name. A disposable Worker invokes the same reader once, returns either a compact
typed-array snapshot or fixed aggregate rejection evidence, and terminates. The main thread adopts
the transferred snapshot in cancellable, time-budgeted slices behind an accessor-only facade. Raw
bytes, mutable columns, filenames, and parser exception text do not enter the proposal artifact.

The public limits are explicit: `16 MiB` source bytes, `100,000` rows, `64` columns, `4 KiB` raw
field payload, `64 KiB` logical-record payload, at most `16` secondary aliases per row and `100,000`
in aggregate, and at most `300,000` distinct normalized strings. A normalized string is capped at
`16 KiB`; the complete pool is capped at both `64 MiB` and four times the source byte length. These
last bounds prevent a small or forged Worker message from amplifying into unbounded Unicode,
alias-map, or string-pool work. Exact aliases are scope-aware, co-located rows retain multiplicity,
and input order cannot change the semantic fingerprint.

Ordinary unit tests use small isomorphic fixtures. The exact row and aggregate-alias limits run only
through `npm run test:station-proposal-scale`, whose dedicated Vitest configuration disables file
parallelism and uses one Worker. All fixtures are synthetic. Its reader cases prove only the
quarantined reader and transfer/adoption boundary; they do not approve a proposal, create a Port, or
change `simulationReady`.

### Implemented reviewed proposal-to-command and UI boundary

A headless review compiler now supplies the user-facing Equip activity without moving its authority
or large-object work into React.
Every source row receives exactly one explicit `INCLUDE` or `REJECT` decision. An included row must
name the exact directed route, canonical station, side/offset, port type, direction and direction
evidence decision; every physical group must receive an explicit OHB/EQ/STK grouping decision and
template. Reader rejections, unknown columns, source-position disagreement, and intentional
unassigned organization ownership require separate acknowledgements. Source positions are evidence
only after exact attachment resolution and never search for or choose another rail.

Evaluation reads the accessor facade and every proposal row into one stage-local snapshot, rejects
throwing or malformed accessors, and validates the complete prospective equipment layout. A
`READY` evaluation can be finalized once and can produce one plan only while the captured map,
port/equipment state, organization state, revision, patch sequence, and cursors still match.
Single-kind reviews lower to the existing `place-ohb`, `place-eq`, or `place-stk` command. A
mixed-kind review uses a separately certified batch kind that additionally binds the exact transition
fingerprint and requires at least two physical kinds; every attempted certification consumption is
terminal. One accepted plan therefore commits atomically through ordinary `RailDocument` history
and typed Worker patches, with exact undo/redo and `simulationReady === false`.

The mutation plan's identity fields contain only newly allocated OpenFab IDs and generated internal
barcodes. Source aliases, source coordinates, display filenames, raw rows, and discarded metadata do
not enter the plan, history, patch, or project. The dedicated scale command adds a third synthetic
case with `100,000` ports in `75,000` mixed OHB/EQ/FLEX-STK groups on `200,000` directed straight
cells and proves review, one-shot finalization, planning, atomic commit, and history creation within
explicit time and resident-memory bounds.

The original synchronous evaluator remains a compatibility/headless contract only. The production
backend now evaluates one transferred proposal and Draft in a dedicated disposable Worker, exposes a
finalize-incapable preview, and requires a separately correlated explicit Apply request before it can
materialize one opaque main-realm command authority. `READY` still does not mutate the document.

One private typed-column review session owns row decisions,
group membership/configuration, and the three explicit acknowledgement policies. It exposes only
bounded row/group/member windows (at most 128 items) and cooperatively seals one generation-bound
Draft snapshot. A separate attachment proof binds every accepted proposal row to the exact compiled
physical source and prepared slot artifact. Live slot availability used by Canvas/UI is narrowed to
that prepared proof, so mutating a route, station, side, world position, base status, conflict ID, or
its physical source cannot make a rejected attachment appear legal.

The React surface retains those bounded windows, cancels on session/document generation change,
shows review evidence without retaining raw source rows in component state, and requires one
deliberate `APPLY ONCE`. It never invokes the synchronous compatibility evaluator for a large
proposal and never auto-commits a `READY` result. Main-realm permit materialization, complete layout
and checksum work, document history preparation, and the typed RailWorker patch are cooperatively
partitioned around one final no-await publication boundary. The exact public synthetic
`100,000 ports / 75,000 groups / 200,000 cells` gate exercises the genuine typed session, disposable
review Worker, reviewed-plan transfer, opaque handle, atomic commit, prepared `9,950,072`-byte typed
patch, and one-shot history. Its final patch publication is about `0.16 ms`, the complete commit's
maximum active interval is about `5.66 ms`, and the fresh five-case serialized gate reports zero
command/Apply Long Tasks. This closes the previously recorded 100k Apply debt without weakening
authority, atomicity, or `simulationReady === false`.

## Canonical import boundary

An eventual station importer should be a proposal compiler, not a direct document loader:

```text
raw source
  -> schema/version reader
  -> quarantined normalized rows
  -> bounded structured validation issues
  -> explicit attachment/group/capability proposals
  -> user review
  -> ordinary OpenFab port and equipment commands
```

The raw source is not project truth. Import must not retain raw row previews in logs, error strings,
telemetry, undo history, or saved project JSON.

The validator should check, at minimum:

- a recognized public or documented schema/version and exact adapter contract;
- required type and numeric fields;
- unique proposed identities within their explicit import scope;
- source aliases scoped as proposals, with project-wide uniqueness enforced if one is promoted to
  `PortRecord.barcode`;
- declared attachment existence and position consistency;
- resolution of explicitly declared organization references and satisfaction of the selected
  template rules, without imposing a universal Bay-locality rule;
- physical group membership and reciprocal port membership;
- required role coverage for equipment that needs paired service ports; and
- unresolved side, direction, or operational capability.

Source attachment IDs are scoped proposal aliases, not canonical authority. Normal OpenFab commands
allocate stable IDs. After explicit mapping and review, the proposed `PortRouteIdentity` plus
`stationMillimeters` becomes attachment authority; source position validates it. A conflict remains
an import issue rather than triggering a search for a more convenient rail.

Identifier shape, density, neighbor order, and the first member of a cluster are never canonical
semantics. Repository adapters are independent implementations for public or documented schemas and
ship only synthetic fixtures. They may offer a typed proposal, but must require review instead of
writing inferred truth directly. Stored provenance is limited to adapter/version and the user's
decision; raw paths, site/device/source identifiers, source fingerprints, and raw replay data stay in
the user's local run boundary and never enter repository samples, logs, or telemetry.

Alias resolution uses a scope-aware multimap, not last-write-wins insertion into one global map.
Primary-to-alias and alias-to-alias collisions are both review issues; an alias that is unique only
inside an explicitly selected FAB scope never becomes a globally unique identity. Source row order
must not change the normalized proposal or the collision set.

Direction proposals carry evidence such as `DECLARED`, `HEURISTIC`, or `UNKNOWN`. A heuristic based
on an identifier shape, nearby rail, or source naming convention may be shown as a review hint but
cannot be committed automatically. Likewise, co-located ports remain distinct service-point
proposals: import must not deduplicate them, choose a representative port, or silently reassign group
membership.

## Identity and grouping layers

OpenFab should keep these identities separate even when a particular source happens to use one key
for several of them:

| Layer | Meaning | Canonical owner |
|---|---|---|
| Port | one stable rail-attached service point | `PortRecord` |
| Physical equipment | one selectable group compiled into one or more disconnected body sections | equipment group |
| Control group | devices sharing a controller or dispatch boundary | future config layer |
| Storage policy group | capacity, priority, dwell, or reservation policy | future non-geometric config layer |
| Logical process group | capability grouping across physical bodies | future non-geometric config layer |

`equipmentGroupId` and reciprocal `portIds` remain authored physical membership. Geometry may flag a
suspicious membership or derive body sections from it, but it must not regroup the saved document.
An explicitly authored cross-Bay flexible storage group may therefore compile independent body
sections per run; it never becomes one geometry-inferred body spanning the intervening factory.
Proximity clusters are display proposals only and never overwrite physical equipment, control,
storage-policy, or logical-process membership.

Aliases are also distinct from identity. A future alias model may associate a scoped proposal alias
with one stable OpenFab port ID after review. UI selection and later simulation manifests reference
the stable ID. Promoting an alias into today's `PortRecord.barcode` requires the existing
project-wide uniqueness invariant.

## Direction and capability are different types

Geometric direction answers where an attached port faces relative to authored rail travel. Authored
side and lateral offset move its world position. Yaw is derived from the canonical route tangent and
the explicit `WITH_TRAVEL` / `AGAINST_TRAVEL` direction field.

Operational capability answers what a scenario may do at that port. A later versioned config layer
should use an explicit vocabulary such as:

- `UNKNOWN`;
- `PICKUP_ONLY`;
- `DROPOFF_ONLY`; and
- `BIDIRECTIONAL`.

That capability record references a stable port ID and carries bounded adapter/version provenance
and review status, never raw source identity.
It must not reuse `WITH_TRAVEL` / `AGAINST_TRAVEL`, and a missing value must not silently become
bidirectional.

## Port-derived 3D

The current `CompiledPortEquipmentPresentation` already provides the correct expansion point: rows
carrying stable port and group IDs, positions, tangents, yaw, bounds, group CSR membership, and
multi-section body descriptions. The derived 3D consumer now proves this boundary with port-derived
shell spans, opening recesses, internal slots, direction markers, and independent full-body pick
proxies. Richer procedural detail extends or replaces only renderer-neutral derived artifacts.

Recommended pipeline:

```text
canonical ports and physical groups
  -> route tangent + local tangent/normal frame
  -> group-local port layout
  -> renderer-neutral body sections, openings, slots, and pick bounds
  -> transferable/chunked visual artifacts
  -> disposable renderer resources
```

The same derived layout should feed the visible body, port openings, internal slots when needed, and
selection bounds. This prevents body geometry and picking from disagreeing.

The renderer-neutral artifact should explicitly map each stable port to its body section and face,
opening/slot record, and pick bound. Renderers must not independently infer those relationships from
position or draw order. One physical group may legitimately produce multiple sections with different
local directions.

Current implementation follows that boundary. `CompiledPortEquipmentPresentation` stores one exact
section row per port plus an inverse CSR and tangent-relative face value. Valid STKs bind through
compiled straight-run identity; only an invalid legacy `CUSTOM` group receives one repairable display
section rather than inferred regrouping. A separate exact-presentation-keyed lazy artifact supplies
row-aligned opening anchors/normals and port pick bounds only when 3D needs them. Canvas and Three.js
body hits use the same cached full spatial index, exact oriented-section test, overlap ordering, and
section-local inverse-CSR resolver; co-located rows remain distinct.

`PortEquipmentShellPresentation` adds a second exact-presentation-keyed renderer-neutral derivative.
For each canonical body section it sorts member rows by stable port ID, projects exact opening anchors
into the section-local frame, subtracts bounded opening intervals, and emits shell spans plus one
stable slot record per port. It revalidates group CSR, section ownership, group kind, unit normal,
opening containment, and tangent-relative face, and fails closed on disagreement. Disconnected STK
sections therefore stay disconnected and source-row reordering cannot change output identity. The
artifact is bounded to `S + P` spans and `P` slots; the focused 50,000-port case produces `100,000`
spans and `50,000` slots in exactly `5,800,000` typed bytes.

The visible direction cue now consumes that same canonical derivative. Detail-level Canvas draws one
bounded equipment-facing arrow from `yawRadians`; derived 3D replaces the former rotationally
symmetric port cylinder with one instanced asymmetric marker whose local tip follows the row-aligned
opening normal. Neither renderer reads a source name, infers a group, or adds editable state. A direct
review/Apply regression carries explicit OHB, EQ, and STK group IDs plus both facing directions through
the disposable Worker, canonical document, derived section mapping, opening normals, and stable-ID
spatial resolution, including undo/redo.

Repeated rigid parts should compile to `geometryKind + matrix + stable ID` instance buffers.
Variable equipment shells should compile to bounded procedural chunks grouped by material role.
Visible merged meshes should not raycast; separate low-complexity pick proxies resolve back to stable
port or equipment-group IDs. Selection changes update a highlight/proxy and do not rebuild core
geometry.

The current renderer instantiates the shell spans, dark opening recesses, and internal slot bars but
retains the unsplit canonical section boxes as invisible equipment pick proxies and highlight bounds.
The compact runtime journey proves `3` canonical sections become exactly `8` shell spans, all `5`
ports become exactly `5` slots, camera framing closes on the selected EQ, and the scene remains at one
content build. The cross-kind fixture additionally proves a two-section FLEX STK remains section-local:
the horizontal and vertical ports frame canonical section rows `3` and `4` at distance `6.347`, while
the explicit whole-group command frames their midpoint at distance `219.903`.

The dedicated browser-scale path is now measured with public synthetic authored truth rather than a
renderer-only array. One straight `50,000`-cell startup fixture owns `50,000` valid single-port OHB
groups, which compile to `50,000` canonical sections, `100,000` shell spans, and `50,000` slots. The
first run exposed one `54 ms` Long Task. Exact-presentation-keyed shell preparation now runs in its
own pre-adoption task and measured `20.89 ms`; the final same-build path opened in about `819 ms`,
grew JS heap by `133,582,395` bytes, and reported zero Long Tasks. Cached re-entry starts no second
artifact Worker, resolves the same shell within timer resolution, opens in about `95 ms`, and adds
`16,816,930` heap bytes with zero Long Tasks. Scene adoption still consumes the same cached
renderer-neutral artifact and canonical full-body pick proxies. A subsequent bounded 50k traversal
drives 12-step orbit, 12-step right-button pan, and 12 keyboard chunk moves through `38` measured
frames. It retains one content build and one React viewport render, starts no Worker, reuses the
prepared shell, and records zero Long Tasks or heap growth. Main-thread render work averages
`1.263 ms` per measured frame; rail chunk selection averages `0.424 ms`, with `24` visible and `48`
resident chunks after `569` materializations and `521` evictions. The cumulative render maximum
through traversal is `35.355 ms`, below the explicit `50 ms` ceiling, so derived equipment
partitioning is not currently justified.

That same public 50k path now closes the semantic interaction question. A real `PORT-1 / OHB-1`
selection originates in the 2D Canvas, survives cached 3D re-entry and traversal, then frames its
canonical local section before visible shell and marker pixels are clicked. The unsplit body, port,
and advanced-switch proxies occupy a semantic-only Three.js layer excluded from the visual camera;
the dedicated raycaster still sees them, and the visible marker owns its opening ahead of the body
surface behind it. The body/port picks measure `5.875/3.825 ms`, the slowest clear/pick attempt is
`13.045 ms`, and all four attempts add zero positive heap, zero click-window Long Tasks, zero
content/shell rebuilds, and zero Worker starts. This confirms that canonical full-body resolution is
bounded at factory scale without making render objects authoritative or adding a second selection
model.

The runtime browser journey also proves those visuals cannot silently become a second interaction
model. With rail and switches hidden, three separated screenshot-classified pixels on the shell body,
dark slot-adjacent area, and cyan port marker all resolve through the canonical proxies to stable
`PORT-4 / EQ-3`. Hiding equipment preserves the semantic selection but makes the successful body
coordinate non-pickable; showing it again does not rebuild scene content. Forced WebGL loss returns to
2D with the same paused publication and selection, and fresh 3D re-entry restores exact shell/slot
counts and selection from canonical data rather than renderer retention.

The public runtime fixture now authors OHB, EQ, and STK records rather than relying on a hand-built
renderer fixture. Exact compiled hover-row IDs select `PORT-6/7` into stable `STK-4` on horizontal
and vertical cardinal runs at least `120 m` apart. The one group derives two disconnected body
sections, bringing the fixture to `5` sections, `12` shell spans, and `7` port/slot instances. Its
reviewed but unused STK storage configuration does not leak into the active scenario resource set;
Transfer Plan and Replay History therefore retain their previous equivalent terminal outcomes.

No Three.js matrix, quaternion, mesh, material, texture, or scene node belongs in the core schema,
Worker mirror, or domain store. Visual dimensions and profiles must be independently defined as
public OpenFab assets rather than copied from a prior model or site.

Priority regressions for a richer derived artifact are:

- input-order invariance;
- opposite and quarter-turn orientations;
- curved-rail tangent continuity;
- multi-rail and back-to-back physical groups;
- multi-section storage bodies;
- stable-ID pick continuity across artifact rebuilds;
- explicit resource disposal; and
- bounded object count and main-thread work at 10k and 50k cells.

Import acceptance must additionally cover parallel rails that share a station value, declared
attachment versus FAB/Bay proposal conflicts, co-located distinct ports, unknown types, scoped alias
collisions, and source-row reordering. Preview and Worker certification must produce the same bounded
issues and proposal fingerprint in every case.

## Transfer Plan and Replay History

Future From-To simulation should expose two source journeys without creating two execution engines:

- **Transfer Plan** authors demand from tables, matrices, storage/process choices, or generated
  requests and passes through input, review, allocation, and run stages.
- **Replay History** imports a historical event source and reviews its mapping before running it.

Both compile to one versioned immutable execution manifest or event stream. The common manifest keeps
the source kind, public adapter/config versions, user mapping decisions, exact accepted/rejected
counts, and bounded issues. Private source fingerprints and raw replay data remain local run assets,
not saved project, repository, log, or telemetry fields. Sharing a runtime format does not erase the
safe provenance needed to isolate the two source journeys.

Once a run is accepted, the Worker owns that immutable generation. UI inputs are source-locked until
the run ends or is explicitly cancelled. Every load, start, progress, statistics, and terminal
message carries request ID, run generation, and source kind so a late history response cannot update
a plan run, or vice versa. UI state is presentation state, never simulation truth.

Operational EQ/OHB/STK settings belong in versioned non-geometric configuration, not in visual
geometry:

- per-port pickup/dropoff capability;
- logical process/capability group membership;
- per-storage-group capacity, priority, dwell, and reservation policy; and
- explicit storage port role.

The first implementation of that boundary is the source-identity-bound
`SimulationStationOperationalCapabilities` artifact. It requires one explicit pickup-only,
dropoff-only, or bidirectional decision per stable port and derives global/physical-group candidate
indexes without reading geometric facing.

The companion `SimulationEquipmentResourceConfiguration` artifact adds logical EQ capability
definitions, group defaults with per-port replacement overrides, and storage class/policy records
for physical OHB/STK groups. It owns capacity, initial occupied count, high-water mark, minimum dwell,
and priority rank without regrouping physical equipment. Neither artifact persists mutable settings,
defines run-specific FOUP identities/routing, or authorizes simulation.

Those records reference authored stable IDs and must fail closed when a project edit invalidates the
binding. An accepted run manifest embeds an immutable snapshot or explicit override of that config;
the mutable config itself is not the run. Existing authoring metadata such as
`EqEquipmentGroup.recipe` and `PortRecord.barcode` must not be reinterpreted as simulation policy or
capability.

Future alias mapping remains a separate reviewed import/identity layer. Operational capability and
control topology live in non-geometric config, while a run manifest snapshots only the accepted
stable-ID mappings and config needed for that execution.

## High-speed execution, including 64x

If OpenFab later chooses a `64x` profile, it is an execution policy, not `deltaTime *= 64`.

The later runtime should use a deterministic fixed base step with a bounded wall-time work budget.
Higher analysis speeds may advance more simulated time per outer call, while numerically sensitive
motion remains sliced at the certified base step. Generation, routing/safety scans, statistics, and
visual publication run on separate cadences.

Each scheduler cycle reports simulated time accepted, carry retained, work executed, and time
dropped by an explicit policy. If the fast profile cannot preserve its numeric or topology contract,
it falls back or fails closed; it does not silently skip arbitrary physics. Render cadence may be
reduced at high speed without changing event order or route decisions.

Before exposing any speed above real time, acceptance must prove:

- deterministic manifest replay across repeated runs;
- identical terminal event ordering across supported speed profiles;
- bounded substeps and main-thread publication work;
- explicit carry/drop accounting;
- stale-run and source-kind isolation;
- source locking and cancellation; and
- no dependency on renderer frame rate.

The current limited exact-source runtime now satisfies these requirements for its disclosed
constant-speed, unlaunched-token profile. Its public production-browser gate authors two OHB groups
and one three-port EQ group from canonical port records, runs one named load through OHB -> EQ
process -> OHB at 8x/64x, compares one exact moving publication in 2D and derived 3D, and requires
terminal request/service/EQ/storage outcomes before explicit Stop. It then explicitly clears the
Transfer Plan source before independently reviewing, preparing, authorizing, and completing the
equivalent two-record Replay History at 64x through the same execution engine. Terminal request,
service, EQ, storage, and event semantics must match before Replay Stop and source clear return the
UI to an empty state. This does not broaden the profile, add runtime mutation or vehicle picking,
change the static-authoring product gate, or make a merely synchronized rail mirror
simulation-ready.
