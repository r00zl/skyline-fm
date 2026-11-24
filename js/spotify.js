// Two ways to play Spotify:
//  1. SpotifyEmbed: Spotify's own embedded player (iFrame API). No developer app or key needed.
//     Signed-in listeners get full tracks; otherwise Spotify plays previews.
//  2. SpotifySdk: the Web Playback SDK. Needs Spotify Premium and a client ID from the
//     Spotify developer dashboard. Gives track names, artists, skip, and volume ducking.
//     NOTE: this path could not be tested without a client ID. See README.
import { store } from './settings.js';

export function parseSpotifyLink(text) {
  if (!text) return null;
  const s = text.trim();
  let m = s.match(/^spotify:(playlist|album|track|artist|show|episode):([A-Za-z0-9]{10,})$/);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]{10,})/i);
  if (m) return `spotify:${m[1].toLowerCase()}:${m[2]}`;
  return null;
}
export const uriToUrl = (uri) => {
  const [, type, id] = uri.split(':');
  return `https://open.spotify.com/${type}/${id}`;
};

// Look up a title for any Spotify URI without logging in.
const titleCache = new Map();
export async function lookupTitle(uri) {
  if (!uri) return null;
  if (titleCache.has(uri)) return titleCache.get(uri);
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(uriToUrl(uri))}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const title = data.title || null;
    titleCache.set(uri, title);
    return title;
  } catch {
    titleCache.set(uri, null);
    return null;
  }
}

// ─────────────────────────── embedded player ───────────────────────────
let apiPromise = null;
function loadIframeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Spotify did not load')), 12000);
    window.onSpotifyIframeApiReady = (api) => { clearTimeout(timeout); resolve(api); };
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => { clearTimeout(timeout); reject(new Error('Spotify did not load')); };
    document.head.appendChild(s);
  });
  apiPromise.catch(() => { apiPromise = null; });
  return apiPromise;
}

export class SpotifyEmbed {
  constructor(mount, { onUpdate, onTrack } = {}) {
    this.mount = mount;
    this.onUpdate = onUpdate || (() => {});
    this.onTrack = onTrack || (() => {});
    this.controller = null;
    this.uri = null;
    this.playingUri = null;
    this.paused = true;
    this.started = false;
    this.wantPlay = false;
  }

  async load(uri) {
    this.uri = uri;
    this.started = false;
    this.wantPlay = true;
    this.playingUri = null;
    const api = await loadIframeApi();
    if (this.uri !== uri) return;
    if (!this.controller) {
      const slot = document.createElement('div');
      this.mount.innerHTML = '';
      this.mount.appendChild(slot);
      await new Promise((resolve) => {
        api.createController(slot, { uri, width: '100%', height: 152 }, (c) => {
          this.controller = c;
          c.addListener('ready', () => { if (this.wantPlay) this._tryPlay(); });
          c.addListener('playback_started', (e) => this._seen(e?.data?.playingURI));
          c.addListener('playback_update', (e) => {
            const d = e?.data || {};
            const wasPaused = this.paused;
            this.paused = !!d.isPaused;
            if (!d.isPaused && d.position > 0) this.started = true;
            if (d.playingURI) this._seen(d.playingURI);
            if (wasPaused !== this.paused || d.position === 0) this.onUpdate({ playing: !this.paused, position: d.position, duration: d.duration });
          });
          resolve();
        });
      });
      this._tryPlay();
    } else {
      this.controller.loadUri(uri);
      this._tryPlay();
      setTimeout(() => { if (this.uri === uri && !this.started && this.wantPlay) this._tryPlay(); }, 900);
    }
  }
  _tryPlay() { try { this.controller?.play(); } catch { /* embed not ready yet */ } }
  _seen(uri) {
    if (!uri || uri === this.playingUri) return;
    this.playingUri = uri;
    this.started = true;
    this.onTrack(uri);
  }
  toggle() {
    if (!this.controller) return;
    this.wantPlay = this.paused;
    this.controller.togglePlay();
  }
  pause() { this.wantPlay = false; try { this.controller?.pause(); } catch { /* ignore */ } }
  resume() { this.wantPlay = true; try { this.controller?.resume(); } catch { /* ignore */ } }
}

// ─────────────────────────── Premium: login + Web Playback SDK ───────────────────────────
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
const TOKENS = 'skyline-fm:spotify';
const VERIFIER = 'skyline-fm:pkce';

// The address Spotify sends you back to. It has to be added, exactly, to the app's
// "Redirect URIs" in the Spotify developer dashboard.
export const redirectUri = () => location.origin + location.pathname;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function beginLogin(clientId) {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = b64url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  store.set(VERIFIER, verifier);
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: b64url(digest),
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

function saveTokens(json, previous) {
  const tokens = {
    access: json.access_token,
    refresh: json.refresh_token || previous?.refresh || null,
    expires: Date.now() + (json.expires_in || 3600) * 1000 - 60000,
  };
  store.set(TOKENS, JSON.stringify(tokens));
  return tokens;
}
function readTokens() {
  try { return JSON.parse(store.get(TOKENS) || 'null'); } catch { return null; }
}
export function signOut() { store.del(TOKENS); store.del(VERIFIER); }
export const hasSession = () => !!readTokens();

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Spotify sign-in failed (${res.status})`);
  return json;
}

// Call on page load: finishes sign-in if Spotify just sent us back with a code.
export async function completeLogin(clientId) {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return { status: hasSession() ? 'session' : 'none' };
  history.replaceState({}, '', redirectUri());
  if (error) return { status: 'error', message: error === 'access_denied' ? 'Spotify sign-in was cancelled.' : error };
  const verifier = store.get(VERIFIER);
  if (!clientId || !verifier) return { status: 'error', message: 'Sign-in could not be completed. Try connecting again.' };
  try {
    const json = await tokenRequest({
      client_id: clientId, grant_type: 'authorization_code', code,
      redirect_uri: redirectUri(), code_verifier: verifier,
    });
    saveTokens(json);
    store.del(VERIFIER);
    return { status: 'connected' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function getAccessToken(clientId) {
  let t = readTokens();
  if (!t) return null;
  if (Date.now() < t.expires) return t.access;
  if (!t.refresh) { signOut(); return null; }
  try {
    const json = await tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: t.refresh });
    t = saveTokens(json, t);
    return t.access;
  } catch {
    signOut();
    return null;
  }
}

let sdkPromise = null;
function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The Spotify player did not load.')), 12000);
    window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timeout); resolve(window.Spotify); };
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => { clearTimeout(timeout); reject(new Error('The Spotify player did not load.')); };
    document.head.appendChild(s);
  });
  sdkPromise.catch(() => { sdkPromise = null; });
  return sdkPromise;
}

export class SpotifySdk {
  constructor(clientId, { onState, onError } = {}) {
    this.clientId = clientId;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.player = null;
    this.deviceId = null;
    this.ready = false;
    this.volume = 0.7;
    this.trackId = null;
    this.paused = true;
  }

  async connect() {
    const token = await getAccessToken(this.clientId);
    if (!token) throw new Error('Not signed in to Spotify.');
    const Spotify = await loadSdk();
    this.player = new Spotify.Player({
      name: 'Skyline FM (in-game radio)',
      getOAuthToken: (cb) => { getAccessToken(this.clientId).then((t) => t && cb(t)); },
      volume: this.volume,
    });
    const p = this.player;
    const fail = (kind) => ({ message }) => this.onError(kind, message);
    p.addListener('initialization_error', fail('init'));
    p.addListener('authentication_error', fail('auth'));
    p.addListener('account_error', fail('account'));     // not Premium
    p.addListener('playback_error', fail('playback'));
    p.addListener('not_ready', () => { this.ready = false; });
    p.addListener('player_state_changed', (state) => {
      if (!state) return;
      const tr = state.track_window?.current_track;
      this.paused = state.paused;
      const changed = tr && tr.id !== this.trackId;
      if (tr) this.trackId = tr.id;
      this.onState({
        playing: !state.paused,
        changed,
        title: tr?.name || null,
        artist: tr?.artists?.map((a) => a.name).join(', ') || null,
        duration: state.duration, position: state.position,
      });
    });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Spotify did not answer. Development-mode apps sometimes fail to connect; see the README.')), 15000);
      p.addListener('ready', ({ device_id }) => {
        clearTimeout(timeout);
        this.deviceId = device_id; this.ready = true;
        resolve();
      });
    });
    const ok = await Promise.race([p.connect(), new Promise((r) => setTimeout(() => r('slow'), 15000))]);
    if (ok === false) throw new Error('Spotify refused the connection.');
    await ready;
  }

  async _api(method, path, body) {
    const token = await getAccessToken(this.clientId);
    if (!token) throw new Error('Spotify session expired.');
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error?.message || `Spotify error ${res.status}`);
    }
  }

  async play(uri) {
    if (!this.ready) throw new Error('Spotify player is not ready.');
    try { this.player.activateElement?.(); } catch { /* needs a tap on some phones */ }
    const single = /^spotify:(track|episode):/.test(uri);
    const q = `?device_id=${encodeURIComponent(this.deviceId)}`;
    if (!single) await this._api('PUT', `/me/player/shuffle${q}&state=true`).catch(() => {});
    await this._api('PUT', `/me/player/play${q}`, single ? { uris: [uri] } : { context_uri: uri });
  }
  toggle() { return this.player?.togglePlay(); }
  pause() { return this.player?.pause(); }
  next() { return this.player?.nextTrack(); }
  prev() { return this.player?.previousTrack(); }
  setVolume(v) { this.volume = v; return this.player?.setVolume(Math.max(0, Math.min(1, v))); }
  disconnect() { try { this.player?.disconnect(); } catch { /* ignore */ } this.ready = false; }
}
