// The radio: a dial of stations. One is built in (the house band); the rest are Spotify.
import { bus } from './events.js';
import { settings, saveSettings } from './settings.js';
import { HouseBand } from './audio.js';
import {
  SpotifyEmbed, SpotifySdk, lookupTitle, parseSpotifyLink,
  completeLogin, beginLogin, signOut, hasSession, redirectUri,
} from './spotify.js';

export const STATIONS = [
  { id: 'house', kind: 'house', freq: '98.6', name: 'Skyline FM', blurb: 'House band · always on' },
  { id: 'hits', kind: 'spotify', freq: '101.2', name: 'Top Hits', blurb: "Today's Top Hits", uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' },
  { id: 'beast', kind: 'spotify', freq: '96.4', name: 'Beast Mode', blurb: 'Workout energy', uri: 'spotify:playlist:37i9dQZF1DX76Wlfdnj7AP' },
  { id: 'rap', kind: 'spotify', freq: '93.3', name: 'RapCaviar', blurb: 'Hip-hop', uri: 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd' },
  { id: 'rock', kind: 'spotify', freq: '104.9', name: 'Rock Classics', blurb: 'Guitars, loud', uri: 'spotify:playlist:37i9dQZF1DWXRqgorJj26U' },
  { id: 'mint', kind: 'spotify', freq: '107.1', name: 'mint', blurb: 'Dance and electronic', uri: 'spotify:playlist:37i9dQZF1DX4dyzvuaRJ0n' },
  { id: 'eighties', kind: 'spotify', freq: '88.0', name: 'All Out 80s', blurb: 'Synths and big drums', uri: 'spotify:playlist:37i9dQZF1DX4UtSsGT1Sbe' },
  { id: 'lofi', kind: 'spotify', freq: '90.7', name: 'lofi beats', blurb: 'Slow it down', uri: 'spotify:playlist:37i9dQZF1DWWQRwui0ExPn' },
  { id: 'custom', kind: 'spotify', freq: '99.9', name: 'My station', blurb: 'Paste any Spotify link', uri: null, custom: true },
];

export class Radio {
  constructor(audio, embedMount) {
    this.audio = audio;
    this.band = new HouseBand(audio);
    this.embed = new SpotifyEmbed(embedMount, {
      onUpdate: (s) => this._setPlaying(s.playing),
      onTrack: (uri) => this._embedTrack(uri),
    });
    this.sdk = null;
    this.sdkStatus = 'off';          // off | connecting | ready | error
    this.sdkMessage = '';
    this.stations = STATIONS.map((s) => ({ ...s }));
    const custom = this.stations.find((s) => s.custom);
    if (settings.customUri) { custom.uri = settings.customUri; custom.blurb = settings.customLabel || 'Your link'; }
    this.station = this.stations.find((s) => s.id === settings.station) || this.stations[0];
    if (this.station.kind === 'spotify' && !this.station.uri) this.station = this.stations[0];
    this.mode = 'off';               // off | house | embed | sdk
    this.playing = false;
    this.now = null;                 // { title, artist, source }
    this.on = false;
    this.ducked = false;
    this.tapTimer = null;

    bus.on('radio:track', (t) => { if (t.source === 'house') this.now = t; });
  }

  get usingSpotify() { return this.mode === 'embed' || this.mode === 'sdk'; }
  redirectUri() { return redirectUri(); }

  // start whatever was last tuned (needs to be called from a tap/click so audio is allowed)
  powerOn() {
    if (this.on) return;
    this.on = true;
    this.tune(this.station.id, { silent: true });
  }

  step(dir) {
    const usable = this.stations.filter((s) => s.kind === 'house' || s.uri);
    const i = usable.indexOf(this.station);
    const next = usable[(i + dir + usable.length) % usable.length];
    this.tune(next.id, { user: true });
  }

  tune(id, { user = false, silent = false } = {}) {
    const st = this.stations.find((s) => s.id === id);
    if (!st) return;
    if (st.kind === 'spotify' && !st.uri) { bus.emit('radio:needlink', {}); return; }
    const prev = this.station;
    this.station = st;
    settings.station = st.id; saveSettings();
    this.now = null;
    clearTimeout(this.tapTimer);
    if (!silent) this.audio.tune();
    bus.emit('radio:station', { station: st, prev, user });

    if (st.kind === 'house') {
      this._stopSpotify();
      this.mode = 'house';
      this.band.stop();
      this.band.start();
      this._setPlaying(true);
    } else {
      this.band.stop();
      this._setPlaying(false);
      if (this.sdk && this.sdkStatus === 'ready') {
        this.mode = 'sdk';
        this.embed.pause();
        this.sdk.play(st.uri).catch((err) => {
          this.sdkMessage = err.message;
          bus.emit('toast', { text: `Spotify: ${err.message}` });
          this._useEmbed(st);
        });
      } else {
        this._useEmbed(st);
      }
    }
  }

  _useEmbed(st) {
    this.mode = 'embed';
    this.embed.load(st.uri).catch(() => {
      if (this.station !== st) return;
      bus.emit('toast', { text: "Couldn't reach Spotify. Back to Skyline FM." });
      this.tune('house', { silent: true });
    });
    // browsers often block playback that wasn't started by a tap inside the player
    this.tapTimer = setTimeout(() => {
      if (this.station === st && this.mode === 'embed' && !this.embed.started) bus.emit('radio:needstap', { station: st });
    }, 4500);
  }

  _stopSpotify() {
    this.embed.pause();
    if (this.sdk && this.sdkStatus === 'ready') this.sdk.pause()?.catch?.(() => {});
  }

  _setPlaying(p) {
    if (this.playing === p) return;
    this.playing = p;
    bus.emit('radio:state', { playing: p });
  }

  async _embedTrack(uri) {
    if (this.mode !== 'embed') return;
    const st = this.station;
    const title = await lookupTitle(uri);
    if (this.station !== st || this.mode !== 'embed') return;
    this.now = { title, artist: null, source: 'spotify', station: st.name };
    bus.emit('radio:track', this.now);
  }

  togglePlay() {
    if (this.mode === 'house') {
      if (this.band.playing) { this.band.stop(); this._setPlaying(false); }
      else { this.band.start(); this._setPlaying(true); }
    } else if (this.mode === 'sdk') this.sdk.toggle();
    else if (this.mode === 'embed') this.embed.toggle();
  }

  next() {
    if (this.mode === 'house') this.band.next();
    else if (this.mode === 'sdk') this.sdk.next();
    else bus.emit('toast', { text: 'Use the skip button on the Spotify player in your phone.' });
  }

  duck(on) {
    this.ducked = on;
    this.audio.duck(on);
    if (this.mode === 'sdk' && this.sdk) this.sdk.setVolume(on ? settings.musicVolume * 0.3 : settings.musicVolume);
  }
  canDuck() { return this.mode !== 'embed'; }

  setVolume() {
    this.audio.setVolumes();
    if (this.sdk && this.sdkStatus === 'ready') this.sdk.setVolume(this.ducked ? settings.musicVolume * 0.3 : settings.musicVolume);
  }

  setCustom(text) {
    const uri = parseSpotifyLink(text);
    if (!uri) return false;
    const custom = this.stations.find((s) => s.custom);
    custom.uri = uri;
    custom.blurb = 'Your link';
    settings.customUri = uri; settings.customLabel = 'Your link'; saveSettings();
    lookupTitle(uri).then((title) => {
      if (title && custom.uri === uri) {
        custom.blurb = title; settings.customLabel = title; saveSettings();
        bus.emit('radio:stations', {});
      }
    });
    bus.emit('radio:stations', {});
    return true;
  }

  // ───────────── Premium mode ─────────────
  async initPremium() {
    const id = settings.spotifyClientId;
    const result = await completeLogin(id);
    if (result.status === 'error') {
      this.sdkStatus = 'error'; this.sdkMessage = result.message;
      bus.emit('radio:premium', {});
      return;
    }
    if (id && hasSession()) await this.connectPremium();
  }

  login(clientId) {
    settings.spotifyClientId = clientId.trim(); saveSettings();
    return beginLogin(settings.spotifyClientId);
  }

  async connectPremium() {
    this.sdkStatus = 'connecting'; this.sdkMessage = '';
    bus.emit('radio:premium', {});
    this.sdk = new SpotifySdk(settings.spotifyClientId, {
      onState: (s) => {
        if (this.mode !== 'sdk') return;
        this._setPlaying(s.playing);
        if (s.changed && s.title) {
          this.now = { title: s.title, artist: s.artist, source: 'spotify', station: this.station.name };
          bus.emit('radio:track', this.now);
        }
      },
      onError: (kind, message) => {
        this.sdkMessage = kind === 'account' ? 'Full playback needs Spotify Premium.' : message;
        if (kind !== 'playback') this.sdkStatus = 'error';
        bus.emit('radio:premium', {});
      },
    });
    try {
      await this.sdk.connect();
      this.sdkStatus = 'ready';
      this.sdk.setVolume(settings.musicVolume);
      bus.emit('radio:premium', {});
      bus.emit('toast', { text: 'Spotify Premium connected.' });
      if (this.on && this.station.kind === 'spotify') this.tune(this.station.id, { silent: true });
    } catch (err) {
      this.sdkStatus = 'error'; this.sdkMessage = err.message;
      bus.emit('radio:premium', {});
    }
  }

  disconnectPremium() {
    this.sdk?.disconnect();
    this.sdk = null;
    signOut();
    this.sdkStatus = 'off'; this.sdkMessage = '';
    bus.emit('radio:premium', {});
    if (this.on && this.mode === 'sdk') this.tune(this.station.id, { silent: true });
  }
}
