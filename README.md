# OpenFab

OpenFab is an open-source Factory Digital Twin Platform for designing, validating, and eventually
simulating automated-factory logistics. Semiconductor FAB material handling is the first domain,
but the project is built around portable project data and renderer-independent factory logic.

Status: public `0.x` preview candidate. `v1.0.0` remains gated on exact deployed-build verification.

## OpenFab Builder

The current product is a grid-first 2D static-FAB editor. It can:

- construct directed modular rail with immediate valid/invalid feedback;
- organize Process Loops into Bays, Bay Banks, and a Fab;
- author OHB, EQ, and STK equipment from rail-attached ports;
- duplicate, arrange, connect, undo, redo, save, reopen, and recover projects;
- run separate geometry, directed-topology, organization, and port-service checks;
- guide a first-time user through the same ordinary commands and canonical project data used by the
  expert editor.

The serialized project is the source of truth. Canvas, Workers, and future 3D views consume derived
geometry; they do not create another editable map model.

## Product series

| Version line | Product | Default scope |
|---|---|---|
| `1.x` | OpenFab Builder | Guided and expert 2D static-FAB authoring |
| `2.x` | OpenFab Twin View | Derived read-only 3D over the same project truth |
| `3.x` | OpenFab Flow | Deterministic scenarios, simulation, and runtime outcomes |

The first clean public repository starts at `v0.1.0` so real users can validate the Builder before
the compatibility promise of `v1.0.0`.

## Run locally

```bash
pnpm install
pnpm dev -- --host 127.0.0.1 --port 5181
```

Then open `http://127.0.0.1:5181/` and choose Guided Build, Verified Template, or Blank Canvas.
The current Builder interface is Korean-first while commands retain concise domain labels.

## Verify

```bash
pnpm check:core
pnpm test -- --run
pnpm build
pnpm lint
pnpm check:release-identity
pnpm check:dependency-licenses
pnpm check:fixture-provenance
pnpm check:public-safety
pnpm check:live-demo
```

Area-specific browser gates are available as `check:authoring`, `check:project`, `check:scale`, and
`check:3d`. `check:public-release` requires the owner-approved license plus every security,
contribution, CI, provenance, dependency-notice, and release-documentation requirement.

`check:dependency-licenses` compares the installed frozen production graph with the reviewed
package/version/license baseline and rejects unreviewed platform-optional dependencies or license
IDs. It is metadata reconciliation, not a substitute for final human legal approval.

`check:release-identity` locks the non-publishable npm package as `openfab-builder`, requires exact
three-part SemVer and `Apache-2.0`, and reconciles the root license/notice, browser, README, and
Changelog product identity.

`check:fixture-provenance` allows only the declared code-generated synthetic data artifacts under
`src/` or `public/`, locks their SHA-256 identity and generator source, and rejects undeclared map,
tabular, model, image, or other data-bearing files. Final human originality review is still required.

`check:live-demo` mounts the default production build under an isolated repository-style subpath and
verifies portable asset URLs, first-run Guided entry, the 2D-only Builder capability surface, the
static simulation gate, responsive desktop/mobile layout, and zero console/page/network/HTTP
failures. Its owned static server deliberately sends no cross-origin isolation headers, proving the
Builder release does not depend on simulation-only hosting configuration. It also locks the
production document title, Korean language declaration, application identity, and description.

The default Builder build and development server do not require COOP/COEP or a provider-specific
hosting file. The private opt-in runtime build uses Vite `runtime` mode to enable those headers only
for the later simulation path that requires cross-origin isolation.

## Design and data boundaries

- [Vision](./VISION.md)
- [Deployment strategy](./DEPLOYMENT_STRATEGY.md)
- [Editor v1 release baseline](./docs/openfab-editor-v1-release-baseline.md)
- [Rail construction grammar](./docs/rail-construction-v3.md)
- [FAB layout authoring rules](./docs/fab-layout-authoring-rules.md)
- [Port-derived equipment boundary](./docs/port-derived-equipment-and-scenario-boundaries.md)

Only independently authored synthetic examples belong in the public product. Actual FAB layouts,
company or customer `.map` files, operational data, credentials, and private reference source are
prohibited.

## License and release status

Copyright 2026 이원배. OpenFab is available under the
[Apache License, Version 2.0](./LICENSE). The clean public preview is `v0.1.0`; do not represent it
as OpenFab `v1.0.0` until the exact public commit and deployed demo pass the final release audit.

See [Contributing](./CONTRIBUTING.md), [Security](./SECURITY.md),
[Changelog](./CHANGELOG.md), [Notice](./NOTICE), and
[Third-party notices](./THIRD_PARTY_NOTICES.md).
