# Whoopa Towne

A browser-based online multiplayer third-person shooter. Two crews, **S-Curve** (blue) and
**Cross Track** (red), fight over one mid-size city map in broad daylight (a night look is one
switch away): a winding S-shaped road on the west side, a rail yard and crossing on the east,
and a corner-store strip in the middle.

- 2–8 players (4v4), empty slots can be filled with bots
- **Team Deathmatch** (first to 50 kills, or most kills after 10 minutes) and
  **Gang Turf War** (hold zones A, B and C; first to 200)
- Keyboard + mouse, PS5 / Xbox controllers, and phone touch controls
- Authoritative server with client-side prediction, interpolation and lag-compensated hits
- No accounts: pick a display name, Quick Play, or share a 6-character invite code
- **Character Creator**: body type, build, height, skin tone, face, 18 hairstyles, facial
  hair, mouth, grills and piercings, tops, bottoms, shoes and colors, hats, glasses and
  jewelry. Everyone in a match sees your character; a crew-colored arm band keeps teams
  readable.

Built with Three.js + TypeScript + Vite (client), Node.js + Colyseus (server) and Rapier
(physics, shared by both). Art is original or CC0; all sound is synthesized in code.

---

## Run it locally

You need **Node.js 20.11 or newer** (developed and tested on Node 24) and npm.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. That one command starts the game server (port 2567) and the
client dev server (port 5173), both with live reload.

- **Play alone:** *Practice vs Bots* runs entirely in the browser and needs no server.
- **Two players on one computer:** open the game in two separate browser *windows* side by
  side (a background tab stops rendering). Create a private lobby in one and join with the
  code in the other.
- **Other devices on your network (phones, a second PC):** open
  `http://<your-computer's-LAN-IP>:5173`. Controllers need `localhost` or HTTPS in some
  browsers, so test those on the computer running the game or on a deployed copy.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + client with live reload |
| `npm run build` | Production build of both (client into `client/dist`, server into `server/dist`) |
| `npm start` | Runs the built server, which also serves the built client: http://localhost:2567 |
| `npm test` | Simulation, client-logic and real-network tests (50 tests, about 45 seconds) |
| `npm run test:browser` | Drives the real game in headless Chrome: 12 scenarios (needs Google Chrome and a running game) |
| `npm run typecheck` | TypeScript check of all three packages |

## How to play

**Main menu:** type a display name, pick a mode, then

- **Quick Play** drops you into an open public lobby for that mode (or starts one).
- **Create Private Lobby** gives you a 6-character invite code (and a copyable invite link).
- **Join with Code** enters a friend's lobby.
- **Loadout** picks a primary (Stinger SMG, Kingpin AR, Block Sweeper shotgun), the Deuce
  Pistol sidearm and one throwable (frag grenade or smoke). It is remembered on your device.

**Lobby:** shows both crews, lets you switch crew and ready up. The host starts the match once
everyone is ready, and can turn on *Fill with bots* (easy / normal / hard) so two friends can
still play a 4v4. If the host leaves, the next player becomes host. In a private lobby the
host can also change the mode and end a running match from the pause menu.

**In a match:** health regenerates after 5 seconds out of combat, you respawn after 5 seconds
at your crew's base with 2 seconds of spawn protection. Guns are hitscan with recoil, spread,
headshot multipliers and damage falloff. In Turf War, standing in a zone alone captures it
(more teammates capture faster); held zones pay a point every 3 seconds.

### Controls

| Action | Keyboard + mouse | PS5 DualSense | Xbox | Touch |
| --- | --- | --- | --- | --- |
| Move | W A S D | Left stick | Left stick | Left thumb (stick appears where you touch) |
| Look | Mouse | Right stick | Right stick | Drag on the right side |
| Fire | Left click | R2 | RT | FIRE (drag on it to keep aiming) |
| Aim (zooms in) | Right click | L2 | LT | AIM |
| Reload | R | □ | X | RELOAD |
| Jump | Space | ✕ | A | JUMP |
| Crouch | C | ○ | B | CROUCH |
| Sprint | Shift | L3 (click) | LS (click) | Push the stick all the way forward |
| Switch weapon | 1 / 2 / 3 | △ | Y | SWAP |
| Throw grenade / smoke | G | L1 | LB | THROW |
| Swap camera shoulder | Q | R1 | RB | ⇄ |
| Use (doors, windows, bags; hold to lock a door from inside) | E | D-pad down | D-pad down | USE / tap the prompt |
| Climb through an open window | Space toward it | ✕ | A | JUMP |
| Scoreboard (hold) | Tab | Create | View | SCORES |
| Pause / menu | Esc | Options | Menu | II |

Controllers are detected automatically and the on-screen prompts switch to match the device
you last touched. Menus work with the d-pad / left stick.

### Settings

Mouse, stick and touch sensitivity (plus a separate aiming multiplier), invert Y, field of
view, graphics quality (low / medium / high), performance mode for low-end phones, dynamic
resolution, master and ambience volume, aim assist on/off, stick deadzones, touch auto-fire,
crouch toggle, default camera shoulder, vibration, and an FPS / ping readout.

---

## Changing things

Everything meant to be tuned lives in three small files under `shared/src/config/`. They are
used by the client **and** the server, so after editing, rebuild and redeploy both.

| File | What is in it |
| --- | --- |
| `shared/src/config/crews.ts` | **Crew names, tags, mottos, colors and logos.** The HUD, lobby, minimap, base banners, base graffiti, player outfits and zone colors all read from here. Logos are inline SVG and can use `{color}`, `{dark}`, `{light}` to pick up the crew palette. |
| `shared/src/config/game.ts` | Score and time limits, team size, movement speeds, health regen, respawn and spawn-protection times, turf capture rules, grenade and smoke values. |
| `shared/src/config/weapons.ts` | Every weapon's damage, fire rate, magazine, reload time, spread, recoil, headshot multiplier and falloff. |

The lighting has its own file, `client/src/game/lighting.ts` (client only, no server restart
needed). It holds two presets, `DAY` (used now) and `NIGHT`; set `TIME_OF_DAY` to switch.
Each preset sets the sky colors, the sun or moon, how bright the shadows are (`ambient`),
street lamp, shop and warehouse lights (intensity 0 switches a kind off), how many lamps cast
real light at each quality level, light cones and pools, lit windows and stars.

**Character Creator options** live in `shared/src/config/appearance.ts`: every option's id,
name and swatch color, which ones are still "coming soon" (shown locked on the menu and
refused by the server), the defaults, and how bots pick their looks. Looks are saved in the
browser as JSON and sent to the server as a short code (about 40 characters). The drawing side
is in `client/src/game/characters/look/` (model pieces, procedural hair, hats, jewelry and
face). To add an option: append it to its list in `appearance.ts` (never reorder: codes store
list positions), then teach the matching builder in `look/` to draw it. `?debug=assets&vary=hair`
(or any other field) lines up one character per option to check them.

The map is `shared/src/map/whoopaTowne.ts` (collision and layout; shop names such as
"S-Curve Liquor" are place names and live here) and `client/src/game/world/worldBuilder.ts`
(how it looks). `npx tsx tools/map-preview.ts map.svg` draws a top-down plan of the map.
JUMP OFF THE PORCH plays on Greater Whoopa Towne (`shared/src/map/greaterTowne.ts`): nine
districts around the classic map, with explorable multi-floor buildings, working doors and
windows. See [docs/BUILDINGS.md](docs/BUILDINGS.md).

To replace a 3D model, drop a new `.glb` over the old one in `client/public/assets/`. If a
model is missing the game draws a simple built-in stand-in instead of failing.

## Project layout

```
shared/   Game rules and simulation, written once and run on both sides:
          movement, weapons, hit detection, bots, the map, the network message format.
server/   Colyseus server: lobbies, invite codes, quick play, and the authoritative match loop.
client/   Three.js game: rendering, camera, input (mouse, gamepad, touch), HUD, menus, sound.
tools/    Headless-Chrome test driver and scenarios, map preview, build helper.
```

How the netcode works, briefly: the server simulates at 60 Hz and is the only authority on
positions, damage and score. Your own character is predicted on your device using the exact
same code, so controls feel instant, and is corrected if the server ever disagrees. Other
players are drawn about 100 ms in the past and smoothly interpolated. When you shoot, the
server rewinds everyone to where *you* saw them before checking the hit. A full 8-player match
uses roughly 9 KB/s of download per player.

## Tests

```bash
npm test                 # 67 simulation + 8 client-logic + 23 economy/network tests
npm run typecheck
```

The network tests start a real server and connect real clients (invite codes, quick play,
2-player sync, prediction under 120 ms of lag, lag-compensated shooting, 8 players, leaving,
match end).

The browser suite plays the actual game in headless Chrome: menus, keyboard and mouse, combat
(also with simulated lag), Turf War, a simulated DualSense and Xbox pad, touch controls on an
emulated phone, sound, two browsers playing each other online, and frame-rate checks.

```bash
npm run dev                                              # terminal 1
npm run test:browser                                     # terminal 2

npm run build && npm start                               # or against the production build
npm run test:browser -- --base=http://localhost:2567
```

It expects Google Chrome at the default macOS path; set `CHROME_PATH` otherwise. Screenshots
land in `tools/out/`.

---

## Buildings and the big map

Houses, apartments, shops, offices and warehouses you can walk into: rooms on every floor,
stairs, roofs, fire escapes, doors that open, close and lock, windows that open, break and can
be climbed through, all synced by the server. The JUMP OFF THE PORCH map is a 3×3 grid of
districts (Babylon, The Hill, Hong Kong, Jungle, Whoopa Towne, Downtown, the Docks, the beach,
the Boardwalk), and the match now warms up in Babylon. How it works, how to add buildings:
[docs/BUILDINGS.md](docs/BUILDINGS.md).

## Characters (Urban Ink)

The characters are WHOOPA TOWNE's own: sculpted streetwear bodies and clothing generated by
`tools/characters` into `client/public/assets/characters/ink.glb`, skinned to the CC0 rig and
its animations, cel-shaded with an ink outline. How they're made, how to rebuild them and how
to add clothing: [docs/CHARACTERS.md](docs/CHARACTERS.md).

## GRAMS, AJ'S and TRAP

Premium cosmetics: GRAMS (the currency), AJ'S (the store, also a walk-in building on Porch St
with AJ at the register) and TRAP (your items). All cosmetic, nothing changes gameplay. To try
it locally with fake payments:

```bash
ECONOMY_TEST_PAYMENTS=1 npm run dev
```

Setup, Stripe, the security model, testing and deployment: [docs/ECONOMY.md](docs/ECONOMY.md).

## Deploying

The game itself needs no paid service and no database. You need somewhere to run **one Node.js
process that accepts WebSocket connections**. Accounts and GRAMS are kept in a data file on that
server (put it on persistent storage), and taking real money needs a Stripe account: see
[docs/ECONOMY.md](docs/ECONOMY.md). Hosting prices
and free tiers change, so check your provider before choosing; none is assumed here.

### Option A: one service (simplest)

The server also serves the built client, so a single Node process is the whole game.

```bash
npm install
npm run build
npm start            # listens on $PORT, or 2567
```

On a Node hosting platform, set:

| Setting | Value |
| --- | --- |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Port | the server reads the `PORT` environment variable |
| Health check path | `/healthz` |

Then open the service's URL. Invite links look like `https://your-game.example.com/?join=ABC123`.

**With Docker:** a `Dockerfile` is included.

```bash
docker build -t whoopa-towne .
docker run -p 2567:2567 whoopa-towne
```

**On your own server (VPS):** run `npm start` under a process manager (systemd, pm2) and put
a reverse proxy with HTTPS in front of it (Caddy, nginx). The proxy must pass WebSocket
upgrades through; with nginx that means `proxy_http_version 1.1` plus the `Upgrade` and
`Connection` headers on the proxied location.

### Option B: client and server on different hosts

Put the client on any static host and the server on a Node host.

**Server:**

```bash
npm install
npm run build -w server
npm start                      # no client/dist present: it only runs the game server
```

**Client:** build it with the server's public address baked in, then upload `client/dist`.

```bash
VITE_SERVER_URL=https://game-server.example.com npm run build -w client
```

If the site lives under a sub-path (for example `https://example.com/whoopa/`), add the base
path: `npm run build -w client -- --base=/whoopa/`.

Two rules for split hosting:

- If the client is served over **https**, the server must be too (browsers block insecure
  WebSockets from secure pages). Use an `https://` URL in `VITE_SERVER_URL`.
- The server accepts connections from any origin, so no CORS setup is needed.

### Configuration reference

| Variable | Where | Meaning |
| --- | --- | --- |
| `PORT` | server | Port to listen on (default 2567) |
| `CLIENT_DIST` | server | Folder of the built client to serve (default `client/dist`) |
| `SIMULATE_LATENCY` | server | Adds this many ms of delay to every message, for testing only |
| `VITE_SERVER_URL` | client build | Address of the game server when it is not the same origin |

Adding `?server=https://other-server.example.com` to the game's URL overrides the server
address for that visit, which is handy for testing.

### Capacity

Matches live in memory in one process; there is nothing to back up. A full room with 8 bots
(the worst case, since the server also runs the bot AI) uses about half a percent of one
modern CPU core, so a single small instance comfortably hosts many simultaneous matches.
Restarting the server ends the matches in progress. Players should be reasonably close to
the server: the game is tuned for pings up to about 150 ms.

---

## Performance

Targets are 60 fps on desktop and 30 fps on phones.

- The whole town is merged into about 90 draw calls on desktop and about 60 in performance
  mode (each character is a single skinned mesh, all signs share one texture, all parked
  cars and props are baked into a few meshes that are skipped when out of view).
- By day the sun does the lighting and street lamps are off; only a few shop interiors get a
  real light. At night only the lamps nearest to where you are looking cast real light (10 on
  high quality, down to 3 in performance mode). The rest keep their glowing heads, cones and
  ground pools, and lights hand over between lamps smoothly as you move.
- Character looks are built once per look (about 40 ms, at match start) and cached; colors are
  painted per player, so recoloring is free.
- **Performance mode** (on by default the first time the game runs on a phone) renders at
  roughly one pixel per CSS pixel, turns off shadows and anti-aliasing, shortens the view
  distance and thins out particles.
- **Dynamic resolution** lowers the render resolution a step at a time if the frame rate
  falls under the target and raises it again when there is headroom. It backs off by itself
  when resolution is not the bottleneck.
- The whole game is about 2.3 MB to download with Brotli compression (the server sends pre-compressed files; static hosts compress on their own).

Measured in headless Chrome on an Apple M3: 60 fps everywhere on the map at high quality with
shadows, about 3 ms of script time per frame; in performance mode on a phone-sized screen with
the CPU throttled 4x, still 60 fps at about 2.5 ms per frame. Real phones and controllers
have not been tested yet (see below).

## Known limits

- Tested in desktop Chrome, in headless Chrome with an emulated phone, and with simulated
  controllers through the browser's Gamepad API. It has **not** been run on physical phones,
  physical PS5 / Xbox pads, Safari or Firefox, so expect some tuning there.
- iPhone Safari does not allow web pages to go fullscreen; the game plays inside the browser
  window. Adding it to the home screen gives the most room.
- Sound starts after the first click, key press, tap or controller input (a browser rule).
- One map, no accounts, no progression, no saved stats, by design.
- The server trusts nothing a player's browser tells it about position or damage, but there
  is no additional anti-cheat (for example against aim bots).

## Assets and credits

All 3D models are **CC0 (public domain)**: characters, weapons, cars and street props by
[Quaternius](https://quaternius.com), van, truck and traffic cone from
[Kenney's Car Kit](https://kenney.nl/assets/car-kit). The full list with sources is in
`client/public/assets/CREDITS.md`. The map, textures, crew logos, HUD and every sound effect
are generated in code and original to this project. No copyrighted assets are used.
