// The broadcast: Mack calls the run live, Nova is the DJ between and over the tracks.
// Both are driven entirely by events from the game and the radio.
import { bus } from './events.js';
import { settings } from './settings.js';
import { MACK, NOVA } from './lines.js';

// text → something a speech engine reads well
function speakable(text) {
  return text
    .replace(/\bFM\b/g, 'F M')
    .replace(/98\.6/g, 'ninety-eight point six')
    .replace(/\blofi\b/gi, 'lo-fi')
    .replace(/&/g, ' and ');
}

export function spokenTime(sec) {
  if (sec < 60) return `${sec.toFixed(1)} seconds`;
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m} minute${m === 1 ? '' : 's'} ${s.toFixed(1)} seconds`;
}

class Bag {
  constructor(list) { this.list = list; this.left = []; this.last = null; }
  next() {
    if (!this.left.length) {
      this.left = [...this.list].sort(() => Math.random() - 0.5);
      if (this.left.length > 1 && this.left[this.left.length - 1] === this.last) this.left.reverse();
    }
    this.last = this.left.pop();
    return this.last;
  }
}

// ─────────────────────────── voices ───────────────────────────
export class Voicebox {
  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.voices = [];
    this.queue = [];
    this.current = null;
    this.unlocked = false;
    if (this.synth) {
      this._loadVoices();
      this.synth.addEventListener?.('voiceschanged', () => this._loadVoices());
    }
  }
  get available() { return !!this.synth; }

  _loadVoices() {
    let all = [];
    try { all = this.synth.getVoices() || []; } catch { /* ignore */ }
    const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang));
    this.voices = en.length ? en : all;
    bus.emit('voices', {});
  }

  pick(who) {
    const want = who === 'nova' ? settings.djVoice : settings.mackVoice;
    let v = want && this.voices.find((x) => x.name === want);
    if (v) return v;
    const prefs = who === 'nova'
      ? [/Samantha/i, /Google US English/i, /Aria|Jenny|Ava|Zira|Michelle/i, /Karen|Moira|Tessa|Libby|Sonia/i, /female/i]
      : [/Daniel/i, /Google UK English Male/i, /Ryan|Guy|George|Arthur|Oliver|Thomas/i, /Google UK English/i, /\bmale/i];
    for (const re of prefs) { v = this.voices.find((x) => re.test(x.name)); if (v) return v; }
    return who === 'nova' ? this.voices[0] : (this.voices[1] || this.voices[0]);
  }

  // must be called from a tap/click, or browsers refuse to speak
  unlock() {
    if (!this.synth || this.unlocked) return;
    this.unlocked = true;
    try {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
    } catch { /* ignore */ }
  }

  say(item) {
    item.at = performance.now();
    this.queue.push(item);
    if (this.queue.length > 4) {
      // too much to say: drop the least important, oldest first
      this.queue.sort((a, b) => b.priority - a.priority || b.at - a.at);
      this.queue.length = 4;
    }
    this._pump();
  }

  _pump() {
    if (this.current) return;
    const now = performance.now();
    this.queue = this.queue.filter((q) => now - q.at <= q.ttl);
    if (!this.queue.length) { bus.emit('voice:idle', {}); return; }
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    const item = this.queue.shift();
    this.current = item;
    this._speak(item);
  }

  _speak(item) {
    let finished = false;
    const started = performance.now();
    const est = 900 + item.text.length * 62;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(item.watch);
      if (this.current === item) this.current = null;
      bus.emit('voice:end', { who: item.who });
      setTimeout(() => this._pump(), 280);
    };
    // If the device has no working voice the engine "finishes" instantly;
    // keep the subtitle up for a readable time anyway.
    const done = (e) => {
      if (finished) return;
      const failed = e && e.type === 'error';
      const least = failed ? est : Math.min(est * 0.45, 1100);
      const elapsed = performance.now() - started;
      if (elapsed >= least) { finish(); return; }
      clearTimeout(item.watch);
      item.watch = setTimeout(finish, least - elapsed);
    };
    bus.emit('voice:start', { who: item.who, text: item.text });
    const canSpeak = this.synth && this.unlocked && settings.voiceVolume > 0.01;
    if (!canSpeak) { item.watch = setTimeout(finish, est); return; }

    const u = new SpeechSynthesisUtterance(speakable(item.text));
    const v = this.pick(item.who);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = item.who === 'mack' ? 1.14 : 0.98;
    u.pitch = item.who === 'mack' ? 0.88 : 1.12;
    u.volume = settings.voiceVolume;
    u.onend = done;
    u.onerror = done;
    item.watch = setTimeout(() => { try { this.synth.cancel(); } catch { /* ignore */ } finish(); }, est * 1.9 + 2500);
    this.keep = u;   // some browsers drop the end event if the utterance is garbage-collected
    try { this.synth.speak(u); } catch { done({ type: 'error' }); }
  }

  hush() {
    this.queue = [];
    try { this.synth?.cancel(); } catch { /* ignore */ }
  }
}

// ─────────────────────────── the director ───────────────────────────
export class Broadcast {
  constructor(radio, audio, getGame) {
    this.radio = radio;
    this.audio = audio;
    this.getGame = getGame;         // () => { time, falls, running, bestCombo, topSpeed, progress }
    this.voice = new Voicebox();
    this.bags = new Map();
    this.lastMack = 0;
    this.lastNova = 0;
    this.sinceNova = 0;
    this.nextBreak = 55;
    this.seen = new Set();
    this.zonesSeen = new Set();
    this.speedBand = 0;
    this.mentioned = { combo: 0, speed: 0 };
    this.tracksIntroduced = 0;
    this.lastHouse = null;
    this._wire();
  }

  _bag(list) {
    if (!this.bags.has(list)) this.bags.set(list, new Bag(list));
    return this.bags.get(list);
  }

  _fill(text, vars = {}) {
    const now = new Date();
    const h = now.getHours();
    const g = this.getGame();
    const base = {
      name: (settings.name || 'Runner').trim() || 'Runner',
      daypart: h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening',
      clock: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      day: now.toLocaleDateString([], { weekday: 'long' }),
      station: this.radio.station?.name || 'Skyline FM',
      falls: g.falls,
      kmh: Math.round((g.topSpeed || 0) * 3.6),
      combo: g.bestCombo,
    };
    const all = { ...base, ...vars };
    return text.replace(/\{(\w+)\}/g, (_, k) => (all[k] ?? ''));
  }

  mack(list, vars, { p = 1, ttl = 2600, priority = 1 } = {}) {
    if (!settings.commentaryOn || !list || !list.length) return false;
    if (Math.random() > p) return false;
    const now = performance.now();
    if (priority < 2 && now - this.lastMack < 2400) return false;
    // small talk only waits a moment for whoever is talking; if they run long, it's dropped
    this.lastMack = now;
    this.voice.say({ who: 'mack', text: this._fill(this._bag(list).next(), vars), ttl, priority });
    return true;
  }

  nova(list, vars, { p = 1, ttl = 7000, priority = 1.5, sting = false } = {}) {
    if (!settings.djOn || !list || !list.length) return false;
    if (Math.random() > p) return false;
    this.lastNova = performance.now();
    this.sinceNova = 0;
    if (sting) this.audio.sting();
    this.voice.say({ who: 'nova', text: this._fill(this._bag(list).next(), vars), ttl, priority });
    return true;
  }

  // called every frame while a run is active
  update(dt) {
    this.sinceNova += dt;
    if (this.sinceNova > this.nextBreak && !this.voice.current) {
      this.nextBreak = 50 + Math.random() * 35;
      this._djBreak();
    }
  }

  _djBreak() {
    const g = this.getGame();
    const options = [];
    if (g.falls >= 2) options.push(() => this.nova(NOVA.shoutFalls, {}, { sting: true }));
    if (g.bestCombo >= 6 && g.bestCombo > this.mentioned.combo) {
      options.push(() => { this.mentioned.combo = g.bestCombo; return this.nova(NOVA.shoutCombo, {}, { sting: true }); });
    }
    const kmh = Math.round(g.topSpeed * 3.6);
    if (kmh >= 44 && kmh > this.mentioned.speed) {
      options.push(() => { this.mentioned.speed = kmh; return this.nova(NOVA.shoutSpeed, {}, { sting: true }); });
    }
    if (g.falls === 0 && g.progress > 0.35 && g.running) options.push(() => this.nova(NOVA.shoutClean, {}, { sting: true }));
    options.push(() => this.nova(NOVA.timeCheck, {}, { sting: true }));
    options.push(() => this.nova(NOVA.ident, {}, { sting: true }));
    options[(Math.random() * options.length) | 0]();
  }

  _wire() {
    const first = (key) => { if (this.seen.has(key)) return false; this.seen.add(key); return true; };

    // music ducks under whoever is talking
    bus.on('voice:start', () => this.radio.duck(true));
    bus.on('voice:end', () => { if (!this.voice.queue.length) this.radio.duck(false); });

    bus.on('game:welcome', () => {
      this.mack(MACK.welcome, {}, { priority: 2, ttl: 9000 });
      this.nova(NOVA.signOn, {}, { ttl: 20000, priority: 1.8, sting: true });
    });
    bus.on('run:start', () => this.mack(MACK.runStart, {}, { priority: 2, ttl: 1800 }));
    bus.on('run:restart', () => {
      this.zonesSeen.clear();
      this.mack(MACK.restart, {}, { p: 0.6 });
    });

    bus.on('vault', () => this.mack(MACK.vault, {}, { p: first('vault') ? 1 : 0.28 }));
    bus.on('climb', (e) => {
      if (e.clutch) this.mack(MACK.clutch, {}, { priority: 2, ttl: 3000 });
      else this.mack(MACK.climb, {}, { p: first('climb') ? 1 : 0.25 });
    });
    bus.on('land', (e) => {
      const vars = { dist: e.dist.toFixed(1), drop: Math.round(e.drop) };
      if (e.kind === 'hard') this.mack(MACK.hardLanding, vars, { p: 0.9, priority: 2, ttl: 2500 });
      else if (e.kind === 'roll') this.mack(MACK.roll, vars, { p: first('roll') ? 1 : 0.7 });
      else if (e.jumped && e.dist >= 8) this.mack(MACK.bigJump, { dist: Math.round(e.dist) }, { p: 0.75 });
      else if (e.jumped && e.dist >= 3.5) this.mack(MACK.gap, vars, { p: first('gap') ? 1 : 0.1 });
    });
    bus.on('wallrun:start', () => {
      if (first('wallrun')) this.mack(MACK.wallrunFirst, {}, { priority: 2, ttl: 2500 });
      else this.mack(MACK.wallrun, {}, { p: 0.45 });
    });
    bus.on('walljump', () => this.mack(MACK.walljump, {}, { p: first('walljump') ? 1 : 0.5 }));
    bus.on('wallkick', () => this.mack(MACK.wallkick, {}, { p: 0.5 }));
    bus.on('slide:end', (e) => {
      if (e.under) this.mack(MACK.slideUnder, {}, { p: 0.7 });
      else if (e.dur > 0.4) this.mack(MACK.slide, {}, { p: 0.22 });
    });
    bus.on('spring', () => this.mack(MACK.spring, {}, { p: 0.9 }));

    bus.on('move', (e) => {
      const tiers = { 3: [MACK.combo3, 0.5, 1], 5: [MACK.combo5, 1, 2], 8: [MACK.combo8, 1, 2], 12: [MACK.combo12, 1, 2], 20: [MACK.combo20, 1, 2] };
      const t = tiers[e.combo];
      if (t) this.mack(t[0], { combo: e.combo }, { p: t[1], priority: t[2], ttl: 3000 });
    });
    bus.on('combo:break', (e) => { if (e.combo >= 4) this.mack(MACK.comboBreak, { combo: e.combo }, { p: 0.8 }); });

    bus.on('fall', (e) => {
      if (e.splat) this.mack(MACK.splat, {}, { priority: 3, ttl: 4000 });
      else if (e.here >= 3) this.mack(MACK.fallRepeat, { n: e.here }, { priority: 3, ttl: 4000 });
      else this.mack(MACK.fall, {}, { priority: 3, ttl: 4000 });
      if (e.total === 2 || e.total === 6) setTimeout(() => this.nova(NOVA.dedication, {}, { p: 0.7, sting: true }), 2600);
    });

    bus.on('checkpoint', (e) => {
      const vars = { cp: e.name, split: spokenTime(e.split), delta: e.delta == null ? '' : `${Math.abs(e.delta).toFixed(1)} seconds` };
      const list = e.delta == null ? MACK.checkpointFirst : e.delta <= 0 ? MACK.checkpointAhead : MACK.checkpointBehind;
      this.mack(list, vars, { priority: 3, ttl: 5000 });
    });

    bus.on('speed', (e) => {
      // call out each new 5 km/h band above 45
      const band = Math.floor(e.kmh / 5);
      if (e.kmh >= 45 && band > this.speedBand) {
        this.speedBand = band;
        this.mack(MACK.speed, { kmh: e.kmh }, { p: 0.8 });
      }
    });
    bus.on('idle', () => this.mack(MACK.idle, {}, { ttl: 4000 }));
    bus.on('backwards', () => this.mack(MACK.backwards, {}, { priority: 2, ttl: 3000 }));

    bus.on('zone', (e) => {
      const list = MACK.zone[e.id];
      if (!list) return;
      const fresh = !this.zonesSeen.has(e.id);
      this.zonesSeen.add(e.id);
      if (fresh) this.mack(list, {}, { p: first(`zone:${e.id}`) ? 1 : 0.35, priority: 2, ttl: 2600 });
    });

    bus.on('finish', (e) => {
      const vars = { time: spokenTime(e.time), delta: e.delta == null ? '' : `${Math.abs(e.delta).toFixed(1)} seconds`, falls: e.falls };
      let list = MACK.finish;
      if (e.first) list = MACK.finishFirst;
      else if (e.pb) list = MACK.finishPB;
      else if (e.falls === 0) list = MACK.finishClean;
      else if (e.falls >= 5) list = MACK.finishFalls;
      this.voice.queue = [];
      this.mack(list, vars, { priority: 5, ttl: 15000 });
      this.nova(e.pb && !e.first ? NOVA.finishPB : NOVA.finish, vars, { priority: 4, ttl: 25000, sting: true });
    });

    // radio
    bus.on('radio:station', (e) => {
      if (!e.user) return;
      const g = this.getGame();
      if (g.running) this.mack(MACK.station, { station: e.station.name }, { p: 0.45 });
      if (e.station.kind === 'house') this.nova(NOVA.tuneHouse, {}, { ttl: 5000, priority: 2 });
      else this.nova(NOVA.tuneSpotify, { station: e.station.name }, { ttl: 5000, priority: 2 });
    });
    bus.on('radio:track', (t) => {
      this.tracksIntroduced++;
      if (t.source === 'house') {
        const prev = this.lastHouse;
        this.lastHouse = t;
        // give Mack's welcome room on the very first track
        const delay = this.tracksIntroduced === 1 ? 6500 : 900;
        setTimeout(() => {
          if (this.radio.now !== t) return;
          if (prev && Math.random() < 0.4) this.nova(NOVA.houseOutro, { track: prev.title, artist: prev.artist }, { ttl: 6000 });
          this.nova(NOVA.houseIntro, { track: t.title, artist: t.artist }, { p: this.tracksIntroduced <= 2 ? 1 : 0.85, ttl: 9000 });
        }, delay);
      } else {
        const vars = { track: t.title, artist: t.artist, station: t.station };
        setTimeout(() => {
          if (this.radio.now !== t) return;
          if (t.title && t.artist) this.nova(NOVA.spotifyIntroArtist, vars, { p: 0.85, ttl: 8000 });
          else if (t.title) this.nova(NOVA.spotifyIntro, vars, { p: 0.85, ttl: 8000 });
          else this.nova(NOVA.spotifyNoTitle, vars, { p: 0.5, ttl: 6000 });
        }, 1200);
      }
    });
    bus.on('radio:needstap', () => this.nova(NOVA.needsTap, {}, { ttl: 8000, priority: 2 }));
    bus.on('phone:open', () => { if (this.getGame().running) this.mack(MACK.phone, {}, { p: 0.4 }); });
  }
}
