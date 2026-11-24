// The broadcast: Mack calls the run live, Nova is the DJ between and over the tracks.
// Both are driven entirely by events from the game and the radio.
//
// Voices come from recorded clips in voice/ (natural-sounding, made ahead of time with an
// open-source speech model). Anything without a clip falls back to the device's own voice.
import { bus } from './events.js';
import { settings } from './settings.js';
import { MACK, NOVA, NOVA_LIVE } from './lines.js';
import { speakable, clipId, segments, displayText, spokenTime, spokenDelta, fixCaps } from './speech.js';

// "Song (feat. Someone) [From a Film] - 2011 Remaster" → "Song": nobody on the radio reads all that out
function cleanTitle(title) {
  if (!title) return title;
  const short = title.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+[-–—]\s+.*$/, '').trim();
  return short || title;
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
  constructor(audio) {
    this.audio = audio;
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.voices = [];
    this.queue = [];
    this.current = null;
    this.unlocked = false;
    this.clips = null;                 // { mack: Set(ids), nova: Set(ids) } once the manifest is in
    this.buffers = new Map();          // "who/id" → Promise<AudioBuffer>
    this.loading = 0;
    this.waiting = [];
    if (this.synth) {
      this._loadVoices();
      this.synth.addEventListener?.('voiceschanged', () => this._loadVoices());
    }
    this._loadManifest();
  }

  async _loadManifest() {
    try {
      const res = await fetch('voice/manifest.json');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      this.clips = { mack: new Set(data.mack || []), nova: new Set(data.nova || []) };
    } catch {
      this.clips = { mack: new Set(), nova: new Set() };
    }
    bus.emit('voices', {});
  }

  get hasRecordings() { return !!this.clips && this.clips.mack.size + this.clips.nova.size > 0; }
  get recorded() { return settings.voiceMode !== 'device' && this.hasRecordings && !!this.audio.ctx; }

  // the clip ids that make up a line, or null if any piece hasn't been recorded
  clipsFor(who, text) {
    if (!this.clips) return null;
    const set = this.clips[who];
    const ids = segments(text).map((s) => clipId(who, s));
    return ids.length && ids.every((id) => set.has(id)) ? ids : null;
  }

  _buffer(who, id) {
    const key = `${who}/${id}`;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const ctx = this.audio.ctx;
    const p = fetch(`voice/${key}.mp3`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((data) => new Promise((resolve, reject) => {
        // the callback form works everywhere, including older Safari
        const maybe = ctx.decodeAudioData(data, resolve, reject);
        if (maybe && maybe.catch) maybe.catch(reject);
      }));
    p.catch(() => this.buffers.delete(key));
    this.buffers.set(key, p);
    if (this.buffers.size > 260) this.buffers.delete(this.buffers.keys().next().value);
    return p;
  }

  // fetch clips ahead of time, a few at a time, so the first use is instant
  preload(who, texts) {
    if (!this.recorded) return;
    for (const text of texts) {
      const ids = this.clipsFor(who, text);
      if (ids) for (const id of ids) if (!this.buffers.has(`${who}/${id}`)) this.waiting.push([who, id]);
    }
    this._drain();
  }
  _drain() {
    while (this.loading < 3 && this.waiting.length) {
      const [who, id] = this.waiting.shift();
      if (this.buffers.has(`${who}/${id}`)) continue;
      this.loading++;
      this._buffer(who, id).catch(() => {}).finally(() => { this.loading--; this._drain(); });
    }
  }

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
    // the better-sounding voices tend to say so in their names
    const fine = this.voices.filter((x) => /natural|neural|enhanced|premium/i.test(x.name));
    const prefs = who === 'nova'
      ? [/Samantha/i, /Google US English/i, /Aria|Jenny|Ava|Zira|Michelle/i, /Karen|Moira|Tessa|Libby|Sonia/i, /female/i]
      : [/Daniel/i, /Google UK English Male/i, /Ryan|Guy|George|Arthur|Oliver|Thomas/i, /Google UK English/i, /\bmale/i];
    for (const pool of [fine, this.voices]) {
      for (const re of prefs) { v = pool.find((x) => re.test(x.name)); if (v) return v; }
    }
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
    // start fetching its clips while it waits its turn
    if (this.recorded) this.preload(item.who, [item.text]);
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
    const shown = displayText(item.text);
    const est = 900 + shown.length * 62;
    item.finished = false;
    item.finish = () => {
      if (item.finished) return;
      item.finished = true;
      clearTimeout(item.watch);
      if (this.current === item) this.current = null;
      bus.emit('voice:end', { who: item.who });
      setTimeout(() => this._pump(), 260);
    };
    const ids = this.recorded ? this.clipsFor(item.who, item.text) : null;
    bus.emit('voice:start', { who: item.who, text: shown, recorded: !!ids });
    if (settings.voiceVolume <= 0.01) { item.watch = setTimeout(item.finish, est); return; }

    if (ids) this._playClips(item, ids, est);
    else this._speakDevice(item, shown, est);
  }

  // recorded voice: play the clip, or several back to back for a spliced line
  _playClips(item, ids, est) {
    const ctx = this.audio.ctx;
    let gaveUp = false;
    const slow = setTimeout(() => { gaveUp = true; this._speakDevice(item, displayText(item.text), est); }, 2600);
    Promise.all(ids.map((id) => this._buffer(item.who, id))).then((buffers) => {
      clearTimeout(slow);
      if (gaveUp || item.finished) return;
      if (ctx.state !== 'running') ctx.resume?.().catch?.(() => {});
      let t = ctx.currentTime + 0.04;
      let last = null;
      for (const buf of buffers) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audio.voice);
        src.start(t);
        t += buf.duration + 0.04;
        last = src;
      }
      item.sources = last;
      last.onended = item.finish;
      item.watch = setTimeout(item.finish, (t - ctx.currentTime) * 1000 + 700);
    }).catch(() => {
      clearTimeout(slow);
      if (!gaveUp && !item.finished) this._speakDevice(item, displayText(item.text), est);
    });
  }

  // the device's own text-to-speech
  _speakDevice(item, shown, est) {
    const started = performance.now();
    // If the device has no working voice the engine "finishes" instantly;
    // keep the subtitle up for a readable time anyway.
    const done = (e) => {
      if (item.finished) return;
      const failed = e && e.type === 'error';
      const least = failed ? est : Math.min(est * 0.45, 1100);
      const elapsed = performance.now() - started;
      if (elapsed >= least) { item.finish(); return; }
      clearTimeout(item.watch);
      item.watch = setTimeout(item.finish, least - elapsed);
    };
    if (!(this.synth && this.unlocked)) { item.watch = setTimeout(item.finish, est); return; }

    const u = new SpeechSynthesisUtterance(speakable(shown));
    const v = this.pick(item.who);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    // bending the pitch is what makes built-in voices sound most robotic, so leave it alone
    u.rate = item.who === 'mack' ? 1.08 : 1;
    u.pitch = 1;
    u.volume = settings.voiceVolume;
    u.onend = done;
    u.onerror = done;
    item.watch = setTimeout(() => { try { this.synth.cancel(); } catch { /* ignore */ } item.finish(); }, est * 1.9 + 2500);
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
    this.voice = new Voicebox(audio);
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
    const st = this.radio.station;
    const base = {
      // a recording can't know your name, so the recorded voices say "our runner"
      name: this.voice.recorded ? 'our runner' : ((settings.name || 'Runner').trim() || 'Runner'),
      daypart: h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening',
      day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
      station: st ? (st.custom ? 'your station' : st.name) : 'Skyline FM',
      falls: g.falls,
      kmh: Math.round((g.topSpeed || 0) * 3.6),
      combo: g.bestCombo,
      best: g.bestCombo,
    };
    const all = { ...base, ...vars };
    return fixCaps(text.replace(/\{(\w+)\}/g, (_, k) => (all[k] ?? '')));
  }

  // Pick a line from a list. With recorded voices, prefer one whose every piece has a clip
  // (a number outside the recorded range, say, rules a line out).
  _choose(who, list, vars) {
    const bag = this._bag(list);
    let first = null;
    for (let i = 0; i < list.length; i++) {
      const text = this._fill(bag.next(), vars);
      if (!this.voice.recorded || this.voice.clipsFor(who, text)) return text;
      first = first ?? text;
    }
    return first;
  }

  mack(list, vars, { p = 1, ttl = 2600, priority = 1 } = {}) {
    if (!settings.commentaryOn || !list || !list.length) return false;
    if (Math.random() > p) return false;
    const now = performance.now();
    if (priority < 2 && now - this.lastMack < 2400) return false;
    // small talk only waits a moment for whoever is talking; if they run long, it's dropped
    this.lastMack = now;
    this.voice.say({ who: 'mack', text: this._choose('mack', list, vars), ttl, priority });
    return true;
  }

  nova(list, vars, { p = 1, ttl = 7000, priority = 1.5, sting = false } = {}) {
    if (!settings.djOn || !list || !list.length) return false;
    if (Math.random() > p) return false;
    this.lastNova = performance.now();
    this.sinceNova = 0;
    if (sting) this.audio.sting();
    this.voice.say({ who: 'nova', text: this._choose('nova', list, vars), ttl, priority });
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
    if (kmh >= 44 && kmh > this.mentioned.speed + 4) {
      options.push(() => { this.mentioned.speed = kmh; return this.nova(NOVA.shoutSpeed, {}, { sting: true }); });
    }
    if (g.falls === 0 && g.progress > 0.35 && g.running) options.push(() => this.nova(NOVA.shoutClean, {}, { sting: true }));
    options.push(() => this.nova(NOVA.timeCheck, {}, { sting: true }));
    options.push(() => this.nova(NOVA.ident, {}, { sting: true }));
    options[(Math.random() * options.length) | 0]();
  }

  // get the quick reaction lines into memory before they're needed
  _preloadReactions() {
    const fixed = (list) => list.filter((t) => !/\{(?!name\})/.test(t)).map((t) => this._fill(t));
    const keys = ['runStart', 'vault', 'gap', 'bigJump', 'climb', 'clutch', 'wallrun', 'wallrunFirst', 'walljump',
      'wallkick', 'slide', 'slideUnder', 'roll', 'hardLanding', 'spring', 'combo3', 'combo5', 'combo8',
      'comboBreak', 'fall', 'fallRepeat', 'splat', 'speed'];
    this.voice.preload('mack', keys.flatMap((k) => fixed(MACK[k])));
    this.voice.preload('mack', Object.values(MACK.zone).flatMap(fixed));
  }

  _wire() {
    const first = (key) => { if (this.seen.has(key)) return false; this.seen.add(key); return true; };

    // music ducks under whoever is talking
    bus.on('voice:start', () => this.radio.duck(true));
    bus.on('voice:end', () => { if (!this.voice.queue.length) this.radio.duck(false); });

    bus.on('game:welcome', () => {
      this.mack(MACK.welcome, {}, { priority: 2, ttl: 9000 });
      this.nova(NOVA.signOn, {}, { ttl: 20000, priority: 1.8, sting: true });
      setTimeout(() => this._preloadReactions(), 400);
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
      const vars = { dist: Math.round(e.dist), drop: Math.round(e.drop) };
      if (e.kind === 'hard') this.mack(MACK.hardLanding, vars, { p: 0.9, priority: 2, ttl: 2500 });
      else if (e.kind === 'roll') this.mack(MACK.roll, vars, { p: first('roll') ? 1 : 0.7 });
      else if (e.jumped && e.dist >= 8) this.mack(MACK.bigJump, vars, { p: 0.75 });
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
      const vars = { cp: e.name, split: spokenTime(e.split), delta: e.delta == null ? '' : spokenDelta(e.delta) };
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
      const vars = { time: spokenTime(e.time), falls: e.falls };
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
      if (g.running) this.mack(MACK.station, {}, { p: 0.45 });
      if (e.station.kind === 'house') this.nova(NOVA.tuneHouse, {}, { ttl: 5000, priority: 2 });
      else this.nova(NOVA.tuneSpotify, {}, { ttl: 5000, priority: 2 });
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
        const vars = { track: cleanTitle(t.title), artist: t.artist };
        setTimeout(() => {
          if (this.radio.now !== t) return;
          // a recording can't read out a real song title; the device voice can
          if (this.voice.recorded || !t.title) this.nova(NOVA.spotifyNoTitle, vars, { p: 0.5, ttl: 6000 });
          else if (t.artist) this.nova(NOVA_LIVE.spotifyIntroArtist, vars, { p: 0.85, ttl: 8000 });
          else this.nova(NOVA_LIVE.spotifyIntro, vars, { p: 0.85, ttl: 8000 });
        }, 1200);
      }
    });
    bus.on('radio:needstap', () => this.nova(NOVA.needsTap, {}, { ttl: 8000, priority: 2 }));
    bus.on('phone:open', () => { if (this.getGame().running) this.mack(MACK.phone, {}, { p: 0.4 }); });
  }
}
