// Headless check that the course can be finished: a simple bot runs it with the real physics.
// Usage: node test/bot.mjs [--verbose]
import { buildCourse } from '../js/course.js';
import { Player, PHYS } from '../js/player.js';
import { bus } from '../js/events.js';

const verbose = process.argv.includes('--verbose');
const course = buildCourse();
const player = new Player(course);
const DT = 1 / 120;

// waypoints: [x, d, flags]
const WP = [
  [0, 30], [1.5, 40], [2, 52], [4, 64], [4, 78], [3, 90], [3, 104],
  [7.3, 109.5, { noWallJump: true }], [9, 121, { wall: true }], [3, 131],
  [1.7, 143], [1.5, 149.5, { noWallJump: true }], [0, 157, { wall: true, jumpAt: 0.95 }],
  [6, 170, { wall: true, jumpAt: 1.3 }], [3, 186], [3, 198], [3, 212], [2, 224], [1, 240],
  [1, 254], [1, 269.3], [3.8, 277], [3.8, 284.2], [0.3, 292], [0.3, 299],
  [-3, 308], [-3, 319.4], [2.5, 319.7], [1.5, 323.5], [1.5, 329], [1, 336], [0.5, 350],
  [0, 366], [-1, 380], [-1, 390], [-1, 404], [-1, 432],
];
let wi = 0;

const events = [];
let finished = false, fell = null;
bus.on('*', (type, data) => {
  if (type === 'step') return;
  events.push({ t: player.time, type, ...data });
  if (verbose) console.log(player.time.toFixed(2).padStart(6), ('d=' + (-player.pos.z).toFixed(1)).padEnd(9), type, JSON.stringify(data));
});

function solidAt(x, y0, y1, z, half = 0.2) {
  for (const b of course.solids) {
    if (x + half > b.minX && x - half < b.maxX && z + half > b.minZ && z - half < b.maxZ && y1 > b.minY && y0 < b.maxY) return b;
  }
  return null;
}

const inp = { moveX: 0, moveZ: 1, jumpPressed: false, jumpHeld: false, crouchPressed: false, crouchHeld: false };
let prevJump = false, prevCrouch = false;

for (let i = 0; i < 120 * 150 && !finished && !fell; i++) {
  const p = player.pos, d = -p.z;
  let [tx, td, flags = {}] = WP[wi];
  while (wi < WP.length - 1 && (td - d < 0.6 && Math.abs(tx - p.x) < 1.2 || td - d < -0.5)) {
    wi++; [tx, td, flags = {}] = WP[wi];
  }
  // aim
  const dx = tx - p.x, dz = -(td) - p.z;
  player.yaw = Math.atan2(-dx, -dz);
  const hs = player.speed;
  const hx = hs > 1 ? player.vel.x / hs : -Math.sin(player.yaw);
  const hz = hs > 1 ? player.vel.z / hs : -Math.cos(player.yaw);

  let jump = false, crouch = false;
  if (player.grounded && player.state !== 'mantle') {
    const ax = p.x + hx * 0.5, az = p.z + hz * 0.5;
    if (!solidAt(ax, p.y - 0.7, p.y + 0.05, az, 0.05)) jump = true;                       // edge
    if (!flags.noWallJump && !flags.wall) {
      const wall = solidAt(p.x + hx * 1.1, p.y + 0.5, p.y + 0.8, p.z + hz * 1.1, 0.2);
      if (wall && wall.maxY - p.y > PHYS.VAULT_MAX) jump = true;                           // too tall to vault
    }
    const fx = p.x + hx * 1.6, fz = p.z + hz * 1.6;
    const head = solidAt(fx, p.y + 1.2, p.y + 1.75, fz), feet = solidAt(fx, p.y + 0.1, p.y + 0.85, fz);
    if (head && !feet) crouch = true;                                                      // slide under
    if (player.state === 'slide' && !player._free(p.x, p.y, p.z, PHYS.H_STAND)) crouch = true;
    if (player.state === 'slide' && solidAt(p.x + hx * 0.8, p.y + 1.2, p.y + 1.75, p.z + hz * 0.8)) crouch = true;
  }
  if (!player.grounded && player.state === 'air') {
    if (player.vel.y < -13) crouch = true;                                                 // roll
    if (!flags.wall && player.vel.y < 4) jump = true;                                      // hold jump for wall kicks
  }
  if (player.state === 'wallrun') {
    const w = player.wall;
    const ahead = solidAt(p.x - w.nx * 0.5 + w.tx * 1.2, p.y + 0.5, p.y + 1.2, p.z - w.nz * 0.5 + w.tz * 1.2, 0.1);
    if (w.t > (flags.jumpAt ?? 1.3) || !ahead) jump = true;
  }
  inp.moveZ = 1;
  inp.jumpHeld = jump; inp.jumpPressed = jump && !prevJump; prevJump = jump;
  inp.crouchHeld = crouch; inp.crouchPressed = crouch && !prevCrouch; prevCrouch = crouch;

  player.update(DT, inp);

  if (player.dead) fell = { why: 'splat', d: -p.z, y: p.y };
  if (p.y < course.killY(p.z)) fell = { why: 'fall', d: -p.z, y: p.y, x: p.x, state: player.state, wp: wi };
  for (const t of course.triggers) {
    if (t.type === 'finish' && p.x > t.minX && p.x < t.maxX && p.y > t.minY && p.y < t.maxY && p.z > t.minZ && p.z < t.maxZ) finished = true;
  }
}

const count = (t) => events.filter((e) => e.type === t).length;
console.log(finished ? `FINISHED in ${player.time.toFixed(2)}s` : `DID NOT FINISH: ${JSON.stringify(fell || { stuck: true, d: -player.pos.z, x: player.pos.x, y: player.pos.y, state: player.state, wp: wi })}`);
console.log(`top speed ${player.stats.topSpeed.toFixed(1)} m/s · best combo ${player.stats.bestCombo} · longest jump ${player.stats.longestJump.toFixed(1)} m`);
console.log(`vaults ${count('vault')} · climbs ${count('climb')} · wall-runs ${count('wallrun:start')} · wall-jumps ${count('walljump')} · slides ${count('slide:start')} · rolls ${events.filter((e) => e.type === 'land' && e.kind === 'roll').length} · hard landings ${events.filter((e) => e.type === 'land' && e.kind === 'hard').length} · springs ${count('spring')}`);
process.exit(finished ? 0 : 1);
