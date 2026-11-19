import { PLAYER } from '../config/game';
import type { DoorDef, MapDef, WindowDef } from '../map/types';
import { EV } from '../protocol';
import type { PhysicsWorld } from './physics';
import { AIR_GROUND, BTN, type InputCmd, type PlayerState } from './player';

/**
 * Doors and windows: the part of a building that changes during a match.
 *
 * The server owns the state and sends every change as an event; each client keeps a copy
 * (with the same collision boxes switched on and off) so movement prediction sees the same
 * world. A closed door is solid. An intact window pane stops people and grenades but not
 * bullets: a shot goes through and breaks it. Open or broken windows can be climbed through
 * (see the vault in player.ts).
 */

export const WIN_CLOSED = 0;
export const WIN_OPEN = 1;
export const WIN_BROKEN = 2;

export const BUILD = {
  /** How far from a door or window (its nearest point, meters) you can use it. */
  reach: 1.7,
  /** Seconds to hold USE on a closed door, from inside, to lock or unlock it. */
  lockHold: 0.6,
  /** Door leaf / glass pane thickness. */
  doorT: 0.07,
  paneT: 0.05,
  /** Grenades break windows this close (meters). */
  blastRadius: 5.5,
  /** Bots open doors this close in front of them. */
  botReach: 1.3,
} as const;

/** Door state on the wire: bit 0 open, bit 1 locked, bit 2 swings to the back side. */
export function packDoor(open: boolean, locked: boolean, swing: number): number {
  return (open ? 1 : 0) | (locked ? 2 : 0) | (swing < 0 ? 4 : 0);
}

export interface UseTarget {
  kind: 'door' | 'window';
  i: number;
  /** Distance to it. */
  d: number;
}

/** Deterministic 0..1 from an index (which inside doors start open). */
function hash01(i: number): number {
  let t = Math.imul(i + 0x9e37, 2654435761);
  t ^= t >>> 15;
  t = Math.imul(t, 2246822519);
  return ((t ^ (t >>> 13)) >>> 0) / 4294967296;
}

export class Buildings {
  readonly doors: readonly DoorDef[];
  readonly windows: readonly WindowDef[];
  readonly open: Uint8Array;
  readonly locked: Uint8Array;
  /** +1: the leaf swings toward the door's normal side when open, -1 the other way. */
  readonly swing: Int8Array;
  readonly win: Uint8Array;
  /** Goes up on every change (renderers redraw when it moves). */
  version = 0;
  private doorCol: Int32Array;
  private winCol: Int32Array;
  /** Door centers (the middle of the closed leaf) and window centers, for distance checks. */
  private dc: Float32Array;
  private wc: Float32Array;

  constructor(map: MapDef, private phys: PhysicsWorld | null) {
    this.doors = map.doors ?? [];
    this.windows = map.windows ?? [];
    const nd = this.doors.length, nw = this.windows.length;
    this.open = new Uint8Array(nd);
    this.locked = new Uint8Array(nd);
    this.swing = new Int8Array(nd);
    this.win = new Uint8Array(nw);
    this.doorCol = new Int32Array(nd).fill(-1);
    this.winCol = new Int32Array(nw).fill(-1);
    this.dc = new Float32Array(nd * 3);
    this.wc = new Float32Array(nw * 3);
    this.doors.forEach((d, i) => {
      const s = Math.sin(d.a), c = Math.cos(d.a);
      this.dc[i * 3] = d.x + s * d.w / 2;
      this.dc[i * 3 + 1] = d.y + d.h / 2;
      this.dc[i * 3 + 2] = d.z + c * d.w / 2;
      if (phys) this.doorCol[i] = phys.addToggleBox(this.dc[i * 3], this.dc[i * 3 + 1], this.dc[i * 3 + 2], BUILD.doorT, d.h, d.w, d.a, false, true);
    });
    this.windows.forEach((w, i) => {
      this.wc[i * 3] = w.x;
      this.wc[i * 3 + 1] = w.y + w.h / 2;
      this.wc[i * 3 + 2] = w.z;
      // breakable panes stop people but not bullets (a shot breaks them); the others are solid
      if (phys) this.winCol[i] = phys.addToggleBox(w.x, w.y + w.h / 2, w.z, BUILD.paneT, w.h, w.w, w.a, w.breakable, true);
    });
    this.reset();
  }

  /**
   * Every door and window as a match starts: windows shut, doors shut (the ones marked locked,
   * locked), except inside doors without a lock, about half of which are left open.
   */
  reset(): void {
    this.doors.forEach((d, i) => {
      const open = !d.locked && d.kind === 'wood' && !d.lockable && hash01(i) < 0.5;
      this.setDoor(i, open, !!d.locked, d.inside ?? 1);
    });
    for (let i = 0; i < this.windows.length; i++) {
      this.win[i] = WIN_CLOSED;
      this.setWindow(i, WIN_CLOSED);
    }
  }

  get doorCount(): number {
    return this.doors.length;
  }
  get windowCount(): number {
    return this.windows.length;
  }

  // ------------------------------------------------------------------ state
  setDoor(i: number, open: boolean, locked: boolean, swing: number): void {
    if (i < 0 || i >= this.doors.length) return;
    this.open[i] = open ? 1 : 0;
    this.locked[i] = locked ? 1 : 0;
    this.swing[i] = swing < 0 ? -1 : 1;
    if (this.phys && this.doorCol[i] >= 0) this.phys.setEnabled(this.doorCol[i], !open);
    this.version++;
  }

  setDoorPacked(i: number, bits: number): void {
    this.setDoor(i, (bits & 1) !== 0, (bits & 2) !== 0, bits & 4 ? -1 : 1);
  }

  doorBits(i: number): number {
    return packDoor(this.open[i] === 1, this.locked[i] === 1, this.swing[i]);
  }

  setWindow(i: number, state: number): void {
    if (i < 0 || i >= this.windows.length) return;
    if (this.win[i] === WIN_BROKEN) return; // broken stays broken
    this.win[i] = state;
    if (this.phys && this.winCol[i] >= 0) this.phys.setEnabled(this.winCol[i], state === WIN_CLOSED);
    this.version++;
  }

  /** The whole state, for someone joining: [doors..., windows...] (door bits, window states). */
  encode(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.doors.length; i++) out.push(this.doorBits(i));
    for (let i = 0; i < this.windows.length; i++) out.push(this.win[i]);
    return out;
  }

  /** Takes on a state from encode() (a missing or mismatched one resets instead). */
  decode(state: readonly number[] | undefined): void {
    if (!state || state.length !== this.doors.length + this.windows.length) {
      this.reset();
      return;
    }
    for (let i = 0; i < this.doors.length; i++) this.setDoorPacked(i, state[i] | 0);
    for (let i = 0; i < this.windows.length; i++) {
      const w = state[this.doors.length + i] | 0;
      if (w !== this.win[i]) {
        this.win[i] = 0; // decode may repair (a new match)
        this.setWindow(i, w);
      }
    }
  }

  /** Applies a DOOR / WINDOW event. True if it was one. */
  applyEvent(e: readonly number[]): boolean {
    if (e[0] === EV.DOOR) this.setDoorPacked(e[1], e[2]);
    else if (e[0] === EV.WINDOW) this.setWindow(e[1], e[2]);
    else return false;
    return true;
  }

  // ------------------------------------------------------------------ geometry
  /** Which side of door i (feet position): +1 the normal side, -1 the other. */
  doorSide(i: number, x: number, z: number): 1 | -1 {
    const d = this.doors[i];
    const nx = Math.cos(d.a), nz = -Math.sin(d.a);
    return (x - d.x) * nx + (z - d.z) * nz >= 0 ? 1 : -1;
  }

  /** True when standing on the room side of a door that has one (lockable doors). */
  insideOf(i: number, x: number, z: number): boolean {
    const d = this.doors[i];
    return this.doorSide(i, x, z) === (d.inside ?? 1);
  }

  /** Horizontal distance from a point to the closed leaf (or the window), as a segment. */
  private segDist(x: number, z: number, cx: number, cz: number, a: number, w: number): number {
    const ux = Math.sin(a), uz = Math.cos(a);
    const along = Math.max(-w / 2, Math.min(w / 2, (x - cx) * ux + (z - cz) * uz));
    return Math.hypot(x - (cx + ux * along), z - (cz + uz * along));
  }

  /**
   * The door or window a player would use: the closest within reach on their floor, in front of
   * them (looking toward it counts more than being right next to it).
   */
  target(x: number, y: number, z: number, yaw: number): UseTarget | null {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: UseTarget | null = null, bestScore = Infinity;
    const consider = (kind: 'door' | 'window', i: number, cx: number, cy0: number, cy1: number, cz: number, a: number, w: number) => {
      if (y < cy0 - 0.6 || y > cy1) return;
      if (Math.abs(cx - x) > BUILD.reach + w && Math.abs(cz - z) > BUILD.reach + w) return;
      const d = this.segDist(x, z, cx, cz, a, w);
      if (d > BUILD.reach) return;
      const dl = Math.hypot(cx - x, cz - z) || 1;
      const facing = ((cx - x) * fx + (cz - z) * fz) / dl;
      if (facing < -0.25 && d > 0.6) return;
      const score = d - facing * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = { kind, i, d };
      }
    };
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      consider('door', i, this.dc[i * 3], d.y, d.y + 1.0, this.dc[i * 3 + 2], d.a, d.w);
    }
    for (let i = 0; i < this.windows.length; i++) {
      const w = this.windows[i];
      if (this.win[i] === WIN_BROKEN || w.kind === 'fixed') continue;
      // you reach a window whose sill is between your knees and your chest
      consider('window', i, this.wc[i * 3], w.y - 1.5, w.y + 0.2, this.wc[i * 3 + 2], w.a, w.w);
    }
    return best;
  }

  /** True if anyone (feet positions) stands where door i's closed leaf would be. */
  blocked(i: number, people: ReadonlyArray<{ x: number; y: number; z: number }>): boolean {
    const d = this.doors[i];
    for (const p of people) {
      if (p.y > d.y + d.h || p.y + PLAYER.height < d.y) continue;
      if (this.segDist(p.x, p.z, this.dc[i * 3], this.dc[i * 3 + 2], d.a, d.w) < PLAYER.radius + BUILD.doorT) return true;
    }
    return false;
  }

  /**
   * Intact breakable windows a straight segment passes through (a bullet's path). Calls `hit`
   * for each.
   */
  segmentWindows(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hit: (i: number) => void): void {
    const minX = Math.min(ax, bx) - 2, maxX = Math.max(ax, bx) + 2, minZ = Math.min(az, bz) - 2, maxZ = Math.max(az, bz) + 2;
    for (let i = 0; i < this.windows.length; i++) {
      const w = this.windows[i];
      if (this.win[i] !== WIN_CLOSED || !w.breakable) continue;
      const cx = this.wc[i * 3], cy = this.wc[i * 3 + 1], cz = this.wc[i * 3 + 2];
      if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
      const nx = Math.cos(w.a), nz = -Math.sin(w.a);
      const d0 = (ax - cx) * nx + (az - cz) * nz, d1 = (bx - cx) * nx + (bz - cz) * nz;
      if ((d0 > 0) === (d1 > 0)) continue;
      const t = d0 / (d0 - d1);
      const qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t, qz = az + (bz - az) * t;
      const along = (qx - cx) * Math.sin(w.a) + (qz - cz) * Math.cos(w.a);
      if (Math.abs(along) <= w.w / 2 && Math.abs(qy - cy) <= w.h / 2) hit(i);
    }
  }

  /** Intact breakable windows within `r` of a point (an explosion). */
  windowsNear(x: number, y: number, z: number, r: number, hit: (i: number) => void): void {
    for (let i = 0; i < this.windows.length; i++) {
      if (this.win[i] !== WIN_CLOSED || !this.windows[i].breakable) continue;
      const dx = this.wc[i * 3] - x, dy = this.wc[i * 3 + 1] - y, dz = this.wc[i * 3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz < r * r) hit(i);
    }
  }

  /** The closed door straight ahead of someone walking (bots), or -1. */
  doorAhead(x: number, y: number, z: number, dx: number, dz: number, reach: number): number {
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return -1;
    const px = x + (dx / len) * reach * 0.6, pz = z + (dz / len) * reach * 0.6;
    for (let i = 0; i < this.doors.length; i++) {
      if (this.open[i]) continue;
      const d = this.doors[i];
      if (y < d.y - 0.5 || y > d.y + 1) continue;
      if (this.segDist(px, pz, this.dc[i * 3], this.dc[i * 3 + 2], d.a, d.w) < reach * 0.6) return i;
    }
    return -1;
  }
}

// ===================================================================================== rules
/** What the door rules need from the match (kept structural so this file has no sim import). */
export interface BuildingHost {
  readonly time: number;
  readonly players: ReadonlyArray<{ idx: number; alive: boolean; isBot: boolean; state: PlayerState } | null>;
  pushEvent(e: number[]): void;
}

/**
 * The server's door and window rules: USE opens and closes doors (they swing away from you),
 * holding USE from inside a closed door locks or unlocks it, a locked door only rattles from
 * outside, USE slides or swings a window open or shut. Bots open doors in their way.
 */
export class BuildingRules {
  private prevUse: Uint8Array;
  private holdT: Float32Array;
  private holdDoor: Int32Array;
  private people: Array<{ x: number; y: number; z: number }> = [];

  constructor(readonly b: Buildings, private host: BuildingHost, cap: number) {
    this.prevUse = new Uint8Array(cap);
    this.holdT = new Float32Array(cap);
    this.holdDoor = new Int32Array(cap).fill(-1);
  }

  /** One player's input for this tick. `taken`: USE already went to something else (loot). */
  onInput(idx: number, cmd: InputCmd, dt: number, taken: boolean): void {
    const p = this.host.players[idx];
    const use = (cmd.buttons & BTN.USE) !== 0;
    const pressed = use && !this.prevUse[idx];
    const released = !use && this.prevUse[idx];
    this.prevUse[idx] = use ? 1 : 0;
    if (!p || !p.alive || p.state.air !== AIR_GROUND || p.state.climbT > 0) {
      this.holdDoor[idx] = -1;
      return;
    }
    const s = p.state;
    // a held press on the inside of a closed door: lock / unlock after a moment, open on release
    const hd = this.holdDoor[idx];
    if (hd >= 0) {
      if (use) {
        this.holdT[idx] += dt;
        if (this.holdT[idx] >= BUILD.lockHold) {
          this.holdDoor[idx] = -1;
          if (!this.b.open[hd]) this.door(hd, false, !this.b.locked[hd], this.b.swing[hd], idx);
        }
        return;
      }
      this.holdDoor[idx] = -1;
      if (released && !this.b.open[hd]) this.toggleDoor(hd, s, idx);
      return;
    }
    if (!pressed || taken) return;
    const t = this.b.target(s.x, s.y, s.z, s.yaw);
    if (!t) return;
    if (t.kind === 'window') {
      const w = this.b.win[t.i];
      this.window(t.i, w === WIN_OPEN ? WIN_CLOSED : WIN_OPEN, idx);
      return;
    }
    const i = t.i;
    const d = this.b.doors[i];
    if (!this.b.open[i] && d.lockable && this.b.insideOf(i, s.x, s.z)) {
      // wait to see whether this is a tap (open) or a hold (lock)
      this.holdDoor[idx] = i;
      this.holdT[idx] = 0;
      return;
    }
    this.toggleDoor(i, s, idx);
  }

  private toggleDoor(i: number, s: PlayerState, by: number): void {
    const b = this.b;
    if (b.open[i]) {
      if (b.blocked(i, this.alivePeople())) return;
      this.door(i, false, b.locked[i] === 1, b.swing[i], by);
      return;
    }
    if (b.locked[i]) {
      if (!b.insideOf(i, s.x, s.z) || !b.doors[i].lockable) {
        this.host.pushEvent([EV.DENIED, i, by]);
        return;
      }
    }
    // swing away from whoever opens it; unlocking from inside comes with opening
    this.door(i, true, false, -b.doorSide(i, s.x, s.z), by);
  }

  private door(i: number, open: boolean, locked: boolean, swing: number, by: number): void {
    this.b.setDoor(i, open, locked, swing);
    this.host.pushEvent([EV.DOOR, i, this.b.doorBits(i), by]);
  }

  private window(i: number, state: number, by: number): void {
    if (this.b.win[i] === WIN_BROKEN) return;
    this.b.setWindow(i, state);
    this.host.pushEvent([EV.WINDOW, i, state, by]);
  }

  private alivePeople(): Array<{ x: number; y: number; z: number }> {
    const out = this.people;
    out.length = 0;
    for (const p of this.host.players) if (p && p.alive) out.push(p.state);
    return out;
  }

  /** A bot about to walk into a closed (unlocked) door opens it. */
  botAssist(idx: number, cmd: InputCmd): void {
    const p = this.host.players[idx];
    if (!p || !p.alive || p.state.air !== AIR_GROUND) return;
    const s = p.state;
    const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
    const dx = cos * cmd.mx - sin * cmd.mz, dz = -sin * cmd.mx - cos * cmd.mz;
    const i = this.b.doorAhead(s.x, s.y, s.z, dx, dz, BUILD.botReach);
    if (i < 0 || this.b.locked[i]) return;
    this.door(i, true, false, -this.b.doorSide(i, s.x, s.z), idx);
  }

  /** A shot from (a) to (b) breaks the intact windows it goes through. */
  shot(ax: number, ay: number, az: number, bx: number, by: number, bz: number, shooter: number): void {
    this.b.segmentWindows(ax, ay, az, bx, by, bz, (i) => this.breakWindow(i, shooter));
  }

  /** A grenade goes off. */
  blast(x: number, y: number, z: number, owner: number): void {
    this.b.windowsNear(x, y, z, BUILD.blastRadius, (i) => this.breakWindow(i, owner));
  }

  breakWindow(i: number, by: number): void {
    if (this.b.win[i] === WIN_BROKEN) return;
    this.b.setWindow(i, WIN_BROKEN);
    this.host.pushEvent([EV.WINDOW, i, WIN_BROKEN, by]);
  }
}
