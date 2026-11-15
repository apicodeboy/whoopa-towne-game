import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;

/** Loads the Rapier WASM module once for the whole process. */
export function initRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

/** The initialized Rapier module. Call initRapier() first. */
export function getRapier(): typeof RAPIER {
  return RAPIER;
}
