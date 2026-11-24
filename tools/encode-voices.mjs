// Turn the generated WAV clips into small MP3s and write the manifest the game reads.
//   node tools/encode-voices.mjs <wav dir> <output dir, normally "voice"> <lines.json>
// Needs ffmpeg. Clips that are no longer in lines.json are removed.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [wavDir, outDir, linesFile] = process.argv.slice(2);
if (!wavDir || !outDir || !linesFile) { console.error('usage: encode-voices.mjs <wav dir> <out dir> <lines.json>'); process.exit(1); }
const lines = JSON.parse(readFileSync(linesFile, 'utf8'));
const jobs = [];
const manifest = { mack: [], nova: [] };
let missing = 0;

for (const who of Object.keys(manifest)) {
  mkdirSync(join(outDir, who), { recursive: true });
  const wanted = new Set(lines.filter((l) => l.who === who).map((l) => l.id));
  for (const id of wanted) {
    const wav = join(wavDir, who, `${id}.wav`), mp3 = join(outDir, who, `${id}.mp3`);
    if (!existsSync(wav)) { missing++; continue; }
    manifest[who].push(id);
    if (!existsSync(mp3) || statSync(mp3).mtimeMs < statSync(wav).mtimeMs) jobs.push([wav, mp3]);
  }
  for (const f of readdirSync(join(outDir, who))) if (!wanted.has(f.replace(/\.mp3$/, ''))) unlinkSync(join(outDir, who, f));
  manifest[who].sort();
}

const encode = ([wav, mp3]) => new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', mp3]);
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed on ${wav}`))));
});
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await encode(jobs[next++]); }));
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
console.log(`encoded ${jobs.length} clips; manifest lists ${manifest.mack.length} for Mack and ${manifest.nova.length} for Nova${missing ? `; ${missing} not generated yet` : ''}`);
