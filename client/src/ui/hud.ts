import { CREWS, crewLogoSvg, type TeamId } from '@shared/config/crews';
import { MODES, type ModeId } from '@shared/config/game';
import { THROWABLES, WEAPONS, WEAPON_IDS, type Loadout, type WeaponId } from '@shared/config/weapons';
import type { MapDef } from '@shared/map/types';
import { DEG, wrapAngle, yawToward } from '@shared/math';
import { KILL_GRENADE, KILL_RIOT, KILL_WORLD, PHASE, type Phase, type SnapZone } from '@shared/protocol';
import type { DeviceKind } from '../input/types';
import { el } from './dom';
import { FIST_OUTLINE, FIST_SVG, FIST_URL } from './handIcon';
import { Minimap } from './minimap';
import { GAMEPLAY_LEGEND, PORCH_LEGEND, glyphHtml, legendHtml } from './prompts';

export interface HudPlayerRow {
  idx: number;
  name: string;
  team: TeamId;
  bot: boolean;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  alive: boolean;
  me: boolean;
  x: number;
  z: number;
  yaw: number;
}

/** Everything the HUD draws, refreshed by the game every frame. */
export interface HudState {
  mode: ModeId;
  phase: Phase;
  timeLeft: number;
  scores: [number, number];
  zones: SnapZone[];
  /** Index of the capture zone the player is standing in, -1 for none. */
  myZone: number;
  myTeam: TeamId;
  alive: boolean;
  health: number;
  /** Armor on top of health (0..100, four segments of 25), or -1 where there is none (crew modes). */
  armor: number;
  spawnProtected: boolean;
  loadout: Loadout;
  slot: number;
  mag: number;
  reserve: number;
  magSize: number;
  /** 0..1 reload progress, -1 when not reloading. */
  reload: number;
  throwables: number;
  spreadDeg: number;
  /** Camera vertical FOV in degrees (to turn spread into pixels). */
  fovV: number;
  aimT: number;
  /** The muzzle is obstructed: shots will hit nearby cover. */
  blocked: boolean;
  /** Reticle is over an enemy. */
  onTarget: boolean;
  respawnIn: number;
  killer: string;
  showScoreboard: boolean;
  players: HudPlayerRow[];
  /** Danger marks up right now (yours and your squad's), for the minimap. */
  marks?: Array<{ x: number; z: number; age: number }>;
  myX: number;
  myZ: number;
  viewYaw: number;
  ping: number;
  fps: number;
  /** Dynamic resolution scale, 1 = full. */
  resScale: number;
  showFps: boolean;
  /** What is in hand (name), whether it is a gun / melee (else a throwable). */
  weaponName?: string;
  /** Id of what is in hand for its picture (weapon or throwable id; '' = nothing / fists). */
  weaponId?: string;
  /** Health still to come from an orange. */
  regen?: number;
  /** The crosshair of what is in hand (see Reticle in the weapons config). */
  reticle?: string;
  /** Looking down a scope: the scope fills the screen. */
  scoped?: boolean;
  gun?: boolean;
  melee?: boolean;
  /** JUMP OFF THE PORCH: the safe area and where the riot is heading (minimap). */
  porch?: { zone: { x: number; z: number; r: number }; next: { x: number; z: number; r: number } } | null;
}

export function makeHudState(): HudState {
  return {
    mode: 'tdm', phase: PHASE.WARMUP, timeLeft: 0, scores: [0, 0], zones: [], myZone: -1, myTeam: 0,
    alive: true, health: 100, armor: -1, spawnProtected: false,
    loadout: { primary: 'draco', secondary: 'taurus', throwable: 'grenade', melee: 'knife' }, slot: 0,
    mag: 0, reserve: 0, magSize: 30, reload: -1, throwables: 0,
    spreadDeg: 1, fovV: 60, aimT: 0, blocked: false, onTarget: false,
    respawnIn: 0, killer: '', showScoreboard: false, players: [],
    myX: 0, myZ: 0, viewYaw: 0, ping: 0, fps: 0, resScale: 1, showFps: false,
  };
}

export type HitKind = 'hit' | 'head' | 'kill';

/** The knife, for the ammo box (it has no rounds to count). */
const KNIFE_SVG = '<svg class="knife" viewBox="0 0 64 24" aria-hidden="true"><path d="M4 9.5h21l2-3h5v11h-5l-2-3H4z" fill="#3a3c41" stroke="#16171a" stroke-width="2" stroke-linejoin="round"/><path d="M32 7h19c5 0 9 2.5 11 5.5L53 17H32z" fill="#dfe3e7" stroke="#16171a" stroke-width="2" stroke-linejoin="round"/></svg>';

const WEAPON_ICONS: Record<string, string> = {
  smg: '<svg viewBox="0 0 48 20"><path d="M2 6h30v3h10v2H32v2h-8v6h-4v-6h-6l-3 6H7l2-6H2z"/></svg>',
  ar: '<svg viewBox="0 0 48 20"><path d="M1 7h8l2-2h20v2h14v2H31v3h-6l-1 7h-4l1-7h-8l-3 5H6l2-5H1z"/></svg>',
  shotgun: '<svg viewBox="0 0 48 20"><path d="M1 8h10l2-2h33v2H26v2h20v2H24v2H13l-2 4H6l1-4H1z"/></svg>',
  pistol: '<svg viewBox="0 0 48 20"><path d="M12 4h24v5H24l-1 3h-4l-2 7h-5l2-8h-2z"/></svg>',
  grenade: '<svg viewBox="0 0 48 20"><circle cx="24" cy="12" r="7"/><path d="M21 2h7v4h-7z"/></svg>',
  world: '<svg viewBox="0 0 48 20"><path d="M24 2l9 16H15z"/></svg>',
  sniper: '<svg viewBox="0 0 48 20"><path d="M0 9h12l2-2h22v2h12v2H34v2h-7l-2 6h-4l1-6h-6l-4 5h-5l3-5H0z"/><path d="M16 3h12v3H16z"/></svg>',
  fists: FIST_OUTLINE,
  riot: '<svg viewBox="0 0 48 20"><circle cx="14" cy="6" r="3"/><circle cx="24" cy="5" r="3"/><circle cx="34" cy="6" r="3"/><path d="M9 19l2-9h6l2 9zM19 19l2-10h6l2 10zM29 19l2-9h6l2 9z"/></svg>',
};

function weaponIcon(code: number): string {
  if (code === KILL_GRENADE) return WEAPON_ICONS.grenade;
  if (code === KILL_WORLD) return WEAPON_ICONS.world;
  if (code === KILL_RIOT) return WEAPON_ICONS.riot;
  return iconFor(WEAPON_IDS[code] ?? 'draco');
}

/** A gun's little outline (by the kind of gun it is). */
function iconFor(id: string): string {
  const cls = WEAPONS[id as WeaponId]?.cls;
  const key = cls === 'rifle' ? 'ar' : cls === 'dmr' || cls === 'sniper' ? 'sniper' : cls === 'smg' ? 'smg' : cls === 'shotgun' ? 'shotgun'
    : cls === 'pistol' || cls === 'revolver' ? 'pistol' : cls === 'melee' ? 'fists' : id;
  return WEAPON_ICONS[key] ?? WEAPON_ICONS.ar;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface DamageArc {
  node: HTMLElement;
  x: number;
  z: number;
  life: number;
}

/**
 * In-match HUD: health, ammo, reticle with live spread, hit markers, damage direction,
 * kill feed, score/timer bar, zone status, minimap, scoreboard, respawn + announcements.
 * Plain DOM, updated with change detection so idle frames touch nothing.
 */
export class Hud {
  readonly root: HTMLElement;
  private minimap: Minimap;

  private scoreEls: [HTMLElement, HTMLElement];
  private timeEl: HTMLElement;
  private modeEl: HTMLElement;
  private zonesEl: HTMLElement;
  private zoneChips: HTMLElement[] = [];
  private healthFill: HTMLElement;
  private regenFill: HTMLElement;
  private healthNum: HTMLElement;
  private healthBox: HTMLElement;
  /** Ibuprofen armor: four segments of 25 over the health bar. */
  private armorEl: HTMLElement;
  private armorSegs: HTMLElement[];
  private gunPic: HTMLElement;
  private gunPicImg: HTMLImageElement;
  private gunPicName: HTMLElement;
  /** Renders a weapon's picture (set by the game; '' when there is none). */
  gunIcon: ((id: string) => string) | null = null;
  private shieldEl: HTMLElement;
  private ammoMag: HTMLElement;
  private ammoRes: HTMLElement;
  private ammoName: HTMLElement;
  private ammoBox: HTMLElement;
  private reloadBar: HTMLElement;
  private reloadFill: HTMLElement;
  private slotEls: HTMLElement[] = [];
  private throwCount: HTMLElement;
  private cross: HTMLElement;
  /** The scope over the whole screen (sniper rifles and the DMR, aimed). */
  private scopeEl: HTMLElement;
  private crossLines: HTMLElement[] = [];
  private crossBlocked: HTMLElement;
  private hitEl: HTMLElement;
  private feedEl: HTMLElement;
  private arcsEl: HTMLElement;
  private arcs: DamageArc[] = [];
  private vignette: HTMLElement;
  private flashEl: HTMLElement;
  private announceEl: HTMLElement;
  private objectiveEl: HTMLElement;
  private objectiveText: HTMLElement;
  private objectiveFill: HTMLElement;
  private confirmEl: HTMLElement;
  private confirmTimer = 0;
  private respawnEl: HTMLElement;
  private respawnText: HTMLElement;
  private respawnFill: HTMLElement;
  private boardEl: HTMLElement;
  private boardBody: HTMLElement;
  private netEl: HTMLElement;
  private legendEl: HTMLElement;
  private hintEl: HTMLElement;
  private device: DeviceKind = 'kbm';
  private legendTimer = 0;

  private last: Record<string, unknown> = {};
  private hitTimer = 0;
  private flash = 0;
  private announceTimer = 0;
  private boardTimer = 0;
  private netTimer = 0;
  private height = 720;

  constructor(parent: HTMLElement, map: MapDef) {
    const c0 = CREWS[0], c1 = CREWS[1];
    this.root = el('div', 'hud');

    // ---- top score bar ----
    const s0 = el('span', 'tscore', '0');
    const s1 = el('span', 'tscore', '0');
    this.scoreEls = [s0, s1];
    this.timeEl = el('div', 'time', '0:00');
    this.modeEl = el('div', 'mode', '');
    this.zonesEl = el('div', 'zones');
    const logo0 = el('span', 'logo');
    logo0.innerHTML = crewLogoSvg(0);
    const logo1 = el('span', 'logo');
    logo1.innerHTML = crewLogoSvg(1);
    const bar = el('div', 'scorebar', [
      el('div', 'team t0', [logo0, el('span', 'tname', c0.name), s0]),
      el('div', 'clock', [this.modeEl, this.timeEl, this.zonesEl]),
      el('div', 'team t1', [s1, el('span', 'tname', c1.name), logo1]),
    ]);

    // ---- minimap ----
    // the battle royale map is too big to fit the box: follow the player instead
    const wide = map.bounds.maxX - map.bounds.minX > 200;
    this.minimap = new Minimap(map, wide ? { pxPerM: 1.3, height: 170 } : undefined);
    const mapBox = el('div', 'minimap-box', [this.minimap.canvas]);

    // ---- feed ----
    this.feedEl = el('div', 'killfeed');

    // ---- reticle ----
    this.cross = el('div', 'crosshair');
    for (const dir of ['up', 'down', 'left', 'right']) {
      const l = el('i', `ch ch-${dir}`);
      this.crossLines.push(l);
      this.cross.append(l);
    }
    this.cross.append(el('i', 'ch-dot'));
    // the other reticle shapes (each gun shows the ones its reticle uses)
    this.cross.append(el('i', 'ch-ring'), el('i', 'ch-chev'), el('i', 'ch-brk ch-brk-l'), el('i', 'ch-brk ch-brk-r'));
    this.scopeEl = el('div', 'scope-overlay hidden');
    this.scopeEl.innerHTML = '<div class="sc-glass"></div><i class="sc-h"></i><i class="sc-v"></i><i class="sc-mils"></i><i class="sc-chev"></i><i class="sc-stadia"></i>';
    this.crossBlocked = el('i', 'ch-blocked', '✕');
    this.cross.append(this.crossBlocked);
    this.hitEl = el('div', 'hitmarker');
    this.hitEl.innerHTML = '<i></i><i></i><i></i><i></i>';
    this.arcsEl = el('div', 'dmg-arcs');
    this.vignette = el('div', 'vignette');
    this.flashEl = el('div', 'dmg-flash');

    // ---- health ----
    this.healthFill = el('div', 'fill');
    this.regenFill = el('div', 'regen hidden');
    this.healthNum = el('div', 'num', '100');
    this.shieldEl = el('div', 'shield hidden', 'SPAWN SHIELD');
    this.armorSegs = [0, 1, 2, 3].map(() => el('i', '', [el('b')]));
    this.armorEl = el('div', 'armor-segs hidden', this.armorSegs);
    this.healthBox = el('div', 'health', [
      el('div', 'cap', 'HEALTH'),
      this.armorEl,
      el('div', 'row', [this.healthNum, el('div', 'bar', [this.healthFill, this.regenFill])]),
      this.shieldEl,
    ]);

    // ---- the equipped weapon's picture (bottom left) ----
    this.gunPicImg = el('img', 'gp-img');
    this.gunPicImg.alt = '';
    this.gunPicName = el('div', 'gp-name', '');
    this.gunPic = el('div', 'gunpic hidden', [this.gunPicImg, this.gunPicName]);

    // ---- ammo ----
    this.ammoMag = el('span', 'mag', '0');
    this.ammoRes = el('span', 'res', '0');
    this.ammoName = el('div', 'wname', '');
    this.reloadFill = el('div', 'fill');
    this.reloadBar = el('div', 'reload hidden', [el('span', '', 'RELOADING'), el('div', 'bar', [this.reloadFill])]);
    const slots = el('div', 'slots');
    for (let i = 0; i < 3; i++) {
      const s = el('div', 'slot', [el('b', '', String(i + 1)), el('span', 'sicon'), el('em', '')]);
      this.slotEls.push(s);
      slots.append(s);
    }
    this.throwCount = this.slotEls[2].querySelector('em')!;
    this.ammoBox = el('div', 'ammo', [
      this.ammoName,
      el('div', 'count', [this.ammoMag, el('span', 'sep', '/'), this.ammoRes]),
      this.reloadBar,
      slots,
    ]);

    // ---- center messaging ----
    this.announceEl = el('div', 'announce hidden');
    this.objectiveText = el('span', 'what', '');
    this.objectiveFill = el('i', '');
    this.objectiveEl = el('div', 'objective hidden', [this.objectiveText, el('div', 'bar', [this.objectiveFill])]);
    this.confirmEl = el('div', 'killconfirm hidden');
    this.respawnText = el('div', 'who', '');
    this.respawnFill = el('div', 'fill');
    this.respawnEl = el('div', 'respawn hidden', [
      this.respawnText,
      el('div', 'sub', 'RESPAWNING'),
      el('div', 'bar', [this.respawnFill]),
    ]);

    // ---- scoreboard ----
    this.boardBody = el('div', 'board-body');
    this.boardEl = el('div', 'scoreboard hidden', [this.boardBody]);

    this.netEl = el('div', 'netstat hidden');
    this.legendEl = el('div', 'legend hidden');
    this.hintEl = el('div', 'hint hidden');

    this.root.append(
      this.legendEl, this.hintEl,
      this.scopeEl, this.vignette, this.flashEl, bar, mapBox, this.feedEl, this.arcsEl, this.cross, this.hitEl,
      this.gunPic, this.healthBox, this.ammoBox, this.objectiveEl, this.confirmEl, this.announceEl, this.respawnEl, this.boardEl, this.netEl,
    );
    parent.append(this.root);
    this.onResize();
  }

  onResize(): void {
    this.height = this.root.clientHeight || window.innerHeight;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** Switch button prompts to the device in use and flash the controls legend for a few seconds. */
  setDevice(device: DeviceKind, showLegend = true): void {
    this.device = device;
    this.root.dataset.device = device;
    this.legendEl.innerHTML = legendHtml(device, this.root.dataset.mode === 'porch' ? PORCH_LEGEND : GAMEPLAY_LEGEND);
    this.last.hint = undefined;
    if (showLegend && device !== 'touch') {
      this.legendEl.classList.remove('hidden');
      this.legendTimer = 9;
    } else {
      this.legendEl.classList.add('hidden');
      this.legendTimer = 0;
    }
  }

  private set(key: string, value: unknown, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  update(s: HudState, dt: number): void {
    // ---- score bar ----
    this.set('s0', s.scores[0], () => (this.scoreEls[0].textContent = String(s.scores[0])));
    this.set('s1', s.scores[1], () => (this.scoreEls[1].textContent = String(s.scores[1])));
    const timeText = s.phase === PHASE.PLAYING ? fmtTime(s.timeLeft) : s.phase === PHASE.WARMUP ? 'GET READY' : 'FINAL';
    this.set('time', timeText, () => (this.timeEl.textContent = timeText));
    this.set('mode', s.mode, () => {
      const cfg = MODES[s.mode];
      this.modeEl.textContent = `${cfg.name.toUpperCase()} · FIRST TO ${cfg.scoreLimit}`;
      this.root.dataset.mode = s.mode;
      if (this.device !== 'touch') this.legendEl.innerHTML = legendHtml(this.device, s.mode === 'porch' ? PORCH_LEGEND : GAMEPLAY_LEGEND);
    });
    this.set('lowtime', s.phase === PHASE.PLAYING && s.timeLeft <= 30, () => {
      this.timeEl.classList.toggle('low', s.phase === PHASE.PLAYING && s.timeLeft <= 30);
    });
    this.set('team', s.myTeam, () => (this.root.dataset.team = String(s.myTeam)));

    // ---- zones (Turf War) ----
    if (this.zoneChips.length !== s.zones.length || this.last.zmode !== s.mode) {
      this.last.zmode = s.mode;
      this.zonesEl.textContent = '';
      this.zoneChips = [];
      if (s.mode === 'turf') {
        s.zones.forEach((_z, i) => {
          const chip = el('div', 'zone', [el('b', '', 'ABC'[i] ?? '?'), el('i', '')]);
          this.zoneChips.push(chip);
          this.zonesEl.append(chip);
        });
      }
    }
    for (let i = 0; i < this.zoneChips.length; i++) {
      const z = s.zones[i];
      const key = `${z.owner}|${z.capTeam}|${Math.round(z.progress * 20)}|${z.contested ? 1 : 0}`;
      this.set(`z${i}`, key, () => {
        const chip = this.zoneChips[i];
        chip.dataset.owner = String(z.owner);
        chip.dataset.cap = String(z.capTeam);
        chip.classList.toggle('contested', z.contested);
        (chip.lastElementChild as HTMLElement).style.width = `${Math.round(z.progress * 100)}%`;
      });
    }

    // ---- objective banner: what standing in this zone is doing ----
    const zone = s.mode === 'turf' && s.alive && s.phase === PHASE.PLAYING ? s.zones[s.myZone] : undefined;
    let objective = '';
    let objectivePct = 0;
    if (zone) {
      const letter = 'ABC'[s.myZone] ?? '?';
      if (zone.contested) objective = `contested|${letter} CONTESTED`;
      else if (zone.owner === s.myTeam) objective = zone.progress > 0 ? `mine|DEFENDING ${letter}` : `mine|HOLDING ${letter}`;
      else if (zone.capTeam !== s.myTeam && zone.progress > 0) objective = `clear|CLEARING ${letter}`;
      else objective = `mine|CAPTURING ${letter}`;
      objectivePct = zone.owner === s.myTeam && zone.progress === 0 ? 100 : Math.round(zone.progress * 100);
    }
    this.set('objective', objective, () => {
      this.objectiveEl.classList.toggle('hidden', objective === '');
      if (objective === '') return;
      const [tone, text] = objective.split('|');
      this.objectiveEl.dataset.tone = tone;
      this.objectiveText.textContent = text;
    });
    if (objective !== '') this.set('objectivePct', objectivePct, () => (this.objectiveFill.style.width = `${objectivePct}%`));

    // ---- health ----
    const hp = Math.max(0, Math.round(s.health));
    this.set('hp', hp, () => {
      this.healthNum.textContent = String(hp);
      this.healthFill.style.width = `${hp}%`;
      this.healthBox.classList.toggle('low', hp <= 35);
    });
    // health still coming in from an orange: a pale stretch past the bar's end
    const regen = s.alive ? Math.max(0, Math.min(100 - hp, Math.round(s.regen ?? 0))) : 0;
    this.set('regen', `${hp}|${regen}`, () => {
      this.regenFill.style.left = `${hp}%`;
      this.regenFill.style.width = `${regen}%`;
      this.regenFill.classList.toggle('hidden', regen <= 0);
    });
    const ar = Math.round(s.armor);
    this.set('armor', ar, () => {
      this.armorEl.classList.toggle('hidden', ar < 0);
      this.armorEl.classList.toggle('some', ar > 0);
      this.armorSegs.forEach((seg, i) => {
        const fill = Math.max(0, Math.min(1, (ar - i * 25) / 25));
        (seg.firstChild as HTMLElement).style.width = `${fill * 100}%`;
      });
    });
    this.set('shield', s.spawnProtected && s.alive, () => this.shieldEl.classList.toggle('hidden', !(s.spawnProtected && s.alive)));
    const lowK = s.alive ? Math.pow(1 - Math.min(1, s.health / 100), 1.6) : 0.75;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const vig = Math.round(Math.min(1, lowK) * 20) / 20;
    this.set('vig', vig, () => (this.vignette.style.opacity = String(vig)));
    const fl = Math.round(this.flash * 20) / 20;
    this.set('flash', fl, () => (this.flashEl.style.opacity = String(fl)));

    // ---- ammo ----
    const gun = s.gun ?? s.slot < 2;
    const w = s.slot === 0 ? WEAPONS[s.loadout.primary] : WEAPONS[s.loadout.secondary];
    const wname = s.weaponName ?? (gun ? w.name : THROWABLES[s.loadout.throwable].name);
    this.set('wname', wname, () => (this.ammoName.textContent = wname.toUpperCase()));
    const picId = s.alive ? s.weaponId ?? '' : '';
    this.set('gunpic', `${picId}|${wname}`, () => {
      // empty hands: the hands logo
      const url = picId === 'fists' ? FIST_URL : picId && this.gunIcon ? this.gunIcon(picId) : '';
      this.gunPic.classList.toggle('hidden', !url);
      if (url) this.gunPicImg.src = url;
      this.gunPicName.textContent = wname.toUpperCase();
    });
    const magText = s.melee ? (s.weaponId === 'fists' ? '\u270a' : '\u2020') : gun ? String(s.mag) : String(s.throwables);
    const resText = s.melee ? '' : gun ? String(s.reserve) : '';
    // melee has nothing to count: the hands logo (or the knife) instead of a number
    this.set('mag', magText, () => {
      if (magText === '\u270a') this.ammoMag.innerHTML = FIST_SVG;
      else if (magText === '\u2020') this.ammoMag.innerHTML = KNIFE_SVG;
      else this.ammoMag.textContent = magText;
      this.ammoMag.classList.toggle('icon', !!s.melee);
    });
    this.set('res', `${resText}|${s.melee ? 1 : 0}`, () => {
      this.ammoRes.textContent = resText;
      this.ammoBox.classList.toggle('nores', !gun || !!s.melee);
    });
    const low = gun && !s.melee && s.mag <= Math.ceil(s.magSize * 0.25);
    this.set('lowammo', low, () => this.ammoBox.classList.toggle('low', low));
    this.set('reloading', s.reload >= 0, () => this.reloadBar.classList.toggle('hidden', s.reload < 0));
    if (s.reload >= 0) this.reloadFill.style.width = `${Math.round(s.reload * 100)}%`;
    this.set('slot', s.slot, () => this.slotEls.forEach((n, i) => n.classList.toggle('active', i === s.slot)));
    this.set('loadout', `${s.loadout.primary}|${s.loadout.secondary}|${s.loadout.throwable}`, () => {
      this.slotEls[0].querySelector('.sicon')!.innerHTML = iconFor(s.loadout.primary);
      this.slotEls[1].querySelector('.sicon')!.innerHTML = iconFor(s.loadout.secondary);
      this.slotEls[2].querySelector('.sicon')!.innerHTML = WEAPON_ICONS.grenade;
      this.slotEls[2].dataset.kind = s.loadout.throwable;
    });
    this.set('throws', s.throwables, () => {
      this.throwCount.textContent = `x${s.throwables}`;
      this.slotEls[2].classList.toggle('empty', s.throwables <= 0);
    });

    // ---- reticle ----
    const scoped = !!s.scoped && s.alive && s.phase !== PHASE.ENDED;
    this.set('scoped', `${scoped}|${s.reticle}`, () => {
      this.scopeEl.classList.toggle('hidden', !scoped);
      this.scopeEl.dataset.ret = s.reticle ?? '';
    });
    const showCross = s.alive && s.phase !== PHASE.ENDED && !s.showScoreboard && !scoped;
    this.set('cross', showCross, () => this.cross.classList.toggle('hidden', !showCross));
    this.set('ret', s.reticle ?? 'cross', () => (this.cross.dataset.ret = s.reticle ?? 'cross'));
    if (showCross) {
      const px = (Math.tan(s.spreadDeg * DEG) / Math.tan((s.fovV * DEG) / 2)) * (this.height / 2);
      const gap = Math.round(Math.max(3, px) * 2) / 2;
      this.set('gap', gap, () => this.cross.style.setProperty('--gap', `${gap}px`));
      this.set('blocked', s.blocked, () => this.cross.classList.toggle('blocked', s.blocked));
      this.set('ontarget', s.onTarget, () => this.cross.classList.toggle('on-target', s.onTarget));
      this.set('thr', !gun, () => this.cross.classList.toggle('throwable', !gun));
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitEl.className = 'hitmarker';
    }
    if (this.confirmTimer > 0) {
      this.confirmTimer -= dt;
      if (this.confirmTimer <= 0 || !s.alive || s.phase !== PHASE.PLAYING) {
        this.confirmTimer = 0;
        this.confirmEl.classList.add('hidden');
      }
    }

    // ---- damage direction arcs ----
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      if (a.life <= 0) {
        a.node.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      const rel = wrapAngle(yawToward(s.myX, s.myZ, a.x, a.z) - s.viewYaw);
      a.node.style.transform = `rotate(${(-rel).toFixed(3)}rad)`;
      a.node.style.opacity = String(Math.min(1, a.life / 0.6));
    }

    // ---- respawn ----
    const dead = !s.alive && s.phase === PHASE.PLAYING;
    this.set('dead', dead, () => this.respawnEl.classList.toggle('hidden', !dead));
    if (dead) {
      const who = s.killer;
      this.set('killer', who, () => {
        this.respawnText.innerHTML = `Knocked Off${who ? `<small>by <b>${escapeHtml(who)}</b></small>` : ''}`;
      });
      this.respawnFill.style.width = `${Math.round((1 - Math.min(1, s.respawnIn / 5000)) * 100)}%`;
    }

    // ---- announcements (the final scoreboard carries the result itself) ----
    if (this.announceTimer > 0) {
      this.announceTimer -= dt;
      if (this.announceTimer <= 0 || s.phase === PHASE.ENDED) {
        this.announceTimer = 0;
        this.announceEl.classList.add('hidden');
      }
    }

    // ---- scoreboard (rebuilt a few times a second while open) ----
    const showBoard = s.showScoreboard || s.phase === PHASE.ENDED;
    this.set('board', showBoard, () => {
      this.boardEl.classList.toggle('hidden', !showBoard);
      this.boardTimer = 0;
    });
    if (showBoard) {
      this.boardTimer -= dt;
      if (this.boardTimer <= 0) {
        this.boardTimer = 0.25;
        this.renderBoard(s);
      }
    }

    // ---- controls legend + contextual hint ----
    if (this.legendTimer > 0) {
      this.legendTimer -= dt;
      if (this.legendTimer <= 0 || s.phase === PHASE.ENDED) this.legendEl.classList.add('hidden');
    }
    let hint = '';
    if (s.alive && s.phase === PHASE.PLAYING && this.device !== 'touch') {
      if (gun && !s.melee && s.reload < 0 && s.reserve > 0 && s.mag <= Math.ceil(s.magSize * 0.25)) hint = 'reload';
      else if (gun && !s.melee && s.mag === 0 && s.reserve === 0) hint = 'swap';
    }
    this.set('hint', hint, () => {
      this.hintEl.classList.toggle('hidden', hint === '');
      if (hint === 'reload') this.hintEl.innerHTML = `${glyphHtml(this.device, 'reload')}<span>Reload</span>`;
      else if (hint === 'swap') this.hintEl.innerHTML = `${glyphHtml(this.device, 'swap')}<span>Out of ammo: switch weapon</span>`;
    });

    // ---- net / fps readout ----
    this.set('shownet', s.showFps, () => this.netEl.classList.toggle('hidden', !s.showFps));
    if (s.showFps) {
      this.netTimer -= dt;
      if (this.netTimer <= 0) {
        this.netTimer = 0.5;
        this.netEl.textContent = `${s.fps} FPS · ${Math.round(s.ping)} ms${s.resScale < 0.995 ? ` · ${Math.round(s.resScale * 100)}% res` : ''}`;
      }
    }

    this.minimap.draw(s);
  }

  private renderBoard(s: HudState): void {
    const turf = s.mode === 'turf';
    const col = (team: TeamId): string => {
      const rows = s.players
        .filter((p) => p.team === team)
        .sort((a, b) => (turf ? b.score - a.score : 0) || b.kills - a.kills || a.deaths - b.deaths);
      const c = CREWS[team];
      const body = rows
        .map(
          (p) => `<tr class="${p.me ? 'me' : ''} ${p.alive ? '' : 'dead'}">
            <td class="n">${escapeHtml(p.name)}${p.bot ? ' <i>BOT</i>' : ''}</td>
            <td>${p.kills}</td><td>${p.deaths}</td>${turf ? `<td>${p.score}</td>` : ''}
            <td class="p">${p.bot ? '-' : Math.round(p.ping)}</td></tr>`,
        )
        .join('');
      return `<div class="col t${team}">
        <div class="head"><span class="logo">${crewLogoSvg(team)}</span><span class="nm">${escapeHtml(c.name)}</span><span class="sc">${s.scores[team]}</span></div>
        <table><thead><tr><th class="n">PLAYER</th><th>K</th><th>D</th>${turf ? '<th>CAPS</th>' : ''}<th class="p">PING</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
    };
    let head: string;
    if (s.phase === PHASE.ENDED) {
      // final board: the result from this player's point of view, then who took it
      const [a, b] = s.scores;
      if (a === b) {
        head = `<div class="title result draw">DRAW</div><div class="subtitle">All square at ${a}</div>`;
      } else {
        const winner: TeamId = a > b ? 0 : 1;
        const won = winner === s.myTeam;
        head = `<div class="title result ${won ? 'win' : 'loss'}">${won ? 'VICTORY' : 'DEFEAT'}</div>
          <div class="subtitle t${winner}">${escapeHtml(CREWS[winner].name.toUpperCase())} WINS ${Math.max(a, b)} – ${Math.min(a, b)}</div>`;
      }
    } else {
      head = `<div class="title">${MODES[s.mode].name.toUpperCase()}</div>`;
    }
    this.boardBody.innerHTML = `${head}<div class="cols">${col(0)}${col(1)}</div>`;
  }

  /** Flash the hit marker (white = hit, yellow = headshot, red = kill). */
  hitMarker(kind: HitKind): void {
    this.hitEl.className = `hitmarker show ${kind}`;
    // restart the CSS animation
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('pop');
    this.hitTimer = kind === 'kill' ? 0.45 : 0.22;
  }

  /** Show where damage came from (world position of the source). */
  damageFrom(x: number, z: number, amount: number): void {
    this.flash = Math.min(0.9, this.flash + 0.25 + amount / 120);
    if (this.arcs.length >= 6) {
      const old = this.arcs.shift()!;
      old.node.remove();
    }
    const node = el('div', 'arc', [el('i', '')]);
    this.arcsEl.append(node);
    this.arcs.push({ node, x, z, life: 1.4 });
  }

  /** "You dropped X" confirmation under the reticle. */
  killConfirm(victim: string, victimTeam: TeamId, head: boolean): void {
    this.confirmEl.innerHTML = `<span>ELIMINATED</span><b class="t${victimTeam}">${escapeHtml(victim)}</b>${head ? '<em>HEADSHOT</em>' : ''}`;
    this.confirmEl.className = 'killconfirm';
    void this.confirmEl.offsetWidth;
    this.confirmEl.classList.add('pop');
    this.confirmTimer = 1.9;
  }

  killFeed(killer: string, killerTeam: TeamId | -1, victim: string, victimTeam: TeamId, weaponCode: number, head: boolean, mine: boolean): void {
    const row = el('div', `kf${mine ? ' mine' : ''}`);
    row.innerHTML =
      (killerTeam >= 0 ? `<span class="t${killerTeam}">${escapeHtml(killer)}</span>` : '') +
      `<span class="wi">${weaponIcon(weaponCode)}</span>${head ? '<span class="hs">HS</span>' : ''}` +
      `<span class="t${victimTeam}">${escapeHtml(victim)}</span>`;
    this.feedEl.prepend(row);
    while (this.feedEl.childElementCount > 5) this.feedEl.lastElementChild!.remove();
    setTimeout(() => row.classList.add('out'), 5200);
    setTimeout(() => row.remove(), 5800);
  }

  announce(text: string, tone: 'neutral' | 'good' | 'bad' | 'crew0' | 'crew1' = 'neutral', seconds = 2.4): void {
    this.announceEl.textContent = text;
    this.announceEl.className = `announce ${tone}`;
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('pop');
    this.announceTimer = seconds;
  }

  dispose(): void {
    this.root.remove();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
