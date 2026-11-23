# The characters

WHOOPA TOWNE's character: a human face (eyes, brows, nose, lips, ears), big spiky freeform locs, a black
hooded puffer (or a puffer vest over a long sleeve, or a plain white tee), very wide pants that
stack in rolls on the shoe, a red studded belt with the boxers' waistband showing above it, a
blue graphic on the left thigh, a chain with a round pendant, black gloves with a watch on each
wrist, and clean white low-tops. Drawn like a clean vector illustration: flat colors in two
tones, a bold black outline, inked creases.

This document covers how the characters are made, how they get into the game, how guns are
held, and how to add new clothing. (The code and the asset still carry the working name
"ink".)

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
| Flat cel shading and ink outline | `assemble.ts` (`LOOK_MATERIAL`), `skinnedCharacter.ts` (`outlineMaterial`) |
| Hair (spiky locs, wicks, ...), hats, masks | `client/src/game/characters/look/hair.ts`, `headwear.ts` |
| Beards, grills, piercings, face tattoos, glasses, earrings | `client/src/game/characters/look/face.ts` |
| Chains and the pendant, watches, gloves, bags, pants chain | `client/src/game/characters/look/jewelry.ts` |
| The graphic on the pant leg (the print atlas) | `client/src/game/characters/look/legPrint.ts` |
| How guns are held | `client/src/game/characters/skinnedCharacter.ts` (`GUN_FIT`, `turnHand`, `closeHand`) |
| Look options, presets, wire code, saved-look upgrade | `shared/src/config/appearance.ts` |
| Character and pose viewer (dev) | `?debug=assets&view=characters` (`client/src/debug/assetViewer.ts`) |
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
   hamstrings, calves and knees. The head has a human face: brow ridge, cheekbones, jaw and
   chin, eye sockets with lids wrapped round real eyeballs (white, iris, pupil), a nose with
   nostrils, lips (their own color, from a soft mask) and ears. Over the face the shading
   normals lean toward a smooth rounded head, so the cel shading's hard light/shadow edge runs
   cleanly across it instead of breaking up on every bump (the shape stays as sculpted).
   Eyebrows are a thin layer on the brow ridge. Clothing is a real cloth shell a few millimetres thick,
   shaped around that body, with hems, cuffs, folds and designed details: big clean puffer
   baffles, a hood, a zip, pants that pile up in rolls above the hem, a belt with two rows of
   pyramid studs and a buckle.
3. **Mesh.** Surface nets turn each shape into triangles. Quadric edge-collapse decimation
   brings them down to a budget (open hems are locked so they stay clean). Vertices are
   snapped onto the true surface and normals come from the shape, so shading is smooth.
4. **Skin.** Every vertex belongs to a body region (a thigh never follows the other leg),
   blends between that region's bones by distance, and the weights are smoothed over the
   mesh so elbows and knees bend without creasing.
5. **Bake.** Ambient occlusion (creases, folds, armpits) and seams are baked into the vertex
   colors (R). The runtime keeps this apart from the color and draws it as flat shadow shapes
   and ink lines.
6. **Write.** One GLB holds the skeleton, the clips, and every piece as a named material
   (`Top_Hoodie`, `Bottom_BaggyJeans`, `Shoe_Lowtop_Sole`, `Skin_Hand`, ...).

At runtime the look builder picks the pieces for a player's outfit, adds the procedural hair,
hats, masks and jewelry fitted to the head and body, shapes body type, build, shoulders and
head size, and merges it all into **one skinned mesh** (one draw call, plus the outline). The
result is cached per look, and each player's colors are painted per vertex, so nothing is
rebuilt during play. The generator still makes eye and brow pieces, but they are never drawn:
they only mark the eye line, so hair, hats and glasses can be fitted to the head.

### The look

- **Flat cel shading.** Every surface is its own flat color in two tones, lit side and shadow
  side, with a crisp edge between them. Lights count mostly as brightness (their color only
  tints), so black stays black and white stays white, day, night and indoors. The darkest
  colors are lifted a touch, so black cloth is charcoal and never the outline's black.
- **Inked creases.** The baked folds and seams are drawn as hard shadow shapes and ink lines:
  the stitch lines between puffer baffles, the creases between the rolls of stacked pants, the
  panel lines on sneakers.
- **Edge light.** Edges turned away from the camera catch a cool light: it is what gives black
  clothes their shape. Glossy things (nylon, leather, metal) get hard-edged highlights.
- **Ink outline.** An inverted shell pushed out along smoothed normals: bold on the body, the
  head and the hair, thinner on hands, laces and jewelry. It is dropped for players more than
  28 m away (and on low quality / performance mode).
- **The pants graphic.** All designs are drawn once into one small shared texture
  (`printAtlas()`); a character wearing one gets a patch of its own pant leg (same shape,
  shading and skin weights) whose vertices point into it, and the character shader lays the
  print over the cloth color. No extra draw call or material.

### Holding guns

Each gun has its own measurements in `GUN_FIT` (`skinnedCharacter.ts`): where the pistol grip
is along its length and below its top, how far the grip leans, where the barrel is, where the
support hand cups the handguard or pump, and where the magazine is. The gun is placed so the
middle of its grip is exactly where the right hand closes. The hands are then turned to wrap
it: the rig's hands are measured once in the bind pose (along the palm, across the knuckles,
out of the palm), so `turnHand` can point a hand any way (knuckles forward and index up by the
trigger for the firing hand; palm up under the handguard for the support hand) and `closeHand`
curls every finger joint around its own axis toward the palm. The left hand goes as far out
along the handguard as the arm reaches, and down to the magazine to reload.

To check a hold: `?debug=assets&view=characters&pose=idle|aim|smg|shotgun|pistol|reload|sprint|crouch&yaw=...`
(add `&ikdots` for markers on the wrists and the gun's grip).

## Rebuilding the asset

```bash
npx tsx tools/characters/build.ts                     # everything, full quality (~10 min)
npx tsx tools/characters/build.ts --only='Shoe'       # just matching pieces, the rest from cache
npx tsx tools/characters/build.ts --quick             # coarser skin voxels, for fast iteration
```

Piece groups are cached in `tools/out/inkcache/` (git-ignored). `--only` takes a regular
expression over group names (`body`, `hands`, `head`, `face`, `eyes`, `brows`, and each
garment's material name). After changing the skeleton or the body, rebuild everything
(`--only=.`).

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
| Starter looks | Hooded Puffer, Puffer Vest, White Tee (the three reference fits; editable) |
| Body | body type, build, height, shoulder width, skin tone, head size |
| Head & face | head shape, face shape, eyes, eye color, eyebrows, nose, mouth, teeth, ears, facial hair and its color, freckles / scar / beauty mark, a face tattoo (star, cross, teardrops, lightning bolt), expression preview |
| Hair | spiky locs, wicks, locs, dreads, twists, braids, cornrows, afros, fades, waves and more; colors |
| Clothing | hooded puffer, puffer vest over a long sleeve, boxy tee, tank, crop, hoodie, zip-up hoodie; baggy stacked pants, regular and slim jeans, cargo, leggings, shorts; a studded belt (red, black, white); a pants graphic (Go Crazy + scorpion, flames, stars); low-tops, running shoes, chunky sneakers, boots; hats |
| Accessories | chains (round pendant, gold, silver, stacked silver, medallion, diamond), earrings, watches, black gloves with a watch on each wrist, glasses, face masks, pants chain, something in the mouth, phone in hand (menus), bags (AJ'S) |

The character has no face, so there are no eyes, brows, nose, lips, teeth, facial hair,
expressions or freckles to pick any more. Those fields still exist in saved looks and wire
codes (so nothing old breaks) but nothing draws them.

## Compatibility

- Saved looks decode as before: new options were appended to their lists and new fields
  (`face`, `faceMark`, `belt`, `legPrint`) after the old code (tested in
  `shared/test/appearance.test.ts`).
- A saved look that is still one of the old starter looks (the old default, or what the two old
  presets set) was never really customized: it moves to the new default look. A look somebody
  made their own is kept as it was and simply drawn in the new style. What was bought at AJ'S
  stays on either way (`upgradeOldLook`, tested).
- AJ'S purchases are untouched: premium options keep their ids, ownership is still checked
  on the server, and the starter looks contain nothing premium (tested).
- Multiplayer: the look travels as the same kind of wire code, so every client builds the same
  character for each player.
- Teams: the crew-colored arm band is gone (it is not part of this look). Teammates are told
  apart by their name tags, which always show; enemies have none until they are close.
- Without `ink.glb` (failed download), the game falls back to the CC0 models automatically.

## Budgets and performance

About 24–32k triangles and 26–34k vertices per assembled character (the head 3.4k, hands
~1.9k, each garment 2–4.6k, the studded belt ~3k, spiky locs ~5k), in one draw call plus the
outline. A look is assembled in about 0.2 s the first time and cached. Characters far away
skip the outline. The GLB is about 3.6 MB (served precompressed).

## Whoopa Tall (the default character)

Everyone plays as **Whoopa Tall** (`whoopa_tall_unmasked`) unless they pick the hooded version
(`whoopa_tall_hooded`) or **Classic Custom** (the custom character above) under **Character** in
the Character Creator. Bots stay custom characters. They are looks only: the collider, hitboxes,
camera, movement and weapons are the same for everyone.

- **Files.** `client/public/assets/characters/whoopa/*.glb`, exactly as delivered (SHA-256 checked
  against the pack's `VALIDATION.json`; the pack's README, reference sheet and preview are in
  `docs/characters/whoopa/`). About 12 MB each (10 MB compressed), downloaded after the game's own
  models. One skinned mesh each, with its own material and three 2048² maps (color, normal,
  metal/roughness). Phones, Low quality and performance mode get 1024² copies made in memory.
- **Code.** `client/src/game/characters/imported/`: `models.ts` loads and prepares a model once and
  shares it (each wearer is a `SkeletonUtils.clone` with its own `AnimationMixer`); `rig.ts` renames
  the Mixamo-style bones to the game's and finds the soles; `clips.ts` prepares the clips;
  `recolor.ts` does the customization; `pendingCharacter.ts` stands in while a model downloads (the
  custom character in a match, nothing in a menu). `SkinnedCharacter` drives them.
- **Clips.** Idle, Walk and Run are the files' own (renamed, and moved so the feet center on the
  player; they have no root motion). The files have no aiming, firing, strafing, backpedal, punch or
  death clips: those are the game's existing CC0 clips retargeted onto each skeleton at load. Jump,
  crouch, roll, climb, reloads, throws, healing and hanging are the game's procedural poses.
- **Feet.** The clips float or sink by up to 6.5 cm. Every frame the lowest point of the boots (about
  90 sole vertices, transformed exactly) is put on the ground; running keeps its flight.
- **Fit.** One uniform scale (1.75 m bind height to the game's 1.8 m). Their arms are short and their
  heads big, so long guns sit closer in with the torso turned side-on (`HOLD` in `models.ts`, fitted
  so the left palm ends within 3 cm of every handguard).
- **Crews.** In matches a band in the crew color is drawn on the upper arms (the sleeve's own
  triangles again, cut to a strip).

### Clothes

He starts in a **plain brown tee and brown jeans**, nothing else (his boots as made). The creator's
**Tops** and **Bottoms** tabs offer:

- **his own garments**: the Whoopa Zip Jacket and Whoopa Stacked Cargos sculpted into the model
  (options `wtjacket`, `wtcargos`; the custom character draws them as its zip hoodie and cargos);
- **every top and bottom of the clothing system**: tee, tank, crop top, hoodie, zip hoodie, puffer,
  puffer vest; slim / regular / baggy jeans, cargo pants, shorts, leggings. They are built by
  `look/assemble.ts` on the custom character's body, then carried onto his skeleton bone by bone
  (`imported/outfit.ts`): each segment stretched to his limb length and widened to his girth (the
  torso as one piece, so it is not squashed), with the arms, legs and neck under them. His own head
  (without the jacket's collar, found by the texture's color at each vertex), hands and boots stay;
  pant legs widen over his boot openings; tops sit 12 mm out so waistbands never show through.
  Mixing works both ways (his jacket over jeans, a tee over his cargos).

Every color, AJ'S print and finish applies to both kinds (on his own garments as a recolor of the
delivered maps, see below; on carried ones as paint). Bare arms and legs take his own skin color
unless a tone is picked. The hooded model keeps its own hoodie (the hood and mask are part of it):
only its bottoms change. Bought tops and bottoms (AJ'S fits) show on him; hats, jewelry, sneakers
and backpacks do not, and AJ'S previews those on Classic Custom with a note.

### Recoloring his own garments, skin and hair

The delivered maps are never replaced: a copy of the model's own material moves the color of three
kinds of texel (clothing, skin, hair, told apart by their own color) and keeps each texel's
brightness relative to its kind, so folds, seams and painted shading stay. Which garment a vertex
belongs to is found once from the mesh: boots below the pants' cuffs (and the toe caps), the jacket
above its hem (both found as bands of downward-facing surface), the pants inside the hem's ring, the
hood with the jacket, the hooded model's mask and the unmasked model's eyes and glasses left as made.

| Creator item | Field | Notes |
| --- | --- | --- |
| Skin Tone | `skin` | every tone, or Original |
| Braids Color | `hairColor` | unmasked only; black is as made |
| Head Size | `headSize` | the head bone, 0.94 / 1 / 1.07 |
| Top / Bottom / Boot Color | `topColor`, `bottomColor`, `shoeColor` | every color, prints and finishes; Original = his own garment as made |

### Limits

- The carried clothes are the clothing system's shapes (smooth, vertex colored), not sculpted like
  his head and boots; baggy jeans' stacked folds come out sharper on his shorter shins.
- No face shapes or expressions: the head is one sculpted piece without blend shapes. Those, and
  sculpted garments in his style, need parts on his skeleton (a base body, each garment as its own
  skinned mesh, face blend shapes) that the delivered pack does not include.

## Known limits

- The anatomy and clothing are procedural sculpts, not hand-modelled art. They are real 3D
  meshes with real folds and details, but a 3D artist working in Blender would get further
  (finer folds, textured fabric, hand-painted detail). The GLB is standard glTF: an artist can
  open it, refine any piece, and export it back under the same material names.
- Hair, hats and jewelry are procedural builders; they don't have the same sculpted detail
  as the bodies. Standing locs are left out under a hat (only what comes out below it shows).
- The pants graphic's lettering uses a script font from the player's device (with fallbacks),
  so its exact letter shapes differ a little between devices. The waistband has no lettering.
- Guns are the same CC0 models, a touch oversized. The arms are short for a full rifle stance,
  so from the hip the support hand sits nearer the magazine than the end of the handguard.
- One shared skeleton for every body type: feminine figures are shaped on it (waist, hips,
  bust) rather than having their own proportions.
- The clips are the CC0 rig's own. There are no dedicated emote, knockdown or equip clips
  yet (wave, death and weapon swaps are reused).
