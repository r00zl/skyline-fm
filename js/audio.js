// All sound is synthesised with Web Audio: footsteps, wind, landings, radio stings,
// and the "house band", a small generative synth group that is Skyline FM's built-in station.
import { bus } from './events.js';
import { settings } from './settings.js';
import { CATALOGUE } from './catalogue.js';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // On iPhone, game audio is silenced by the ring/silent switch unless the page
    // says it is media playback (iOS 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    const ctx = new AC();
    this.ctx = ctx;
    // browsers suspend audio when the tab is hidden or a call comes in: wake it on return
    const wake = () => { if (ctx.state !== 'running') ctx.resume?.().catch?.(() => {}); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = settings.sfxVolume; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = settings.musicVolume; this.music.connect(this.master);
    this.duckGain = ctx.createGain(); this.duckGain.connect(this.music);   // house band → duck → music volume
    this.voice = ctx.createGain(); this.voice.gain.value = settings.voiceVolume; this.voice.connect(this.master);

    // one second of noise, reused everywhere
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._wind();
    this._slideLoop();
    this.ready = true;
    this._wire();
  }

  setVolumes() {
    if (!this.ctx) return;
    this.sfx.gain.value = settings.sfxVolume;
    this.music.gain.value = settings.musicVolume;
    this.voice.gain.value = settings.voiceVolume;
  }

  duck(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(on ? 0.28 : 1, t, on ? 0.06 : 0.25);
  }

  // ───────────── building blocks ─────────────
  _noise(dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.002, when = 0, freqEnd = null, dest = null } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfx);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  _tone(freq, dur, { type = 'sine', gain = 0.2, freqEnd = null, attack = 0.004, when = 0, dest = null } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _wind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.02;
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
    this.wind = { f, g };
  }
  setWind(speed, airborne) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 14);
    this.wind.g.gain.setTargetAtTime(0.02 + k * k * 0.16 + (airborne ? 0.04 : 0), t, 0.15);
    this.wind.f.frequency.setTargetAtTime(380 + k * 900, t, 0.2);
  }
  _slideLoop() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
    this.slide = g;
  }
  setSlide(on) {
    if (!this.ctx) return;
    this.slide.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, on ? 0.03 : 0.08);
  }

  // ───────────── game sounds ─────────────
  step(speed, wall) {
    const v = 0.05 + Math.min(1, speed / 12) * 0.09;
    this._noise(0.07, { type: 'lowpass', freq: wall ? 1500 : 800 + Math.random() * 300, gain: v * 1.6 });
    this._tone(wall ? 150 : 95 + Math.random() * 20, 0.06, { gain: v, freqEnd: 60 });
  }
  jump() { this._noise(0.16, { freq: 600, freqEnd: 1600, q: 0.8, gain: 0.09 }); }
  land(kind, fallSpeed) {
    const k = Math.min(1, fallSpeed / 24);
    this._tone(120, 0.18, { gain: 0.22 + k * 0.3, freqEnd: 45 });
    this._noise(0.14, { type: 'lowpass', freq: 900, gain: 0.14 + k * 0.25 });
    if (kind === 'hard') this._noise(0.3, { type: 'lowpass', freq: 400, gain: 0.4 });
    if (kind === 'roll') this._noise(0.35, { freq: 1300, freqEnd: 500, q: 0.7, gain: 0.16, when: 0.04 });
  }
  vault() { this._tone(180, 0.07, { gain: 0.16, freqEnd: 110 }); this._noise(0.18, { freq: 900, freqEnd: 2000, gain: 0.08, when: 0.03 }); }
  climb() { this._tone(150, 0.08, { gain: 0.18, freqEnd: 90 }); this._noise(0.25, { type: 'lowpass', freq: 700, gain: 0.1, when: 0.05 }); }
  wallOn() { this._noise(0.12, { freq: 1800, q: 1.2, gain: 0.12 }); }
  wallJump() { this._tone(210, 0.09, { gain: 0.2, freqEnd: 120 }); this._noise(0.2, { freq: 700, freqEnd: 2200, gain: 0.1 }); }
  spring() {
    this._tone(180, 0.35, { type: 'triangle', gain: 0.3, freqEnd: 720 });
    this._tone(360, 0.3, { type: 'sine', gain: 0.12, freqEnd: 1440, when: 0.02 });
  }
  checkpoint(ahead) {
    const a = ahead === false ? [523, 494] : [587, 880];
    this._tone(a[0], 0.16, { type: 'triangle', gain: 0.2 });
    this._tone(a[1], 0.32, { type: 'triangle', gain: 0.2, when: 0.11 });
  }
  finish() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.5, { type: 'triangle', gain: 0.2, when: i * 0.12 }));
    this._tone(1319, 0.9, { type: 'sine', gain: 0.14, when: 0.5 });
  }
  fall() { this._noise(1.1, { freq: 1600, freqEnd: 200, q: 0.9, gain: 0.3, attack: 0.3 }); }
  respawn() { this._tone(330, 0.2, { type: 'triangle', gain: 0.12, freqEnd: 660 }); }
  comboTick(n) { this._tone(440 * Math.pow(1.0595, Math.min(n, 14) * 2), 0.1, { type: 'triangle', gain: 0.08 }); }

  // radio flavour
  tune() {
    this._noise(0.35, { type: 'bandpass', freq: 3000, freqEnd: 900, q: 2, gain: 0.14 });
    this._tone(900, 0.3, { type: 'sine', gain: 0.03, freqEnd: 2400 });
  }
  sting() {
    [659, 784, 988].forEach((f, i) => this._tone(f, 0.22, { type: 'triangle', gain: 0.1, when: i * 0.09 }));
  }
  click() { this._tone(1200, 0.03, { type: 'square', gain: 0.03 }); }

  _wire() {
    bus.on('step', (e) => this.step(e.speed, e.wall));
    bus.on('jump', () => this.jump());
    bus.on('land', (e) => this.land(e.kind, e.fallSpeed));
    bus.on('vault', () => this.vault());
    bus.on('climb', () => this.climb());
    bus.on('wallrun:start', () => this.wallOn());
    bus.on('walljump', () => this.wallJump());
    bus.on('wallkick', () => this.wallJump());
    bus.on('spring', () => this.spring());
    bus.on('slide:start', () => this.setSlide(true));
    bus.on('slide:end', () => this.setSlide(false));
    bus.on('checkpoint', (e) => this.checkpoint(e.delta == null ? null : e.delta <= 0));
    bus.on('finish', () => this.finish());
    bus.on('fall', () => { this.setSlide(false); this.fall(); });
    bus.on('respawn', () => this.respawn());
    bus.on('move', (e) => { if (e.combo >= 2) this.comboTick(e.combo); });
  }
}

// ─────────────────────────── the house band ───────────────────────────
const PROGRESSIONS = [
  [0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4], [0, 4, 5, 3], [3, 4, 5, 5], [0, 0, 3, 4], [5, 4, 3, 4],
];
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// small seeded generator, so each record in the catalogue always sounds the same
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class HouseBand {
  constructor(audio) {
    this.audio = audio;
    this.playing = false;
    this.timer = null;
    this.track = null;
    this.order = [];
    this.lastIndex = -1;
  }

  get ctx() { return this.audio.ctx; }

  _newTrack() {
    if (!this.order.length) {
      this.order = CATALOGUE.map((_, i) => i).sort(() => Math.random() - 0.5);
      if (this.order[this.order.length - 1] === this.lastIndex) this.order.reverse();
    }
    const index = this.order.pop();
    this.lastIndex = index;
    const r = seeded(4099 + index * 7919);
    const pick = (arr) => arr[(r() * arr.length) | 0];
    const scaleName = pick(['minor', 'minor', 'dorian', 'major']);
    const bars = [4, 8, 8, 4, 8, 4];           // intro, A, B, break, B, outro
    const track = {
      index,
      title: CATALOGUE[index].title, artist: CATALOGUE[index].artist,
      bpm: 104 + ((r() * 14) | 0) * 2,
      root: 45 + ((r() * 8) | 0),               // A2..E3
      scale: SCALES[scaleName],
      prog: pick(PROGRESSIONS),
      lead: pick(['triangle', 'square', 'sawtooth']),
      swing: r() < 0.35 ? 0.12 : 0,
      hatPattern: pick([[1, 0, 1, 0], [1, 1, 1, 0], [1, 0, 1, 1], [1, 1, 1, 1]]),
      bassPattern: pick([[1, 0, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 0, 1, 0], [1, 0, 0, 0, 1, 0, 1, 1], [1, 1, 0, 1, 0, 1, 0, 0]]),
      arp: Array.from({ length: 16 }, () => (r() < 0.55 ? (r() * 5) | 0 : -1)),
      sections: bars,
      totalBars: bars.reduce((a, b) => a + b, 0),
    };
    track.stepDur = 60 / track.bpm / 4;
    track.duration = track.totalBars * 16 * track.stepDur;
    return track;
  }

  start() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this._setupFx();
    this._begin(this.ctx.currentTime + 0.15);
    this.timer = setInterval(() => this._schedule(), 60);
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    if (this.bus) {
      const t = this.ctx.currentTime;
      this.bus.gain.setTargetAtTime(0, t, 0.05);
      const old = this.bus;
      setTimeout(() => old.disconnect(), 400);
      this.bus = null;
    }
  }
  next() {
    if (!this.playing) return;
    this.stop();
    this.start();
  }

  _setupFx() {
    const ctx = this.ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.85;
    this.bus.connect(this.audio.duckGain);
    // a simple feedback delay for the lead
    this.delay = ctx.createDelay(1.5);
    this.fb = ctx.createGain(); this.fb.gain.value = 0.32;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    this.delay.connect(this.fb); this.fb.connect(this.delay);
    this.delay.connect(wet); wet.connect(this.bus);
  }

  _begin(when) {
    this.track = this._newTrack();
    this.t0 = when;
    this.step = 0;
    this.nextTime = when;
    this.delay.delayTime.value = this.track.stepDur * 3;
    bus.emit('radio:track', { title: this.track.title, artist: this.track.artist, source: 'house', duration: this.track.duration });
  }

  _schedule() {
    if (!this.playing) return;
    const ctx = this.ctx, tr = this.track;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const total = tr.totalBars * 16;
      if (this.step >= total) {
        bus.emit('radio:trackend', { title: tr.title, artist: tr.artist, source: 'house' });
        this._begin(this.nextTime + 1.2);
        return;
      }
      this._playStep(this.step, this.nextTime);
      // swing: even steps run a little long, odd steps a little short
      this.nextTime += tr.stepDur * (1 + (this.step % 2 === 0 ? tr.swing : -tr.swing));
      this.step++;
    }
  }

  _section(bar) {
    let acc = 0;
    const names = ['intro', 'a', 'b', 'break', 'b', 'outro'];
    for (let i = 0; i < this.track.sections.length; i++) {
      acc += this.track.sections[i];
      if (bar < acc) return names[i];
    }
    return 'outro';
  }

  _degree(deg, octave = 0) {
    const sc = this.track.scale;
    const n = sc.length;
    const o = Math.floor(deg / n);
    return this.track.root + sc[((deg % n) + n) % n] + 12 * (o + octave);
  }

  _playStep(step, t) {
    const tr = this.track;
    const bar = Math.floor(step / 16), s = step % 16;
    const sec = this._section(bar);
    const chord = tr.prog[bar % tr.prog.length];
    const full = sec === 'a' || sec === 'b';
    const drums = sec !== 'break';

    if (drums && s % 4 === 0 && !(sec === 'outro' && bar % 2 === 1 && s > 8)) this._kick(t);
    if (drums && sec !== 'intro' && (s === 4 || s === 12)) this._snare(t);
    if (drums && tr.hatPattern[s % 4] && (full || s % 2 === 0)) this._hat(t, s % 4 === 2 ? 0.07 : 0.04);
    if (sec !== 'break' && s % 2 === 0 && tr.bassPattern[(s / 2) % 8]) {
      this._bass(this._degree(chord, s === 14 ? 1 : 0), t, tr.stepDur * 1.7);
    }
    if (s === 0 && sec !== 'intro') this._pad([chord, chord + 2, chord + 4], t, tr.stepDur * 16);
    if ((sec === 'b' || sec === 'break') && tr.arp[s] >= 0) {
      const deg = chord + [0, 2, 4, 7, 9][tr.arp[s]];
      this._lead(this._degree(deg, 2), t, tr.stepDur * 1.2);
    }
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.3);
  }
  _snare(t) {
    this.audio._noise(0.16, { type: 'bandpass', freq: 1900, q: 0.7, gain: 0.32, when: t - this.ctx.currentTime, dest: this.bus });
    this.audio._tone(190, 0.08, { gain: 0.16, freqEnd: 120, when: t - this.ctx.currentTime, dest: this.bus });
  }
  _hat(t, gain) {
    this.audio._noise(0.045, { type: 'highpass', freq: 7500, q: 0.5, gain, when: t - this.ctx.currentTime, dest: this.bus });
  }
  _bass(midi, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi - 12);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.34, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
  }
  _pad(degrees, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.075, t + 0.35);
    g.gain.setValueAtTime(0.075, t + dur - 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g); g.connect(this.bus);
    for (const d of degrees) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(this._degree(d, 1)); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.3);
      }
    }
  }
  _lead(midi, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = this.track.lead; o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g = ctx.createGain();
    const level = this.track.lead === 'triangle' ? 0.16 : 0.07;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.bus); g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.05);
  }
}
