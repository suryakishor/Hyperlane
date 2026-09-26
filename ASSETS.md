# Assets

Hyperlane contains **no third-party visual or audio assets**. Every in-game visual
and sound is either generated at runtime from code in this repository or authored
by hand for it, so there is no third-party media to license, attribute or replace.
The only third-party code involved is the npm package listed under
[Third-party code](#third-party-code).

## Visual assets

| Asset | Source | License | Modifications |
| --- | --- | --- | --- |
| Player character | Procedural geometry in `src/player/PlayerRig.ts` (boxes, spheres), animated by a hand-written rig | Project-original | n/a |
| Track and scenery | Procedural geometry in `src/world/Track.ts` | Project-original | n/a |
| Hazard views | Procedural geometry in `src/obstacles/ObstacleManager.ts` | Project-original | n/a |
| Flux cells | Procedural `OctahedronGeometry` in `src/collectibles/CoinManager.ts` | Project-original | n/a |
| Deck / hazard / flux / window / glow textures | Drawn to `<canvas>` at runtime in `src/render/Textures.ts` | Project-original | n/a |
| Sky gradient | GLSL shader in `src/render/SceneEnvironment.ts` | Project-original | n/a |
| Favicon | `public/favicon.svg`, hand-authored for this project | Project-original | n/a |
| Typography | System font stack (see `src/ui/styles.css`) | Platform-provided | n/a |

## Audio assets

| Asset | Source | License | Modifications |
| --- | --- | --- | --- |
| Music loop | Synthesised with the Web Audio API in `src/audio/AudioManager.ts` | Project-original | n/a |
| SFX (jump, slide, coin, hit, countdown, start, game over, UI click) | Synthesised with the Web Audio API in `src/audio/AudioManager.ts` | Project-original | n/a |

No audio files are downloaded, bundled or streamed.

## Third-party code

| Package | Version | License | Use |
| --- | --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | 3D rendering |
| [vite](https://github.com/vitejs/vite) | 8.3.1 | MIT | Build tool and dev server |
| [typescript](https://github.com/microsoft/TypeScript) | 7.0.2 | Apache-2.0 | Type checking |
| [@types/three](https://github.com/DefinitelyTyped/DefinitelyTyped) | 0.186.0 | MIT | Type declarations for three |

All four are installed from npm. `three` is the only entry in `dependencies` and
the only one whose code is bundled into `dist/`; the other three are devDependencies
that never ship, and the type package contains no runtime code at all.

## Originality

The endless-runner genre is used as a design reference only. Hyperlane's setting
(an orbital supply lane), its courier character, the flux collectible, the neon
hazard language, the copy and the UI layout were all created for this project. No
characters, logos, sounds, maps, textures, fonts, animations or branding from any
existing game were copied or adapted.
