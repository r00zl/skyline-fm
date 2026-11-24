// Keyboard + mouse, touch, and gamepad, folded into one input state.
import { bus } from './events.js';
import { settings, isTouch } from './settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = {
      moveX: 0, moveZ: 0,
      jumpPressed: false, jumpHeld: false,
      crouchPressed: false, crouchHeld: false,
    };
    this.lookX = 0;   // radians accumulated since last take
    this.lookY = 0;
    this.keys = new Set();
    this.enabled = false;
    this.touch = isTouch();
    this.locked = false;
    this.pad = { jump: false, crouch: false, phone: false, restart: false };
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookTouch = { id: null, x: 0, y: 0 };
    this.btn = { jump: false, crouch: false };

    this._keyboard();
    this._mouse();
    this._touch();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      const s = this.state;
      s.moveX = s.moveZ = 0;
      s.jumpHeld = s.crouchHeld = s.jumpPressed = s.crouchPressed = false;
      this.btn.jump = this.btn.crouch = false;
      this._stickEnd();
      this.lookX = this.lookY = 0;
    }
  }

  requestLock() {
    if (this.touch) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch { /* not allowed right now */ }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  takeLook() {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return out;
  }

  _press(which) {
    if (!this.enabled) return;
    if (which === 'jump') { this.state.jumpPressed = true; }
    if (which === 'crouch') { this.state.crouchPressed = true; }
  }

  _keyboard() {
    const game = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'ControlLeft', 'Tab']);
    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if (typing) { if (e.code === 'Escape') e.target.blur(); return; }
      if (game.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      // global keys work whenever the game is on screen
      switch (e.code) {
        case 'Tab': case 'KeyQ': bus.emit('ui:phone'); return;
        case 'KeyR': bus.emit('ui:respawn'); return;
        case 'KeyT': case 'Backspace': bus.emit('ui:restart'); return;
        case 'BracketLeft': case 'Comma': bus.emit('ui:station', { dir: -1 }); return;
        case 'BracketRight': case 'Period': bus.emit('ui:station', { dir: 1 }); return;
        case 'KeyN': bus.emit('ui:next'); return;
        case 'KeyM': bus.emit('ui:playpause'); return;
        case 'Enter': bus.emit('ui:confirm'); return;
        default:
      }
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this._press('jump');
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC' || e.code === 'ControlLeft') this._press('crouch');
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
  }

  _mouse() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      bus.emit('input:lock', { locked: this.locked });
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const k = 0.0022 * settings.sensitivity;
      // ignore the occasional huge spurious delta some browsers send on lock
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.lookX += e.movementX * k;
      this.lookY += e.movementY * k * (settings.invertY ? -1 : 1);
    });
    this.canvas.addEventListener('mousedown', () => {
      if (!this.touch && this.enabled && !this.locked) this.requestLock();
    });
  }

  _touch() {
    const zone = document.getElementById('touch');
    const stickEl = document.getElementById('stick');
    const knobEl = document.getElementById('stick-knob');
    if (!zone) return;
    this.stickEl = stickEl; this.knobEl = knobEl;
    const R = 56;

    const bindBtn = (id, which) => {
      const el = document.getElementById(id);
      if (!el) return;
      const down = (e) => { e.preventDefault(); e.stopPropagation(); this.btn[which] = true; this._press(which); el.classList.add('on'); };
      const up = (e) => { e.preventDefault(); e.stopPropagation(); this.btn[which] = false; el.classList.remove('on'); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
    };
    bindBtn('btn-jump', 'jump');
    bindBtn('btn-slide', 'crouch');

    zone.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.42 && this.stick.id === null) {
          this.stick.id = t.identifier;
          this.stick.ox = t.clientX; this.stick.oy = t.clientY;
          this.stick.x = this.stick.y = 0;
          stickEl.style.left = `${t.clientX}px`; stickEl.style.top = `${t.clientY}px`;
          stickEl.classList.add('on');
          knobEl.style.transform = 'translate(-50%,-50%)';
        } else if (this.lookTouch.id === null) {
          this.lookTouch.id = t.identifier;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx *= R / l; dy *= R / l; }
          this.stick.x = dx / R; this.stick.y = dy / R;
          knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else if (t.identifier === this.lookTouch.id) {
          if (this.enabled) {
            const k = 0.0052 * settings.sensitivity;
            this.lookX += (t.clientX - this.lookTouch.x) * k;
            this.lookY += (t.clientY - this.lookTouch.y) * k * (settings.invertY ? -1 : 1);
          }
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) this._stickEnd();
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = null;
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  _stickEnd() {
    this.stick.id = null; this.stick.x = this.stick.y = 0;
    this.stickEl?.classList.remove('on');
  }

  // call once per frame
  poll(dt) {
    const s = this.state, k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    let jump = k.has('Space');
    let crouch = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC') || k.has('ControlLeft');

    // touch stick: pushing most of the way forward is a full run
    if (this.stick.id !== null) {
      const dead = 0.16;
      const sx = Math.abs(this.stick.x) > dead ? this.stick.x : 0;
      const sy = Math.abs(this.stick.y) > dead ? this.stick.y : 0;
      mx += sx; mz += -sy;
      const l = Math.hypot(mx, mz);
      if (l > 0.6) { mx /= l; mz /= l; }
    }
    jump = jump || this.btn.jump;
    crouch = crouch || this.btn.crouch;

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected || gp.axes.length < 4) continue;
      const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
      mx += dz(gp.axes[0]); mz += -dz(gp.axes[1]);
      if (this.enabled) {
        this.lookX += dz(gp.axes[2]) * 2.6 * dt * settings.sensitivity;
        this.lookY += dz(gp.axes[3]) * 2.0 * dt * settings.sensitivity * (settings.invertY ? -1 : 1);
      }
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const pj = b(0), pc = b(1) || b(5) || b(7), pp = b(3), pr = b(8);
      if (pj && !this.pad.jump) this._press('jump');
      if (pc && !this.pad.crouch) this._press('crouch');
      if (pp && !this.pad.phone) bus.emit('ui:phone');
      if (pr && !this.pad.restart) bus.emit('ui:respawn');
      this.pad.jump = pj; this.pad.crouch = pc; this.pad.phone = pp; this.pad.restart = pr;
      jump = jump || pj; crouch = crouch || pc;
      break;
    }

    if (!this.enabled) { mx = mz = 0; jump = crouch = false; }
    s.moveX = Math.max(-1, Math.min(1, mx));
    s.moveZ = Math.max(-1, Math.min(1, mz));
    s.jumpHeld = jump;
    s.crouchHeld = crouch;
  }
}
