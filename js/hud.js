// Heads-up display: timer, speed, flow, hints, subtitles, the radio chip.
import { bus } from './events.js';
import { settings } from './settings.js';
import { PHYS } from './player.js';

export const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
export const fmtDelta = (d) => `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;

const MOVE_NAMES = {
  gap: 'Gap', vault: 'Vault', climb: 'Climb', wallrun: 'Wall-run', walljump: 'Wall-jump',
  slide: 'Slide', roll: 'Roll', spring: 'Springboard', wallkick: 'Wall kick',
};
const WHO = { mack: 'Mack', nova: 'Nova' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(touch) {
    this.touch = touch;
    this.el = {
      hud: $('hud'), timer: $('timer'), split: $('split'), speed: $('speed'), flow: $('flow-fill'),
      combo: $('combo'), comboN: $('combo-n'), comboMove: $('combo-move'),
      hint: $('hint'), toast: $('toast'), subs: $('subs'), lines: $('speedlines'),
      chipStation: $('chip-station'), chipTrack: $('chip-track'), fade: $('fade'),
    };
    const k = (key) => `<kbd>${key}</kbd>`;
    this.hints = touch ? {
      move: 'Left thumb runs, right thumb looks. The clock starts when you move.',
      vault: 'Run straight at low obstacles. You vault them without breaking stride.',
      jump: 'Tap JUMP at the orange line to clear the gap.',
      climb: 'Jump at a ledge and keep pushing forward to pull yourself up.',
      slide: 'Hold SLIDE while running to go under the ducts.',
      wallrun: 'No roof ahead. Jump at the orange billboard and keep pushing forward to run along it.',
      walljump: 'Run the left billboard, then tap JUMP to kick across to the right one.',
      spring: 'Run onto the orange pad.',
      roll: 'Long drop. Hold SLIDE as you land to roll and keep your speed.',
      beams: 'Narrow beams. Line up before you jump.',
      climb2: 'Climb the stack. Holding JUMP against a tall wall kicks you a little higher.',
      finale: 'Sprint finish. Jump late, and roll the last landing.',
      roll2: 'One more big drop. Roll it.',
    } : {
      move: `${k('W')}${k('A')}${k('S')}${k('D')} to run, mouse to look. The clock starts when you move.`,
      vault: 'Run straight at low obstacles. You vault them without breaking stride.',
      jump: `${k('Space')} to jump the gap. Leave it late: jump at the orange line.`,
      climb: 'Jump at a ledge and keep holding forward to pull yourself up.',
      slide: `${k('Shift')} while running to slide under the ducts.`,
      wallrun: 'No roof ahead. Jump at the orange billboard and keep holding forward to run along it.',
      walljump: `Run the left billboard, then ${k('Space')} to kick across to the right one.`,
      spring: 'Run onto the orange pad.',
      roll: `Long drop. Hold ${k('Shift')} as you land to roll and keep your speed.`,
      beams: 'Narrow beams. Line up before you jump.',
      climb2: `Climb the stack. Holding ${k('Space')} against a tall wall kicks you a little higher.`,
      finale: 'Sprint finish. Jump late, and roll the last landing.',
      roll2: 'One more big drop. Roll it.',
    };
    this.hintTimer = null; this.toastTimer = null; this.splitTimer = null;
    this.subEls = [];
    this.lastSpeed = -1;
    this._wire();
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  _wire() {
    bus.on('hint', (e) => this.hint(e.id));
    bus.on('toast', (e) => this.toast(e.text, e.ms));
    bus.on('voice:start', (e) => this.subtitle(e.who, e.text));
    bus.on('voice:end', (e) => this.endSubtitle(e.who));
    bus.on('move', (e) => {
      const { combo, comboN, comboMove } = this.el;
      comboMove.textContent = MOVE_NAMES[e.kind] || e.kind;
      comboN.textContent = e.combo > 1 ? `×${e.combo}` : '';
      comboN.classList.remove('pop'); void comboN.offsetWidth; comboN.classList.add('pop');
      combo.classList.add('show');
    });
    const hideCombo = () => this.el.combo.classList.remove('show');
    bus.on('combo:end', hideCombo);
    bus.on('combo:break', hideCombo);
    bus.on('respawn', hideCombo);
    bus.on('checkpoint', (e) => {
      const s = this.el.split;
      s.className = 'show';
      if (e.delta == null) s.textContent = `${e.name} · ${fmtTime(e.split)}`;
      else {
        s.textContent = `${e.name} · ${fmtDelta(e.delta)}`;
        s.classList.add(e.delta <= 0 ? 'ahead' : 'behind');
      }
      clearTimeout(this.splitTimer);
      this.splitTimer = setTimeout(() => s.classList.remove('show'), 3500);
    });
    bus.on('radio:station', (e) => {
      this.el.chipStation.textContent = `${e.station.freq} ${e.station.name}`;
      this.el.chipTrack.textContent = e.station.kind === 'house' ? 'Tuning in…' : 'Spotify';
    });
    bus.on('radio:track', (t) => {
      this.el.chipTrack.textContent = t.title ? (t.artist ? `${t.title} · ${t.artist}` : t.title) : 'Spotify';
    });
    bus.on('radio:state', (e) => document.body.classList.toggle('radio-playing', e.playing));
    bus.on('radio:needstap', () => this.toast(this.touch ? 'Tap the radio chip, then press play on Spotify.' : 'Press Tab, then press play on the Spotify player.', 6000));
    bus.on('radio:needlink', () => this.toast('Paste a Spotify link under Stations to use "My station".', 4000));
  }

  hint(id) {
    const text = this.hints[id];
    if (!text || settings.hintsDone) return;
    const h = this.el.hint;
    h.innerHTML = text;
    h.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => h.classList.remove('show'), 6000);
  }
  clearHint() { this.el.hint.classList.remove('show'); }

  toast(text, ms = 3200) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  subtitle(who, text) {
    if (!settings.subtitles) return;
    const div = document.createElement('div');
    div.className = `sub ${who}`;
    div.innerHTML = `<b>${WHO[who] || who}</b>${esc(text)}`;
    this.el.subs.appendChild(div);
    this.subEls.push({ who, div });
    while (this.subEls.length > 2) this.subEls.shift().div.remove();
  }
  endSubtitle(who) {
    const i = this.subEls.findIndex((s) => s.who === who);
    if (i < 0) return;
    const { div } = this.subEls.splice(i, 1)[0];
    setTimeout(() => div.remove(), 500);
  }

  flash() {
    const f = this.el.fade;
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 160);
  }

  update(game, player) {
    this.el.timer.textContent = fmtTime(game.time);
    const kmh = Math.round(player.speed * 3.6);
    if (kmh !== this.lastSpeed) { this.el.speed.textContent = kmh; this.lastSpeed = kmh; }
    this.el.flow.style.width = `${Math.round(player.flow * 100)}%`;
    const over = (player.speed - PHYS.RUN * 1.05) / 4.5;
    this.el.lines.style.opacity = Math.max(0, Math.min(0.5, over * 0.5)).toFixed(2);
  }
}
