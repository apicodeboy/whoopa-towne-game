# Explorable buildings and the Greater Whoopa Towne map

Buildings you can walk into, climb, and fight through: real rooms on every floor, stairs,
balconies, roofs, fire escapes, doors that open, close and lock, and windows that open,
break, and can be climbed through. Everything is server-authoritative and synced to every
player.

## What's where

| Part | Files |
| --- | --- |
| Building layouts (all types, all floors) | `shared/src/map/architect.ts` |
| Where buildings stand on the map, the districts | `shared/src/map/greaterTowne.ts` |
| Door and window state, the rules for using them | `shared/src/sim/buildings.ts` |
| Climbing through windows (the vault) | `shared/src/sim/player.ts` (`tryVault`), `VAULT` in `shared/src/config/game.ts` |
| Collision for doors and glass | `shared/src/sim/physics.ts` (`addToggleBox`, `GROUP_GLASS`) |
| Network events | `EV.DOOR`, `EV.WINDOW`, `EV.DENIED` in `shared/src/protocol.ts`; `MatchStartMsg.bld` |
| Furniture, floors, ceilings, roofs, frames | `client/src/game/world/worldBuilder.ts` |
| Moving doors and window glass | `client/src/game/world/buildingVisual.ts` |
| Prompts, sounds, glass shards | `client/src/game/game.ts` (`updateUsePrompt`, `handleEvent`), `audio.ts`, `fx/effects.ts` |
| Indoor camera | `client/src/game/camera.ts` (`INDOOR_DIST`) |
| Tests | `shared/test/buildings.test.ts`, the door test in `server/test/net.test.ts` |
| Floor plans (for checking layouts by eye) | `npx tsx tools/plan.ts [type ...]` |

## The map: nine districts in a 3×3 grid

```
   x: -200            -86                 86              200
      +---------------+------------------+----------------+  z = -150
      |   BABYLON     |    THE HILL      |   HONG KONG    |
      +---------------+---- Porch St ----+----------------+  z = -56
      |   JUNGLE      |   WHOOPA TOWNE   |   DOWNTOWN     |
      +---------------+-- Ocean Drive ---+----------------+  z = 61..71
      |  THE DOCKS    |    LAKE LINDA    | THE BOARDWALK  |
      +---------------+------------------+----------------+  z = 118, the lake
```

- **Whoopa Towne** (the classic map) sits in the middle, unchanged.
- **The Hill** is the projects: Section 8 brick walk-ups (three and four floors, a unit on
  every floor, stairs to the roof, fire escapes), some windows already broken, tags on the
  walls, dirt yards with overflowing dumpsters, trash bags, litter in every gutter, burnt-out
  cars, dumped mattresses and couches, shopping carts, standing water. The old projects keep
  their outside stairs to the roof; Suds Laundry, the Food Mart, the school, the church, Porch
  Park and AJ'S are where they were.
- **Babylon** (northwest): the walled desert city, the ziggurat, the hanging gardens, the
  bazaar, the oasis. JUMP OFF THE PORCH warms up here.
- **Hong Kong** (northeast, new): the paifang gate off East Line Rd, Lantern Street with
  tenements (shops below, balconies above, neon signs), the Dim Sum Palace, an herbal shop, a
  barber, the pagoda temple in its courtyard, the night market and the koi garden.
- **Jungle** (west): the temple, the crash site, the huts, the ranger station.
- **Downtown** (east): the bank, the parking garage, Whoopa Tower, the plaza, the hotels, and a
  block with explorable offices (five floors), a sneaker store and a restaurant.
- **The Docks** (southwest, new): warehouses, a workshop, self storage and an auto body garage,
  containers on the quay and a gantry crane.
- **The Boardwalk** (southeast): the Shrimp Shack, Beach Rentals and a beach duplex.

Border roads: West Line Rd (x = -86), East Line Rd (x = 86), Porch St (z = -56, now the full
width) and Ocean Drive (z = 66). Each outer district has its own random seed; the draws before
The Hill are unchanged, so The Hill generates exactly as before.

`npx tsx tools/map-preview.ts out.svg --greater` draws the whole map from above.

## Billboards and live scores

Billboards stand around town (`billboards()` in `greaterTowne.ts`): ads for the local spots,
and screens showing live scores that turn a page every 6 seconds (a league a page, live games
first, then finals, then start times). The game server reads ESPN's public scoreboards for the
NBA, NFL, MLB, NHL, WNBA and college football and basketball (`server/src/scores.ts`), at most
once a minute, and serves them at `/api/scores`; the game asks only its own server, so nothing
about a player goes anywhere else. If the feed can't be reached, the screens keep the last
scores, then say "SCOREBOARD OFF AIR". `SCORES=off` turns it off; `SCORES_FEED_URL` points it
elsewhere.

## Building types

| Type | What it is |
| --- | --- |
| `house1` | One floor: living room, kitchen, a bedroom and a bathroom off the hall, front and back doors. |
| `house2` | **The reference building.** Two floors: the front door opens onto the stairs, living room through the arch, kitchen behind it, back door; upstairs a front bedroom, a bathroom that locks, a back bedroom with a walk-in closet. |
| `townhouse` | `house2` with a flat roof and parapet. |
| `duplex` | Two `house2` homes side by side. |
| `apartment` | 2–6 floors. A stairwell up every floor to a roof bulkhead with a door; one unit per floor (lockable front door, living room and kitchen, bedroom, bathroom); a fire escape on the side. |
| `tenement` | Hong Kong apartments: a shop on the ground floor, balconies with glass doors above. |
| `store`, `barbershop`, `laundromat`, `restaurant` | A glass storefront and door, the shop floor fitted out for its trade, a back room through a staff door, a locked back door; on two floors, stairs in the back room up to an office. |
| `office` | 2–6 floors of open-plan desks and a meeting room behind a glass door, a lobby with a front desk, stairs to the roof. |
| `warehouse` | One tall floor, an open roll-up bay, a mezzanine office with steel stairs. |
| `workshop`, `storage`, `garage` | Smaller industrial units: workbenches; aisles of racks; a car in the bay. |

Every layout is generated in the building's own frame (`u` along the front wall, `v` from the
front to the back), so any type can face any way and fit any reasonable lot. All of it is plain
map data (boxes, doors, windows, loot spots), built the same on the server and on every client.

### Adding or changing a building

1. Write or change a layout function in `architect.ts`: `opening` / `windows` for the outside
   walls, `partition` for inside walls (with doors), `stairsV` / `stairsU` for stairs (the floor
   above gets a stairwell with railings), `furn` for furniture, `room` for floors and lights,
   `loot` for loot spots, then `finish()` for the outside walls, floors and roof.
2. Look at it: `npx tsx tools/plan.ts mytype` then
   `node tools/shot.mjs tools/out/plan.html tools/out/plan.png 1800 1400`.
3. Add it to `TYPES` in `shared/test/buildings.test.ts`. The tests check that every room on
   every floor can be walked to and that no furniture is in a wall or a doorway.
4. Place it on the map with `construct(b, { id, type, x0, x1, z0, z1, facing, ... })`.

## Doors

- **USE** (E / ▼ / the prompt on touch) opens and closes the door you're facing. It swings away
  from you.
- **Locking:** from inside, hold USE on a closed door for 0.6 s to lock or unlock it. A tap from
  inside on a locked door unlocks it and opens it. From outside, a locked door only rattles.
  Shop back doors start locked.
- A door won't close on someone standing in the doorway.
- A closed door is solid to people, bullets and grenades; an open door doesn't block.
- Bots open unlocked doors in their way.

## Windows

- **USE** slides a sash window up or swings a casement out (and back).
- **Breakable glass:** a bullet that passes through intact glass breaks it and carries on; a
  grenade breaks glass within 5.5 m. Glass shards fly and fall, with the sound.
- Intact glass stops people, grenades and the camera; open or broken windows don't.
- **Climbing through:** jump while moving toward an open or broken window to climb through it.
  It works from the street, between rooms and balconies, onto fire escapes, and out of
  upper-floor windows (you drop from the sill).
- Shop and office display glass doesn't open. Shop windows break; office curtain-wall glass
  is bulletproof (solid).

## Multiplayer

The server owns doors and windows (`BuildingRules` in `GameSim`). Every change goes out as an
event with the next snapshot (`EV.DOOR`, `EV.WINDOW`, `EV.DENIED`), and the full state comes
with `MatchStartMsg.bld` for anyone joining or rejoining. Each client keeps its own
`Buildings` copy on the same collision world it predicts with, so walking into a door that
someone just opened is predicted correctly. Clients never decide anything: a client only sends
the USE button.

## Indoors

- The camera boom comes in under a ceiling, so rooms and halls stay readable. Glass blocks the
  camera, so it never ends up outside a window.
- Walls are plastered inside, floors are wood, tile, carpet or concrete by room, ceilings are
  lit evenly, and each room has a ceiling light.
- Furniture is real collision (beds, couches, counters and shelves are cover); rugs, lamps,
  plants, chairs and mirrors are not.

## Performance

- Interiors (furniture, floors, inside walls, lights) are batched per 48 m chunk and only
  drawn within 70 m of the camera. Outside walls and roofs are always drawn.
- Doors and window glass are three instanced meshes for the whole map (three draw calls). Only
  doors and windows that are moving are updated each frame.
- Doors and glass are collision boxes switched on and off; the collision world refreshes only
  when something changed.
- Numbers on the current map: about 6,000 solids, 230+ doors and 300+ windows; the collision
  world builds in ~65 ms, and a JUMP OFF THE PORCH bot match runs at about 0.12–0.18 ms per
  server tick.

## Ibuprofen (armor)

Orange pill bottles, in bookbags and lying around the map (about 40 at the start). Picking a
bottle up puts it in your pockets (you carry up to four); nothing happens until you take one:
pick it on the weapon wheel, or hold HEAL when your health is full. Taking one takes two
seconds and gives 25 armor on top of your 100 health, up to 100 armor (four bottles' worth).
With full armor a bottle does nothing, so it is not used up. Armor shows as four blue segments
over the health bar and soaks gunfire before health does (not the riot). Knocked out, the
bottles you carry drop where you fell. The old armor vests are out of the loot pool.

## The districts are fenced off

A low black railing (0.95 m) runs down the middle of every border road (West Line Rd, East
Line Rd, Porch St, Ocean Drive) and across the sand between the docks, the lake and the
boardwalk (`districtFences()` in `greaterTowne.ts`). You can't walk through it, but a jump
clears it (a jump goes about 1.25 m up), and bullets and grenades go through it. Wherever
something already stood on the line (a palm tree, the end of a wall) the railing stops around
it. Bots jump it when it is in their way.

## Bots landing

Bots don't touch down armed: they aim to land five to ten metres from a bookbag (never on it),
take a second or two to look around after landing, and going through a bag takes them a
moment, so their first gun comes a few seconds after they land (tested: never under 1.5 s).

## Area names over the map

From the blimp and in the air, each district's name floats over it in its own lettering style
(`client/src/game/porch/airLabels.ts`, styles in `client/src/styles/theme.css`): all in Paytone
One, a free chunky display face, in cream and pink with a dark outline. BABYLON is in a
starburst, THE HILL is extruded, HONG KONG is striped and slanted, JUNGLE is hatched, WHOOPA
TOWNE sits between rows of dots, DOWNTOWN is outlined, THE DOCKS is stacked, LAKE LINDA is in a
speech bubble, and the BOARDWALK sparkles.

## JUMP OFF THE PORCH warm-up

The pregame is now a minute (`PORCH.pregame` in `shared/src/config/porch.ts`) on foot in
Babylon (`map.warmup`), with the blimp circling the town overhead (it comes round to the
start of its route just as everyone boards). Everyone spawns armed with their loadout and can shoot around; nothing
counts (no kills, deaths, or eliminations) and you're back in 3 seconds. Bots don't all appear
at once: each one turns up at a random moment of the pregame (`PORCH.warmup.joinFrom` /
`joinTo`), entering the roster, the "players" count and the world then, with a
"NAME JOINED" note. When the clock runs out, anyone still on the way turns up and everybody
boards the blimp as before.

## Known limits

- Only doors and windows move. Walls, furniture and floors don't break (on purpose: it keeps
  the server cheap and the collision exact).
- Bots walk the ground floor: they don't use stairs, ladders or windows yet.
- Interior lighting is the same light for every room; there are no light switches.
- The Babylon mud houses, the jungle huts, the ranger station, the beach shops and the classic
  town keep their original single-room shells.
