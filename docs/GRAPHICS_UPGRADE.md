# Graphics and gameplay upgrade (branch `feature/jotp-daynight-graphics`)

What was built, from which sources, how it was checked, and what is still open.

## What it does

| Area | What you get | Where |
| --- | --- | --- |
| JOTP day / night | Day for 3:00 from takeoff (nights: grey moonlight bright enough to see by, plus 71 extra street lights along the roads), then night, alternating; each change eases over 10 s (sky gradient, sun sinking / moon rising, stars, clouds, sun and sky light, fog, exposure, street lamps, shop and room lights, lamp pools and cones, lamp heads, lit windows, character self-light, smoke). Same sky for everyone: worked out from the server's takeoff time (in every snapshot) and the synced server clock. Other modes keep their lighting. | `shared/src/sim/porch.ts` (`porchNight`), `shared/src/config/porch.ts` (`dayNight`), `client/src/game/lighting.ts` (`live`, `setNight`), `renderer.ts`, `world/worldBuilder.ts` (`setNight`, `nightGlow`), `game.ts` (`updateTimeOfDay`) |
| Minimap | ~30 fps with eased motion; the riot's edge (inward-marching hatch, pulsing when it closes in or you are outside), the next safe area drawn on, a distance line to it and an edge arrow when it is off view, numbered squad markers, view cone, upright labels, north marker, scale bar, "turns with you" option, glass box, larger text on phones | `client/src/ui/minimap.ts` |
| Post effects | HDR scene buffer + MSAA, NaN/Inf sanitize, bloom (bright things only by day; lamps, windows and signs at night), ACES (same curve as before) + light grade in perceptual space, cinematic vignette hook, optional SSAO (the menu depth of field was removed: too costly) | `client/src/game/postfx.ts`, `renderer.ts` |
| Particles | Muzzle sparks / smoke per weapon class (suppressed guns: none), casings (brass, red shotgun hulls), impacts by surface (sparks + grey dust; clods + brown dust; water spray), grenade fireball / smoke / debris / dust ring, running dust, surf splashes | `client/src/game/fx/quarksFx.ts`, `fx/effects.ts`, `game.ts` |
| Billboards | Per-board playlists (code-drawn motion graphics, images, looping video, sprite-sheet sequences, the original painted ad as fallback), timed rotation, brightness, distance / facing limits (videos pause). Seven motion designs. The ESPN live boards are untouched. | `client/src/game/world/billboards.ts`, `worldBuilder.ts` (`billboard`) |
| Cinematic UI | JOTP intro (stripes, letter slam, countdown on the game's own clock, skippable), stamped eliminations, SQUAD WIPED, banner / toast / end-screen motion, NIGHT FALLS / SUNRISE, menu entrance motion; reduced-motion respected | `client/src/ui/cinematics.ts`, `styles/cinematic.css`, `porchHud.ts`, `hud.ts` |
| Weapon handling | Shotgun shell-by-shell reload and pump, pistol magazine change, bolt-rifle cant between shots, draw on switch, stride sway, landing dip | `client/src/game/characters/skinnedCharacter.ts`, `remotePlayer.ts` |
| DEV MODE | Settings -> DEV MODE -> passcode: JOTP alone, on foot in the plaza, no riot, every gun / ammo / heal / Perc 29 / armor / throwable laid out; N skips to the next day/night change, L lays the gear out again. Local only. | `client/src/ui/devMode.ts`, `net/session.ts`, `shared/src/sim/porch.ts` (`dev`, `layoutDev`) |

## Settings

Graphics (Settings -> VIDEO): **Post effects** (off by default; High only), **Ambient occlusion**
(off; needs post effects), **Minimap turns with you** (off). Post effects were on by default
for the first days of this branch and made the game slow (see Performance below); settings
saved then are reset to off once.

## Performance (measured 2026-11-22, uncapped)

Measured with `tools/scenarios/lag.mjs` (`--uncapped --dpr=2`, 1440x900 on a Retina-class
screen, this Mac's GPU, JOTP practice with 60 players): High, day 10 ms a frame (100 fps),
night 14 ms (73 fps), menu 7 ms; Medium 10 ms; Low 5.5 ms. With post effects on (High): night
23 ms (43 fps). Before the fix, with post effects on by default and depth of field on the menu,
the same test ran 46-64 ms (16-22 fps). The earlier "16.6 ms" figures in this document were
capped at 60 Hz and hid that cost.

## Source repositories, and how each was used

| Repository | Used how |
| --- | --- |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) (Zlib) | **Runtime dependency**, `postprocessing@6.39.6` (supports three r168-r187). EffectComposer, RenderPass, EffectPass, BloomEffect, DepthOfFieldEffect, NormalPass + SSAOEffect, ShaderPass. The tone mapping / grade / vignette is our own Effect. |
| [pmndrs/react-postprocessing](https://github.com/pmndrs/react-postprocessing) | Reference only (the game stays vanilla three.js; no React). |
| [Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks) (MIT) | **Runtime dependency**, `three.quarks@0.18.0` (three >= r182). BatchedRenderer, ParticleSystem (billboard, stretched billboard and instanced mesh particles), cone / sphere / point emitters, colour / size / force / rotation behaviours. Bursts go through the public `emit()` with a queued count. |
| [ManimCommunity/manim](https://github.com/ManimCommunity/manim) | Techniques only, reimplemented in TypeScript / Canvas: the `smooth` rate function, Create-style draw-on of the next safe area, Transform-style eased changes, steady tracked values. No Python in the game. |
| [Vincentwei1021/mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15) (MIT) | Studied: its films are code that draws any moment (`renderAt(t)`). The billboard motion designs and the intro follow that approach and its flat-vector / typography styles (letter slams, stripe wipes, counters), in the town's own look. No code copied. |
| [storytold/effectcraft](https://github.com/storytold/effectcraft) (MIT / Apache-2.0) | **Not run**: it is a desktop app (Rust), not installed here, and no Rust toolchain. The billboard system takes its exports as they are: WebM / MP4 (`video`), PNG sequences packed in a sprite sheet (`sequence`), stills (`image`). See "Adding billboard media". |
| [EL4CTEO/blender-skills](https://github.com/EL4CTEO/blender-skills) (MIT) | **Not run**: the skills drive Blender 5.2+, which is not installed here. See "Needs Blender". |

## Needs Blender (not done)

The Blender-based part of the request (re-modelled characters, buildings and interiors, weapon
models, new or retargeted animation clips, glTF export / QA through Blender Skills) was not
done: Blender is not installed on this machine, and installing a large desktop application was
left to you. What was done instead, in code: the weapon-handling animation layer above, and the
character's face (sculpted in `tools/characters`). To pick this up:

1. Install Blender 5.3, then the skills: `/plugin marketplace add EL4CTEO/blender-skills` and
   `/plugin install blender-agent-skills@blender-agent-skills`.
2. Characters are generated by `npx tsx tools/characters/build.ts` into
   `client/public/assets/characters/ink.glb` (rig and clips from the CC0 Quaternius rig). A
   Blender pass should keep that rig's bone names and the 24 clip names, or the runtime
   (`skinnedCharacter.ts`) and every outfit piece stop fitting.
3. Buildings are generated from `shared/src/map/*` (collision and visuals from the same data):
   imported building art must keep those footprints, door and window openings.

## Adding billboard media (e.g. from EffectCraft)

1. Export from EffectCraft's render queue: WebM (VP9) or MP4 (H.264) at 1024 x 512 (2:1, the
   boards' shape), muted, a seamless loop; or a PNG sequence packed into one sprite sheet.
2. Put the file in `client/public/assets/billboards/`.
3. Add it to a board's playlist in `BOARDS` (`client/src/game/world/billboards.ts`), e.g.
   `ajs: { items: [{ kind: 'video', url: 'assets/billboards/ajs.webm', seconds: 8 }, { kind: 'painted', seconds: 4 }] }`.
   If the file fails to load, the board shows its painted ad.

## How it was checked

- `npm run typecheck`, `npm test` (shared 80 / client 8 / server 26), `npm run build`: all pass.
- New tests: the day/night schedule (`porchNight`: boundaries, fades, no jumps), DEV MODE
  (on foot at the spot, everything laid out, no riot damage, the match runs on).
- Browser runs (headless Chrome, scripts in `tools/out/sc/`): day / dusk / night in the town;
  online, two separate browsers in one private JOTP match on the local server: identical
  takeoff and night value throughout, night falling at 3:00 on the live server with the 10 s
  fade (0.40 at +4.3 s, 0.99 at +9.4 s); the minimap through a riot phase (inside, outside the
  next area, inside the riot, turning mode); post effects off / on by day and night; particles
  (rifle into a wall, into dirt, a grenade); every animated board and a live ESPN board; the
  intro; DEV MODE (wrong passcode refused, 0081 accepted, pickup works, N skips to night); the
  pistol reload and the weapon draw.
- Frame time: see Performance above (uncapped measurements). Nothing was measured on a phone.

## Known gaps

- The late-join case could not be run end to end: a JOTP match cannot be joined once under
  way (an existing limit). The design covers it (takeoff and clock come from the server).
- Assists are not tracked by the game, so there are no assist notifications.
- Tire smoke: the vehicles are scenery and never drive, so it was not added.
- Weather particles were not added (the request makes them optional).
- Bundle size: the client's main chunk is about 1.12 MB (370 kB gzipped) with both libraries.

## Review and deploy

- Everything is on `feature/jotp-daynight-graphics` (one commit per phase), nothing deployed.
- Review: `npm install`, `npm run dev` (client on :5173, server on :2567), play a practice
  JOTP match (or DEV MODE), toggle Settings -> VIDEO -> Post effects.
- Deploy as before (README "Deploying") after merging; the server needs no new configuration.
