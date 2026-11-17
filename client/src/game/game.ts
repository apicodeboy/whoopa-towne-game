import * as THREE from 'three';
import { decodeAppearance, type Appearance } from '@shared/config/appearance';
import { CREWS, type TeamId } from '@shared/config/crews';
import { INTERP_DELAY_MS, PLAYER, TICK_DT, TURF } from '@shared/config/game';
import { BAGS, HEAL_KINDS, ITEM, PORCH } from '@shared/config/porch';
import { AMMO_NAMES, AMMO_TYPES, SLOT_PRIMARY_B, THROWABLES, THROWABLE_IDS, WEAPONS, WEAPON_IDS, type Loadout, type WeaponDef } from '@shared/config/weapons';
import type { MapDef } from '@shared/map/types';
import { DEG, Rng, clamp, wrapAngle, type Vec3 } from '@shared/math';
import {
  EV, PF, PHASE, quantizeInput, type MatchEndMsg, type RosterEntry, type SnapPlayer, type Snapshot,
} from '@shared/protocol';
import { STAGE_RIOT, transportAt } from '@shared/sim/porch';
import {
  HIT_PLAYER, HIT_WORLD, makeShotResult, shotSeed, spreadDirection, traceShot, type ShotTarget,
} from '@shared/sim/combat';
import { stepProjectile, type Projectile } from '@shared/sim/game';
import type { PhysicsWorld } from '@shared/sim/physics';
import {
  AIR_BALLOON, AIR_RIDING, BTN, currentSpread, eyeHeight, magOf, makeInputCmd, makePlayerState, playerStateFromArray, reserveOf, weaponInSlot,
  type InputCmd, type PlayerState, type StepActions,
} from '@shared/sim/player';
import type { Assets } from './assets';
import type { SettingsStore } from '../core/settings';
import type { InputManager } from '../input/inputManager';
import type { Session } from '../net/session';
import { Hud, makeHudState, type HudPlayerRow, type HudState } from '../ui/hud';
import { PorchHud, type PorchHudState } from '../ui/porchHud';
import { CameraRig } from './camera';
import { makePose, type CharacterPose, type CharacterVisual } from './characters/characterTypes';
import { ProceduralCharacter } from './characters/proceduralCharacter';
import { Effects } from './fx/effects';
import { PorchWorld, makeBalloon, swayBalloon } from './porch/porchWorld';
import { RiotCrowd } from './porch/riotCrowd';
import { Predictor } from './predictor';
import { RemotePlayer } from './remotePlayer';
import type { GameRenderer } from './renderer';
import type { Stage } from './stage';

/** Sound hooks. Implemented by the audio engine; optional so the game runs silent without it. */
export interface GameAudio {
  setListener(pos: THREE.Vector3, yaw: number): void;
  gunshot(weapon: number, pos: THREE.Vector3 | null, own: boolean): void;
  impact(pos: THREE.Vector3): void;
  reload(pos: THREE.Vector3 | null): void;
  reloadDone(): void;
  dryFire(): void;
  swap(): void;
  footstep(pos: THREE.Vector3 | null, sprint: boolean): void;
  jump(): void;
  land(speed: number): void;
  hitMarker(kind: 'hit' | 'head' | 'kill'): void;
  hurt(amount: number): void;
  death(): void;
  respawn(): void;
  throwItem(pos: THREE.Vector3 | null): void;
  bounce(pos: THREE.Vector3): void;
  explosion(pos: THREE.Vector3): void;
  smoke(pos: THREE.Vector3): void;
  zone(kind: 'captured' | 'lost' | 'neutral'): void;
  phase(kind: 'start' | 'win' | 'lose' | 'draw' | 'tick'): void;
  pop?(pos: THREE.Vector3 | null): void;
  loot?(): void;
  riot?(): void;
  crowd?(level: number): void;
}

export interface GameDeps {
  stage: Stage;
  uiRoot: HTMLElement;
  settings: SettingsStore;
  input: InputManager;
  session: Session;
  loadout: Loadout;
  audio?: GameAudio;
  /** Builds a character visual (lets the art pass swap in skinned models). */
  characterFactory?: (team: TeamId, seed: number, look?: Appearance) => CharacterVisual;
  /** Builds characters' bodies ahead of time (so players appearing later cost nothing). */
  prewarmLooks?: (looks: Appearance[]) => void;
  /** Models (JUMP OFF THE PORCH draws loose guns with them). */
  assets?: Assets;
}

export interface GameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  corrections: number;
}

interface VisualProjectile {
  p: Projectile;
  mesh: THREE.Mesh;
}

const MAX_TICKS_PER_FRAME = 6;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _xz = { x: 0, z: 0 };

/** "Kingpin AR" / "30 Rifle Ammo" / "3x Bandage" for prompts. */
function itemName(kind: number, code: number, count: number): string {
  if (kind === ITEM.WEAPON) return (WEAPONS[WEAPON_IDS[code]]?.name ?? 'Weapon').toUpperCase();
  if (kind === ITEM.AMMO) return `${count} ${AMMO_NAMES[AMMO_TYPES[code]] ?? 'Ammo'}`.toUpperCase();
  if (kind === ITEM.HEAL) return `${count}× ${PORCH.heals[HEAL_KINDS[code]]?.name ?? 'Heal'}`.toUpperCase();
  if (kind === ITEM.ARMOR) return `ARMOR (${code})`;
  if (kind === ITEM.THROWABLE) return `${count}× ${THROWABLES[THROWABLE_IDS[code]]?.name ?? 'Throwable'}`.toUpperCase();
  return 'ITEM';
}

/** Generous bounds of one character (covers a dead body, its shadow and a frame of movement). */
const _sphere = new THREE.Sphere(new THREE.Vector3(), 3);

/**
 * The in-match client: renders the world, predicts the local player, interpolates everyone
 * else from server snapshots, turns match events into effects, and feeds the HUD.
 * It talks to a Session and does not care whether the match is local or online.
 */
export class Game {
  readonly gfx: GameRenderer;
  readonly rig: CameraRig;
  readonly map: MapDef;
  readonly phys: PhysicsWorld;
  readonly predictor = new Predictor();
  readonly view = { yaw: 0, pitch: 0 };
  readonly stats: GameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, corrections: 0 };
  readonly hud: Hud;
  readonly hudState: HudState = makeHudState();
  readonly effects: Effects;
  readonly remotes = new Map<number, RemotePlayer>();
  readonly session: Session;
  /** Loadout the simulation is currently using for us (changes on respawn). */
  loadout: Loadout;
  /** Latest decoded snapshot. */
  snap: Snapshot | null = null;
  /** Called every rendered frame after the simulation. */
  onFrame: ((dt: number) => void) | null = null;
  /** Fired when the pause button (Esc / Start) is pressed. */
  onPause: (() => void) | null = null;
  /** Fired once when the match reaches its final whistle. */
  onMatchOver: (() => void) | null = null;
  /** JUMP OFF THE PORCH: the player asked to leave after being eliminated. */
  onLeaveRequest: (() => void) | null = null;
  paused = false;
  /** JUMP OFF THE PORCH visuals and HUD (null in the crew modes). */
  readonly porchWorld: PorchWorld | null = null;
  /** JUMP OFF THE PORCH: the riot crowd along the edge of the safe area. */
  private crowd: RiotCrowd | null = null;
  readonly porchHud: PorchHud | null = null;
  private mySquad = 0;
  private spectateIdx = -1;
  private balloons = new Map<number, THREE.Group>();
  private myBalloon: THREE.Group | null = null;
  private promptTarget = '';
  private fireWas = false;

  private deps: GameDeps;
  private stage: Stage;
  private localChar: CharacterVisual;
  private pose: CharacterPose = makePose();
  private cmd: InputCmd = makeInputCmd();
  private act: StepActions | null = null;
  private serverState: PlayerState = makePlayerState();
  private camOrigin: Vec3 = { x: 0, y: 0, z: 0 };
  private renderPos: Vec3 = { x: 0, y: 0, z: 0 };
  private dir: Vec3 = { x: 0, y: 0, z: 0 };
  private visY = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = false;
  private time = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private roster = new Map<number, RosterEntry>();
  private me: SnapPlayer | null = null;
  private myLife = -1;
  private alive = false;
  private myTeam: TeamId = 0;
  private killer = '';
  private recoilP = 0;
  private spawnYaw = 0;
  /** Button presses latched until the next simulation tick consumes them (so quick taps are never lost). */
  private latched = 0;
  private stepTimer = 0;
  private shotRng = new Rng(1);
  private shot = makeShotResult();
  private frustum = new THREE.Frustum();
  private probe = makeShotResult();
  private targets: ShotTarget[] = [];
  private targetPool: ShotTarget[] = [];
  private projectiles = new Map<number, VisualProjectile>();
  private grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3c4a2f, roughness: 0.6, emissive: 0x220000 });
  private smokeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10);
  private smokeMat = new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.5 });
  private lastPhase = -1;
  private warmupTick = -1;
  private onResize = () => this.resize();
  private unsubSettings: () => void;
  private unsubDevice: () => void;
  private autoFireT = 0;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.session = deps.session;
    this.loadout = { ...deps.loadout };
    this.stage = deps.stage;
    this.map = deps.stage.map;
    this.phys = deps.stage.phys;
    this.gfx = deps.stage.gfx;
    this.rig = new CameraRig(1);
    this.rig.baseFov = deps.settings.values.fov;
    this.rig.side = deps.settings.values.rightShoulder ? 1 : -1;

    this.effects = new Effects();
    this.gfx.scene.add(this.effects.group);
    this.applyEffectDensity();
    this.unsubSettings = deps.settings.onChange(() => this.applyEffectDensity());

    for (const r of this.session.roster) this.roster.set(r.idx, r);
    // build every player's body now, while the match is starting, not mid-game when they appear
    deps.prewarmLooks?.(this.session.roster.flatMap((r) => (r.look ? [decodeAppearance(r.look)] : [])));
    const mine = this.roster.get(this.session.myIdx);
    this.mySquad = mine?.squad ?? mine?.team ?? 0;
    // battle royale: your squad is "blue", everyone else "red" (name tags, arm bands, minimap)
    this.myTeam = this.session.mode === 'porch' ? 0 : mine ? mine.team : 0;
    this.localChar = this.makeCharacter(this.myTeam, this.session.myIdx, mine?.look ? decodeAppearance(mine.look) : undefined);
    this.gfx.scene.add(this.localChar.root);
    this.localChar.setVisible(false);

    this.hud = new Hud(deps.uiRoot, this.map);
    this.hud.setDevice(deps.input.device);
    this.unsubDevice = deps.input.onDeviceChange((d) => this.hud.setDevice(d));
    this.hudState.mode = this.session.mode;
    this.hudState.myTeam = this.myTeam;
    this.hudState.loadout = this.loadout;
    for (const z of this.stage.world.zones) z.group.visible = this.session.mode === 'turf';

    this.session.handlers.onSnapshot = (s) => this.handleSnapshot(s);
    this.session.handlers.onRoster = (r) => this.setRoster(r);

    if (this.session.mode === 'porch' && this.session.porch) {
      this.porchWorld = new PorchWorld(this.session.porch, deps.assets ?? null);
      this.gfx.scene.add(this.porchWorld.group);
      this.crowd = new RiotCrowd(this.phys, this.map);
      this.gfx.scene.add(this.crowd.group);
      this.porchHud = new PorchHud(deps.uiRoot, {
        spectate: () => this.nextSpectate(),
        leave: () => this.onLeaveRequest?.(),
      });
      this.porchHud.setVoice(deps.settings.values.volume > 0);
      deps.input.porchSlots = true;
      this.session.handlers.onMatchEnd = (msg: MatchEndMsg) => this.porchHud?.showResult(msg.players, this.session.myIdx, msg.winner);
    }

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  /** Color side of a player as seen from here (battle royale: my squad vs everyone else). */
  private visTeam(r: RosterEntry): TeamId {
    if (this.session.mode === 'porch') return (r.squad ?? r.team) === this.mySquad ? 0 : 1;
    return r.team;
  }

  private makeCharacter(team: TeamId, seed: number, look?: Appearance): CharacterVisual {
    return this.deps.characterFactory
      ? this.deps.characterFactory(team, seed, look)
      : new ProceduralCharacter(team, seed, look);
  }

  private applyEffectDensity(): void {
    const s = this.deps.settings.values;
    this.effects.density = s.performanceMode ? 0.35 : s.quality === 'low' ? 0.5 : s.quality === 'medium' ? 0.8 : 1;
  }

  // ------------------------------------------------------------------ lifecycle
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const { width, height } = this.gfx.resize();
    this.rig.setAspect(width / height);
    this.hud.onResize();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = clamp((now - this.lastFrame) / 1000, 0, 0.1);
    this.lastFrame = now;
    this.update(dt);
    this.stats.frameMs = performance.now() - now;
  };

  // ------------------------------------------------------------------ roster
  setRoster(list: RosterEntry[]): void {
    const fresh = list.filter((r) => r.look && this.roster.get(r.idx)?.look !== r.look);
    this.roster.clear();
    for (const r of list) this.roster.set(r.idx, r);
    if (fresh.length) this.deps.prewarmLooks?.(fresh.map((r) => decodeAppearance(r.look)));
    // drop visuals of players who left
    for (const [idx, rp] of this.remotes) {
      const r = this.roster.get(idx);
      if (!r || r.name !== rp.name || this.visTeam(r) !== rp.team || r.look !== rp.look) {
        rp.dispose();
        this.remotes.delete(idx);
      }
    }
  }

  private nameOf(idx: number): string {
    return this.roster.get(idx)?.name ?? 'Unknown';
  }

  private teamOf(idx: number): TeamId {
    const r = this.roster.get(idx);
    return r ? this.visTeam(r) : 0;
  }

  private ensureRemote(idx: number): RemotePlayer | null {
    let rp = this.remotes.get(idx);
    if (rp) return rp;
    const r = this.roster.get(idx);
    if (!r) return null;
    const team = this.visTeam(r);
    const visual = this.makeCharacter(team, idx, r.look ? decodeAppearance(r.look) : undefined);
    this.gfx.scene.add(visual.root);
    rp = new RemotePlayer(idx, r.name, team, r.bot, visual, team === this.myTeam);
    rp.look = r.look;
    this.gfx.scene.add(rp.tag);
    this.remotes.set(idx, rp);
    return rp;
  }

  // ------------------------------------------------------------------ snapshots
  private handleSnapshot(snap: Snapshot): void {
    this.snap = snap;
    // Events first: a SPAWN event tells us the loadout to predict the new life with.
    for (const e of snap.events) this.handleEvent(e);

    const myIdx = this.session.myIdx;
    this.me = null;
    for (const sp of snap.players) {
      if (sp.idx === myIdx) {
        this.me = sp;
        continue;
      }
      this.ensureRemote(sp.idx)?.push(sp, snap.t);
    }
    if (this.remotes.size > snap.players.length - (this.me ? 1 : 0)) {
      for (const [idx, rp] of this.remotes) {
        if (!snap.players.some((p) => p.idx === idx)) {
          rp.dispose();
          this.remotes.delete(idx);
        }
      }
    }

    if (snap.self && this.me) {
      const frozen = snap.phase !== PHASE.PLAYING;
      playerStateFromArray(snap.self, this.serverState);
      const aliveNow = (this.me.flags & PF.ALIVE) !== 0;
      if (snap.life !== this.myLife) {
        // (re)spawned: adopt the server state outright and replay anything sent since
        this.myLife = snap.life;
        this.predictor.reconcile(snap.ack, this.serverState, this.phys, this.loadout, frozen, true);
        this.view.yaw = this.spawnYaw;
        this.view.pitch = 0;
        this.recoilP = 0;
        this.visY = this.predictor.state.y;
        this.deps.input.syncSlot(this.predictor.state.slot);
        this.localChar.respawn();
        if (!this.alive) this.deps.audio?.respawn();
        this.killer = '';
      } else if (aliveNow) {
        if (this.predictor.reconcile(snap.ack, this.serverState, this.phys, this.loadout, frozen)) this.stats.corrections++;
      } else {
        this.predictor.reconcile(snap.ack, this.serverState, this.phys, this.loadout, true, true);
      }
      this.alive = aliveNow;
    }

    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      this.onPhase(snap);
    }
  }

  private onPhase(snap: Snapshot): void {
    const audio = this.deps.audio;
    if (snap.phase === PHASE.PLAYING) {
      if (!this.porchHud) this.hud.announce('GO!', 'good', 1.4);
      audio?.phase('start');
    } else if (snap.phase === PHASE.ENDED && this.porchHud) {
      audio?.phase(snap.porch && snap.porch.place === 1 ? 'win' : 'lose');
      this.onMatchOver?.();
    } else if (snap.phase === PHASE.ENDED) {
      // the final scoreboard shows the result; here just the sting
      const [a, b] = snap.scores;
      if (a === b) audio?.phase('draw');
      else audio?.phase((a > b ? 0 : 1) === this.myTeam ? 'win' : 'lose');
      this.onMatchOver?.();
    }
  }

  // ------------------------------------------------------------------ events
  private handleEvent(e: number[]): void {
    const myIdx = this.session.myIdx;
    const audio = this.deps.audio;
    switch (e[0]) {
      case EV.SHOT: {
        const shooter = e[1];
        if (shooter === myIdx) break; // already predicted locally
        const rp = this.remotes.get(shooter);
        const origin = _v.set(e[3] / 100, e[4] / 100, e[5] / 100);
        if (rp) {
          rp.visual.getMuzzle(_v2);
          // only trust the visual muzzle if the character is roughly where the shot came from
          if (_v2.distanceToSquared(origin) < 9) origin.copy(_v2);
          rp.visual.shot();
          rp.sinceShot = 0;
        }
        const n = e[6];
        const color = this.teamOf(shooter) === 0 ? 0xbfd9ff : 0xffd0b0;
        for (let k = 0; k < n; k++) {
          const o = 7 + k * 4;
          _v2.set(e[o] / 100, e[o + 1] / 100, e[o + 2] / 100);
          this.effects.tracer(origin, _v2, color);
          if (e[o + 3] === HIT_WORLD) {
            _n.copy(origin).sub(_v2).normalize();
            this.effects.impact(_v2, _n);
            if (k === 0) audio?.impact(_v2);
          } else if (e[o + 3] === HIT_PLAYER) {
            this.effects.hitPuff(_v2);
          }
        }
        this.effects.muzzleFlash(origin);
        audio?.gunshot(e[2], origin, false);
        break;
      }
      case EV.HIT: {
        const shooter = e[1], victim = e[2], dmg = e[3], head = e[4] === 1, killed = e[5] === 1;
        if (shooter === myIdx && victim !== myIdx) {
          const kind = killed ? 'kill' : head ? 'head' : 'hit';
          this.hud.hitMarker(kind);
          audio?.hitMarker(kind);
        }
        if (victim === myIdx) {
          this.hud.damageFrom(e[6] / 100, e[7] / 100, dmg);
          this.rig.shake(0.25 + dmg / 90);
          this.deps.input.rumble(Math.min(1, 0.35 + dmg / 80), 0.5, 150);
          this.localChar.hit();
          audio?.hurt(dmg);
        } else {
          this.remotes.get(victim)?.visual.hit();
        }
        break;
      }
      case EV.KILL: {
        const killer = e[1], victim = e[2];
        const kTeam = killer >= 0 ? this.teamOf(killer) : -1;
        const mine = killer === myIdx || victim === myIdx;
        this.hud.killFeed(
          killer >= 0 && killer !== victim ? this.nameOf(killer) : '', killer !== victim ? (kTeam as TeamId | -1) : -1,
          this.nameOf(victim), this.teamOf(victim), e[3], e[4] === 1, mine,
        );
        // fall away from the killer
        let dx = 0, dz = 1;
        const from = killer === myIdx ? this.predictor.state : this.remotes.get(killer);
        const to = victim === myIdx ? this.predictor.state : this.remotes.get(victim);
        if (from && to) {
          dx = to.x - from.x;
          dz = to.z - from.z;
        }
        if (killer === myIdx && victim !== myIdx) this.hud.killConfirm(this.nameOf(victim), this.teamOf(victim), e[4] === 1);
        if (victim === myIdx) {
          this.killer = killer >= 0 && killer !== myIdx ? this.nameOf(killer) : '';
          this.localChar.die(dx, dz);
          this.rig.shake(0.6);
          audio?.death();
        } else {
          this.remotes.get(victim)?.visual.die(dx, dz);
        }
        break;
      }
      case EV.SPAWN: {
        if (e[1] === myIdx) this.spawnYaw = e[5] / 1000;
        if (e[1] === myIdx && e.length >= 9) {
          this.loadout = {
            primary: WEAPON_IDS[e[6]] ?? this.loadout.primary,
            secondary: WEAPON_IDS[e[7]] ?? this.loadout.secondary,
            throwable: THROWABLE_IDS[e[8]] ?? this.loadout.throwable,
          };
          this.hudState.loadout = this.loadout;
        }
        break;
      }
      case EV.THROW: {
        const type = e[3];
        const mesh = new THREE.Mesh(type === 0 ? this.grenadeGeo : this.smokeGeo, type === 0 ? this.grenadeMat : this.smokeMat);
        mesh.castShadow = true;
        const p: Projectile = {
          id: e[1], owner: e[2], type,
          x: e[4] / 100, y: e[5] / 100, z: e[6] / 100,
          vx: e[7] / 100, vy: e[8] / 100, vz: e[9] / 100,
          fuse: 10, resting: false,
        };
        mesh.position.set(p.x, p.y, p.z);
        this.gfx.scene.add(mesh);
        this.projectiles.set(p.id, { p, mesh });
        if (e[2] !== myIdx) {
          const rp = this.remotes.get(e[2]);
          rp?.visual.throwItem();
          audio?.throwItem(rp ? _v.set(rp.x, rp.y + 1.4, rp.z) : null);
        }
        break;
      }
      case EV.EXPLODE: {
        const vp = this.projectiles.get(e[1]);
        if (vp) {
          vp.mesh.removeFromParent();
          this.projectiles.delete(e[1]);
        }
        _v.set(e[3] / 100, e[4] / 100, e[5] / 100);
        if (e[2] === 0) {
          this.effects.explosion(_v);
          const st = this.predictor.state;
          const d = Math.hypot(st.x - _v.x, st.y - _v.y, st.z - _v.z);
          this.rig.shake(clamp(1.3 - d / 22, 0, 1.1));
          if (d < 25) this.deps.input.rumble(clamp(1.2 - d / 25, 0, 1), 0.8, 280);
          audio?.explosion(_v);
        } else {
          _v.y += 0.2;
          this.effects.smoke(_v);
          audio?.smoke(_v);
        }
        break;
      }
      case EV.ZONE: {
        const zone = this.map.zones[e[1]];
        const team = e[2] as TeamId;
        if (zone) {
          this.hud.announce(`${CREWS[team].name} took ${zone.name}`, team === 0 ? 'crew0' : 'crew1', 2.6);
          audio?.zone(team === this.myTeam ? 'captured' : 'lost');
        }
        break;
      }
      case EV.BAG_OPEN:
        this.porchWorld?.openBag(e[1]);
        break;
      case EV.PICKUP_ADD:
        this.porchWorld?.addPickup(e[1], e[2], e[3], e[4], e[5] / 100, e[6] / 100, e[7] / 100);
        break;
      case EV.PICKUP_GONE:
        this.porchWorld?.removePickup(e[1]);
        break;
      case EV.LOOT:
        if (e[1] === myIdx) {
          this.porchHud?.loot(e[2], e[3], e[4]);
          audio?.loot?.();
        }
        break;
      case EV.TOUCHDOWN: {
        const at = e[1] === myIdx ? _v.set(this.predictor.state.x, this.predictor.state.y, this.predictor.state.z) : this.remotes.get(e[1]);
        if (at) {
          _v2.set(at.x, at.y, at.z);
          this.porchWorld?.pop(_v2);
          audio?.pop?.(e[1] === myIdx ? null : _v2);
        }
        this.dropBalloon(e[1]);
        // everybody lands empty-handed: point them at the bookbags
        if (e[1] === myIdx && this.porchHud) {
          const st = this.predictor.state;
          if (!st.wA && !st.wB && !st.wH) this.porchHud.banner('NO WEAPON — SEARCH BOOKBAGS', 'info', 'landed', 4);
        }
        break;
      }
      case EV.STAGE:
        if (e[1] >= 3) audio?.riot?.();
        break;
      case EV.HEALED:
        if (e[1] === myIdx) audio?.reloadDone();
        break;
      case EV.RELOAD: {
        if (e[1] !== myIdx) {
          const rp = this.remotes.get(e[1]);
          if (rp) {
            rp.startReload();
            audio?.reload(_v.set(rp.x, rp.y + 1.2, rp.z));
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ frame
  /** One rendered frame. Public so tests can drive the game deterministically. */
  update(dt: number): void {
    const { input, settings, audio } = this.deps;
    this.time += dt;
    const snap = this.snap;
    const phase = snap ? snap.phase : PHASE.WARMUP;
    const st = this.predictor.state;

    // ---- input & view ----
    input.ctx.aiming = st.aiming === 1 && this.alive;
    input.ctx.zoomScale = this.rig.zoomScale;
    input.ctx.assistScale = this.aimAssistScale();
    const f = input.update(dt);
    if (f.pause) this.onPause?.();
    // touch auto-fire: shoot once the reticle has rested on an enemy for a moment
    if (settings.values.autoFire && input.device === 'touch' && this.alive && this.hudState.onTarget && phase === PHASE.PLAYING) {
      this.autoFireT += dt;
      if (this.autoFireT > 0.07) f.fire = true;
    } else {
      this.autoFireT = 0;
    }
    input.touch?.setCrouchLit(input.wantCrouch);
    if (!this.paused) {
      this.view.yaw = wrapAngle(this.view.yaw + f.lookYaw);
      this.view.pitch = clamp(this.view.pitch + f.lookPitch, -PLAYER.maxPitch, PLAYER.maxPitch);
      if (f.swapShoulder) this.rig.swapShoulder();
    }
    this.recoilP *= Math.exp(-dt * 7);
    if (!this.paused) this.latched |= this.buttonBits();

    // ---- fixed-rate simulation ----
    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.tick();
      this.accumulator -= TICK_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0;

    // ---- network: deliver snapshots (may reconcile the prediction) ----
    this.session.update(dt);
    const alpha = this.accumulator / TICK_DT;

    // ---- present the local player ----
    this.predictor.decayError(dt);
    this.predictor.renderPosition(alpha, this.renderPos);
    const dy = this.renderPos.y - this.visY;
    if (Math.abs(dy) > 0.7 || !st.grounded) this.visY = this.renderPos.y;
    else this.visY += dy * Math.min(1, dt * 20);
    const riding = !!this.porchWorld && this.alive && st.air === AIR_RIDING;
    if (riding && this.session.porch) {
      // aboard the blimp: ride along with it (the server moves riders; drawing it from the clock is smoother)
      const pi = this.session.porch;
      const takeoff = snap?.porch && snap.porch.takeoff >= 0 ? snap.porch.takeoff : Infinity;
      transportAt(pi.route, pi.speed, takeoff, this.session.serverTime(), _xz);
      this.renderPos.x = _xz.x;
      this.renderPos.z = _xz.z;
      // hanging under the gondola, so the camera looks around under the blimp and out over the town
      this.renderPos.y = this.visY = pi.altitude - 7;
    }
    let spectating = false;
    if (this.porchWorld && !this.alive && this.myLife >= 0) {
      const t = this.spectateTarget();
      if (t) {
        spectating = true;
        this.renderPos.x = t.x;
        this.renderPos.y = this.visY = t.y;
        this.renderPos.z = t.z;
      }
      // fire switches who you watch
      const fire = this.deps.input.frame.fire;
      if (fire && !this.fireWas) {
        if (t) this.nextSpectate();
        this.porchHud?.hideOut();
      }
      this.fireWas = fire;
    }

    const aimYaw = this.view.yaw;
    const aimPitch = clamp(this.view.pitch + this.recoilP, -PLAYER.maxPitch, PLAYER.maxPitch);
    const weapon = weaponInSlot(st, st.slot);
    this.rig.baseFov = settings.values.fov;
    this.rig.aimFovMult = weapon ? weapon.aimFov : 1;
    this.rig.update(
      dt, this.renderPos.x, this.visY, this.renderPos.z, aimYaw, aimPitch,
      (this.alive || spectating) && st.aiming === 1 && !spectating, this.alive && st.crouching === 1 && !spectating, this.alive && st.sprinting === 1, this.phys,
    );

    const p = this.pose;
    p.x = this.renderPos.x; p.y = this.visY; p.z = this.renderPos.z;
    p.yaw = aimYaw; p.pitch = aimPitch;
    p.vx = st.vx; p.vz = st.vz;
    p.grounded = st.grounded === 1; p.crouching = st.crouching === 1;
    p.sprinting = st.sprinting === 1; p.aiming = st.aiming === 1;
    p.reload = weapon && st.reloadT > 0 ? 1 - st.reloadT / weapon.reloadTime : -1;
    p.alive = this.alive;
    p.held = st.slot === 2 ? (THROWABLE_IDS[st.thr - 1] ?? 'none') : !weapon || weapon.id === 'fists' ? 'none' : weapon.id;
    p.hanging = !!this.porchWorld && this.alive && st.air === AIR_BALLOON;
    if (this.myLife >= 0) {
      this.localChar.update(dt, p);
      this.localChar.setVisible((this.rig.dist > 0.55 || !this.alive) && !riding && !spectating);
    }
    // hanging from a balloon
    const wantBalloon = !!this.porchWorld && this.alive && st.air === AIR_BALLOON;
    if (wantBalloon && !this.myBalloon) {
      this.myBalloon = makeBalloon();
      this.localChar.root.add(this.myBalloon);
    } else if (!wantBalloon && this.myBalloon) {
      this.myBalloon.removeFromParent();
      this.myBalloon = null;
    }

    // footsteps
    if (this.alive && st.grounded && Math.hypot(st.vx, st.vz) > 1.5) {
      this.stepTimer -= dt * (st.sprinting ? 1.35 : st.crouching ? 0.6 : 1);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.36;
        if (!st.crouching) audio?.footstep(null, st.sprinting === 1);
      }
    } else {
      this.stepTimer = Math.min(this.stepTimer, 0.12);
    }

    // ---- everyone else, rendered slightly in the past ----
    const rt = this.session.serverTime() - INTERP_DELAY_MS;
    const camPos = this.rig.camera.position;
    // characters outside the view keep moving but skip their animation work
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(_m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const rp of this.remotes.values()) {
      _sphere.center.set(rp.x, rp.y + 0.9, rp.z);
      rp.update(dt, rt, camPos, this.frustum.intersectsSphere(_sphere));
      if (audio && rp.takeStep()) audio.footstep(_v.set(rp.x, rp.y, rp.z), rp.sprinting);
      if (this.porchWorld) {
        const ballooning = rp.alive && (rp.flags & PF.BALLOON) !== 0;
        const has = this.balloons.get(rp.idx);
        if (ballooning && !has) {
          const b = makeBalloon();
          rp.visual.root.add(b);
          this.balloons.set(rp.idx, b);
        } else if (!ballooning && has) this.dropBalloon(rp.idx);
        const b = this.balloons.get(rp.idx);
        if (b) swayBalloon(b, this.time + rp.idx * 1.3);
      }
    }
    if (this.myBalloon) swayBalloon(this.myBalloon, this.time);

    // ---- projectiles, effects, world ----
    for (const vp of this.projectiles.values()) {
      vp.mesh.position.set(vp.p.x, vp.p.y, vp.p.z);
      vp.mesh.rotation.x += dt * 9;
      vp.mesh.rotation.z += dt * 6;
    }
    this.effects.update(dt);
    this.updateZoneMarkers();
    this.stage.world.update(dt, this.time, camPos);
    if (this.porchWorld && snap?.porch) {
      this.porchWorld.zone = snap.porch.zone;
      this.porchWorld.next = snap.porch.next;
    }
    this.porchWorld?.update(dt, this.session.serverTime(), snap?.porch ? snap.porch.takeoff : -1);
    if (this.crowd && snap?.porch) {
      // the crowd gathers through the first warning, then it is out in force
      const pz = snap.porch;
      const first = PORCH.riotPhases[0];
      const intensity = pz.stage < STAGE_RIOT ? 0
        : pz.stage === STAGE_RIOT && !pz.shrinking ? 0.3 + 0.7 * (1 - Math.min(1, pz.stageLeft / first.warn))
        : 1;
      const me = this.predictor.state;
      this.crowd.update(dt, this.time, pz.zone, camPos, { x: me.x, z: me.z }, intensity);
      audio?.crowd?.(this.crowd.nearness);
    }
    audio?.setListener(camPos, aimYaw);

    this.gfx.followShadow(this.renderPos.x, this.renderPos.z);
    this.gfx.render(this.rig.camera);

    // ---- HUD ----
    this.fillHud(phase, weapon, aimYaw, aimPitch);
    this.hud.update(this.hudState, dt);
    if (this.porchHud) this.updatePorchHud(dt, aimYaw, spectating);

    // warm-up countdown beeps
    if (snap && snap.phase === PHASE.WARMUP) {
      const n = Math.ceil(snap.timeLeft);
      if (n !== this.warmupTick && n > 0 && n <= 3) {
        this.hud.announce(String(n), 'neutral', 0.9);
        audio?.phase('tick');
      }
      this.warmupTick = n;
    }

    // ---- stats ----
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      const info = this.gfx.renderer.info.render;
      this.stats.drawCalls = info.calls;
      this.stats.triangles = info.triangles;
    }
    this.onFrame?.(dt);
  }

  /** One fixed tick: sample input into a command, predict it locally, send it to the server. */
  private tick(): void {
    const { input, audio } = this.deps;
    const f = input.frame;
    const cmd = this.cmd;
    const st = this.predictor.state;
    const snap = this.snap;
    const frozen = !snap || snap.phase !== PHASE.PLAYING;
    const active = !this.paused;

    cmd.seq = ++this.predictor.seq;
    cmd.mx = active ? f.moveX : 0;
    cmd.mz = active ? f.moveZ : 0;
    cmd.yaw = this.view.yaw;
    cmd.pitch = clamp(this.view.pitch + this.recoilP, -PLAYER.maxPitch, PLAYER.maxPitch);
    cmd.buttons = active ? this.buttonBits() | this.latched : 0;
    this.latched = 0;
    cmd.slot = input.slot;
    this.rig.positionFor(st.x, st.y, st.z, cmd.yaw, cmd.pitch, this.camOrigin);
    cmd.ox = this.camOrigin.x; cmd.oy = this.camOrigin.y; cmd.oz = this.camOrigin.z;
    cmd.rt = Math.max(0, this.session.serverTime() - INTERP_DELAY_MS);
    quantizeInput(cmd);

    if (this.alive && this.myLife >= 0) {
      const act = this.predictor.step(cmd, this.phys, this.loadout, frozen);
      this.act = act;
      if (st.slot !== input.slot) input.syncSlot(st.slot);
      if (act.shot) this.predictShot(cmd, act);
      if (act.threw) {
        this.localChar.throwItem();
        audio?.throwItem(null);
      }
      if (act.reloadStart) audio?.reload(null);
      if (act.reloadDone) audio?.reloadDone();
      if (act.dryFire) audio?.dryFire();
      if (act.swapped) audio?.swap();
      if (act.jumped) audio?.jump();
      if (act.landed) audio?.land(act.landSpeed);
    } else {
      this.predictor.record(cmd);
    }
    this.session.sendInput(cmd);

    // grenades in flight: same deterministic stepping the server does
    for (const vp of this.projectiles.values()) {
      const wasResting = vp.p.resting;
      const vy = vp.p.vy;
      stepProjectile(vp.p, TICK_DT, this.phys);
      if (!wasResting && Math.abs(vp.p.vy - vy) > 3 && vy < -2) audio?.bounce(_v.set(vp.p.x, vp.p.y, vp.p.z));
      if (vp.p.fuse < 0) {
        // never confirmed by the server (should not happen): clean up
        vp.mesh.removeFromParent();
        this.projectiles.delete(vp.p.id);
      }
    }
  }

  /**
   * Aim assist for controllers and touch: look speed is scaled down a little while the
   * reticle is close to a visible enemy, which makes it easier to stay on target without
   * ever moving the aim for you. Returns 1 (no slowdown) for mouse players or when disabled.
   */
  private aimAssistScale(): number {
    const { input, settings } = this.deps;
    if (!settings.values.aimAssist || !this.alive || !(input.usingPad || input.device === 'touch')) return 1;
    const cam = this.rig.camera.position;
    const yaw = this.view.yaw, pitch = this.view.pitch + this.recoilP;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
    let scale = 1;
    for (const rp of this.remotes.values()) {
      if (rp.team === this.myTeam || !rp.alive) continue;
      const ty = rp.y + (rp.crouching ? 0.6 : 1.0);
      const dx = rp.x - cam.x, dy = ty - cam.y, dz = rp.z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1.5 || d > 70) continue;
      const cos = (dx * fx + dy * fy + dz * fz) / d;
      if (cos <= 0) continue;
      const ang = Math.acos(Math.min(1, cos));
      // the target's apparent half-width plus a small margin
      const window = Math.atan(0.6 / d) + 0.045;
      if (ang >= window) continue;
      if (!this.phys.lineOfSight(cam.x, cam.y, cam.z, rp.x, ty, rp.z)) continue;
      const strength = Math.pow(1 - ang / window, 0.6);
      scale = Math.min(scale, 1 - 0.55 * strength);
    }
    return scale;
  }

  /** Current held buttons as a command bitmask. */
  private buttonBits(): number {
    const input = this.deps.input;
    const f = input.frame;
    let b = 0;
    if (f.jump) b |= BTN.JUMP;
    if (f.sprint) b |= BTN.SPRINT;
    if (input.wantCrouch) b |= BTN.CROUCH;
    if (f.fire) b |= BTN.FIRE;
    if (f.aim) b |= BTN.AIM;
    if (f.reload) b |= BTN.RELOAD;
    if (f.throwBtn) b |= BTN.THROW;
    if (this.porchWorld) {
      if (f.use || (f.useOrHeal && this.promptTarget)) b |= BTN.USE;
      if (f.heal || (f.useOrHeal && !this.promptTarget)) b |= BTN.HEAL;
      if (f.drop) b |= BTN.DROP;
    }
    return b;
  }

  /** Enemy hitboxes as currently rendered on this screen. */
  private collectTargets(): ShotTarget[] {
    const targets = this.targets;
    for (const t of targets) this.targetPool.push(t);
    targets.length = 0;
    for (const rp of this.remotes.values()) {
      if (rp.team === this.myTeam || !rp.alive || (rp.flags & PF.PROTECTED) !== 0) continue;
      const t = this.targetPool.pop() ?? { id: 0, x: 0, y: 0, z: 0, crouching: false };
      t.id = rp.idx;
      t.x = rp.x; t.y = rp.y; t.z = rp.z;
      t.crouching = rp.crouching;
      targets.push(t);
    }
    return targets;
  }

  /** Instant feedback for our own shot: tracers, impacts, recoil. The server decides the damage. */
  private predictShot(cmd: InputCmd, act: StepActions): void {
    const w = weaponInSlot(this.predictor.state, act.shotSlot);
    if (!w) return;
    const st = this.predictor.state;
    const eyeX = st.x, eyeY = st.y + eyeHeight(st.crouching), eyeZ = st.z;
    const targets = this.collectTargets();
    this.shotRng.reseed(shotSeed(this.session.myIdx, act.shotSeed));
    this.localChar.getMuzzle(_v);
    if (_v.distanceToSquared(_v2.set(eyeX, eyeY, eyeZ)) > 4) _v.copy(_v2);
    const res = this.shot;
    for (let k = 0; k < w.pellets; k++) {
      spreadDirection(this.shotRng, cmd.yaw, cmd.pitch, act.shotSpread, this.dir);
      traceShot(this.phys, eyeX, eyeY, eyeZ, cmd.ox, cmd.oy, cmd.oz, this.dir.x, this.dir.y, this.dir.z, w.range, targets, res);
      _v2.set(res.ex, res.ey, res.ez);
      this.effects.tracer(_v, _v2, 0xfff0c2);
      if (res.kind === HIT_WORLD) {
        this.effects.impact(_v2, _n.set(res.nx, res.ny, res.nz));
        if (k === 0) this.deps.audio?.impact(_v2);
      } else if (res.kind === HIT_PLAYER) {
        this.effects.hitPuff(_v2);
      }
    }
    this.effects.muzzleFlash(_v);
    this.localChar.shot();
    this.applyRecoil(w, st);
    this.deps.input.rumble(w.pellets > 1 ? 0.6 : 0.0, w.pellets > 1 ? 0.8 : 0.32, w.pellets > 1 ? 110 : 45);
    this.deps.audio?.gunshot(WEAPON_IDS.indexOf(w.id), null, true);
  }

  private applyRecoil(w: WeaponDef, st: PlayerState): void {
    const steady = (st.aiming ? 0.7 : 1) * (st.crouching ? 0.85 : 1);
    const kick = w.recoilPitch * DEG * steady;
    // part of the kick stays (you must pull down), part springs back on its own
    this.view.pitch = clamp(this.view.pitch + kick * 0.35, -PLAYER.maxPitch, PLAYER.maxPitch);
    this.recoilP += kick * 0.65;
    this.view.yaw = wrapAngle(this.view.yaw + (Math.random() * 2 - 1) * w.recoilYaw * DEG * steady);
    this.rig.kick(kick * 0.35);
  }

  private updateZoneMarkers(): void {
    const snap = this.snap;
    const markers = this.stage.world.zones;
    const turf = this.session.mode === 'turf';
    // set every frame: the world visuals can be swapped while a match is running (assets finished loading)
    for (const m of markers) m.group.visible = turf;
    if (!snap || !turf) return;
    for (let i = 0; i < markers.length; i++) {
      const z = snap.zones[i];
      if (!z) continue;
      const marker = markers[i];
      const color = z.contested ? 0xffd23f : z.owner >= 0 ? parseInt(CREWS[z.owner as TeamId].color.slice(1), 16) : 0xe8e8e8;
      marker.setColor(color, z.progress > 0 || z.contested ? 0.6 + Math.sin(this.time * 8) * 0.4 : 0.3);
    }
  }

  private fillHud(phase: number, weapon: WeaponDef | null, aimYaw: number, aimPitch: number): void {
    const h = this.hudState;
    const snap = this.snap;
    const st = this.predictor.state;
    const settings = this.deps.settings.values;
    h.phase = phase as HudState['phase'];
    h.alive = this.alive;
    h.myTeam = this.myTeam;
    if (snap) {
      h.timeLeft = snap.timeLeft;
      h.scores = snap.scores;
      h.zones = snap.zones;
      h.respawnIn = snap.respawnIn;
    }
    h.myZone = -1;
    if (this.session.mode === 'turf' && this.alive && st.y <= TURF.zoneHeight) {
      const zones = this.map.zones;
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if ((st.x - z.x) ** 2 + (st.z - z.z) ** 2 <= z.radius * z.radius) h.myZone = i;
      }
    }
    h.health = this.me ? this.me.hp : 0;
    h.spawnProtected = !!this.me && (this.me.flags & PF.PROTECTED) !== 0;
    h.slot = st.slot;
    h.mag = magOf(st, st.slot);
    h.reserve = reserveOf(st, st.slot);
    h.magSize = weapon ? Math.max(1, weapon.magSize) : 1;
    h.gun = !!weapon;
    h.melee = !!weapon && weapon.magSize === 0;
    h.weaponName = weapon ? weapon.name : st.thr > 0 ? THROWABLES[THROWABLE_IDS[st.thr - 1]].name : 'Nothing';
    h.porch = this.porchWorld && snap?.porch ? { zone: snap.porch.zone, next: snap.porch.next } : null;
    h.reload = weapon && st.reloadT > 0 ? 1 - st.reloadT / weapon.reloadTime : -1;
    h.throwables = st.throwables;
    h.spreadDeg = weapon ? currentSpread(st, weapon) : 1;
    h.fovV = this.rig.camera.fov;
    h.aimT = this.rig.aimT;
    h.killer = this.killer;
    h.showScoreboard = this.deps.input.frame.scoreboard;
    h.myX = st.x;
    h.myZ = st.z;
    h.viewYaw = aimYaw;
    h.ping = this.session.ping;
    h.fps = this.stats.fps;
    h.resScale = this.gfx.resScale;
    h.showFps = settings.showFps;

    // what is under the reticle, and is our muzzle blocked by nearby cover?
    h.blocked = false;
    h.onTarget = false;
    if (this.alive && weapon && st.air === 0) {
      const eyeY = st.y + eyeHeight(st.crouching);
      const cam = this.rig.camera.position;
      const cp = Math.cos(aimPitch);
      const dx = -Math.sin(aimYaw) * cp, dyv = Math.sin(aimPitch), dz = -Math.cos(aimYaw) * cp;
      const res = traceShot(this.phys, st.x, eyeY, st.z, cam.x, cam.y, cam.z, dx, dyv, dz, weapon.range, this.collectTargets(), this.probe);
      h.onTarget = res.kind === HIT_PLAYER;
      h.blocked = res.kind === HIT_WORLD && res.dist < res.aimLen - 0.4 && res.dist < 4;
    }

    // scoreboard / minimap rows
    const rows = h.players;
    let n = 0;
    const put = (idx: number): HudPlayerRow => {
      let row = rows[n];
      if (!row) {
        row = { idx: 0, name: '', team: 0, bot: false, kills: 0, deaths: 0, score: 0, ping: 0, alive: true, me: false, x: 0, z: 0, yaw: 0 };
        rows[n] = row;
      }
      n++;
      const r = this.roster.get(idx);
      row.idx = idx;
      row.name = r ? r.name : '?';
      row.team = r ? this.visTeam(r) : 0;
      row.bot = r ? r.bot : false;
      return row;
    };
    if (this.me) {
      const row = put(this.session.myIdx);
      row.kills = this.me.kills; row.deaths = this.me.deaths; row.score = this.me.score; row.ping = this.session.ping;
      row.alive = this.alive; row.me = true; row.x = st.x; row.z = st.z; row.yaw = aimYaw;
    }
    for (const rp of this.remotes.values()) {
      const row = put(rp.idx);
      row.kills = rp.kills; row.deaths = rp.deaths; row.score = rp.score; row.ping = rp.ping;
      row.alive = rp.alive; row.me = false; row.x = rp.x; row.z = rp.z; row.yaw = rp.yaw;
    }
    rows.length = n;
  }

  // ------------------------------------------------------------------ JUMP OFF THE PORCH
  private dropBalloon(idx: number): void {
    if (idx === this.session.myIdx) {
      this.myBalloon?.removeFromParent();
      this.myBalloon = null;
      return;
    }
    const b = this.balloons.get(idx);
    if (b) {
      b.removeFromParent();
      this.balloons.delete(idx);
    }
  }

  /** Who to watch while out: a squad mate first, then whoever is left. */
  private spectateTarget(): RemotePlayer | null {
    const cur = this.remotes.get(this.spectateIdx);
    if (cur && cur.alive && (cur.flags & PF.RIDING) === 0) return cur;
    this.spectateIdx = -1;
    let pick: RemotePlayer | null = null;
    for (const rp of this.remotes.values()) {
      if (!rp.alive || (rp.flags & PF.RIDING) !== 0) continue;
      if (!pick || (rp.team === this.myTeam && pick.team !== this.myTeam)) pick = rp;
    }
    if (pick) this.spectateIdx = pick.idx;
    return pick;
  }

  private nextSpectate(): void {
    const list = [...this.remotes.values()].filter((r) => r.alive && (r.flags & PF.RIDING) === 0).map((r) => r.idx).sort((a, b) => a - b);
    if (!list.length) return;
    const i = list.indexOf(this.spectateIdx);
    this.spectateIdx = list[(i + 1) % list.length];
  }

  private updatePorchHud(dt: number, yaw: number, spectating: boolean): void {
    const hud = this.porchHud!, world = this.porchWorld!;
    const st = this.predictor.state;
    const snap = this.snap;
    // what is in reach (same rule as the server)
    let prompt = '';
    this.promptTarget = '';
    if (this.alive && st.air === 0) {
      let best = PORCH.reach * PORCH.reach;
      for (const [id, b] of world.allBags) {
        if (b.opened || Math.abs(b.y - st.y) > 1.8) continue;
        const d = (b.x - st.x) ** 2 + (b.z - st.z) ** 2;
        if (d < best) {
          best = d;
          prompt = `SEARCH BOOKBAG · ${BAGS[b.variant]?.name ?? 'Backpack'}`;
          this.promptTarget = `b${id}`;
        }
      }
      for (const [id, it] of world.allPickups) {
        if (Math.abs(it.y - st.y) > 1.8) continue;
        const d = (it.x - st.x) ** 2 + (it.z - st.z) ** 2;
        if (d < best) {
          best = d;
          prompt = `PICK UP ${itemName(it.kind, it.code, it.count)}`;
          this.promptTarget = `p${id}`;
        }
      }
    }
    const device = this.deps.input.device;
    const key = device === 'kbm' ? 'E' : device === 'touch' ? 'TAP' : '▼';
    const slot = (n: number) => {
      const w = weaponInSlot(st, n);
      const empty = !w || w.id === 'fists';
      return { name: empty ? '' : w!.name, mag: magOf(st, n), reserve: reserveOf(st, n), empty, active: st.slot === n };
    };
    const squad: PorchHudState['squad'] = [];
    for (const r of this.roster.values()) {
      if ((r.squad ?? r.team) !== this.mySquad) continue;
      const me = r.idx === this.session.myIdx;
      const rp = this.remotes.get(r.idx);
      squad.push({ name: r.name, me, alive: me ? this.alive : !!rp?.alive, hp: me ? (this.me?.hp ?? 0) : rp?.hp ?? 0 });
    }
    const doorsAt = snap?.porch && snap.porch.takeoff >= 0 ? snap.porch.takeoff + PORCH.transport.doorsOpen * 1000 : Infinity;
    const state: PorchHudState = {
      snap: snap?.porch ?? null,
      alive: this.alive,
      air: st.air,
      inRiot: st.riot === 1,
      armor: st.armor,
      kills: this.me?.kills ?? 0,
      slots: [slot(0), slot(SLOT_PRIMARY_B), slot(1), { name: st.thr > 0 ? THROWABLES[THROWABLE_IDS[st.thr - 1]].name : '', mag: st.throwables, reserve: 0, empty: st.thr === 0 || st.throwables === 0, active: st.slot === 2 }],
      ammo: [st.ammoL, st.ammoM, st.ammoS, st.ammoH],
      heals: [st.bandages, st.medkits, st.drinks],
      healing: st.healT > 0 ? 1 - st.healT / PORCH.heals[HEAL_KINDS[st.healKind]].time : -1,
      healName: PORCH.heals[HEAL_KINDS[st.healKind]]?.name ?? '',
      prompt: prompt ? `[${key}] ${prompt}` : '',
      doorsIn: Math.max(0, (doorsAt - this.session.serverTime()) / 1000),
      spectating: spectating ? this.remotes.get(this.spectateIdx)?.name ?? '' : '',
      squad,
      yaw,
      total: this.roster.size,
      device,
    };
    hud.update(state, dt);
    const rows = [...this.roster.values()].map((r) => {
      const me = r.idx === this.session.myIdx;
      const rp = this.remotes.get(r.idx);
      return { name: r.name, bot: r.bot, me, mate: (r.squad ?? r.team) === this.mySquad, alive: me ? this.alive : !!rp?.alive, kills: me ? this.me?.kills ?? 0 : rp?.kills ?? 0 };
    });
    hud.board(this.deps.input.frame.scoreboard, rows);
  }

  /** Change the loadout for the next respawn. */
  setLoadout(loadout: Loadout): void {
    this.session.setLoadout(loadout);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.unsubSettings();
    this.unsubDevice();
    this.session.handlers.onSnapshot = undefined;
    this.session.handlers.onRoster = undefined;
    for (const rp of this.remotes.values()) rp.dispose();
    this.remotes.clear();
    for (const vp of this.projectiles.values()) vp.mesh.removeFromParent();
    this.projectiles.clear();
    this.grenadeGeo.dispose();
    this.grenadeMat.dispose();
    this.smokeGeo.dispose();
    this.smokeMat.dispose();
    this.hud.dispose();
    this.porchHud?.dispose();
    this.porchWorld?.dispose();
    this.crowd?.dispose();
    this.deps.audio?.crowd?.(0);
    this.deps.input.porchSlots = false;
    this.effects.dispose();
    this.localChar.dispose();
    for (const z of this.stage.world.zones) z.group.visible = false;
  }
}
