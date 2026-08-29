# OpenFab Rail Template Contract

Status: Phase 1.5 delivered contract, 2026-07-18.

## Scope and provenance

OpenFab templates are project-owned compositions of the public editor grammar. They are generated
from the directed 1 m `TileMap`, cardinal routes, R500 turns, and explicitly documented parameter
ranges. They do not contain imported factory layouts, company identifiers, extracted dimensions,
or copied map topology.

A template is an authoring convenience, not a second map model. Placement produces ordinary rail
cell mutations, one `RailDocument` command, one undo entry, and one typed Worker patch. Rendering,
physical compilation, editing, and deletion continue to consume the resulting authored map.

## Blueprint boundary

Each immutable `RailTemplateBlueprint` owns:

- a versioned project ID and discriminated metric parameters;
- one or more ordered local build routes;
- occupied cells and exact hard-reservation cells;
- terminal roles and directed attachment contracts;
- a display bound used only to frame the placement ghost;
- a declared network postcondition;
- a translation- and rotation-independent definition fingerprint.

Placement transforms the local blueprint using an integer anchor, one of four quarter-turn
directions, and an explicit left/right chirality. It also produces a transformed geometry
fingerprint and a map-instance mutation fingerprint. All generated coordinates must fit signed
32-bit integer Worker buffers.

Hard reservation and physical clearance are separate. Hard reservation protects exact branch,
merge, and support ownership. The `RailDraftEvaluator` derives the installation envelope from the
compiled physical path. The template display rectangle never blocks the empty interior of a Bay.

## Project-owned motifs

Let `C(u, v) = anchor + u * forward + v * side`, where `side` is the selected cardinal left or
right direction. Every segment expands into all intervening 1 m cells.

### Return hairpin

`C(0,0) -> C(L,0) -> C(L,W) -> C(0,W)`

- Parameters: run `L = 4..60 m`, lane spacing `W = 2..12 m`.
- Contract: open entry and open exit, two R500 turns, output travels opposite the input direction.
- Anchor: an empty map or an open terminal with matching forward direction.
- This is deliberately named a hairpin; it is not an independent closed loop.

### Tangent branch bypass

`C(0,0) -> C(0,W) -> C(L,W) -> C(L,0)` over an existing directed straight trunk.

- Parameters: trunk span `L = 8..80 m`, offset `W = 3..12 m`.
- Contract: one tangent branch, one same-direction merge, no open-end delta.
- Anchor: a directed straight trunk with exact upstream and downstream support cells.
- Hard reservation includes the complete trunk interval `C(-1,0)..C(L+1,0)`.
- Existing junctions, reverse routes, partial overlaps, and advanced-switch ownership are rejected.

### Long Bay starter

`C(0,0) -> C(L,0) -> C(L,W) -> C(0,W) -> C(0,0)`

- Parameters: aisle length `L = 12..120 m`, lane spacing `W = 4..24 m`.
- Contract: four R500 turns, no open terminals, one strongly connected directed cycle.
- Anchor: an empty map only.

## Placement gate

The planner must return a complete immutable ghost before mutation. A valid commit requires:

1. bounded integer parameters and signed-int32 transformed coordinates;
2. compatible terminal direction and exact anchor ownership;
3. no reverse edge, planar crossing, unsupported junction, or partial motif overlap;
4. valid compiler-derived clearance envelopes;
5. the motif-specific topology postcondition;
6. unique stable mutations suitable for one document event and Worker patch.

After placement, template provenance is intentionally not persisted in Phase 1.5. Every constituent
remains selectable, reshapeable, copyable, bulldozable, undoable, and reproducible from the
serializable authored map alone.
