// Touch controls: floating left joystick, right-half camera drag, Jump / Throw
// (hold to charge) / Lock buttons and a pause button. Feeds ctx.input.setVirtual().
// Shown only on touch-first devices: (pointer: coarse) at start, or after the first
// touch. A real mouse click switches back to desktop mode. ?touch=1 forces it on,
// ?touch=0 off. Every finger is tracked by pointerId, so stick + buttons work together.
import { el, setClass } from './dom.js';
import { TOUCH_ICONS, morelGlyph } from './icons.js';

const STICK_R = 46;        // px of knob travel for a full push
const DEADZONE = 0.12;

export function createTouch(ctx, root) {
  const params = new URLSearchParams(location.search);
  const forced = params.get('touch') === '1' ? true : params.get('touch') === '0' ? false : null;

  const layer = el('div', 'ui-layer touch is-idle', { 'aria-hidden': 'true' });
  const zone = el('div', 'tzone');
  const knob = el('div', 'knob', { html: morelGlyph() });
  const stick = el('div', 'stick', null, [el('div', 'base'), knob]);
  const jump = makeButton('jump', 'Jump');
  const thr = makeButton('throw', 'Throw');
  const lock = makeButton('lock', 'Lock');
  const pause = el('div', 'tpause', { role: 'button', 'aria-label': 'Pause', html: TOUCH_ICONS.pause });
  // charge ring on the throw button
  thr.el.insertAdjacentHTML('beforeend', `<svg class="tring" viewBox="0 0 50 50"><circle cx="25" cy="25" r="22.5" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/></svg>`);
  const thrRing = thr.el.querySelector('.tring circle');
  layer.append(zone, stick, thr.el, jump.el, lock.el, pause);
  root.append(layer);

  let enabled = false;
  let active = false;           // state === 'playing'
  let used = false;             // setVirtual has been called (so a release is needed)
  let W = window.innerWidth, H = window.innerHeight;
  window.addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; placeRest(); });

  // reused payloads (no allocations per pointer event)
  const vMove = { move: { x: 0, y: 0 } };
  const vLook = { look: { x: 0, y: 0 } };
  const vBtn = { buttons: { jump: false } };
  const setVirtual = (v) => { used = true; ctx.input.setVirtual(v); };

  // ---------------------------------------------------------------- enable / disable
  function enable(on) {
    if (forced !== null) on = forced;
    if (enabled === on) return;
    enabled = on;
    setClass(layer, 'is-on', on);
    setClass(root, 'touch-mode', on);
    if (!on) releaseAll();
    placeRest();
  }
  const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  enable(forced ?? !!(coarse && coarse.matches));
  window.addEventListener('touchstart', () => enable(true), { passive: true, capture: true });
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') enable(true);
    else if (e.pointerType === 'mouse' && !(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) enable(false);
  }, { capture: true });

  // ---------------------------------------------------------------- joystick + camera drag
  const joy = { id: null, ox: 0, oy: 0 };
  const look = { id: null, x: 0, y: 0 };
  let restX = 0, restY = 0;
  function placeRest() {
    restX = Math.max(90, Math.min(W * 0.22, 130));
    restY = H - (H > 520 ? 150 : 110);
    if (joy.id === null) positionStick(restX, restY, 0, 0);
  }
  function positionStick(x, y, kx, ky) {
    stick.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    knob.style.transform = `translate3d(${kx.toFixed(1)}px, ${ky.toFixed(1)}px, 0)`;
  }

  zone.addEventListener('pointerdown', (e) => {
    if (!enabled || !active) return;
    if (e.pointerType === 'mouse' && forced !== true) return;
    const x = e.clientX, y = e.clientY;
    if (x < W * 0.5 && joy.id === null) {
      joy.id = e.pointerId; joy.ox = x; joy.oy = y;
      setClass(stick, 'is-active', true);
      positionStick(x, y, 0, 0);
    } else if (look.id === null) {
      look.id = e.pointerId; look.x = x; look.y = y;
    } else return;
    try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === joy.id) {
      let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
      let len = Math.hypot(dx, dy);
      // the base follows a finger that runs past the rim (direction changes stay responsive)
      const follow = STICK_R * 1.35;
      if (len > follow) {
        const k = (len - follow) / len;
        joy.ox += dx * k; joy.oy += dy * k;
        dx = e.clientX - joy.ox; dy = e.clientY - joy.oy; len = follow;
      }
      const kx = len > STICK_R ? (dx / len) * STICK_R : dx;
      const ky = len > STICK_R ? (dy / len) * STICK_R : dy;
      positionStick(joy.ox, joy.oy, kx, ky);
      let mx = kx / STICK_R, my = -ky / STICK_R;
      const m = Math.hypot(mx, my);
      if (m < DEADZONE) { mx = 0; my = 0; } else { const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m; mx *= s; my *= s; }
      vMove.move.x = mx; vMove.move.y = my;
      setVirtual(vMove);
    } else if (e.pointerId === look.id) {
      vLook.look.x = e.clientX - look.x; vLook.look.y = e.clientY - look.y;
      look.x = e.clientX; look.y = e.clientY;
      setVirtual(vLook);
    }
  });
  const endZone = (e) => {
    if (e.pointerId === joy.id) {
      joy.id = null;
      setClass(stick, 'is-active', false);
      positionStick(restX, restY, 0, 0);
      vMove.move.x = 0; vMove.move.y = 0;
      setVirtual(vMove);
    } else if (e.pointerId === look.id) look.id = null;
  };
  zone.addEventListener('pointerup', endZone);
  zone.addEventListener('pointercancel', endZone);
  zone.addEventListener('lostpointercapture', endZone);

  // ---------------------------------------------------------------- buttons
  function makeButton(action, label) {
    const b = el('div', `tbtn tbtn-${action}`, { role: 'button', 'aria-label': label, html: `${TOUCH_ICONS[action]}<span class="tl">${label}</span>` });
    const btn = { el: b, id: null, action };
    b.addEventListener('pointerdown', (e) => {
      if (!enabled || !active || btn.id !== null) return;
      btn.id = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      press(btn, true);
      e.preventDefault();
      e.stopPropagation();
    });
    const up = (e) => { if (e.pointerId !== btn.id) return; btn.id = null; press(btn, false); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }
  function press(btn, on) {
    setClass(btn.el, 'is-down', on);
    for (const k in vBtn.buttons) delete vBtn.buttons[k];
    vBtn.buttons[btn.action] = on;
    setVirtual(vBtn);
  }
  pause.addEventListener('pointerdown', (e) => {
    if (!enabled || !active) return;
    e.preventDefault(); e.stopPropagation();
    for (const k in vBtn.buttons) delete vBtn.buttons[k];
    vBtn.buttons.pause = true;
    setVirtual(vBtn);
    vBtn.buttons.pause = false;
    setVirtual(vBtn); // latched: one press
  });

  function releaseAll() {
    joy.id = null; look.id = null;
    for (const b of [jump, thr, lock]) { b.id = null; setClass(b.el, 'is-down', false); }
    setClass(stick, 'is-active', false);
    positionStick(restX, restY, 0, 0);
    if (used) {
      ctx.input.setVirtual({ move: { x: 0, y: 0 }, buttons: { jump: false, throw: false, lock: false, pause: false } });
      used = false;
    }
  }

  function setActive(on) {
    if (active === on) return;
    active = on;
    setClass(layer, 'is-idle', !on);
    if (!on) releaseAll();
  }
  ctx.events.on('game:state', ({ state }) => setActive(state === 'playing'));
  setActive(ctx.state === 'playing');

  let ringShown = -1;
  function frame() {
    if (!enabled || !active) return;
    const c = thr.id !== null && ctx.player ? ctx.player.charge || 0 : 0;
    const off = Math.round((1 - c) * 100);
    if (off !== ringShown) {
      ringShown = off;
      thrRing.setAttribute('stroke-dashoffset', String(off));
      thrRing.style.opacity = off >= 100 ? '0' : '1'; // hide the round cap dot at zero charge
    }
  }

  return {
    el: layer,
    frame,
    enable,
    get enabled() { return enabled; },
    get active() { return active; },
    releaseAll,
  };
}
