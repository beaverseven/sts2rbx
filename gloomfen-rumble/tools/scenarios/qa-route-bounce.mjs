// QA route playtest: how forgiving is it to get ONTO a bounce shroom cap (1.56 m wide box, 0.85 m high)?
// Input matrix per shroom: approach speed (stick), takeoff distance from the cap centre, stick released or held.
//   node tools/scenario.mjs tools/scenarios/qa-route-bounce.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const res = await h.game((g) => {
    const ctx = g.ctx, pl = ctx.player, L = window.__lv;
    g.godMode(true);
    for (const e of ctx.entities.query('bandit')) e.alive = false; g.step(2);
    const shrooms = ctx.level.spawned.filter((e) => e.type === 'bounceShroom');
    const trial = (s, dirx, dirz, o) => {
      // start runIn m away along -dir, run toward the cap centre
      const sx = s.position.x, sz = s.position.z;
      const x0 = sx - dirx * o.runIn, z0 = sz - dirz * o.runIn;
      const y0 = ctx.level.groundY(x0, z0, s.position.y + 3);
      pl.respawnAt([x0, y0, z0], Math.atan2(dirx, dirz)); ctx.cameraRig.snapBehind(); g.step(20);
      const LOG = window.__qa.log; const n0 = LOG.length;
      let jumped = false, tJump = -1, bounced = false;
      for (let i = 0; i < 200; i++) {
        const p = pl.position; const d = Math.hypot(sx - p.x, sz - p.z);
        if (o.steer || !jumped) L.aim(sx, sz);
        const inp = { move: [0, o.stick] };
        if (!jumped && pl.onGround && d <= o.at) { inp.jump = true; jumped = true; tJump = i; }
        else if (jumped) {
          inp.jump = o.glide ? true : pl.velocity.y > 0;
          if (o.release !== undefined && i - tJump >= o.release) inp.move = [0, 0];
        }
        g.setInput(inp); g.step(1);
        if (LOG.slice(n0).some((e) => e.n === 'level:bounce')) { bounced = true; break; }
        if (jumped && i - tJump > 10 && pl.onGround) break;
      }
      g.setInput({}); g.step(3);
      if (LOG.slice(n0).some((e) => e.n === 'level:bounce')) bounced = true;
      g.step(30);
      return bounced;
    };
    const out = {};
    for (const s of shrooms) {
      const key = `(${s.position.x.toFixed(1)},${s.position.z.toFixed(1)})`;
      const rows = [];
      // approach from 4 directions to avoid any one-sided geometry
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (const mode of ['straight', 'straight+glide']) {
        for (const stick of [1]) {
          for (const at of [3.4, 3.8, 4.2, 4.6, 5.0, 5.4, 5.8, 6.2]) {
            let ok = 0;
            for (const [dx, dz] of dirs) ok += trial(s, dx, dz, { runIn: 9, stick, at, steer: false, glide: mode === 'straight+glide' }) ? 1 : 0;
            rows.push({ mode, stick, at, ok });
          }
        }
      }
      // standing still touching the cap, jump + push forward
      let st = 0;
      for (const [dx, dz] of dirs) st += trial(s, dx, dz, { runIn: 1.25, stick: 1, at: 9, steer: true }) ? 1 : 0;
      let stf = 0;
      for (const [dx, dz] of dirs) stf += trial(s, dx, dz, { runIn: 1.25, stick: 1, at: 9, steer: true, glide: true }) ? 1 : 0;
      out[key] = { rows, standingSteer: `${st}/4`, standingSteerGlide: `${stf}/4` };
    }
    return out;
  });
  return res;
}
