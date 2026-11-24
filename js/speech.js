// Shared, dependency-free helpers for spoken lines. Used by the game and by the
// script that generates the recorded voice clips, so both agree on clip names.

// text → something a speech engine reads well
export function speakable(text) {
  return text
    .replace(/\|/g, ' ')
    .replace(/\bFM\b/g, 'F M')
    .replace(/98\.6/g, 'ninety-eight point six')
    .replace(/\blofi\b/gi, 'lo-fi')
    .replace(/\bRapCaviar\b/g, 'Rap Caviar')
    .replace(/\b80s\b/g, 'eighties')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

// the form a clip is filed under: case and punctuation don't matter
export function normalize(text) {
  return speakable(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// 32-bit FNV-1a, as 8 hex characters
export function clipId(who, text) {
  const s = `${who}|${normalize(text)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// A line can be made of several recorded pieces, separated by "|":
//   "And that is the finish! | 1 minute | 12.3 seconds | on the clock."
export function segments(text) {
  return text.split('|').map((s) => s.trim()).filter((s) => /[a-z0-9]/i.test(s));
}

// what goes in the subtitle
export function displayText(text) {
  return text.split('|').map((s) => s.trim()).filter(Boolean).join(' ').replace(/\s+([.,!?;:])/g, '$1');
}

// Times are spoken to the tenth below 20 seconds and to the second above,
// which keeps the set of recorded number clips small.
function secondsPhrase(s) {
  if (s < 19.95) return `${s.toFixed(1)} seconds`;
  return `${Math.min(59, Math.floor(s))} seconds`;
}
export function spokenTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (m === 0) return secondsPhrase(s);
  return `${m} minute${m === 1 ? '' : 's'} | ${secondsPhrase(s)}`;
}
export function spokenDelta(sec) {
  const a = Math.abs(sec);
  return a >= 60 ? 'over a minute' : secondsPhrase(a);
}

// every time phrase that can be spoken (for the clip generator)
export function timePhrases() {
  const out = [];
  for (let t = 0; t < 200; t++) out.push(`${(t / 10).toFixed(1)} seconds`);
  for (let s = 20; s <= 59; s++) out.push(`${s} seconds`);
  for (let m = 1; m <= 9; m++) out.push(`${m} minute${m === 1 ? '' : 's'}`);
  out.push('over a minute');
  return out;
}

// capitalise the start of each sentence (a filled-in name may land there)
export function fixCaps(text) {
  return text.replace(/(^\s*|[.!?]\s+(?:\|\s*)?)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}
