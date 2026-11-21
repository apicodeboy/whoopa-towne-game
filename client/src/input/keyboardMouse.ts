import { bindings } from './bindings';
import type { DeviceKind, InputContext, InputFrame, InputSource } from './types';

/** Radians of view rotation per pixel of mouse travel at sensitivity 1. */
const MOUSE_RAD_PER_PX = 0.0023;

/**
 * Desktop controls:
 *   WASD move · mouse aim · LMB fire · RMB aim · R reload · Shift sprint · C crouch (Ctrl = hold)
 *   Space jump · 1-3 weapons (1-4 in JUMP OFF THE PORCH) · wheel cycle · G throw · Q swap shoulder · Tab scoreboard · Esc pause
 *   E search / pick up · H heal · X drop weapon (JUMP OFF THE PORCH)
 *   hold B: the weapon and gadget wheel (point with the mouse, let go to pick)
 */
export class KeyboardMouseSource implements InputSource {
  readonly kind = 'kbm' as const;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private buttons = 0;
  /** Buttons pressed since the last frame (even if already released). */
  private buttonsHit = 0;
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  /** The weapon wheel key was down last frame. */
  private wheelKey = false;
  private active = false;
  private locked = false;
  private lockTarget: HTMLElement;
  private lastUnlockAt = 0;
  private disposers: Array<() => void> = [];
  /** Fired when pointer lock is gained or lost. */
  onLockChange: ((locked: boolean) => void) | null = null;
  /** When true, mouse movement is read even without pointer lock (automation / tests). */
  allowUnlockedLook = false;

  constructor(lockTarget: HTMLElement) {
    this.lockTarget = lockTarget;
    const on = <K extends keyof DocumentEventMap>(
      target: Document | Window | HTMLElement, type: K | string,
      fn: (e: never) => void, opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (this.gameplayKeys && PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.active = true;
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.buttons = 0;
    });
    on(document, 'mousemove', (e: MouseEvent) => {
      if (this.locked || this.allowUnlockedLook) {
        this.dx += e.movementX;
        this.dy += e.movementY;
        this.active = true;
      }
    });
    on(lockTarget, 'mousedown', (e: MouseEvent) => {
      if (!this.locked && !this.allowUnlockedLook) {
        if (this.gameplayKeys) this.requestLock();
        return; // the click that captures the mouse should not also fire
      }
      this.buttons |= 1 << e.button;
      this.buttonsHit |= 1 << e.button;
      this.active = true;
      e.preventDefault();
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      this.buttons &= ~(1 << e.button);
    });
    on(lockTarget, 'contextmenu', (e: Event) => e.preventDefault());
    on(lockTarget, 'wheel', (e: WheelEvent) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    on(document, 'pointerlockchange', () => {
      const now = document.pointerLockElement === this.lockTarget;
      if (now === this.locked) return;
      this.locked = now;
      if (!now) {
        this.buttons = 0;
        this.lastUnlockAt = performance.now();
      }
      this.onLockChange?.(now);
    });
    on(document, 'pointerlockerror', () => {
      this.locked = false;
    });
  }

  /** Set by the manager: whether gameplay keys should swallow browser defaults (Tab, Space...). */
  gameplayKeys = false;

  get isLocked(): boolean {
    return this.locked;
  }

  /** Asks the browser to capture the mouse. Must be called from a user gesture. */
  requestLock(): void {
    if (this.locked) return;
    // Browsers refuse to re-lock for ~1s after the user pressed Esc.
    if (performance.now() - this.lastUnlockAt < 1100) {
      setTimeout(() => {
        if (!this.locked && this.gameplayKeys) this.tryLock();
      }, 1150 - (performance.now() - this.lastUnlockAt));
      return;
    }
    this.tryLock();
  }

  private tryLock(): void {
    try {
      // Raw (unaccelerated) mouse input where supported.
      const p = (this.lockTarget.requestPointerLock as (o?: unknown) => unknown)({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          try {
            const q = this.lockTarget.requestPointerLock() as unknown;
            if (q && typeof (q as Promise<void>).catch === 'function') (q as Promise<void>).catch(() => undefined);
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* pointer lock unavailable (e.g. headless) */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.lockTarget) document.exitPointerLock();
  }

  deviceKind(): DeviceKind {
    return 'kbm';
  }

  apply(frame: InputFrame, ctx: InputContext): boolean {
    const used = this.active;
    this.active = false;
    const k = this.keys;
    const p = this.pressed;

    // Esc is swallowed by pointer lock; when not locked it reaches us as a key.
    if (p.has('Escape') || p.has('KeyP')) frame.pause = true;

    if (ctx.gameplay) {
      let mx = 0, mz = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (mx !== 0 || mz !== 0) {
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
        if (Math.hypot(frame.moveX, frame.moveZ) < 1) {
          frame.moveX = mx;
          frame.moveZ = mz;
        }
      }

      const s = ctx.settings;
      // the weapon wheel (held): the mouse points at a slot instead of turning the camera
      const wheelDown = k.has(bindings.keys.wheel);
      if (wheelDown) {
        frame.wheel = true;
        frame.wheelMouseX += this.dx;
        frame.wheelMouseY += this.dy;
      } else {
        const scale = MOUSE_RAD_PER_PX * s.mouseSens * (ctx.aiming ? s.aimSensMult * ctx.zoomScale : 1);
        frame.lookYaw -= this.dx * scale;
        frame.lookPitch -= this.dy * scale * (s.invertY ? -1 : 1);
      }
      if (this.wheelKey && !wheelDown) frame.wheelClose = true;
      this.wheelKey = wheelDown;

      const btn = this.buttons | this.buttonsHit;
      if (btn & 1 && !wheelDown) frame.fire = true;
      if (btn & 4) frame.aim = true;
      // keys from Settings → Controls (the default layout also keeps a few alternates)
      const b = bindings.keys;
      const alt = bindings.defaultKeys;
      const held = (code: string) => k.has(code) || p.has(code);
      if (held(b.jump)) frame.jump = true;
      if (k.has(b.sprint) || (alt && k.has('ShiftRight'))) frame.sprint = true;
      if (k.has(b.crouchHold) || (alt && k.has('ControlRight'))) frame.crouchHold = true;
      if (held(b.reload)) frame.reload = true;
      if (held(b.throw) || (btn & 2) !== 0) frame.throwBtn = true;
      if (k.has(b.scores)) frame.scoreboard = true;
      if (held(b.use) || (alt && held('KeyF'))) frame.use = true;
      if (held(b.heal)) frame.heal = true;
      if (held(b.drop)) frame.drop = true;

      if (p.has(b.crouch)) frame.crouchPress = true;
      if (p.has(b.shoulder) || (alt && p.has('KeyV'))) frame.swapShoulder = true;
      if (p.has('Digit1')) frame.slotSelect = 0;
      if (p.has('Digit2')) frame.slotSelect = 1;
      if (p.has('Digit3')) frame.slotSelect = 2;
      if (p.has('Digit4')) frame.slotSelect = 3;
      if (this.wheel !== 0) frame.slotCycle = this.wheel > 0 ? 1 : -1;
    } else {
      this.wheelKey = false;
    }

    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.buttonsHit = 0;
    p.clear();
    return used;
  }

  /** Test hook: synthesize mouse movement in pixels. */
  injectMouse(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.releaseLock();
  }
}

const PREVENT_DEFAULT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'Digit1', 'Digit2', 'Digit3', 'Digit4']);

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
