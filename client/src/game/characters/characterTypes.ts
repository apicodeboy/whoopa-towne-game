import type { WeaponId } from '@shared/config/weapons';
import type * as THREE from 'three';
import type { TeamId } from '@shared/config/crews';

/** What a character is holding (weapon id, throwable id, or nothing). */
export type HeldItem = WeaponId | 'grenade' | 'smoke' | 'none';

/** Per-frame animation inputs for a character (local or remote). */
export interface CharacterPose {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Horizontal velocity in world space (m/s). */
  vx: number;
  vz: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  aiming: boolean;
  /** 0..1 progress through the current reload, or -1 when not reloading. */
  reload: number;
  alive: boolean;
  held: HeldItem;
  /** JUMP OFF THE PORCH: hanging from a bunch of balloons (both hands up on the strings, legs dangling). */
  hanging?: boolean;
  /** JUMP OFF THE PORCH: free fall out of the blimp (belly down, arms and legs spread). */
  skydive?: boolean;
  /** Double jump: 0..1 through the front flip (undefined / < 0 = not flipping). */
  flip?: number;
  /** Using a healing item: 0 bandage, 1 first-aid kit, 2 orange, 3 Perc 29; -1 / undefined = not healing. */
  heal?: number;
  /** Rolling (sprint + crouch): 0..1 through the roll; -1 / undefined = not rolling. */
  roll?: number;
  /** Pulling up onto a ledge: 0..1 through the climb; -1 / undefined = not climbing. */
  climb?: number;
}

/**
 * Where the balloon strings meet, in the character's own space (x = right, y = up, -z = forward).
 * The hanging pose puts the hands here and the balloons swing around it.
 */
export const BALLOON_GRIP = { x: 0.22, y: 1.98, z: -0.04 } as const;

export function makePose(): CharacterPose {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0,
    grounded: true, crouching: false, sprinting: false, aiming: false, reload: -1, alive: true, held: 'draco',
  };
}

/** A renderable character. Implemented procedurally and (art pass) with skinned models. */
export interface CharacterVisual {
  readonly root: THREE.Object3D;
  /** `visible` false = off screen this frame: implementations may skip the expensive animation work. */
  update(dt: number, pose: CharacterPose, visible?: boolean): void;
  /** Play the weapon kick for one shot. */
  shot(): void;
  /** Play a throw gesture. */
  throwItem(): void;
  /** Touched down after a fall (`speed` m/s down): the knees take it. */
  land?(speed: number): void;
  /** Flinch when damaged. */
  hit(): void;
  /** Start the death fall; (dx,dz) is the world direction the killing blow travelled. */
  die(dx: number, dz: number): void;
  /** Stand back up for a new life. */
  respawn(): void;
  setTeam(team: TeamId): void;
  /** Hide (first-person-ish camera squeeze) or show. */
  setVisible(v: boolean): void;
  /** World position of the weapon muzzle (for flashes and tracers). */
  getMuzzle(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
  /** Menus: relaxed idle, no weapon. */
  setMenuIdle?(on: boolean): void;
  /** Level of detail: the ink outline is drawn only up close (it doubles the character's cost). */
  setOutline?(on: boolean): void;
  /** Character screen: shows a facial expression for a moment. */
  previewExpression?(id: string): void;
  /** Menus: a wave hello (the Character Creator's Action button). */
  wave?(): void;
  /** Bind-pose heights the Character screen frames its camera on (meters, before `scale`). */
  readonly frame?: { eyeY: number; topY: number; chestY: number; scale: number };
}
