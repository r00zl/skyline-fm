// The course, as plain data (no rendering in here, so it can be tested headlessly).
// Units are metres. "d" is distance along the course; forward is -Z, so z = -d.
// Right is +X, up is +Y.

export const C = {
  white: 0xf4f6f8,
  roofTrim: 0xe3e7ec,
  grey: 0xcfd5dc,
  dark: 0x59626e,
  orange: 0xff5a1f,
  teal: 0x12b5a6,
  yellow: 0xffc21a,
  glass: 0x9cc4e4,
};

export function buildCourse() {
  const solids = [];      // things you collide with
  const ghosts = [];      // drawn but not solid
  const triggers = [];    // invisible volumes that fire events
  const checkpoints = [];
  const roofs = [];       // course roofs, for the fall line
  const beacons = [];     // light columns (checkpoints, finish)

  // box from min/max in x, y and course distance d
  const S = (x0, x1, y0, y1, d0, d1, color = C.white, extra = {}) => {
    const b = {
      minX: Math.min(x0, x1), maxX: Math.max(x0, x1),
      minY: Math.min(y0, y1), maxY: Math.max(y0, y1),
      minZ: -Math.max(d0, d1), maxZ: -Math.min(d0, d1),
      color, kind: 'prop', ...extra,
    };
    (extra.ghost ? ghosts : solids).push(b);
    return b;
  };
  const G = (x0, x1, y0, y1, d0, d1, color, extra = {}) =>
    S(x0, x1, y0, y1, d0, d1, color, { ...extra, ghost: true });

  const DEPTH = 90;
  const roof = (x0, x1, d0, d1, top, name) => {
    const b = S(x0, x1, top - DEPTH, top, d0, d1, C.white, { kind: 'building', roof: true, name });
    roofs.push({ d0, d1, top, x0, x1, name });
    return b;
  };

  // an orange strip painted on a take-off edge (visual only)
  const edge = (x0, x1, d, top) => G(x0, x1, top, top + 0.02, d - 0.45, d, C.orange);

  const trigger = (type, id, x0, x1, y0, y1, d0, d1, extra = {}) => {
    triggers.push({
      type, id,
      minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: -d1, maxZ: -d0,
      ...extra,
    });
  };
  const hint = (id, d0, d1, top) => trigger('hint', id, -40, 40, top - 3, top + 12, d0, d1);
  const zone = (id, d0, d1, top) => trigger('zone', id, -40, 40, top - 6, top + 14, d0, d1);

  const checkpoint = (x, d, top, name) => {
    const index = checkpoints.length;
    checkpoints.push({ index, x, y: top, z: -d, d, name });
    if (index > 0) {
      trigger('checkpoint', index, x - 9, x + 9, top - 1, top + 9, d - 1.5, d + 1.5, { once: true });
      beacons.push({ x: x - 5.5, y: top, z: -d, color: C.teal });
      beacons.push({ x: x + 5.5, y: top, z: -d, color: C.teal });
      G(x - 5.5, x + 5.5, top, top + 0.02, d - 0.3, d + 0.3, C.teal);
    }
    return index;
  };

  const acUnit = (x, d, top, w = 1.8, l = 1.6, h = 1.1) => {
    S(x - w / 2, x + w / 2, top, top + h, d, d + l, C.grey);
    G(x - w / 2 + 0.15, x + w / 2 - 0.15, top + h, top + h + 0.06, d + 0.15, d + l - 0.15, C.dark);
  };
  const mast = (x, d, top, h = 7) => {
    G(x - 0.07, x + 0.07, top, top + h, d - 0.07, d + 0.07, C.dark);
    G(x - 0.7, x + 0.7, top + h * 0.8, top + h * 0.8 + 0.06, d - 0.04, d + 0.04, C.dark);
    G(x - 0.45, x + 0.45, top + h * 0.92, top + h * 0.92 + 0.06, d - 0.04, d + 0.04, C.dark);
  };
  const skylight = (x0, x1, d0, d1, top) => {
    G(x0, x1, top, top + 0.12, d0, d1, C.roofTrim);
    G(x0 + 0.2, x1 - 0.2, top + 0.12, top + 0.16, d0 + 0.2, d1 - 0.2, C.glass);
  };
  // a vaultable wall with an orange cap
  const vaultWall = (x0, x1, d, top, h = 1.05) => {
    S(x0, x1, top, top + h, d, d + 0.5, C.white);
    G(x0, x1, top + h, top + h + 0.05, d, d + 0.5, C.orange);
  };
  // something to slide under: a slab held up by posts
  const slideBar = (x0, x1, d0, d1, top, clear = 1.12, h = 2.3) => {
    S(x0, x1, top + clear + 0.14, top + clear + h, d0, d1, C.grey, { noWallrun: true, tag: 'low' });
    S(x0, x1, top + clear, top + clear + 0.14, d0 - 0.04, d1 + 0.04, C.orange, { noWallrun: true, tag: 'low' });
    S(x0, x0 + 0.5, top, top + clear, d0, d1, C.grey);
    S(x1 - 0.5, x1, top, top + clear, d0, d1, C.grey);
  };
  // a wall-run panel. face = 'right' means the runnable face looks toward +X.
  const panel = (xFace, face, d0, d1, y0, y1) => {
    const t = 0.35;
    const x0 = face === 'right' ? xFace - t : xFace;
    S(x0, x0 + t, y0, y1, d0, d1, C.orange, { tag: 'panel' });
    // frame posts so it doesn't float
    const px = face === 'right' ? xFace - t - 0.25 : xFace + t;
    for (let d = d0 + 1; d < d1; d += 4.5) G(px, px + 0.25, y0 - 88, y1 + 0.3, d, d + 0.25, C.dark);
    G(px, px + 0.25, y1, y1 + 0.25, d0, d1, C.dark);
  };

  // ───────────────────────── A · start roof ─────────────────────────
  const A = 0;
  roof(-9, 9, -8, 34, A, 'start');
  S(-9, -4, A, A + 2.9, -8, -2.5, C.white);                 // stair hut
  G(-6.2, -5.2, A, A + 2.1, -2.5, -2.44, C.orange);         // its door
  G(-9.3, -3.7, A + 2.9, A + 3.02, -8.3, -2.2, C.roofTrim);
  acUnit(6.6, 3, A); acUnit(6.6, 6, A);
  mast(7.5, -5, A, 9);
  skylight(-7.5, -4.5, 8, 13, A);
  acUnit(0, 15, A, 5, 1.6, 1.0);                             // first vault
  G(-2.5, 2.5, A + 1.0, A + 1.05, 15, 15.25, C.orange);
  vaultWall(-9, 9, 25, A);
  edge(-9, 9, 34, A);
  checkpoint(0, 1, A, 'Start');
  hint('move', -2, 9, A);
  hint('vault', 9.5, 24, A);
  hint('jump', 27, 34, A);

  // ───────────────────────── B · first gaps ─────────────────────────
  const Bt = -0.6;
  roof(-5, 9, 37, 55, Bt, 'b');
  acUnit(-3.2, 42, Bt); mast(7.6, 40, Bt, 6);
  skylight(3, 7, 44, 50, Bt);
  edge(-5, 9, 55, Bt);

  const Ct = -2.6;
  roof(-3, 11, 59.6, 80, Ct, 'c');
  acUnit(9, 62, Ct);
  // raised block you have to climb
  S(-3, 11, Ct, Ct + 1.5, 70, 80, C.white, { name: 'c-block' });
  roofs.push({ d0: 70, d1: 80, top: Ct + 1.5, x0: -3, x1: 11, name: 'c-block' });
  G(-3, 11, Ct + 1.5, Ct + 1.52, 70, 70.45, C.orange);
  edge(-3, 11, 80, Ct + 1.5);
  hint('climb', 60, 69.5, Ct);

  // ───────────────────────── D · slides + first wall-run ─────────────────────────
  const Dt = 1.1;
  roof(-5, 11, 83.2, 112, Dt, 'd');
  G(-5, 11, Dt, Dt + 0.02, 83.2, 83.65, C.orange);
  checkpoint(3, 87, Dt, 'The Ducts');
  slideBar(-5, 11, 94, 95.2, Dt);
  slideBar(-5, 11, 100.5, 105, Dt);
  hint('slide', 88.5, 93.5, Dt);
  zone('ducts', 88, 92, Dt);
  panel(8, 'left', 106.5, 126.5, Dt - 0.6, Dt + 5.4);
  edge(-5, 8, 112, Dt);
  hint('wallrun', 105.2, 111.5, Dt);
  zone('wallrun', 105.5, 109, Dt);

  // ───────────────────────── E · wall-to-wall ─────────────────────────
  const Et = 0.1;
  roof(-5, 11, 122.5, 150, Et, 'e');
  checkpoint(3, 127, Et, 'Billboard Alley');
  acUnit(-3, 131, Et); acUnit(9.2, 136, Et); mast(-4, 140, Et, 8);
  skylight(4.5, 8.5, 130, 135, Et);
  panel(0.8, 'right', 144.5, 161.5, Et - 0.6, Et + 6.2);    // left wall, faces +X
  panel(5.2, 'left', 159.5, 176.5, Et - 0.6, Et + 6.2);     // right wall, faces -X
  edge(0.8, 5.2, 150, Et);
  hint('walljump', 136, 149, Et);
  zone('alley', 138, 144, Et);

  // ───────────────────────── F · springboard ─────────────────────────
  const Ft = -1.9;
  roof(-5, 11, 180, 201, Ft, 'f');
  acUnit(-3.4, 184, Ft); acUnit(9.4, 190, Ft);
  S(1.4, 4.6, Ft, Ft + 0.25, 196.3, 199.7, C.orange, { tag: 'spring', power: 17.2, noMantle: true });
  G(1.9, 4.1, Ft + 0.25, Ft + 0.27, 196.8, 199.2, C.yellow);
  hint('spring', 183, 196, Ft);
  zone('spring', 188, 193, Ft);

  const Gt = 3.0;
  roof(-4, 10, 204, 226, Gt, 'g');
  G(-4, 10, Gt, Gt + 0.02, 204, 204.45, C.orange);
  checkpoint(3, 209, Gt, 'High Roof');
  acUnit(-2.4, 213, Gt); mast(8.6, 215, Gt, 10);
  skylight(4, 8, 211, 214, Gt);
  edge(-4, 10, 226, Gt);
  hint('roll', 213, 225.5, Gt);
  zone('drop', 216, 221, Gt);

  // ───────────────────────── H · the drop, then beams ─────────────────────────
  const Ht = -4.5;
  roof(-7, 9, 230, 256, Ht, 'h');
  checkpoint(1, 236, Ht, 'The Crane');
  acUnit(-5, 240, Ht); acUnit(7, 246, Ht);
  edge(0.3, 1.7, 256, Ht);
  hint('beams', 243, 255.5, Ht);
  zone('beams', 246, 251, Ht);

  const beam = (x, d0, d1, top) => {
    S(x - 0.5, x + 0.5, top - 0.6, top, d0, d1, C.yellow, { name: 'beam' });
    roofs.push({ d0, d1, top, x0: x - 0.5, x1: x + 0.5, name: 'beam' });
  };
  beam(1.0, 256, 270, Ht);
  beam(3.8, 271.5, 285, Ht + 0.4);
  beam(0.3, 286.5, 300, Ht + 0.8);
  // crane tower (decor)
  for (const [cx, cd] of [[6.5, 262], [6.5, 265], [9.5, 262], [9.5, 265]]) {
    G(cx - 0.15, cx + 0.15, Ht - 40, Ht + 26, cd - 0.15, cd + 0.15, C.yellow);
  }
  for (let y = Ht - 36; y < Ht + 26; y += 4) {
    G(6.35, 9.65, y, y + 0.15, 261.85, 262.15, C.yellow);
    G(6.35, 9.65, y, y + 0.15, 264.85, 265.15, C.yellow);
    G(6.35, 6.65, y, y + 0.15, 262, 265, C.yellow);
    G(9.35, 9.65, y, y + 0.15, 262, 265, C.yellow);
  }
  G(-22, 26, Ht + 26, Ht + 27, 262.9, 264.1, C.yellow);      // jib
  G(7, 9, Ht + 27, Ht + 29, 262.5, 264.5, C.white);          // cab

  // ───────────────────────── J · the climb ─────────────────────────
  const Jt = Ht + 0.8;   // -3.7
  roof(-7, 9, 300, 330, Jt, 'j');
  acUnit(6.5, 304, Jt); acUnit(-5.2, 307, Jt);
  const step = (x0, x1, d0, d1, top) => {
    S(x0, x1, Jt, top, d0, d1, C.white, { name: 'step' });
    roofs.push({ d0, d1, top, x0, x1, name: 'step' });
    G(x0, x1, top, top + 0.02, d0, d0 + 0.45, C.orange);
  };
  step(-6, -0.5, 314, 320.5, Jt + 1.5);
  step(-0.5, 6, 318.5, 325.5, Jt + 3.2);
  step(-5, 2.5, 324.5, 330, Jt + 5.0);
  hint('climb2', 303, 313, Jt);
  zone('climb', 304, 309, Jt);

  const Kt = Jt + 7.7;   // 4.0
  roof(-7, 9, 330, 352, Kt, 'k');
  G(-7, 9, Kt, Kt + 0.02, 330, 330.45, C.orange);
  checkpoint(1, 335, Kt, 'Last Leg');
  acUnit(6, 339, Kt); mast(-5.6, 341, Kt, 9);
  skylight(-4.5, -0.5, 337, 341, Kt);
  edge(-7, 9, 352, Kt);
  hint('finale', 338, 351, Kt);
  zone('finale', 340, 346, Kt);

  // ───────────────────────── L · final sprint ─────────────────────────
  const L1 = 2.2;
  roof(-7, 7, 357, 372, L1, 'l1');
  vaultWall(-7, 7, 364, L1);
  edge(-7, 7, 372, L1);

  const L2 = 0.3;
  roof(-8, 6, 377.5, 392, L2, 'l2');
  slideBar(-8, 6, 384, 385.3, L2);
  edge(-8, 6, 392, L2);

  const L3 = -2.6;
  roof(-8, 6, 398, 410, L3, 'l3');
  acUnit(-6.4, 401, L3); acUnit(4.4, 404, L3);
  edge(-8, 6, 410, L3);
  hint('roll2', 399, 409.5, L3);

  const Fin = -7.6;
  roof(-12, 10, 416.8, 448, Fin, 'finish');
  S(-12, 10, Fin, Fin + 3.2, 444, 448, C.white);            // back wall so you can't overshoot
  G(-12, 10, Fin + 3.2, Fin + 3.3, 443.8, 448.2, C.roofTrim);
  mast(8, 446, Fin + 3.2, 8);
  trigger('finish', 0, -12, 10, Fin - 1, Fin + 8, 426, 448, { once: true });
  const finish = { x: -1, y: Fin, z: -433, d: 433 };
  beacons.push({ x: finish.x, y: Fin, z: finish.z, color: C.yellow, big: true });

  const spawn = { x: 0, y: A + 0.01, z: -1, yaw: 0 };

  // fall line: a little below the lowest course roof near where you are
  const killY = (z) => {
    const d = -z;
    let low = Infinity;
    for (const r of roofs) {
      if (r.d1 < d - 26 || r.d0 > d + 26) continue;
      if (r.top < low) low = r.top;
    }
    if (low === Infinity) low = -8;
    return low - 13;
  };

  return {
    solids, ghosts, triggers, checkpoints, roofs, beacons, finish, spawn, killY,
    length: 448,
    bounds: { minX: -12, maxX: 12, minD: -8, maxD: 448 },
  };
}
