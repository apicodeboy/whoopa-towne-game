import * as THREE from 'three';
import { DEFAULT_APPEARANCE, cloneAppearance, type Appearance } from '@shared/config/appearance';
import type { TeamId } from '@shared/config/crews';
import { AJS } from '@shared/map/greaterTowne';
import { makePose, type CharacterVisual } from '../characters/characterTypes';

/** AJ himself: brown skin, casual fit, a gold chain and a cap. */
export const AJ_LOOK: Readonly<Appearance> = Object.freeze({
  ...cloneAppearance(DEFAULT_APPEARANCE),
  bodyType: 'masc',
  build: 'average',
  skin: 's09',
  hair: 'lowfade',
  hairColor: 'black',
  facialHair: 'goatee',
  facialHairColor: 'black',
  top: 'tee',
  topColor: 'white',
  bottom: 'jeans',
  bottomColor: 'black',
  shoes: 'lowtops',
  shoeColor: 'white',
  hat: 'capfwd',
  earrings: 'none',
  necklace: 'thickgold',
  wrist: 'goldwatch',
});

/** What an NPC character can do beyond a player's (implemented by the skinned characters). */
interface NpcCapable {
  lookAt?(target: THREE.Vector3 | null): void;
  wave?(): void;
}

/**
 * AJ behind the register at AJ'S: a relaxed idle, his head follows you when you are in the
 * shop, and he waves when you walk up. Talking to him is up to the game (see `inReach`).
 */
export class AjNpc {
  readonly char: CharacterVisual;
  private pose = makePose();
  private target = new THREE.Vector3();
  private greeted = false;
  private idleWave = 6;

  constructor(make: (team: TeamId, seed: number, look?: Appearance) => CharacterVisual) {
    this.char = make(0, 4242, cloneAppearance(AJ_LOOK));
    this.char.setMenuIdle?.(true);
    this.pose.x = AJS.npc.x;
    this.pose.z = AJS.npc.z;
    this.pose.yaw = AJS.npc.yaw;
    this.pose.held = 'none';
    this.char.update(0, this.pose, true);
  }

  get root(): THREE.Object3D {
    return this.char.root;
  }

  /** Close enough to talk (standing in front of the counter, on the shop floor). */
  inReach(x: number, y: number, z: number): boolean {
    const t = AJS.talk;
    return Math.abs(y) < 1.2 && (x - t.x) ** 2 + (z - t.z) ** 2 <= t.radius * t.radius;
  }

  /** Says hi (when the conversation starts). */
  greet(): void {
    (this.char as NpcCapable).wave?.();
  }

  update(dt: number, player: { x: number; y: number; z: number } | null, visible: boolean): void {
    const npc = this.char as NpcCapable;
    const d = player ? Math.hypot(player.x - AJS.npc.x, player.z - AJS.npc.z) : Infinity;
    const inShop = d < 11 && !!player && Math.abs(player.y) < 2;
    if (inShop) npc.lookAt?.(this.target.set(player.x, player.y + 1.55, player.z));
    else npc.lookAt?.(null);
    // a wave when you walk up to the counter (again after you have left)
    if (d < 6 && !this.greeted) {
      this.greeted = true;
      npc.wave?.();
    } else if (d > 9) {
      this.greeted = false;
    }
    // every so often, a wave at the door when someone hangs around
    this.idleWave -= dt;
    if (inShop && this.idleWave <= 0) {
      this.idleWave = 14 + Math.random() * 10;
      if (d > 4) npc.wave?.();
    }
    this.char.update(dt, this.pose, visible);
  }

  dispose(): void {
    this.char.root.removeFromParent();
    this.char.dispose();
  }
}
