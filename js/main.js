// Skyline FM — boot, game state, and the frame loop.
import * as THREE from 'three';
import { bus } from './events.js';
import { settings, saveSettings, isTouch } from './settings.js';
import { buildCourse } from './course.js';
import { Player, PHYS } from './player.js';
import { World } from './world.js';
import { Input } from './input.js';
import { Hud, fmtTime, fmtDelta } from './hud.js';
import { GameAudio } from './audio.js';
import { Radio } from './radio.js';
import { Broadcast } from './dj.js';
import { Phone } from './phone.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 1 / 120;

const touch = isTouch();
document.body.classList.toggle('touch', touch);
const params = new URLSearchParams(location.search);
const quality = settings.quality === 'auto' ? (touch ? 'low' : 'high') : settings.quality;

// ───────────── renderer ─────────────
const canvas = $('view');
let renderer;
try {
  // ?nogl=1 runs everything except drawing: for testing the radio and commentary on machines without WebGL
  renderer = params.has('nogl')
    ? { shadowMap: {}, setPixelRatio() {}, setSize() {}, render() {} }
    : new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.querySelector('.tagline').textContent = "This browser couldn't start WebGL, which the game needs. Try another browser or turn on hardware acceleration.";
  $('start').disabled = true;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5));
renderer.shadowMap.enabled = quality === 'high';
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 3000);
camera.rotation.order = 'YXZ';

const course = buildCourse();
const world = new World(scene, course, { shadows: quality === 'high', mobile: touch });
const player = new Player(course);
const input = new Input(canvas);
const hud = new Hud(touch);
const audio = new GameAudio();
const radio = new Radio(audio, $('embed-mount'));

const game = {
  state: 'title',          // title | playing | paused | finished
  time: 0,
  running: false,          // clock started
  falls: 0,
  cp: 0,
  fallsHere: 0,
  splits: [],
  inside: new Set(),
  fired: new Set(),
  falling: false,
  idleT: 0,
  backT: 0,
  maxD: 0,
  practice: false,
};
const info = () => ({
  time: game.time, falls: game.falls, running: game.running && game.state !== 'finished',
  bestCombo: player.stats.bestCombo, topSpeed: player.stats.topSpeed,
  progress: clamp(game.maxD / course.finish.d, 0, 1),
  checkpoints: course.checkpoints, splits: game.splits,
});
const broadcast = new Broadcast(radio, audio, info);
const phone = new Phone(radio, broadcast.voice, info);

// ───────────── sizing ─────────────
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ───────────── run control ─────────────
function spawnAt(index) {
  const cp = course.checkpoints[index];
  return { x: cp.x, y: cp.y, z: cp.z, yaw: 0 };
}

function resetRun(startCp = 0) {
  game.time = 0; game.running = false; game.falls = 0; game.cp = startCp; game.fallsHere = 0;
  game.splits = []; game.inside.clear(); game.fired.clear(); game.falling = false;
  game.idleT = 0; game.backT = 0; game.maxD = course.checkpoints[startCp].d;
  game.practice = startCp > 0;
  player.reset(startCp === 0 ? course.spawn : spawnAt(startCp), true);
  $('finish').classList.add('hidden');
  hud.clearHint();
}

function beginPlay() {
  game.state = 'playing';
  input.setEnabled(true);
  input.requestLock();
  if (!touch) setTimeout(() => {
    if (game.state === 'playing' && !input.locked) hud.toast('Click the view to look around with the mouse.', 3500);
  }, 600);
}

function start() {
  if (game.state !== 'title') return;
  const name = $('title-name').value.trim();
  settings.name = name || settings.name || 'Runner';
  $('set-name').value = settings.name;
  saveSettings();

  audio.init();
  broadcast.voice.unlock();
  radio.powerOn();

  $('title').classList.add('hidden');
  hud.show(true);
  if (touch) {
    $('touch').classList.remove('hidden');
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' });
      p?.then?.(() => screen.orientation?.lock?.('landscape')?.catch?.(() => {}))?.catch?.(() => {});
    } catch { /* fullscreen is optional */ }
  }
  resetRun(clamp(parseInt(params.get('cp') || '0', 10) || 0, 0, course.checkpoints.length - 1));
  beginPlay();
  bus.emit('game:welcome', {});
}

function restart() {
  if (game.state === 'title') return;
  phone.close();
  resetRun(0);
  hud.flash();
  beginPlay();
  bus.emit('run:restart', {});
  bus.emit('respawn', {});
}

function respawn() {
  if (game.state === 'title' || game.state === 'finished') return;
  hud.flash();
  player.reset(game.cp === 0 ? course.spawn : spawnAt(game.cp), false);
  game.falling = false;
  bus.emit('respawn', {});
}

function fall(splat = false) {
  if (game.falling) return;
  game.falling = true;
  game.falls++; game.fallsHere++;
  bus.emit('fall', { total: game.falls, here: game.fallsHere, splat, cp: game.cp });
  $('fade').classList.add('on');
  setTimeout(() => {
    respawn();
    $('fade').classList.remove('on');
  }, splat ? 500 : 380);
}

function finish() {
  game.state = 'finished';
  input.setEnabled(false);
  input.releaseLock();
  const time = game.time;
  const prev = settings.best;
  const first = !prev;
  const pb = !game.practice && (!prev || time < prev.time);
  const delta = prev ? time - prev.time : null;
  if (!game.practice) {
    settings.runs = (settings.runs || 0) + 1;
    settings.hintsDone = true;
    if (pb) settings.best = { time, splits: [...game.splits], falls: game.falls, date: Date.now() };
    saveSettings();
  }
  bus.emit('finish', { time, pb, first: first && !game.practice, delta, falls: game.falls, bestCombo: player.stats.bestCombo, topSpeed: player.stats.topSpeed });

  $('fin-eyebrow').textContent = game.practice ? 'Practice run' : pb && !first ? 'New personal best' : 'Run complete';
  $('fin-time').textContent = fmtTime(time);
  const d = $('fin-delta');
  d.className = '';
  if (game.practice) d.textContent = 'Started from a checkpoint, so this one is not on the board.';
  else if (first) d.textContent = 'First time on the board. Now beat it.';
  else if (pb) { d.textContent = `${fmtDelta(delta)} s on your previous best`; d.className = 'pb'; }
  else d.textContent = `${fmtDelta(delta)} s off your best of ${fmtTime(prev.time)}`;
  $('fin-falls').textContent = game.falls;
  $('fin-combo').textContent = `×${player.stats.bestCombo}`;
  $('fin-speed').textContent = `${Math.round(player.stats.topSpeed * 3.6)} km/h`;
  setTimeout(() => { if (game.state === 'finished') $('finish').classList.remove('hidden'); }, 1400);
}

// ───────────── triggers ─────────────
function checkTriggers() {
  const p = player.pos, y = p.y + 0.9;
  for (const t of course.triggers) {
    const inside = p.x > t.minX && p.x < t.maxX && y > t.minY && y < t.maxY && p.z > t.minZ && p.z < t.maxZ;
    if (!inside) { game.inside.delete(t); continue; }
    if (game.inside.has(t)) continue;
    game.inside.add(t);
    if (t.once) { if (game.fired.has(t)) continue; game.fired.add(t); }
    if (t.type === 'hint') bus.emit('hint', { id: t.id });
    else if (t.type === 'zone') bus.emit('zone', { id: t.id });
    else if (t.type === 'checkpoint') {
      if (t.id <= game.cp) continue;
      game.cp = t.id; game.fallsHere = 0;
      const split = game.time;
      game.splits[t.id - 1] = split;
      const best = game.practice ? null : settings.best?.splits?.[t.id - 1];
      bus.emit('checkpoint', { index: t.id, name: course.checkpoints[t.id].name, split, delta: best != null ? split - best : null });
    } else if (t.type === 'finish') finish();
  }
}

function tick(dt) {
  const p = player.pos;
  const d = -p.z;
  if (!game.running) {
    const s = game.cp === 0 ? course.spawn : course.checkpoints[game.cp];
    if (Math.hypot(p.x - s.x, p.z - s.z) > 0.6) { game.running = true; bus.emit('run:start', {}); }
  } else {
    game.time += dt;
  }
  if (d > game.maxD) game.maxD = d;

  if (!game.falling) {
    if (player.dead) fall(true);
    else if (p.y < course.killY(p.z)) fall(false);
  }
  checkTriggers();

  if (game.running) {
    // standing around
    if (player.speed < 0.5 && player.grounded) {
      game.idleT += dt;
      if (game.idleT > 9) { game.idleT = -16; bus.emit('idle', {}); }
    } else if (game.idleT > 0) game.idleT = 0;
    // heading back toward the start
    if (d < game.maxD - 16 && player.vel.z > 3) {
      game.backT += dt;
      if (game.backT > 2) { game.backT = -20; bus.emit('backwards', {}); }
    } else if (game.backT > 0) game.backT = 0;
    const kmh = Math.round(player.speed * 3.6);
    if (kmh >= 45) bus.emit('speed', { kmh });
  }
}

// ───────────── UI wiring ─────────────
$('start').addEventListener('click', start);
$('title-name').value = settings.name === 'Runner' ? '' : settings.name;
$('title-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('fin-again').addEventListener('click', restart);
$('fin-phone').addEventListener('click', () => phone.open('runs'));
$('btn-phone').addEventListener('click', () => phone.toggle());
$('chip').addEventListener('click', () => phone.open('radio'));
$('btn-respawn').addEventListener('click', () => respawn());

bus.on('ui:phone', () => { if (game.state !== 'title') phone.toggle(); });
bus.on('ui:respawn', () => { if (game.state === 'playing' || game.state === 'paused') respawn(); });
bus.on('ui:restart', restart);
bus.on('ui:station', (e) => { if (radio.on) radio.step(e.dir); });
bus.on('ui:next', () => { if (radio.on) radio.next(); });
bus.on('ui:playpause', () => { if (radio.on) radio.togglePlay(); });
bus.on('ui:confirm', () => {
  if (game.state === 'title') start();
  else if (game.state === 'finished') restart();
});

bus.on('phone:open', () => {
  if (game.state === 'playing') {
    game.state = 'paused';
    input.setEnabled(false);
    input.releaseLock();
  }
});
bus.on('phone:close', () => {
  if (game.state === 'paused') beginPlay();
});
bus.on('input:lock', (e) => {
  // Esc drops the mouse: treat it as "pull out the phone"
  if (!e.locked && game.state === 'playing' && !touch) phone.open();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') phone.open();
});

// ───────────── frame loop ─────────────
let last = performance.now();
let acc = 0;
let fov = settings.fov;
const eye = { x: 0, y: 0, z: 0 };
let clock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  input.poll(dt);

  if (game.state === 'playing') {
    const look = input.takeLook();
    player.yaw -= look.x;
    player.pitch = clamp(player.pitch - look.y, -1.45, 1.45);
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) {
      player.update(STEP, input.state);
      tick(STEP);
      acc -= STEP; n++;
      if (game.state !== 'playing') break;
    }
    if (n === 8) acc = 0;
    broadcast.update(dt);
  } else if (game.state === 'finished') {
    // coast to a stop on the helipad
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) { player.update(STEP, input.state); acc -= STEP; n++; }
    player.yaw += dt * 0.25;
  }

  if (game.state === 'title') {
    const t = clock * 0.12;
    camera.position.set(-15 + Math.sin(t) * 5, 8.5 + Math.sin(t * 0.7) * 1.2, 16 + Math.cos(t) * 4);
    camera.rotation.set(-0.16, -0.32 + Math.sin(t * 0.8) * 0.05, 0);
    world.update(camera.position, clock);
  } else {
    player.eyePos(eye);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(player.pitch + player.pitchKick, player.yaw, player.roll);
    const aspect = camera.aspect;
    const base = aspect < 1 ? Math.min(100, settings.fov + (1 - aspect) * 34) : settings.fov;
    const target = base + clamp((player.speed - 6) / 8, 0, 1) * 13 + (player.state === 'wallrun' ? 3 : 0);
    fov += (target - fov) * Math.min(1, dt * 6);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    world.update(player.pos, clock);
    hud.update(game, player);
    if (audio.ready) audio.setWind(game.state === 'playing' ? player.speed : 0, !player.grounded);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// finish Spotify sign-in if we were just sent back from it
radio.initPremium().catch(() => {});

// handy for testing from the console
window.__skyline = { game, player, course, radio, broadcast, bus, input, start, restart, respawn, PHYS };
