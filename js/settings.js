// Saved preferences and best times. Storage can be missing or blocked, so every access is guarded.
const KEY = 'skyline-fm:v1';

const defaults = {
  name: 'Runner',
  sensitivity: 1,
  invertY: false,
  quality: 'auto',          // auto | high | low
  fov: 82,
  djOn: true,
  commentaryOn: true,
  subtitles: true,
  voiceVolume: 1,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  djVoice: '',
  mackVoice: '',
  station: 'house',
  customUri: '',
  customLabel: '',
  spotifyClientId: '',
  best: null,               // { time, splits: [], falls, date }
  runs: 0,
  hintsDone: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...defaults };
}

export const settings = load();

let timer = null;
export function saveSettings() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, 150);
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

export const isTouch = () =>
  (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ||
  (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
