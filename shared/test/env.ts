import RAPIER from '@dimforge/rapier3d-compat';
import { getWhoopaTowne, PhysicsWorld, type MapDef } from '../src/index';

let ready: Promise<void> | null = null;
export async function initRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init();
  await ready;
  return RAPIER;
}

export async function makeWorld(): Promise<{ map: MapDef; phys: PhysicsWorld }> {
  const R = await initRapier();
  const map = getWhoopaTowne();
  return { map, phys: new PhysicsWorld(R, map) };
}
