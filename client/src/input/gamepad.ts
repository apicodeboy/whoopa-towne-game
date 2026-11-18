import { bindings } from './bindings';
import type { DeviceKind, InputContext, InputFrame, InputSource } from './types';

/** Standard Gamepad API button indices. */
const B = {
  SOUTH: 0, // A / Cross
  EAST: 1, // B / Circle
  WEST: 2, // X / Square
  NORTH: 3, // Y / Triangle
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8, // View / Create
  START: 9, // Menu / Options
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  TOUCHPAD: 17,
} as const;

/** Look speed at full stick deflection (radians / second) at sensitivity 1. */
const YAW_SPEED = 3.6;
const PITCH_SPEED = 2.3;
const TRIGGER_THRESHOLD = 0.25;
const NAV_REPEAT_FIRST = 0.38;
const NAV_REPEAT = 0.13;

/** Which family of controller this is, from the id string browsers report. */
export function detectPadKind(id: string): DeviceKind {
  const s = id.toLowerCase();
  // Xbox first: its id also contains "Wireless Controller", which is all a DualShock 4 reports in some browsers.
  if (/xbox|xinput|045e|microsoft|x-box/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|ps5|ps4|054c|sony|wireless controller/.test(s)) return 'playstation';
  return 'gamepad';
}

/** Radial deadzone with rescale so motion starts at zero just outside the deadzone. */
function applyDeadzone(x: number, y: number, dz: number, out: { x: number; y: number }): void {
  const len = Math.hypot(x, y);
  if (len <= dz || len === 0) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const k = Math.min(1, (len - dz) / (1 - dz)) / len;
  out.x = x * k;
  out.y = y * k;
}

/**
 * Xbox / PS5 DualSense (and any "standard" mapped pad) through the Gamepad API.
 *
 *   Left stick move · Right stick look · RT/R2 fire · LT/L2 aim · A/Cross jump · B/Circle crouch
 *   X/Square reload · Y/Triangle switch weapon · LB/L1 throw · RB/R1 swap shoulder · L3 sprint
 *   D-pad weapon slots · View/Create (or touchpad) scoreboard · Menu/Options pause
 */
export class GamepadSource implements InputSource {
  readonly kind = 'gamepad' as const;
  private padKind: DeviceKind = 'gamepad';
  private prev: boolean[] = [];
  private stick = { x: 0, y: 0 };
  private navTimer = 0;
  private navDirX = 0;
  private navDirY = 0;
  private lookRamp = 0;
  private index = -1;
  private padId = '';
  /** Fired when a controller is plugged in / removed. */
  onConnection: ((connected: boolean, kind: DeviceKind, id: string) => void) | null = null;
  private onConnect = (e: GamepadEvent) => {
    this.index = e.gamepad.index;
    this.padKind = detectPadKind(e.gamepad.id);
    this.onConnection?.(true, this.padKind, e.gamepad.id);
  };
  private onDisconnect = (e: GamepadEvent) => {
    if (e.gamepad.index === this.index) this.index = -1;
    this.onConnection?.(false, this.padKind, e.gamepad.id);
  };

  constructor() {
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  deviceKind(): DeviceKind {
    return this.padKind;
  }

  /** The pad we are reading (first connected one, preferring the standard mapping). */
  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let found: Gamepad | null = null;
    const preferred = this.index >= 0 ? pads[this.index] : null;
    if (preferred && preferred.connected) found = preferred;
    else {
      for (const p of pads) {
        if (p && p.connected && (p.mapping === 'standard' || !found)) {
          found = p;
          if (p.mapping === 'standard') break;
        }
      }
    }
    if (found && (found.index !== this.index || found.id !== this.padId)) {
      this.index = found.index;
      this.padId = found.id;
      this.padKind = detectPadKind(found.id);
    }
    return found;
  }

  get connected(): boolean {
    return this.pad() !== null;
  }

  /** Short rumble (hits taken, explosions). */
  rumble(strong: number, weak: number, ms: number): void {
    const pad = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | null;
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return;
    act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }

  apply(frame: InputFrame, ctx: InputContext, dt: number): boolean {
    const pad = this.pad();
    if (!pad) {
      this.prev.length = 0;
      return false;
    }
    const s = ctx.settings;
    const btn = (i: number): boolean => {
      const b = pad.buttons[i];
      return !!b && (b.pressed || b.value > TRIGGER_THRESHOLD);
    };
    const pressed = (i: number): boolean => btn(i) && !this.prev[i];
    let active = false;

    // ---- sticks ----
    const st = this.stick;
    applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, s.deadzoneLeft, st);
    const lx = st.x, ly = st.y;
    applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, s.deadzoneRight, st);
    const rx = st.x, ry = st.y;
    if (lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0) active = true;

    if (ctx.gameplay) {
      if (Math.hypot(lx, ly) > Math.hypot(frame.moveX, frame.moveZ)) {
        frame.moveX = lx;
        frame.moveZ = -ly;
      }
      // response curve: fine control near the center, full speed at the edge, a little extra
      // turn speed after holding the stick hard over (so 180s do not take forever)
      const mag = Math.hypot(rx, ry);
      if (mag > 0) {
        this.lookRamp = mag > 0.92 ? Math.min(1, this.lookRamp + dt * 2.2) : 0;
        const curve = Math.pow(mag, 1.7) / mag;
        const zoom = ctx.aiming ? s.aimSensMult * ctx.zoomScale : 1;
        const k = s.stickSens * curve * zoom * ctx.assistScale * (1 + this.lookRamp * 0.45) * dt;
        frame.lookYaw -= rx * YAW_SPEED * k;
        frame.lookPitch -= ry * PITCH_SPEED * k * (s.invertY ? -1 : 1);
      } else {
        this.lookRamp = 0;
      }

      // buttons from Settings → Controls
      const m = bindings.pad;
      if (btn(m.fire)) frame.fire = true;
      if (btn(m.aim)) frame.aim = true;
      if (btn(m.jump)) frame.jump = true;
      if (btn(m.reload)) frame.reload = true;
      if (btn(m.throw)) frame.throwBtn = true;
      if (btn(m.scores) || (m.scores === B.SELECT && btn(B.TOUCHPAD))) frame.scoreboard = true;
      if (pressed(m.crouch)) frame.crouchPress = true;
      if (pressed(m.sprint)) frame.sprintPress = true;
      if (pressed(m.shoulder)) frame.swapShoulder = true;
      if (pressed(m.swap)) frame.slotCycle = 1;
      if (pressed(B.LEFT)) frame.slotSelect = 0;
      if (pressed(B.RIGHT)) frame.slotSelect = 1;
      if (pressed(B.UP)) frame.slotSelect = 2;
      // search and heal on one button: it picks up when there is something in reach, heals otherwise
      if (m.use === m.heal) {
        if (btn(m.use)) frame.useOrHeal = true;
      } else {
        if (btn(m.use)) frame.use = true;
        if (btn(m.heal)) frame.heal = true;
      }
    } else {
      // ---- menu navigation: d-pad or left stick, with key-repeat ----
      let nx = 0, ny = 0;
      if (btn(B.LEFT) || lx < -0.6) nx = -1;
      else if (btn(B.RIGHT) || lx > 0.6) nx = 1;
      if (btn(B.UP) || ly < -0.6) ny = -1;
      else if (btn(B.DOWN) || ly > 0.6) ny = 1;
      if (nx !== this.navDirX || ny !== this.navDirY) {
        this.navDirX = nx;
        this.navDirY = ny;
        this.navTimer = NAV_REPEAT_FIRST;
        frame.navX = nx;
        frame.navY = ny;
      } else if (nx !== 0 || ny !== 0) {
        this.navTimer -= dt;
        if (this.navTimer <= 0) {
          this.navTimer = NAV_REPEAT;
          frame.navX = nx;
          frame.navY = ny;
        }
      }
      if (pressed(B.SOUTH)) frame.accept = true;
      if (pressed(B.EAST)) frame.back = true;
    }
    if (pressed(B.START)) frame.pause = true;

    for (let i = 0; i < pad.buttons.length; i++) {
      const down = btn(i);
      if (down) active = true;
      this.prev[i] = down;
    }
    return active;
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }
}
