// The in-game phone: radio dial, run log, and settings. It doubles as the pause screen.
import { bus } from './events.js';
import { settings, saveSettings } from './settings.js';
import { fmtTime, fmtDelta } from './hud.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';

export class Phone {
  constructor(radio, voicebox, getGame) {
    this.radio = radio;
    this.voicebox = voicebox;
    this.getGame = getGame;
    this.el = $('phone');
    this.isOpen = false;
    this.app = 'radio';
    this._bind();
    this._settings();
    this.renderStations();
    this.renderNow();
    this.renderPremium();
    setInterval(() => this._tick(), 500);
    this._tick();
  }

  open(app) {
    if (app) this.show(app);
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('phone-open');
    this.renderRuns();
    bus.emit('phone:open', {});
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('phone-open');
    document.activeElement?.blur?.();
    bus.emit('phone:close', {});
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  show(app) {
    this.app = app;
    for (const s of this.el.querySelectorAll('.app')) s.classList.toggle('active', s.id === `app-${app}`);
    for (const b of this.el.querySelectorAll('.tabbar button')) b.classList.toggle('on', b.dataset.app === app);
    if (app === 'runs') this.renderRuns();
  }

  _bind() {
    const r = this.radio;
    for (const b of this.el.querySelectorAll('.tabbar button')) b.addEventListener('click', () => this.show(b.dataset.app));
    $('ph-resume').addEventListener('click', () => this.close());
    // tapping the dimmed game behind the phone puts it away
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });

    $('ph-prev').addEventListener('click', () => r.step(-1));
    $('ph-next').addEventListener('click', () => r.step(1));
    $('ph-play').addEventListener('click', () => r.togglePlay());
    $('ph-skip').addEventListener('click', () => r.next());
    $('stations').addEventListener('click', (e) => {
      const btn = e.target.closest('.station');
      if (!btn) return;
      const st = r.stations.find((s) => s.id === btn.dataset.id);
      if (st.kind === 'spotify' && !st.uri) { $('custom-link').focus(); return; }
      r.tune(st.id, { user: true });
    });
    const tuneCustom = () => {
      const input = $('custom-link');
      if (!input.value.trim()) { input.focus(); return; }
      if (r.setCustom(input.value)) { input.value = ''; input.blur(); r.tune('custom', { user: true }); }
      else bus.emit('toast', { text: "That doesn't look like a Spotify link." });
    };
    $('custom-go').addEventListener('click', tuneCustom);
    $('custom-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') tuneCustom(); });

    $('run-respawn').addEventListener('click', () => { this.close(); bus.emit('ui:respawn'); });
    $('run-restart').addEventListener('click', () => { this.close(); bus.emit('ui:restart'); });

    bus.on('radio:station', () => { this.renderStations(); this.renderNow(); });
    bus.on('radio:stations', () => this.renderStations());
    bus.on('radio:track', () => this.renderNow());
    bus.on('radio:state', () => this.renderNow());
    bus.on('radio:premium', () => { this.renderPremium(); this.renderNow(); });
    bus.on('radio:needlink', () => { this.open('radio'); setTimeout(() => $('custom-link').focus(), 350); });
    bus.on('voices', () => this._voices());
  }

  _settings() {
    const check = (id, key, after) => {
      const el = $(id);
      el.checked = !!settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); after?.(); });
    };
    const range = (id, key, after) => {
      const el = $(id);
      el.value = settings[key];
      el.addEventListener('input', () => { settings[key] = parseFloat(el.value); saveSettings(); after?.(); });
    };
    check('set-dj', 'djOn');
    check('set-mack', 'commentaryOn');
    check('set-subs', 'subtitles');
    check('set-invert', 'invertY');
    range('set-sens', 'sensitivity');
    range('set-music', 'musicVolume', () => this.radio.setVolume());
    range('set-sfx', 'sfxVolume', () => this.radio.setVolume());
    range('set-voice', 'voiceVolume');

    const name = $('set-name');
    name.value = settings.name;
    name.addEventListener('input', () => { settings.name = name.value.trim() || 'Runner'; saveSettings(); });

    const q = $('set-quality');
    q.value = settings.quality;
    q.addEventListener('change', () => {
      settings.quality = q.value; saveSettings();
      bus.emit('toast', { text: 'Graphics setting saved. Reload the page to apply it.', ms: 4500 });
    });

    for (const [id, key] of [['set-djvoice', 'djVoice'], ['set-mackvoice', 'mackVoice']]) {
      $(id).addEventListener('change', (e) => {
        settings[key] = e.target.value; saveSettings();
        this.voicebox.say({ who: key === 'djVoice' ? 'nova' : 'mack', text: key === 'djVoice' ? 'This is how Nova sounds.' : 'And this is Mack, calling the run.', ttl: 4000, priority: 2 });
      });
    }
    this._voices();

    // Spotify Premium
    $('sp-redirect').textContent = this.radio.redirectUri();
    $('sp-client').value = settings.spotifyClientId || '';
    $('sp-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.radio.redirectUri()); bus.emit('toast', { text: 'Redirect address copied.' }); }
      catch { bus.emit('toast', { text: 'Press and hold the address to copy it.' }); }
    });
    $('sp-connect').addEventListener('click', () => {
      const id = $('sp-client').value.trim();
      if (!/^[0-9a-f]{32}$/i.test(id)) { $('sp-status').textContent = 'A Spotify client ID is 32 letters and numbers. Check it and try again.'; return; }
      $('sp-status').textContent = 'Opening Spotify sign-in…';
      this.radio.login(id).catch((err) => { $('sp-status').textContent = err.message; });
    });
    $('sp-disconnect').addEventListener('click', () => this.radio.disconnectPremium());
  }

  _voices() {
    const list = this.voicebox.voices;
    for (const [id, key, who] of [['set-djvoice', 'djVoice', 'nova'], ['set-mackvoice', 'mackVoice', 'mack']]) {
      const sel = $(id);
      if (!list.length) { sel.innerHTML = '<option value="">No voices on this device (subtitles only)</option>'; continue; }
      const auto = this.voicebox.pick(who);
      sel.innerHTML = `<option value="">Auto${auto ? ` (${esc(auto.name)})` : ''}</option>` +
        list.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
      sel.value = list.some((v) => v.name === settings[key]) ? settings[key] : '';
    }
  }

  renderStations() {
    const r = this.radio;
    $('stations').innerHTML = r.stations.map((s) => {
      const on = s === r.station ? ' on' : '';
      const off = s.kind === 'spotify' && !s.uri ? ' off' : '';
      return `<button class="station${on}${off}" data-id="${s.id}">
        <span class="f">${s.freq}</span>
        <span><span class="n">${esc(s.name)}</span><span class="b">${esc(s.blurb)}</span></span>
        <span class="src">${s.kind === 'house' ? 'Built in' : 'Spotify'}</span>
      </button>`;
    }).join('');
  }

  renderNow() {
    const r = this.radio, st = r.station;
    $('ph-station').textContent = st.name;
    $('ph-freq').textContent = st.freq;
    const embed = r.mode === 'embed';
    $('embed-wrap').classList.toggle('hidden', !embed);
    $('now').classList.toggle('hidden', embed);
    $('ph-skip').style.visibility = embed ? 'hidden' : 'visible';
    const now = r.now;
    $('now-title').textContent = now?.title || (st.kind === 'house' ? 'Tuning in…' : st.blurb);
    $('now-artist').textContent = now?.artist || (st.kind === 'house' ? 'Skyline FM house band' : 'Spotify');
    $('ph-play-icon').setAttribute('d', r.playing ? PAUSE : PLAY);
  }

  renderPremium() {
    const r = this.radio;
    const status = $('sp-status');
    const ready = r.sdkStatus === 'ready';
    $('sp-connect').classList.toggle('hidden', ready);
    $('sp-disconnect').classList.toggle('hidden', !(ready || r.sdkStatus === 'error' && r.sdk));
    $('embed-note').textContent = "Playing through Spotify's own player. If it's silent, tap play here once.";
    if (ready) status.textContent = 'Connected. Spotify stations now play in full, with skip and DJ ducking.';
    else if (r.sdkStatus === 'connecting') status.textContent = 'Connecting to Spotify…';
    else if (r.sdkStatus === 'error') status.textContent = `Couldn't connect: ${r.sdkMessage} Stations will keep using the embedded player.`;
    else status.textContent = '';
  }

  renderRuns() {
    const g = this.getGame();
    const best = settings.best;
    $('run-best').textContent = best ? fmtTime(best.time) : '—';
    $('run-count').textContent = settings.runs || 0;
    $('run-now').textContent = fmtTime(g.time);
    $('run-falls').textContent = g.falls;
    $('run-combo').textContent = g.bestCombo;
    $('run-speed').textContent = `${Math.round(g.topSpeed * 3.6)} km/h`;
    const rows = g.checkpoints.slice(1).map((cp, i) => {
      const split = g.splits[i];
      const bestSplit = best?.splits?.[i];
      let d = '', cls = '';
      if (split != null && bestSplit != null) { const delta = split - bestSplit; d = fmtDelta(delta); cls = delta <= 0 ? 'ahead' : 'behind'; }
      return `<div class="split-row"><span>${esc(cp.name)}</span><span class="t">${split != null ? fmtTime(split) : bestSplit != null ? `best ${fmtTime(bestSplit)}` : '—'}</span><span class="d ${cls}">${d}</span></div>`;
    });
    $('splits').innerHTML = rows.join('');
  }

  _tick() {
    $('ph-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (this.isOpen && this.app === 'runs') this.renderRuns();
  }
}
