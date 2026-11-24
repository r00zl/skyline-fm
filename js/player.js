// First-person parkour controller. Pure logic: no rendering, no DOM.
// The world is a list of axis-aligned boxes; the runner is an axis-aligned box too.
import { bus } from './events.js';

export const PHYS = {
  G: 26,            // gravity, m/s²
  JUMP: 8.2,        // jump take-off speed
  RUN: 8.6,         // base top speed
  FLOW_BONUS: 3.2,  // extra top speed at full flow
  HALF: 0.35,       // half body width
  H_STAND: 1.8,
  H_LOW: 0.9,
  EYE: 1.62,
  EYE_LOW: 0.68,
  STEP: 0.45,       // walk straight up anything this low
  VAULT_MAX: 1.3,   // auto-vault from the ground up to this height
  REACH: 1.78,      // grab a ledge this far above your feet when airborne
  WR_MAX: 1.55,     // seconds of wall-run
  HARD_LAND: 16.5,  // landing faster than this hurts unless you roll
  SPLAT: 31,        // landing faster than this ends the attempt
};

const EPS = 0.001;
const MOVE_GAIN = {
  gap: 0.12, vault: 0.14, climb: 0.08, wallrun: 0.2, walljump: 0.2,
  slide: 0.12, roll: 0.16, spring: 0.1, wallkick: 0.08,
};
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export class Player {
  constructor(course) {
    this.course = course;
    this.solids = course.solids;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.inp = null;
    this.reset(course.spawn, true);
  }

  reset(sp, fullReset = false) {
    this.pos.x = sp.x; this.pos.y = sp.y + EPS; this.pos.z = sp.z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = sp.yaw ?? 0;
    this.pitch = 0;
    this.grounded = true;
    this.state = 'run';        // run | air | slide | wallrun | mantle
    this.h = PHYS.H_STAND;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.crouchBuffer = 0;
    this.wall = null;
    this.wallCooldownBox = null;
    this.wallCooldown = 0;
    this.kickUsed = false;
    this.mantle = null;
    this.slideT = 0;
    this.slideReal = false;
    this.slidUnder = false;
    this.airT = 0;
    this.airStart = null;
    this.stun = 0;
    this.dead = false;
    this.frozen = false;
    this.time = this.time || 0;
    this.flow = 0;
    this.combo = 0;
    this.comboT = 0;
    // camera feel
    this.eye = PHYS.EYE;
    this.roll = 0;
    this.dip = 0;
    this.dipV = 0;
    this.bobPhase = 0;
    this.bobY = 0;
    this.bobX = 0;
    this.pitchKick = 0;
    this.stepLift = 0;
    if (fullReset) {
      this.stats = { topSpeed: 0, bestCombo: 0, moves: {}, longestJump: 0, longestWallrun: 0 };
    }
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get maxSpeed() { return PHYS.RUN + PHYS.FLOW_BONUS * this.flow; }

  // ───────────── collision helpers ─────────────
  _overlap(x, y, z, h, b) {
    return x + PHYS.HALF > b.minX + EPS && x - PHYS.HALF < b.maxX - EPS &&
           y + h > b.minY + EPS && y < b.maxY - EPS &&
           z + PHYS.HALF > b.minZ + EPS && z - PHYS.HALF < b.maxZ - EPS;
  }
  _hits(x, y, z, h) {
    const s = this.solids;
    for (let i = 0; i < s.length; i++) if (this._overlap(x, y, z, h, s[i])) return s[i];
    return null;
  }
  _free(x, y, z, h) { return !this._hits(x, y, z, h); }

  // is there a runnable wall right beside us on the side its normal (nx,nz) points away from?
  _touching(nx, nz, reach = 0.2) {
    const p = this.pos;
    const x = p.x - nx * reach, z = p.z - nz * reach;
    const s = this.solids;
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (b.noWallrun) continue;
      if (b.maxY < p.y + 1.0 || b.minY > p.y + 0.9) continue;
      if (this._overlap(x, p.y + 0.35, z, 1.0, b)) return b;
    }
    return null;
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return null;
    const p = this.pos, s = this.solids;
    p[axis] += delta;
    let hit = null;
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (!this._overlap(p.x, p.y, p.z, this.h, b)) continue;
      const rise = b.maxY - p.y;
      const stepMax = this.grounded ? PHYS.STEP : 0.3;
      if (rise > 0 && rise <= stepMax && this.state !== 'wallrun' &&
          this._free(p.x, b.maxY + EPS * 2, p.z, this.h)) {
        this.stepLift += rise;
        p.y = b.maxY + EPS * 2;
        if (this.vel.y > 0 && !this.grounded) this.vel.y = 0;
        continue;
      }
      if (axis === 'x') p.x = delta > 0 ? b.minX - PHYS.HALF - EPS : b.maxX + PHYS.HALF + EPS;
      else p.z = delta > 0 ? b.minZ - PHYS.HALF - EPS : b.maxZ + PHYS.HALF + EPS;
      hit = { box: b, nx: axis === 'x' ? -Math.sign(delta) : 0, nz: axis === 'z' ? -Math.sign(delta) : 0 };
    }
    return hit;
  }

  // ───────────── scoring ─────────────
  addMove(kind, value = 0) {
    this.flow = Math.min(1, this.flow + (MOVE_GAIN[kind] ?? 0.1));
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 3.4;
    this.stats.moves[kind] = (this.stats.moves[kind] || 0) + 1;
    if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;
    bus.emit('move', { kind, combo: this.combo, flow: this.flow, value });
  }
  breakCombo(reason) {
    if (this.combo >= 3) bus.emit('combo:break', { combo: this.combo, reason });
    this.combo = 0;
    this.comboT = 0;
    this.flow *= 0.35;
  }

  // ───────────── main step (fixed dt) ─────────────
  update(dt, inp) {
    if (this.frozen || this.dead) return;
    this.inp = inp;
    this.time += dt;

    if (inp.jumpPressed) { this.jumpBuffer = 0.15; inp.jumpPressed = false; }
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (inp.crouchPressed) { this.crouchBuffer = 0.32; inp.crouchPressed = false; }
    else this.crouchBuffer = Math.max(0, this.crouchBuffer - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.stun = Math.max(0, this.stun - dt);

    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        if (this.combo >= 3) bus.emit('combo:end', { combo: this.combo });
        this.combo = 0;
      }
    }
    const hs0 = this.speed;
    this.flow = Math.max(0, this.flow - (hs0 < 4 ? 0.45 : 0.04) * dt);
    if (hs0 > this.stats.topSpeed) this.stats.topSpeed = hs0;

    // which way the player wants to go, in world space
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * inp.moveZ + cos * inp.moveX;
    let wz = -cos * inp.moveZ - sin * inp.moveX;
    let wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
    const wish = { x: wx, z: wz, len: wl };

    if (this.state === 'mantle') this._stepMantle(dt);
    else if (this.state === 'wallrun') this._stepWallrun(dt, inp, wish);
    else this._stepNormal(dt, inp, wish);

    this._camera(dt, inp);
  }

  _startSlide() {
    const hs = this.speed;
    this.state = 'slide';
    this.h = PHYS.H_LOW;
    this.slideT = 0;
    this.slidUnder = false;
    this.slideReal = hs > 5.5;
    this.crouchBuffer = 0;
    if (this.slideReal) {
      const sp = Math.min(hs + 2.2, PHYS.RUN + PHYS.FLOW_BONUS + 2);
      this.vel.x *= sp / hs; this.vel.z *= sp / hs;
      bus.emit('slide:start', { speed: sp });
    }
  }
  _endSlide() {
    if (this.state !== 'slide') return;
    this.state = this.grounded ? 'run' : 'air';
    this.h = PHYS.H_STAND;
    if (this.slideReal) {
      bus.emit('slide:end', { dur: this.slideT, under: this.slidUnder });
      if (this.slideT > 0.3) this.addMove('slide', this.slidUnder ? 1 : 0);
    }
    this.slideReal = false;
  }

  _stepNormal(dt, inp, wish) {
    const p = this.pos, v = this.vel;
    let hs = this.speed;

    if (this.grounded) {
      v.y = -2;
      if (this.state === 'slide') {
        this.slideT += dt;
        const canStand = this._free(p.x, p.y, p.z, PHYS.H_STAND);
        if (!canStand) this.slidUnder = true;
        let sp = hs - 5 * dt;
        if ((inp.crouchHeld || !canStand) && (wish.len > 0.1 || !canStand)) sp = Math.max(sp, 4);
        sp = Math.max(0, sp);
        let dx = hs > 0.01 ? v.x / hs : wish.x, dz = hs > 0.01 ? v.z / hs : wish.z;
        if (wish.len > 0.1) {
          dx += wish.x * 2.2 * dt; dz += wish.z * 2.2 * dt;
          const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        }
        v.x = dx * sp; v.z = dz * sp;
        const wantsUp = !inp.crouchHeld && this.slideT > 0.3;
        if (canStand && (wantsUp || sp < 1)) this._endSlide();
      } else if ((this.crouchBuffer > 0 || inp.crouchHeld) && hs > 1.5 && wish.len > 0.1) {
        this._startSlide();
      } else {
        // run
        const max = this.maxSpeed * (inp.moveZ < -0.1 ? 0.6 : 1);
        const tx = wish.x * max, tz = wish.z * max;
        let rate = wish.len > 0.05 ? 42 : 60;
        if (this.stun > 0) rate *= 0.25;
        if (hs > max + 0.4 && v.x * wish.x + v.z * wish.z > 0) rate = 9;
        const dvx = tx - v.x, dvz = tz - v.z;
        const dl = Math.hypot(dvx, dvz);
        const step = rate * dt;
        if (dl <= step) { v.x = tx; v.z = tz; } else { v.x += dvx / dl * step; v.z += dvz / dl * step; }
      }
    } else {
      // air
      this.airT += dt;
      this.coyote = Math.max(0, this.coyote - dt);
      if (wish.len > 0.05) {
        const target = Math.max(hs, PHYS.RUN * 0.85);
        const dvx = wish.x * target - v.x, dvz = wish.z * target - v.z;
        const dl = Math.hypot(dvx, dvz);
        const step = 16 * dt;
        if (dl <= step) { v.x += dvx; v.z += dvz; } else { v.x += dvx / dl * step; v.z += dvz / dl * step; }
      }
      v.y -= PHYS.G * dt;
    }

    // jump
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      const sliding = this.state === 'slide';
      if (!sliding || this._free(p.x, p.y, p.z, PHYS.H_STAND)) {
        hs = this.speed;
        if (sliding) this._endSlide();
        v.y = PHYS.JUMP;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.state = 'air';
        this.airT = 0;
        this.airStart = { x: p.x, y: p.y, z: p.z, jumped: true, speed: hs };
        bus.emit('jump', { speed: hs, fromSlide: sliding });
      }
    }

    this._moveAndCollide(dt, inp, wish);
  }

  _moveAndCollide(dt, inp, wish) {
    const p = this.pos, v = this.vel;
    const preVX = v.x, preVZ = v.z;
    const wasGrounded = this.grounded;

    const hitX = this._moveAxis('x', v.x * dt);
    const hitZ = this._moveAxis('z', v.z * dt);
    if (hitX) v.x = 0;
    if (hitZ) v.z = 0;

    // vertical
    const fallSpeed = -v.y;
    p.y += v.y * dt;
    let landed = null;
    const s = this.solids;
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (!this._overlap(p.x, p.y, p.z, this.h, b)) continue;
      if (v.y <= 0) { p.y = b.maxY + EPS; landed = b; }
      else { p.y = b.minY - this.h - EPS; v.y = 0; }
    }

    if (landed) {
      v.y = 0;
      this.grounded = true;
      if (!wasGrounded) this._land(landed, fallSpeed, inp);
      else if (landed.tag === 'spring') this._spring(landed);
    } else if (wasGrounded) {
      // walked off an edge
      this.grounded = false;
      this.coyote = 0.13;
      this.airT = 0;
      this.airStart = { x: p.x, y: p.y, z: p.z, jumped: false, speed: this.speed };
      if (this.state === 'slide') this._endSlide();
      this.state = 'air';
      v.y = 0;
    }

    if (this.state === 'mantle' || this.dead) return;

    let hit = hitX || hitZ;
    if (hitX && hitZ) hit = Math.abs(preVX) >= Math.abs(preVZ) ? hitX : hitZ;
    if (hit) this._onWallHit(hit, preVX, preVZ, wish, inp);
    else if (!this.grounded && this.state === 'air') this._wallMagnet(inp);
  }

  _onWallHit(hit, preVX, preVZ, wish, inp) {
    const p = this.pos, b = hit.box;
    const rise = b.maxY - p.y;
    const preSp = Math.hypot(preVX, preVZ);
    const into = preSp > 0.01 ? -(preVX * hit.nx + preVZ * hit.nz) / preSp : 0;
    const push = -(wish.x * hit.nx + wish.z * hit.nz);

    if (this.grounded) {
      if (rise > PHYS.STEP && rise <= PHYS.VAULT_MAX && push > 0.5 && preSp * Math.max(into, 0) > 2) {
        this._startMantle(hit, 'vault', preVX, preVZ);
      }
      return;
    }
    if (this.state !== 'air') return;

    // ledge within reach → climb / vault
    if ((push > 0.3 || into > 0.5) && rise >= 0.25 && rise <= PHYS.REACH) {
      const kind = rise <= PHYS.VAULT_MAX && preSp > 5 ? 'vault' : 'climb';
      if (this._startMantle(hit, kind, preVX, preVZ)) return;
    }
    // wall-run
    if (this._canWallrun(b, inp) && preSp > 4.5 && into < 0.82) {
      this._startWallrun(hit.nx, hit.nz, b, preVX, preVZ);
      return;
    }
    // kick up a wall that's too tall to grab
    if ((into > 0.6 || push > 0.7) && inp.jumpHeld && !this.kickUsed && rise > PHYS.REACH &&
        this.vel.y > -7 && this.vel.y < 4.5 && b.maxY - b.minY > 1.5) {
      this.vel.y = 7.8;
      this.kickUsed = true;
      bus.emit('wallkick', {});
      this.addMove('wallkick');
    }
  }

  _canWallrun(b, inp) {
    const p = this.pos;
    return !b.noWallrun && inp.moveZ > 0.2 && this.airT > 0.05 && this.vel.y > -15 &&
      b.maxY > p.y + PHYS.REACH && b.minY <= p.y + 0.9 &&
      !(this.wallCooldown > 0 && this.wallCooldownBox === b);
  }

  // if you're airborne and skimming right past a wall, stick to it
  _wallMagnet(inp) {
    const hs = this.speed;
    if (hs < 4.5 || inp.moveZ <= 0.2 || this.airT < 0.05) return;
    const v = this.vel;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [nx, nz] of dirs) {
      const into = -(v.x * nx + v.z * nz) / hs;
      if (into < -0.05 || into > 0.8) continue;
      const b = this._touching(nx, nz, 0.16);
      if (b && this._canWallrun(b, inp)) { this._startWallrun(nx, nz, b, v.x, v.z); return; }
    }
  }

  _startWallrun(nx, nz, box, preVX, preVZ) {
    const dot = preVX * nx + preVZ * nz;
    let tx = preVX - dot * nx, tz = preVZ - dot * nz;
    let tl = Math.hypot(tx, tz);
    if (tl < 2) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const fd = fx * nx + fz * nz;
      tx = fx - fd * nx; tz = fz - fd * nz;
      tl = Math.hypot(tx, tz);
      if (tl < 0.2) return;
    }
    tx /= tl; tz /= tl;
    const speed = Math.max(Math.hypot(preVX, preVZ), PHYS.RUN);
    const right = (-tz) * (-nx) + tx * (-nz) > 0;   // is the wall on our right?
    this.wall = { nx, nz, tx, tz, box, t: 0, speed, right, counted: false, startX: this.pos.x, startZ: this.pos.z };
    this.state = 'wallrun';
    this.kickUsed = false;
    this.vel.y = Math.max(this.vel.y * 0.5, 3.2);
    bus.emit('wallrun:start', { right });
  }

  _endWallrun() {
    const w = this.wall;
    if (!w) return;
    const dist = Math.hypot(this.pos.x - w.startX, this.pos.z - w.startZ);
    if (dist > this.stats.longestWallrun) this.stats.longestWallrun = dist;
    this.wallCooldownBox = w.box;
    this.wallCooldown = 0.5;
    this.wall = null;
    this.state = this.grounded ? 'run' : 'air';
    bus.emit('wallrun:end', { dur: w.t, dist });
  }

  _stepWallrun(dt, inp, wish) {
    const w = this.wall, p = this.pos, v = this.vel;
    w.t += dt;
    this.airT += dt;
    if (!w.counted && w.t > 0.3) { w.counted = true; this.addMove('wallrun'); }

    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      v.x = w.tx * w.speed + w.nx * 6.2;
      v.z = w.tz * w.speed + w.nz * 6.2;
      v.y = PHYS.JUMP * 0.98;
      const dur = w.t;
      this._endWallrun();
      this.state = 'air';
      this.airT = 0.06;
      this.airStart = { x: p.x, y: p.y, z: p.z, jumped: true, speed: w.speed, fromWall: true };
      bus.emit('walljump', { dur });
      this.addMove('walljump');
      this._moveAndCollide(dt, inp, wish);
      return;
    }
    if (!this._touching(w.nx, w.nz, 0.24) || w.t > PHYS.WR_MAX || inp.moveZ < 0.1) {
      this._endWallrun();
      this._moveAndCollide(dt, inp, wish);
      return;
    }

    if (w.t > 1.0) w.speed = Math.max(PHYS.RUN, w.speed - 3 * dt);
    v.x = w.tx * w.speed - w.nx * 1.0;
    v.z = w.tz * w.speed - w.nz * 1.0;
    v.y -= PHYS.G * (w.t < PHYS.WR_MAX * 0.7 ? 0.2 : 0.55) * dt;
    if (v.y < -5) v.y = -5;

    const preVX = v.x, preVZ = v.z;
    const hitX = this._moveAxis('x', v.x * dt);
    const hitZ = this._moveAxis('z', v.z * dt);
    for (const hit of [hitX, hitZ]) {
      if (!hit) continue;
      if (hit.nx === w.nx && hit.nz === w.nz) continue;   // just the wall we're on
      // something in the way: grab it if we can, otherwise drop off
      const rise = hit.box.maxY - p.y;
      this._endWallrun();
      if (rise >= 0.25 && rise <= PHYS.REACH) this._startMantle(hit, 'climb', preVX, preVZ);
      if (hitX) v.x = 0;
      if (hitZ) v.z = 0;
      return;
    }

    const fallSpeed = -v.y;
    p.y += v.y * dt;
    const s = this.solids;
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (!this._overlap(p.x, p.y, p.z, this.h, b)) continue;
      if (v.y <= 0) {
        p.y = b.maxY + EPS; v.y = 0;
        this.grounded = true;
        this._endWallrun();
        this._land(b, fallSpeed, inp);
        return;
      }
      p.y = b.minY - this.h - EPS; v.y = 0;
    }
  }

  _startMantle(hit, kind, preVX, preVZ) {
    const b = hit.box, p = this.pos;
    if (b.noMantle) return false;
    const ty = b.maxY + EPS * 2;
    const tx = p.x - hit.nx * 0.62, tz = p.z - hit.nz * 0.62;
    if (!this._free(p.x, ty, p.z, PHYS.H_STAND) || !this._free(tx, ty, tz, PHYS.H_STAND)) return false;
    const rise = ty - p.y;
    const preSp = Math.hypot(preVX, preVZ);
    let ex, ez;
    if (kind === 'vault') {
      const keep = Math.min(Math.max(preSp * 0.94, 5.5), PHYS.RUN + PHYS.FLOW_BONUS);
      let dx = preSp > 1 ? preVX / preSp : -hit.nx, dz = preSp > 1 ? preVZ / preSp : -hit.nz;
      if (-(dx * hit.nx + dz * hit.nz) < 0.3) { dx = -hit.nx; dz = -hit.nz; }
      ex = dx * keep; ez = dz * keep;
    } else {
      ex = -hit.nx * 3.4; ez = -hit.nz * 3.4;
    }
    const a = this.airStart;
    const dist = a ? Math.hypot(p.x - a.x, p.z - a.z) : 0;
    const clutch = !this.grounded && rise > 1.25 && !!a && a.jumped && dist > 2.5;
    if (this.state === 'slide') this._endSlide();
    this.mantle = {
      x0: p.x, y0: p.y, z0: p.z, x1: tx, y1: ty, z1: tz,
      t: 0, dur: kind === 'vault' ? 0.2 + 0.09 * rise : 0.3 + 0.17 * rise,
      kind, ex, ez, rise,
    };
    this.state = 'mantle';
    this.h = PHYS.H_STAND;
    this.vel.x = this.vel.y = this.vel.z = 0;
    bus.emit(kind, { rise, clutch, dist });
    return true;
  }

  _stepMantle(dt) {
    const m = this.mantle, p = this.pos;
    m.t += dt;
    const u = Math.min(1, m.t / m.dur);
    const uy = smooth(Math.min(1, u / 0.7));
    const uh = smooth(Math.max(0, (u - 0.4) / 0.6));
    p.y = lerp(m.y0, m.y1, uy);
    p.x = lerp(m.x0, m.x1, uh);
    p.z = lerp(m.z0, m.z1, uh);
    this.pitchKick = -Math.sin(u * Math.PI) * (m.kind === 'vault' ? 0.1 : 0.2);
    if (u >= 1) {
      p.x = m.x1; p.y = m.y1; p.z = m.z1;
      this.vel.x = m.ex; this.vel.z = m.ez; this.vel.y = 0;
      this.grounded = true;
      this.state = 'run';
      this.kickUsed = false;
      this.airStart = null;
      this.airT = 0;
      this.pitchKick = 0;
      const kind = m.kind;
      this.mantle = null;
      this.addMove(kind, m.rise);
    }
  }

  _spring(b) {
    const p = this.pos;
    this.vel.y = b.power || 16;
    this.grounded = false;
    this.coyote = 0;
    if (this.state === 'slide') this._endSlide();
    this.state = 'air';
    this.airT = 0;
    this.airStart = { x: p.x, y: p.y, z: p.z, jumped: true, speed: this.speed, spring: true };
    this.dipV = -2.5;
    bus.emit('spring', { power: this.vel.y });
    this.addMove('spring');
  }

  _land(b, fallSpeed, inp) {
    const p = this.pos, v = this.vel, a = this.airStart;
    const airT = this.airT;
    const dist = a ? Math.hypot(p.x - a.x, p.z - a.z) : 0;
    const drop = a ? a.y - p.y : 0;
    this.kickUsed = false;
    this.wallCooldown = 0;
    this.state = 'run';

    if (b.tag === 'spring') { this._spring(b); return; }
    if (fallSpeed > PHYS.SPLAT) {
      this.dead = true;
      bus.emit('splat', { fallSpeed, drop });
      return;
    }
    let kind = 'soft';
    if (fallSpeed > PHYS.HARD_LAND) {
      if (inp.crouchHeld || this.crouchBuffer > 0) {
        kind = 'roll';
        this.addMove('roll', drop);
      } else {
        kind = 'hard';
        v.x *= 0.3; v.z *= 0.3;
        this.stun = 0.45;
        this.breakCombo('hard');
      }
    }
    this.dipV = -Math.min(fallSpeed, 26) * (kind === 'roll' ? 0.2 : 0.12);
    if (a && dist > this.stats.longestJump && a.jumped) this.stats.longestJump = dist;
    if (airT > 0.3 || dist > 2.5) {
      if (a && a.jumped && dist >= 3.2 && kind !== 'hard' && !a.spring) this.addMove('gap', dist);
      bus.emit('land', { kind, fallSpeed, dist, drop, airT, jumped: !!(a && a.jumped), on: b.name || null });
    }
    this.airStart = null;
    this.airT = 0;
    if (kind !== 'hard' && inp.crouchHeld && this.speed > 5.5) this._startSlide();
  }

  // ───────────── camera feel (numbers only; main.js applies them) ─────────────
  _camera(dt, inp) {
    const hs = this.speed;
    const eyeTarget = this.state === 'slide' ? PHYS.EYE_LOW : PHYS.EYE;
    this.eye += (eyeTarget - this.eye) * Math.min(1, 14 * dt);

    let rollTarget = -inp.moveX * 0.018;
    if (this.state === 'wallrun' && this.wall) rollTarget = this.wall.right ? 0.21 : -0.21;
    else if (this.state === 'slide' && this.slideReal) rollTarget = 0.05;
    this.roll += (rollTarget - this.roll) * Math.min(1, 9 * dt);

    this.dipV += (-this.dip * 190 - this.dipV * 19) * dt;
    this.dip += this.dipV * dt;
    this.stepLift *= Math.max(0, 1 - 14 * dt);
    if (this.state !== 'mantle') this.pitchKick *= Math.max(0, 1 - 10 * dt);

    const striding = (this.grounded && this.state === 'run' && hs > 1) || this.state === 'wallrun';
    if (striding) {
      const before = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += dt * (4.2 + hs * 1.15);
      const amp = Math.min(1, hs / 8);
      this.bobY = Math.abs(Math.sin(this.bobPhase)) * -0.05 * amp;
      this.bobX = Math.sin(this.bobPhase) * 0.022 * amp;
      if (Math.floor(this.bobPhase / Math.PI) !== before) {
        bus.emit('step', { speed: hs, wall: this.state === 'wallrun' });
      }
    } else {
      this.bobY *= Math.max(0, 1 - 10 * dt);
      this.bobX *= Math.max(0, 1 - 10 * dt);
    }
  }

  // eye position for the renderer
  eyePos(out) {
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    out.x = this.pos.x + cos * this.bobX;
    out.y = this.pos.y + this.eye + this.dip + this.bobY - this.stepLift;
    out.z = this.pos.z - sin * this.bobX;
    return out;
  }
}
