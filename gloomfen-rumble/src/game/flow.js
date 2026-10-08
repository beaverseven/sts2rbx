// Game flow (integration): the state machine around core's states, the menu intents,
// new runs, the results screen, the level's score maximum and the hot-reload snapshot.
//
//   boot ──► title ──menu:start──► playing ◄──────────────────────────────┐
//              ▲                     │  ▲ Esc/P/Start, tab hidden,         │
//              │                     │  │ pointer-lock loss (core)         │
//              │                     ▼  │ menu:resume / Esc / P            │
//              ├──menu:quitTitle─── paused ──menu:restartCheckpoint────────┤
//              │                     │                                     │
//              │        player dies: playing ─► dead (splat, 1.6 s) ─► playing (core)
//              │                     │
//              │   level:complete (+1.2 s of simulation) ─► results ──menu:playAgain──┘
//              └────────────────────────────────────────── results (menu:quitTitle)
//
// Every change goes through ctx.setState(), which emits game:state {state, prev}.
// Quit to title prepares a fresh run behind the title (the title camera then orbits
// Morel at the start area); Play again starts a fresh run directly.
//
//   import { installFlow } from './game/flow.js';
//   boot({ install: [..., installFlow] });   then ctx.flow.levelReady() once boot() returned.
//
// ctx.flow = { newRun(), restartCheckpoint(), levelBase(), snapshot(), restore(data), runs }
// Extra event: run:reset {} — emitted by newRun() after the world was rebuilt (audio resets
// its boss/victory music flags on it).

const RESULTS_DELAY = 1.2;   // s of simulation between walking into the Lantern Gate and the results screen
const ENEMY_TYPES = ['grunt', 'slinger', 'ironbelly'];

export function installFlow(ctx) {
  const ev = ctx.events;
  let completeT = -1;        // >= 0 while counting down to the results screen

  const flow = {
    runs: 0,                 // runs started from the title / play again

    /** Base points of everything the level offers (before the combo factor). See score.setLevelBase. */
    levelBase() { return computeLevelBase(ctx); },

    /** Call once boot() has built the level: pins the score's maximum to the whole level. */
    levelReady() {
      const s = ctx.score;
      if (s && typeof s.setLevelBase === 'function' && ctx.level && !ctx.level.isStub) s.setLevelBase(flow.levelBase());
    },

    /**
     * Fresh run: mechanisms reset, every entity cleared (level spawns, arena waves, boss minions,
     * the boss's tonic jar) and re-spawned, flags cleared, score reset, Morel back at the start
     * with full hearts and no tonic.
     */
    newRun() {
      const { level, entities, player } = ctx;
      completeT = -1;
      const spawned = level.spawned || [];
      for (const e of spawned) if (e.reset) { try { e.reset(); } catch (err) { console.error(err); } }
      entities.clear();
      spawned.length = 0;
      if (ctx.projectiles && ctx.projectiles.clear) ctx.projectiles.clear();
      if (ctx.enemies && ctx.enemies.fx && ctx.enemies.fx.clearAll) ctx.enemies.fx.clearAll();
      for (const k of Object.keys(ctx.flags)) delete ctx.flags[k];
      if (level.zones && level.zones.length) level.zone = level.zones[0].id;
      if (typeof level.spawnAll === 'function') level.spawnAll();
      else if (typeof level.reset === 'function') level.reset();
      entities.flush();
      if (ctx.score && ctx.score.reset) ctx.score.reset();
      const sp = level.spawn || { position: [0, 2, 0], yaw: 0 };
      const cp = level.checkpoints && level.checkpoints[0];
      player.setCheckpoint(cp ? cp.id : 'start', cp ? cp.position : sp.position, cp ? cp.yaw ?? 0 : sp.yaw ?? 0);
      if (player.tonic) player.setTonic(null);
      player.heal(player.maxHp);
      player.respawnAt(sp.position, sp.yaw ?? 0);
      if (ctx.hud && ctx.hud.resetRun) ctx.hud.resetRun();
      if (ctx.hud && ctx.hud.clearToasts) ctx.hud.clearToasts();
      ev.emit('run:reset', {});
    },

    /** Pause menu "Restart from checkpoint": full hearts, back at the checkpoint. */
    restartCheckpoint() {
      const p = ctx.player;
      const cp = p.checkpoint;
      p.heal(p.maxHp);
      p.respawnAt(cp.position, cp.yaw);
      // a checkpoint respawn: the boss fight, the ambush and the pit gate reset on it (as after a death)
      ev.emit('player:respawn', { position: p.position.clone(), checkpointId: cp.id });
    },

    /** JSON-safe state for the artifact viewer's hot reload. */
    snapshot() {
      const s = ctx.settings, g = ctx.gfx;
      const inRun = ctx.state === 'playing' || ctx.state === 'paused' || ctx.state === 'dead';
      return {
        v: 1,
        state: ctx.state,
        checkpointId: inRun ? ctx.player.checkpoint.id : null,
        score: ctx.score && ctx.score.snapshot ? ctx.score.snapshot() : null,
        settings: {
          master: s.master, music: s.music, sfx: s.sfx, sensitivity: s.sensitivity, invertY: !!s.invertY,
          quality: g && !g.autoQuality ? g.quality : null,
        },
      };
    },

    /**
     * Resume from a snapshot: settings always; with a checkpoint, the score and Morel at that
     * checkpoint, paused (the pause menu's Resume continues). Returns true if a run was resumed.
     */
    restore(data) {
      if (!data || typeof data !== 'object') return false;
      applySettings(ctx, data.settings);
      const id = typeof data.checkpointId === 'string' ? data.checkpointId : null;
      const cps = (ctx.level && ctx.level.checkpoints) || [];
      const cp = id ? cps.find((c) => c.id === id) : null;
      if (!cp) return false;
      if (ctx.score && ctx.score.restore && data.score) ctx.score.restore(data.score);
      const p = ctx.player;
      p.setCheckpoint(cp.id, cp.position, cp.yaw ?? 0);
      p.respawnAt(cp.position, cp.yaw ?? 0);
      if (ctx.pickups && ctx.pickups.lightCheckpoint) ctx.pickups.lightCheckpoint(cp.id, true);
      const z = (ctx.level.zones || []).find((zz) => cp.position[2] >= zz.bounds.min[2] && cp.position[2] < zz.bounds.max[2]);
      if (z) ctx.level.zone = z.id;   // music and the pause panel read it until the zone trigger fires
      flow.runs = 1;
      ctx.setState('paused');
      return true;
    },
  };
  ctx.flow = flow;

  // --- menu intents (the menus only emit these; see src/ui/menus.js)
  ev.on('menu:start', () => {
    try { ctx.audio.unlock(); } catch (e) { console.error(e); }
    if (ctx.state !== 'title') return;
    flow.runs++;
    if (ctx.cameraRig && ctx.cameraRig.snapBehind) ctx.cameraRig.snapBehind();   // cut from the orbit to the chase view
    ctx.setState('playing');
  });
  ev.on('menu:resume', () => { if (ctx.state === 'paused') ctx.setState('playing'); });
  ev.on('menu:restartCheckpoint', () => {
    if (ctx.state !== 'paused') return;
    flow.restartCheckpoint();
    ctx.setState('playing');
  });
  ev.on('menu:quitTitle', () => {
    if (ctx.state === 'title') return;
    flow.newRun();            // the title shows the start area, ready for the next run
    ctx.setState('title');
  });
  ev.on('menu:playAgain', () => {
    if (ctx.state !== 'results') return;
    flow.newRun();
    flow.runs++;
    ctx.setState('playing');
  });

  // --- Lantern Gate -> results (counted in simulation time, so it pauses with the game)
  ev.on('level:complete', () => { if (completeT < 0) completeT = 0; });
  ctx.addSystem({
    order: 900,
    update(dt) {
      if (completeT < 0) return;
      completeT += dt;
      if (completeT >= RESULTS_DELAY && ctx.state === 'playing') {
        completeT = -1;
        ctx.setState('results');
      }
    },
  });
  return flow;
}

/** Base points of the whole level: registered glowcaps and cages, every enemy in the level data
 *  (arena waves included; boss minions are a variable bonus and left out) and the boss fight. */
export function computeLevelBase(ctx) {
  const s = ctx.score;
  const P = (s && s.POINTS) || {};
  let base = (s ? s.glowcapsTotal * (P.glowcap || 0) + s.cagesTotal * (P.cage || 0) : 0);
  const walk = (defs) => {
    for (const d of defs) {
      if (!d || typeof d !== 'object') continue;
      if (ENEMY_TYPES.includes(d.type)) base += typeof d.points === 'number' ? d.points : P[d.type] || 0;
      else if (d.type === 'boss') base += 2 * (P.bossPhase || 0) + (P.boss || 0);
      if (Array.isArray(d.waves)) for (const w of d.waves) walk(w);
    }
  };
  const data = ctx.level && ctx.level.data;
  walk((data && data.SPAWNS) || []);
  return base;
}

const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

function applySettings(ctx, s) {
  if (!s || typeof s !== 'object') return;
  const out = {};
  for (const [k, lo, hi] of [['master', 0, 1], ['music', 0, 1], ['sfx', 0, 1], ['sensitivity', 0.3, 2]]) {
    const v = num(s[k], lo, hi);
    if (v !== undefined) { ctx.settings[k] = v; out[k] = v; }
  }
  if (typeof s.invertY === 'boolean') ctx.settings.invertY = s.invertY;
  try { if (ctx.audio && ctx.audio.setVolumes) ctx.audio.setVolumes({ master: ctx.settings.master, music: ctx.settings.music, sfx: ctx.settings.sfx }); } catch (e) { console.error(e); }
  if (s.quality === 'high' || s.quality === 'medium' || s.quality === 'low') {
    ctx.settings.quality = s.quality;
    if (ctx.setQuality) ctx.setQuality(s.quality);
  }
  void out;
}
