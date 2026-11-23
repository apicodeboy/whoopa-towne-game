/** A player whose one-piece model is still downloading. */
import * as THREE from 'three';
import type { TeamId } from '@shared/config/crews';
import { makePose, type CharacterPose, type CharacterVisual } from '../characterTypes';

type Build = (team: TeamId, root: THREE.Group) => CharacterVisual | null;

/** What the menus frame until the model is here. */
const EMPTY_FRAME = { eyeY: 1.57, topY: 1.8, chestY: 1.15, scale: 1 };

/**
 * Keeps one root from start to finish, so whatever is attached to a player (balloons, tags) stays
 * attached. In a match the custom character stands in (nobody is ever invisible); the menus wait
 * empty. If the download fails, the custom character stays.
 */
export class PendingCharacter implements CharacterVisual {
  readonly root = new THREE.Group();
  /** Resolves when what will be shown is in place. */
  readonly ready: Promise<void>;
  private inner: CharacterVisual | null = null;
  private last: CharacterPose = makePose();
  private menuIdle: boolean | null = null;
  private outline: boolean | null = null;
  private dead: { dx: number; dz: number } | null = null;
  private gone = false;

  /**
   * @param arrived resolves to true when the model is loaded
   * @param build draws the model into the root
   * @param fallback draws the custom character into the root
   * @param standIn show the custom character meanwhile (matches)
   */
  constructor(private team: TeamId, arrived: Promise<boolean>, build: Build, fallback: Build, standIn: boolean) {
    if (standIn) this.inner = fallback(team, this.root);
    this.ready = arrived.then((ok) => {
      if (this.gone || (!ok && this.inner)) return;
      this.swap((ok ? build : fallback)(this.team, this.root));
    });
  }

  private swap(next: CharacterVisual | null): void {
    if (!next) return;
    this.inner?.dispose();
    this.inner = next;
    if (this.menuIdle !== null) next.setMenuIdle?.(this.menuIdle);
    if (this.outline !== null) next.setOutline?.(this.outline);
    next.update(0, this.last, true);
    if (this.dead) {
      next.die(this.dead.dx, this.dead.dz);
      // (already down: skip to the end of the fall)
      next.update(2, this.last, true);
    }
  }

  update(dt: number, pose: CharacterPose, visible?: boolean): void {
    Object.assign(this.last, pose);
    if (this.inner) return this.inner.update(dt, pose, visible);
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
  }

  shot(): void {
    this.inner?.shot();
  }

  throwItem(): void {
    this.inner?.throwItem();
  }

  land(speed: number): void {
    this.inner?.land?.(speed);
  }

  hit(): void {
    this.inner?.hit();
  }

  die(dx: number, dz: number): void {
    this.dead = { dx, dz };
    this.inner?.die(dx, dz);
  }

  respawn(): void {
    this.dead = null;
    this.inner?.respawn();
  }

  setTeam(team: TeamId): void {
    this.team = team;
    this.inner?.setTeam(team);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  setMenuIdle(on: boolean): void {
    this.menuIdle = on;
    this.inner?.setMenuIdle?.(on);
  }

  setOutline(on: boolean): void {
    this.outline = on;
    this.inner?.setOutline?.(on);
  }

  previewExpression(id: string): void {
    this.inner?.previewExpression?.(id);
  }

  wave(): void {
    this.inner?.wave?.();
  }

  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.inner) return this.inner.getMuzzle(out);
    this.root.getWorldPosition(out);
    out.y += 1.3;
    return out;
  }

  get frame(): NonNullable<CharacterVisual['frame']> {
    return this.inner?.frame ?? EMPTY_FRAME;
  }

  dispose(): void {
    this.gone = true;
    this.inner?.dispose();
    this.inner = null;
    this.root.removeFromParent();
  }
}
