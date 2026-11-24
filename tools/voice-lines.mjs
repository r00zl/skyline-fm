// Lists every piece of speech the recorded voices need, as JSON:
//   node tools/voice-lines.mjs > lines.json
// Each entry is { id, who, text, say }. "id" is the clip's file name, "say" is the text
// handed to the speech model. tools/make-voices.py turns the list into audio.
import { MACK, NOVA, DOMAINS, TIME_VARS } from '../js/lines.js';
import { CATALOGUE } from '../js/catalogue.js';
import { clipId, normalize, speakable, timePhrases, fixCaps } from '../js/speech.js';

const flatten = (bank) => Object.values(bank).flatMap((v) => (Array.isArray(v) ? v : flatten(v)));
const out = new Map();
const problems = [];
let usesTime = { mack: false, nova: false };

function add(who, text) {
  const id = clipId(who, text);
  const prev = out.get(id);
  if (prev && normalize(prev.text) !== normalize(text)) problems.push(`id clash: "${prev.text}" / "${text}"`);
  if (!prev) out.set(id, { id, who, text, say: speakable(text) });
}

function expand(who, template) {
  for (const seg of template.split('|').map((s) => s.trim()).filter((s) => /[a-z0-9{]/i.test(s))) {
    const vars = [...new Set([...seg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    const timeVar = vars.find((v) => TIME_VARS.includes(v));
    if (timeVar) {
      if (seg.replace(/[^a-z{}]/gi, '') !== `{${timeVar}}`) problems.push(`time must stand alone between "|": "${template}"`);
      usesTime[who] = true;
      continue;
    }
    // {track} and {artist} travel together
    const paired = vars.includes('track') || vars.includes('artist');
    const free = vars.filter((v) => v !== 'track' && v !== 'artist');
    for (const v of free) if (!DOMAINS[v]) problems.push(`no values listed for {${v}}: "${template}"`);
    let combos = [{}];
    for (const v of free) combos = combos.flatMap((c) => (DOMAINS[v] || []).map((val) => ({ ...c, [v]: val })));
    if (paired) combos = combos.flatMap((c) => CATALOGUE.map((t) => ({ ...c, track: t.title, artist: t.artist })));
    for (const c of combos) add(who, fixCaps(seg.replace(/\{(\w+)\}/g, (_, k) => c[k])));
  }
}

for (const t of flatten(MACK)) expand('mack', t);
for (const t of flatten(NOVA)) expand('nova', t);
for (const who of ['mack', 'nova']) if (usesTime[who]) for (const p of timePhrases()) add(who, p);

const list = [...out.values()];
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const chars = (who) => list.filter((l) => l.who === who).reduce((n, l) => n + l.say.length, 0);
console.error(`mack: ${list.filter((l) => l.who === 'mack').length} clips, ~${(chars('mack') / 15 / 60).toFixed(1)} min`);
console.error(`nova: ${list.filter((l) => l.who === 'nova').length} clips, ~${(chars('nova') / 15 / 60).toFixed(1)} min`);
console.log(JSON.stringify(list));
