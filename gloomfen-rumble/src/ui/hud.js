// In-game HUD: leaf-hearts, score + combo meter, glowcap / glowworm counters,
// tonic ring, boss bar, lock-on reticle, charge ring, floating score popups,
// zone title card, toasts, hurt vignette and the death splat.
//
// Cheap by design: every node is created once and cached; text/class/attribute
// writes only happen when a value changes; projected elements (reticle, charge
// ring, popups) write one transform per frame while visible. One frame() call per
// rendered frame, driven by installUI's ctx.addSystem hook.
import * as THREE from 'three';
import { el, frag, fmtInt, setText, setClass, setAttr, animate, restartClass, letters, hash01 } from './dom.js';
import { HEART, GLOWCAP, WORM, TONIC_ICONS, TONIC_NAMES, POT, SIGN, SPARK, FLOURISH, SPLAT, DRIPS } from './icons.js';

export const ZONE_INFO = {
  glade: { n: 1, name: 'Mossy Glade' },
  bog: { n: 2, name: 'Sunken Bog' },
  fort: { n: 3, name: 'Bandit Fort' },
  pit: { n: 4, name: "Gnarlbelly's Pit" },
};
const ZONE_COUNT = 4;
const POP_COUNT = 20;
const POP_LIFE = 1.15;
const TONIC_HINTS = {
  anvil: 'Anvil Tonic: your throws turn to iron. Smash gates and dented armour!',
  updraft: 'Updraft Tonic: hold Jump in the air to ride the spores upward.',
  seeker: 'Seeker Tonic: every throw splits into three homing puffs.',
};
const SPLAT_LINES = ['Back to the last lantern...', 'Morel shakes it off. Mostly.', 'A little squashed. Still spore-ty.', 'Regrowing from the last lantern...'];

export const tierOf = (m) => Math.max(1, Math.min(6, Math.round(m || 1)));

export function createHud(ctx, root) {
  const { events } = ctx;

  // ---------------------------------------------------------------- layers
  const fx = el('div', 'ui-layer ui-fx');
  const world = el('div', 'ui-layer ui-world');
  const hudEl = el('div', 'ui-layer hud is-hidden');
  const cards = el('div', 'ui-layer ui-cards');
  const splatEl = el('div', 'ui-layer splat', { 'aria-hidden': 'true' });
  root.append(fx, world, hudEl, cards, splatEl);

  // ---------------------------------------------------------------- effects
  const vignette = el('div', 'vignette');
  const lowhp = el('div', 'lowhp');
  fx.append(lowhp, vignette);

  // ---------------------------------------------------------------- top-left: hearts, counters, tonic
  const tl = el('div', 'hud-tl');
  const heartsEl = el('div', 'hearts', { role: 'img', 'aria-label': 'Health' });
  let hearts = [];
  function buildHearts(n) {
    heartsEl.replaceChildren();
    hearts = [];
    for (let i = 0; i < n; i++) {
      const h = el('div', 'heart', { html: HEART });
      heartsEl.append(h);
      hearts.push(h);
    }
  }

  function counter(icon, label) {
    const e = el('div', 'cnt is-zero hud-text', { role: 'img', 'aria-label': label });
    e.append(frag(icon));
    const n = el('span', 'n num', { text: '0' });
    const of = el('span', 'of num');
    e.append(n, of);
    return { el: e, n, of, label, val: -1, tot: -1 };
  }
  const capCnt = counter(GLOWCAP, 'Glowcaps');
  const wormCnt = counter(WORM, 'Glowworms freed');
  const counters = el('div', 'counters', null, [capCnt.el, wormCnt.el]);

  const tonicEl = el('div', 'tonic is-hidden', { role: 'img', 'aria-label': 'Tonic' });
  tonicEl.innerHTML = `<svg class="ring" viewBox="0 0 60 60" aria-hidden="true"><circle class="ring-bg" cx="30" cy="30" r="26"/><circle class="ring-fg" cx="30" cy="30" r="26" pathLength="100" stroke-dasharray="100 100"/></svg>`;
  const tonicFg = tonicEl.querySelector('.ring-fg');
  const tonicIc = el('div', 'tonic-ic');
  const tonicT = el('div', 'tonic-t num hud-text');
  const tonicName = el('div', 'tonic-name hud-text');
  tonicEl.append(tonicIc, tonicT, tonicName);
  tl.append(heartsEl, counters, tonicEl);

  // ---------------------------------------------------------------- top-right: score + combo
  const tr = el('div', 'hud-tr');
  const scoreLabel = el('div', 'score-label', { text: 'Score' });
  const scoreEl = el('div', 'score display num', { text: '0', role: 'img', 'aria-label': 'Score 0' });
  const combo = el('div', 'combo is-off');
  const mult = el('div', 'mult display num', { 'data-tier': '1', text: '×1' });
  const chainEl = el('div', 'chain hud-text num');
  const bar = el('div', 'bar');
  const barFill = el('div', 'bar-fill');
  bar.append(barFill);
  combo.append(el('div', 'chainbox', null, [chainEl, bar]), mult);
  const comboEnd = el('div', 'combo-end hud-text num');
  tr.append(scoreLabel, scoreEl, combo, comboEnd);

  // ---------------------------------------------------------------- boss bar
  const bossEl = el('div', 'hud-boss is-hidden', { role: 'img', 'aria-label': 'Chief Gnarlbelly' });
  const bossName = el('div', 'boss-name display hud-text');
  bossName.append(frag(POT), document.createTextNode('Chief Gnarlbelly'));
  const bossPips = el('div', 'boss-pips');
  const bossBar = el('div', 'boss-bar');
  const bossTrail = el('div', 'boss-trail');
  const bossFill = el('div', 'boss-fill');
  bossBar.append(bossTrail, bossFill);
  bossEl.append(el('div', 'boss-head', null, [bossName, bossPips]), bossBar);
  const boss = { max: 24, hp: 24, phase: 1, phases: 3, pips: [], on: false };
  function buildBossSegments() {
    bossPips.replaceChildren();
    boss.pips = [];
    for (let i = 0; i < boss.phases; i++) { const p = el('i'); bossPips.append(p); boss.pips.push(p); }
    for (const n of bossBar.querySelectorAll('.boss-notch')) n.remove();
    for (let i = 1; i < boss.phases; i++) bossBar.append(el('i', 'boss-notch', { style: `left:${(i / boss.phases) * 100}%` }));
  }
  buildBossSegments();

  hudEl.append(tl, tr, bossEl);

  // ---------------------------------------------------------------- projected: reticle, charge, popups
  const reticle = el('div', 'reticle is-hidden', { 'aria-hidden': 'true' });
  let tips = '';
  for (let k = 0; k < 4; k++) tips += `<path class="tip" transform="rotate(${k * 90} 38 38)" d="M38 6 L 43.5 14.5 L 32.5 14.5 Z"/>`;
  reticle.innerHTML = `<div class="in"><svg class="spin" viewBox="0 0 76 76"><circle class="r0" cx="38" cy="38" r="25"/><circle class="r1" cx="38" cy="38" r="25"/>${tips}</svg></div>`;
  const reticleIn = reticle.firstElementChild;
  const chargeEl = el('div', 'charge is-hidden', { 'aria-hidden': 'true' });
  chargeEl.innerHTML = `<svg viewBox="0 0 46 46"><circle class="cbg" cx="23" cy="23" r="17"/><circle class="cfg" cx="23" cy="23" r="17" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/></svg>`;
  const chargeFg = chargeEl.querySelector('.cfg');
  const popLayer = el('div', 'ui-layer pops', { 'aria-hidden': 'true' });
  const pops = [];
  for (let i = 0; i < POP_COUNT; i++) {
    const e = el('div', 'pop num');
    const num = document.createTextNode('');
    const x = el('span', 'x');
    e.append(num, x);
    popLayer.append(e);
    pops.push({ el: e, num, x, t: -1, pos: new THREE.Vector3(), dx: 0, dy: 0, scale: 1 });
  }
  world.append(popLayer, reticle, chargeEl);

  // ---------------------------------------------------------------- cards: zone title, toasts
  const zc = el('div', 'zonecard', { 'aria-live': 'polite' });
  const zcKicker = el('div', 'zc-kicker');
  const zcName = el('div', 'zc-name display');
  zc.append(zcKicker, zcName, frag(FLOURISH));
  // the card hides itself when its CSS animation ends (frame-rate independent)
  zc.addEventListener('animationend', (e) => { if (e.target === zc) { setClass(zc, 'is-on', false); st.zoneTimer = 0; } });
  const toastsEl = el('div', 'toasts', { 'aria-live': 'polite' });
  cards.append(zc, toastsEl);

  // ---------------------------------------------------------------- splat (death)
  const curtain = el('div', 'curtain', { html: `<div class="sheet"></div>${DRIPS}` });
  const splatSub = el('div', 'splat-sub');
  const splatCard = el('div', 'splat-card', null, [
    el('div', 'splat-blob', { html: SPLAT }, [el('div', 'splat-word display', { text: 'Splat!' })]),
    splatSub,
  ]);
  splatEl.append(curtain, splatCard);

  // ================================================================ state
  const st = {
    visible: false,
    hp: -1, maxHp: -1,
    scoreTarget: 0, scoreShown: 0,
    chain: 0, mult: 1, timeLeft: 0, timeMax: 3, comboShownTier: 1, barFrac: -1,
    comboEndT: 0,
    caps: 0, capsTotal: 0, worms: 0, wormsTotal: 0,
    tonic: null, tonicKind: null, tonicFrac: -1, tonicSec: -1,
    evCharge: 0, evCharging: false,
    lockTarget: null,
    zoneShown: null, zonePending: null, zoneTimer: 0,
    toasts: [],
    seenTonic: new Set(),
    splat: false, splatTimer: 0,
    lastNow: 0,
    popSeq: 0, popStack: 0, popLast: -1e9,
  };
  let W = window.innerWidth, H = window.innerHeight;
  window.addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; });

  // ================================================================ events
  const on = (name, fn) => events.on(name, (p) => fn(p || {}));

  on('player:hurt', () => {
    animate(vignette, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' },
      [{ opacity: 0 }, { opacity: 0.75, offset: 0.2 }, { opacity: 0 }]);
  });
  on('player:died', () => splat(true));
  on('player:respawn', (p) => { if (p.checkpointId) splat(false); });

  on('score:award', (p) => {
    if (typeof p.total === 'number') st.scoreTarget = p.total;
    else st.scoreTarget += p.points || 0;
    spawnPop(p);
  });
  on('combo:update', (p) => {
    st.chain = p.chain | 0;
    st.mult = p.multiplier || 1;
    st.timeLeft = p.timeLeft ?? 0;
    st.timeMax = p.timeMax || st.timeMax || 3;
  });
  on('combo:end', (p) => {
    if ((p.chain | 0) >= 3) {
      setText(comboEnd, `${p.chain}-chain  +${fmtInt(p.total || 0)}`);
      setClass(comboEnd, 'is-on', true);
      st.comboEndT = 2.2;
    }
  });

  on('pickup:glowcap', () => { st.caps++; });
  on('cage:freed', (p) => {
    if (typeof p.freed === 'number') st.worms = p.freed; else st.worms++;
    if (typeof p.total === 'number') st.wormsTotal = p.total;
  });

  on('tonic:start', (p) => {
    st.tonic = { kind: p.kind, remaining: p.duration ?? 20, duration: p.duration ?? 20 };
    if (p.kind && !st.seenTonic.has(p.kind) && TONIC_HINTS[p.kind]) {
      st.seenTonic.add(p.kind);
      toast(TONIC_HINTS[p.kind], 4, { kind: 'tonic' });
    }
  });
  on('tonic:warning', (p) => {
    if (st.tonic && typeof p.remaining === 'number' && !(ctx.player && ctx.player.tonic)) st.tonic.remaining = p.remaining;
    animate(tonicEl, [{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
  });
  on('tonic:end', () => { st.tonic = null; });

  on('player:charge', (p) => {
    if (p.level >= 1) st.evCharge = 1;
    else { st.evCharging = true; st.evCharge = Math.max(st.evCharge, 0.17); }
  });
  on('player:throw', () => { st.evCharging = false; st.evCharge = 0; });

  on('boss:start', (p) => {
    boss.max = p.maxHp || boss.max;
    boss.hp = p.hp ?? boss.max;
    if (p.phase) boss.phase = p.phase;
    updateBoss(false);
    showBossBar(true);
  });
  on('boss:phase', (p) => { boss.phase = p.phase || 1; updateBoss(false); });
  on('boss:hurt', (p) => {
    if (p.maxHp) boss.max = p.maxHp;
    boss.hp = p.hp ?? boss.hp;
    updateBoss(true);
  });
  on('boss:defeated', () => {
    boss.hp = 0; boss.phase = boss.phases + 1;
    updateBoss(true);
    showBossBar(false);
  });

  on('zone:enter', (p) => {
    const info = ZONE_INFO[p.id];
    const name = p.name || (info && info.name) || p.id;
    if (!name) return;
    if (ctx.state === 'playing') zoneCard(name, p.id);
    else st.zonePending = { name, id: p.id };
  });

  on('ui:message', (p) => {
    if (!p.text) return;
    const kind = p.speaker === 'glowworm' ? 'glowworm' : p.source === 'sign' ? 'sign' : 'hint';
    toast(p.text, p.duration ?? 3, { kind });
  });
  on('checkpoint:reached', () => toast('Lantern lit: checkpoint saved.', 2.2, { kind: 'hint' }));

  on('game:state', ({ state, prev }) => {
    if (state === 'playing' && st.zonePending) {
      const z = st.zonePending; st.zonePending = null;
      zoneCard(z.name, z.id);
    }
    if (state === 'playing' && prev === 'dead') splat(false);
    if (state === 'title' || state === 'results') {
      splat(false, true);
      clearToasts();
      setClass(zc, 'is-on', false);
    }
    if (state === 'title') resetRun();
  });

  /** Back on the title: forget per-run HUD state (boss bar, combo, tonic, popups, zone). */
  function resetRun() {
    st.zoneShown = null; st.zonePending = null;
    st.chain = 0; st.timeLeft = 0; st.comboEndT = 0;
    setClass(comboEnd, 'is-on', false);
    st.tonic = null; st.evCharge = 0; st.evCharging = false;
    showBossBar(false);
    for (const q of pops) { q.t = -1; q.el.style.display = 'none'; }
  }

  // ================================================================ API
  function setVisible(v) {
    st.visible = !!v;
    setClass(hudEl, 'is-hidden', !v);
    setClass(world, 'is-hidden', !v);
    world.style.display = v ? '' : 'none';
  }

  function showBossBar(on) {
    boss.on = !!on;
    setClass(bossEl, 'is-hidden', !on);
    setClass(root, 'boss-on', on); // lets the zone card step out of the bar's way
  }

  function updateBoss(hit) {
    const frac = boss.max > 0 ? Math.max(0, Math.min(1, boss.hp / boss.max)) : 0;
    const tf = `scaleX(${frac.toFixed(4)})`;
    bossFill.style.transform = tf;
    bossTrail.style.transform = tf;
    for (let i = 0; i < boss.pips.length; i++) {
      setClass(boss.pips[i], 'is-done', i + 1 < boss.phase);
      setClass(boss.pips[i], 'is-on', i + 1 === boss.phase);
    }
    setAttr(bossEl, 'aria-label', `Chief Gnarlbelly ${Math.max(0, Math.round(boss.hp))} of ${boss.max}`);
    if (hit) {
      animate(bossBar, [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 280 });
      animate(bossFill, [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: 260 }, [{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }]);
    }
  }

  function zoneCard(name, id, force = false) {
    const info = ZONE_INFO[id];
    if (!force && id && id === st.zoneShown) return;
    st.zoneShown = id || name;
    setText(zcKicker, info ? `Zone ${info.n} of ${ZONE_COUNT}` : 'Gloomfen');
    zcName.replaceChildren(...letters(name, (s, i) => {
      s.style.setProperty('--r', `${((hash01(i + name.length) - 0.5) * 16).toFixed(1)}deg`);
      s.style.setProperty('--r2', `${((hash01(i * 3 + 7) - 0.5) * 5).toFixed(1)}deg`);
    }));
    restartClass(zc, 'is-on');
    st.zoneTimer = 6; // fallback only (animationend normally hides it)
  }

  function toast(text, sec = 3, opts = {}) {
    text = String(text);
    // same text already up: refresh it instead of stacking a duplicate
    for (const t of st.toasts) if (t.text === text && !t.out) { t.life = Math.max(t.life, sec); return t.el; }
    const kind = opts.kind || 'hint';
    const e = el('div', 'toast', { 'data-kind': kind, role: 'status' });
    e.append(frag(kind === 'glowworm' ? WORM : kind === 'sign' ? SIGN : SPARK));
    const body = el('div', 'toast-body');
    const m = kind === 'sign' ? /^([^:]{1,32}):\s+(.+)$/s.exec(text) : null;
    if (m) { body.append(el('b', null, { text: m[1] + ': ' }), document.createTextNode(m[2])); }
    else if (kind === 'glowworm') { body.append(el('b', null, { text: 'Glowworm: ' }), document.createTextNode(text)); }
    else body.textContent = text;
    e.append(body);
    toastsEl.append(e);
    st.toasts.push({ el: e, text, life: Math.max(0.8, sec), out: false });
    // keep at most two on screen
    const live = st.toasts.filter((t) => !t.out);
    if (live.length > 2) dismissToast(live[0]);
    return e;
  }
  function dismissToast(t) {
    if (t.out) return;
    t.out = true;
    t.el.classList.add('is-out');
    setTimeout(() => { t.el.remove(); const i = st.toasts.indexOf(t); if (i >= 0) st.toasts.splice(i, 1); }, 320);
  }
  function clearToasts() { for (const t of st.toasts.slice()) dismissToast(t); }

  function splat(on, instant = false) {
    if (on) {
      if (st.splat) return;
      st.splat = true;
      splatSub.textContent = SPLAT_LINES[(Math.random() * SPLAT_LINES.length) | 0];
      splatEl.classList.remove('is-out');
      restartClass(splatEl, 'is-on');
      return;
    }
    if (!st.splat) return;
    st.splat = false;
    splatEl.classList.remove('is-on');
    if (instant) { splatEl.classList.remove('is-out'); return; }
    restartClass(splatEl, 'is-out');
    clearTimeout(st.splatTimer);
    st.splatTimer = setTimeout(() => { if (!st.splat) splatEl.classList.remove('is-out'); }, 650);
  }

  // ---------------------------------------------------------------- popups
  function spawnPop(p) {
    let best = pops[0];
    for (const q of pops) { if (q.t < 0) { best = q; break; } if (q.t > best.t) best = q; }
    const tier = tierOf(p.multiplier);
    const pos = p.position;
    if (pos && typeof pos.x === 'number') best.pos.set(pos.x, pos.y, pos.z);
    else if (ctx.player) best.pos.copy(ctx.player.position).y += 1.3;
    best.t = 0;
    best.num.nodeValue = `+${fmtInt(p.points || 0)}`;
    best.x.textContent = tier > 1 ? `×${tier}` : '';
    best.x.style.display = tier > 1 ? '' : 'none';
    setAttr(best.el, 'data-tier', tier);
    const now = performance.now();
    st.popStack = now - st.popLast < 280 ? (st.popStack + 1) % 5 : 0;
    st.popLast = now;
    best.dx = ((st.popSeq++ % 3) - 1) * 22;
    best.dy = -st.popStack * 24;
    best.scale = 1 + (tier - 1) * 0.12 + ((p.points || 0) >= 1000 ? 0.3 : 0);
    best.el.style.display = 'block';
  }

  const _v = new THREE.Vector3();
  const scr = { x: 0, y: 0, vis: false };
  function project(v3, out) {
    _v.copy(v3).project(ctx.camera);
    out.vis = _v.z < 1 && _v.z > -1 && _v.x > -1.3 && _v.x < 1.3 && _v.y > -1.3 && _v.y < 1.3;
    out.x = (_v.x + 1) * 0.5 * W;
    out.y = (1 - _v.y) * 0.5 * H;
    return out;
  }

  // ================================================================ frame
  function frame(dt) {
    const p = ctx.player;
    const score = ctx.score;
    const simDt = Math.max(0, Math.min(0.25, ctx.time.now - st.lastNow));
    st.lastNow = ctx.time.now;
    const playing = ctx.state === 'playing';

    // --- hearts
    if (p) {
      if (p.maxHp !== st.maxHp) { buildHearts(p.maxHp); st.maxHp = p.maxHp; st.hp = -1; }
      if (p.hp !== st.hp) {
        const prev = st.hp, hp = p.hp;
        st.hp = hp;
        for (let i = 0; i < hearts.length; i++) {
          setClass(hearts[i], 'is-empty', i >= hp);
          setClass(hearts[i], 'is-last', i === hp - 1);
        }
        setClass(heartsEl, 'is-low', hp === 1);
        setAttr(heartsEl, 'aria-label', `Health ${hp} of ${p.maxHp}`);
        if (prev >= 0 && hp < prev) {
          animate(heartsEl, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px) rotate(-2deg)' }, { transform: 'translateX(5px) rotate(1.5deg)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: 'ease-out' });
          for (let i = hp; i < prev && i < hearts.length; i++) {
            animate(hearts[i], [{ transform: 'scale(1.45)', filter: 'brightness(2.6)' }, { transform: 'scale(.85)', filter: 'brightness(1)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' },
              [{ filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }]);
          }
        } else if (prev >= 0 && hp > prev) {
          for (let i = prev; i < hp && i < hearts.length; i++) {
            animate(hearts[i], [{ transform: 'scale(.2) rotate(-35deg)', filter: 'brightness(2)' }, { transform: 'scale(1.3) rotate(6deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)', filter: 'brightness(1)' }],
              { duration: 520, delay: (i - prev) * 110, easing: 'ease-out', fill: 'backwards' },
              [{ opacity: 0.2 }, { opacity: 1 }]);
          }
        }
      }
      setClass(lowhp, 'is-on', playing && st.hp === 1);
    }

    // --- counters (real score is authoritative when installed)
    if (score && !score.isStub) {
      if (typeof score.glowcaps === 'number') st.caps = score.glowcaps;
      if (typeof score.glowcapsTotal === 'number') st.capsTotal = score.glowcapsTotal;
      if (typeof score.cagesFreed === 'number') st.worms = score.cagesFreed;
      if (typeof score.cagesTotal === 'number' && score.cagesTotal > 0) st.wormsTotal = score.cagesTotal;
      if (typeof score.points === 'number') st.scoreTarget = score.points;
    }
    updateCounter(capCnt, st.caps, st.capsTotal);
    updateCounter(wormCnt, st.worms, st.wormsTotal);

    // --- score roll-up
    if (st.scoreTarget < st.scoreShown) { st.scoreShown = st.scoreTarget; setText(scoreEl, fmtInt(st.scoreShown)); } // reset: no roll-down
    if (st.scoreShown !== st.scoreTarget) {
      const diff = st.scoreTarget - st.scoreShown;
      const step = Math.max(Math.abs(diff) * Math.min(1, dt * 9), Math.min(Math.abs(diff), 120 * dt + 1));
      st.scoreShown += Math.sign(diff) * Math.min(step, Math.abs(diff));
      if (Math.abs(st.scoreTarget - st.scoreShown) < 0.5) st.scoreShown = st.scoreTarget;
      setText(scoreEl, fmtInt(st.scoreShown));
      setAttr(scoreEl, 'aria-label', `Score ${Math.round(st.scoreTarget)}`);
    }

    // --- combo meter (events + local drain between ~10 Hz updates, in simulation time)
    if (st.chain > 0) {
      st.timeLeft = Math.max(0, st.timeLeft - simDt);
      if (st.timeLeft <= 0 && (!score || score.isStub)) st.chain = 0; // no score system: end locally
    }
    const comboOn = st.chain > 0;
    setClass(combo, 'is-off', !comboOn);
    if (comboOn) {
      const tier = tierOf(st.mult);
      setText(mult, `×${tier}`);
      if (tier !== st.comboShownTier) {
        setAttr(mult, 'data-tier', tier);
        bar.style.setProperty('--mc', `var(--tier-${tier})`);
        if (tier > st.comboShownTier) animate(mult, [{ transform: 'rotate(-4deg) scale(1.5)' }, { transform: 'rotate(5deg) scale(.92)', offset: 0.55 }, { transform: 'rotate(-4deg) scale(1)' }], { duration: 460, easing: 'ease-out' }, [{ opacity: 0.3 }, { opacity: 1 }]);
        st.comboShownTier = tier;
      }
      chainText(st.chain);
      const frac = Math.round(Math.max(0, Math.min(1, st.timeLeft / (st.timeMax || 3))) * 400) / 400;
      if (frac !== st.barFrac) { st.barFrac = frac; barFill.style.transform = `scaleX(${frac})`; }
    } else if (st.comboShownTier !== 1) {
      st.comboShownTier = 1;
      setAttr(mult, 'data-tier', 1);
    }
    if (st.comboEndT > 0 && (st.comboEndT -= dt) <= 0) setClass(comboEnd, 'is-on', false);

    // --- tonic ring
    const t = (p && p.tonic) || st.tonic;
    if (t && simDt > 0 && t === st.tonic) st.tonic.remaining = Math.max(0, st.tonic.remaining - simDt);
    if (t && t.remaining > 0) {
      if (st.tonicKind !== t.kind) {
        st.tonicKind = t.kind;
        setAttr(tonicEl, 'data-kind', t.kind);
        tonicIc.innerHTML = TONIC_ICONS[t.kind] || TONIC_ICONS.seeker;
        setText(tonicName, `${TONIC_NAMES[t.kind] || t.kind}`);
        setAttr(tonicEl, 'aria-label', `${TONIC_NAMES[t.kind] || t.kind} tonic`);
        setClass(tonicEl, 'is-hidden', false);
        animate(tonicEl, [{ transform: 'scale(.3) rotate(-60deg)' }, { transform: 'scale(1.15) rotate(8deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], { duration: 520, easing: 'ease-out' });
      }
      const frac = Math.round((1 - Math.max(0, Math.min(1, t.remaining / (t.duration || 20)))) * 400) / 4;
      if (frac !== st.tonicFrac) { st.tonicFrac = frac; tonicFg.setAttribute('stroke-dashoffset', String(frac)); }
      const sec = Math.ceil(t.remaining);
      if (sec !== st.tonicSec) { st.tonicSec = sec; setText(tonicT, sec); }
      setClass(tonicEl, 'is-warn', t.remaining <= 3.05);
    } else if (st.tonicKind !== null) {
      st.tonicKind = null;
      st.tonic = null;
      setClass(tonicEl, 'is-warn', false);
      setClass(tonicEl, 'is-hidden', true);
    }

    // --- projected elements (only while the HUD is up)
    if (st.visible) {
      // lock-on reticle
      const lt = p && p.lockTarget && p.lockTarget.alive !== false ? p.lockTarget : null;
      let retVis = false;
      if (lt && lt.position) {
        _v2.copy(lt.position); _v2.y += (lt.height || (lt.radius || 0.6) * 2) * 0.55;
        project(_v2, scr);
        if (scr.vis) {
          retVis = true;
          reticle.style.transform = `translate3d(${scr.x.toFixed(1)}px, ${scr.y.toFixed(1)}px, 0)`;
          if (lt !== st.lockTarget) { st.lockTarget = lt; restartClass(reticleIn, 'in'); }
        }
      }
      if (!lt) st.lockTarget = null;
      setClass(reticle, 'is-hidden', !retVis);

      // charge ring
      let c = p && typeof p.charge === 'number' ? p.charge : st.evCharge;
      if (!(p && typeof p.charge === 'number') && st.evCharging) { st.evCharge = Math.min(1, st.evCharge + dt / 0.9); c = st.evCharge; }
      if (c > 0.16 && p) {
        let cx, cy;
        if (retVis) { cx = scr.x; cy = scr.y; }
        else {
          _v2.copy(p.position); _v2.y += 1.25;
          project(_v2, scr);
          cx = scr.x + 36; cy = scr.y - 8;
        }
        setClass(chargeEl, 'at-reticle', retVis);
        setClass(chargeEl, 'is-hidden', false);
        setClass(chargeEl, 'is-full', c >= 0.999);
        const kind = p.tonic ? p.tonic.kind : null;
        const col = kind === 'anvil' ? 'var(--iron-light)' : kind === 'seeker' ? 'var(--glow-magenta)' : 'var(--glow-cyan)';
        if (chargeEl.__col !== col) { chargeEl.__col = col; chargeEl.style.setProperty('--cc', col); }
        chargeEl.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
        const off = Math.round((1 - c) * 100);
        if (chargeFg.__o !== off) { chargeFg.__o = off; chargeFg.setAttribute('stroke-dashoffset', String(off)); }
      } else setClass(chargeEl, 'is-hidden', true);

      // score popups
      for (let i = 0; i < pops.length; i++) {
        const q = pops[i];
        if (q.t < 0) continue;
        q.t += dt;
        if (q.t >= POP_LIFE) { q.t = -1; q.el.style.display = 'none'; continue; }
        const k = q.t / POP_LIFE;
        _v2.copy(q.pos); _v2.y += 0.35 + (1 - (1 - k) * (1 - k)) * 1.1;
        project(_v2, scr);
        if (!scr.vis) { q.el.style.opacity = '0'; continue; }
        const s = q.scale * (q.t < 0.14 ? 0.5 + (q.t / 0.14) * 0.75 : q.t < 0.26 ? 1.25 - ((q.t - 0.14) / 0.12) * 0.25 : 1);
        q.el.style.transform = `translate3d(${(scr.x + q.dx).toFixed(1)}px, ${(scr.y + q.dy).toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
        q.el.style.opacity = k > 0.7 ? ((1 - k) / 0.3).toFixed(3) : '1';
      }
    }

    // --- zone card + toasts timers
    if (st.zoneTimer > 0 && (st.zoneTimer -= dt) <= 0) setClass(zc, 'is-on', false);
    if (st.toasts.length && (playing || ctx.state === 'dead')) {
      for (let i = st.toasts.length - 1; i >= 0; i--) {
        const tt = st.toasts[i];
        if (!tt.out && (tt.life -= dt) <= 0) dismissToast(tt);
      }
    }
  }
  const _v2 = new THREE.Vector3();

  function updateCounter(c, val, tot) {
    if (val === c.val && tot === c.tot) return;
    const bump = c.val >= 0 && val > c.val;
    c.val = val; c.tot = tot;
    setText(c.n, val);
    setText(c.of, tot > 0 ? `/ ${tot}` : '');
    setClass(c.el, 'is-zero', val === 0);
    setAttr(c.el, 'aria-label', tot > 0 ? `${c.label} ${val} of ${tot}` : `${c.label} ${val}`);
    if (bump) animate(c.el, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }

  let chainShown = -1;
  const chainB = el('b', 'num');
  chainEl.append(chainB, document.createTextNode(' chain'));
  function chainText(n) {
    if (n === chainShown) return;
    chainShown = n;
    setText(chainB, n);
  }

  return {
    el: hudEl,
    toast, showBossBar, zoneCard, splat, setVisible, frame, clearToasts, resetRun,
    get visible() { return st.visible; },
    get bossVisible() { return boss.on; },
    _state: st,
  };
}
