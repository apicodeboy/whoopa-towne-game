import { PLAYER, TICK_DT } from '../config/game';
import {
  AMMO_WITH_WEAPON, BAGS, HEAL_KINDS, ITEM, LOOT, PORCH, RARITY_LUCK, SQUAD_MODES,
  type Item, type SquadMode,
} from '../config/porch';
import { AMMO_TYPES, SLOT_PRIMARY, SLOT_PRIMARY_B, SLOT_SECONDARY, THROWABLE_IDS, WEAPONS, WEAPON_IDS } from '../config/weapons';
import { clamp, type Rng } from '../math';
import { groundY } from '../map/terrain';
import { EV, KILL_RIOT, PHASE, type PorchInit } from '../protocol';
import type { GameSim, SimPlayer } from './game';
import { Q_PROJECTILE } from './physics';
import { AIR_GROUND, AIR_RIDING, AIR_SKYDIVE, BTN, ammoField, magOf, setMag, type InputCmd, type PlayerState } from './player';

/**
 * JUMP OFF THE PORCH — the battle royale rules, plugged into GameSim. Server-authoritative:
 * the transport, who jumps when, every bookbag's contents, pickups, the riot's progress and
 * who gets eliminated are decided here and only the results are sent to clients.
 */

export interface Bag {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Index into BAGS (the look of the bag and how good its loot is). */
  variant: number;
  opened: boolean;
  /** Decided when the match starts; clients only learn it when the bag is searched. */
  loot: Item[];
}

export interface Pickup extends Item {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Stage numbers sent to clients (PorchSnap.stage). */
export const STAGE_PREGAME = 0;
export const STAGE_DEPLOY = 1;
export const STAGE_EARLY = 2;
/** First riot phase; phase i is STAGE_RIOT + i. */
export const STAGE_RIOT = 3;
export const STAGE_ENDED = STAGE_RIOT + PORCH.riotPhases.length;

export function stageName(stage: number): string {
  if (stage === STAGE_PREGAME) return 'GET READY';
  if (stage === STAGE_DEPLOY) return 'DEPLOYMENT';
  if (stage === STAGE_EARLY) return 'EARLY GAME';
  if (stage >= STAGE_ENDED) return 'VICTORY';
  return PORCH.riotPhases[stage - STAGE_RIOT]?.name ?? '';
}

interface Step {
  stage: number;
  /** 'calm' (deploy / early), 'warn' (crowds gather), 'shrink' (riot spreads), 'hold' (after the last). */
  kind: 'calm' | 'warn' | 'shrink' | 'hold';
  start: number;
  end: number;
  /** Riot phase index (-1 for calm steps). */
  phase: number;
}

/**
 * How dark it is (0 = full day, 1 = full night), `ms` after the match went live. Day for the
 * first period, then night, alternating; each change eases in over the fade time. Before
 * takeoff (or with no match) it is day.
 */
export function porchNight(ms: number): number {
  if (!(ms > 0) || !Number.isFinite(ms)) return 0;
  const { period, fade } = PORCH.dayNight;
  const t = ms / 1000;
  const i = Math.floor(t / period);
  if (i === 0) return 0;
  const k = Math.min(1, (t - i * period) / fade);
  const s = k * k * (3 - 2 * k);
  return i % 2 === 1 ? s : 1 - s;
}

/** Transport position along its route at sim time `t` (also used by clients to draw it). */
export function transportAt(route: readonly number[], speed: number, takeoff: number, t: number, out: { x: number; z: number }): { x: number; z: number } {
  const [x0, z0, x1, z1] = route;
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const d = clamp(((t - takeoff) / 1000) * speed, 0, len);
  out.x = x0 + ((x1 - x0) * d) / len;
  out.z = z0 + ((z1 - z0) * d) / len;
  return out;
}

export class PorchRules {
  readonly squadMode: SquadMode;
  readonly bags: Bag[] = [];
  readonly pickups = new Map<number, Pickup>();
  /** Transport route [x0, z0, x1, z1]. */
  readonly route: [number, number, number, number];
  readonly altitude = PORCH.transport.altitude;
  readonly speed = PORCH.transport.speed;
  /** Sim time the transport takes off (set when the match goes live). */
  takeoff = Infinity;
  /** When everyone still aboard is pushed out (the route is leaving the town). */
  private dropBy = Infinity;
  readonly windX: number;
  readonly windZ: number;

  readonly start0: Circle;
  zone: Circle;
  next: Circle;
  private from: Circle;
  private steps: Step[] = [];
  private stepI = -1;
  stage = STAGE_PREGAME;

  aliveCount = 0;
  squadsAlive = 0;
  private squadsAtStart = 0;
  /** Per player: damage dealt, place (0 = still in it), sim time eliminated. */
  readonly damageDealt: Float32Array;
  readonly place: Uint16Array;
  private outAt: Float64Array;
  private prevButtons: Uint16Array;
  /** Health still to come from an orange (per player), and how fast it comes (per second). */
  private regen: Float32Array;
  private regenRate: Float32Array;
  private riotTimer = 0;
  private nextPickupId = 1;
  private lastEliminatedSquad = -1;
  private sim: GameSim;
  private rng: Rng;
  private tmp = { x: 0, z: 0 };

  constructor(sim: GameSim, squadMode: SquadMode) {
    this.sim = sim;
    this.rng = sim.rng;
    this.squadMode = squadMode;
    const n = sim.players.length;
    this.damageDealt = new Float32Array(n);
    this.place = new Uint16Array(n);
    this.outAt = new Float64Array(n);
    this.prevButtons = new Uint16Array(n);
    this.regen = new Float32Array(n);
    this.regenRate = new Float32Array(n);

    const b = sim.map.bounds, round = sim.map.round;
    // the first riot circle takes in the whole map
    const cx = round ? round.x : (b.minX + b.maxX) / 2, cz = round ? round.z : (b.minZ + b.maxZ) / 2;
    const R0 = round ? round.r + 4 : Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
    this.start0 = { x: cx, z: cz, r: R0 };
    this.zone = { ...this.start0 };
    this.next = { ...this.start0 };
    this.from = { ...this.start0 };

    // a straight route over the town at a random heading, passing near (not through) the middle
    const rng = this.rng;
    const ang = rng.range(0, Math.PI * 2);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const off = rng.range(-0.3, 0.3) * Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    const ox = cx - dz * off, oz = cz + dx * off;
    const half = R0 + PORCH.transport.overshoot;
    this.route = [ox - dx * half, oz - dz * half, ox + dx * half, oz + dz * half];
    const wind = rng.range(0.3, 1) * PORCH.balloon.windMax, wa = rng.range(0, Math.PI * 2);
    this.windX = Math.cos(wa) * wind;
    this.windZ = Math.sin(wa) * wind;
    this.placeBags();
  }

  // ------------------------------------------------------------------ setup
  /** Bookbags: by cars, benches, store shelves, dumpsters and anywhere else people drop things. */
  private placeBags(): void {
    const sim = this.sim, rng = this.rng, nav = sim.nav;
    const hectares = this.landArea() / 10000;
    const count = Math.max(PORCH.minBags, Math.round(sim.players.length * PORCH.bagsPerPlayer), Math.round(hectares * PORCH.bagsPerHectare));
    const props = sim.map.props.filter((p) => p.y < 0.5 && ['car', 'van', 'truck', 'dumpster', 'bench', 'busstop', 'hoop', 'shelf', 'trashcan', 'crate', 'pallet', 'umbrella'].includes(p.type));
    const taken: Array<{ x: number; z: number }> = [];
    const free = (x: number, z: number, d2 = 16) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > d2);
    const totalW = BAGS.reduce((a, v) => a + v.weight, 0);
    const variant = () => {
      let r = rng.next() * totalW;
      for (let i = 0; i < BAGS.length; i++) if ((r -= BAGS[i].weight) <= 0) return i;
      return 0;
    };
    const place = (x: number, floor: number, z: number) => {
      taken.push({ x, z });
      // rest on whatever is underneath: cast down from just above the floor so a roof overhead is never hit
      const from = floor + 1.2;
      const hit = sim.phys.raycast(x, from, z, 0, -1, 0, 3, Q_PROJECTILE);
      const y = hit >= 0 ? from - hit : floor;
      const v = variant();
      this.bags.push({ id: this.bags.length, x, y, z, yaw: rng.range(0, Math.PI * 2), variant: v, opened: false, loot: this.rollLoot(v) });
    };
    // the map's loot spots first (shuffled), a little jitter so they are not in the exact same spot every match
    const spots = [...(sim.map.lootSpots ?? [])];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const atSpots = Math.min(spots.length, Math.round(count * PORCH.bagsAtLootSpots));
    for (let i = 0; i < atSpots; i++) {
      const sp = spots[i];
      const x = sp.x + rng.range(-0.6, 0.6), z = sp.z + rng.range(-0.6, 0.6);
      if (free(x, z, 4)) place(x, sp.y, z);
    }
    for (let guard = 0; this.bags.length < count && guard < count * 40; guard++) {
      let x: number, z: number;
      if (props.length && rng.chance(0.55)) {
        const p = rng.pick(props);
        const a = rng.range(0, Math.PI * 2), d = rng.range(1.2, 2.4);
        x = p.x + Math.cos(a) * d;
        z = p.z + Math.sin(a) * d;
      } else {
        const idx = nav.randomWalkable(rng);
        x = nav.cellX(idx) + rng.range(-0.3, 0.3);
        z = nav.cellZ(idx) + rng.range(-0.3, 0.3);
      }
      if (!nav.isWalkable(x, z) || !free(x, z)) continue;
      place(x, groundY(sim.map, x, z), z);
    }
    // ibuprofen lying around: orange pill bottles on counters, sidewalks, in yards
    for (let n = 0, guard = 0; n < PORCH.ibuprofen.loose && guard < 2000; guard++) {
      let x: number, z: number, floor = 0, outside = true;
      if (spots.length && rng.chance(0.4)) {
        const sp = rng.pick(spots);
        x = sp.x + rng.range(-1.2, 1.2);
        z = sp.z + rng.range(-1.2, 1.2);
        floor = sp.y;
        outside = false;
      } else {
        const idx = nav.randomWalkable(rng);
        x = nav.cellX(idx) + rng.range(-0.3, 0.3);
        z = nav.cellZ(idx) + rng.range(-0.3, 0.3);
        floor = groundY(sim.map, x, z);
      }
      if ((outside && !nav.isWalkable(x, z)) || !free(x, z, 9)) continue;
      taken.push({ x, z });
      const hit = sim.phys.raycast(x, floor + 1.2, z, 0, -1, 0, 3, Q_PROJECTILE);
      const y = hit >= 0 ? floor + 1.2 - hit : floor;
      const pk: Pickup = { id: this.nextPickupId++, kind: ITEM.IBUPROFEN, code: 0, count: rng.chance(0.25) ? 2 : 1, x, y, z };
      this.pickups.set(pk.id, pk);
      n++;
    }
  }

  /** Random contents for a bag (server only). */
  private rollLoot(variant: number): Item[] {
    const bag = BAGS[variant], rng = this.rng;
    const n = rng.int(bag.rolls[1] - bag.rolls[0] + 1) + bag.rolls[0];
    const weights = LOOT.map((e) => e.weight * (1 + (bag.luck - 1) * RARITY_LUCK[e.rarity]));
    const total = weights.reduce((a, v) => a + v, 0);
    const out: Item[] = [];
    for (let k = 0; k < n; k++) {
      let r = rng.next() * total;
      let pick = LOOT[0];
      for (let i = 0; i < LOOT.length; i++) {
        if ((r -= weights[i]) <= 0) {
          pick = LOOT[i];
          break;
        }
      }
      const it = { ...pick.item };
      if (it.kind === ITEM.WEAPON) {
        it.count = WEAPONS[WEAPON_IDS[it.code]].magSize;
        out.push(it);
        const ammo = AMMO_TYPES.indexOf(WEAPONS[WEAPON_IDS[it.code]].ammo as (typeof AMMO_TYPES)[number]);
        if (ammo >= 0) out.push({ kind: ITEM.AMMO, code: ammo, count: AMMO_WITH_WEAPON[it.code] ?? 10 });
      } else {
        out.push(it);
      }
    }
    return out;
  }

  /** Puts a player aboard the transport for the start of the match. */
  board(p: SimPlayer): void {
    const s = p.state;
    const shots = s.shots;
    for (const k of Object.keys(s) as Array<keyof PlayerState>) s[k] = 0;
    s.shots = shots;
    transportAt(this.route, this.speed, this.takeoff, this.sim.time, this.tmp);
    s.x = this.tmp.x;
    s.z = this.tmp.z;
    s.y = this.altitude;
    s.yaw = Math.atan2(-(this.route[2] - this.route[0]), -(this.route[3] - this.route[1]));
    s.air = AIR_RIDING;
    s.pool = 1;
    s.windX = this.windX;
    s.windZ = this.windZ;
    s.hp = PLAYER.maxHealth;
    p.alive = true;
    p.health = PLAYER.maxHealth;
    p.armor = 0;
    p.protectedUntil = 0;
    this.place[p.idx] = 0;
    this.outAt[p.idx] = 0;
    this.damageDealt[p.idx] = 0;
    this.recount();
  }

  /** The match goes live: the transport takes off and the stage timeline is laid out. */
  goLive(now: number): void {
    this.takeoff = now;
    let t = now;
    const add = (stage: number, kind: Step['kind'], seconds: number, phase: number) => {
      this.steps.push({ stage, kind, start: t, end: t + seconds * 1000, phase });
      t += seconds * 1000;
    };
    add(STAGE_DEPLOY, 'calm', PORCH.deploySeconds, -1);
    add(STAGE_EARLY, 'calm', PORCH.earlySeconds, -1);
    PORCH.riotPhases.forEach((ph, i) => {
      add(STAGE_RIOT + i, 'warn', ph.warn, i);
      add(STAGE_RIOT + i, 'shrink', ph.shrink, i);
    });
    this.steps.push({ stage: STAGE_RIOT + PORCH.riotPhases.length - 1, kind: 'hold', start: t, end: Infinity, phase: PORCH.riotPhases.length - 1 });

    // everyone still aboard gets pushed out just before the transport leaves the town
    const len = Math.hypot(this.route[2] - this.route[0], this.route[3] - this.route[1]);
    let lastInside = 0;
    for (let d = 0; d <= len; d += 1) {
      const x = this.route[0] + ((this.route[2] - this.route[0]) * d) / len;
      const z = this.route[1] + ((this.route[3] - this.route[1]) * d) / len;
      if (this.overLand(x, z, 8)) lastInside = d;
    }
    this.dropBy = now + (lastInside / this.speed) * 1000;
    this.recount();
    this.squadsAtStart = this.squadsAlive;
  }

  // ------------------------------------------------------------------ per input
  /** Called for every input command before the player is stepped. */
  /** Returns true when USE went to something here (a bag, a pickup), not to a door. */
  onInput(p: SimPlayer, cmd: InputCmd): boolean {
    const prev = this.prevButtons[p.idx];
    const pressed = cmd.buttons & ~prev;
    this.prevButtons[p.idx] = cmd.buttons;
    if (!p.alive || this.sim.phase !== PHASE.PLAYING) return false;
    const s = p.state;
    if (s.air === AIR_RIDING) {
      if (pressed & BTN.JUMP && this.sim.time >= this.takeoff + PORCH.transport.doorsOpen * 1000) this.jumpOut(p);
      return false;
    }
    if (s.air !== AIR_GROUND) return false;
    let used = false;
    if (pressed & BTN.USE) used = this.interact(p);
    if (pressed & BTN.DROP) this.dropHeld(p);
    return used;
  }

  private jumpOut(p: SimPlayer): void {
    const s = p.state;
    const len = Math.hypot(this.route[2] - this.route[0], this.route[3] - this.route[1]) || 1;
    s.air = AIR_SKYDIVE;
    s.airT = 0;
    s.y = this.altitude - 3;
    s.vx = ((this.route[2] - this.route[0]) / len) * this.speed * 0.5;
    s.vz = ((this.route[3] - this.route[1]) / len) * this.speed * 0.5;
    s.vy = 0;
    this.sim.pushEvent([EV.JUMP_OUT, p.idx]);
  }

  /** What a player could search or pick up right now (the closest within reach). */
  reachable(s: PlayerState): { bag: Bag | null; pickup: Pickup | null } {
    let bag: Bag | null = null, pickup: Pickup | null = null;
    let best = PORCH.reach * PORCH.reach;
    for (const b of this.bags) {
      if (b.opened || Math.abs(b.y - s.y) > 1.8) continue;
      const d = (b.x - s.x) ** 2 + (b.z - s.z) ** 2;
      if (d < best) {
        best = d;
        bag = b;
      }
    }
    for (const it of this.pickups.values()) {
      if (Math.abs(it.y - s.y) > 1.8) continue;
      const d = (it.x - s.x) ** 2 + (it.z - s.z) ** 2;
      if (d < best) {
        best = d;
        pickup = it;
        bag = null;
      }
    }
    return { bag, pickup };
  }

  private interact(p: SimPlayer): boolean {
    const { bag, pickup } = this.reachable(p.state);
    if (!bag && !pickup) return false;
    if (bag) {
      bag.opened = true;
      this.sim.pushEvent([EV.BAG_OPEN, bag.id, p.idx]);
      let k = 0;
      for (const it of bag.loot) {
        const left = this.give(p, it);
        if (left) this.drop(left, bag.x, bag.y, bag.z, k++);
      }
    } else if (pickup) {
      this.pickups.delete(pickup.id);
      this.sim.pushEvent([EV.PICKUP_GONE, pickup.id, p.idx]);
      const left = this.give(p, pickup);
      if (left) this.drop(left, pickup.x, pickup.y, pickup.z, 0);
    }
    return true;
  }

  private dropHeld(p: SimPlayer): void {
    const s = p.state;
    const slot = s.slot;
    const code = slot === SLOT_PRIMARY ? s.wA : slot === SLOT_PRIMARY_B ? s.wB : slot === SLOT_SECONDARY ? s.wH : 0;
    if (code <= 0) return;
    const item: Item = { kind: ITEM.WEAPON, code: code - 1, count: magOf(s, slot) };
    if (slot === SLOT_PRIMARY) s.wA = 0;
    else if (slot === SLOT_PRIMARY_B) s.wB = 0;
    else s.wH = 0;
    setMag(s, slot, 0);
    s.reloadT = 0;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    this.drop(item, s.x + fx * 1.1, s.y, s.z + fz * 1.1, 0);
  }

  /**
   * Puts an item into a player's inventory. Returns what did not fit (or the weapon it
   * replaced), to be dropped on the ground.
   */
  give(p: SimPlayer, it: Item): Item | null {
    const s = p.state;
    const carry = PORCH.carry;
    let left: Item | null = null;
    switch (it.kind) {
      case ITEM.WEAPON: {
        const w = WEAPONS[WEAPON_IDS[it.code]];
        if (!w || w.kind === 'melee') return null;
        const code = it.code + 1;
        let slot = -1;
        if (w.kind === 'secondary') slot = SLOT_SECONDARY;
        else if (s.wA === 0) slot = SLOT_PRIMARY;
        else if (s.wB === 0) slot = SLOT_PRIMARY_B;
        else if (s.slot === SLOT_PRIMARY || s.slot === SLOT_PRIMARY_B) slot = s.slot;
        if (slot < 0) return it;
        const old = slot === SLOT_PRIMARY ? s.wA : slot === SLOT_PRIMARY_B ? s.wB : s.wH;
        if (old > 0) left = { kind: ITEM.WEAPON, code: old - 1, count: magOf(s, slot) };
        if (slot === SLOT_PRIMARY) s.wA = code;
        else if (slot === SLOT_PRIMARY_B) s.wB = code;
        else s.wH = code;
        setMag(s, slot, it.count);
        if (s.slot === slot) {
          s.reloadT = 0;
          s.swapT = w.swapTime;
        }
        break;
      }
      case ITEM.AMMO: {
        const type = AMMO_TYPES[it.code];
        const f = ammoField(type);
        if (!f) return null;
        const room = carry.ammo[type] - s[f];
        const take = Math.min(room, it.count);
        s[f] += take;
        if (take < it.count) left = { ...it, count: it.count - take };
        if (take <= 0) return it;
        break;
      }
      case ITEM.HEAL: {
        const kind = HEAL_KINDS[it.code];
        if (kind === 'ibuprofen') return this.give(p, { kind: ITEM.IBUPROFEN, code: 0, count: it.count });
        const field = kind === 'bandage' ? 'bandages' : kind === 'medkit' ? 'medkits' : 'drinks';
        const room = carry[kind] - s[field];
        const take = Math.min(room, it.count);
        if (take <= 0) return it;
        s[field] += take;
        if (take < it.count) left = { ...it, count: it.count - take };
        break;
      }
      case ITEM.IBUPROFEN: {
        // bottles go in your pockets (taking one is up to you: HEAL, or the weapon wheel)
        const take = Math.min(it.count, carry.ibuprofen - s.pills);
        if (take <= 0) return it;
        s.pills += take;
        if (take < it.count) left = { ...it, count: it.count - take };
        break;
      }
      case ITEM.ARMOR: {
        if (p.armor >= it.code) return it;
        // swap: a better vest goes on, the old one (if any) stays behind
        if (p.armor >= 25) left = { kind: ITEM.ARMOR, code: Math.round(p.armor), count: 1 };
        p.armor = Math.min(PORCH.maxArmor, it.code);
        s.armor = Math.round(p.armor);
        break;
      }
      case ITEM.THROWABLE: {
        const code = it.code + 1;
        if (s.thr !== 0 && s.thr !== code && s.throwables > 0) {
          left = { kind: ITEM.THROWABLE, code: s.thr - 1, count: s.throwables };
          s.throwables = 0;
        }
        s.thr = code;
        const take = Math.min(carry.throwables - s.throwables, it.count);
        if (take <= 0) return it;
        s.throwables += take;
        if (take < it.count) left = left ?? { ...it, count: it.count - take };
        break;
      }
      default:
        return null;
    }
    this.sim.pushEvent([EV.LOOT, p.idx, it.kind, it.code, it.count - (left && left.kind === it.kind && left.code === it.code ? left.count : 0)]);
    return left;
  }

  /** Leaves an item on the ground (spread out a little when several land in one spot). */
  drop(it: Item, x: number, y: number, z: number, k: number): void {
    const a = k * 2.4 + this.rng.range(0, 0.6), d = k === 0 ? 0.3 : 0.6 + 0.25 * k;
    let px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (!this.sim.nav.isWalkable(px, pz)) {
      px = x;
      pz = z;
    }
    const top = this.sim.phys.raycast(px, y + 1.2, pz, 0, -1, 0, 6, Q_PROJECTILE);
    const py = top >= 0 ? y + 1.2 - top : y;
    const pk: Pickup = { id: this.nextPickupId++, kind: it.kind, code: it.code, count: it.count, x: px, y: py, z: pz };
    this.pickups.set(pk.id, pk);
    this.sim.pushEvent([EV.PICKUP_ADD, pk.id, pk.kind, pk.code, pk.count, Math.round(px * 100), Math.round(py * 100), Math.round(pz * 100)]);
  }

  /** Everything an eliminated player carried ends up on the ground where they fell. */
  private dropAll(p: SimPlayer): void {
    const s = p.state;
    const items: Item[] = [];
    if (s.wA > 0) items.push({ kind: ITEM.WEAPON, code: s.wA - 1, count: s.mag0 });
    if (s.wB > 0) items.push({ kind: ITEM.WEAPON, code: s.wB - 1, count: s.magB });
    if (s.wH > 0) items.push({ kind: ITEM.WEAPON, code: s.wH - 1, count: s.mag1 });
    AMMO_TYPES.forEach((t, i) => {
      const f = ammoField(t)!;
      if (s[f] > 0) items.push({ kind: ITEM.AMMO, code: i, count: s[f] });
    });
    if (s.bandages > 0) items.push({ kind: ITEM.HEAL, code: 0, count: s.bandages });
    if (s.medkits > 0) items.push({ kind: ITEM.HEAL, code: 1, count: s.medkits });
    if (s.drinks > 0) items.push({ kind: ITEM.HEAL, code: 2, count: s.drinks });
    if (s.thr > 0 && s.throwables > 0) items.push({ kind: ITEM.THROWABLE, code: s.thr - 1, count: s.throwables });
    if (s.pills > 0) items.push({ kind: ITEM.IBUPROFEN, code: 0, count: s.pills });
    items.forEach((it, k) => this.drop(it, s.x, s.y, s.z, k));
    s.wA = s.wB = s.wH = s.thr = 0;
    s.ammoL = s.ammoM = s.ammoS = s.ammoH = 0;
    s.bandages = s.medkits = s.drinks = s.throwables = s.pills = 0;
    p.armor = 0;
  }

  /** Healing item finished: apply it (health and armor are the server's to give). */
  healed(p: SimPlayer, kind: number): void {
    const h = PORCH.heals[HEAL_KINDS[kind]];
    if (!h) return;
    if (h.slow > 0) {
      // an orange: its health comes in bit by bit (see tick)
      this.regen[p.idx] = Math.min(PLAYER.maxHealth, this.regen[p.idx] + h.amount);
      this.regenRate[p.idx] = h.amount / h.slow;
      p.state.regen = Math.ceil(this.regen[p.idx]);
    } else if (h.armor) {
      p.armor = Math.min(Math.max(p.armor, Math.min(h.cap, p.armor + h.amount)), PORCH.maxArmor);
      p.state.armor = Math.round(p.armor);
    } else {
      p.health = Math.min(Math.max(p.health, Math.min(h.cap, p.health + h.amount)), PLAYER.maxHealth);
    }
    this.sim.pushEvent([EV.HEALED, p.idx, kind]);
  }

  /** Armor soaks up weapon damage first. Returns what gets through to health. */
  absorb(v: SimPlayer, amount: number, attacker: number, weaponCode: number): number {
    if (weaponCode === KILL_RIOT || attacker < 0 || v.armor <= 0) return amount;
    const soak = Math.min(v.armor, amount);
    v.armor -= soak;
    return amount - soak;
  }

  noteDamage(attacker: number, victim: number, amount: number): void {
    if (attacker >= 0 && attacker !== victim) this.damageDealt[attacker] += amount;
  }

  /** A player is out for good. */
  eliminated(v: SimPlayer): void {
    this.outAt[v.idx] = this.sim.time;
    this.dropAll(v);
    this.recount();
    const squadOut = !this.sim.players.some((o) => o && o.alive && o.squad === v.squad);
    let place = 0;
    if (squadOut) {
      place = this.squadsAlive + 1;
      for (const o of this.sim.players) if (o && o.squad === v.squad) this.place[o.idx] = place;
      this.lastEliminatedSquad = v.squad;
    }
    this.sim.pushEvent([EV.ELIM, v.idx, place, squadOut ? 1 : 0]);
  }

  private recount(): void {
    let alive = 0;
    const squads = new Set<number>();
    for (const p of this.sim.players) {
      if (!p || !p.alive) continue;
      alive++;
      squads.add(p.squad);
    }
    this.aliveCount = alive;
    this.squadsAlive = squads.size;
  }

  // ------------------------------------------------------------------ per tick
  /** Advances the match. Returns the winning squad when it is over (-1 draw), else null. */
  tick(): number | null {
    const sim = this.sim, now = sim.time;
    // health still coming from an orange
    for (const p of sim.players) {
      if (!p) continue;
      const i = p.idx;
      if (!p.alive || this.regen[i] <= 0) {
        this.regen[i] = 0;
        p.state.regen = 0;
        continue;
      }
      const give = Math.min(this.regen[i], this.regenRate[i] * TICK_DT, PLAYER.maxHealth - p.health);
      p.health += give;
      this.regen[i] -= give;
      // full up: the rest is not kept for later
      if (p.health >= PLAYER.maxHealth - 1e-6) this.regen[i] = 0;
      p.state.regen = Math.ceil(this.regen[i]);
    }
    // riders move with the transport
    transportAt(this.route, this.speed, this.takeoff, now, this.tmp);
    for (const p of sim.players) {
      if (!p || !p.alive) continue;
      const s = p.state;
      if (s.air === AIR_RIDING) {
        s.x = this.tmp.x;
        s.z = this.tmp.z;
        s.y = this.altitude;
        s.vx = s.vy = s.vz = 0;
        if (sim.phase === PHASE.PLAYING && now >= this.dropBy) this.jumpOut(p);
      }
    }
    if (sim.phase !== PHASE.PLAYING) {
      this.mirror();
      return null;
    }

    // stage timeline
    while (this.stepI + 1 < this.steps.length && now >= this.steps[this.stepI + 1].start) {
      this.stepI++;
      const st = this.steps[this.stepI];
      if (st.kind === 'warn') {
        this.from = { ...this.zone };
        this.next = this.pickNext(this.zone, PORCH.riotPhases[st.phase].radius * this.start0.r);
      }
      if (st.stage !== this.stage) {
        this.stage = st.stage;
        sim.pushEvent([EV.STAGE, this.stage]);
      }
    }
    const step = this.steps[this.stepI];
    if (step && step.kind === 'shrink') {
      const t = clamp((now - step.start) / (step.end - step.start), 0, 1);
      this.zone.x = this.from.x + (this.next.x - this.from.x) * t;
      this.zone.z = this.from.z + (this.next.z - this.from.z) * t;
      this.zone.r = this.from.r + (this.next.r - this.from.r) * t;
    } else if (step && step.kind === 'hold') {
      this.zone = { ...this.next };
    }

    // the riot: anyone on the ground outside the safe area is caught in it
    const dps = this.riotDps();
    this.riotTimer += TICK_DT;
    const hurt = this.riotTimer >= 0.5;
    if (hurt) this.riotTimer -= 0.5;
    for (const p of sim.players) {
      if (!p || !p.alive) continue;
      const s = p.state;
      const inside = (s.x - this.zone.x) ** 2 + (s.z - this.zone.z) ** 2 <= this.zone.r * this.zone.r;
      const caught = !inside && s.air === AIR_GROUND && dps > 0;
      s.riot = caught ? 1 : 0;
      if (caught && hurt) sim.damage(p, dps * 0.5, -1, KILL_RIOT, false, this.zone.x, this.zone.z);
    }

    this.mirror();

    // last squad standing
    this.recount();
    if (this.squadsAtStart > 1 && this.squadsAlive <= 1) {
      if (this.squadsAlive === 1) {
        const w = sim.players.find((p) => p && p.alive)!;
        for (const o of sim.players) if (o && o.squad === w.squad) this.place[o.idx] = 1;
        return w.squad;
      }
      return this.lastEliminatedSquad;
    }
    if (this.squadsAtStart <= 1 && this.aliveCount === 0) return -1;
    return null;
  }

  private riotDps(): number {
    const step = this.steps[this.stepI];
    if (!step || step.phase < 0) return 0;
    // while a phase's crowd is still gathering, the previous phase's riot is what hurts
    const phase = step.kind === 'warn' ? step.phase - 1 : step.phase;
    return phase >= 0 ? PORCH.riotPhases[phase].dps : 0;
  }

  /** The health and armor mirrors the client predicts healing choices with (the warm-up too). */
  private mirror(): void {
    for (const p of this.sim.players) {
      if (!p) continue;
      p.state.hp = Math.max(0, Math.ceil(p.health));
      p.state.armor = Math.round(p.armor);
    }
  }

  /** Is (x, z) over the map's land, at least `margin` in from its edge? */
  private overLand(x: number, z: number, margin: number): boolean {
    const b = this.sim.map.bounds, round = this.sim.map.round;
    if (x < b.minX + margin || x > b.maxX - margin || z < b.minZ + margin || z > b.maxZ - margin) return false;
    return !round || Math.hypot(x - round.x, z - round.z) < round.r - margin;
  }

  /** The map's land area (m²): its bounds, or on a round map the part of the circle on this side of the shore. */
  private landArea(): number {
    const b = this.sim.map.bounds;
    if (!this.sim.map.round) return (b.maxX - b.minX) * (b.maxZ - b.minZ);
    let n = 0;
    for (let x = b.minX + 2; x < b.maxX; x += 4) for (let z = b.minZ + 2; z < b.maxZ; z += 4) if (this.overLand(x, z, 0)) n++;
    return n * 16;
  }

  /** The next safe area: inside the current one, centered on ground people can stand on. */
  private pickNext(cur: Circle, r: number): Circle {
    const nav = this.sim.nav, rng = this.rng;
    const room = Math.max(0, cur.r - r);
    for (let k = 0; k < 60; k++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * room;
      const x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
      const margin = Math.min(r * 0.4, 12);
      if (!this.overLand(x, z, margin)) continue;
      if (r < 20 && !nav.isWalkable(x, z)) continue;
      return { x, z, r };
    }
    return { x: cur.x, z: cur.z, r };
  }

  // ------------------------------------------------------------------ wire
  /** Seconds until the current stage step changes. */
  get stepLeft(): number {
    const st = this.steps[this.stepI];
    // the pregame: time until everyone boards
    if (!st && this.sim.phase === PHASE.WARMUP) return this.sim.timeLeft;
    if (!st) return Math.max(0, (this.takeoff - this.sim.time) / 1000);
    return Number.isFinite(st.end) ? Math.max(0, (st.end - this.sim.time) / 1000) : 0;
  }

  get shrinking(): boolean {
    return this.steps[this.stepI]?.kind === 'shrink';
  }

  snapshot(forIdx: number): number[] {
    const z = this.zone, n = this.next;
    return [
      this.sim.phase === PHASE.ENDED ? STAGE_ENDED : this.stage, Math.round(this.stepLeft * 10), this.shrinking ? 1 : 0,
      Math.round(z.x * 10), Math.round(z.z * 10), Math.round(z.r * 10), Math.round(n.x * 10), Math.round(n.z * 10), Math.round(n.r * 10),
      this.aliveCount, this.squadsAlive, forIdx >= 0 ? this.place[forIdx] : 0, forIdx >= 0 ? Math.round(this.damageDealt[forIdx]) : 0,
      Number.isFinite(this.takeoff) ? Math.round(this.takeoff) : -1,
    ];
  }

  init(): PorchInit {
    const bags: number[] = [];
    for (const b of this.bags) bags.push(b.id, Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(b.yaw * 1000), b.variant, b.opened ? 1 : 0);
    const pickups: number[] = [];
    for (const it of this.pickups.values()) pickups.push(it.id, it.kind, it.code, it.count, Math.round(it.x * 100), Math.round(it.y * 100), Math.round(it.z * 100));
    return { squads: this.squadMode, route: [...this.route], altitude: this.altitude, speed: this.speed, bags, pickups };
  }

  /** Seconds a player survived. */
  survived(idx: number): number {
    const end = this.outAt[idx] || this.sim.time;
    return Number.isFinite(this.takeoff) ? Math.max(0, (end - this.takeoff) / 1000) : 0;
  }

  get squadSize(): number {
    return SQUAD_MODES[this.squadMode].size;
  }
}

export { THROWABLE_IDS };
