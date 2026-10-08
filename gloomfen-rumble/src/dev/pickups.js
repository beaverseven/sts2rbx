// Pickups + score sandbox: the core test arena with every pickup type spread around it and a
// small dev-only HUD (score, combo bar, floating "+50 x2" text, toasts, results card).
//   node tools/build.mjs --entry src/dev/pickups.js --out dist/dev-pickups --dev
// Keys: 1/2/3 drink a tonic · H hurt Morel · B emit boss:defeated (raises the Lantern Gate)
//       G god mode · R reset the score · F spawn a field of 150 glowcaps (perf)
// ?level=1 boots the real Gloomfen level (level + enemies + mechanisms) instead of the arena,
// to check the pickups in their real placements (N / P jump to the next / previous checkpoint).
import * as THREE from 'three';
import { boot } from '../core/boot.js';
import { installScore } from '../game/score.js';
import { installPickups } from '../game/pickups.js';
import { buildTestArena } from '../core/testArena.js';
import { buildLevel as buildGloomfen } from '../game/level/builder.js';
import { installMechanisms } from '../game/level/mechanisms.js';
import { installEnemies } from '../game/enemies/index.js';

const GROUND = 1; // test arena pad height

/** Sandbox-only prop: a crooked wooden crane to hang a cage from. */
function buildGallows(ctx, x, z) {
  const M = ctx.materials;
  const mat = M.toon(M.palette.bark);
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.0, 7), mat);
  post.position.set(1.7, 2.5, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.18), mat);
  arm.position.set(0.75, 4.8, 0);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), mat);
  brace.position.set(1.3, 4.35, 0);
  brace.rotation.z = 0.75;
  g.add(post, arm, brace);
  for (const m of [post, arm, brace]) { m.castShadow = true; M.outline(m, 0.02); }
  g.position.set(x, GROUND, z);
  ctx.scene.add(g);
  ctx.physics.addBox({ min: [x + 1.55, GROUND, z - 0.16], max: [x + 1.85, GROUND + 5, z + 0.16], surface: 'wood', tag: 'gallows' });
}

function buildLevel(ctx) {
  // the core arena, then our spread of pickups
  const level = buildTestArena(ctx);
  const S = (def) => ctx.entities.spawn(def);
  S({ type: 'glowcapLine', pos: [0, null, 3], from: [0, null, 3], to: [0, null, 14], count: 8 });
  S({ type: 'glowcapRing', pos: [8, GROUND + 1.6, 15], radius: 2, count: 8 });
  S({ type: 'glowcapLine', pos: [-3, GROUND + 1.2, 19], from: [-3, GROUND + 1.2, 19], to: [-3, GROUND + 3.2, 27], count: 5 });
  S({ type: 'glowcap', pos: [5, null, 3] });
  S({ type: 'berry', pos: [3.5, null, 4.5] });
  S({ type: 'berry', pos: [5.2, null, 1.2] });
  S({ type: 'tonic', kind: 'anvil', respawn: true, pos: [-4, null, 5] });
  S({ type: 'tonic', kind: 'updraft', respawn: true, pos: [-6.5, null, 5] });
  S({ type: 'tonic', kind: 'seeker', respawn: true, pos: [-9, null, 5] });
  S({ type: 'cage', pos: [-6, null, 11], yaw: 0.3 });
  buildGallows(ctx, 14, 16);
  S({ type: 'cage', pos: [14, GROUND + 1.6, 16], hanging: true, rope: 1.66, yaw: -0.4 });
  S({ type: 'checkpoint', id: 'sandA', pos: [6, null, -3], yaw: 0 });
  S({ type: 'checkpoint', id: 'sandB', pos: [-12, null, 14], yaw: Math.PI / 2 });
  S({ type: 'lanternGate', pos: [16, null, 34], yaw: 0 });
  return level;
}

const LEVEL_MODE = new URLSearchParams(location.search).has('level');
const ctx = LEVEL_MODE
  ? boot({ startState: 'playing', buildLevel: buildGloomfen, install: [installScore, installEnemies, installPickups, installMechanisms] })
  : boot({ startState: 'playing', buildLevel, install: [installScore, installPickups] });
ctx.score.setTypePoints('dummy', 100); // sandbox only: straw dummies count as 100-point kills for combo testing

// ------------------------------------------------------------------------------------------
// Dev HUD (sandbox only; the real HUD belongs to the UI area)
// ------------------------------------------------------------------------------------------
const css = (el, s) => { el.style.cssText = s; return el; };
const panelCss = 'position:fixed;pointer-events:none;color:#f3e6c8;font:13px/1.4 system-ui,sans-serif;background:rgba(26,21,48,.62);border-radius:10px;padding:8px 12px;';
const hud = css(document.createElement('div'), panelCss + 'left:12px;top:10px;min-width:190px');
const legend = css(document.createElement('div'), panelCss + 'left:12px;bottom:10px;font-size:12px;white-space:nowrap;padding:6px 10px');
legend.textContent = 'WASD move · Space jump/glide · J throw · K lock · 1/2/3 tonic · H hurt · B boss defeated · G god · R reset score · F 150 glowcaps';
const toast = css(document.createElement('div'), panelCss + 'left:50%;bottom:54px;transform:translateX(-50%);font-size:16px;display:none;text-align:center');
const results = css(document.createElement('div'), panelCss + 'left:50%;top:50%;transform:translate(-50%,-50%);font-size:15px;display:none;text-align:center;padding:18px 28px;min-width:260px;background:rgba(26,21,48,.85);border:2px solid #ffc35a');
const floatLayer = css(document.createElement('div'), 'position:fixed;inset:0;pointer-events:none;overflow:hidden');
document.body.append(floatLayer, hud, legend, toast, results);

hud.innerHTML = `
  <div style="font:700 22px Georgia,serif;color:#ffe9b8" id="dv-score">0</div>
  <div id="dv-combo" style="height:22px;color:#5ef2e0;font-weight:700"></div>
  <div style="height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden;margin:2px 0 6px"><div id="dv-bar" style="height:100%;width:0;background:linear-gradient(90deg,#5ef2e0,#ffc35a)"></div></div>
  <div id="dv-hearts" style="color:#ff6f8f;font-size:16px;letter-spacing:2px"></div>
  <div id="dv-stats" style="font-size:12px;opacity:.9"></div>`;
const $ = (id) => document.getElementById(id);

const floats = [];
for (let i = 0; i < 18; i++) {
  const d = css(document.createElement('div'), 'position:absolute;left:0;top:0;font:800 18px system-ui,sans-serif;color:#fff;text-shadow:0 2px 0 #1a1530,0 0 8px rgba(94,242,224,.8);white-space:nowrap;display:none;will-change:transform');
  floatLayer.appendChild(d);
  floats.push({ el: d, t: -1, pos: new THREE.Vector3() });
}
let floatNext = 0;
ctx.events.on('score:award', (a) => {
  const f = floats[floatNext++ % floats.length];
  f.t = 0;
  if (a.position) f.pos.copy(a.position); else f.pos.copy(ctx.player.position).setY(ctx.player.position.y + 1.4);
  f.el.textContent = `+${a.points}${a.multiplier > 1 ? `  ×${a.multiplier}` : ''}`;
  f.el.style.color = a.multiplier >= 3 ? '#ffc35a' : a.multiplier >= 2 ? '#9ffff0' : '#ffffff';
  f.el.style.display = 'block';
});
let toastT = 0;
ctx.events.on('ui:message', ({ text, duration }) => { toast.textContent = text; toast.style.display = 'block'; toastT = duration ?? 3; });
ctx.events.on('checkpoint:reached', ({ id }) => { toast.textContent = `Checkpoint lantern lit (${id})`; toast.style.display = 'block'; toastT = 2; });
ctx.events.on('level:complete', ({ stats }) => {
  const s = stats;
  const mm = Math.floor(s.elapsed / 60), ss = Math.floor(s.elapsed % 60).toString().padStart(2, '0');
  results.innerHTML = `<div style="font:700 15px Georgia,serif;letter-spacing:.1em;color:#ffc35a">LEVEL COMPLETE</div>
    <div style="font:700 40px Georgia,serif;color:#ffe9b8;margin:4px 0">${s.rank}</div>
    <div style="font-size:22px;font-weight:700">${s.total.toLocaleString()}</div>
    <div style="opacity:.85;margin-top:6px;font-size:13px">time ${mm}:${ss} · glowcaps ${s.glowcaps}/${s.glowcapsTotal} · glowworms ${s.cagesFreed}/${s.cagesTotal}<br>best chain ${s.bestChain} · kills ${s.kills} · deaths ${s.deaths} · max ≈ ${s.maxPossible.toLocaleString()}</div>`;
  results.style.display = 'block';
});

const _p = new THREE.Vector3();
let calls = 0;
ctx.renderer.info.autoReset = false;
ctx.addSystem({
  frame(dt) {
    const ri = ctx.renderer.info;
    calls = ri.render.calls; ri.reset();
    const sc = ctx.score, pl = ctx.player;
    $('dv-score').textContent = sc.points.toLocaleString();
    $('dv-combo').textContent = sc.chain > 0 ? `chain ${sc.chain}   ×${sc.multiplier}` : '';
    $('dv-bar').style.width = `${(sc.timeLeft / sc.timeMax) * 100}%`;
    $('dv-hearts').textContent = '♥'.repeat(Math.max(0, pl.hp)) + '♡'.repeat(Math.max(0, pl.maxHp - pl.hp));
    const tonic = pl.tonic ? ` · ${pl.tonic.kind} ${pl.tonic.remaining.toFixed(1)}s` : '';
    $('dv-stats').innerHTML = `glowcaps ${sc.glowcaps}/${sc.glowcapsTotal} · cages ${sc.cagesFreed}/${sc.cagesTotal}<br>time ${sc.elapsed.toFixed(1)}s · best ${sc.bestChain}${tonic}<br>calls ${calls} · cp ${pl.checkpoint.id}`;
    if (toastT > 0 && (toastT -= dt) <= 0) toast.style.display = 'none';
    const w = window.innerWidth, h = window.innerHeight;
    for (const f of floats) {
      if (f.t < 0) continue;
      f.t += dt;
      if (f.t > 1.1) { f.t = -1; f.el.style.display = 'none'; continue; }
      _p.copy(f.pos); _p.y += 0.5 + f.t * 0.9;
      _p.project(ctx.camera);
      if (_p.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = 'block';
      const sc2 = f.t < 0.12 ? 0.6 + f.t * 4 : 1;
      f.el.style.transform = `translate(${((_p.x + 1) / 2) * w}px, ${((1 - _p.y) / 2) * h}px) translate(-50%,-50%) scale(${sc2})`;
      f.el.style.opacity = String(Math.min(1, (1.1 - f.t) / 0.35));
    }
  },
});

window.addEventListener('keydown', (e) => {
  const kind = { Digit1: 'anvil', Digit2: 'updraft', Digit3: 'seeker' }[e.code];
  if (kind) ctx.player.setTonic(kind);
  if (e.code === 'KeyH') { const inv = ctx.player.god; ctx.player.god = false; ctx.player.damage(1, ctx.player.position.clone().add(new THREE.Vector3(0, 0, 1))); ctx.player.god = inv; }
  if (e.code === 'KeyB') ctx.events.emit('boss:defeated', { position: new THREE.Vector3(16, 1, 30) });
  if (e.code === 'KeyG') ctx.player.god = !ctx.player.god;
  if (e.code === 'KeyR') ctx.score.reset();
  if (e.code === 'KeyF') spawnField(ctx, 150);
  if (LEVEL_MODE && (e.code === 'KeyN' || e.code === 'KeyP')) {
    const ids = window.__game.checkpoints().map((c) => c.id);
    cpIndex = (cpIndex + (e.code === 'KeyN' ? 1 : ids.length - 1)) % ids.length;
    window.__game.gotoCheckpoint(ids[cpIndex]);
  }
});
let cpIndex = 0;

/** 150 glowcaps on the open meadow behind the spawn (perf check). */
function spawnField(c, n) {
  let k = 0;
  for (let ring = 0; k < n; ring++) {
    const count = Math.min(n - k, 10);
    c.entities.spawn({ type: 'glowcapRing', pos: [-8 + (ring % 5) * 6, null, -14 - Math.floor(ring / 5) * 6], radius: 2.2, count });
    k += count;
  }
  c.entities.flush();
}
window.__pickupsDev = { levelMode: LEVEL_MODE, spawnField: (n = 150) => spawnField(ctx, n), get calls() { return calls; } };
