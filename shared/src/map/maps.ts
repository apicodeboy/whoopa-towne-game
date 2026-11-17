import type { ModeId } from '../config/game';
import { getGreaterTowne } from './greaterTowne';
import type { MapDef } from './types';
import { getWhoopaTowne } from './whoopaTowne';

/** Which map a mode plays on: the classic modes keep the original town, the battle royale gets the whole city. */
export function mapForMode(mode: ModeId): MapDef {
  return mode === 'porch' ? getGreaterTowne() : getWhoopaTowne();
}
