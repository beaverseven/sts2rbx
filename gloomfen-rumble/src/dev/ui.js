// UI sandbox: core test arena + audio + score + installUI + the default menu-intent wiring,
// plus dev-only shortcuts / a small panel that fire fake events so every HUD and menu
// state can be seen and screenshotted.
//   node tools/build.mjs --entry src/dev/ui.js --out dist/dev-ui --dev
// URL: ?state=playing skips the title, ?dev=0 hides the dev panel, ?touch=1 forces touch controls,
//      ?level=1 boots the real Gloomfen level with every area (HUD integration check).
// Keys (sandbox only): 1/2/3 tonic (6 s) · 4 end tonic · H hurt · G heal · X splat (die)
//   C small combo · V big combo · F glowcap · U glowworm freed · B boss start · N boss hit
//   M boss defeated · Z zone card · T toast · R results · L lock-on toggle · Y charge ring · ` panel
import * as THREE from 'three';
import { boot } from '../core/boot.js';
import { installAudio } from '../audio/audio.js';
import { installScore } from '../game/score.js';
import { installUI, wireMenuIntents } from '../ui/index.js';
import { buildLevel } from '../game/level/builder.js';
import { installMechanisms } from '../game/level/mechanisms.js';
import { installEnemies } from '../game/enemies/index.js';
import { installPickups } from '../game/pickups.js';

const params = new URLSearchParams(location.search);
// ?level=1: the real Gloomfen level with every area installed (integration check of the HUD)
const LEVEL_MODE = params.has('level');
const ctx = LEVEL_MODE
  ? boot({ startState: 'title', buildLevel, install: [installAudio, installScore, installUI, wireMenuIntents, installEnemies, installPickups, installMechanisms] })
  : boot({ startState: 'title', install: [installAudio, installScore, installUI, wireMenuIntents] });

if (!LEVEL_MODE) {
  // The arena has no glowcaps or cages: register some totals so the counters read "x / y".
  for (let i = 0; i < 48; i++) ctx.score.registerItem('glowcap', `dev-cap-${i}`);
  for (let i = 0; i < 8; i++) ctx.score.registerItem('cage', `dev-cage-${i}`);
  ctx.score.setTypePoints('dummy', 200);
}

const P = () => ctx.player;
const ev = ctx.events;
const _p = new THREE.Vector3();

/** A world point in front of Morel (relative to the camera). */
function aheadOfMorel(dist = 2.5, side = 0, up = 0.8) {
  const yaw = ctx.cameraRig ? ctx.cameraRig.yaw : P().yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  return _p.set(P().position.x + fx * dist + fz * side, P().position.y + up, P().position.z + fz * dist - fx * side).clone();
}

const boss = { max: 24, hp: 24, phase: 1 };
const ZONES = [['glade', 'Mossy Glade'], ['bog', 'Sunken Bog'], ['fort', 'Bandit Fort'], ['pit', "Gnarlbelly's Pit"]];
let zoneI = 0;
const TOASTS = [
  { text: 'Gliding: Hold Space in the air to open your leaf and float across the gap.', duration: 5, source: 'sign' },
  { text: 'Free at last! Follow the lanterns, little cap.', duration: 4, speaker: 'glowworm' },
  { text: 'That iron gate shrugs off spore puffs. Something heavier might do.', duration: 4 },
];
let toastI = 0;
let lockOn = false;

export const SAMPLE_STATS = {
  total: 48250, points: 48250, rank: 'Gold', rankRatio: 0.86, elapsed: 1003.4,
  glowcaps: 141, glowcapsTotal: 159, cagesFreed: 7, cagesTotal: 8,
  bestChain: 37, kills: 41, deaths: 3, maxPossible: 56200,
};

const fake = {
  hurt() {
    const p = P();
    if (!p.damage(1, aheadOfMorel(1, 0, 0))) {
      p.hp = Math.max(1, p.hp - 1);
      ev.emit('player:hurt', { amount: 1, hp: p.hp, maxHp: p.maxHp, position: p.position.clone() });
    }
  },
  heal(n = 1) { P().heal(n); },
  setHp(n) { P().hp = Math.max(0, Math.min(P().maxHp, n)); },
  die() { if (ctx.state !== 'playing') ctx.setState('playing'); P().die(); },
  combo(n = 6, base = 50, reason = 'glowcap') {
    for (let i = 0; i < n; i++) {
      const pos = aheadOfMorel(3 + (i % 3) * 0.8, ((i % 5) - 2) * 0.9, 0.6 + (i % 2) * 0.5);
      if (reason === 'glowcap') ev.emit('pickup:glowcap', { position: pos, points: base });
      else ev.emit('enemy:killed', { entity: null, type: 'grunt', position: pos, points: base });
    }
  },
  glowcap() { ev.emit('pickup:glowcap', { position: aheadOfMorel(2.2, 0.4, 0.9), points: 50 }); },
  glowworm() { ev.emit('cage:freed', { position: aheadOfMorel(3, -1, 1), points: 500, freed: ctx.score.cagesFreed + 1, total: ctx.score.cagesTotal }); },
  tonic(kind = 'anvil', duration = 6) { P().setTonic(kind, duration); },
  endTonic() { P().setTonic(null); },
  bossStart() {
    boss.hp = boss.max; boss.phase = 1;
    ev.emit('boss:start', { maxHp: boss.max, hp: boss.hp, phase: 1 });
    ev.emit('boss:phase', { phase: 1 });
    ctx.hud.showBossBar(true);
  },
  bossHit(n = 3) {
    boss.hp = Math.max(0, boss.hp - n);
    ev.emit('boss:hurt', { hp: boss.hp, maxHp: boss.max });
    const ph = boss.hp > 16 ? 1 : boss.hp > 8 ? 2 : 3;
    if (boss.hp > 0 && ph !== boss.phase) { boss.phase = ph; ev.emit('boss:phase', { phase: ph }); }
    if (boss.hp <= 0) fake.bossDefeat();
  },
  bossDefeat() { boss.hp = 0; ev.emit('boss:defeated', { position: aheadOfMorel(8) }); ctx.hud.showBossBar(false); },
  zone(id) {
    let z = ZONES.find((q) => q[0] === id);
    if (!z) { z = ZONES[zoneI % ZONES.length]; zoneI++; }
    ctx.hud.zoneCard(z[1], z[0], true); // force: show even if it is the current zone
    if (ctx.level) ctx.level.zone = z[0];
  },
  toast(i) {
    const t = TOASTS[(i ?? toastI++) % TOASTS.length];
    ev.emit('ui:message', t);
  },
  results(stats = SAMPLE_STATS) {
    ev.emit('level:complete', { stats });
    ctx.setState('results');
  },
  lock(on = !lockOn) {
    lockOn = on;
    ctx.input.setOverride(on ? { lock: true } : null);
  },
  charge(level = 0.6) { P().charge = level; },
};

// ---------------------------------------------------------------- keyboard shortcuts (sandbox only)
const KEYS = {
  Digit1: () => fake.tonic('anvil'), Digit2: () => fake.tonic('updraft'), Digit3: () => fake.tonic('seeker'), Digit4: () => fake.endTonic(),
  KeyH: () => fake.hurt(), KeyG: () => fake.heal(), KeyX: () => fake.die(),
  KeyC: () => fake.combo(6, 50, 'glowcap'), KeyV: () => fake.combo(12, 200, 'enemy'),
  KeyF: () => fake.glowcap(), KeyU: () => fake.glowworm(),
  KeyB: () => fake.bossStart(), KeyN: () => fake.bossHit(3), KeyM: () => fake.bossDefeat(),
  KeyZ: () => fake.zone(), KeyT: () => fake.toast(), KeyR: () => fake.results(),
  KeyL: () => fake.lock(), KeyY: () => fake.charge(fake._c = ((fake._c || 0) + 0.34) % 1.02),
  Backquote: () => togglePanel(),
};
window.addEventListener('keydown', (e) => {
  if (e.repeat || !KEYS[e.code]) return;
  if (ctx.state === 'title' && e.code !== 'Backquote') return;
  KEYS[e.code]();
});

// ---------------------------------------------------------------- dev panel (sandbox only)
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;left:calc(10px + env(safe-area-inset-left));bottom:calc(10px + env(safe-area-inset-bottom));z-index:50;font:700 12px/1.3 var(--font-ui);color:var(--cream);';
const tab = document.createElement('button');
tab.textContent = 'DEV';
tab.style.cssText = 'font:800 11px var(--font-ui);letter-spacing:.1em;color:var(--outline);background:var(--amber);border:2px solid var(--outline);border-radius:8px;padding:3px 8px;cursor:pointer;';
const grid = document.createElement('div');
grid.style.cssText = 'display:none;grid-template-columns:repeat(4,auto);gap:4px;margin-bottom:6px;padding:8px;border-radius:12px;background:color-mix(in srgb,var(--outline) 85%,transparent);border:1.5px solid color-mix(in srgb,var(--amber) 40%,transparent);';
const BTNS = [['Hurt H', 'KeyH'], ['Heal G', 'KeyG'], ['Splat X', 'KeyX'], ['Combo C', 'KeyC'], ['Big V', 'KeyV'], ['Cap F', 'KeyF'], ['Worm U', 'KeyU'], ['Anvil 1', 'Digit1'],
  ['Updraft 2', 'Digit2'], ['Seeker 3', 'Digit3'], ['Boss B', 'KeyB'], ['Hit N', 'KeyN'], ['Down M', 'KeyM'], ['Zone Z', 'KeyZ'], ['Toast T', 'KeyT'], ['Results R', 'KeyR'], ['Lock L', 'KeyL'], ['Charge Y', 'KeyY']];
for (const [label, code] of BTNS) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font:700 11px var(--font-ui);color:var(--cream);background:color-mix(in srgb,var(--cream) 10%,transparent);border:1px solid color-mix(in srgb,var(--cream) 25%,transparent);border-radius:7px;padding:4px 6px;cursor:pointer;';
  b.addEventListener('click', (e) => { e.stopPropagation(); if (ctx.state !== 'title') KEYS[code](); });
  grid.append(b);
}
panel.append(grid, tab);
function togglePanel(on) {
  const show = on ?? grid.style.display === 'none';
  grid.style.display = show ? 'grid' : 'none';
}
tab.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
if (params.get('dev') !== '0') document.body.append(panel);

window.__ui = {
  ctx, fake, SAMPLE_STATS, levelMode: LEVEL_MODE,
  get hud() { return ctx.hud; },
  get menus() { return ctx.menus; },
  get touch() { return ctx.ui.touch; },
  devPanel(on) { panel.style.display = on ? '' : 'none'; },
};
