# Contributing to OpenFab

OpenFab welcomes independently authored improvements to factory design, validation, visualization,
and simulation. The current release focus is OpenFab Builder: a complete 2D static-FAB authoring
journey over one serializable project model.

By submitting a contribution for inclusion, you agree that it is provided under the repository's
Apache License, Version 2.0, unless you explicitly mark it as not a contribution before submission.

## Before you start

Read:

- [Vision](./VISION.md)
- [Deployment strategy](./DEPLOYMENT_STRATEGY.md)
- [Editor v1 release baseline](./docs/openfab-editor-v1-release-baseline.md)
- [FAB layout authoring rules](./docs/fab-layout-authoring-rules.md)
- [Rail construction grammar](./docs/rail-construction-v3.md)

For a large change, open a design issue first. Describe the user outcome, data-model impact, Worker
or persistence boundary, test plan, and how the change fits the current product series.

## Intellectual-property and data rules

Contributions must be independently implementable and safe to publish.

- Do not copy source bodies, comments, variable names, file structure, visual assets, icons, models,
  or private documentation from another project.
- Do not submit actual factory layouts, company or customer `.map` files, operational data,
  credentials, internal hostnames, or private identifiers.
- Use independently authored synthetic fixtures. General factory concepts and publicly documented
  algorithms may be implemented from first principles.
- Add attribution and compatible license notices for any intentionally incorporated third-party
  material.

If provenance is unclear, stop and ask before committing the material.

## Architecture rules

- Serializable project data is the source of truth; Canvas, 3D, and Workers consume derived data.
- Keep core/domain logic independent of React, DOM, and direct browser APIs.
- Access storage and files through interfaces and platform adapters.
- One authored mutation must be atomic, undoable, and mirrored through the typed Worker protocol.
- Do not introduce a second editable map for 3D or enable simulation before its published gate.

## Development

```bash
pnpm install
pnpm dev -- --host 127.0.0.1 --port 5181
```

Before submitting a change, run:

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

Run the relevant browser gate as well: `check:authoring`, `check:project`, `check:scale`, or
`check:3d`. Do not weaken an assertion, timeout, topology rule, or memory budget to make a change
pass.

## Commits and pull requests

Use Conventional Commits, for example:

```text
feat(authoring): add contextual bank arrangement
fix(project): preserve port groups after reopen
docs(release): clarify public export boundary
```

Keep commits focused, independently understandable, and green. A pull request should explain the
user-visible outcome, important invariants, verification commands and results, memory or performance
impact when relevant, and any remaining risk.

For a milestone checkpoint, keep the Conventional Commit subject focused and include
`OpenFab x.y.z development checkpoint.` in the body together with the exact clean-export
fingerprint. Complete the repository pull-request template, including the proposed
`release.feature.fix` impact and public-safety checklist.
