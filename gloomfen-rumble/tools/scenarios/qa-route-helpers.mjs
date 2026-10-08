// QA route playtest helpers (playtester lens: the level route, played with real inputs).
//   import { bootQA } from './qa-route-helpers.mjs'; await bootQA(page, h);
// Adds window.__qa on top of __lv (level-helpers), __et (enemies-helpers) and __it (integ-helpers).
//   __qa.log                 notable events with Morel's position: hurt / fell / died / respawn / checkpoint / cage / gate / arena
//   __qa.walk(x, z, o)       run toward (x, z) with the stick only. o.aim: point the camera every step like
//                            a mouse player (default true); o.aim=false keeps the camera on its own (auto-recentre).
//                            Detects "stuck" (pushing but < 0.25 m progress in 45 steps).
//   __qa.cam()               camera pos, distance to pivot, colliders the camera sits inside, terrain under it
//   __qa.near(tag, r)        live entities with that tag within r m of Morel: [{type, pos, d}]
//   __qa.fightAll(r, o)      lock-on + real throws until no bandit within r m (uses __it.fight)
//   __qa.snap()              compact state
import { installIntegHelpers, waitForGame } from './integ-helpers.mjs';

export async function bootQA(page, h, { start = true } = {}) {
  await waitForGame(page, 'title');
  await installIntegHelpers(page);
  await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx;
    const r2 = (v) => Math.round(v * 100) / 100;
    const P = () => ctx.player;
    const pos = () => { const p = P().position; return [r2(p.x), r2(p.y), r2(p.z)]; };
    const log = [];
    const watch = ['player:hurt', 'player:fell', 'player:died', 'player:respawn', 'checkpoint:reached', 'cage:freed', 'cage:hit',
      'gate:open', 'gate:close', 'arena:lock', 'arena:wave', 'arena:clear', 'arena:reset', 'level:bounce', 'pickup:tonic', 'zone:enter', 'boss:start', 'enemy:killed', 'tonic:end'];
    for (const n of watch) ctx.events.on(n, (p) => {
      const e = { t: r2(ctx.time.now), n, at: pos(), hp: P().hp };
      if (n === 'player:hurt') {
        const me = P().position; let best = null;
        for (const b of ctx.entities.query('bandit')) { if (b.alive === false) continue; const d = b.position.distanceTo(me); if (!best || d < best.d) best = { type: b.type, d: r2(d), st: b.state }; }
        e.nearest = best;
        const hz = ctx.entities.query('hazard') || [];
        e.thorns = hz.some((k) => k.position && k.position.distanceTo(me) < 3);
        e.mud = ctx.projectiles.active ? ctx.projectiles.active.filter((q) => q.team === 'enemy' && q.position && q.position.distanceTo(me) < 2.5).length : null;
      }
      if (n === 'checkpoint:reached' || n === 'zone:enter' || n === 'gate:open' || n === 'gate:close') e.id = p && p.id;
      if (n === 'player:respawn') e.cp = p && p.checkpointId;
      if (n === 'enemy:killed') e.type = p && p.type;
      if (n === 'pickup:tonic') e.kind = p && p.kind;
      if (n === 'level:bounce') e.power = p && p.power;
      log.push(e);
    });
    const qa = {
      log,
      pos,
      mark() { return log.length; },
      since(i, name) { return log.slice(i).filter((e) => !name || e.n === name); },
      snap() { const p = P(); return { pos: pos(), hp: p.hp, st: p.state, ground: p.onGround, cp: p.checkpoint && p.checkpoint.id, tonic: p.tonic ? p.tonic.kind : null, zone: ctx.level.zone, score: ctx.score.points, caps: ctx.score.glowcaps, cages: ctx.score.cagesFreed, state: ctx.state }; },
      /** stick input toward a world point relative to the camera yaw */
      stickToward(tx, tz, mag = 1) {
        const p = P().position, yaw = ctx.cameraRig.yaw;
        let dx = tx - p.x, dz = tz - p.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        const fy = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const rx = -dx * Math.cos(yaw) + dz * Math.sin(yaw);
        return [rx * mag, fy * mag];
      },
      walk(tx, tz, o = {}) {
        const tol = o.tol ?? 0.5, max = o.max ?? 1500, aim = o.aim ?? true;
        const fell0 = log.filter((e) => e.n === 'player:fell').length;
        const hist = [];
        let camMin = Infinity, camMinAt = null;
        for (let i = 0; i < max; i++) {
          if (ctx.state !== 'playing') { g.setInput({}); g.step(1); continue; }
          const p = P().position;
          const d = Math.hypot(tx - p.x, tz - p.z);
          if (d < tol) { g.setInput({}); g.step(3); return { ok: true, steps: i, at: pos(), camMin: r2(camMin), camMinAt }; }
          const mag = Math.min(1, d / 1.2 + 0.25) * (o.speed ?? 1);
          if (aim) { window.__lv.aim(tx, tz); g.setInput({ move: [0, mag], ...(o.extra || {}) }); }
          else g.setInput({ move: qa.stickToward(tx, tz, mag), ...(o.extra || {}) });
          g.step(1);
          const cd = ctx.cameraRig.currentDistance;
          if (cd < camMin) { camMin = cd; camMinAt = pos(); }
          hist.push([p.x, p.z]);
          if (o.stopOnFall !== false && log.filter((e) => e.n === 'player:fell').length > fell0) { g.setInput({}); return { ok: false, fell: true, steps: i, at: pos() }; }
          if (i > 60 && i % 15 === 0) {
            const old = hist[hist.length - 46];
            if (old && Math.hypot(p.x - old[0], p.z - old[1]) < 0.25 && P().state !== 'hurt') { g.setInput({}); return { ok: false, stuck: true, steps: i, at: pos(), st: P().state, onGround: P().onGround }; }
          }
        }
        g.setInput({});
        return { ok: false, timeout: true, at: pos() };
      },
      cam() {
        const c = ctx.camera.position;
        const piv = ctx.cameraRig.pivot;
        const e = 0.05;
        const inside = ctx.physics.queryBox(new ctx.THREE.Vector3(c.x - e, c.y - e, c.z - e), new ctx.THREE.Vector3(c.x + e, c.y + e, c.z + e)).filter((k) => k.enabled !== false).map((k) => k.tag || k.surface || 'box');
        const th = ctx.physics.terrainHeight(c.x, c.z);
        return { pos: [r2(c.x), r2(c.y), r2(c.z)], dist: r2(c.distanceTo(piv)), cur: r2(ctx.cameraRig.currentDistance), yaw: r2(ctx.cameraRig.yaw), inside, belowTerrain: c.y < th, terrainAt: r2(th) };
      },
      near(tag, r = 15) {
        const p = P().position, out = [];
        for (const e of ctx.entities.query(tag)) {
          if (e.alive === false) continue;
          const d = e.position.distanceTo(p);
          if (d <= r) out.push({ type: e.type, pos: [r2(e.position.x), r2(e.position.y), r2(e.position.z)], d: r2(d), state: e.state });
        }
        return out.sort((a, b) => a.d - b.d);
      },
      /**
       * Hop onto a bounce shroom at (sx, sz) and steer the launch toward target {x, y, z}.
       * Runs in from `runIn` m on the far side of the shroom from the target, jumps at jumpAt m.
       * In the air: push toward the target, ease off over it. glide: hold jump after the apex.
       */
      bounce(sx, sz, t, o = {}) {
        const pl = P();
        const runIn = o.runIn ?? 3.5;
        let dx = sx - t.x, dz = sz - t.z; const dd = Math.hypot(dx, dz) || 1; dx /= dd; dz /= dd;
        const sx0 = sx + dx * runIn, sz0 = sz + dz * runIn;
        const w = qa.walk(sx0, sz0, { tol: 0.4 });
        const m0 = log.length; let bounced = false, i = 0, apex = -Infinity, air = false, jumped = false;
        for (; i < (o.maxSteps ?? 500); i++) {
          const p = pl.position;
          if (!bounced) {
            window.__lv.aim(sx, sz);
            const d = Math.hypot(sx - p.x, sz - p.z);
            const inp = { move: [0, d < 0.3 ? 0 : 1] };
            if (!jumped && pl.onGround && d <= (o.jumpAt ?? 2.2)) { inp.jump = true; jumped = true; }
            else if (jumped) inp.jump = true;          // hold: glide back onto the cap if we overshoot
            g.setInput(inp); g.step(1);
            if (log.slice(m0).some((e) => e.n === 'level:bounce')) bounced = true;
            if (jumped && pl.onGround && !bounced && i > 30 && pl.body.ground && pl.body.ground.tag !== 'unsafe') { g.setInput({}); return { ok: false, why: 'landed without bounce', walk: w, at: pos() }; }
            continue;
          }
          apex = Math.max(apex, p.y);
          if (!pl.onGround) air = true;
          const d = Math.hypot(t.x - p.x, t.z - p.z);
          window.__lv.aim(t.x, t.z);
          const falling = pl.velocity.y < 0;
          const mv = d < 0.35 ? 0 : (falling || o.early) ? Math.min(1, d / 1.2 + 0.1) : (o.riseMove ?? 1);
          g.setInput({ move: [0, mv], jump: !!o.glide && falling });
          g.step(1);
          if (air && pl.onGround) { g.setInput({}); g.step(6); break; }
        }
        g.setInput({});
        const s = pos();
        return { ok: Math.abs(s[1] - t.y) < 0.4 && Math.hypot(s[0] - t.x, s[2] - t.z) < (o.tol ?? 1.5), bounced, apex: r2(apex), landing: s, walk: w, bounces: log.slice(m0).filter((e) => e.n === 'level:bounce').length };
      },
      /** Face (x, z) with a tiny step, then tap throw; optional jump first (throw at jumpThrowDelay steps). */
      throwAt(x, z, o = {}) {
        const pl = P();
        window.__lv.aim(x, z);
        g.setInput({ move: [0, 0.12] }); g.step(5); g.setInput({}); g.step(3);
        if (o.jump) { g.setInput({ jump: true }); g.step(o.jumpThrowDelay ?? 14); g.setInput({ jump: true, throw: true }); g.step(1); g.setInput({ jump: true }); g.step(20); g.setInput({}); g.step(30); }
        else { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(40); }
        return pos();
      },
      /** __lv.jumpTo + fall/hurt detection from our own (uncapped) log. */
      jump(t, o = {}) {
        const m0 = log.length;
        const r = window.__lv.jumpTo(t, o);
        const ev = log.slice(m0).filter((e) => e.n === 'player:fell' || e.n === 'player:hurt');
        if (ev.some((e) => e.n === 'player:fell')) r.ok = false;
        if (ev.length) r.events = ev.map((e) => [e.n, e.at]);
        return r;
      },
      cageNear(x, z) {
        return ctx.entities.query('cage').slice().sort((a, b) => Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z))[0] || null;
      },
      /** Fight every bandit within r m with real lock-on throws; heal only at 1 hp (logged). */
      fightAll(r = 14, o = {}) {
        const alive = () => ctx.entities.query('bandit').filter((e) => e.alive !== false && e.hittable !== false && !e.dying && e.position.distanceTo(P().position) < r);
        const hurt0 = log.filter((e) => e.n === 'player:hurt').length;
        let heals = 0;
        const target = () => alive().sort((a, b) => a.position.distanceTo(P().position) - b.position.distanceTo(P().position))[0];
        const f = window.__it.fight(() => alive().length === 0, { target, maxSteps: o.maxSteps ?? 2400, heal: false, approach: o.approach, gap: o.gap });
        return { ...f, hurtsLogged: log.filter((e) => e.n === 'player:hurt').length - hurt0, hp: P().hp, left: alive().map((e) => e.type) };
      },
    };
    window.__qa = qa;
  });
  if (start) {
    await page.keyboard.press('Enter');
    await waitForGame(page, 'playing', 30000);
    await page.evaluate(() => { window.__game.step(1); window.__game.setQuality('high'); });
  }
}

/** Render a few frames and screenshot (camera already placed by the last step). */
export async function qshot(page, h, name, ms = 900) {
  await h.wait(ms);
  return h.shot(name);
}
