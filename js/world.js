// Turns the course data into a bright, clean rooftop city.
import * as THREE from 'three';
import { C } from './course.js';

const HORIZON = new THREE.Color(0xe9f3ff);
const SUN_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

// deterministic random so the skyline is the same every visit
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Adds window bands to walls and a faint panel grid to roofs, straight from world position,
// so one instanced cube can stand in for every building.
function architectural(material) {
  material.defines = { ...(material.defines || {}), ARCHITECTURE: 1 };
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        vWNrm = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float ny = vWNrm.y;
          if (ny > 0.5) {
            vec2 g = vWPos.xz / 3.0;
            vec2 fw = fwidth(g);
            vec2 a = abs(fract(g) - 0.5);
            vec2 ln = smoothstep(0.5 - fw * 1.5 - 0.006, vec2(0.5), a);
            float m = max(ln.x, ln.y);
            float fade = 1.0 - smoothstep(0.05, 0.3, max(fw.x, fw.y));
            diffuseColor.rgb *= vec3(0.905, 0.925, 0.955) * (1.0 - 0.14 * m * fade);
          } else if (ny > -0.5) {
            float fy = vWPos.y / 3.4;
            float fwy = fwidth(fy);
            float t = fract(fy);
            float band = smoothstep(0.30, 0.30 + fwy * 1.5 + 0.004, t) * (1.0 - smoothstep(0.80, 0.80 + fwy * 1.5 + 0.004, t));
            band = mix(band, 0.5, smoothstep(0.12, 0.45, fwy));
            float u = (abs(vWNrm.x) > 0.5 ? vWPos.z : vWPos.x) / 2.6;
            float fwu = fwidth(u);
            float mu = abs(fract(u) - 0.5);
            float mull = 1.0 - smoothstep(0.47 - fwu * 1.5, 0.485, mu);
            mull = mix(mull, 0.94, smoothstep(0.1, 0.4, fwu));
            float cell = fract(sin(floor(u) * 12.9898 + floor(fy) * 78.233) * 43758.5453);
            vec3 glass = mix(vec3(0.42, 0.62, 0.86), vec3(0.62, 0.78, 0.94), cell);
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, band * mull * 0.9);
          }
        }`);
  };
  return material;
}

export class World {
  constructor(scene, course, { shadows = true, mobile = false } = {}) {
    this.scene = scene;
    this.course = course;
    this.mobile = mobile;
    this.tmp = new THREE.Object3D();
    this.pulse = [];

    scene.fog = new THREE.Fog(HORIZON, 70, mobile ? 520 : 640);

    this._sky();
    this._lights(shadows);
    this._courseMeshes();
    this._city();
    this._beacons();
    this._signage();
    this._clouds();
  }

  _sky() {
    const geo = new THREE.SphereGeometry(1500, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN_DIR }, horizon: { value: HORIZON } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir; uniform vec3 horizon;
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 mid = vec3(0.36, 0.63, 0.93);
          vec3 top = vec3(0.08, 0.33, 0.78);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          col = mix(col, top, smoothstep(0.18, 0.95, h));
          col = mix(col, horizon * vec3(0.93, 0.95, 0.98), smoothstep(0.0, -0.5, d.y));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += vec3(1.0, 0.96, 0.88) * (pow(s, 900.0) * 4.0 + pow(s, 40.0) * 0.22 + pow(s, 6.0) * 0.08);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  _lights(shadows) {
    const hemi = new THREE.HemisphereLight(0xd9e9ff, 0xf6f3ee, 1.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.5);
    sun.position.copy(SUN_DIR).multiplyScalar(120);
    if (shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 10; c.far = 320;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.06;
    }
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.shadows = shadows;
  }

  _instanced(boxes, material, { cast = true, receive = true } = {}) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, material, boxes.length);
    const o = this.tmp, col = new THREE.Color();
    boxes.forEach((b, i) => {
      o.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      o.scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, col.set(b.color ?? C.white));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = cast && this.shadows;
    mesh.receiveShadow = receive && this.shadows;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  _courseMeshes() {
    const all = [...this.course.solids, ...this.course.ghosts];
    const buildings = all.filter((b) => b.kind === 'building');
    const props = all.filter((b) => b.kind !== 'building');
    this.buildingMat = architectural(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.propMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this._instanced(buildings, this.buildingMat);
    this._instanced(props, this.propMat);
  }

  // the rest of the city: lots of white blocks, none of them reachable
  _city() {
    const r = rng(986);
    const boxes = [];
    const tints = [0xf4f6f8, 0xeef1f5, 0xf7f8fa, 0xe8edf2, 0xf1f3f6];
    const cell = 30;
    for (let gx = -13; gx <= 13; gx++) {
      for (let gd = -8; gd <= 26; gd++) {
        const cx = gx * cell + (r() - 0.5) * 8;
        const cd = gd * cell + (r() - 0.5) * 8;
        const w = 12 + r() * 12, l = 12 + r() * 12;
        const near = Math.abs(cx) < 30 && cd > -40 && cd < 480;
        const distSide = Math.max(0, Math.abs(cx) - 30);
        let top;
        if (near) top = -34 - r() * 26;                                 // under the course: far below
        else {
          top = -30 + r() * 26 + Math.min(distSide, 220) * (0.05 + r() * 0.22);
          if (r() < 0.12) top += 30 + r() * 50;                          // the odd tower
        }
        const b = {
          minX: cx - w / 2, maxX: cx + w / 2, minY: -92, maxY: top,
          minZ: -(cd + l / 2), maxZ: -(cd - l / 2), color: tints[(r() * tints.length) | 0],
        };
        // keep clear of the course corridor
        if (!near && Math.abs(cx) - w / 2 < 22) continue;
        boxes.push(b);
        // a little rooftop clutter so the skyline isn't just slabs
        if (r() < 0.6) {
          const hw = 2 + r() * 3, hl = 2 + r() * 3, hx = cx + (r() - 0.5) * (w - hw - 1), hd = cd + (r() - 0.5) * (l - hl - 1);
          boxes.push({ minX: hx - hw / 2, maxX: hx + hw / 2, minY: top, maxY: top + 1.6 + r() * 2.2, minZ: -(hd + hl / 2), maxZ: -(hd - hl / 2), color: 0xe6eaef, plain: true });
        }
        if (r() < 0.16 && !near) {
          const ax = cx + (r() - 0.5) * (w - 2), ad = cd + (r() - 0.5) * (l - 2);
          boxes.push({ minX: ax - 0.12, maxX: ax + 0.12, minY: top, maxY: top + 8 + r() * 14, minZ: -(ad + 0.12), maxZ: -(ad - 0.12), color: 0x5d6672, plain: true });
        }
        // a few bold colour accents far away, to echo the course
        if (r() < 0.05 && !near) {
          boxes.push({ minX: cx - w / 2 - 0.2, maxX: cx + w / 2 + 0.2, minY: top - 3.4, maxY: top, minZ: -(cd + l / 2 + 0.2), maxZ: -(cd - l / 2 - 0.2), color: r() < 0.5 ? C.orange : C.teal, plain: true });
        }
      }
    }
    this._instanced(boxes.filter((b) => !b.plain), this.buildingMat, { cast: false, receive: false });
    this._instanced(boxes.filter((b) => b.plain), this.propMat, { cast: false, receive: false });

    // street level, a long way down
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ color: 0xbcc7d3 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -92, -220);
    this.scene.add(ground);
  }

  _beacons() {
    for (const b of this.course.beacons) {
      const h = b.big ? 90 : 26, rad = b.big ? 1.3 : 0.16;
      const mat = new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: b.big ? 0.3 : 0.55, depthWrite: false, fog: false });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 16, 1, true), mat);
      m.position.set(b.x, b.y + h / 2, b.z);
      this.scene.add(m);
      this.pulse.push({ mat, base: mat.opacity });
      if (b.big) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 6, 48), new THREE.MeshBasicMaterial({ color: b.color }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(b.x, b.y + 0.03, b.z);
        this.scene.add(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), new THREE.MeshLambertMaterial({ color: 0xdfe5ec }));
        disc.rotation.x = -Math.PI / 2; disc.position.set(b.x, b.y + 0.02, b.z);
        disc.receiveShadow = this.shadows;
        this.scene.add(disc);
        const hMat = new THREE.MeshBasicMaterial({ color: b.color });
        for (const [dx, w, l] of [[-1.5, 0.7, 4.4], [1.5, 0.7, 4.4], [0, 3, 0.7]]) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, l), hMat);
          bar.rotation.x = -Math.PI / 2; bar.position.set(b.x + dx, b.y + 0.04, b.z);
          this.scene.add(bar);
        }
      }
    }
  }

  // station branding on the wall-run panels
  _signage() {
    const cv = document.createElement('canvas');
    cv.width = 2048; cv.height = 512;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.font = '900 250px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('SKYLINE', 60, 262);
    const w1 = g.measureText('SKYLINE').width;
    g.font = '300 250px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('FM', 60 + w1 + 50, 262);
    const w2 = g.measureText('FM').width;
    g.fillRect(60 + w1 + w2 + 110, 150, 14, 220);
    g.font = '700 150px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('98.6', 60 + w1 + w2 + 170, 268);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.96 });

    for (const b of this.course.solids) {
      if (b.tag !== 'panel') continue;
      const len = b.maxZ - b.minZ, hgt = b.maxY - b.minY;
      const sw = Math.min(len * 0.8, 15), sh = sw / 4;
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
        m.position.set(side < 0 ? b.minX - 0.012 : b.maxX + 0.012, b.minY + hgt * 0.58, (b.minZ + b.maxZ) / 2);
        m.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        this.scene.add(m);
      }
    }
  }

  _clouds() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const r = rng(41);
    for (let i = 0; i < 22; i++) {
      const x = 60 + r() * 136, y = 110 + r() * 50, rad = 26 + r() * 46;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(mat);
      const ang = r() * Math.PI * 2, dist = 650 + r() * 500;
      s.position.set(Math.cos(ang) * dist, 130 + r() * 260, Math.sin(ang) * dist - 200);
      const sc = 260 + r() * 340;
      s.scale.set(sc, sc * 0.5, 1);
      this.clouds.add(s);
    }
    this.scene.add(this.clouds);
  }

  update(playerPos, time) {
    this.sky.position.set(playerPos.x, 0, playerPos.z);
    if (this.clouds) this.clouds.position.x = Math.sin(time * 0.01) * 40;
    // keep the shadow box centred on the runner, snapped so shadows don't crawl
    const snap = 2;
    const tx = Math.round(playerPos.x / snap) * snap;
    const ty = Math.round(playerPos.y / snap) * snap;
    const tz = Math.round(playerPos.z / snap) * snap - 14;
    this.sun.target.position.set(tx, ty, tz);
    this.sun.position.set(tx + SUN_DIR.x * 160, ty + SUN_DIR.y * 160, tz + SUN_DIR.z * 160);
    const k = 0.75 + 0.25 * Math.sin(time * 2.4);
    for (const p of this.pulse) p.mat.opacity = p.base * k;
  }
}
