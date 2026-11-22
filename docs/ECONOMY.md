# GRAMS, AJ'S and TRAP

How the premium currency (GRAMS), the store (AJ'S) and the inventory (TRAP) work, how to run
them locally, how to test them, and what to set up before taking real money.

Everything is **cosmetic only**. No item changes damage, fire rate, recoil, speed, health or
hit boxes. Weapon wraps swap the gun's material and nothing else.

## Contents

- [What's where](#whats-where)
- [Prices and units](#prices-and-units)
- [Run it locally (test payments)](#run-it-locally-test-payments)
- [Configuration](#configuration)
- [Taking real payments with Stripe](#taking-real-payments-with-stripe)
- [Security model](#security-model)
- [Testing](#testing)
- [Deploying](#deploying)
- [Changing the catalog](#changing-the-catalog)
- [Known limits and next steps](#known-limits-and-next-steps)

## What's where

| Part | Files |
| --- | --- |
| Prices, packages, catalog, rarities | `shared/src/config/economy.ts` |
| Premium cosmetic options (what an item puts on) | `shared/src/config/appearance.ts` (options marked `premium`) |
| Accounts, balances, orders, purchases, ledger | `server/src/economy/service.ts` |
| Storage (atomic JSON file, swappable) | `server/src/economy/store.ts` |
| Payment providers (Stripe, test checkout) | `server/src/economy/payments.ts` |
| HTTP API and Stripe webhook | `server/src/economy/api.ts` |
| Who owns what in matches | `server/src/rooms/MatchRoom.ts` (`stripUnowned` on join and on look changes) |
| Client account service | `client/src/net/account.ts` |
| GRAMS / AJ'S / TRAP / sign-in screens | `client/src/ui/economyScreens.ts`, `client/src/styles/economy.css` |
| The AJ'S building | `shared/src/map/greaterTowne.ts` (`ajsStore`, `AJS`) |
| AJ (the NPC) and talking to him | `client/src/game/ajs/ajNpc.ts`, `client/src/ui/ajTalk.ts` |
| Prints, metals, jewelry, gloves, backpacks | `client/src/game/characters/look/` (`palette.ts`, `jewelry.ts`, `assemble.ts`) |
| Weapon wraps | `client/src/game/characters/weaponSkins.ts` |

### Where players find it

- **Main menu:** the gold **AJ's** pill, the **TRAP** pill, and the GRAMS balance chip. Sign in /
  sign out sits on the profile pill.
- **Character creator:** a **TRAP** button in the header. AJ'S exclusives show with an "AJ's" tag;
  picking one you don't own opens the store.
- **In a match:** **TRAP** in the pause menu. Looks you change mid-match show from your next match;
  a running match keeps the look it started with (same as before).
- **In the world:** AJ'S is a walk-in store on Porch St in Greater Whoopa Towne. From the store
  screen, **Walk to AJ'S** starts *free roam* (the big map to yourself, no bots, no clock),
  spawning at the store's glass doors. Walk to the register and press **E** (controller: d-pad
  down, touch: tap the prompt) to talk to AJ: *Shop*, *Buy GRAMS*, *Preview Outfits*, *Leave*.
  In JUMP OFF THE PORCH matches the building and AJ are there, but the counter is only open in
  free roam (a battle royale can't pause while you shop).

## Prices and units

Balances are stored as **integers**, where **1 GRAM = 10 units**. There is never floating point
money on the server. Displays show decimals (`3.5`, `0.5`).

| Package | Units | Price |
| --- | --- | --- |
| 3.5 GRAMS | 35 | $10.00 |
| 7 GRAMS | 70 | $15.00 |
| 14 GRAMS | 140 | $25.00 |
| 28 GRAMS | 280 | $50.00 |

Store prices are set per item in `CATALOG` (also in units). New accounts start with **0 GRAMS
and no items**.

**Gun skins** are bought per gun in the gun picker (main menu → Guns): every gun in the
collection can wear Gold (2 GRAMS), Mirror Chrome or Iced Out (1.5), Graffiti or Neon Stripe
(1) or Woodland (0.5). Each is its own item (`gun-<gun>-<skin>`, in `GUN_SKIN_ITEMS`), bought
through the same atomic, idempotent `buy` as everything else, owned in TRAP, and worn through
the per-gun appearance field `gs_<gun>`, which the server strips unless the account owns that
exact skin for that exact gun. A gun without its own skin wears the AJ'S wrap, if any. Old
wire codes (saved before the per-gun fields) decode with every gun on its factory finish.

## Run it locally (test payments)

Test payments replace Stripe with a fake checkout page on your own server. No money moves.

```bash
npm install
ECONOMY_TEST_PAYMENTS=1 npm run dev     # server on :2567, client on :5173
```

Open http://localhost:5173, sign up (main menu → **Sign in** → *Create an account*), then click
the GRAMS chip and buy a package. A new tab opens the **TEST CHECKOUT** page: **PAY (TEST)**
credits the account, **DECLINE** does not. The game tab picks up the result on its own.

**Promo code (developers):** with test payments on, every item at AJ'S and every gun skin in the
gun picker has a **Promo code** box; **FREEME** gets that item free (no GRAMS spent). The box only
shows on servers where a code works, so it never appears in production.

Account data goes to `server/data/economy.json` (git-ignored). Delete that file to start over.
To keep test data somewhere else: `ECONOMY_DB=/tmp/eco.json`.

## Configuration

All settings are environment variables on the game server.

| Variable | What it does | Default |
| --- | --- | --- |
| `ECONOMY_DB` | Path of the data file. `:memory:` keeps nothing (tests). | `server/data/economy.json` |
| `PUBLIC_URL` | The address players reach the server at (Stripe sends them back here). | `http://localhost:<port>` |
| `ALLOWED_ORIGINS` | Extra origins (comma separated) allowed to call the API, if the client is served from a different domain than the server. | dev ports only |
| `STRIPE_SECRET_KEY` | Turns on buying GRAMS through Stripe Checkout. | off |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the Stripe webhook endpoint (strongly recommended). | none |
| `ECONOMY_TEST_PAYMENTS` | `1` = fake checkout and the developers' promo code `FREEME` (any item free). **Both refused when `NODE_ENV=production`.** | off |

With neither Stripe nor test payments configured, everything else works (accounts, TRAP, buying
with GRAMS you already have) and the GRAMS screen says buying isn't set up yet.

## Taking real payments with Stripe

No Stripe SDK is used; the server calls Stripe's REST API with `fetch`.

1. In the Stripe Dashboard, get a **secret key** (start with a test-mode key, `sk_test_...`).
2. Add a **webhook endpoint**: `https://<your server>/api/payments/stripe/webhook`, listening to
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

   Copy its **signing secret** (`whsec_...`).
3. Set on the server: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_URL` (the HTTPS
   address of the game), and `NODE_ENV=production`.
4. Do a full purchase in **test mode** with a Stripe test card, check the balance and the
   transaction history, then switch to live keys.

Prices are created inline on each Checkout Session from `GRAMS_PACKAGES`, so there is nothing to
set up in the Stripe product catalog. Each session carries the order id in its metadata and
uses an `Idempotency-Key`, so a retried request never makes two sessions.

> **App stores.** This is the web checkout. If the game ships as a native iOS / Android app,
> Apple and Google generally require their own in-app purchase systems for digital currency.
> A store-specific `PaymentProvider` (verifying receipts server-side) would slot in next to
> `StripeProvider`; check the current store rules before shipping.

## Security model

- **The server decides everything.** Balances, ownership and prices live only on the server. The
  client never sends a price or a balance; it sends *which* item and a request id.
- **GRAMS are credited only after server-side verification.** "I paid" from the client means
  nothing: an order is settled only when the server reads the checkout back from the provider
  (or receives a **signed** webhook) and sees it `paid`, in **USD**, for **exactly** the
  package's amount. Underpaid, unpaid, expired or mismatched checkouts never credit.
- **Each payment credits once.** An order moves `pending → paid` exactly once (the credit and the
  status change are one transaction). Webhook event ids are remembered, so replays and Stripe
  retries are ignored. Polling and webhooks can race safely.
- **Webhook signatures** are verified (HMAC-SHA256 over the raw body, constant-time compare,
  5-minute timestamp tolerance) before anything is read.
- **Purchases are atomic.** Balance check, debit, ledger entry and ownership happen in one
  transaction: all or nothing. Transactions run one at a time, so two simultaneous purchases
  can't both spend the same GRAMS. Owning an item already, or not having enough, refuses the
  purchase without touching the balance.
- **Retries are safe.** Each purchase carries a request id; repeating it returns the first result
  instead of buying again.
- **Everything is logged.** Every credit and debit is a ledger row (`/api/account/transactions`
  shows a player theirs). Balances can't go negative or become fractional (the ledger refuses).
- **Ownership in matches.** When a signed-in player joins a match (and whenever they change their
  look), the server strips any AJ'S option they don't own before anyone else sees it. Guests
  can't wear exclusives at all. Bots never get them.
- **Accounts.** Passwords are hashed with scrypt (random salt, constant-time compare). Session
  tokens are random 256-bit values stored only as SHA-256 hashes, valid for 30 days. Sign-in and
  sign-up are rate limited.
- **No selling, gifting or trading** exists anywhere in the API.

### Promo codes

- Codes are defined on the server only (`server/src/economy/promo.ts`); the browser sends what was
  typed and the server decides. `FREEME` (every item free) is a development code: it is active
  only when test payments are on, and never under `NODE_ENV=production`.
- `POST /api/store/redeem` `{ itemId, code, requestId }` (signed in): the code check, the
  ownership grant and a log entry (`redemptions`: account, item, code, time) happen in one
  transaction; a retried request gets the first answer; an item already owned is refused. No
  GRAMS move, so the ledger is untouched; the owned record says `via: "promo:FREEME"`.
- 20 tries per account and per address every 10 minutes.
- `GET /api/economy` says `promos: true|false`; the store shows the code box only when true.

## Testing

### Automated

```bash
npm test
```

Server (`server/test/economy.test.ts`, `server/test/net.test.ts`):

- the four packages at exactly the official prices; catalog sizes
- sign up, sign in, wrong passwords, sessions
- a verified payment credits exactly once; declined or unverified payments never credit
- Stripe webhooks: bad signatures refused, replays and duplicates ignored, wrong amounts refused
- AJ'S: insufficient GRAMS refused, exact debit, item lands in TRAP, no double buys, safe retries
- simultaneous purchases can never overspend or double-buy
- TRAP: equip only what you own; balance, items and equipped look survive a server restart
- the HTTP API end to end (sign up → test checkout → buy → equip → history)
- in a real match, the buyer's items are seen by everyone; nobody wears what they didn't buy
  (forged looks are stripped)

Shared (`shared/test/ajs.test.ts`): AJ'S is on the map (walls, glass, counter, sign, minimap
label), and a player spawned in free roam walks in through the doors and reaches AJ.

### By hand

With `ECONOMY_TEST_PAYMENTS=1`:

1. Sign up. The GRAMS chip shows **0**, TRAP is empty.
2. Buy 3.5 GRAMS → PAY (TEST). The balance shows **3.5**; history shows the credit.
3. Buy another package → DECLINE. The balance doesn't change.
4. AJ'S → Full Fits → Gold Rush (6). You get **"Not enough GRAMS. Want to re-up?"**.
5. Buy something you can afford. **"Purchase Successful!"**, the exact price comes off, the
   item shows **OWNED** and appears in TRAP.
6. TRAP: Equip / Unequip / Preview; filter by category and rarity.
7. Sign out and back in (or restart the server): balance, items and the equipped look are back.
8. Two browsers, two accounts, one private lobby: each sees the other's equipped items.
9. Store screen → **Walk to AJ'S**, walk to the register, press **E**, try every option.
10. Play a normal match in each mode to check nothing else changed.

## Deploying

- **Keep test payments off in production.** Don't set `ECONOMY_TEST_PAYMENTS` there (it's refused
  under `NODE_ENV=production` anyway).
- **Use HTTPS.** Tokens travel in an `Authorization` header.
- **Put the data file on persistent storage** and back it up. Many hosts wipe the container disk
  on every deploy: point `ECONOMY_DB` at a mounted volume. Writes are atomic (write to a temp
  file, then rename), so a crash never leaves a half-written file.
- **One server process.** The file store keeps its state in memory and is safe for exactly one
  process. To run several game servers, move to a database first (below).
- Test the whole flow on a staging server with Stripe test keys before switching to live keys.

### Moving to a database

`FileEconomyStore` implements a small interface (`EconomyStore` in `store.ts`): `state` and
`tx(fn)`, where `tx` runs `fn` on a copy and commits it only if it succeeds. A Postgres (or
similar) store needs the same guarantees: run each `tx` as one serializable transaction (or with
row locks on the account), and keep unique constraints on order ids, webhook event ids and
`account + request id`. The service layer and the tests don't change.

## Changing the catalog

Items and prices are in `CATALOG` in `shared/src/config/economy.ts`. Each item lists the
appearance options it puts on (`equip`), its rarity, and its price **in units**. An option
becomes "AJ'S only" by marking it `premium` in `appearance.ts` (the `aj(...)` helper). New
prints go in `PRINTS` (`palette.ts`), new wraps in `weaponSkins.ts`, and per-gun skin prices in
`GUN_SKIN_PRICES`.

All card art is **placeholder** (drawn SVGs, marked "Placeholder art" in the store). Replace it in
`client/src/ui/economyArt.ts` when final art exists.

Don't reuse an item id for a different item: ids are what accounts own.

## Known limits and next steps

- Free roam is offline (just you). Visiting AJ'S in an online lobby would need a shared roam
  room on the server.
- Temporary items (`temporaryDays`) are supported by the data model and hidden when expired, but
  no item in the starter catalog uses them.
- There is no refund / chargeback handling yet. If Stripe reverses a payment, adjust the account
  by hand (and add `charge.refunded` / `charge.dispute.created` handling before scaling up).
- Account recovery (forgotten passwords, email) isn't built.
