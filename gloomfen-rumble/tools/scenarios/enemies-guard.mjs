// Ground-guard checks: bandits never walk into bog water or off ledges (even when chasing,
// backing off, belly-flopping or knocked back) and stay leashed near their post.
//   node tools/scenario.mjs tools/scenarios/enemies-guard.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots
import { installEnemyHelpers } from './enemies-helpers.mjs';

export default async function (page, h) {
  await h.wait(300);
  await installEnemyHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  await h.game((g) => {
    g.setQuality('high');
    // track the lowest point / any fall of an entity over a run
    window.__et.track = (e) => {
      const t = { minY: Infinity, maxDropAir: 0, lastGround: e.position.y, wet: 0 };
      t.tick = () => {
        const y = e.position.y;
        t.minY = Math.min(t.minY, y);
        if (e.body.onGround) t.lastGround = y; else t.maxDropAir = Math.max(t.maxDropAir, t.lastGround - y);
        if (y < g.ctx.physics.waterLevel + 0.3) t.wet++;
      };
      return t;
    };
  });

  // --- 1. bog pool: a grunt chasing Morel across the pool stops at the water's edge
  const r1 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null); g.godMode(true);
    const tp = ctx.level.testPoints;
    // Morel on the far (west) shore; grunt on the east shore, leashed loosely
    g.teleport(-39.5, 1.5, 10, Math.PI / 2); g.step(30);
    const e = et.spawn({ type: 'grunt', pos: [-15, 1, 10], yaw: -Math.PI / 2, patrol: 0, leash: 40, aggro: true, noticeRange: 30 });
    e.cfg = { ...e.cfg, loseRange: 40, giveUp: 40 };
    const tr = et.track(e);
    for (let i = 0; i < 700; i++) { g.step(1); tr.tick(); }
    const p = e.position;
    et.cam([p.x + 3, p.y + 3.5, p.z - 7], [p.x - 4, 0.5, p.z]);
    return { minY: +tr.minY.toFixed(2), wet: tr.wet, rescues: e.rescues || 0, end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], distToPool: +Math.hypot(p.x - tp.pool[0], p.z - tp.pool[2]).toFixed(2), state: e.state };
  });
  await h.wait(450);
  await h.shot('guard-pool-edge');
  check('grunt chasing across the bog pool stops at the edge (never below water + 0.3)', r1.wet === 0 && r1.rescues === 0 && r1.minY >= 0.3 && r1.distToPool > 5, r1);

  // --- 2. 6 m tower: grunt + ironbelly on top, Morel below — nobody walks or flops off
  const r2 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null);
    const top = ctx.level.testPoints.towerTop; // [-10, 7, 26]
    const a = et.spawn({ type: 'grunt', pos: [top[0] - 0.8, top[1], top[2] + 0.6], yaw: 0, patrol: 0, aggro: true, leash: 20 });
    const b = et.spawn({ type: 'ironbelly', pos: [top[0] + 0.8, top[1], top[2] - 0.6], yaw: 0, patrol: 0, aggro: true, leash: 20 });
    const ta = et.track(a), tb = et.track(b);
    // Morel wanders 13-15 m out from the tower foot (far enough to be in plain sight from the top)
    const states = new Set();
    for (let i = 0; i < 900; i++) {
      const ang = 2.2 + i * 0.004;
      if (i % 30 === 0) g.teleport(top[0] + Math.sin(ang) * 14, 1, top[2] + Math.cos(ang) * 14);
      g.step(1); ta.tick(); tb.tick();
      states.add(a.state); states.add(b.state);
    }
    return { grunt: { minY: +ta.minY.toFixed(2), drop: +ta.maxDropAir.toFixed(2), state: a.state, sees: a.sees }, ironbelly: { minY: +tb.minY.toFixed(2), drop: +tb.maxDropAir.toFixed(2), state: b.state, flops: b.flops }, states: [...states] };
  });
  check('grunt and ironbelly on the 6 m tower chase Morel below but never leave the top', r2.grunt.minY > 6.9 && r2.ironbelly.minY > 6.9 && r2.grunt.drop < 0.5 && r2.ironbelly.drop < 1.2 && (r2.states.includes('watch') || r2.states.includes('taunt')), r2);

  // --- 2b. ironbelly on a 1 m box belly-flops at Morel standing beside it: lands on the box
  const r2b = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null);
    const lane = ctx.level.testPoints.lanes[1]; // box x 12..14, z 8..11, top y 2
    const b = et.spawn({ type: 'ironbelly', pos: [13, 2, 9.6], yaw: Math.PI, patrol: 0, aggro: true, leash: 20 });
    const tb = et.track(b);
    g.teleport(13, 1, 5.5, 0);
    for (let i = 0; i < 400; i++) { g.step(1); tb.tick(); }
    return { minY: +tb.minY.toFixed(2), flops: b.flops, z: +b.position.z.toFixed(2), boxMinZ: lane.box.min.z };
  });
  check('ironbelly on a 1 m box flops at Morel below without leaping off the box', r2b.flops >= 1 && r2b.minY > 1.9, r2b);

  // --- 3. knockback toward the tower edge: the grunt teeters but stays up
  const r3 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null);
    const top = ctx.level.testPoints.towerTop;
    const e = et.spawn({ type: 'grunt', pos: [top[0], top[1], 24.9], yaw: 0, patrol: 0, noticeRange: 0, hp: 9 });
    const tr = et.track(e);
    // charged (2 dmg, knockback) hits pushing toward -Z, off the edge at z = 24
    for (let k = 0; k < 3; k++) {
      e.hurt(2, { kind: 'puff', heavy: false, charge: 1, dir: new ctx.THREE.Vector3(0, 0, -1) });
      for (let i = 0; i < 60; i++) { g.step(1); tr.tick(); }
    }
    e.hurt(1, { kind: 'iron', heavy: true, dir: new ctx.THREE.Vector3(0, 0, -1) });
    for (let i = 0; i < 90; i++) { g.step(1); tr.tick(); }
    return { minY: +tr.minY.toFixed(2), z: +e.position.z.toFixed(2), hp: e.hp, states: e.state };
  });
  check('knockback toward a 6 m drop stops at the edge', r3.minY > 6.9 && r3.z >= 24.0, r3);

  // --- 4. slinger on the 1.8 m stair landing backing away from a close Morel
  const r4 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null);
    const s = et.spawn({ type: 'slinger', pos: [20.5, 2.8, 16.5], yaw: Math.PI / 2, patrol: 0, aggro: true });
    const tr = et.track(s);
    const spots = [[25, 1, 16], [15.5, 1, 16], [20.5, 1, 21], [25, 1, 19]];
    for (let i = 0; i < 1200; i++) {
      if (i % 300 === 0) { const sp = spots[(i / 300) | 0]; g.teleport(sp[0], sp[1], sp[2]); }
      g.step(1); tr.tick();
    }
    return { minY: +tr.minY.toFixed(2), drop: +tr.maxDropAir.toFixed(2), end: s.position.toArray().map((v) => +v.toFixed(2)), shots: s.shots };
  });
  check('slinger on a 1.8 m landing never drops off an open edge (it may use the stairs)', r4.drop < 0.6, r4);

  // --- 5. leash: a grunt does not follow Morel more than its leash from its post
  const r5 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null);
    g.teleport(4, 1, 30, Math.PI); g.setCamera(Math.PI, 0.25, 7.5);
    const e = et.spawn({ type: 'grunt', pos: [4, 1, 36], yaw: Math.PI, patrol: 0, leash: 6, aggro: true });
    let maxFromHome = 0;
    // Morel walks slowly away along -Z (camera yaw PI: move.y = +1 runs toward -Z), the grunt follows
    for (let i = 0; i < 500; i++) {
      g.setInput({ move: [0, 0.32] });
      g.step(1);
      maxFromHome = Math.max(maxFromHome, Math.hypot(e.position.x - 4, e.position.z - 36));
    }
    g.setInput(null);
    for (let i = 0; i < 600; i++) g.step(1);
    return { maxFromHome: +maxFromHome.toFixed(2), endState: e.state, backHome: +Math.hypot(e.position.x - 4, e.position.z - 36).toFixed(2), alerts: et.count('enemy:alert') };
  });
  check('leash: follows to ~leash from its post but no further, then gives up and walks home', r5.maxFromHome > 4.5 && r5.maxFromHome < 6.6 && r5.backHome < 1.0 && (r5.endState === 'idle' || r5.endState === 'return'), r5);
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}
