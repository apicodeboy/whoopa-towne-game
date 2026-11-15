import { TICK_DT } from '@shared/config/game';
import type { Loadout } from '@shared/config/weapons';
import type { PhysicsWorld } from '@shared/sim/physics';
import {
  copyInputCmd, copyPlayerState, makeInputCmd, makePlayerState, makeStepActions, playerStateDiffers, stepPlayer,
  type InputCmd, type PlayerState, type StepActions,
} from '@shared/sim/player';

interface Pending {
  cmd: InputCmd;
  after: PlayerState;
}

const MAX_PENDING = 240;
/** Position error above this is a teleport (respawn), not a misprediction: snap instead of smoothing. */
const SNAP_DISTANCE = 2.5;

/**
 * Client-side prediction for the local player.
 *
 * Every tick the local input is applied immediately with the same `stepPlayer` the server
 * runs, and remembered. When the server acknowledges input N with its authoritative state,
 * we compare it to what we predicted after N. If they differ we rewind to the server state
 * and replay every input after N, then hide the pop by decaying a visual offset.
 */
export class Predictor {
  /** Latest predicted state. */
  readonly state: PlayerState = makePlayerState();
  /** State one tick earlier (for render interpolation between ticks). */
  readonly prev: PlayerState = makePlayerState();
  readonly actions: StepActions = makeStepActions();
  seq = 0;
  /** Number of corrections applied (debug / netgraph). */
  corrections = 0;

  private pending: Pending[] = [];
  private pool: Pending[] = [];
  private replayActions: StepActions = makeStepActions();
  private errX = 0;
  private errY = 0;
  private errZ = 0;
  /** The server state (and its ack) the prediction was last confirmed against / rebased on. */
  private baseAck = -1;
  private base: PlayerState = makePlayerState();

  /** Hard reset (spawn / teleport): no smoothing, no pending inputs replayed onto it. */
  reset(state: PlayerState): void {
    copyPlayerState(this.state, state);
    copyPlayerState(this.prev, state);
    for (const p of this.pending) this.pool.push(p);
    this.pending.length = 0;
    this.errX = this.errY = this.errZ = 0;
  }

  /** Predict one tick. The command must already carry its sequence number. */
  step(cmd: InputCmd, phys: PhysicsWorld, loadout: Loadout, frozen: boolean): StepActions {
    copyPlayerState(this.prev, this.state);
    stepPlayer(this.state, cmd, TICK_DT, phys, loadout, this.actions, frozen);
    const entry = this.pool.pop() ?? { cmd: makeInputCmd(), after: makePlayerState() };
    copyInputCmd(entry.cmd, cmd);
    copyPlayerState(entry.after, this.state);
    this.pending.push(entry);
    if (this.pending.length > MAX_PENDING) this.pool.push(this.pending.shift()!);
    return this.actions;
  }

  /**
   * Remember a command that was sent but not simulated locally (we are dead). If the server
   * respawns us before we find out, these get replayed on top of the fresh spawn state.
   */
  record(cmd: InputCmd): void {
    const entry = this.pool.pop() ?? { cmd: makeInputCmd(), after: makePlayerState() };
    copyInputCmd(entry.cmd, cmd);
    copyPlayerState(entry.after, this.state);
    this.pending.push(entry);
    if (this.pending.length > MAX_PENDING) this.pool.push(this.pending.shift()!);
  }

  /**
   * Reconcile with the authoritative state the server computed after processing input `ack`.
   * Returns true if a correction was applied. With `force` the server state is always
   * adopted and the result snaps into place (respawns).
   */
  reconcile(ack: number, server: PlayerState, phys: PhysicsWorld, loadout: Loadout, frozen: boolean, force = false): boolean {
    let predicted: PlayerState | null = null;
    while (this.pending.length > 0 && this.pending[0].cmd.seq <= ack) {
      const e = this.pending.shift()!;
      if (e.cmd.seq === ack) predicted = e.after;
      this.pool.push(e);
    }
    if (!force) {
      let agrees = false;
      if (predicted) agrees = !playerStateDiffers(predicted, server);
      else if (this.pending.length === 0) agrees = !playerStateDiffers(this.state, server);
      // Same ack and same state as last time (server has not processed anything new): nothing to redo.
      else agrees = ack === this.baseAck && !playerStateDiffers(this.base, server);
      if (agrees) {
        this.baseAck = ack;
        copyPlayerState(this.base, server);
        return false;
      }
    }
    this.baseAck = ack;
    copyPlayerState(this.base, server);

    const ox = this.state.x, oy = this.state.y, oz = this.state.z;
    copyPlayerState(this.state, server);
    copyPlayerState(this.prev, server);
    for (let i = 0; i < this.pending.length; i++) {
      const e = this.pending[i];
      if (i === this.pending.length - 1) copyPlayerState(this.prev, this.state);
      stepPlayer(this.state, e.cmd, TICK_DT, phys, loadout, this.replayActions, frozen);
      copyPlayerState(e.after, this.state);
    }
    const dx = ox - this.state.x, dy = oy - this.state.y, dz = oz - this.state.z;
    if (force || dx * dx + dy * dy + dz * dz > SNAP_DISTANCE * SNAP_DISTANCE) {
      this.errX = this.errY = this.errZ = 0;
      copyPlayerState(this.prev, this.state);
    } else {
      this.errX += dx;
      this.errY += dy;
      this.errZ += dz;
    }
    this.corrections++;
    return true;
  }

  /** Decays the visual correction offset. Call once per rendered frame. */
  decayError(dt: number): void {
    const k = Math.exp(-dt * 14);
    this.errX *= k;
    this.errY *= k;
    this.errZ *= k;
  }

  /** Smooth render position: interpolated between the last two ticks plus the decaying correction offset. */
  renderPosition(alpha: number, out: { x: number; y: number; z: number }): void {
    const a = this.prev, b = this.state;
    out.x = a.x + (b.x - a.x) * alpha + this.errX;
    out.y = a.y + (b.y - a.y) * alpha + this.errY;
    out.z = a.z + (b.z - a.z) * alpha + this.errZ;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
