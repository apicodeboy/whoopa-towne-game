# Whoopa Towne — Taller Character Pack

Two textured, rigged GLB characters based on the approved taller reference.

## Use with Claude Code

1. Extract this ZIP into your Whoopa Towne project folder.
2. Open `CLAUDE_IMPORT.md` and paste its instruction into Claude Code.
3. Point Claude to this extracted folder. It should import the supplied GLBs and connect them to the existing player controller.

## Files

| Model | Triangles | Skeleton joints | Size | Embedded clips |
| --- | ---: | ---: | ---: | --- |
| `whoopa_tall_unmasked.glb` | 30,889 | 70 | 11.85 MB | Idle, Walk, Run |
| `whoopa_tall_hooded.glb` | 30,755 | 72 | 11.60 MB | Idle, Walk, Run |

Both GLBs include the mesh, skin weights, skeleton, materials, textures, and all three clips. There are no external texture files to locate. Skeletons use Mixamo-style names; their joint counts differ, so use each character's own embedded clips.

`model_preview.jpg` shows actual renders of the delivered GLBs in the idle pose. `approved_character_reference.png` is the design reference, not a render of the generated meshes. `VALIDATION.json` records structural and sampled animation checks. `ORIGINAL_OUTPUTS.json` lists the provider's original output URLs, including alternative formats; these links may expire and are not needed for the bundled GLBs.

## Validation and remaining work

Both files imported and rendered in Blender 4.3.2. Each clip deformed its skinned mesh at sampled first/middle/last frames without invalid coordinates or extreme deformation. This is not a frame-by-frame animation quality review or a test inside your game.

Generated likeness, clothing, and unseen angles are approximations of the reference. The clothing and accessories are fused into one skinned mesh per character; this pack does not supply separate wardrobe parts or face/body customization sliders. No facial morph targets or jump, crouch, aiming, or weapon-action clips are supplied.

Claude must check ground height and foot placement: sampled soles vary by several centimeters during the animation cycles. It must also wire collisions, movement, selection, cameras, and any weapon attachment points. The files are about 12 MB each; lazy loading and further texture compression may help mobile performance. These assets have not been installed or deployed into the live game.
