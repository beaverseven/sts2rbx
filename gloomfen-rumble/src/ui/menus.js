// Menus: title, controls, settings, pause, results (+ 'dead' = the HUD's splat card).
//   menus.show(name, data)  replaces the menu stack with one screen
//   menus.hide()
// Navigation: keyboard + gamepad through ctx.input (up/down/left/right/confirm/back and
// the move stick, with key-repeat), mouse hover/click, touch tap, Tab focus.
// Menus never run game logic: they emit intents (menu:start, menu:resume,
// menu:restartCheckpoint, menu:quitTitle, menu:playAgain) and play menu sounds.
import { el, frag, fmtInt, fmtTime, setText, setClass, letters, hash01, reducedMotion } from './dom.js';
import { morelGlyph, GLOWCAP, WORM, BADGE, POT } from './icons.js';
import { ZONE_INFO } from './hud.js';
import { storeSettings, storageWorks, setQuality } from './settings.js';

const REPEAT_DELAY = 0.36;
const REPEAT_RATE_V = 0.11;
const REPEAT_RATE_H = 0.07;

/** Intent events the menus emit (payload {} unless noted). */
export const MENU_INTENTS = Object.freeze({
  start: 'menu:start',
  resume: 'menu:resume',
  restartCheckpoint: 'menu:restartCheckpoint',
  quitTitle: 'menu:quitTitle',
  playAgain: 'menu:playAgain',
});

export function createMenus(ctx, root, hud) {
  const layer = el('div', 'ui-layer menus');
  root.append(layer);

  const screens = {};
  let stack = [];
  let cur = null;
  let focus = -1;
  let blockUntil = 0;
  const nav = { v: 0, vt: 0, h: 0, ht: 0 };
  let qualityChosen = false;
  const canStore = storageWorks();

  const sfx = (name) => { try { ctx.audio && ctx.audio.play && ctx.audio.play(name); } catch (e) { console.error(e); } };
  const intent = (name, data) => ctx.events.emit(name, data || {});

  // ================================================================ screen + item plumbing
  function screen(name, label, cls, build) {
    const node = el('div', `menu menu-${name} ${cls || ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    const s = { name, el: node, items: [], lastFocus: 0, onShow: null, onBack: null, onFrame: null, onConfirmOverride: null };
    build(s, node);
    layer.append(node);
    screens[name] = s;
    return s;
  }

  function addItem(s, item) {
    item.index = s.items.length;
    s.items.push(item);
    const node = item.el;
    node.addEventListener('pointermove', (e) => {
      if (cur !== s || e.pointerType === 'touch') return;
      if (focus !== item.index) setFocus(item.index, { sound: true });
    });
    node.addEventListener('focusin', () => { if (cur === s && focus !== item.index) setFocus(item.index, { dom: false }); });
    return item;
  }

  function button(s, parent, label, onActivate, opts = {}) {
    const b = el('button', `btn ${opts.cls || ''}`, { type: 'button' });
    b.append(frag(morelGlyph('bcap')), el('span', 'lbl', { text: label }));
    if (opts.hint) b.append(el('span', 'hint', { text: opts.hint }));
    parent.append(b);
    const item = addItem(s, { el: b, kind: 'button', activate: onActivate, sound: opts.sound ?? 'menuConfirm' });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (cur !== s) return;
      setFocus(item.index, { dom: false });
      activate(item);
    });
    return item;
  }

  function setFocus(i, { sound = false, dom = true, scroll = false } = {}) {
    if (!cur || !cur.items.length) { focus = -1; return; }
    i = Math.max(0, Math.min(cur.items.length - 1, i));
    const prev = cur.items[focus];
    if (prev && prev !== cur.items[i]) setClass(prev.el, 'is-focus', false);
    const it = cur.items[i];
    const changed = focus !== i;
    focus = i;
    cur.lastFocus = i;
    setClass(it.el, 'is-focus', true);
    if (dom && document.activeElement !== it.el) { try { it.el.focus({ preventScroll: true }); } catch { /* ignore */ } }
    if (scroll && it.el.scrollIntoView) it.el.scrollIntoView({ block: 'nearest' });
    if (changed && sound) sfx('menuMove');
  }

  function moveFocus(d) {
    if (!cur || !cur.items.length) return;
    const n = cur.items.length;
    setFocus((focus + d + n) % n, { sound: true, scroll: true });
  }

  function activate(item) {
    if (!item) return;
    if (item.kind === 'slider') return;
    if (item.sound) sfx(item.sound);
    item.activate && item.activate();
  }

  function adjust(dir) {
    const it = cur && cur.items[focus];
    if (it && it.adjust) it.adjust(dir);
  }

  // ================================================================ title
  screen('title', 'Gloomfen Rumble', 'menu-title', (s, node) => {
    const wrap = el('div', 'title-wrap');
    const left = el('div', 'title-left');
    const logo = el('h1', 'logo display', { 'aria-label': 'Gloomfen Rumble' });
    const spores = el('span', 'spores', { 'aria-hidden': 'true' });
    for (let i = 0; i < 7; i++) {
      spores.append(el('i', null, { style: `left:${(8 + hash01(i + 2) * 84).toFixed(1)}%;top:${(10 + hash01(i + 9) * 70).toFixed(1)}%;--d:${(hash01(i + 4) * 3.6).toFixed(2)}` }));
    }
    const lineA = el('span', 'logo-line logo-a', { 'aria-hidden': 'true' }, letters('Gloomfen', (sp, i) => {
      sp.className = 'lt';
      sp.style.setProperty('--r', `${((hash01(i + 1) - 0.5) * 7).toFixed(1)}deg`);
      sp.style.setProperty('--y', `${((hash01(i + 21) - 0.5) * 5).toFixed(1)}px`);
    }));
    const glyph = el('span', 'logo-glyph', { html: morelGlyph() });
    const lineB = el('span', 'logo-line logo-b', { 'aria-hidden': 'true' }, [...letters('Rumble', (sp, i) => {
      sp.className = 'lt';
      sp.style.setProperty('--r', `${((hash01(i + 11) - 0.5) * 9).toFixed(1)}deg`);
      sp.style.setProperty('--y', `${((hash01(i + 31) - 0.5) * 6).toFixed(1)}px`);
    }), glyph]);
    logo.append(spores, lineA, lineB);
    const tag = el('p', 'tagline', { html: 'A pint-sized spore-slinger. A bog full of bandits. <em>One very rude toad.</em>' });
    left.append(logo, tag);

    const bottom = el('div', 'title-bottom');
    const panel = el('div', 'panel title-panel');
    const btns = el('div', 'btns');
    button(s, btns, 'Start', () => intent(MENU_INTENTS.start), { cls: 'primary' });
    button(s, btns, 'Controls', () => push('controls'));
    button(s, btns, 'Settings', () => push('settings'));
    panel.append(btns);
    bottom.append(panel, el('div', 'credits', { text: 'An original game. Built with Three.js.' }));
    wrap.append(left, bottom);
    node.append(wrap);
    s.onBack = () => false;
  });

  // ================================================================ controls
  const CONTROLS = [
    ['Move', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <span class="or">or</span> arrows', 'left stick', 'left virtual stick'],
    ['Camera', 'mouse <span class="or">(click to capture, or drag)</span>, <kbd>Q</kbd> <kbd>E</kbd> rotate', 'right stick', 'drag on the right half'],
    ['Jump / glide', '<kbd>Space</kbd> <span class="or">hold in the air to glide</span>', '<span class="padb">A</span>', 'Jump button'],
    ['Throw', '<kbd>J</kbd> <span class="or">or</span> left mouse <span class="or">hold to charge</span>', '<span class="padb">X</span> <span class="or">/</span> <span class="padb">RB</span>', 'Throw button, hold to charge'],
    ['Lock-on strafe', '<kbd>K</kbd>, <kbd>Shift</kbd> <span class="or">or</span> right mouse <span class="or">(hold)</span>', '<span class="padb">LT</span> <span class="or">/</span> <span class="padb">LB</span>', 'Lock button (hold)'],
    ['Pause', '<kbd>Esc</kbd> <span class="or">or</span> <kbd>P</kbd>', '<span class="padb">Start</span>', 'pause icon'],
  ];
  screen('controls', 'Controls', 'dim', (s, node) => {
    const panel = el('div', 'panel panel-controls');
    panel.append(el('h2', 'panel-title display', { text: 'Controls' }));
    const table = el('table', 'ctl');
    table.innerHTML = `<thead><tr><th>Action</th><th>Keyboard + mouse</th><th>Gamepad</th><th>Touch</th></tr></thead>`;
    const tb = el('tbody');
    for (const [a, k, g, t] of CONTROLS) {
      tb.insertAdjacentHTML('beforeend', `<tr><td>${a}</td><td data-h="Keys">${k}</td><td data-h="Pad">${g}</td><td data-h="Touch">${t}</td></tr>`);
    }
    table.append(tb);
    panel.append(table);
    const foot = el('div', 'panel-foot');
    button(s, foot, 'Back', () => pop(), { cls: 'small', sound: 'menuBack' });
    panel.append(foot);
    node.append(panel);
  });

  // ================================================================ settings
  const settingRows = [];
  screen('settings', 'Settings', 'dim', (s, node) => {
    const panel = el('div', 'panel panel-settings');
    panel.append(el('h2', 'panel-title display', { text: 'Settings' }));
    const list = el('div', 'set-list');
    const pct = (v) => `${Math.round(v * 100)}%`;
    slider(s, list, 'Master volume', 'master', 0, 1, 0.05, pct);
    slider(s, list, 'Music', 'music', 0, 1, 0.05, pct);
    slider(s, list, 'Effects', 'sfx', 0, 1, 0.05, pct);
    slider(s, list, 'Camera speed', 'sensitivity', 0.3, 2, 0.1, (v) => `${v.toFixed(1)}×`);
    choice(s, list, 'Invert camera Y', 'invertY', [[false, 'Off'], [true, 'On']]);
    choice(s, list, 'Graphics', 'quality', [['high', 'High'], ['low', 'Low']]);
    panel.append(list);
    panel.append(el('div', 'set-note', { text: canStore ? 'Saved on this device.' : 'Storage is unavailable: settings last until you close the page.' }));
    const foot = el('div', 'panel-foot');
    button(s, foot, 'Back', () => pop(), { cls: 'small', sound: 'menuBack' });
    panel.append(foot);
    node.append(panel);
    s.onShow = () => { for (const r of settingRows) r.refresh(); };
  });

  function applySetting(key, value) {
    ctx.settings[key] = value;
    if (key === 'master' || key === 'music' || key === 'sfx') {
      try { ctx.audio && ctx.audio.setVolumes && ctx.audio.setVolumes({ master: ctx.settings.master, music: ctx.settings.music, sfx: ctx.settings.sfx }); } catch (e) { console.error(e); }
    } else if (key === 'quality') {
      qualityChosen = true;
      setQuality(ctx, value);
    }
    storeSettings(ctx.settings, qualityChosen);
  }

  function settingRow(s, list, label, ctrl) {
    const row = el('div', 'set-row', { role: 'group', 'aria-label': label, tabindex: '0' });
    const val = el('div', 'val num');
    row.append(el('div', 'lbl', { text: label }), el('div', 'ctrl', null, [ctrl]), val);
    list.append(row);
    return { row, val };
  }

  function slider(s, list, label, key, min, max, step, fmt) {
    const ctrl = el('div', 'slider', { role: 'slider', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max });
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    track.append(fill);
    const knob = el('div', 'knob');
    ctrl.append(track, knob);
    const { row, val } = settingRow(s, list, label, ctrl);
    const get = () => { const v = ctx.settings[key]; return typeof v === 'number' ? v : min; };
    const refresh = () => {
      const v = get();
      const f = (v - min) / (max - min);
      fill.style.transform = `scaleX(${f.toFixed(4)})`;
      knob.style.left = `${(f * 100).toFixed(2)}%`;
      setText(val, fmt(v));
      ctrl.setAttribute('aria-valuenow', String(v));
      ctrl.setAttribute('aria-valuetext', fmt(v));
    };
    const set = (v, sound) => {
      v = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
      v = Math.round(v * 1000) / 1000;
      if (v === get()) return;
      applySetting(key, v);
      refresh();
      if (sound) sfx('menuMove');
    };
    const item = addItem(s, { el: row, kind: 'slider', adjust: (d) => set(get() + d * step, true) });
    // pointer drag on the control
    let dragId = null;
    const fromX = (x) => {
      const r = track.getBoundingClientRect();
      set(min + Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width))) * (max - min), false);
    };
    ctrl.addEventListener('pointerdown', (e) => {
      if (cur !== s) return;
      dragId = e.pointerId;
      try { ctrl.setPointerCapture(dragId); } catch { /* ignore */ }
      setFocus(item.index, { dom: false });
      fromX(e.clientX);
      e.preventDefault();
    });
    ctrl.addEventListener('pointermove', (e) => { if (e.pointerId === dragId) fromX(e.clientX); });
    const end = (e) => { if (e.pointerId === dragId) { dragId = null; sfx('menuMove'); } };
    ctrl.addEventListener('pointerup', end);
    ctrl.addEventListener('pointercancel', end);
    settingRows.push({ refresh });
    refresh();
  }

  function choice(s, list, label, key, options) {
    const seg = el('div', 'seg', { role: 'radiogroup', 'aria-label': label });
    const spans = options.map(([v, text]) => {
      const sp = el('span', null, { role: 'radio', text });
      sp.addEventListener('click', (e) => { e.stopPropagation(); if (cur !== s) return; setFocus(item.index, { dom: false }); select(options.findIndex((o) => o[0] === v), true); });
      seg.append(sp);
      return sp;
    });
    const { row, val } = settingRow(s, list, label, seg);
    val.textContent = '';
    const index = () => {
      const v = key === 'quality' ? (ctx.gfx && ctx.gfx.quality) || ctx.settings.quality : ctx.settings[key];
      const i = options.findIndex((o) => o[0] === v);
      return i >= 0 ? i : key === 'quality' && v === 'medium' ? 0 : 0;
    };
    const refresh = () => {
      const i = index();
      spans.forEach((sp, k) => { setClass(sp, 'is-on', k === i); sp.setAttribute('aria-checked', String(k === i)); });
    };
    const select = (i, sound) => {
      i = (i + options.length) % options.length;
      if (i === index() && !(key === 'quality' && !qualityChosen)) { refresh(); return; }
      applySetting(key, options[i][0]);
      refresh();
      if (sound) sfx('menuMove');
    };
    const item = addItem(s, {
      el: row, kind: 'choice',
      adjust: (d) => select(index() + d, true),
      activate: () => select(index() + 1, false),
      sound: 'menuMove',
    });
    row.addEventListener('click', () => { if (cur !== s) return; setFocus(item.index, { dom: false }); activate(item); });
    settingRows.push({ refresh });
    refresh();
  }

  // ================================================================ pause
  let pauseInfo = null;
  screen('pause', 'Paused', 'dim', (s, node) => {
    const panel = el('div', 'panel panel-pause');
    panel.append(el('h2', 'panel-title display', { text: 'Paused' }));
    pauseInfo = el('div', 'pause-stats num');
    panel.append(pauseInfo);
    const btns = el('div', 'btns');
    button(s, btns, 'Resume', () => intent(MENU_INTENTS.resume), { cls: 'primary' });
    button(s, btns, 'Restart from checkpoint', () => intent(MENU_INTENTS.restartCheckpoint));
    button(s, btns, 'Settings', () => push('settings'));
    button(s, btns, 'Controls', () => push('controls'));
    button(s, btns, 'Quit to title', () => intent(MENU_INTENTS.quitTitle), { sound: 'menuBack' });
    panel.append(btns);
    node.append(panel);
    s.onShow = () => {
      const zone = ctx.level && ctx.level.zone;
      const zname = (zone && ZONE_INFO[zone] && ZONE_INFO[zone].name) || '';
      const pts = ctx.score ? (ctx.score.points ?? 0) : 0;
      pauseInfo.innerHTML = '';
      if (zname) pauseInfo.append(el('span', null, { text: zname }));
      pauseInfo.append(el('span', null, null, [el('b', null, { text: fmtInt(pts) }), document.createTextNode(' pts')]));
    };
    s.onBack = () => { sfx('menuBack'); intent(MENU_INTENTS.resume); return true; };
  });

  // ================================================================ results
  const res = {};
  screen('results', 'Results', '', (s, node) => {
    const panel = el('div', 'panel panel-results');
    const head = el('div', 'res-head', null, [
      el('div', 'res-kicker', { text: 'The Lantern Gate' }),
      el('h2', 'res-title display', { text: 'Gloomfen Cleared!' }),
    ]);
    res.big = el('div', 'big display num', { text: '0' });
    const scoreRow = el('div', 'res-score', null, [res.big, el('div', 'pts', { text: 'points' })]);
    // rank meter: the score as a share of the level's maximum, with the Silver / Gold / Glowing marks
    res.fill = el('div', 'rm-fill');
    const bar = el('div', 'rm-bar', { role: 'presentation' }, [res.fill]);
    for (const [name, at] of [['Silver', 0.6], ['Gold', 0.8], ['Glowing', 0.95]]) {
      bar.append(el('span', 'rm-tick', { 'data-rank': name, title: `${name}: ${Math.round(at * 100)} %`, style: `left:${at * 100}%` }));
    }
    res.meterText = el('div', 'res-meter-text');
    const meter = el('div', 'res-meter', null, [bar, res.meterText]);
    res.badge = el('div', 'res-badge', { role: 'img', 'aria-label': 'Rank' });
    res.badge.innerHTML = BADGE;
    const glyph = el('div', 'rk-glyph', { html: morelGlyph() });
    res.rankName = el('span', 'rk-name display', { text: 'Gold' });
    res.badge.append(glyph, el('div', 'rk-label', null, [el('span', 'rk-small', { text: 'Rank' }), res.rankName]));
    res.stats = el('div', 'res-stats');
    const stat = (icon, k) => {
      const v = el('span', 'v num');
      const n = el('div', 'stat', null, [icon ? frag(icon) : el('span', 'ic'), el('span', 'k', { text: k }), v]);
      res.stats.append(n);
      return { n, v };
    };
    const CLOCK = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" style="fill:var(--outline);stroke:var(--amber);stroke-width:2.4"/><path d="M12 7 V 12 L 15.5 14" style="fill:none;stroke:var(--cream);stroke-width:2.4;stroke-linecap:round"/></svg>`;
    const CHAIN = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15 L 9 9 L 13 13 L 20 5" style="fill:none;stroke:var(--glow-magenta);stroke-width:3;stroke-linecap:round;stroke-linejoin:round"/><circle cx="20" cy="5" r="2.6" style="fill:var(--amber);stroke:var(--outline);stroke-width:1.4"/></svg>`;
    const SPLATI = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 C 14 7 17 5 19 7 C 18 10 21 12 20 15 C 16 15 16 19 12 21 C 10 17 6 19 4 16 C 6 13 3 10 5 7 C 8 8 10 5 12 3 Z" style="fill:var(--amber);stroke:var(--outline);stroke-width:1.6;stroke-linejoin:round"/></svg>`;
    res.time = stat(CLOCK, 'Time');
    res.caps = stat(GLOWCAP, 'Glowcaps');
    res.worms = stat(WORM, 'Glowworms');
    res.chain = stat(CHAIN, 'Best combo');
    res.kills = stat(POT, 'Bandits bopped');
    res.deaths = stat(SPLATI, 'Splats');
    const foot = el('div', 'res-foot');
    button(s, foot, 'Play again', () => intent(MENU_INTENTS.playAgain), { cls: 'primary' });
    button(s, foot, 'Title', () => intent(MENU_INTENTS.quitTitle), { sound: 'menuBack' });
    panel.append(head, scoreRow, meter, res.badge, res.stats, foot);
    node.append(panel);

    s.onShow = (data) => {
      const d = normaliseStats(data);
      res.data = d;
      res.t = 0;
      res.shown = -1;
      res.done = false;
      res.stamped = false;
      res.tick = 0;
      res.dur = reducedMotion() ? 0.5 : Math.min(2.2, 0.8 + Math.log10(1 + d.total) * 0.3);
      setText(res.big, '0');
      res.fill.style.width = '0%';
      res.meterText.replaceChildren();
      if (d.maxPossible > 0) {
        const pct = Math.round(d.ratio * 100);
        res.meterText.append(el('b', null, { text: `${pct} %` }), document.createTextNode(` of ${fmtInt(d.maxPossible)} possible`));
        if (d.next && d.nextAt > d.total) res.meterText.append(document.createTextNode(` · ${fmtInt(d.nextAt - d.total)} more for ${d.next}`));
        else if (d.rank === 'Glowing') res.meterText.append(document.createTextNode(' · the brightest rank!'));
      }
      setText(res.time.v, fmtTime(d.elapsed));
      setText(res.caps.v, d.glowcapsTotal > 0 ? `${d.glowcaps} / ${d.glowcapsTotal}` : `${d.glowcaps}`);
      setText(res.worms.v, d.cagesTotal > 0 ? `${d.cagesFreed} / ${d.cagesTotal}` : `${d.cagesFreed}`);
      setText(res.chain.v, `${d.bestChain}`);
      setText(res.kills.v, `${d.kills}`);
      setText(res.deaths.v, `${d.deaths}`);
      res.badge.setAttribute('data-rank', d.rank);
      res.badge.setAttribute('aria-label', `Rank: ${d.rank}`);
      setText(res.rankName, d.rank);
      res.badge.classList.remove('is-in');
      const stats = res.stats.children;
      for (let i = 0; i < stats.length; i++) {
        stats[i].classList.remove('is-in');
        stats[i].style.animationDelay = `${(0.15 + i * 0.09).toFixed(2)}s`;
      }
      void res.stats.offsetWidth;
      for (let i = 0; i < stats.length; i++) stats[i].classList.add('is-in');
    };
    s.onFrame = (dt) => {
      if (res.done || !res.data) return;
      res.t += dt;
      const k = Math.min(1, res.t / res.dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(res.data.total * e);
      if (v !== res.shown) {
        res.shown = v;
        setText(res.big, fmtInt(v));
        if (res.data.maxPossible > 0) res.fill.style.width = `${Math.min(100, (v / res.data.maxPossible) * 100).toFixed(1)}%`;
        res.tick -= dt;
        if (res.tick <= 0 && k < 1) { res.tick = 0.07; sfx('scoreTick'); }
      }
      if (k >= 1) finishResults();
    };
    // the first confirm during the count-up skips to the end
    s.onConfirmOverride = () => { if (!res.done) { res.t = res.dur; s.onFrame(0); return true; } return false; };
    s.onBack = () => false;
  });

  function finishResults() {
    if (res.done) return;
    res.done = true;
    setText(res.big, fmtInt(res.data.total));
    if (res.data.maxPossible > 0) res.fill.style.width = `${Math.min(100, (res.data.total / res.data.maxPossible) * 100).toFixed(1)}%`;
    res.badge.classList.add('is-in');
    sfx('menuConfirm');
  }

  function normaliseStats(data) {
    let d = data && typeof data === 'object' ? (data.stats && typeof data.stats === 'object' ? data.stats : data) : null;
    if (!d && ctx.score && typeof ctx.score.snapshot === 'function') d = ctx.score.snapshot();
    d = d || {};
    const total = Math.max(0, Math.round(d.total ?? d.points ?? (ctx.score && ctx.score.points) ?? 0));
    let rank = d.rank, info = null;
    const maxPossible = typeof d.maxPossible === 'number' && d.maxPossible > 0 ? d.maxPossible : 0;
    if (ctx.score && typeof ctx.score.rankInfo === 'function' && maxPossible > 0) {
      try { info = ctx.score.rankInfo(total, maxPossible); } catch { /* ignore */ }
    }
    if (!rank && info) rank = info.rank;
    return {
      total,
      rank: rank || 'Bronze',
      maxPossible,
      ratio: maxPossible > 0 ? (typeof d.rankRatio === 'number' ? d.rankRatio : total / maxPossible) : 0,
      next: info ? info.next : null, nextAt: info ? info.nextAt : null,
      elapsed: d.elapsed ?? 0,
      glowcaps: d.glowcaps ?? 0, glowcapsTotal: d.glowcapsTotal ?? 0,
      cagesFreed: d.cagesFreed ?? 0, cagesTotal: d.cagesTotal ?? 0,
      bestChain: d.bestChain ?? 0, kills: d.kills ?? 0, deaths: d.deaths ?? 0,
    };
  }

  // ================================================================ stack
  function open(name, data, restoreFocus) {
    const s = screens[name];
    if (!s) return false;
    if (cur && cur !== s) { setClass(cur.el, 'is-on', false); for (const it of cur.items) setClass(it.el, 'is-focus', false); }
    cur = s;
    focus = -1;
    setClass(s.el, 'is-on', true);
    if (s.onShow) s.onShow(data);
    markScroll(s);
    setFocus(restoreFocus ? s.lastFocus : 0, { dom: true });
    blockUntil = performance.now() + 180;
    nav.v = nav.h = 0;
    return true;
  }

  // panels taller than the screen scroll and keep their footer (Back) pinned in view
  function markScroll(s) {
    const panel = s && s.el.querySelector('.panel');
    if (!panel) return;
    panel.classList.remove('is-scroll');
    if (panel.scrollHeight > panel.clientHeight + 2) panel.classList.add('is-scroll');
  }
  window.addEventListener('resize', () => { if (cur) markScroll(cur); });

  function show(name, data) {
    if (name === 'dead') {
      hide();
      if (hud && hud.splat) hud.splat(true);
      return true;
    }
    if (!screens[name]) { console.warn(`[ui] unknown menu "${name}"`); return false; }
    stack = [name];
    screens[name].lastFocus = 0;
    return open(name, data, false);
  }

  function push(name, data) {
    if (!screens[name]) return false;
    stack.push(name);
    screens[name].lastFocus = 0;
    return open(name, data, false);
  }

  function pop() {
    if (stack.length <= 1) return false;
    stack.pop();
    open(stack[stack.length - 1], undefined, true);
    return true;
  }

  function hide() {
    if (cur) {
      setClass(cur.el, 'is-on', false);
      for (const it of cur.items) setClass(it.el, 'is-focus', false);
    }
    cur = null;
    stack = [];
    focus = -1;
    const a = document.activeElement;
    if (a && layer.contains(a) && a.blur) a.blur();
  }

  function back() {
    if (!cur) return;
    if (stack.length > 1) { sfx('menuBack'); pop(); return; }
    if (cur.onBack) cur.onBack();
  }

  function confirm() {
    if (!cur) return;
    if (cur.onConfirmOverride && cur.onConfirmOverride()) return;
    activate(cur.items[focus]);
  }

  // Enter / Space must not also trigger the focused <button> natively (ctx.input handles them).
  layer.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') e.preventDefault();
  });
  // Esc inside a sub-page of the pause menu = back to the pause menu (core would resume the game).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !cur || stack.length <= 1 || ctx.state !== 'paused' || e.repeat) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    back();
  }, { capture: true });

  // ================================================================ frame: input
  function frame(dt) {
    if (!cur) return;
    if (cur.onFrame) cur.onFrame(dt);
    const input = ctx.input;
    if (!input || ctx.simulating) return; // ctx.input is polled for menus only outside the simulation
    if (performance.now() < blockUntil) return;

    let v = (input.down('up') ? 1 : 0) - (input.down('down') ? 1 : 0);
    if (!v && input.move && Math.abs(input.move.y) > 0.55 && Math.abs(input.move.y) > Math.abs(input.move.x)) v = Math.sign(input.move.y);
    let h = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    if (!h && input.move && Math.abs(input.move.x) > 0.55 && Math.abs(input.move.x) >= Math.abs(input.move.y)) h = Math.sign(input.move.x);

    // a fresh press always steps (two quick taps must not read as one hold); holds repeat
    const pu = input.pressed('up'), pd = input.pressed('down');
    const pl = input.pressed('left'), pr = input.pressed('right');
    if (pu !== pd) { nav.v = pu ? 1 : -1; nav.vt = REPEAT_DELAY; moveFocus(pu ? -1 : 1); }
    else if (v !== nav.v) { nav.v = v; nav.vt = REPEAT_DELAY; if (v) moveFocus(-v); }
    else if (v) { nav.vt -= dt; if (nav.vt <= 0) { nav.vt = REPEAT_RATE_V; moveFocus(-v); } }
    if (pl !== pr) { nav.h = pr ? 1 : -1; nav.ht = REPEAT_DELAY; horizontal(pr ? 1 : -1); }
    else if (h !== nav.h) { nav.h = h; nav.ht = REPEAT_DELAY; if (h) horizontal(h); }
    else if (h) { nav.ht -= dt; if (nav.ht <= 0) { nav.ht = REPEAT_RATE_H; horizontal(h); } }

    if (input.pressed('confirm')) confirm();
    else if (input.pressed('back')) back();
  }

  function horizontal(d) {
    const it = cur && cur.items[focus];
    if (it && it.adjust) { adjust(d); return; }
    // horizontal button rows (results footer): left/right moves focus
    if (it && it.el.parentElement && (it.el.parentElement.classList.contains('res-foot') || it.el.parentElement.classList.contains('panel-foot'))) moveFocus(d);
  }

  return {
    show, hide, push, pop, back, confirm,
    frame,
    get current() { return cur ? cur.name : null; },
    get stack() { return stack.slice(); },
    get focusIndex() { return focus; },
    get focusLabel() { const it = cur && cur.items[focus]; return it ? (it.el.querySelector('.lbl') || it.el).textContent.trim() : null; },
    screens,
    INTENTS: MENU_INTENTS,
  };
}
