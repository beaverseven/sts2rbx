// Shared helpers for the integration scenarios (tools/scenarios/integ-*.mjs), run against the
// shipped build:  node tools/scenario.mjs tools/scenarios/integ-<x>.mjs --html dist/index.html --shots dist/integ/shots
//
// installIntegHelpers(page) adds (on top of window.__lv from level-helpers and window.__et from
// enemies-helpers):
//   window.__it.count(name)          events of that name since install (not capped like __game.events)
//   window.__it.kills                enemy:killed counts by type since install
//   window.__it.drawCalls()          { calls, tris } of one full frame (shadow + main + bloom passes)
//   window.__it.fight(pred, opts)    lock on + real throws until pred() (or maxSteps); returns a log
//   window.__it.standNear(e, d, side) put Morel d m from entity e (on the given side), facing it
//   window.__it.snap()               small JSON summary of the game (state, player, score, track, zone)
// watchConsole(page) collects console warnings + errors (the runner itself only keeps errors).
import { installLevelHelpers } from './level-helpers.mjs';
import { installEnemyHelpers } from './enemies-helpers.mjs';

export function watchConsole(page) {
  const out = [];
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') out.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => out.push(`[pageerror] ${e.message}`));
  return out;
}

/**
 * Screenshot after letting a few frames render. Headless SwiftShader draws ~2 fps, so CSS transitions
 * (menu fades, the splat curtain) lag far behind the game state: finite CSS animations/transitions are
 * finished first so the shot shows the UI as a player would see it a moment later.
 */
export async function settledShot(page, h, name, ms = 700) {
  await h.wait(ms);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (t && Number.isFinite(t.endTime)) { try { a.finish(); } catch { /* ignore */ } }
    }
  });
  await h.wait(250);
  return h.shot(name);
}

export async function waitForGame(page, state = null, timeout = 90000) {
  await page.waitForFunction((s) => window.__game && window.__game.ctx && (!s || window.__game.ctx.state === s), state, { timeout });
}

export async function installIntegHelpers(page) {
  await installLevelHelpers(page);
  await installEnemyHelpers(page);
  await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx;
    const counts = {}, kills = {};
    ctx.events.on('*', (p, n) => {
      counts[n] = (counts[n] || 0) + 1;
      if (n === 'enemy:killed' && p) kills[p.type] = (kills[p.type] || 0) + 1;
    });
    const r2 = (v) => Math.round(v * 100) / 100;
    const it = {
      counts, kills,
      count: (n) => counts[n] || 0,
      drawCalls() {
        ctx.scene.updateMatrixWorld();
        const ri = ctx.renderer.info;
        const was = ri.autoReset;
        ri.autoReset = false; ri.reset();
        ctx.gfx.render();
        const out = { calls: ri.render.calls, tris: ri.render.triangles };
        ri.autoReset = was;
        return out;
      },
      snap() {
        const p = ctx.player.position;
        return {
          state: ctx.state, pos: [r2(p.x), r2(p.y), r2(p.z)], hp: ctx.player.hp, pstate: ctx.player.state,
          checkpoint: ctx.player.checkpoint.id, score: ctx.score.points, zone: ctx.level.zone,
          track: ctx.audio.track ?? null, tonic: ctx.player.tonic ? ctx.player.tonic.kind : null,
        };
      },
      /** Put Morel d m from entity e, on the side `side` (radians around e, 0 = -Z of it), facing it. */
      standNear(e, d = 7, side = Math.PI) {
        const ep = e.position;
        const x = ep.x + Math.sin(side) * d, z = ep.z + Math.cos(side) * d;
        const y = ctx.level.groundY(x, z, ep.y + 4);
        const yaw = Math.atan2(ep.x - x, ep.z - z);
        ctx.player.respawnAt([x, y, z], yaw);       // (unlike teleport, this also makes it the safe-ground spot)
        g.setCamera(yaw, 0.25, 7.5);
        g.step(2);
        return [r2(x), r2(y), r2(z)];
      },
      /** A scripted homing projectile at entity e (fallback only; scenarios log every use). */
      shoot(e, kind = 'puff') {
        const p = ctx.player.position;
        const from = new ctx.THREE.Vector3(p.x, p.y + 0.6, p.z);
        const to = new ctx.THREE.Vector3(e.position.x, e.position.y + (e.height || 1) * 0.5, e.position.z);
        const v = to.sub(from).normalize().multiplyScalar(24);
        ctx.projectiles.spawn({ team: 'player', kind, position: from, velocity: v, damage: kind === 'iron' ? 3 : 1, radius: 0.3, life: 3, homing: e, homingStrength: 8, heavy: kind === 'iron', owner: ctx.player });
        g.step(30);
      },
      /**
       * Real combat: hold lock-on (re-acquired after every kill), face the target and tap throw
       * every `gap` steps until pred() is true. heal: top Morel up when he drops to 2 hp (logged).
       */
      fight(pred, o = {}) {
        const gap = o.gap ?? 16, max = o.maxSteps ?? 1800;
        const log = { throws: 0, heals: 0, locks: [], steps: 0, hurt: 0 };
        const hurt0 = it.count('player:hurt');
        let i = 0, lockOn = false;
        for (; i < max && !pred(); i++) {
          const pl = ctx.player;
          if (o.heal !== false && pl.hp <= 2 && pl.state !== 'dead') { pl.heal(pl.maxHp); log.heals++; }
          const t = pl.lockTarget;
          if (!t || !t.alive || t.hittable === false) lockOn = false;
          const inp = { lock: lockOn };
          if (!lockOn && i % 6 === 0) {
            // (re)acquire: point the camera at the wanted target, press lock
            const want = o.target ? o.target() : null;
            if (want && want.alive) {
              // lock-on picks targets in front of the camera: point it at the wanted one
              const yaw = Math.atan2(want.position.x - pl.position.x, want.position.z - pl.position.z);
              g.setCamera(yaw, 0.3, 7.5);
            }
            inp.lock = true; lockOn = true;
          }
          if (lockOn && pl.lockTarget && i % gap === 0) { inp.throw = true; log.throws++; }
          if (o.approach && pl.lockTarget && pl.lockTarget.alive) {
            const lt = pl.lockTarget.position;
            const d = Math.hypot(lt.x - pl.position.x, lt.z - pl.position.z);
            if (d > o.approach) inp.move = [0, 0.6];
            else if (d < o.approach - 3) inp.move = [0, -0.5];
          }
          if (pl.lockTarget && log.locks[log.locks.length - 1] !== pl.lockTarget.type) log.locks.push(pl.lockTarget.type);
          g.setInput(inp);
          g.step(1);
          if (inp.throw) { g.setInput({ lock: lockOn }); g.step(1); i++; }
        }
        g.setInput({});
        g.step(2);
        log.steps = i;
        log.done = !!pred();
        log.hurt = it.count('player:hurt') - hurt0;
        return log;
      },
    };
    window.__it = it;
  });
}
