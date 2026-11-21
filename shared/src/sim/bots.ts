import { HITBOX, PLAYER, THROW, TICK_DT } from '../config/game';
import { PORCH, SQUAD_MODES } from '../config/porch';
import { SLOT_PRIMARY, SLOT_PRIMARY_B, SLOT_SECONDARY, type Loadout, type WeaponClass, type WeaponId } from '../config/weapons';
import { DEG, Rng, clamp, hash32, wrapAngle, yawToward } from '../math';
import { PHASE, type BotDifficulty } from '../protocol';
import type { GameSim, SimPlayer } from './game';
import { Q_FENCE, Q_PROJECTILE } from './physics';
import {
  AIR_BALLOON, AIR_RIDING, AIR_SKYDIVE, BTN, eyeHeight, magOf, pickHeal, reserveOf, weaponInSlot, type InputCmd,
} from './player';

interface BotSkill {
  /** Seconds between spotting an enemy and opening fire. */
  reaction: number;
  /** Aim wobble (degrees, standard deviation). */
  aimError: number;
  /** Max turn speed (radians / second). */
  turnRate: number;
  /** Field of view in degrees. */
  fov: number;
  /** Chance to go for the head. */
  headBias: number;
  /** Seconds between semi-auto trigger pulls. */
  tapInterval: number;
}

export const BOT_SKILLS: Record<BotDifficulty, BotSkill> = {
  easy: { reaction: 0.6, aimError: 5.0, turnRate: 3.2, fov: 100, headBias: 0.03, tapInterval: 0.42 },
  normal: { reaction: 0.38, aimError: 2.8, turnRate: 5.2, fov: 115, headBias: 0.12, tapInterval: 0.3 },
  hard: { reaction: 0.22, aimError: 1.5, turnRate: 8.0, fov: 130, headBias: 0.3, tapInterval: 0.22 },
};

/** Bot names follow the same rules as people's: letters and numbers, no spaces, 12 at most. */
export const BOT_NAMES = [
  'LilRicky', 'BigTone44', 'Dre3x', 'Peanut', 'ScoopDaddy', 'JuiceBox', 'Kilo23', 'TinyTim2', 'Ghost', 'Boogie',
  'SlimJim', 'Tank', 'Flaco', 'Mouse', 'Nickel5', 'Lefty', 'SmokeyO', 'Rook', 'Dice7', 'Pops',
  'Bando', 'YungStax', 'Lo9', 'CashOut', 'Tre4', 'Nova', 'BlockBoy', 'Sauce', 'Kash', 'Zay10',
  'Bubba', 'Q2Times', 'Reek', 'Flex', 'Munch', 'Spook', 'DTrain', 'Biscuit', 'Wavy', 'Rello',
];

/** Preferred fighting distance per kind of gun [min, max]. */
const RANGE_BAND: Record<WeaponClass, [number, number]> = {
  shotgun: [2.5, 8],
  smg: [5, 15],
  rifle: [9, 30],
  dmr: [14, 45],
  pistol: [5, 16],
  revolver: [6, 20],
  sniper: [18, 70],
  melee: [0.5, 1.15],
};

/** Throw distance for a handful of pitch angles (flat ground), computed once. */
const THROW_TABLE: Array<{ pitch: number; range: number }> = (() => {
  const out: Array<{ pitch: number; range: number }> = [];
  for (let deg = -10; deg <= 35; deg += 5) {
    const th = deg * DEG;
    const vh = THROW.speed * Math.cos(th);
    const vv = THROW.speed * Math.sin(th) + THROW.upBoost;
    const h = 1.5;
    const t = (vv + Math.sqrt(vv * vv + 2 * THROW.gravity * h)) / THROW.gravity;
    out.push({ pitch: th, range: vh * t + 1.5 });
  }
  return out;
})();

/** What bots carry in the modes with loadouts: mostly rifles and SMGs, some shotguns. */
const BOT_PRIMARIES: ReadonlyArray<[WeaponId, number]> = [
  ['draco', 3], ['honeybadger', 2.5], ['mp7', 2], ['uzi', 1.5], ['vector', 1.5], ['p90', 1], ['scorpion', 1], ['bizon', 1],
  ['bammer', 1.5], ['doublebarrel', 1], ['dmr', 0.8], ['vss', 0.6],
];

export function randomBotLoadout(rng: Rng): Loadout {
  let r = rng.next() * BOT_PRIMARIES.reduce((a, [, w]) => a + w, 0);
  let primary: WeaponId = BOT_PRIMARIES[0][0];
  for (const [id, w] of BOT_PRIMARIES) {
    r -= w;
    if (r <= 0) {
      primary = id;
      break;
    }
  }
  return { primary, secondary: rng.chance(0.75) ? 'taurus' : 'magnum', throwable: rng.chance(0.7) ? 'grenade' : 'smoke', melee: rng.chance(0.5) ? 'knife' : 'fists' };
}

/**
 * Bot AI. Produces the same InputCmd a human client would send, so bots move, aim and
 * shoot through exactly the same simulation code as players do.
 *
 * Behaviour: wander toward objectives (zones in Turf War, enemies/hotspots in TDM) along
 * nav-grid paths; when an enemy is seen (field of view + line of sight, smoke blocks it)
 * react after a delay, track with imperfect aim, fire in bursts, strafe and keep the
 * weapon's preferred range; when the enemy is lost, hunt the last known position and
 * sometimes toss a throwable there.
 */
export class BotBrain {
  private sim: GameSim;
  private me: SimPlayer;
  private skill: BotSkill;
  /** JUMP OFF THE PORCH: this bot's current level and when it changes next. */
  level: BotDifficulty = 'normal';
  private skillAt = 0;
  private rng: Rng;

  target: SimPlayer | null = null;
  private visible = false;
  private reactAt = 0;
  private lastSeenAt = -1e9;
  private lastSeenX = 0;
  private lastSeenY = 0;
  private lastSeenZ = 0;
  private aimHead = false;

  private yaw = 0;
  private pitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errYawT = 0;
  private errPitchT = 0;
  private nextErrAt = 0;

  private path: number[] = [];
  private pathI = 0;
  private hasGoal = false;
  private goalX = 0;
  private goalZ = 0;
  private goalUntil = 0;
  private repathAt = 0;
  private idleUntil = 0;
  private hunting = false;
  private huntUntil = 0;
  private dirX = 0;
  private dirZ = 0;
  private favZone: number;

  private strafeDir = 1;
  private strafeUntil = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private stuckCheckAt = 0;
  private stuckCount = 0;
  private unstickUntil = 0;
  private unstickDir = 1;
  private jumpUntil = 0;

  private burstUntil = 0;
  private restUntil = 0;
  private nextTapAt = 0;
  private tapUntil = 0;
  private crouchUntil = 0;
  private wantSlot = 0;
  private throwPlanned = false;
  private throwAt = 0;
  private scanYaw = 0;
  // JUMP OFF THE PORCH
  private jumpAt = 0;
  private landX = 0;
  private landZ = 0;
  /** Up in the air last tick (to notice the touchdown). */
  private wasAir = false;
  /** After landing: a moment to get its bearings before it moves off or touches anything. */
  private bearingsUntil = 0;
  /** Searching takes a beat: when the bot may open what it is standing at (0 = not at anything). */
  private searchAt = 0;
  private useAt = 0;
  private healAt = 0;
  private lootGoal = false;

  constructor(sim: GameSim, me: SimPlayer) {
    this.sim = sim;
    this.me = me;
    this.skill = BOT_SKILLS[sim.botDifficulty];
    this.level = sim.botDifficulty;
    this.rng = new Rng(hash32(me.idx + 1, sim.rng.int(0x7fffffff)));
    if (sim.porch) this.rollSkill();
    this.favZone = (me.idx + me.team) % Math.max(1, sim.map.zones.length);
    this.yaw = me.state.yaw;
  }

  onSpawn(): void {
    this.target = null;
    this.visible = false;
    this.hasGoal = false;
    this.hunting = false;
    this.path.length = 0;
    this.pathI = 0;
    this.yaw = this.me.state.yaw;
    this.pitch = 0;
    this.wantSlot = 0;
    this.stuckCount = 0;
    this.stuckCheckAt = 0;
    this.idleUntil = 0;
    this.throwPlanned = false;
    if (this.sim.porch) {
      // where to land: a random bookbag (the same one as the rest of the squad), or anywhere people can stand
      const porch = this.sim.porch, bags = porch.bags;
      const squadSize = SQUAD_MODES[porch.squadMode].size;
      // (never right on top of the bag: a bot lands a few steps off and has to go and search it,
      // like anybody else, so nobody touches down already armed)
      const near = (b: { x: number; z: number }) => {
        const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(5, 10);
        this.landX = b.x + Math.cos(a) * d;
        this.landZ = b.z + Math.sin(a) * d;
      };
      if (bags.length && squadSize > 1) {
        near(bags[(this.me.squad * 7919 + 13) % bags.length]);
      } else if (bags.length && this.rng.chance(0.75)) {
        near(this.rng.pick(bags));
      } else {
        const idx = this.sim.nav.randomWalkable(this.rng);
        this.landX = this.sim.nav.cellX(idx);
        this.landZ = this.sim.nav.cellZ(idx);
      }
      this.jumpAt = 0;
      this.wasAir = false;
      this.bearingsUntil = 0;
      this.searchAt = 0;
    }
  }

  /** On the transport or hanging from a balloon. Returns true when it handled the command. */
  private thinkAir(cmd: InputCmd): boolean {
    const sim = this.sim, porch = sim.porch!, s = this.me.state, now = sim.time;
    if (s.air === AIR_RIDING) {
      if (sim.phase !== PHASE.PLAYING) return true;
      // jump when the transport passes closest to the landing spot (a few go on a whim)
      if (now < porch.takeoff + PORCH.transport.doorsOpen * 1000) return true;
      const r = porch.route;
      const len = Math.hypot(r[2] - r[0], r[3] - r[1]) || 1;
      const dx = (r[2] - r[0]) / len, dz = (r[3] - r[1]) / len;
      const along = (this.landX - r[0]) * dx + (this.landZ - r[1]) * dz;
      const here = (s.x - r[0]) * dx + (s.z - r[1]) * dz;
      if (this.jumpAt === 0) this.jumpAt = this.rng.chance(0.15) ? now + this.rng.range(2500, 40000) : Infinity;
      if (here >= along - 25 || now >= this.jumpAt) cmd.buttons = (sim.tickCount & 1) ? BTN.JUMP : 0;
      return true;
    }
    if (s.air === AIR_BALLOON || s.air === AIR_SKYDIVE) {
      const dx = this.landX - s.x, dz = this.landZ - s.z;
      const d = Math.hypot(dx, dz);
      this.yaw = Math.atan2(-dx, -dz);
      cmd.yaw = this.yaw;
      cmd.pitch = -0.6;
      cmd.mz = clamp(d / 6, 0, 1);
      cmd.mx = 0;
      cmd.buttons = d < 8 ? BTN.CROUCH : 0;
      return true;
    }
    return false;
  }

  /** Best weapon slot to hold (a gun with ammo beats a handgun beats fists). */
  private bestSlot(): number {
    const s = this.me.state;
    let best = SLOT_PRIMARY, bestScore = -1;
    for (const slot of [SLOT_PRIMARY, SLOT_PRIMARY_B, SLOT_SECONDARY]) {
      const w = weaponInSlot(s, slot);
      if (!w || w.kind === 'melee') continue;
      if (magOf(s, slot) + reserveOf(s, slot) <= 0) continue;
      const score = slot === SLOT_SECONDARY ? 1 : w.cls === 'sniper' ? 1.5 : 2;
      if (score > bestScore) {
        bestScore = score;
        best = slot;
      }
    }
    return best;
  }

  /** Has a usable gun with a reasonable amount of ammo. */
  private armed(): boolean {
    const s = this.me.state;
    for (const slot of [SLOT_PRIMARY, SLOT_PRIMARY_B, SLOT_SECONDARY]) {
      const w = weaponInSlot(s, slot);
      if (w && w.kind !== 'melee' && magOf(s, slot) + reserveOf(s, slot) > w.magSize) return true;
    }
    return false;
  }

  /** Outside the safe area the riot is heading for (or already caught in it). */
  private zoneUrgent(): boolean {
    const porch = this.sim.porch!, s = this.me.state;
    if (s.riot) return true;
    const n = porch.next;
    return porch.stage >= 3 && (s.x - n.x) ** 2 + (s.z - n.z) ** 2 > (n.r * 0.9) ** 2;
  }

  /**
   * JUMP OFF THE PORCH has no difficulty setting: every bot is normal or hard, re-rolled every
   * minute or so, and hard gets more likely as the riot closes in.
   */
  private rollSkill(): void {
    const porch = this.sim.porch;
    if (!porch) return;
    const phase = Math.max(0, porch.stage - 2); // 0 before the riot, then 1, 2, ...
    const pHard = Math.min(0.8, 0.3 + phase * 0.12);
    this.level = this.rng.chance(pHard) ? 'hard' : 'normal';
    this.skill = BOT_SKILLS[this.level];
    this.skillAt = this.sim.time + this.rng.range(40000, 80000);
  }

  think(cmd: InputCmd): void {
    if (this.sim.porch && this.sim.time >= this.skillAt) this.rollSkill();
    const sim = this.sim, me = this.me, s = me.state, now = sim.time;
    cmd.mx = 0;
    cmd.mz = 0;
    cmd.buttons = 0;
    cmd.slot = this.wantSlot;
    cmd.ox = s.x;
    cmd.oy = s.y + eyeHeight(s.crouching);
    cmd.oz = s.z;
    cmd.rt = now;
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    if (!me.alive) return;
    if (sim.porch && this.thinkAir(cmd)) {
      this.wasAir = true;
      return;
    }
    if (this.wasAir) {
      // just touched down: look around for a moment first
      this.wasAir = false;
      this.bearingsUntil = now + this.rng.range(1200, 2800);
      this.scanYaw = this.yaw + this.rng.range(-1.6, 1.6);
    }
    if (sim.phase !== PHASE.PLAYING) return;
    if (now < this.bearingsUntil) {
      cmd.yaw = this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(this.scanYaw - this.yaw), -3 * TICK_DT, 3 * TICK_DT));
      return;
    }

    if ((sim.tickCount + me.idx * 3) % 6 === 0) this.perceive();
    if (this.target && !this.target.alive) {
      this.target = null;
      this.visible = false;
      this.hasGoal = false;
    }
    const porch = sim.porch;
    let urgent = false;
    if (porch) {
      urgent = this.zoneUrgent();
      if (s.reloadT <= 0 && s.healT <= 0) this.wantSlot = this.bestSlot();
      // run from the riot rather than trade shots in it
      if (urgent && this.target && !this.lootGoal) {
        this.hasGoal = this.hasGoal && !this.lootGoal;
      }
    }

    const weapon = weaponInSlot(s, s.slot);
    let moveX = 0, moveZ = 0;
    let lookX = 0, lookY = 0, lookZ = 0;
    let haveLook = false;
    let buttons = 0;
    let wantMove = false;
    const tgt = urgent || (porch && !this.armed() && this.target && Math.hypot(this.target.state.x - s.x, this.target.state.z - s.z) > 6) ? null : this.target;

    if (tgt) {
      // ------------------------------------------------------------ fight
      const ts = tgt.state;
      const tx = this.visible ? ts.x : this.lastSeenX;
      const ty = this.visible ? ts.y : this.lastSeenY;
      const tz = this.visible ? ts.z : this.lastSeenZ;
      const dx = tx - s.x, dz = tz - s.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const aimH = this.aimHead
        ? (ts.crouching ? HITBOX.crouchHeadCenter : HITBOX.headCenter)
        : (ts.crouching ? 0.62 : 1.05);
      lookX = tx;
      lookY = ty + aimH;
      lookZ = tz;
      haveLook = true;

      const band = RANGE_BAND[weapon ? weapon.cls : 'melee'];
      if (d > band[1]) {
        // close the distance along a path (straight lines get hung up on cars and barriers)
        if (!this.hasGoal || now >= this.repathAt) this.setGoal(tx, tz, 700);
        if (this.followPath()) {
          moveX = this.dirX;
          moveZ = this.dirZ;
        } else {
          moveX = dx / d;
          moveZ = dz / d;
        }
        wantMove = true;
      } else {
        this.hasGoal = false;
        if (now >= this.strafeUntil) {
          this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
          this.strafeUntil = now + this.rng.range(450, 1300);
        }
        // sidestep, drifting in or out to stay inside the band
        const px = (-dz / d) * this.strafeDir, pz = (dx / d) * this.strafeDir;
        let radial = 0;
        if (d < band[0]) radial = -1;
        else if (d > (band[0] + band[1]) * 0.5) radial = 0.35;
        moveX = px + (dx / d) * radial;
        moveZ = pz + (dz / d) * radial;
        const ml = Math.hypot(moveX, moveZ) || 1;
        moveX /= ml;
        moveZ /= ml;
        wantMove = true;
        // bounced off something while strafing: go the other way
        if (now > this.strafeUntil - 250 && Math.hypot(s.vx, s.vz) < 0.6) this.strafeUntil = now;
      }

      // trigger discipline
      if (this.visible && weapon && now >= this.reactAt) {
        const wantYaw = yawToward(s.x, s.z, tx, tz) + this.errYaw;
        const eyeY = s.y + eyeHeight(s.crouching);
        const wantPitch = Math.atan2(lookY - eyeY, d) + this.errPitch;
        const cone = Math.max(0.03, Math.atan(0.55 / d));
        const onTarget = Math.abs(wrapAngle(wantYaw - this.yaw)) < cone && Math.abs(wantPitch - this.pitch) < cone * 1.3;
        if (onTarget && s.reloadT <= 0 && s.swapT <= 0) {
          if (weapon.auto) {
            if (d > 16) {
              if (now >= this.restUntil && now >= this.burstUntil) {
                this.burstUntil = now + this.rng.range(280, 620);
                this.restUntil = this.burstUntil + this.rng.range(140, 380);
                if (d > 22 && this.rng.chance(0.25)) this.crouchUntil = this.burstUntil + 300;
              }
              if (now < this.burstUntil) buttons |= BTN.FIRE;
            } else {
              buttons |= BTN.FIRE;
            }
          } else {
            if (now >= this.nextTapAt) {
              this.tapUntil = now + 50;
              this.nextTapAt = now + this.skill.tapInterval * 1000 * this.rng.range(0.85, 1.25);
            }
            if (now < this.tapUntil) buttons |= BTN.FIRE;
          }
        }
        if (d > 12 && weapon.cls !== 'shotgun') buttons |= BTN.AIM;
      }
      if (now < this.crouchUntil) buttons |= BTN.CROUCH;

      // sidearm when the primary runs dry up close
      if (!porch && s.slot === 0 && s.mag0 === 0 && (s.res0 === 0 || d < 10) && s.mag1 > 0) this.wantSlot = 1;
    } else {
      // ------------------------------------------------------------ travel
      if (!porch && this.wantSlot === 1 && (s.mag0 > 0 || s.res0 > 0)) this.wantSlot = 0;
      if (weapon && weapon.magSize > 0) {
        const mag = magOf(s, s.slot);
        const res = reserveOf(s, s.slot);
        if (mag < weapon.magSize * 0.5 && res > 0 && s.reloadT <= 0) buttons |= BTN.RELOAD;
      }
      if (porch) {
        // patch up between fights (holding HEAL until the item is done), and take a Perc 29
        // (it fills the armor) once a good part of the armor is gone
        const wantArmor = s.pills > 0 && s.armor <= PORCH.maxArmor * 0.5;
        if ((s.hp < 65 || wantArmor) && s.healT <= 0 && pickHeal(s) >= 0 && now >= this.healAt && !urgent) {
          buttons |= BTN.HEAL;
          this.healAt = now + 400;
        }
        if (s.healT > 0 && !urgent) buttons |= BTN.HEAL;
        if (urgent && !this.lootGoal && (!this.hasGoal || now >= this.repathAt)) {
          this.hasGoal = false;
          this.pickGoal();
        }
      }

      if (this.hunting && (now >= this.huntUntil || !this.hasGoal)) this.hunting = false;
      if (!this.hasGoal && now >= this.idleUntil) this.pickGoal();
      if (this.hasGoal && now >= this.goalUntil && !this.hunting) this.hasGoal = false;

      if (this.hasGoal) {
        if (now >= this.repathAt) this.setGoal(this.goalX, this.goalZ, 2500);
        if (this.followPath()) {
          moveX = this.dirX;
          moveZ = this.dirZ;
          wantMove = true;
          lookX = s.x + moveX * 8;
          lookY = s.y + PLAYER.eyeHeight;
          lookZ = s.z + moveZ * 8;
          haveLook = true;
          const remaining = Math.hypot(this.goalX - s.x, this.goalZ - s.z);
          if (remaining > 9 && now - me.lastAttackedAt > 3000) buttons |= BTN.SPRINT;
        } else {
          // arrived
          this.hasGoal = false;
          this.hunting = false;
          this.idleUntil = now + this.rng.range(400, 1600);
          this.scanYaw = this.yaw + this.rng.range(-2.2, 2.2);
        }
      } else {
        // look around while holding position
        lookX = s.x - Math.sin(this.scanYaw) * 8;
        lookY = s.y + PLAYER.eyeHeight;
        lookZ = s.z - Math.cos(this.scanYaw) * 8;
        haveLook = true;
      }

      // toss a throwable at where the enemy was last seen
      if (this.hunting && this.throwPlanned && s.throwables > 0 && s.throwCd <= 0) {
        const d = Math.hypot(this.lastSeenX - s.x, this.lastSeenZ - s.z);
        if (now - this.lastSeenAt < 3500 && d > 8 && d < 30) {
          let best = THROW_TABLE[0];
          for (const e of THROW_TABLE) if (Math.abs(e.range - d) < Math.abs(best.range - d)) best = e;
          const wantYaw = yawToward(s.x, s.z, this.lastSeenX, this.lastSeenZ);
          const dist = 8;
          lookX = s.x - Math.sin(wantYaw) * dist;
          lookZ = s.z - Math.cos(wantYaw) * dist;
          lookY = s.y + PLAYER.eyeHeight + Math.tan(best.pitch) * dist;
          haveLook = true;
          wantMove = false;
          moveX = moveZ = 0;
          if (Math.abs(wrapAngle(wantYaw - this.yaw)) < 0.08 && Math.abs(best.pitch - this.pitch) < 0.08) {
            if (this.throwAt === 0) this.throwAt = now + 120;
            if (now >= this.throwAt) {
              buttons |= BTN.THROW;
              this.throwPlanned = false;
              this.throwAt = 0;
            }
          }
        } else {
          this.throwPlanned = false;
        }
      }
    }

    // ---------------------------------------------------------------- loot
    if (porch && s.healT <= 0) {
      const { bag, pickup } = porch.reachable(s);
      const want = bag || (pickup && (pickup.kind !== 1 || !this.armed() || weaponInSlot(s, SLOT_PRIMARY_B)?.kind === 'melee'));
      // a bag takes a moment to go through; things lying loose are quicker to grab
      if (!want) this.searchAt = 0;
      else if (this.searchAt === 0) this.searchAt = now + (bag ? this.rng.range(700, 1300) : this.rng.range(250, 500));
      if (want && now >= this.searchAt && now >= this.useAt) {
        buttons |= BTN.USE;
        this.useAt = now + 350;
        this.searchAt = 0;
        this.lootGoal = false;
        this.hasGoal = false;
        this.idleUntil = now + 200;
      }
    } else {
      this.searchAt = 0;
    }

    // ---------------------------------------------------------------- fences
    // battle royale: a low fence across the way (the railings between the districts): jump it
    if (porch && wantMove && s.grounded && (moveX !== 0 || moveZ !== 0) && (sim.tickCount & 3) === 0) {
      const ml = Math.hypot(moveX, moveZ) || 1;
      const dx = moveX / ml, dz = moveZ / ml;
      const fence = sim.phys.raycast(s.x, s.y + 0.45, s.z, dx, 0, dz, PLAYER.radius + 0.7, Q_FENCE);
      if (fence >= 0 && sim.phys.raycast(s.x, s.y + 1.2, s.z, dx, 0, dz, fence + 0.6, Q_PROJECTILE) < 0) buttons |= BTN.JUMP;
    }

    // ---------------------------------------------------------------- unstick
    if (wantMove) {
      if (now >= this.stuckCheckAt) {
        const moved = Math.hypot(s.x - this.stuckX, s.z - this.stuckZ);
        if (this.stuckCheckAt > 0 && moved < 0.3) {
          this.stuckCount++;
          this.unstickUntil = now + 450;
          this.unstickDir = this.rng.chance(0.5) ? 1 : -1;
          this.jumpUntil = now + 80;
          this.repathAt = 0;
          if (this.stuckCount >= 5) {
            this.hasGoal = false;
            this.hunting = false;
            this.stuckCount = 0;
          }
        } else if (moved > 1.2) {
          this.stuckCount = 0;
        }
        this.stuckX = s.x;
        this.stuckZ = s.z;
        this.stuckCheckAt = now + 500;
      }
      if (now < this.unstickUntil) {
        const px = -moveZ * this.unstickDir, pz = moveX * this.unstickDir;
        moveX = moveX * 0.3 + px;
        moveZ = moveZ * 0.3 + pz;
        const ml = Math.hypot(moveX, moveZ) || 1;
        moveX /= ml;
        moveZ /= ml;
      }
      if (now < this.jumpUntil) buttons |= BTN.JUMP;
    } else {
      this.stuckCheckAt = 0;
    }

    // ---------------------------------------------------------------- aim
    if (haveLook) {
      const eyeY = s.y + eyeHeight(s.crouching);
      const dxl = lookX - s.x, dzl = lookZ - s.z;
      const flat = Math.hypot(dxl, dzl) || 0.001;
      if (tgt) {
        if (now >= this.nextErrAt) {
          const tSpeed = Math.hypot(tgt.state.vx, tgt.state.vz);
          const mySpeed = Math.hypot(s.vx, s.vz);
          const sigma = this.skill.aimError * DEG * (1 + tSpeed / 6 + mySpeed / 12);
          this.errYawT = this.rng.gauss() * sigma;
          this.errPitchT = this.rng.gauss() * sigma * 0.6;
          this.nextErrAt = now + this.rng.range(300, 750);
        }
        this.errYaw += (this.errYawT - this.errYaw) * Math.min(1, TICK_DT * 6);
        this.errPitch += (this.errPitchT - this.errPitch) * Math.min(1, TICK_DT * 6);
      } else {
        this.errYaw = 0;
        this.errPitch = 0;
      }
      const wantYaw = Math.atan2(-dxl, -dzl) + this.errYaw;
      const wantPitch = clamp(Math.atan2(lookY - eyeY, flat) + this.errPitch, -1.2, 1.2);
      const maxStep = this.skill.turnRate * TICK_DT * (tgt ? 1 : 0.8);
      this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(wantYaw - this.yaw) * 12 * TICK_DT, -maxStep, maxStep));
      this.pitch += clamp((wantPitch - this.pitch) * 12 * TICK_DT, -maxStep, maxStep);
    }

    // ---------------------------------------------------------------- write the command
    if (moveX !== 0 || moveZ !== 0) {
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      cmd.mz = clamp(-moveX * sinY - moveZ * cosY, -1, 1);
      cmd.mx = clamp(moveX * cosY - moveZ * sinY, -1, 1);
    }
    cmd.buttons = buttons;
    cmd.slot = this.wantSlot;
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
  }

  private perceive(): void {
    const sim = this.sim, me = this.me, s = me.state, now = sim.time;
    const ex = s.x, ey = s.y + eyeHeight(s.crouching), ez = s.z;
    const halfFov = (this.skill.fov * DEG) / 2;
    let best: SimPlayer | null = null;
    let bestScore = Infinity;
    for (const e of sim.players) {
      if (!e || sim.allies(e, me) || !e.alive || e.state.air === AIR_RIDING) continue;
      const es = e.state;
      const d = Math.hypot(es.x - ex, es.z - ez);
      // battle royale: early on everyone is busy looting, and you only notice people nearby
      const sight = sim.porch ? (sim.porch.stage <= 2 ? 30 : 55) : 85;
      if (d > sight) continue;
      const attackedMe = e.idx === me.lastAttacker && now - me.lastAttackedAt < 2500;
      if (d > 6 && !attackedMe) {
        const ang = Math.abs(wrapAngle(yawToward(ex, ez, es.x, es.z) - this.yaw));
        if (ang > halfFov) continue;
      }
      const chest = es.y + (es.crouching ? 0.62 : 1.05);
      const head = es.y + (es.crouching ? HITBOX.crouchHeadCenter : HITBOX.headCenter);
      if (!sim.canSee(ex, ey, ez, es.x, chest, es.z) && !sim.canSee(ex, ey, ez, es.x, head, es.z)) continue;
      const score = d - (e === this.target ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }

    if (best) {
      if (best !== this.target) {
        this.target = best;
        this.reactAt = now + this.skill.reaction * 1000 * this.rng.range(0.75, 1.25);
        this.aimHead = this.rng.chance(this.skill.headBias);
        this.nextErrAt = 0;
        this.hasGoal = false;
      }
      this.visible = true;
      this.lastSeenAt = now;
      this.lastSeenX = best.state.x;
      this.lastSeenY = best.state.y;
      this.lastSeenZ = best.state.z;
      return;
    }

    this.visible = false;
    if (this.target && now - this.lastSeenAt > 600) {
      // lost them: go check where they were last seen
      this.target = null;
      this.hunting = true;
      this.huntUntil = now + 5500;
      this.throwPlanned = this.rng.chance(0.45);
      this.throwAt = 0;
      this.setGoal(this.lastSeenX, this.lastSeenZ, 2500);
      this.goalUntil = this.huntUntil;
    } else if (!this.target && me.lastAttacker >= 0 && now - me.lastAttackedAt < 600 && !this.hunting) {
      // shot from somewhere unseen: head toward the shooter
      const a = sim.players[me.lastAttacker];
      if (a && a.alive) {
        this.lastSeenX = a.state.x;
        this.lastSeenY = a.state.y;
        this.lastSeenZ = a.state.z;
        this.hunting = true;
        this.huntUntil = now + 4000;
        this.setGoal(a.state.x, a.state.z, 2500);
        this.goalUntil = this.huntUntil;
      }
    }
  }

  private setGoal(x: number, z: number, repathMs: number): void {
    const s = this.me.state;
    const len = this.sim.nav.findPath(s.x, s.z, x, z, this.path);
    this.pathI = 0;
    this.goalX = x;
    this.goalZ = z;
    this.hasGoal = len >= 0;
    this.repathAt = this.sim.time + repathMs * this.rng.range(0.9, 1.2);
  }

  /** Steers toward the next waypoint. Returns false when the path is finished. */
  private followPath(): boolean {
    const s = this.me.state;
    while (this.pathI < this.path.length) {
      const wx = this.path[this.pathI], wz = this.path[this.pathI + 1];
      const dx = wx - s.x, dz = wz - s.z;
      const d = Math.hypot(dx, dz);
      const last = this.pathI >= this.path.length - 2;
      if (d < (last ? 0.7 : 0.9)) {
        this.pathI += 2;
        continue;
      }
      this.dirX = dx / d;
      this.dirZ = dz / d;
      return true;
    }
    return false;
  }

  private pickGoal(): void {
    const sim = this.sim, me = this.me, s = me.state, now = sim.time;
    const rng = this.rng;
    let gx = 0, gz = 0;
    this.lootGoal = false;
    const w = sim.map.warmup;
    if (sim.arena && sim.phase === PHASE.WARMUP && w) {
      // the warm-up: roam the warm-up area looking for a fight (nothing to loot yet)
      gx = (w.x0 + w.x1) / 2;
      gz = (w.z0 + w.z1) / 2;
      for (let k = 0; k < 12; k++) {
        const x = rng.range(w.x0, w.x1), z = rng.range(w.z0, w.z1);
        if (sim.nav.isWalkable(x, z)) {
          gx = x;
          gz = z;
          break;
        }
      }
      this.goalUntil = now + rng.range(6000, 11000);
      this.hunting = false;
      this.setGoal(gx, gz, 2500);
      if (!this.hasGoal) this.idleUntil = now + 400;
      return;
    }
    if (sim.porch) {
      const porch = sim.porch;
      const n = this.zoneUrgent() ? porch.next : porch.zone;
      const inSafe = (x: number, z: number) => (x - n.x) ** 2 + (z - n.z) ** 2 < (n.r * 0.85) ** 2;
      // gear up first: the nearest unsearched bag (or loose gun) that is not in the riot
      let best = Infinity;
      if (!this.armed() || rng.chance(0.5)) {
        for (const b of porch.bags) {
          if (b.opened || !inSafe(b.x, b.z)) continue;
          const d = Math.hypot(b.x - s.x, b.z - s.z);
          if (d < best && d < 90) {
            best = d;
            gx = b.x;
            gz = b.z;
          }
        }
        for (const it of porch.pickups.values()) {
          if (it.kind !== 1 || !inSafe(it.x, it.z)) continue;
          const d = Math.hypot(it.x - s.x, it.z - s.z) * 1.2;
          if (d < best && d < 60) {
            best = d;
            gx = it.x;
            gz = it.z;
          }
        }
      }
      if (best < Infinity) {
        this.lootGoal = true;
      } else {
        // roam somewhere safe (toward the middle of the safe area)
        for (let k = 0; k < 12; k++) {
          const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * n.r * 0.7;
          gx = n.x + Math.cos(a) * r;
          gz = n.z + Math.sin(a) * r;
          if (sim.nav.isWalkable(gx, gz)) break;
        }
      }
      this.goalUntil = now + rng.range(8000, 14000);
      this.hunting = false;
      this.setGoal(gx, gz, 2500);
      if (!this.hasGoal) this.idleUntil = now + 400;
      return;
    }
    if (sim.mode === 'turf' && sim.zones.length > 0) {
      let best = 0, bestScore = -1;
      for (let i = 0; i < sim.zones.length; i++) {
        const z = sim.zones[i], def = sim.map.zones[i];
        const d = Math.hypot(def.x - s.x, def.z - s.z);
        let want: number;
        if (z.owner === me.team) {
          const threatened = z.contested || (z.capTeam >= 0 && z.capTeam !== me.team && z.progress > 0);
          want = threatened ? 9 : 1.2;
        } else {
          want = z.owner === -1 ? 9 : 8;
        }
        if (i === this.favZone) want *= 1.35;
        const score = (want / (1 + d / 45)) * rng.range(0.85, 1.15);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      const def = sim.map.zones[best];
      gx = def.x;
      gz = def.z;
      for (let k = 0; k < 8; k++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(0, def.radius * 0.6);
        const x = def.x + Math.cos(a) * r, z = def.z + Math.sin(a) * r;
        if (sim.nav.isWalkable(x, z)) {
          gx = x;
          gz = z;
          break;
        }
      }
      this.goalUntil = now + rng.range(7000, 12000);
    } else {
      // Team Deathmatch: mostly push toward the nearest enemy, otherwise roam the hotspots
      let nearest: SimPlayer | null = null;
      let nd = Infinity;
      for (const e of sim.players) {
        if (!e || sim.allies(e, me) || !e.alive) continue;
        const d = Math.hypot(e.state.x - s.x, e.state.z - s.z);
        if (d < nd) {
          nd = d;
          nearest = e;
        }
      }
      if (nearest && rng.chance(0.65)) {
        gx = nearest.state.x + rng.range(-5, 5);
        gz = nearest.state.z + rng.range(-5, 5);
      } else {
        const h = rng.pick(sim.map.hotspots);
        gx = h.x + rng.range(-2, 2);
        gz = h.z + rng.range(-2, 2);
      }
      this.goalUntil = now + rng.range(6000, 11000);
    }
    this.hunting = false;
    this.setGoal(gx, gz, 2500);
    if (!this.hasGoal) this.idleUntil = now + 500;
  }
}

