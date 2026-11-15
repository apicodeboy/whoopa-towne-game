import type { SettingsStore } from '../core/settings';
import { GamepadSource } from './gamepad';
import { KeyboardMouseSource } from './keyboardMouse';
import type { TouchSource } from './touch';
import { clearInputFrame, makeInputFrame, type DeviceKind, type InputContext, type InputFrame, type InputSource } from './types';

/**
 * Merges every input device into one InputFrame per rendered frame and keeps the
 * small bits of persistent input state (crouch toggle, selected weapon slot, active device).
 */
export class InputManager {
  readonly frame: InputFrame = makeInputFrame();
  readonly ctx: InputContext;
  readonly kbm: KeyboardMouseSource;
  readonly gamepad: GamepadSource;
  /** On-screen controls (attached by the app once the UI exists). */
  touch: TouchSource | null = null;
  private sources: InputSource[] = [];
  private deviceListeners = new Set<(d: DeviceKind) => void>();

  /** Resolved crouch state (toggle or hold, depending on settings and device). */
  crouch = false;
  /** Sprint latch for devices where sprint is a click (stick click / touch). */
  private sprintLatch = false;
  /** Weapon slot the player wants out. */
  slot = 0;
  private lastGunSlot = 0;
  /** Device touched most recently. */
  device: DeviceKind = 'kbm';

  constructor(settings: SettingsStore, lockTarget: HTMLElement) {
    this.ctx = { settings: settings.values, gameplay: false, aiming: false, zoomScale: 1, assistScale: 1 };
    this.kbm = new KeyboardMouseSource(lockTarget);
    this.gamepad = new GamepadSource();
    this.sources.push(this.kbm, this.gamepad);
  }

  attachTouch(source: TouchSource): void {
    this.touch = source;
    this.sources.push(source);
  }

  /** True when the active device is a controller. */
  get usingPad(): boolean {
    return this.device === 'xbox' || this.device === 'playstation' || this.device === 'gamepad';
  }

  /** Controller vibration (no-op for other devices or when disabled in settings). */
  rumble(strong: number, weak: number, ms: number): void {
    if (this.usingPad && this.ctx.settings.vibration) this.gamepad.rumble(strong, weak, ms);
  }

  /** Enable/disable gameplay input (menus keep navigation only). */
  setGameplay(on: boolean): void {
    this.ctx.gameplay = on;
    this.kbm.gameplayKeys = on;
    if (!on) {
      this.crouch = false;
      this.sprintLatch = false;
    }
  }

  onDeviceChange(fn: (d: DeviceKind) => void): () => void {
    this.deviceListeners.add(fn);
    return () => this.deviceListeners.delete(fn);
  }

  private setDevice(d: DeviceKind): void {
    if (d === this.device) return;
    this.device = d;
    for (const l of this.deviceListeners) l(d);
  }

  /** Forces the active device (e.g. first touch on a phone). */
  noteDevice(d: DeviceKind): void {
    this.setDevice(d);
  }

  /** Poll all devices. Call once per rendered frame before reading `frame`. */
  update(dt: number): InputFrame {
    const f = this.frame;
    clearInputFrame(f);
    for (const src of this.sources) {
      if (src.apply(f, this.ctx, dt)) this.setDevice(src.deviceKind());
    }

    if (this.ctx.gameplay) {
      // crouch: toggle on press (if enabled), hold always works
      if (f.crouchPress) {
        if (this.ctx.settings.crouchToggle) this.crouch = !this.crouch;
      }
      if (f.jump || f.sprint || f.sprintPress) {
        // jumping or sprinting stands you up out of a toggled crouch
        if (this.crouch && this.ctx.settings.crouchToggle) this.crouch = false;
      }
      // sprint latch (stick click / touch): stays on until you stop pushing forward
      if (f.sprintPress) this.sprintLatch = !this.sprintLatch;
      if (this.sprintLatch) {
        if (f.moveZ < 0.4 || f.aim || f.crouchHold) this.sprintLatch = false;
        else f.sprint = true;
      }

      if (f.slotSelect >= 0) this.selectSlot(f.slotSelect);
      else if (f.slotCycle !== 0) this.selectSlot(this.slot === 0 ? 1 : 0);
    }
    return f;
  }

  /** True if the player should be crouching this frame. */
  get wantCrouch(): boolean {
    return this.crouch || this.frame.crouchHold;
  }

  selectSlot(slot: number): void {
    if (slot < 0 || slot > 2) return;
    if (this.slot < 2) this.lastGunSlot = this.slot;
    this.slot = slot;
  }

  /** The game calls this when the simulation changed the slot on its own (e.g. out of throwables). */
  syncSlot(slot: number): void {
    this.slot = slot;
    if (slot < 2) this.lastGunSlot = slot;
  }

  get previousGunSlot(): number {
    return this.lastGunSlot;
  }

  resetMatchState(): void {
    this.crouch = false;
    this.sprintLatch = false;
    this.slot = 0;
    this.lastGunSlot = 0;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
  }
}
