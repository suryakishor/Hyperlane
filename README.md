# Hyperlane

[![CI](https://github.com/suryakishor/hyperlane/actions/workflows/ci.yml/badge.svg)](https://github.com/suryakishor/hyperlane/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.186-black?logo=three.js&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)

**Play:** <https://hyperlane-topaz.vercel.app>

A browser-based 3D endless runner built with TypeScript, Vite and Three.js. You
pilot a courier down an orbital supply lane, dodging hazards and collecting flux
cells while the lane accelerates until your reflexes give out.

Runs entirely client-side: no backend, no accounts, and no network calls after
the first page load. Every visual and audible asset — geometry, textures, music
and sound effects — is generated at runtime from code in this repository.

## Features

- **Endless procedural runs.** Rows are generated from a seeded RNG, so any run
  can be replayed exactly with `?seed=1234` in the URL.
- **Solvable-by-construction tracks.** Every generated row is checked against two
  invariants: a lane never holds more than one obstacle, and dodge-only hazards
  never block all three lanes at once. A row that fails the check has its
  obstacles dropped rather than being placed.
- **Frame-rate independent swept collision.** At 33 m/s a low frame rate moves a
  hazard further than its own depth, so obstacles are tested across the span they
  travelled that frame, which removes tunnelling without a physics engine.
- **Difficulty that ramps then plateaus.** Speed climbs from 15.5 m/s to 33 m/s
  over 5200 m while row spacing tightens from 46 m to 24 m, never below a 0.82 s
  reaction window.
- **Pooled and instanced rendering.** Obstacles are recycled per kind, flux cells
  are a single `InstancedMesh`, and track segments recycle behind the player, so
  live object counts stay flat however far a run goes.
- **One fixed rendering preset.** Antialiasing, a 1024 px shadow map, a rim and
  fill light, and 220 speed streaks are always enabled — there is no quality
  setting to choose between — and the device pixel ratio is capped at 2 to bound
  fill rate on high-DPI screens.
- **No data written to your device.** Best score, best distance and callsign are
  held in memory for the current session only — nothing is written to
  `localStorage`, cookies or IndexedDB, so closing the tab leaves nothing behind.
- **One input model on every device.** Keyboard on desktop and swipe gestures on
  touch feed the same internal actions, so there is no separate mobile movement
  implementation to keep in sync.
- **A read-only diagnostics API** on `window.hyperlane` for inspecting a live
  run from the console.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move left | `←` / `A` | Swipe left |
| Move right | `→` / `D` | Swipe right |
| Jump | `Space` / `↑` / `W` | Swipe up |
| Slide | `↓` / `S` | Swipe down |
| Pause | `Esc` / `P` | HUD pause button |

Three lanes; you cannot leave the outer lanes. **Jump** clears barriers,
**slide** clears gates, and pylons and drones have to be dodged sideways. Score
is distance in metres plus collected flux cells.

## Tech stack

| Layer | Technology | Role |
| --- | --- | --- |
| Language | TypeScript 7.0.2 | Strict-mode source, compiled by Vite |
| 3D rendering | Three.js 0.186.1 (WebGL) | Scene graph, materials, lighting, `InstancedMesh` |
| Shaders | GLSL | Procedural sky gradient (`ShaderMaterial`) |
| Textures | Canvas 2D API | Deck, hazard and flux textures drawn at runtime |
| Build & dev | Vite 8.3.1 | Dev server with HMR, production bundling |
| Type checking | `tsc --noEmit` | `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals` |
| Audio | Web Audio API | Music and SFX synthesised in the browser |
| UI | Vanilla DOM + CSS | HUD, menus and overlays — no UI framework |
| Input | Keyboard + Pointer Events | Key bindings and swipe gestures |
| Loop | `requestAnimationFrame` | Delta time clamped to 50 ms, frame-rate independent systems |
| Persistence | None | Session-only state in memory; no `localStorage`, cookies or IndexedDB |
| CI | GitHub Actions | Typecheck and production build on pushes to `main` and on pull requests |

**Dependencies:** `three` is the only entry in `dependencies` and the only
third-party package whose code reaches `dist/`; `vite`, `typescript` and
`@types/three` are devDependencies that never ship. There is no physics engine, no
UI framework, no state-management library and no asset pipeline — collision,
animation, audio and textures are all hand-written against the seeded RNG, which
is what makes a run reproducible.

## Getting started

Requires Node 20 or newer.

```bash
git clone https://github.com/suryakishor/hyperlane.git
cd hyperlane
npm install
npm run dev      # http://localhost:5173
```

### Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type checks, then builds the production site into `dist/` |
| `npm run preview` | Serves the production build on port 4173 |
| `npm run typecheck` | `tsc --noEmit` over the app sources and the Vite config |

There is no automated test suite. `npm run typecheck` and `npm run build` are the
verification steps, and CI runs both on Node 22 for pushes to `main` and for pull
requests.

## Project structure

```text
src/
├── main.ts                 boot, error surface, diagnostics install
├── core/
│   ├── Game.ts             orchestrator: loop, renderer, state
│   ├── GameState.ts        authoritative state machine
│   ├── GameLoop.ts         frame-rate independent rAF loop
│   ├── GameConfig.ts       all tuning values
│   ├── Difficulty.ts       pure difficulty curve
│   └── Diagnostics.ts      read-only window.hyperlane API
├── player/                 movement state, collider, procedural rig
├── world/                  recycled track segments, seeded row generator
├── obstacles/              pooled obstacle views + collision metadata
├── collectibles/           instanced flux cells + collection effects
├── collision/              swept AABB and sphere/box tests
├── camera/                 follow, speed FOV, portrait framing
├── render/                 scene, lights, procedural textures
├── input/                  keyboard and swipe input
├── audio/                  synthesised music and SFX
├── scoring/                distance and coin scoring
├── ui/                     DOM screens and HUD
└── utils/                  math, seeded RNG, storage, username validation
```

### Design notes

- **Custom collision instead of a physics engine.** The player is a box, hazards
  are axis-aligned boxes and flux cells are spheres, so swept AABB tests are
  exact and deterministic. The inner loop reuses a scratch index array and
  allocates nothing per hazard, where a physics engine would add a WASM payload
  and a non-deterministic solver for no gameplay gain.
- **One authoritative state machine.** `loading → menu → ready → playing →
  paused / gameOver`. Illegal transitions are rejected and logged rather than
  silently corrupting state.
- **The character is a rig, not an asset.** Geometry, run cycle, slide and crash
  are driven from `PlayerRig.ts` in proportion to player state, so the on-screen
  silhouette always matches the collider the game collides with.
- **Silhouettes over colour.** The four hazard kinds have distinct outlines
  (barrier, gate, pylon, drone) and each carries emissive detail, so a hazard is
  identifiable by shape at distance rather than by hue alone.

## Diagnostics

`window.hyperlane` exposes a small read-only view of the running game, so a run can
be inspected from the console instead of being reconstructed from a screen
recording. It never mutates state and contains no debug shortcuts. The current
phase is mirrored onto `<body data-phase>`.

```js
window.hyperlane.version   // "1.0.0"
window.hyperlane.telemetry()   // full snapshot of the current run
```

Useful fields: `state`, `username`, `score`, `coins`, `distance`, `speed`,
`difficulty`, `seed`, `lane`, `playerX`, `playerY`, `isJumping`, `isSliding`,
`isCrashed`, `quality`, `drawCalls` and
`world.{segments, activeSegments, obstacles, obstacleKinds, coins, coinCapacity,
rowsGenerated}`.

## Deployment

Live at <https://hyperlane-topaz.vercel.app>.

The build is a fully static site — `npm run build` emits `dist/`, which can be
hosted on any static host (GitHub Pages, Netlify, Cloudflare Pages, or a plain
CDN). No server-side runtime, no environment variables and no build-time
configuration are required; the deploy command is `npm run build` and the publish
directory is `dist`.

For Vercel, [`vercel.json`](vercel.json) is included and sets the framework, build
command, output directory and install command, applies immutable caching to
hashed assets under `/assets/`, and adds `X-Content-Type-Options` and
`Referrer-Policy` headers. Importing the repository and accepting the defaults is
all that is required.

### Environment variables

None. The project has no backend, no API keys and no build-time configuration.
`import.meta.env` is used only for Vite's built-in `import.meta.env.DEV` flag.

## License

[MIT](LICENSE) © 2026 suryakishor

This project contains no third-party visual or audio assets — all geometry,
textures, audio and the favicon are generated at runtime or hand-authored for this
repository. See [ASSETS.md](ASSETS.md) for the full asset provenance and
third-party code table.
