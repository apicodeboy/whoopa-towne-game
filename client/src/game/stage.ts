import type { MapDef } from '@shared/map/types';
import { getWhoopaTowne } from '@shared/map/whoopaTowne';
import { Buildings } from '@shared/sim/buildings';
import { PhysicsWorld, type Rapier } from '@shared/sim/physics';
import type { SettingsStore } from '../core/settings';
import type { Assets } from './assets';
import { GameRenderer } from './renderer';
import { BuildingVisual } from './world/buildingVisual';
import { buildWorld, type WorldVisual } from './world/worldBuilder';

/**
 * Everything that lives for the whole app session: the WebGL renderer + scene, the map
 * visuals and the client-side collision world. Menus render it as a backdrop and each
 * match borrows it, so entering a game never has to rebuild the world.
 */
export class Stage {
  map: MapDef;
  phys: PhysicsWorld;
  readonly gfx: GameRenderer;
  world: WorldVisual;
  /** Doors and windows (this client's copy, kept current by the match's events) and their visuals. */
  buildings: Buildings;
  bldVisual: BuildingVisual;
  readonly R: Rapier;

  constructor(container: HTMLElement, R: Rapier, settings: SettingsStore) {
    this.R = R;
    this.map = getWhoopaTowne();
    this.phys = new PhysicsWorld(R, this.map);
    this.gfx = new GameRenderer(container, settings);
    this.world = buildWorld(this.map);
    this.gfx.scene.add(this.world.group);
    this.gfx.setLights(this.world.lights);
    this.buildings = new Buildings(this.map, this.phys);
    this.bldVisual = new BuildingVisual(this.buildings);
    this.gfx.scene.add(this.bldVisual.group);
  }

  /**
   * Make sure this map is the one loaded (the classic modes and JUMP OFF THE PORCH play on
   * different maps). Rebuilds the collision world and the visuals only when it changes.
   */
  useMap(map: MapDef, assets: Assets | null): void {
    if (map === this.map) return;
    this.map = map;
    this.phys.dispose();
    this.phys = new PhysicsWorld(this.R, map);
    this.bldVisual.dispose();
    this.buildings = new Buildings(map, this.phys);
    this.bldVisual = new BuildingVisual(this.buildings);
    this.gfx.scene.add(this.bldVisual.group);
    this.setWorld(buildWorld(map, assets));
  }

  /** Swap the world visuals (art pass finished loading assets). */
  setWorld(world: WorldVisual): void {
    this.world.dispose();
    this.world = world;
    this.gfx.scene.add(world.group);
    this.gfx.setLights(world.lights);
  }

  dispose(): void {
    this.bldVisual.dispose();
    this.world.dispose();
    this.gfx.dispose();
    this.phys.dispose();
  }
}
