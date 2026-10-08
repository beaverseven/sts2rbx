// boot(options) — the single entry point used by main.js and every area sandbox.
//   boot({ install: [installAudio, installUI, ...], buildLevel: buildLevel, startState: 'title' })
// Creates ctx and every core system, runs area installers in order, builds the
// level, starts the fixed-step loop and installs window.__game (debug API).
import { createContext, FIXED_DT, createLevelStub } from './context.js';
import { createMaterials } from './materials.js';
import { createRenderer } from './renderer.js';
import { createInput } from './input.js';
import { createPhysics } from './physics.js';
import { createEntities } from './entities.js';
import { createParticles } from './particles.js';
import { createProjectiles } from '../game/projectiles.js';
import { createPlayer, TUNING } from '../game/player.js';
import { createCameraRig } from '../game/camera.js';
import { buildTestArena, registerDummyType } from './testArena.js';

const MAX_STEPS_PER_FRAME = 5;

/**
 * @param {object} options
 * @param {Array<(ctx)=>void>} [options.install]  area installers, run in order after core systems exist
 * @param {(ctx)=>object} [options.buildLevel]    builds the level, returns the level object (default: test arena)
 * @param {'playing'|'title'} [options.startState='playing']
 * @param {HTMLElement} [options.container]       defaults to #app (or body)
 * @param {object} [options.settings]             initial ctx.settings overrides
 * @returns ctx
 */
export function boot(options = {}) {
  const container = options.container || document.getElementById('app') || document.body;
  const params = new URLSearchParams(location.search);
  const ctx = createContext();
  if (options.settings) Object.assign(ctx.settings, options.settings);
  if (params.get('quality')) ctx.settings.quality = params.get('quality');

  // --- core systems
  ctx.materials = createMaterials();
  const gfx = createRenderer(ctx, container);
  ctx.gfx = gfx;
  ctx.renderer = gfx.renderer;
  ctx.scene = gfx.scene;
  ctx.camera = gfx.camera;
  ctx.setQuality = (q) => gfx.setQuality(q);
  ctx.input = createInput(ctx);
  ctx.input.attach(ctx.renderer.domElement);
  ctx.physics = createPhysics(ctx);
  ctx.entities = createEntities(ctx);
  ctx.particles = createParticles(ctx);
  ctx.projectiles = createProjectiles(ctx);
  registerDummyType(ctx);
  ctx.player = createPlayer(ctx);
  ctx.cameraRig = createCameraRig(ctx);
  const { input, entities, player, projectiles, particles, cameraRig } = ctx;

  // --- areas
  for (const fn of options.install || []) fn(ctx);

  // --- level
  const buildLevel = options.buildLevel || buildTestArena;
  const level = buildLevel(ctx) || createLevelStub();
  const stub = createLevelStub();
  for (const k of Object.keys(stub)) if (!(k in level)) level[k] = stub[k];
  ctx.level = level;
  entities.flush();

  const spawn = level.spawn || stub.spawn;
  const firstCp = (level.checkpoints && level.checkpoints[0]) || null;
  player.setCheckpoint(firstCp ? firstCp.id : 'start', firstCp ? firstCp.position : spawn.position, firstCp ? firstCp.yaw ?? 0 : spawn.yaw ?? 0);
  player.respawnAt(spawn.position, spawn.yaw ?? 0);
  cameraRig.snapBehind();

  // --- state machine glue
  let wasLocked = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = input.pointerLocked;
    if (!locked && wasLocked && ctx.state === 'playing') {
      ctx.setState('paused');
      input.cancel('pause'); // the Esc that released the lock must not immediately resume
    }
    wasLocked = locked;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ctx.state === 'playing') ctx.setState('paused');
  });
  const unlock = () => { try { ctx.audio.unlock(); } catch (e) { console.error(e); } };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });

  // --- loop
  let manual = false;
  let acc = 0;
  let last = performance.now();

  function fixedStep() {
    const dt = FIXED_DT;
    input.update(dt);
    if (ctx.state === 'playing' && input.pressed('pause')) {
      ctx.setState('paused');
      input.endFrame();
      return;
    }
    ctx.time.now += dt;
    ctx.time.frame++;
    entities.update(dt);
    if (level.update) level.update(dt, ctx);
    player.update(dt);
    projectiles.update(dt);
    const sys = ctx.systems;
    for (let i = 0; i < sys.length; i++) if (sys[i].update) sys[i].update(dt, ctx);
    particles.update(dt);
    cameraRig.update(dt);
    entities.flush();
    input.endFrame();
  }

  function menuTick(realDt) {
    input.update(realDt);
    if (ctx.state === 'paused' && input.pressed('pause')) ctx.setState('playing');
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    ctx.time.real += realDt;
    let menu = false;
    if (ctx.simulating) {
      if (!manual) {
        acc += realDt;
        let steps = 0;
        while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) { fixedStep(); acc -= FIXED_DT; steps++; }
        if (steps >= MAX_STEPS_PER_FRAME) acc = 0; // too slow: drop time instead of spiralling
      }
    } else {
      acc = 0;
      menuTick(realDt);
      menu = true;
    }
    const sys = ctx.systems;
    for (let i = 0; i < sys.length; i++) if (sys[i].frame) sys[i].frame(realDt, ctx);
    if (level.frame) level.frame(realDt, ctx);
    cameraRig.frame(realDt);
    gfx.frame(realDt);
    if (menu) input.endFrame();
    gfx.render();
  }

  // ?state=title|playing overrides the start state (handy for UI/menu sandboxes)
  const urlState = params.get('state');
  ctx.setState(urlState === 'title' || urlState === 'playing' ? urlState : options.startState || 'playing');
  requestAnimationFrame((t) => { last = t; frame(t); });

  installDebugApi(ctx, {
    step(n) { manual = true; for (let i = 0; i < n; i++) fixedStep(); },
    realtime(on) { manual = !on; acc = 0; last = performance.now(); },
    render() { ctx.scene.updateMatrixWorld(); gfx.frame(0); gfx.render(); },
  });
  return ctx;
}

// ---------------------------------------------------------------------------
// window.__game — debug API for automated playtests
function installDebugApi(ctx, loop) {
  const { player, entities, input, events } = ctx;
  const log = [];
  const LOG_MAX = 400;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const summarise = (val, depth = 0) => {
    if (val === null || val === undefined) return val ?? null;
    if (typeof val === 'number') return r3(val);
    if (typeof val !== 'object') return val;
    if (val.isVector3) return [r3(val.x), r3(val.y), r3(val.z)];
    if (val === ctx.player) return 'player';
    if (val.object3d && val.tags) return val.type || 'entity';
    if (val.min && val.max && val.min.isVector3) return `collider:${val.tag ?? val.id}`;
    if (Array.isArray(val)) return depth > 1 ? '[array]' : val.slice(0, 8).map((x) => summarise(x, depth + 1));
    if (depth > 1) return '[object]';
    const out = {};
    for (const k of Object.keys(val)) out[k] = summarise(val[k], depth + 1);
    return out;
  };
  events.on('*', (payload, name) => {
    log.push({ t: r3(ctx.time.now), frame: ctx.time.frame, name, payload: summarise(payload) });
    if (log.length > LOG_MAX) log.shift();
  });

  const checkpoints = () => {
    const out = [];
    const seen = new Set();
    for (const cp of ctx.level.checkpoints || []) {
      const p = cp.position;
      out.push({ id: cp.id, position: Array.isArray(p) ? p.slice() : [p.x, p.y, p.z], yaw: cp.yaw ?? 0 });
      seen.add(cp.id);
    }
    const ents = entities.query('checkpoint').slice().sort((a, b) => a.position.z - b.position.z);
    for (const e of ents) {
      const id = e.checkpointId ?? e.def?.id ?? e.id;
      if (seen.has(id)) continue;
      out.push({ id, position: [e.position.x, e.position.y, e.position.z], yaw: e.yaw ?? e.object3d.rotation.y ?? 0 });
    }
    return out;
  };

  const api = {
    ctx,
    TUNING,
    get player() { return ctx.player; },
    /** Skip the title: go to 'playing'. */
    start() {
      try { ctx.audio.unlock(); } catch { /* stub */ }
      if (ctx.state !== 'playing') ctx.setState('playing');
      return ctx.state;
    },
    /** Run n fixed updates synchronously (switches the loop to manual stepping; see realtime()). */
    step(n = 1) { loop.step(Math.max(0, n | 0)); return api.state(); },
    /** Resume (true) or stop (false) real-time simulation. step() turns it off. */
    realtime(on = true) { loop.realtime(on); },
    /** Force a render now (manual mode keeps rendering every animation frame anyway). */
    render() { loop.render(); },
    teleport(x, y, z, yaw) {
      if (Array.isArray(x)) [x, y, z] = x;
      player.teleport([x, y, z], yaw);
      return api.state().player;
    },
    checkpoints,
    gotoCheckpoint(id) {
      const cp = checkpoints().find((c) => c.id === id);
      if (!cp) return false;
      player.setCheckpoint(cp.id, cp.position, cp.yaw);
      player.respawnAt(cp.position, cp.yaw);
      return true;
    },
    state() {
      const p = player.position, v = player.velocity;
      const s = ctx.score || {};
      return {
        state: ctx.state,
        time: r3(ctx.time.now),
        frame: ctx.time.frame,
        player: {
          pos: [r3(p.x), r3(p.y), r3(p.z)], vel: [r3(v.x), r3(v.y), r3(v.z)], yaw: r3(player.yaw),
          hp: player.hp, maxHp: player.maxHp, state: player.state, onGround: player.onGround,
          tonic: player.tonic ? { kind: player.tonic.kind, remaining: r3(player.tonic.remaining) } : null,
          lock: player.lockTarget ? (player.lockTarget.type || 'entity') : null, invulnerable: player.invulnerable,
          checkpoint: player.checkpoint.id,
        },
        score: s.points ?? s.score ?? s.total ?? 0,
        combo: { chain: s.chain ?? 0, multiplier: s.multiplier ?? 1, timeLeft: s.timeLeft ?? 0 },
        zone: ctx.level ? (ctx.level.zone ?? null) : null,
        flags: { ...ctx.flags },
        entities: entities.countByTag(),
        projectiles: ctx.projectiles.active.length,
        quality: ctx.gfx.quality,
      };
    },
    give(kind) { player.setTonic(kind, TUNING.tonicDuration); return player.tonic; },
    godMode(on = true) { player.god = on; return player.god; },
    setInput(o) { input.setOverride(o || null); },
    // --- extensions
    setQuality(q) { ctx.gfx.setQuality(q); return ctx.gfx.quality; },
    setCamera(yaw, pitch, distance) { ctx.cameraRig.setView(yaw, pitch, distance); },
    spawn(def) { const e = entities.spawn(def); entities.flush(); return e ? (e.type || true) : null; },
    events(filter) {
      if (!filter) return log.slice();
      return log.filter((e) => (typeof filter === 'string' ? e.name.startsWith(filter) : filter(e)));
    },
    clearEvents() { log.length = 0; },
  };
  window.__game = api;
  return api;
}
