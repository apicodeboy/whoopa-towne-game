import { AMMO_NAMES, AMMO_TYPES, THROWABLES, THROWABLE_IDS, WEAPONS, WEAPON_IDS } from '@shared/config/weapons';
import { BAGS, HEAL_KINDS, ITEM, PORCH } from '@shared/config/porch';
import { stageName, STAGE_DEPLOY, STAGE_EARLY, STAGE_ENDED, STAGE_RIOT } from '@shared/sim/porch';
import type { PorchSnap, StandingRow } from '@shared/protocol';
import { el, button } from './dom';
import { escapeHtml } from './hud';

/**
 * JUMP OFF THE PORCH HUD, drawn over the regular one (health, reticle, kill feed and minimap
 * stay; the crew score bar and respawn panel are hidden for this mode).
 */

export interface PorchSlot {
  name: string;
  mag: number;
  reserve: number;
  empty: boolean;
  active: boolean;
}

export interface PorchHudState {
  snap: PorchSnap | null;
  alive: boolean;
  /** 0 ground, 1 on the transport, 2 balloon. */
  air: number;
  inRiot: boolean;
  armor: number;
  kills: number;
  /** Primary, second primary, handgun, throwable. */
  slots: PorchSlot[];
  ammo: number[];
  heals: number[];
  /** 0..1 progress using a healing item, -1 when not healing. */
  healing: number;
  healName: string;
  /** Interaction prompt (plain text), or ''. */
  prompt: string;
  /** Seconds until the transport doors open (0 = open). */
  doorsIn: number;
  /** Name of the player being watched while out, or ''. */
  spectating: string;
  squad: Array<{ name: string; alive: boolean; hp: number; me: boolean }>;
  /** View heading for the compass (radians, 0 = north / -Z). */
  yaw: number;
  /** Players in the match. */
  total: number;
  device: string;
}

const VOICE: Record<string, string> = {
  deploy: 'Everybody off the porch!',
  hot: 'The streets getting hot!',
  closer: 'That riot getting closer!',
  few: 'Only a few left standing!',
  final: 'Who really run this Towne?',
};

function fmt(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface PorchHudActions {
  spectate(): void;
  leave(): void;
}

export class PorchHud {
  readonly root: HTMLElement;
  private aliveEl: HTMLElement;
  private stageEl: HTMLElement;
  private timerEl: HTMLElement;
  private killsEl: HTMLElement;
  private compassEl: HTMLElement;
  private compassStrip: HTMLElement;
  private squadEl: HTMLElement;
  private armorFill: HTMLElement;
  private armorNum: HTMLElement;
  private armorBox: HTMLElement;
  private invEl: HTMLElement;
  private slotEls: HTMLElement[] = [];
  private bagEl: HTMLElement;
  private healBar: HTMLElement;
  private healFill: HTMLElement;
  private healText: HTMLElement;
  private promptEl: HTMLElement;
  private bannerEl: HTMLElement;
  private riotEl: HTMLElement;
  private toastsEl: HTMLElement;
  private keysEl: HTMLElement;
  private outEl: HTMLElement;
  private outTitle: HTMLElement;
  private outPlace: HTMLElement;
  private outStats: HTMLElement;
  private outHint!: HTMLElement;
  private specEl: HTMLElement;
  private winEl: HTMLElement;
  private boardEl: HTMLElement;
  private last: Record<string, unknown> = {};
  private bannerTimer = 0;
  private lastStage = -1;
  private lastShrink = false;
  private saidFew = false;
  private outShown = false;
  private voiceOn = true;

  constructor(parent: HTMLElement, actions: PorchHudActions) {
    this.aliveEl = el('b', '', '0');
    this.stageEl = el('div', 'ph-stage', '');
    this.timerEl = el('div', 'ph-timer', '');
    this.killsEl = el('b', '', '0');
    const top = el('div', 'ph-top', [
      el('div', 'ph-count', [this.aliveEl, el('span', '', 'ALIVE')]),
      el('div', 'ph-mid', [this.stageEl, this.timerEl]),
      el('div', 'ph-count', [this.killsEl, el('span', '', 'ELIMS')]),
    ]);
    this.compassStrip = el('div', 'ph-strip');
    const marks = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'];
    // three laps so the strip can scroll without gaps
    for (let lap = 0; lap < 3; lap++) for (const m of marks) this.compassStrip.append(el('i', m.length > 1 || m === 'N' || m === 'E' || m === 'S' || m === 'W' ? 'big' : '', m));
    this.compassEl = el('div', 'ph-compass', [this.compassStrip, el('div', 'ph-needle')]);
    this.squadEl = el('div', 'ph-squad hidden');

    this.armorFill = el('div', 'fill');
    this.armorNum = el('div', 'num', '0');
    this.armorBox = el('div', 'ph-armor', [el('div', 'cap', 'ARMOR'), el('div', 'row', [this.armorNum, el('div', 'bar', [this.armorFill])])]);

    this.invEl = el('div', 'ph-inv');
    ['1', '2', '3', '4'].forEach((k) => {
      const s = el('div', 'ph-slot', [el('b', '', k), el('span', 'nm', ''), el('em', '', '')]);
      this.slotEls.push(s);
      this.invEl.append(s);
    });
    this.bagEl = el('div', 'ph-bag');
    this.healFill = el('i', '');
    this.healText = el('span', '', 'HEALING');
    this.healBar = el('div', 'ph-heal hidden', [this.healText, el('div', 'bar', [this.healFill])]);
    this.promptEl = el('div', 'ph-prompt hidden');
    this.bannerEl = el('div', 'ph-banner hidden');
    this.riotEl = el('div', 'ph-riot hidden', [el('div', 'ph-riot-text', "YOU'RE IN THE RIOT — GET OUT!")]);
    this.toastsEl = el('div', 'ph-toasts');
    this.keysEl = el('div', 'ph-keys');
    setTimeout(() => this.keysEl.classList.add('fade'), 14000);

    this.outTitle = el('div', 'ph-out-title', 'KNOCKED OFF THE PORCH');
    this.outPlace = el('div', 'ph-out-place', '');
    this.outStats = el('div', 'ph-out-stats', '');
    const spec = button('SPECTATE', 'btn primary', () => {
      this.outEl.classList.add('hidden');
      actions.spectate();
    });
    const leave = button('LEAVE MATCH', 'btn', () => actions.leave());
    leave.dataset.back = '1';
    this.outHint = el('div', 'ph-out-hint', '');
    this.outEl = el('div', 'ph-out hidden', [this.outTitle, this.outPlace, this.outStats, el('div', 'row center', [spec, leave]), this.outHint]);
    this.specEl = el('div', 'ph-spec hidden');
    this.winEl = el('div', 'ph-win hidden');
    this.boardEl = el('div', 'ph-board hidden');

    this.root = el('div', 'porch-hud', [
      top, this.compassEl, this.squadEl, this.armorBox, this.invEl, this.bagEl, this.healBar,
      this.promptEl, this.bannerEl, this.riotEl, this.toastsEl, this.keysEl, this.specEl, this.outEl, this.winEl, this.boardEl,
    ]);
    parent.append(this.root);
  }

  private set(key: string, v: unknown, apply: () => void): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    apply();
  }

  /** Big center banner (and the announcer, when there is a voice line for it). */
  banner(text: string, tone: 'warn' | 'good' | 'info' = 'info', voice?: keyof typeof VOICE, seconds = 3): void {
    this.bannerEl.textContent = text;
    this.bannerEl.dataset.tone = tone;
    this.bannerEl.classList.remove('hidden');
    this.bannerTimer = seconds;
    if (voice) this.say(VOICE[voice]);
  }

  setVoice(on: boolean): void {
    this.voiceOn = on;
  }

  /** Neighborhood announcer (the browser's speech voice, low and slow). */
  private say(line: string): void {
    if (!this.voiceOn || typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.02;
      u.pitch = 0.75;
      u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch {
      /* no voice available */
    }
  }

  /** "+ Kingpin AR" style pickup notes. */
  loot(kind: number, code: number, count: number): void {
    let text = '';
    if (kind === ITEM.WEAPON) text = WEAPONS[WEAPON_IDS[code]]?.name ?? 'Weapon';
    else if (kind === ITEM.AMMO) text = `${count} ${AMMO_NAMES[AMMO_TYPES[code]] ?? 'Ammo'}`;
    else if (kind === ITEM.HEAL) text = `${count}× ${PORCH.heals[HEAL_KINDS[code]]?.name ?? 'Heal'}`;
    else if (kind === ITEM.ARMOR) text = `Armor (${code})`;
    else if (kind === ITEM.THROWABLE) text = `${count}× ${THROWABLES[THROWABLE_IDS[code]]?.name ?? 'Throwable'}`;
    if (!text || count <= 0) return;
    const t = el('div', 'ph-toast', `+ ${text}`);
    t.dataset.kind = String(kind);
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 5) this.toastsEl.lastElementChild!.remove();
    setTimeout(() => t.classList.add('fade'), 2200);
    setTimeout(() => t.remove(), 2900);
  }

  update(s: PorchHudState, dt: number): void {
    const snap = s.snap;
    // ---- top bar ----
    if (snap) {
      this.set('alive', snap.alive, () => (this.aliveEl.textContent = String(snap.alive)));
      let stage = stageName(snap.stage);
      let timer = '';
      if (snap.stage === STAGE_DEPLOY) timer = `RIOT STARTS IN ${fmt(snap.stageLeft + PORCH.earlySeconds)}`;
      else if (snap.stage === STAGE_EARLY) timer = `RIOT STARTS IN ${fmt(snap.stageLeft)}`;
      else if (snap.stage >= STAGE_RIOT && snap.stage < STAGE_ENDED) {
        if (snap.shrinking) timer = `RIOT SPREADING ${fmt(snap.stageLeft)}`;
        else if (snap.stageLeft > 0) timer = `RIOT APPROACHING ${fmt(snap.stageLeft)}`;
        else timer = 'THE RIOT IS EVERYWHERE';
      } else if (snap.stage === 0) {
        stage = 'GET ON THE PORCH';
        timer = snap.takeoff < 0 ? 'TAKING OFF…' : '';
      }
      this.set('stage', stage, () => (this.stageEl.textContent = stage));
      this.set('timer', timer, () => (this.timerEl.textContent = timer));
      this.set('warn', snap.shrinking, () => this.timerEl.classList.toggle('hot', snap.shrinking));

      // stage changes: banners and announcer lines
      if (snap.stage !== this.lastStage) {
        const prev = this.lastStage;
        this.lastStage = snap.stage;
        if (prev >= 0) {
          if (snap.stage === STAGE_DEPLOY) this.banner('EVERYBODY OFF THE PORCH!', 'good', 'deploy');
          else if (snap.stage === STAGE_RIOT) this.banner('RIOT APPROACHING', 'warn', 'hot', 3.5);
          else if (snap.stage === STAGE_ENDED - 1) this.banner('FINAL RIOT', 'warn', 'final', 3.5);
          else if (snap.stage > STAGE_RIOT && snap.stage < STAGE_ENDED) this.banner('RIOT APPROACHING', 'warn', 'closer', 3.5);
        }
      }
      if (snap.shrinking && !this.lastShrink) this.banner('THE RIOT IS SPREADING', 'warn', undefined, 2.5);
      this.lastShrink = snap.shrinking;
      if (!this.saidFew && snap.alive <= 5 && snap.alive > 1 && snap.stage >= STAGE_EARLY && snap.stage < STAGE_ENDED) {
        this.saidFew = true;
        this.banner('ONLY A FEW LEFT STANDING', 'info', 'few');
      }
    }
    this.set('kills', s.kills, () => (this.killsEl.textContent = String(s.kills)));

    // ---- compass ----
    const deg = ((((-s.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const px = Math.round((deg / 360) * 16 * 28) + 16 * 28;
    this.set('compass', px, () => (this.compassStrip.style.transform = `translateX(${-px}px)`));

    // ---- squad ----
    const sq = s.squad.length > 1 ? s.squad.map((m) => `${m.name}|${m.alive ? Math.round(m.hp / 10) : -1}`).join(',') : '';
    this.set('squad', sq, () => {
      this.squadEl.classList.toggle('hidden', !sq);
      this.squadEl.innerHTML = s.squad
        .map((m) => `<div class="ph-mate ${m.alive ? '' : 'down'} ${m.me ? 'me' : ''}"><span>${escapeHtml(m.name)}</span><i style="width:${m.alive ? Math.max(4, m.hp) : 0}%"></i></div>`)
        .join('');
    });

    // ---- armor, inventory, healing ----
    const ar = Math.round(s.armor);
    this.set('armor', ar, () => {
      this.armorNum.textContent = String(ar);
      this.armorFill.style.width = `${Math.min(100, ar)}%`;
      this.armorBox.classList.toggle('none', ar <= 0);
    });
    s.slots.forEach((slot, i) => {
      const key = `${slot.name}|${slot.mag}|${slot.reserve}|${slot.active}|${slot.empty}`;
      this.set(`slot${i}`, key, () => {
        const n = this.slotEls[i];
        n.classList.toggle('active', slot.active);
        n.classList.toggle('empty', slot.empty);
        (n.children[1] as HTMLElement).textContent = slot.empty ? (i === 3 ? '—' : 'EMPTY') : slot.name;
        (n.children[2] as HTMLElement).textContent = slot.empty ? '' : i === 3 ? `×${slot.mag}` : `${slot.mag}/${slot.reserve}`;
      });
    });
    const bag = `${s.heals.join(',')}|${s.ammo.join(',')}`;
    this.set('bag', bag, () => {
      const heals = HEAL_KINDS.map((k, i) => `<span class="h h-${k}" title="${PORCH.heals[k].name}">${s.heals[i]}</span>`).join('');
      const ammo = AMMO_TYPES.map((t, i) => `<span class="a a-${t}" title="${AMMO_NAMES[t]}">${s.ammo[i]}</span>`).join('');
      this.bagEl.innerHTML = `<div class="row">${heals}<kbd>${s.device === 'kbm' ? 'H' : '▼'}</kbd></div><div class="row">${ammo}</div>`;
    });
    this.set('healing', s.healing >= 0, () => this.healBar.classList.toggle('hidden', s.healing < 0));
    if (s.healing >= 0) {
      this.healFill.style.width = `${Math.round(s.healing * 100)}%`;
      this.set('healName', s.healName, () => (this.healText.textContent = `USING ${s.healName.toUpperCase()}`));
    }

    // ---- prompts ----
    let prompt = s.prompt;
    if (s.alive && s.air === 1) {
      prompt = !Number.isFinite(s.doorsIn) ? 'TAKING OFF…' : s.doorsIn > 0 ? `DOORS OPEN IN ${Math.ceil(s.doorsIn)}` : `[${s.device === 'kbm' ? 'SPACE' : 'A'}] JUMP OFF THE PORCH`;
    }
    else if (s.alive && s.air === 2) prompt = `STEER WITH ${s.device === 'kbm' ? 'WASD' : 'THE STICK'} · HOLD ${s.device === 'kbm' ? 'C' : 'B'} TO DROP FASTER`;
    this.set('prompt', prompt, () => {
      this.promptEl.classList.toggle('hidden', !prompt);
      this.promptEl.textContent = prompt;
      this.promptEl.classList.toggle('jump', s.air === 1);
    });
    this.set('riot', s.inRiot && s.alive, () => this.riotEl.classList.toggle('hidden', !(s.inRiot && s.alive)));
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.add('hidden');
    }

    // ---- out of the match / spectating ----
    const out = !s.alive && !!snap && snap.place > 0 && snap.stage < STAGE_ENDED;
    if (out && !this.outShown) {
      this.outShown = true;
      this.outPlace.innerHTML = `<b>#${snap!.place}</b><span>OF ${s.total}</span>`;
      this.outStats.innerHTML = `<div><b>${s.kills}</b><span>ELIMINATIONS</span></div><div><b>${snap!.damage}</b><span>DAMAGE</span></div>`;
      this.outHint.textContent = s.device === 'kbm' ? 'CLICK TO SPECTATE · ESC FOR THE MENU' : '';
      this.outEl.classList.remove('hidden');
    }
    this.set('spec', s.spectating, () => {
      this.specEl.classList.toggle('hidden', !s.spectating);
      this.specEl.innerHTML = s.spectating ? `SPECTATING <b>${escapeHtml(s.spectating)}</b><span>${s.device === 'kbm' ? 'CLICK' : 'FIRE'} FOR NEXT</span>` : '';
    });
    this.root.classList.toggle('dead', !s.alive);
    this.set('keys', s.device, () => {
      this.keysEl.innerHTML = s.device === 'kbm'
        ? '<kbd>E</kbd> Search / pick up <kbd>H</kbd> Heal <kbd>X</kbd> Drop <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> Slots'
        : s.device === 'touch' ? '' : '<kbd>▼</kbd> Search / heal';
    });
  }

  /** Spectating started some other way (fire): put the elimination card away. */
  hideOut(): void {
    this.outEl.classList.add('hidden');
  }

  /** The final screen, from the match standings. */
  showResult(rows: StandingRow[], myIdx: number, winnerSquad: number): void {
    this.outEl.classList.add('hidden');
    const me = rows.find((r) => r.idx === myIdx);
    const won = !!me && me.squad === winnerSquad;
    const winners = rows.filter((r) => r.squad === winnerSquad).map((r) => r.name);
    const title = won ? 'YOU RUN THE TOWNE!' : winners.length ? `${winners.join(' & ').toUpperCase()} ${winners.length > 1 ? 'RUN' : 'RUNS'} THE TOWNE` : 'NOBODY MADE IT OUT';
    const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
    const top = [...rows].sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.kills - a.kills).slice(0, 8);
    this.winEl.innerHTML = `
      <div class="ph-win-title ${won ? 'won' : ''}">${escapeHtml(title)}</div>
      ${me ? `<div class="ph-win-place">#${me.place ?? '-'} <span>OF ${rows.length}</span></div>
      <div class="ph-win-stats">
        <div><b>${me.kills}</b><span>ELIMINATIONS</span></div>
        <div><b>${me.damage ?? 0}</b><span>DAMAGE DEALT</span></div>
        <div><b>${mins(me.survived ?? 0)}</b><span>SURVIVED</span></div>
        <div><b>#${me.place ?? '-'}</b><span>PLACEMENT</span></div>
      </div>` : ''}
      <table class="ph-win-table"><tr><th>#</th><th class="n">PLAYER</th><th>ELIMS</th><th>DMG</th></tr>
      ${top.map((r) => `<tr class="${r.idx === myIdx ? 'me' : ''}"><td>${r.place ?? '-'}</td><td class="n">${escapeHtml(r.name)}${r.bot ? ' <i>BOT</i>' : ''}</td><td>${r.kills}</td><td>${r.damage ?? 0}</td></tr>`).join('')}
      </table>`;
    this.winEl.classList.remove('hidden');
    if (won) this.say(VOICE.final.replace('Who really run this Towne?', 'You run the Towne!'));
  }

  /** TAB board: who is still in it. */
  board(show: boolean, rows: Array<{ name: string; alive: boolean; kills: number; bot: boolean; me: boolean; mate: boolean }>): void {
    this.set('board', show, () => this.boardEl.classList.toggle('hidden', !show));
    if (!show) return;
    const key = rows.map((r) => `${r.name}${r.alive ? 1 : 0}${r.kills}`).join('|');
    this.set('boardRows', key, () => {
      const sorted = [...rows].sort((a, b) => Number(b.alive) - Number(a.alive) || b.kills - a.kills);
      this.boardEl.innerHTML = `<div class="title">${PORCH.name}</div><table><tr><th class="n">PLAYER</th><th>ELIMS</th><th>STATUS</th></tr>${sorted
        .map((r) => `<tr class="${r.me ? 'me' : ''} ${r.mate ? 'mate' : ''} ${r.alive ? '' : 'dead'}"><td class="n">${escapeHtml(r.name)}${r.bot ? ' <i>BOT</i>' : ''}</td><td>${r.kills}</td><td>${r.alive ? 'IN IT' : 'OUT'}</td></tr>`)
        .join('')}</table>`;
    });
  }

  dispose(): void {
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    this.root.remove();
  }
}

export { BAGS };
