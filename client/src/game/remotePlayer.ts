import * as THREE from 'three';
import { CREWS, type TeamId } from '@shared/config/crews';
import { LEDGE, ROLL } from '@shared/config/game';
import { THROWABLE_IDS, WEAPON_IDS, WEAPONS } from '@shared/config/weapons';
import { lerpAngle } from '@shared/math';
import { HELD_GRENADE, PF, type SnapPlayer } from '@shared/protocol';
import { makePose, type CharacterPose, type CharacterVisual, type HeldItem } from './characters/characterTypes';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  held: number;
}

const BUF = 32;
const MAX_EXTRAPOLATE_MS = 120;
const TELEPORT_DIST = 4;

export function heldFromCode(code: number): HeldItem {
  if (code >= 0 && code < WEAPON_IDS.length) {
    const id = WEAPON_IDS[code];
    return id === 'fists' ? 'none' : id;
  }
  return THROWABLE_IDS[code - HELD_GRENADE] ?? 'none';
}

function makeNameTag(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(name, 128, 30);
  g.fillStyle = color;
  g.fillText(name, 128, 30);
  // little crew marker under the name
  g.beginPath();
  g.moveTo(120, 50);
  g.lineTo(136, 50);
  g.lineTo(128, 60);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.15, 0.0375, 1);
  s.renderOrder = 30;
  return s;
}

/**
 * Another player as rendered on this client. Snapshots arrive at 30 Hz; we keep a short
 * buffer and render the player ~100ms in the past, interpolating between the two
 * snapshots that bracket the render time (entity interpolation).
 */
export class RemotePlayer {
  readonly idx: number;
  readonly team: TeamId;
  readonly name: string;
  /** Look code the visual was built with (a roster change to it rebuilds the player). */
  look: string | undefined;
  readonly isBot: boolean;
  readonly visual: CharacterVisual;
  readonly tag: THREE.Sprite;

  // interpolated, as currently rendered
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  vx = 0;
  vz = 0;
  flags = 0;
  held = 0;
  hp = 100;
  kills = 0;
  deaths = 0;
  score = 0;
  ping = 0;
  /** Seconds since this player last fired (for minimap pings / audio). */
  sinceShot = 99;
  /** Distance walked since the last footstep sound. */
  private stride = 0;
  private stepDue = false;

  private buf: Sample[] = [];
  private pose: CharacterPose = makePose();
  private reloadT = -1;
  private reloadDur = 2;
  private wasAlive = true;
  private wasRiding = false;
  private friendly: boolean;
  private rollT = -1;
  private climbT = -1;

  constructor(idx: number, name: string, team: TeamId, isBot: boolean, visual: CharacterVisual, friendly: boolean) {
    this.idx = idx;
    this.name = name;
    this.team = team;
    this.isBot = isBot;
    this.visual = visual;
    this.friendly = friendly;
    this.tag = makeNameTag(name, CREWS[team].light);
    // teammates' names show through walls; enemies' only when actually visible
    this.tag.material.depthTest = !friendly;
    this.tag.visible = false;
  }

  get alive(): boolean {
    return (this.flags & PF.ALIVE) !== 0;
  }

  get crouching(): boolean {
    return (this.flags & PF.CROUCH) !== 0;
  }

  push(p: SnapPlayer, t: number): void {
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) return;
    const s: Sample = this.buf.length >= BUF ? this.buf.shift()! : ({} as Sample);
    s.t = t; s.x = p.x; s.y = p.y; s.z = p.z; s.yaw = p.yaw; s.pitch = p.pitch; s.flags = p.flags; s.held = p.held;
    this.buf.push(s);
    this.hp = p.hp;
    this.kills = p.kills;
    this.deaths = p.deaths;
    this.score = p.score;
    this.ping = p.ping;
  }

  /** True once per footstep (consumes it). */
  takeStep(): boolean {
    const due = this.stepDue;
    this.stepDue = false;
    return due;
  }

  get sprinting(): boolean {
    return (this.flags & PF.SPRINT) !== 0;
  }

  startReload(): void {
    const code = this.held;
    this.reloadDur = code < WEAPON_IDS.length ? WEAPONS[WEAPON_IDS[code]].reloadTime : 2;
    this.reloadT = 0;
  }

  /**
   * Samples the buffer at render time `rt` (server ms) and animates the character.
   * `visible` false (outside the camera's view) keeps it positioned but skips the animation work.
   */
  update(dt: number, rt: number, cameraPos: THREE.Vector3, visible = true): void {
    const buf = this.buf;
    if (buf.length === 0) return;
    let a = buf[0], b = buf[0];
    let k = 0;
    if (rt >= buf[buf.length - 1].t) {
      // ran out of snapshots: extrapolate briefly from the last two, then hold
      b = buf[buf.length - 1];
      a = buf.length > 1 ? buf[buf.length - 2] : b;
      const span = b.t - a.t;
      const over = Math.min(rt - b.t, MAX_EXTRAPOLATE_MS);
      k = span > 0 ? 1 + over / span : 1;
    } else {
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].t <= rt) {
          a = buf[i - 1];
          b = buf[i];
          k = (rt - a.t) / (b.t - a.t);
          break;
        }
      }
    }
    const jump = Math.hypot(b.x - a.x, b.z - a.z) > TELEPORT_DIST || ((a.flags ^ b.flags) & PF.ALIVE) !== 0;
    const span = Math.max(1, b.t - a.t) / 1000;
    if (jump) {
      const use = k >= 1 ? b : a;
      this.x = use.x; this.y = use.y; this.z = use.z;
      this.yaw = use.yaw; this.pitch = use.pitch;
      this.vx = 0; this.vz = 0;
      this.flags = use.flags;
      this.held = use.held;
    } else {
      this.x = a.x + (b.x - a.x) * k;
      this.y = a.y + (b.y - a.y) * k;
      this.z = a.z + (b.z - a.z) * k;
      this.yaw = lerpAngle(a.yaw, b.yaw, Math.min(k, 1));
      this.pitch = a.pitch + (b.pitch - a.pitch) * Math.min(k, 1);
      this.vx = (b.x - a.x) / span;
      this.vz = (b.z - a.z) / span;
      const use = k >= 0.5 ? b : a;
      this.flags = use.flags;
      this.held = use.held;
    }

    const alive = this.alive;
    if (alive && !this.wasAlive) this.visual.respawn();
    this.wasAlive = alive;
    this.sinceShot += dt;

    // footsteps: one per stride while running on the ground (crouch-walking is silent)
    const speed = Math.hypot(this.vx, this.vz);
    if (alive && !jump && (this.flags & PF.GROUND) !== 0 && (this.flags & PF.CROUCH) === 0 && speed > 1.5) {
      this.stride += speed * dt;
      if (this.stride >= 1.9) {
        this.stride = 0;
        this.stepDue = true;
      }
    } else {
      this.stride = Math.max(this.stride, 1.2);
    }

    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      if (this.reloadT >= 1 || (this.flags & PF.RELOAD) === 0 && this.reloadT > 0.3) this.reloadT = -1;
    }

    const p = this.pose;
    p.x = this.x; p.y = this.y; p.z = this.z;
    p.yaw = this.yaw; p.pitch = this.pitch;
    p.vx = this.vx; p.vz = this.vz;
    p.grounded = (this.flags & PF.GROUND) !== 0;
    p.crouching = (this.flags & PF.CROUCH) !== 0;
    p.sprinting = (this.flags & PF.SPRINT) !== 0;
    p.aiming = (this.flags & PF.AIM) !== 0;
    p.reload = this.reloadT;
    p.alive = alive;
    p.held = heldFromCode(this.held);
    p.hanging = alive && (this.flags & PF.BALLOON) !== 0;
    p.skydive = alive && (this.flags & PF.SKYDIVE) !== 0;
    p.flip = -1; // the double jump is a straight second hop (no flip)
    // healing (the item is not sent for other players: they all use the first-aid motion)
    p.heal = alive && (this.flags & PF.HEALING) !== 0 ? 1 : -1;
    // roll / ledge progress: timed here from when the flag came on
    this.rollT = alive && (this.flags & PF.ROLL) !== 0 ? Math.min(1, Math.max(0, this.rollT) + dt / ROLL.time) : -1;
    this.climbT = alive && (this.flags & PF.CLIMB) !== 0 ? Math.min(1, Math.max(0, this.climbT) + dt / LEDGE.time) : -1;
    p.roll = this.rollT;
    p.climb = this.climbT;
    // the ink outline only within 28 m (far away it is a few pixels, and it doubles the cost)
    const dx = this.x - cameraPos.x, dz = this.z - cameraPos.z;
    this.visual.setOutline?.(dx * dx + dz * dz < 28 * 28);
    this.visual.update(dt, p, visible);

    // on the transport (JUMP OFF THE PORCH) nobody is in the world yet
    const riding = (this.flags & PF.RIDING) !== 0;
    if (riding !== this.wasRiding) {
      this.wasRiding = riding;
      this.visual.setVisible(!riding);
    }

    // name tag
    const tag = this.tag;
    const dist = Math.hypot(cameraPos.x - this.x, cameraPos.z - this.z);
    tag.visible = alive && !riding && (this.friendly ? dist < 90 : dist < 28);
    if (tag.visible) tag.position.set(this.x, this.y + (p.crouching ? 1.5 : 2.08), this.z);
  }

  dispose(): void {
    this.visual.dispose();
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
    this.tag.removeFromParent();
  }
}
