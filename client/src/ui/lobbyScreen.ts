import { CREWS, crewLogoSvg, type TeamId } from '@shared/config/crews';
import { MODES, MODE_IDS, TEAM_SIZE, type ModeId } from '@shared/config/game';
import { WEAPONS, type WeaponId } from '@shared/config/weapons';
import type { BotDifficulty } from '@shared/protocol';
import type { LobbyView } from '../net/online';
import { button, el } from './dom';
import { escapeHtml } from './hud';

export interface LobbyActions {
  setReady(ready: boolean): void;
  switchCrew(team: TeamId): void;
  configure(cfg: { mode?: ModeId; fillBots?: boolean; botDifficulty?: BotDifficulty }): void;
  start(): void;
  openLoadout(): void;
  leave(): void;
  copy(text: string, what: string): void;
}

/** Pre-match lobby: both crews, ready-up, invite code, host controls. */
export class LobbyScreen {
  readonly root: HTMLElement;
  private titleEl: HTMLElement;
  private blurbEl: HTMLElement;
  private codeEl: HTMLElement;
  private kindEl: HTMLElement;
  private cols: [HTMLElement, HTMLElement];
  private readyBtn: HTMLButtonElement;
  private switchBtn: HTMLButtonElement;
  private startBtn: HTMLButtonElement;
  private hostBox: HTMLElement;
  private modeSeg: HTMLElement;
  private modeButtons = new Map<ModeId, HTMLButtonElement>();
  private botsToggle: HTMLButtonElement;
  private diffSeg: HTMLElement;
  private diffButtons = new Map<BotDifficulty, HTMLButtonElement>();
  private statusEl: HTMLElement;
  private view: LobbyView | null = null;
  private actions: LobbyActions;

  constructor(parent: HTMLElement, actions: LobbyActions) {
    this.actions = actions;
    this.titleEl = el('div', 'lobby-title', '');
    this.blurbEl = el('div', 'blurb', '');
    this.codeEl = el('div', 'invite-code', '------');
    this.kindEl = el('div', 'lobby-kind', '');
    const copyCode = button('COPY CODE', 'btn ghost small', () => {
      if (this.view) actions.copy(this.view.code, 'Invite code');
    });
    const copyLink = button('COPY LINK', 'btn ghost small', () => {
      if (this.view) actions.copy(`${location.origin}${location.pathname}?join=${this.view.code}`, 'Invite link');
    });
    const header = el('div', 'lobby-head', [
      el('div', 'lh-left', [this.titleEl, this.blurbEl]),
      el('div', 'lh-right', [el('div', 'lbl', 'INVITE CODE'), this.codeEl, el('div', 'row tight', [copyCode, copyLink]), this.kindEl]),
    ]);

    this.cols = [el('div', 'crew-col t0'), el('div', 'crew-col t1')];
    const crews = el('div', 'crews', [this.cols[0], el('div', 'vs', 'VS'), this.cols[1]]);

    this.readyBtn = button('READY UP', 'btn primary', () => {
      const me = this.me();
      if (me) actions.setReady(!me.ready);
    });
    this.switchBtn = button('SWITCH CREW', 'btn', () => {
      const me = this.me();
      if (me) actions.switchCrew(me.team === 0 ? 1 : 0);
    });
    const loadoutBtn = button('LOADOUT', 'btn ghost', () => actions.openLoadout());
    const leaveBtn = button('LEAVE', 'btn ghost danger', () => actions.leave());

    // ---- host controls ----
    this.modeSeg = el('div', 'segmented small');
    for (const id of MODE_IDS) {
      const b = button(MODES[id].name, 'seg', () => actions.configure({ mode: id }));
      this.modeButtons.set(id, b);
      this.modeSeg.append(b);
    }
    this.botsToggle = button('FILL WITH BOTS: ON', 'btn ghost small', () => {
      if (this.view) actions.configure({ fillBots: !this.view.fillBots });
    });
    this.diffSeg = el('div', 'segmented small');
    for (const d of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const b = button(d.toUpperCase(), 'seg', () => actions.configure({ botDifficulty: d }));
      this.diffButtons.set(d, b);
      this.diffSeg.append(b);
    }
    this.startBtn = button('START MATCH', 'btn primary big', () => actions.start());
    this.hostBox = el('div', 'host-box', [
      el('div', 'lbl', 'HOST CONTROLS'),
      el('div', 'row wrap', [this.modeSeg, this.botsToggle, this.diffSeg]),
      this.startBtn,
    ]);
    this.statusEl = el('div', 'lobby-status', '');

    const panel = el('div', 'lobby-panel', [
      header,
      crews,
      el('div', 'row wrap center', [this.readyBtn, this.switchBtn, loadoutBtn, leaveBtn]),
      this.hostBox,
      this.statusEl,
    ]);
    this.root = el('div', 'screen lobby hidden', [panel]);
    parent.append(this.root);
  }

  private me() {
    return this.view?.players.find((p) => p.id === this.view!.myId) ?? null;
  }

  update(v: LobbyView): void {
    this.view = v;
    const mode = MODES[v.mode];
    this.titleEl.textContent = mode.name.toUpperCase();
    this.blurbEl.textContent = mode.blurb;
    this.codeEl.textContent = v.code;
    this.kindEl.textContent = v.isPrivate ? 'PRIVATE LOBBY · share the code to invite' : 'PUBLIC LOBBY · open to Quick Play';

    const me = this.me();
    const isHost = v.myId === v.hostId;
    for (const team of [0, 1] as const) {
      const c = CREWS[team];
      const members = v.players.filter((p) => p.team === team);
      const rows = members.map((p) => {
        const host = p.id === v.hostId;
        const status = !p.connected ? 'RECONNECTING' : host ? 'HOST' : p.ready ? 'READY' : 'NOT READY';
        const cls = !p.connected ? 'off' : host ? 'host' : p.ready ? 'ready' : 'wait';
        const gun = WEAPONS[p.primary as WeaponId]?.name ?? '';
        return `<div class="prow ${p.id === v.myId ? 'me' : ''}">
          <span class="pn">${escapeHtml(p.name)}</span><span class="pg">${escapeHtml(gun)}</span>
          <span class="ps ${cls}">${status}</span></div>`;
      });
      for (let i = members.length; i < TEAM_SIZE; i++) {
        rows.push(`<div class="prow empty"><span class="pn">${v.fillBots ? 'Bot fills this slot' : 'Open slot'}</span></div>`);
      }
      this.cols[team].innerHTML =
        `<div class="crew-head"><span class="logo">${crewLogoSvg(team)}</span><div><div class="cn">${escapeHtml(c.name)}</div>` +
        `<div class="cm">${escapeHtml(c.motto)}</div></div><span class="cc">${members.length}/${TEAM_SIZE}</span></div>${rows.join('')}`;
    }

    if (me) {
      this.readyBtn.textContent = isHost ? 'YOU ARE THE HOST' : me.ready ? 'NOT READY' : 'READY UP';
      this.readyBtn.disabled = isHost;
      this.readyBtn.classList.toggle('primary', !isHost && !me.ready);
      const other = me.team === 0 ? 1 : 0;
      this.switchBtn.disabled = v.players.filter((p) => p.team === other).length >= TEAM_SIZE;
      this.switchBtn.textContent = `SWITCH TO ${CREWS[other].name.toUpperCase()}`;
    }

    this.hostBox.classList.toggle('hidden', !isHost);
    this.modeSeg.classList.toggle('hidden', !v.isPrivate);
    for (const [id, b] of this.modeButtons) b.classList.toggle('on', id === v.mode);
    this.botsToggle.textContent = `FILL WITH BOTS: ${v.fillBots ? 'ON' : 'OFF'}`;
    this.botsToggle.classList.toggle('on', v.fillBots);
    this.diffSeg.classList.toggle('hidden', !v.fillBots);
    for (const [id, b] of this.diffButtons) b.classList.toggle('on', id === v.botDifficulty);

    const waiting = v.players.filter((p) => p.id !== v.hostId && !p.ready).length;
    const tooFew = !v.fillBots && v.players.length < 2;
    this.startBtn.disabled = waiting > 0 || tooFew;
    let status: string;
    if (v.phase === 'playing') status = 'Match in progress…';
    else if (tooFew) status = 'Need at least 2 players, or turn on "Fill with bots".';
    else if (waiting > 0) status = `Waiting for ${waiting} player${waiting === 1 ? '' : 's'} to ready up.`;
    else status = isHost ? 'Everyone is ready. Start when you are.' : 'Waiting for the host to start the match.';
    this.statusEl.textContent = status;
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }
}
