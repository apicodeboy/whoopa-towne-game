import type * as THREE from 'three';
import type { TeamId } from '@shared/config/crews';

/** What a character is holding (weapon id, throwable id, or nothing). */
export type HeldItem = 'smg' | 'ar' | 'shotgun' | 'pistol' | 'sniper' | 'grenade' | 'smoke' | 'none';

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
}

export function makePose(): CharacterPose {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0,
    grounded: true, crouching: false, sprinting: false, aiming: false, reload: -1, alive: true, held: 'ar',
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
  /** Character screen: shows a facial expression for a moment. */
  previewExpression?(id: string): void;
  /** Bind-pose heights the Character screen frames its camera on (meters, before `scale`). */
  readonly frame?: { eyeY: number; topY: number; chestY: number; scale: number };
}
