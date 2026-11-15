import { el } from '../ui/dom';
import type { DeviceKind, InputContext, InputFrame, InputSource } from './types';

/** Radians of view rotation per CSS pixel of finger travel at sensitivity 1. */
const LOOK_RAD_PER_PX = 0.0052;
const STICK_RADIUS = 58;

type HoldButton = 'fire' | 'jump' | 'reload' | 'throw' | 'scores';

/**
 * Mobile controls: a floating virtual stick on the left half of the screen, drag anywhere
 * on the right half to look, and on-screen buttons for fire / aim / reload / jump / crouch /
 * weapon swap / throw. Dragging while holding FIRE keeps aiming, so you can track a target.
 */
export class TouchSource implements InputSource {
  readonly kind = 'touch' as const;
  readonly root: HTMLElement;
  private surface: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private aimBtn: HTMLElement;
  private crouchBtn: HTMLElement;

  private stickId = -1;
  private stickOx = 0;
  private stickOy = 0;
  private moveX = 0;
  private moveZ = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private dx = 0;
  private dy = 0;
  private held: Record<HoldButton, boolean> = { fire: false, jump: false, reload: false, throw: false, scores: false };
  private hit: Record<HoldButton, boolean> = { fire: false, jump: false, reload: false, throw: false, scores: false };
  private fireId = -1;
  private fireX = 0;
  private fireY = 0;
  private aimOn = false;
  private pressCrouch = false;
  private pressSwap = false;
  private pressShoulder = false;
  private pressPause = false;
  private used = false;
  private everTouched = false;
  private disposers: Array<() => void> = [];
  /** Called the first time the screen is touched. */
  onFirstTouch: (() => void) | null = null;

  constructor(surface: HTMLElement, uiRoot: HTMLElement) {
    this.surface = surface;
    this.stickKnob = el('div', 't-knob');
    this.stickBase = el('div', 't-stick hidden', [this.stickKnob]);

    const hold = (name: HoldButton, label: string, cls: string): HTMLElement => {
      const b = el('div', `tb ${cls}`, label);
      this.bind(b, 'touchstart', (e) => {
        e.preventDefault();
        this.held[name] = true;
        this.hit[name] = true;
        this.used = true;
        b.classList.add('down');
        if (name === 'fire') {
          const t = e.changedTouches[0];
          this.fireId = t.identifier;
          this.fireX = t.clientX;
          this.fireY = t.clientY;
        }
      });
      const up = (e: TouchEvent) => {
        e.preventDefault();
        this.held[name] = false;
        b.classList.remove('down');
        if (name === 'fire') this.fireId = -1;
      };
      this.bind(b, 'touchend', up);
      this.bind(b, 'touchcancel', up);
      if (name === 'fire') {
        // dragging on the fire button keeps turning the camera
        this.bind(b, 'touchmove', (e) => {
          e.preventDefault();
          for (const t of Array.from(e.changedTouches)) {
            if (t.identifier !== this.fireId) continue;
            this.dx += t.clientX - this.fireX;
            this.dy += t.clientY - this.fireY;
            this.fireX = t.clientX;
            this.fireY = t.clientY;
          }
        });
      }
      return b;
    };
    const tap = (label: string, cls: string, fn: () => void): HTMLElement => {
      const b = el('div', `tb ${cls}`, label);
      this.bind(b, 'touchstart', (e) => {
        e.preventDefault();
        this.used = true;
        b.classList.add('down');
        fn();
      });
      const up = (e: TouchEvent) => {
        e.preventDefault();
        b.classList.remove('down');
      };
      this.bind(b, 'touchend', up);
      this.bind(b, 'touchcancel', up);
      return b;
    };

    this.aimBtn = tap('AIM', 'aim', () => {
      this.aimOn = !this.aimOn;
      this.aimBtn.classList.toggle('on', this.aimOn);
    });
    this.crouchBtn = tap('CROUCH', 'crouch', () => (this.pressCrouch = true));
    this.root = el('div', 'touch hidden', [
      this.stickBase,
      hold('fire', 'FIRE', 'fire'),
      this.aimBtn,
      hold('jump', 'JUMP', 'jump'),
      hold('reload', 'RELOAD', 'reload'),
      this.crouchBtn,
      tap('SWAP', 'swap', () => (this.pressSwap = true)),
      hold('throw', 'THROW', 'throw'),
      tap('⇄', 'shoulder', () => (this.pressShoulder = true)),
      hold('scores', 'SCORES', 'scores'),
      tap('II', 'pause', () => (this.pressPause = true)),
    ]);
    uiRoot.append(this.root);

    // ---- stick + look on the play surface ----
    this.bind(surface, 'touchstart', (e) => {
      this.noteTouch();
      if (this.root.classList.contains('hidden')) return;
      e.preventDefault();
      const w = surface.clientWidth;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < w * 0.45 && this.stickId < 0) {
          this.stickId = t.identifier;
          this.stickOx = t.clientX;
          this.stickOy = t.clientY;
          this.stickBase.style.left = `${t.clientX}px`;
          this.stickBase.style.top = `${t.clientY}px`;
          this.stickKnob.style.transform = 'translate(0px, 0px)';
          this.stickBase.classList.remove('hidden');
        } else if (this.lookId < 0) {
          this.lookId = t.identifier;
          this.lookX = t.clientX;
          this.lookY = t.clientY;
        }
      }
    }, { passive: false });
    this.bind(surface, 'touchmove', (e) => {
      if (this.root.classList.contains('hidden')) return;
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          let ox = t.clientX - this.stickOx, oy = t.clientY - this.stickOy;
          const len = Math.hypot(ox, oy);
          if (len > STICK_RADIUS) {
            ox *= STICK_RADIUS / len;
            oy *= STICK_RADIUS / len;
          }
          this.stickKnob.style.transform = `translate(${ox}px, ${oy}px)`;
          this.moveX = ox / STICK_RADIUS;
          this.moveZ = -oy / STICK_RADIUS;
          this.used = true;
        } else if (t.identifier === this.lookId) {
          this.dx += t.clientX - this.lookX;
          this.dy += t.clientY - this.lookY;
          this.lookX = t.clientX;
          this.lookY = t.clientY;
          this.used = true;
        }
      }
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          this.stickId = -1;
          this.moveX = 0;
          this.moveZ = 0;
          this.stickBase.classList.add('hidden');
        } else if (t.identifier === this.lookId) {
          this.lookId = -1;
        }
      }
    };
    this.bind(surface, 'touchend', end);
    this.bind(surface, 'touchcancel', end);
    // any touch anywhere (menus included) marks this as a touch device
    this.bind(window, 'touchstart', () => this.noteTouch(), { passive: true });
  }

  private bind(target: EventTarget, type: string, fn: (e: TouchEvent) => void, opts?: AddEventListenerOptions): void {
    const o = opts ?? { passive: false };
    target.addEventListener(type, fn as EventListener, o);
    this.disposers.push(() => target.removeEventListener(type, fn as EventListener, o));
  }

  private noteTouch(): void {
    this.used = true;
    if (!this.everTouched) {
      this.everTouched = true;
      this.onFirstTouch?.();
    }
  }

  get seen(): boolean {
    return this.everTouched;
  }

  deviceKind(): DeviceKind {
    return 'touch';
  }

  /** Show / hide the on-screen controls. */
  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.release();
  }

  private release(): void {
    this.stickId = -1;
    this.lookId = -1;
    this.fireId = -1;
    this.moveX = 0;
    this.moveZ = 0;
    this.dx = 0;
    this.dy = 0;
    for (const k of Object.keys(this.held) as HoldButton[]) this.held[k] = false;
    this.stickBase.classList.add('hidden');
    for (const b of Array.from(this.root.querySelectorAll('.tb.down'))) b.classList.remove('down');
  }

  /** Reset per-match toggles. */
  resetToggles(): void {
    this.aimOn = false;
    this.aimBtn.classList.remove('on');
  }

  /** Reflect the resolved crouch state on the button. */
  setCrouchLit(on: boolean): void {
    this.crouchBtn.classList.toggle('on', on);
  }

  apply(frame: InputFrame, ctx: InputContext): boolean {
    const used = this.used;
    this.used = false;
    if (this.pressPause) frame.pause = true;
    this.pressPause = false;

    if (ctx.gameplay) {
      if (Math.hypot(this.moveX, this.moveZ) > Math.hypot(frame.moveX, frame.moveZ)) {
        frame.moveX = this.moveX;
        frame.moveZ = this.moveZ;
      }
      // stick pushed all the way forward = sprint
      if (this.moveZ > 0.7 && Math.hypot(this.moveX, this.moveZ) > 0.93 && !this.aimOn) frame.sprint = true;

      const s = ctx.settings;
      const k = LOOK_RAD_PER_PX * s.touchSens * (ctx.aiming ? s.aimSensMult * ctx.zoomScale : 1) * ctx.assistScale;
      frame.lookYaw -= this.dx * k;
      frame.lookPitch -= this.dy * k * (s.invertY ? -1 : 1);

      if (this.held.fire || this.hit.fire) frame.fire = true;
      if (this.aimOn) frame.aim = true;
      if (this.held.jump || this.hit.jump) frame.jump = true;
      if (this.held.reload || this.hit.reload) frame.reload = true;
      if (this.held.throw || this.hit.throw) frame.throwBtn = true;
      if (this.held.scores) frame.scoreboard = true;
      if (this.pressCrouch) frame.crouchPress = true;
      if (this.pressSwap) frame.slotCycle = 1;
      if (this.pressShoulder) frame.swapShoulder = true;
    }
    this.dx = 0;
    this.dy = 0;
    this.pressCrouch = false;
    this.pressSwap = false;
    this.pressShoulder = false;
    for (const key of Object.keys(this.hit) as HoldButton[]) this.hit[key] = false;
    return used;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.remove();
  }
}
