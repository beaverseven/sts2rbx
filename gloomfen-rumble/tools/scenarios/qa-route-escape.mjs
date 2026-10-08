// QA route playtest: leaving the level with the Updraft Tonic. Drink the jar on island B4 (as on the route),
// ride the updraft up the cliff, keep rising over the plateau and steer east onto the high boundary country,
// then walk along the hills toward the fort and try to drop into the courtyard / back yard (skipping the iron
// gate and the ambush). Real inputs only (setInput + step); the camera is steered like a mouse player.
//   node tools/scenario.mjs tools/scenarios/qa-route-escape.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = {};
  out.climb = await h.game((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx, pl = ctx.player;
    g.godMode(true);
    for (const e of ctx.entities.query('bandit')) e.alive = false; g.step(2);
    pl.respawnAt([9, 1.5, 213], 0); ctx.cameraRig.snapBehind(); g.step(10);
    const r = {};
    r.jar = Q.walk(9, 215.6, { tol: 0.5 });
    r.tonic = pl.tonic && pl.tonic.kind;
    // jump at the cliff and hold jump: rise with the updraft, steering toward a point east of the plateau
    const tx = 40, tz = 236;
    let maxY = -1e9, i = 0;
    g.setInput({ move: [0, 1], jump: true }); g.step(1);
    for (; i < 1100; i++) {
      L.aim(tx, tz);
      const p = pl.position;
      maxY = Math.max(maxY, p.y);
      g.setInput({ move: [0, 1], jump: true });
      g.step(1);
      if (i > 30 && pl.onGround && p.x > 31) break;
      if (!pl.tonic && pl.onGround && i > 30) break;
    }
    g.setInput({}); g.step(10);
    r.steps = i; r.maxY = +maxY.toFixed(2); r.land = Q.snap(); r.tonicLeft = pl.tonic ? +pl.tonic.remaining.toFixed(1) : null;
    r.ground = pl.body.ground === 'terrain' ? 'terrain' : pl.body.ground && pl.body.ground.tag;
    return r;
  });
  await qshot(page, h, 'escape-01-highcountry');
  out.walk = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx, pl = ctx.player;
    const r = { legs: [] };
    for (const [x, z] of [[36, 250], [44, 254], [44, 272], [36, 288], [28, 305], [22, 322], [20, 338]]) {
      const w = Q.walk(x, z, { tol: 1.0, max: 1500 });
      r.legs.push({ to: [x, z], ok: w.ok, at: w.at || Q.pos(), stuck: !!w.stuck, fell: !!w.fell, zone: ctx.level.zone });
      if (!w.ok && !w.stuck) break;
    }
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'escape-02-above-fort');
  out.drop = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx, pl = ctx.player;
    const r = {};
    // drop west over the courtyard / back-yard palisade
    const w = Q.walk(8, 339, { tol: 1.0, max: 600 });
    r.drop = { ok: w.ok, at: w.at || Q.pos(), stuck: !!w.stuck };
    g.step(60);
    r.snap = Q.snap();
    r.gateFortOpen = !!ctx.flags.gateFortOpen;
    const arena = ctx.level.spawned.find((e) => e.type === 'arenaLock');
    r.arena = arena.state;
    r.cp = Q.walk(0, 352, { tol: 0.8, max: 900 });
    r.checkpoint = pl.checkpoint.id;
    r.zones = Q.log.filter((e) => e.n === 'zone:enter').map((e) => e.id);
    return r;
  });
  await qshot(page, h, 'escape-03-inside');
  return out;
}

// Follow-up (ESCAPE_WEDGE=1): reproduce the mid-air snag from the high country and try to get out of it.
export async function wedge(page, h) {
  await bootQA(page, h);
  const r = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx, pl = ctx.player;
    g.godMode(true);
    for (const e of ctx.entities.query('bandit')) e.alive = false; g.step(2);
    // the last safe spot on the hills before the snag (reached on foot in the main scenario)
    pl.respawnAt([36.3, 19.3, 287.4], Math.PI); ctx.cameraRig.snapBehind(); g.step(10);
    const out = { start: Q.snap() };
    out.walk = Q.walk(28, 305, { tol: 1.0, max: 600 });
    out.stuckAt = Q.snap();
    const t0 = ctx.time.now;
    // try to get out: each direction for 1 s, with and without jumping
    out.tries = [];
    for (const [mx, my] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      for (const jump of [false, true]) {
        const p0 = Q.pos();
        for (let i = 0; i < 60; i++) { g.setInput({ move: [mx, my], jump: jump && i < 20 }); g.step(1); }
        g.setInput({}); g.step(2);
        out.tries.push({ move: [mx, my], jump, from: p0, to: Q.pos(), st: pl.state, ground: pl.onGround });
      }
    }
    out.after = Q.snap();
    out.seconds = +(ctx.time.now - t0).toFixed(1);
    out.body = { onGround: pl.body.onGround, onSteep: pl.body.onSteep, hitWall: pl.body.hitWall, vel: [pl.velocity.x, pl.velocity.y, pl.velocity.z].map((v) => +v.toFixed(2)) };
    return out;
  });
  return r;
}
