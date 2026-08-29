# Third Party Notices

This file records OpenFab's reviewed production dependency metadata and a known public design
reference. It is an attribution record, not a legal compatibility opinion. The exact platform-neutral
production graph is locked in `docs/openfab-production-dependency-licenses.json` and checked against
the installed frozen lockfile by `pnpm check:dependency-licenses`.

## Production dependencies

The direct production packages declared by OpenFab are:

| Package | Role | Declared license |
|---|---|---|
| `@tailwindcss/vite@4.2.2` | Build integration | `MIT` |
| `lucide-react@1.24.0` | UI icons | `ISC` |
| `react@19.2.4` | UI runtime | `MIT` |
| `react-dom@19.2.4` | DOM runtime | `MIT` |
| `tailwindcss@4.2.2` | CSS build tooling | `MIT` |
| `three@0.185.1` | Opt-in derived 3D rendering | `MIT` |

The reviewed platform-neutral production closure contains 32 exact package/version/license rows:
`MIT` 26, `ISC` 3, `Apache-2.0` 1, `BSD-3-Clause` 1, and `MPL-2.0` 1. A frozen install may add
platform-specific optional native packages; the audit checks every installed production row and
rejects any license ID outside those five reviewed families. On the current macOS arm64 install the
complete production set is 38 packages: `MIT` 31, `ISC` 3, `Apache-2.0` 1, `BSD-3-Clause` 1, and
`MPL-2.0` 2.

The `MPL-2.0` package is Lightning CSS and its platform binding, used by the CSS build toolchain.
Dependency source distributions retain their original copyright and license files. In particular,
the browser-facing packages include these notices:

- React, React DOM, and Scheduler: Copyright (c) Meta Platforms, Inc. and affiliates (`MIT`).
- three.js: Copyright © 2010-2026 three.js authors (`MIT`).
- Lucide: Copyright (c) 2026 Lucide Icons and Contributors (`ISC`); Lucide's package license also
  identifies Feather-derived icons and the Feather copyright of Cole Bemis (`MIT`).
- Tailwind CSS and its Vite integration: Copyright (c) Tailwind Labs, Inc. (`MIT`).

Use each dependency's installed `LICENSE` file as the authoritative license text. Any dependency or
license change must update the machine-readable baseline and this notice in the same reviewed commit.

## IsoCity / IsoCoaster

- Repository: https://github.com/amilich/isometric-city
- License: MIT
- Copyright: Copyright (c) 2025 amilich

OpenFab's rail authoring implementation was written independently. The public IsoCity/IsoCoaster
project was studied only as a conceptual UI reference for Canvas tile interaction, drag-to-build
placement, hover previews, and modular transport construction; no upstream source body, variable
name, comment, file structure, or asset is copied into OpenFab. Its notice is retained to make that
design influence explicit.

MIT License text from the upstream project:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
