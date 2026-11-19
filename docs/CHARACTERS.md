# Urban Ink characters

WHOOPA TOWNE's character art style: stylized adult streetwear characters, sculpted in 3D,
skinned to a real skeleton, cel-shaded with an ink outline. This document covers how the
characters are made, how they get into the game, and how to add new clothing.

## What's where

| Part | Files |
| --- | --- |
| The generator (builds the character GLB) | `tools/characters/build.ts` |
| Body, head and hands sculpt | `tools/characters/anatomy.ts` |
| Clothing (tops, bottoms, shoes) | `tools/characters/garments.ts` |
| Skeleton (from the CC0 rig, adult proportions) | `tools/characters/skeleton.ts` |
| Meshing and decimation | `tools/characters/mesher.ts` |
| Skin weights | `tools/characters/weights.ts` |
| Shape-modelling primitives | `tools/characters/sdf.ts` |
| GLB reading and writing | `tools/characters/glb.ts` |
| **The generated asset** | `client/public/assets/characters/ink.glb` |
| Assembling a look at runtime | `client/src/game/characters/look/assemble.ts` (`buildInkOutfit`) |
| Cel shading and ink outline | `assemble.ts` (`LOOK_MATERIAL`), `skinnedCharacter.ts` (`outlineMaterial`) |
| Hair, hats, masks, beards | `client/src/game/characters/look/hair.ts`, `headwear.ts`, `face.ts` |
| Chains, watches, gloves, bags, pants chain | `client/src/game/characters/look/jewelry.ts` |
| Look options, presets, wire code | `shared/src/config/appearance.ts` |
| Raw asset viewer (dev) | `?debug=ink` (`client/src/debug/inkViewer.ts`) |

## How a character is made

1. **Skeleton.** The generator reads the CC0 Quaternius rig (`characters/hoodie.glb`): bone
   names, hierarchy, rest rotations and all 24 animation clips. It lengthens the upper arms
   (×1.42), widens the shoulders (×1.3) and shrinks the cartoon-sized hands (×0.8), then
   recomputes the bind pose. Only bone *lengths* change, never rotations, so every clip
   (idle, walk, run, strafe, aim, shoot, reload, death, wave, roll, ...) plays unchanged.
2. **Sculpt.** Each part is a signed distance shape built from blended anatomical masses:
   pelvis, ribcage, pecs, lats, obliques, glutes, trapezius, deltoids, biceps and triceps,
   forearm muscles; a palm with a heel and thumb pad and five jointed fingers; quads,
   hamstrings, calves and knees; a head with cranium, jaw, chin, cheekbones, brow ridge, eye
   sockets and lids, nose, lips and ears. Clothing is a real cloth shell a few millimetres
   thick, shaped around that body, with hems, cuffs, folds and designed details.
3. **Mesh.** Surface nets turn each shape into triangles. Quadric edge-collapse decimation
   brings them down to a budget (open hems are locked so they stay clean). Vertices are
   snapped onto the true surface and normals come from the shape, so shading is smooth.
4. **Skin.** Every vertex belongs to a body region (a thigh never follows the other leg),
   blends between that region's bones by distance, and the weights are smoothed over the
   mesh so elbows and knees bend without creasing.
5. **Bake.** Ambient occlusion (creases, folds, armpits), seams and fabric detail are baked
   into the vertex colors: R = shading, G/B = masks (lips, darker skin).
6. **Write.** One GLB holds the skeleton, the clips, and every piece as a named material
   (`Top_Hoodie`, `Bottom_BaggyJeans`, `Shoe_Lowtop_Sole`, `Skin_Hand`, ...).

At runtime the look builder picks the pieces for a player's outfit, adds the procedural hair,
hats, masks, beards and jewelry fitted to the head and body, shapes body type, build,
shoulders and head size, and merges it all into **one skinned mesh** (one draw call, plus the
outline). The result is cached per look, and each player's colors are painted per vertex, so
nothing is rebuilt during play.

### The Urban Ink look

- **Cel shading.** The direct light (sun, street lamps, indoor lights) falls on a three-tone
  ramp with soft edges, so faces read as painted rather than faceted. Ambient light stays
  soft. A cool rim light lifts the silhouette.
- **Ink outline.** An inverted shell pushed out along smoothed normals. It is thinner on
  faces, hands, laces and jewelry, and it is dropped for players more than 28 m away (and on
  low quality / performance mode).
- **Materials.** Each fabric has its own roughness and sheen: cotton and fleece are matte,
  nylon (puffers) has a soft sheen, denim is matte with faded thighs, leather sneakers have a
  low gloss, metals shine.

## Rebuilding the asset

```bash
npx tsx tools/characters/build.ts                     # everything, full quality (~10 min)
npx tsx tools/characters/build.ts --only='Shoe'       # just matching pieces, the rest from cache
npx tsx tools/characters/build.ts --quick             # coarser skin voxels, for fast iteration
```

Piece groups are cached in `tools/out/inkcache/` (git-ignored). `--only` takes a regular
expression over group names (`body`, `hands`, `head`, `eyes`, `brows`, and each garment's
material name). After changing the skeleton or anatomy, rebuild everything (`--only=.`).

Look at the raw result at `http://localhost:5173/?debug=ink` (dev server). The page exposes
`window.inkView` (`view`, `show(regex)`, `play(clip, time)`, `rest()`) for scripted shots.

## Adding clothing

1. Add a garment in `tools/characters/garments.ts`. Tops use `top({...})`, bottoms
   `pants({...})`, shoes `shoe({...})`; or write any shape and return a `Garment` with its
   material name, bounding box, voxel size and triangle budget.
2. Rebuild just that piece: `npx tsx tools/characters/build.ts --only='Top_MyJacket'`.
3. Add the option to `shared/src/config/appearance.ts`. **Append it at the end of its list**:
   options are saved by position, so inserting or reordering would change saved looks.
4. Map the option to its piece in `buildInkOutfit` (`assemble.ts`), with its fabric.
5. To sell it at AJ'S, mark it with `aj(...)` and add a catalog item
   (see [ECONOMY.md](ECONOMY.md)).

New look *fields* go at the end of `EXTRA_FIELDS` (never reorder), with the default first.
Saved looks from before a field existed decode with that default.

## Customization

| Category | Options |
| --- | --- |
| Starter looks | Black Puffer, Black Hoodie (the reference fits; editable) |
| Body | body type, build, height, shoulder width, skin tone, head size |
| Head & face | head shape, face shape, eyes, eye color, eyebrows, nose, ears, expressions |
| Hair | fades, waves, afros, braids, cornrows, twists, locs, dreads, short and long styles; colors |
| Clothing | tees, tank, crop, hoodie, zip-up hoodie, puffer jacket, puffer vest; jeans (regular, baggy, slim), cargo, leggings, shorts; low-tops, running shoes, chunky sneakers, boots; hats |
| Accessories | chains (gold, silver, stacked silver, medallion, diamond, pendant), earrings, watches, glasses, face masks, gloves, pants chain, phone in hand (menus), bags (AJ'S) |

## Compatibility

- Existing saved looks decode unchanged: new options were appended to their lists and new
  fields after the old code (tested in `shared/test/appearance.test.ts`).
- AJ'S purchases are untouched: premium options keep their ids, ownership is still checked
  on the server, and the starter looks contain nothing premium (tested).
- Multiplayer: the look travels as the same wire code, so every client builds the same
  character for each player.
- Without `ink.glb` (failed download), the game falls back to the CC0 models automatically.

## Budgets and performance

About 20–27k triangles per assembled character (head ~3.4k, hands ~1.9k, each garment
2–4k, procedural hair varies), in one draw call plus the outline. Characters far away skip
the outline. The GLB is about 3.4 MB (served precompressed).

## Known limits

- The anatomy and clothing are procedural sculpts, not hand-modelled art. They are real 3D
  meshes with real folds and details, but a 3D artist working in Blender would get further
  (finer folds, textured fabric, hand-painted detail). The GLB is standard glTF: an artist can
  open it, refine any piece, and export it back under the same material names.
- Hair, hats, beards and jewelry are still the procedural builders, now smooth-shaded to
  match; they don't yet have the same sculpted detail as the bodies.
- One shared skeleton for every body type: feminine figures are shaped on it (waist, hips,
  bust) rather than having their own proportions.
- The clips are the CC0 rig's own. There are no dedicated emote, knockdown or equip clips
  yet (wave, death and weapon swaps are reused).
