// Unified input: keyboard + mouse, standard gamepad, a virtual (touch) layer and
// a debug override. Actions are polled once per fixed step by the loop:
//   input.update(dt)  -> refresh move/look/down/pressed/released
//   ...simulation reads input...
//   input.endFrame()  -> clear edges and look delta
// Presses shorter than one step are latched so a quick tap is never lost.
import * as THREE from 'three';

export const ACTIONS = ['jump', 'throw', 'lock', 'pause', 'confirm', 'back', 'camLeft', 'camRight', 'up', 'down', 'left', 'right'];

const KEYMAP = {
  Space: ['jump', 'confirm'],
  KeyJ: ['throw'],
  KeyK: ['lock'], ShiftLeft: ['lock'], ShiftRight: ['lock'],
  Escape: ['pause', 'back'], KeyP: ['pause'],
  Enter: ['confirm'], NumpadEnter: ['confirm'],
  Backspace: ['back'],
  KeyQ: ['camLeft'], KeyE: ['camRight'],
  KeyW: ['up'], ArrowUp: ['up'], KeyS: ['down'], ArrowDown: ['down'],
  KeyA: ['left'], ArrowLeft: ['left'], KeyD: ['right'], ArrowRight: ['right'],
};
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);

// Standard gamepad button indices -> actions
const PADMAP = [
  [0, ['jump', 'confirm']], [1, ['back']], [2, ['throw']], [5, ['throw']], [7, ['throw']],
  [4, ['lock']], [9, ['pause']], [8, ['pause']],
  [12, ['up']], [13, ['down']], [14, ['left', 'camLeft']], [15, ['right', 'camRight']],
];

const MOUSE_SENS = 0.0022;   // rad per pixel at sensitivity 1
const TOUCH_SENS = 0.0055;   // rad per pixel of virtual look drag
const PAD_YAW = 3.0;         // rad/s at full stick
const PAD_PITCH = 1.9;
const DEADZONE = 0.18;
const DRAG_CANCEL_PX = 7;

export function createInput(ctx) {
  const down = {}, pressed = {}, released = {}, latch = {};
  const padDown = {}, virtualDown = {};
  for (const a of ACTIONS) { down[a] = pressed[a] = released[a] = latch[a] = padDown[a] = virtualDown[a] = false; }

  const keys = new Set();
  const mouse = [false, false, false];
  let mouseThrowCancelled = false;
  let dragDist = 0;
  let pendingMouseX = 0, pendingMouseY = 0;
  let pendingTouchX = 0, pendingTouchY = 0;
  const padMove = new THREE.Vector2();
  const padLook = new THREE.Vector2();
  const virtualMove = new THREE.Vector2();
  let lastTouchTime = -1e9;
  let element = null;
  let anyPressed = false;

  const input = {
    move: new THREE.Vector2(),
    look: new THREE.Vector2(),
    lastDevice: 'keyboard',
    /** 'lock' (pointer lock, default) or 'drag' (fallback when pointer lock is unavailable/rejected). */
    mouseMode: 'lock',
    override: null,

    down: (a) => down[a] === true,
    pressed: (a) => pressed[a] === true,
    released: (a) => released[a] === true,
    /** Raw key state by KeyboardEvent.code (for menus/debug). */
    keyDown: (code) => keys.has(code),
    /** True if any action or key was pressed this step. */
    pressedAny: () => anyPressed,

    get pointerLocked() { return !!element && document.pointerLockElement === element; },

    attach(el) {
      element = el;
      el.addEventListener('mousedown', onMouseDown);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    },

    /** Request pointer lock on the attached element. Resolves true/false; falls back to drag mode on failure. */
    requestPointerLock() {
      if (!element || input.pointerLocked) return Promise.resolve(input.pointerLocked);
      if (!element.requestPointerLock) { input.mouseMode = 'drag'; return Promise.resolve(false); }
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return; done = true;
          document.removeEventListener('pointerlockchange', onChange);
          document.removeEventListener('pointerlockerror', onError);
          if (!ok) input.mouseMode = 'drag';
          resolve(ok);
        };
        const onChange = () => finish(input.pointerLocked);
        const onError = () => finish(false);
        document.addEventListener('pointerlockchange', onChange);
        document.addEventListener('pointerlockerror', onError);
        try {
          const p = element.requestPointerLock();
          if (p && typeof p.then === 'function') p.then(() => finish(input.pointerLocked), () => finish(false));
        } catch { finish(false); }
        setTimeout(() => finish(input.pointerLocked), 1000);
      });
    },
    exitPointerLock() { if (input.pointerLocked) document.exitPointerLock(); },

    /**
     * Touch layer. move: {x,y} absolute stick (-1..1, y = forward); look: {x,y} pixel drag
     * since the previous call (accumulated); buttons: { jump, throw, lock, pause } held states.
     * Only the fields you pass are changed.
     */
    setVirtual(v) {
      if (!v) return;
      if (v.move) virtualMove.set(v.move.x || 0, v.move.y || 0);
      if (v.look) { pendingTouchX += v.look.x || 0; pendingTouchY += v.look.y || 0; }
      if (v.buttons) {
        for (const k in v.buttons) {
          if (!(k in virtualDown)) continue;
          const on = !!v.buttons[k];
          if (on && !virtualDown[k]) latch[k] = true;
          virtualDown[k] = on;
        }
      }
      lastTouchTime = performance.now();
      input.lastDevice = 'touch';
    },

    /** Debug/test override: { move:[x,y], jump, throw, lock, ... } replaces device input; null releases. */
    setOverride(o) {
      if (!o) { input.override = null; return; }
      const prev = input.override || {};
      input.override = { ...o };
      for (const a of ACTIONS) if (o[a] && !prev[a]) latch[a] = true;
    },

    /** Poll devices and compute this step's state. Called by the loop before each fixed update. */
    update(dt) {
      pollGamepad();
      const s = ctx.settings;
      const sens = s.sensitivity ?? 1;
      const inv = s.invertY ? -1 : 1;
      const ov = input.override;

      // --- move
      if (ov) {
        const m = ov.move || [0, 0];
        input.move.set(m[0] || 0, m[1] || 0);
      } else {
        let kx = 0, ky = 0;
        if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
        if (keys.has('KeyW') || keys.has('ArrowUp')) ky += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) ky -= 1;
        input.move.set(kx, ky);
        if (kx && ky) input.move.multiplyScalar(Math.SQRT1_2);
        input.move.add(padMove).add(virtualMove);
      }
      if (input.move.lengthSq() > 1) input.move.normalize();

      // --- look (radians this step)
      const lx = pendingMouseX * MOUSE_SENS + pendingTouchX * TOUCH_SENS;
      const ly = pendingMouseY * MOUSE_SENS + pendingTouchY * TOUCH_SENS;
      input.look.set(lx * sens + padLook.x * PAD_YAW * dt * sens, (ly * sens + padLook.y * PAD_PITCH * dt * sens) * inv);
      pendingMouseX = pendingMouseY = pendingTouchX = pendingTouchY = 0;

      // --- buttons
      refreshKeyActions();
      anyPressed = false;
      for (let i = 0; i < ACTIONS.length; i++) {
        const a = ACTIONS[i];
        let raw;
        if (ov && (a === 'jump' || a === 'throw' || a === 'lock')) raw = !!ov[a];
        else raw = keyAction(a) || mouseAction(a) || padDown[a] || virtualDown[a] || (ov ? !!ov[a] : false);
        const now = raw || latch[a];
        const was = down[a];
        if (now && !was) { pressed[a] = true; anyPressed = true; }
        if (!now && was) released[a] = true;
        down[a] = now;
        latch[a] = false;
      }
    },

    /** Clear per-step edges and look delta. Called by the loop after each fixed update. */
    endFrame() {
      for (let i = 0; i < ACTIONS.length; i++) { pressed[ACTIONS[i]] = false; released[ACTIONS[i]] = false; }
      input.look.set(0, 0);
      anyPressed = false;
    },

    /**
     * Drop an action's held state without producing a released edge
     * (used when a mouse drag turns out to be a camera drag rather than a throw).
     */
    cancel(action) {
      down[action] = false; latch[action] = false; pressed[action] = false; released[action] = false;
      if (action === 'throw') mouseThrowCancelled = true;
    },

    /** Release everything (on blur / state changes). */
    reset() {
      keys.clear(); mouse[0] = mouse[1] = mouse[2] = false;
      for (const a of ACTIONS) { latch[a] = false; virtualDown[a] = false; }
      virtualMove.set(0, 0);
    },
  };

  const keyAct = {};
  function refreshKeyActions() {
    for (let i = 0; i < ACTIONS.length; i++) keyAct[ACTIONS[i]] = false;
    keys.forEach(markKey);
  }
  function markKey(code) {
    const acts = KEYMAP[code];
    if (acts) for (let i = 0; i < acts.length; i++) keyAct[acts[i]] = true;
  }
  function keyAction(a) { return keyAct[a] === true; }
  function mouseActive() {
    return input.pointerLocked || input.mouseMode === 'drag';
  }
  function mouseAction(a) {
    if (!mouseActive()) return false;
    if (a === 'throw') return mouse[0] && !mouseThrowCancelled;
    if (a === 'lock') return mouse[2];
    return false;
  }

  function pollGamepad() {
    padMove.set(0, 0); padLook.set(0, 0);
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    let pad = null;
    if (pads) for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    for (const [, acts] of PADMAP) for (const a of acts) padDown[a] = false;
    if (!pad) return;
    const ax = pad.axes;
    stick(ax[0] || 0, -(ax[1] || 0), padMove);
    stick(-(ax[2] || 0), ax[3] || 0, padLook);
    padLook.x = -padLook.x; // right stick right = turn right
    padLook.x *= Math.abs(padLook.x); padLook.y *= Math.abs(padLook.y); // response curve
    let active = padMove.lengthSq() > 0.09 || padLook.lengthSq() > 0.09;
    const b = pad.buttons;
    for (const [idx, acts] of PADMAP) {
      const btn = b[idx];
      if (!btn) continue;
      const on = btn.pressed || btn.value > 0.5;
      if (on) { active = true; for (const a of acts) { if (!padDown[a]) padDown[a] = true; } }
    }
    if (b[6] && (b[6].pressed || b[6].value > 0.3)) { padDown.lock = true; active = true; }
    if (active) input.lastDevice = 'gamepad';
  }
  function stick(x, y, out) {
    const len = Math.hypot(x, y);
    if (len < DEADZONE) { out.set(0, 0); return; }
    const k = Math.min(1, (len - DEADZONE) / (1 - DEADZONE)) / len;
    out.set(x * k, y * k);
  }

  // --- DOM listeners
  function isTextTarget(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  window.addEventListener('keydown', (e) => {
    if (isTextTarget(e)) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    input.lastDevice = 'keyboard';
    if (e.repeat) return;
    keys.add(e.code);
    const acts = KEYMAP[e.code];
    if (acts) for (const a of acts) latch[a] = true;
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => input.reset());
  window.addEventListener('touchstart', () => { lastTouchTime = performance.now(); }, { passive: true });

  function fromTouch(e) {
    return (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) || performance.now() - lastTouchTime < 900;
  }
  function onMouseDown(e) {
    if (fromTouch(e)) return;
    input.lastDevice = 'keyboard';
    if (e.button > 2) return;
    if (!mouseActive()) return; // first click is consumed by the pointer-lock request (camera rig)
    mouse[e.button] = true;
    if (e.button === 0) { mouseThrowCancelled = false; dragDist = 0; latch.throw = true; }
    if (e.button === 2) latch.lock = true;
  }
  window.addEventListener('mouseup', (e) => {
    if (e.button <= 2) mouse[e.button] = false;
    if (e.button === 0) mouseThrowCancelled = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (fromTouch(e)) return;
    if (input.pointerLocked) {
      pendingMouseX += e.movementX || 0; pendingMouseY += e.movementY || 0;
    } else if (input.mouseMode === 'drag' && (mouse[0] || mouse[1])) {
      const mx = e.movementX || 0, my = e.movementY || 0;
      pendingMouseX += mx; pendingMouseY += my;
      dragDist += Math.abs(mx) + Math.abs(my);
      if (mouse[0] && !mouseThrowCancelled && dragDist > DRAG_CANCEL_PX) input.cancel('throw');
    }
  });

  return input;
}
