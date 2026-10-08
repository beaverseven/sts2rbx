// In-page helpers for level route scenarios (deterministic, driven by __game.step).
//   import { installLevelHelpers } from './level-helpers.mjs'; await installLevelHelpers(page);
//   then inside h.game(...): window.__lv.walkTo(x, z), __lv.jumpTo({x, y, z}, opts), __lv.waitFor(fn)
// Movement is camera-relative, so every step points the camera at the target and pushes forward.
export async function installLevelHelpers(page) {
  await page.evaluate(() => {
    const g = window.__game;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const P = () => g.ctx.player;
    const lv = {
      log: [],
      aim(tx, tz) {
        const p = P().position;
        const yaw = Math.atan2(tx - p.x, tz - p.z);
        g.ctx.cameraRig.setView(yaw, 0.25, 7.5);
        return yaw;
      },
      state() {
        const p = P(), b = p.body;
        const gr = b.ground;
        return { pos: [r3(p.position.x), r3(p.position.y), r3(p.position.z)], onGround: p.onGround, ground: gr === 'terrain' ? 'terrain' : gr ? (gr.tag || 'box') : null, state: p.state, hp: p.hp };
      },
      /** Run on the ground to (tx, tz); stops within tol metres. */
      walkTo(tx, tz, tol = 0.35, maxSteps = 900) {
        const fell0 = g.events('player:fell').length;
        for (let i = 0; i < maxSteps; i++) {
          const p = P().position;
          const d = Math.hypot(tx - p.x, tz - p.z);
          if (d < tol) { g.setInput({}); g.step(4); return { ok: true, steps: i, ...lv.state() }; }
          lv.aim(tx, tz);
          g.setInput({ move: [0, Math.min(1, d / 1.2 + 0.25)] });
          g.step(1);
          if (g.events('player:fell').length > fell0) { g.setInput({}); return { ok: false, fell: true, steps: i, ...lv.state() }; }
        }
        g.setInput({});
        return { ok: false, timeout: true, ...lv.state() };
      },
      /** Step until fn() is true (fn runs in the page). */
      waitFor(fn, maxSteps = 900) {
        g.setInput({});
        for (let i = 0; i < maxSteps; i++) { if (fn()) return { ok: true, steps: i }; g.step(1); }
        return { ok: false, steps: maxSteps };
      },
      /**
       * Jump onto a target platform t = {x, y, z} (y = top surface).
       * opts: glide (hold jump all the way down), updraft (hold jump to rise after the apex until
       * y > riseTo), jumpAt (takeoff when horizontal distance <= this; default: at the edge),
       * tol (landing must be within tol m of the target horizontally, default 1.6), maxSteps.
       */
      jumpTo(t, o = {}) {
        const pl = P();
        const fell0 = g.events('player:fell').length;
        const tol = o.tol ?? 1.6;
        let jumped = false, air = false, airSteps = 0, apex = -Infinity, takeoff = null, i = 0;
        for (i = 0; i < (o.maxSteps ?? 600); i++) {
          const p = pl.position;
          const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
          lv.aim(t.x, t.z);
          const inp = { move: [0, 1], jump: false };
          if (!jumped) {
            // takeoff at the edge of what we stand on (ground 0.55 m ahead drops away), or at jumpAt
            const k = (pl.radius + 0.23) / Math.max(d, 1e-3);
            const ax = p.x + dx * k, az = p.z + dz * k;
            const gy = g.ctx.physics.groundHeight(ax, az, p.y + 0.3);
            const edge = !(gy > p.y - 0.25) || gy < g.ctx.physics.waterLevel + 0.3;
            const atDist = o.jumpAt !== undefined && d <= o.jumpAt;
            if (pl.onGround && (o.jumpAt !== undefined ? atDist : edge)) { inp.jump = true; jumped = true; takeoff = [r3(p.x), r3(p.y), r3(p.z)]; }
          } else {
            if (!pl.onGround) { air = true; airSteps++; }
            apex = Math.max(apex, p.y);
            const rising = pl.velocity.y > 0;
            if (o.updraft) inp.jump = !(p.y > (o.riseTo ?? t.y + 1.2) && d < 3) && airSteps < 400;
            else inp.jump = rising || !!o.glide;
            // ease off the stick when close so we do not overshoot small platforms
            inp.move = [0, d < 0.4 ? 0 : Math.min(1, d / 1.5 + 0.15)];
            if (air && pl.onGround) {
              g.setInput({}); g.step(6);
              const s = lv.state();
              const ok = Math.hypot(t.x - pl.position.x, t.z - pl.position.z) < tol && Math.abs(pl.position.y - t.y) < 0.35 && g.events('player:fell').length === fell0;
              return { ok, takeoff, apex: r3(apex), airTime: r3(airSteps / 60), landing: s.pos, ground: s.ground, steps: i };
            }
          }
          g.setInput(inp);
          g.step(1);
          if (g.events('player:fell').length > fell0) { g.setInput({}); return { ok: false, fell: true, takeoff, apex: r3(apex), steps: i, at: lv.state().pos }; }
        }
        g.setInput({});
        return { ok: false, timeout: true, takeoff, ...lv.state() };
      },
    };
    window.__lv = lv;
  });
}
