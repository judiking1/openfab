# Operational configuration state

OpenFab keeps non-geometric simulation-readiness settings as authored project data, separate from
port attachment geometry and from compiled Worker artifacts. The schema-v2 core boundary is
`src/tilefab/core/OperationalConfiguration.ts`.

## Explicit draft contract

A new state is intentionally unresolved. It contains no inferred pickup/drop-off role, EQ
qualification, storage capacity, policy, or vehicle profile. Missing records are valid draft data
and produce readiness issues; they never select product defaults.

The state owns:

- one optional explicit transfer-capability row per stable port;
- logical EQ capabilities, physical EQ-group defaults, and optional per-port replacement overrides;
- logical storage classes/policies and physical OHB/STK capacity, initial occupancy, and high-water
  marks;
- explicit dedicated resident-vehicle home slots, each bound to one stable authored port ID;
- one nullable vehicle reservation profile;
- monotonic logical-definition ID cursors and a content revision;
- a nullable review binding.

Copying canonicalizes record and capability-reference order, freezes every retained record, checks
all intrinsic IDs/references/bounds, and produces a stable content fingerprint. A separate complete
state fingerprint includes the review envelope for persistence dirty checks and Worker parity. The
review binding contains the content fingerprint plus the authored rail revision/checksum. It cannot
attest to itself, and a retained review after a configuration edit is invalid.

## Physical/source validation

`collectOperationalConfigurationReadinessIssues` checks the draft against the current canonical
port/equipment state. It reports missing and foreign station rows, missing or wrong-kind EQ/storage
group rows, wrong-kind EQ overrides, foreign home-slot anchors, an unresolved vehicle profile, a
missing review, and a review bound to another authored source. Geometry, equipment names, barcode,
recipe text, port type/direction/group, and row order do not imply operational or home-slot policy.

`src/tilefab/compile/SimulationOperationalConfiguration.ts` is the only current adapter from this
authored state to Phase 6 readiness components. It first proves the exact port/group identity owned
by the static-world foundation, requires a zero-issue reviewed state, then compiles track resources,
station capabilities, equipment resources, and occupancy policy. It does not publish a certificate;
the disposable readiness Worker remains the independent publication boundary.

## Current gate

Native OpenFab project schema v10 persists this state in the `operations` section. Strict parsing
checks every nested key/value and canonicalizes it again; v9 schema-v1 operations first validate the
old review fingerprint, add an empty resident-home library, and reissue the review over schema v2.
Projects v0-v8 still migrate to an explicit empty draft. The serialization Worker, startup protocol,
activation model, automatic recovery, and manual save all preserve the section. Direct typed-snapshot
projects receive the same explicit empty draft. Project activation seals a canonical copy before
cooperative yields, while static mirror-snapshot re-derivation preserves the exact live document
state.

`RailDocument` owns the live state and commits canonical compact deltas as atomic undoable commands.
Semantic edit/undo/redo revisions and definition cursors remain monotonic, semantic edits clear stale
review, and review-only edits remain exactly undoable. Initial sync and every patch cross the typed
Rail Worker protocol; full-state fingerprint ACK, patch-scope validation, history-ledger parity,
clear/undo/redo, startup re-derivation, dirty state, autosave, and manual save all fail closed.

The six-stage reviewed editor includes a visibly non-runnable Resident Home surface. It creates,
updates, and removes only explicit vehicle/stable-port records; apply/review remains atomic,
undoable, autosaved, and Worker-mirrored. The resident parking compiler's product entry requires the
whole operational state to have a current exact-source review before it maps those records to
stationary footprints. This does not add a resident certificate or Run path. The existing limited
runtime profile and its app-wide authorization boundary remain unchanged.
