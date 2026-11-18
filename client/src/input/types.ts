import type { Settings } from '../core/settings';

/** Which physical device the player touched last (drives button prompts). */
export type DeviceKind = 'kbm' | 'xbox' | 'playstation' | 'gamepad' | 'touch';

/**
 * Everything the game reads from input devices for one rendered frame.
 * The manager clears it, then every source adds its contribution.
 */
export interface InputFrame {
  /** Strafe (-1..1, right positive) and forward (-1..1, forward positive). */
  moveX: number;
  moveZ: number;
  /** View deltas for this frame in radians, already scaled by sensitivity. Add directly to yaw / pitch. */
  lookYaw: number;
  lookPitch: number;

  // held buttons
  fire: boolean;
  aim: boolean;
  jump: boolean;
  sprint: boolean;
  /** Hold-style crouch (always crouches while true). */
  crouchHold: boolean;
  reload: boolean;
  throwBtn: boolean;
  scoreboard: boolean;
  /** JUMP OFF THE PORCH: search a bag / pick up, use a healing item, drop the weapon in hand. */
  use: boolean;
  heal: boolean;
  drop: boolean;
  /** Controller: interact if there is something to pick up, otherwise heal. */
  useOrHeal: boolean;

  // one-frame events
  crouchPress: boolean;
  /** Crouch pressed while sprinting forward: roll. */
  roll: boolean;
  sprintPress: boolean;
  swapShoulder: boolean;
  pause: boolean;
  /** Direct slot pick this frame (-1 = none). */
  slotSelect: number;
  /** Cycle primary/secondary this frame (-1, 0, +1). */
  slotCycle: number;

  // menu navigation (controller)
  navX: number;
  navY: number;
  accept: boolean;
  back: boolean;
}

export function makeInputFrame(): InputFrame {
  return {
    moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0,
    fire: false, aim: false, jump: false, sprint: false, crouchHold: false, reload: false, throwBtn: false, scoreboard: false,
    use: false, heal: false, drop: false, useOrHeal: false,
    crouchPress: false, roll: false, sprintPress: false, swapShoulder: false, pause: false, slotSelect: -1, slotCycle: 0,
    navX: 0, navY: 0, accept: false, back: false,
  };
}

export function clearInputFrame(f: InputFrame): void {
  f.moveX = 0; f.moveZ = 0; f.lookYaw = 0; f.lookPitch = 0;
  f.fire = false; f.aim = false; f.jump = false; f.sprint = false; f.crouchHold = false;
  f.reload = false; f.throwBtn = false; f.scoreboard = false;
  f.use = false; f.heal = false; f.drop = false; f.useOrHeal = false;
  f.crouchPress = false; f.roll = false; f.sprintPress = false; f.swapShoulder = false; f.pause = false;
  f.slotSelect = -1; f.slotCycle = 0;
  f.navX = 0; f.navY = 0; f.accept = false; f.back = false;
}

/** Gameplay context sources need to scale look speed correctly. */
export interface InputContext {
  settings: Settings;
  /** True while gameplay input should be read (false in menus). */
  gameplay: boolean;
  /** Player is aiming down sights. */
  aiming: boolean;
  /** Current camera FOV divided by the base FOV (ADS zoom slows look speed). */
  zoomScale: number;
  /** 0..1 aim-assist slowdown requested by the game (1 = no slowdown). */
  assistScale: number;
}

export interface InputSource {
  readonly kind: 'kbm' | 'gamepad' | 'touch';
  /** Adds this device's state to the frame. Returns true if the device was actively used. */
  apply(frame: InputFrame, ctx: InputContext, dt: number): boolean;
  /** Detected device flavor for prompts. */
  deviceKind(): DeviceKind;
  dispose(): void;
}
