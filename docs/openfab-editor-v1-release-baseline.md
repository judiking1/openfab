# OpenFab Editor v1 Release Baseline

> Status: binding product and release baseline, adopted 2026-08-27.
>
> This document defines the first public OpenFab product experience. It is subordinate to
> `VISION.md`, `DEPLOYMENT_STRATEGY.md`, and `docs/agent-working-principles.md`; it narrows the
> current editor work into a releaseable user journey without changing the directed TileMap,
> serialized project, Worker, history, IP, or platform boundaries.

## 1. Decision

OpenFab Editor v1 is not a collection of all implemented tools. It is a coherent static-FAB
construction product that a new user can learn and complete without reading external documentation.

The release has one primary promise:

> A first-time user can build, organize, equip, validate, save, reopen, and continue editing a
> synthetic FAB through one guided 2D journey.

Existing advanced authoring, derived 3D, readiness, and simulation work stays preserved. Later-stage
capability does not justify exposing it in the default v1 journey before the editor promise passes.

## 2. Release train and version policy

OpenFab uses Semantic Versioning: `major.minor.patch`.

- `major`: a product series or an incompatible public contract change;
- `minor`: a backward-compatible product capability;
- `patch`: a backward-compatible correction.

The private incubation line and first clean public preview remain `0.x`. Do not claim or tag
`1.0.0` until the Editor v1 acceptance in this document and exact deployed-build audit pass.

| Version line | Public product | Default scope |
|---|---|---|
| `1.x` | OpenFab Builder | guided and expert 2D static FAB authoring |
| `2.x` | OpenFab Twin View | derived read-only 3D over the same project truth |
| `3.x` | OpenFab Flow | deterministic simulation, scenarios, runtime views, and outcomes |

The order is intentional. Derived 3D validates that another renderer can consume the same stable
project data without creating a second editable map. Simulation then adds time, resources, and
runtime ownership over that proven static world.

Use Conventional Commits for ordinary work. Version numbers belong in release commits and annotated
tags, not every commit:

```text
feat(onboarding): add guided process-loop mission
refactor(editor): move advanced actions behind expert tools
fix(port-authoring): preserve access direction on duplicate
docs(release): define editor v1 acceptance gate
chore(release): v1.0.0
```

Every commit must remain independently understandable, revertible, and green under
`docs/agent-review-rubric.md`.

## 3. First-run entry

The first useful decision is not a rail module. It is how the user wants to begin.

```text
START OPENFAB

[ GUIDED BUILD ]     Recommended first FAB
[ VERIFIED TEMPLATE ] Start from synthetic OpenFab content
[ BLANK CANVAS ]      Expert authoring surface
```

- **Guided Build** enters the sequential learning journey below and progressively reveals tools.
- **Verified Template** uses only independently authored synthetic OpenFab profiles and exposes the
  exact verification scopes that passed.
- **Blank Canvas** opens the complete expert editor without requiring tutorial completion.

The guided path is strongly sequenced but never a global lock. A user may leave it for the expert
surface and may resume later. No real station map, customer layout, private identifier, or copied
source asset is used as tutorial content.

## 4. The first 15-minute FAB journey

The public hierarchy remains:

```text
Rail Piece -> Process Lane / Process Loop -> Bay -> Bay Bank -> Fab
```

A small closed loop is a Process Loop, never a Bay. A Bay owns a larger circulation shell, one or
more Process Loops, and typed gateways.

| Mission | User outcome | Primary concepts | Just-in-time input |
|---|---|---|---|
| `ORIENT` | Frame and navigate the empty training site | pan, zoom, fit, selection | RMB drag, wheel, Fit All command |
| `FIRST_RAIL` | Build one directed rail run | start, destination, direction, valid ghost | LMB drag, `Esc`, undo |
| `PROCESS_LOOP` | Close one directed Process Loop | continuity, flow, closure, local validation | continuation, rotate/side choice, undo |
| `PORTS` | Add representative OHB, EQ, and STK ports | port-first placement, facing, access, grouping | current Equip bindings only when needed |
| `REUSE_LOOP` | Duplicate the completed Process Loop | selection, copy, repeat placement, alignment | copy/paste or duplicate, rotate |
| `BAY` | Form one semantic Bay from its shell and internal loops | hierarchy, ownership, gateways | Assemble selection and Bay action |
| `BAY_BANK` | Duplicate and arrange Bays into one Bank | array-like repetition, spacing, group ownership | repeat duplicate, arrange |
| `INTERBAY` | Connect compatible Bay Banks into one Fab | typed branch/merge gateways, Fab-owned outbound/return flow | Connect Banks and corridor choice |
| `FAB_LOOP` | Complete the outer Fab circulation | whole-Fab flow, reachability, no open terminal | contextual construction actions |
| `VERIFY_SAVE` | Pass checks, resolve one issue, save and reopen | scoped evidence, repair, native persistence | Checks, Save, Open |

Time is a usability target, not a correctness shortcut. The journey must not weaken graph,
clearance, organization, port, persistence, or Worker validation to fit 15 minutes.

## 5. Mission behavior

Guided Build is state-based, not a prerecorded click script.

- Mission completion is evaluated from canonical authored project data and its accepted compiled
  evidence, never from DOM clicks, renderer objects, or a private tutorial map model.
- A shortcut, pointer action, blueprint, or another legal command may satisfy the same mission.
- Undo must be able to make a previously satisfied authored condition incomplete again without
  corrupting progress or history.
- The user sees one primary objective, one short explanation, the next valid action, and only the
  currently useful shortcut.
- Invalid work receives normal editor validation and a concrete repair route; the tutorial never
  bypasses or patches project data directly.
- Tutorial preferences and acknowledgement state are user-interface data accessed through a
  platform port. They are not serialized organization, rail, equipment, scenario, or renderer
  truth.
- A mission evaluator is platform-independent. React presents its immutable result and calls
  ordinary editor commands.

The first implementation must prove the boundary with `ORIENT`, `FIRST_RAIL`, and `PROCESS_LOOP`
before adding later missions. Do not build a large campaign framework or plugin system.

## 6. Progressive editor surface

The current capabilities remain grouped under four product activities:

```text
BUILD       direct rail construction and repair
ASSEMBLE    Fab, Bank, Bay, blueprint, duplicate, arrange, connect
EQUIP       port-first OHB, EQ, and STK authoring
INSPECT     selection, properties, checks, help, and derived views
```

The v1 default surface is deliberately smaller:

- **Top:** project identity/save state, Open/Save, Undo/Redo, Checks, Help.
- **Left:** the four activities, progressively revealed in Guided Build and fully visible in Expert.
- **Center:** the canonical 2D Canvas.
- **Right:** either the current mission or the selected object's properties, never two competing
  primary panels.
- **Bottom:** one contextual action/shortcut strip.

The following are not first-run primary actions:

- debug metrics, raw topology counts, Worker state, and implementation fingerprints;
- disabled future-view buttons;
- a flat gallery mixing complete Fabs, semantic organizations, blueprints, and rail motifs;
- persistent advanced repair geometry when no matching selection exists;
- duplicate launch points for the same product command.

Do not delete capability merely to simplify a screenshot. Move an action behind its owning activity,
selection context, Help/command search, or an explicit Expert Tools disclosure. Remove a legacy
surface only after pointer, keyboard, compact-width, persistence, and command parity are proven.

## 7. Shapez-inspired principles

OpenFab borrows interaction principles, not visual assets, source, terminology, or domain rules:

1. one visible goal at a time;
2. progressive disclosure;
3. immediate valid/invalid placement feedback;
4. reliable cancellation and undo;
5. repeat placement and reusable blueprints;
6. contextual input coaching instead of a permanent shortcut wall.

Decorative gamification, economy, achievements, or a separate game architecture are out of Editor
v1 scope.

## 8. Public repository boundary

The private repository is an incubator and must not be converted directly to public.

After Editor v1 acceptance:

1. complete an IP, secret, dependency-license, and synthetic-fixture audit;
2. export only the public-safe source and documentation into a new `OpenFab` repository;
3. start a clean public history and tag the first feedback release `v0.1.0` there;
4. publish a web demo from that exact public source, then tag `v1.0.0` only after its final audit;
5. make the public repository the canonical product line for `1.x`, `2.x`, and `3.x`.

Do not mirror the private Git history. Do not carry local reference files, actual `.map` data,
review-only input files, absolute private paths, credentials, diagnostic dumps, or internal notes.

## 9. Editor v1 acceptance

`v1.0.0` requires all of the following:

- a first-time user can finish Guided Build with no external document;
- a returning user can choose Template or Blank Canvas without tutorial obstruction;
- every authored mission mutation is one atomic history entry and one typed Worker patch;
- Save/Open and recovery preserve the exact authored project and allow continued editing;
- Process Loop, Bay, Bank, and Fab language matches canonical ownership;
- OHB/EQ/STK authoring remains port-first;
- Checks expose Geometry, Directed Topology, Organization, and Port Service separately;
- Guided and Expert paths are keyboard complete, focus safe, and operable at desktop, 760 px, and
  390 px widths with 44 px primary targets;
- the one-tab production journey has no application error, page error, unbounded Worker lifetime,
  or unexplained memory growth;
- only public-safe synthetic examples ship;
- README, license, third-party notices, security policy, contributing guide, CI, release notes, and
  a live-demo path are ready for the clean public repository;
- the ordinary static Rail mirror continues to publish `simulationReady=false`.

Derived 3D and simulation may exist in the private incubator while v1 is prepared. Their presence
does not waive this acceptance and they are not part of the default v1 promise.

## 10. Delivery sequence

1. **Baseline and surface inventory** — adopt this document; classify every current control as
   `KEEP`, `CONTEXT`, `EXPERT`, `DEFER`, or `REMOVE_AFTER_PARITY`.
2. **Guided domain foundation** — immutable scenario/mission definitions and project-derived mission
   evaluation outside React and browser APIs.
3. **First-run launcher** — Guided Build, Verified Template, Blank Canvas; cancellable and focus safe.
4. **Learning slice** — `ORIENT`, `FIRST_RAIL`, `PROCESS_LOOP` with contextual hints and undo-aware
   evaluation.
5. **Port and reuse slice** — `PORTS`, `REUSE_LOOP`, `BAY`.
6. **Factory composition slice** — `BAY_BANK`, `INTERBAY`, `FAB_LOOP`.
7. **Completion slice** — `VERIFY_SAVE`, issue repair, native round trip, resume.
8. **Surface pruning** — remove duplicate entry points only after command and accessibility parity.
9. **Public release audit** — full serialized gates, memory evidence, clean export, demo, and
   `v1.0.0`.

The active implementation order lives in `docs/HANDOFF.md`. Detailed existing surface contracts
remain in `docs/static-fab-ui-ux-redesign.md` and `docs/shapez-inspired-authoring-ux.md`.
