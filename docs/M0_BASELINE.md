# M0: baseline and save contract

Roadmap milestone M0 ("Verify the foundation", Prompt 1). Audited 2026-11-22.

## Baseline

| | |
| --- | --- |
| Checkout | branch `feature/jotp-daynight-graphics` at `ed9beb1` (11 commits ahead of `main` at `2cb11fa`, the roadmap's snapshot). Nothing on the branch is pushed or deployed. |
| Node | v24.15.0 |
| Start | `npm install`, `npm run dev` (client :5173, server :2567); production `npm run build && npm start` |
| `npm run typecheck` | passes |
| `npm test` | shared 82 / client 9 / server 26, all pass |
| `npm run build` | passes (main client chunk ~1.12 MB, 370 kB gzipped) |
| Known failures | none in the suites. One browser-run flake: in the two-device route below, the second browser once timed out loading (30 s) while the first was busy; it passed on the next two runs. |
| Live site | whoopatowne.online is up (`/healthz`: ok, ~100 h uptime, 0 rooms). It reports no version. **Inferred, not verified:** its client bundle (`index-CSV5PZqA.js`) contains Hong Kong and lock-the-door (added in `7e9b7d1`) and none of the strings added from `312d96c` on (Perc 29, Lake Linda, the faceless character), so the live game is most likely `7e9b7d1`, three commits behind `main`. |
| Performance | Desktop (this Mac, Apple GPU, headless Chrome, 1280x720, High): 16.5-16.8 ms per frame in every scene measured, which is the 60 Hz vsync cap, so headroom under the cap is unmeasured. iPhone: not measured (no device here). 60 FPS desktop / 30 FPS phone remain targets to validate. |

## Where each piece of player data lives (traced in code, confirmed by running it)

| Data | Where it is saved | Who decides |
| --- | --- | --- |
| Account (username, scrypt password hash) | Server, `server/data/economy.json` (`AccountRec`) | Server |
| Sessions | Server (sha256 of the token, 30 days); the token in the browser's `localStorage` (`whoopa.session`) | Server |
| GRAMS balance, ledger, orders | Server; credited only from a verified payment | Server |
| Owned items | Server (`AccountRec.owned`, item ids from `shared/src/config/economy.ts`) | Server |
| Equipped look (incl. per-gun skins) | Server (`AccountRec.look`, an appearance wire code) **and** the browser profile | Server checks ownership on save (`/api/trap/equip`) and again at room entry (`stripUnowned`) |
| Loadout | **Browser only** (`whoopa.profile.v1`); sent to the room on join, sanitized | Client chooses, server sanitizes |
| Display name (guest) | Browser only; signed-in players play under their account username | Server for accounts |
| Menu choices, settings, key bindings | Browser only | Client |

The roadmap's test route, run end to end (`tools/scenarios/m0route.mjs`, against a throwaway
server so no real data is touched), passes 10/10: device A signs up, buys an AJ'S item with
test GRAMS, edits and keeps a character, signs out; device B (a separate browser with empty
storage) signs in, sees the same character code and the owned item, and in an online match the
server puts that exact look on the player. A server restart keeps accounts, sessions, looks and
orders; unknown items and unauthenticated equips are refused.

## Findings

1. **Keep Character can fail silently.** `app.ts` sends the look to the account and swallows
   any error (`.catch(() => undefined)`): offline, an expired session or a refused item leaves
   the look saved only in this browser, with nothing on screen. There is no saving / saved /
   failed state.
2. **Signing in silently replaces the local character** with the account's (`onAccountChange`),
   and an account with no saved look never receives the local one until the next Keep. The
   roadmap wants an explicit import of a guest design and no silent overwrite.
3. **Loadout is not on the account.** A second device starts with the default loadout.
4. **No conflict handling.** Two devices saving one after the other: the last write wins, with
   no revision check.
5. **Look codes have an 80-character ceiling.** `decodeAppearance` rejects longer codes and
   falls back to the default look. Codes are 66 characters today and each new cosmetic field
   adds one (per-gun skins already take many), so about 14 more fields would reset every saved
   look. Needs a format version before more fields are added.
6. **Encoding an unknown option id gives option 0** (e.g. hair "bald") instead of the default.
   Every caller sanitizes first, so players never hit it today; it should still be safe.
7. **No account recovery** (no email on accounts; ECONOMY.md lists it as not built).
8. **Single JSON file, single process.** Safe writes (temp file and rename, one transaction at a
   time), but no backups, the whole file is rewritten on every change, and the ledger and
   request tables grow. Fine for today's one-process server; a backup step is needed before
   real money moves.
9. Docs: the README and `profile.ts` still said "no accounts" (fixed with this audit).

## Proposed save contract (v1)

A character save on the account, versioned, replacing the bare `look` string while keeping
it readable:

```ts
interface CharacterSave {
  v: 1;                  // format version of this record
  rig: string;           // base body / rig the look was made on (e.g. "ink-2"); a new base can migrate or flag old saves
  look: string;          // appearance wire code (append-only option lists; per-gun skins included)
  body?: {               // M1: bounded body controls, integers 0..100, clamped server-side
    shoulders: number; build: number; height: number; headSize: number;
  };
  loadout: { primary: string; secondary: string; throwable: string; melee: string }; // weapon ids
  revision: number;      // server-assigned, +1 on every accepted save
  updatedAt: number;     // server time (ms)
}
```

- **Stable ids:** items keep their catalog ids (`top-tiedye-tee`, `skin-camo`...), looks keep
  option ids (field + option), weapons keep `WEAPON_IDS` names. Ids are never reused or renamed;
  option lists stay append-only (the wire code is index-based).
- **Old codes stay readable:** `AccountRec.look` stays and is mirrored from `character.look`
  for older clients; a stored bare look is read as `{ v: 1, rig: <current>, look, loadout:
  default, revision: 0 }`. The look code gets a new prefix (`L2`) with a length or field count,
  lifting the 80-character limit while `L1` codes decode exactly as today.
- **Body controls are cosmetic:** they change the mesh only. Hitboxes, movement and camera stay
  the same for everyone (everyone is already one height).
- **Saves are explicit:** only on Keep Character, equip, or a loadout change; never per frame or
  per slider move. The server checks ownership and clamps values on every save.
- **Revisions:** the client sends the revision it started from; the server accepts only if it
  matches, otherwise it answers 409 with the current save, and the game asks "Changed on another
  device: keep yours, or use that one?".
- **Precedence:** once an account has a save, the account's save wins on sign-in, but the local
  draft is kept (not destroyed) and the player is offered "Use this device's character"
  (explicit import). An account with no save is offered the local design on first sign-in.
- **States:** the Character screen shows Saving, Saved, Failed (retry), and "Saved on this device
  only" when signed out or offline.

## Checklist (smallest first)

1. **Show save status and stop swallowing errors** on Keep Character: `client/src/app.ts`
   (`onKeep`), `client/src/ui/characterScreen.ts` (status line). Smallest change, fixes finding 1.
2. **Look code format v2** (lifts the 80-character limit, safe unknown ids):
   `shared/src/config/appearance.ts` (`encodeAppearance`, `decodeAppearance`, `CODE_PREFIX`),
   tests in `shared/test/appearance.test.ts`.
3. **CharacterSave on the account** with revision and loadout: `server/src/economy/store.ts`
   (`AccountRec.character`), `service.ts` (`saveCharacter`: ownership, clamping, revision
   check), `api.ts` (`GET/POST /api/account/character`), server tests in `server/test/economy.test.ts`.
4. **Client save flow:** `client/src/net/account.ts` (`saveCharacter`, conflict result),
   `client/src/app.ts` (sign-in precedence and import prompt), `client/src/core/profile.ts`
   (keep the local draft separate from the account copy).
5. **Rooms read the loadout from the account** when signed in: `server/src/rooms/MatchRoom.ts`.
6. **Backups** of the economy file before any real payments: a dated copy on start and daily
   (`server/src/economy/store.ts` or the deploy script).
7. Extend `tools/scenarios/m0route.mjs` with loadout, the import prompt and a two-device conflict.

## Decisions this needs (from the roadmap's register)

- **Account platform:** harden the current server-side accounts (above) or move to Supabase /
  PostgreSQL. The contract above works for either; the existing scrypt hashes can be verified
  by our own server but not imported into a managed auth provider, so a move would need a
  claim or reset flow.
- **Recovery:** email (and which provider sends it) before recovery can be built.
- **What an account saves:** the contract assumes one character plus loadout (the roadmap's
  default).
- **Base character (M1):** the roadmap asks for a plain base with natural proportions, narrower
  shoulders and a dark brown shirt with brown pants as the default. The current default is the
  reference-drawing fit (black hooded puffer, black baggy jeans, spiky locs). Which one is the
  default needs your call before M1 changes it.

## Roadmap status against this branch

Work on `feature/jotp-daynight-graphics` that the roadmap lists as future milestones. All of it
is built and tested in code and the browser, none of it is visually approved or live:

| Milestone | On the branch | Still open for the milestone |
| --- | --- | --- |
| M4 day/night | 180 s day / 180 s night with a 10 s blend at the start of each phase, from the server's takeoff time and clock; two browsers matched exactly; JOTP only | Cadence decision; late join cannot be tested (JOTP has no late join); background/resume is computed from the clock but not separately tested; phone check |
| M4 minimap | Riot edge, next zone, squad markers, labels, north, scale bar; north-up by default, rotation optional | Marker list decision; phone safe areas and portrait not checked |
| M5 billboards | Animated ad content system; ESPN untouched | The player interaction (panel) and data-age display are not built |
| M6 effects | Post effects, three.quarks particles, JOTP intro, banners | Done ahead of the roadmap's order; needs the measured budget and approval |
| M3 weapons | Per-class reload, pump, bolt, draw, landing dip | Grip refit to an approved rig; building slice not started |
| M1 / M2 | Human face restored; accounts work as traced above | Everything in this document |
