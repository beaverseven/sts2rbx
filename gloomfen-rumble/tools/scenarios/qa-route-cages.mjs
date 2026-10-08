// QA route playtest: can a player reach and break all 8 glowworm cages with real inputs?
// Each attempt starts from a nearby route spot (respawnAt = "begin a segment"), then only setInput + step.
// God mode is on so bandit damage does not end attempts (geometry is what is tested); bandits nearby are
// fought first with real throws.
//   node tools/scenario.mjs tools/scenarios/qa-route-cages.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const only = (process.env.CAGES || '').split(',').filter(Boolean);
  const want = (n) => !only.length || only.includes(n);
  const out = {};
  const begin = (x, z, yaw) => h.game((g, a) => {
    const ctx = g.ctx; g.godMode(true);
    const y = ctx.level.groundY(a.x, a.z, 40);
    ctx.player.respawnAt([a.x, y, a.z], a.yaw); ctx.cameraRig.snapBehind(); g.step(5);
    return window.__qa.snap();
  }, { x, z, yaw });
  const cageState = (x, z) => h.game((g, a) => { const c = window.__qa.cageNear(a.x, a.z); return { hits: c.hits, freed: c.freed, pos: [c.position.x, c.position.y, c.position.z] }; }, { x, z });

  if (want('C1')) {
    await begin(-4, 44, -0.6);
    out.C1 = await h.game((g) => {
      const Q = window.__qa, L = window.__lv;
      const r = {};
      r.fight = Q.fightAll(16).done;
      r.toStep = Q.walk(-6.6, 46.4).ok;
      r.step1 = L.jumpTo({ x: -8.5, y: 5.6, z: 48.3 }, { jumpAt: 2.2, tol: 1.0 });
      r.step2 = L.jumpTo({ x: -11.1, y: 7.0, z: 50.7 }, { jumpAt: 2.4, tol: 1.0 });
      // try 1: throw from the second step (cage base 1.4 m higher)
      r.throwFromStep = Q.throwAt(-13.6, 54.2);
      const c = Q.cageNear(-13.6, 54.2); r.hitsFromStep = c.hits;
      // try 2: climb onto the pillar corner and throw
      r.pillar = L.jumpTo({ x: -12.75, y: 8.4, z: 53.3 }, { jumpAt: 2.0, tol: 0.8 });
      return r;
    });
    await qshot(page, h, 'cage-C1-pillar');
    out.C1.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(-13.6, 54.2);
      for (let k = 0; k < 3 && !c.freed; k++) Q.throwAt(-13.6, 54.2);
      return { hits: c.hits, freed: c.freed, at: Q.pos() };
    });
  }

  if (want('C2')) {
    await begin(6, 90, 0.8);
    out.C2 = await h.game((g) => {
      const Q = window.__qa;
      const r = {};
      r.fight = Q.fightAll(18).done;
      r.bounce = Q.bounce(11.6, 93.4, { x: 15.0, y: 9.6, z: 95.0 }, { tol: 1.2 });
      return r;
    });
    await qshot(page, h, 'cage-C2-pillar');
    out.C2.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(15.6, 95.5);
      for (let k = 0; k < 3 && !c.freed; k++) Q.throwAt(15.6, 95.5);
      return { hits: c.hits, freed: c.freed, at: Q.pos() };
    });
  }

  if (want('C3')) {
    await begin(0, 147, 0);
    out.C3 = await h.game((g) => {
      const Q = window.__qa;
      const r = {};
      r.fight = Q.fightAll(14).done;
      r.bounce = Q.bounce(-5.6, 151.6, { x: -9.9, y: 7.2, z: 155.1 }, { tol: 1.2 });
      if (!r.bounce.ok) r.bounceGlide = Q.bounce(-5.6, 151.6, { x: -9.9, y: 7.2, z: 155.1 }, { tol: 1.2, glide: true });
      return r;
    });
    await qshot(page, h, 'cage-C3-pillar');
    out.C3.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(-10.4, 155.6);
      for (let k = 0; k < 3 && !c.freed; k++) Q.throwAt(-10.4, 155.6);
      return { hits: c.hits, freed: c.freed, at: Q.pos() };
    });
  }

  if (want('C4')) {
    await begin(5, 153, Math.PI / 2);
    out.C4 = await h.game((g) => {
      const Q = window.__qa, L = window.__lv, ctx = g.ctx;
      const r = {};
      r.fight = Q.fightAll(14).done;
      const raft = ctx.level.spawned.find((e) => e.type === 'movingPlatform' && Math.abs(e.def.path[0][2] - 153) < 0.01);
      r.edge = Q.walk(7.6, 153, { tol: 0.3 });
      r.wait = L.waitFor(() => raft.collider.center.x < 10.4, 1500).ok;
      r.board = L.jumpTo({ x: raft.collider.center.x, y: raft.collider.max.y, z: 153 }, { tol: 1.4, jumpAt: 3.0 });
      r.ride = L.waitFor(() => raft.collider.center.x > 14.6, 900).ok;
      r.onRaft = Q.snap();
      r.island = L.jumpTo({ x: 19.5, y: 1.8, z: 153.5 }, { tol: 2.5 });
      r.toCage = Q.walk(22.6, 155, { tol: 0.6 });
      return r;
    });
    out.C4.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(24.6, 155);
      for (let k = 0; k < 3 && !c.freed; k++) Q.throwAt(24.6, 155);
      return { hits: c.hits, freed: c.freed, at: Q.pos() };
    });
    await qshot(page, h, 'cage-C4');
  }

  if (want('C5')) {
    await begin(2, 233, -1.2);
    out.C5 = await h.game((g) => {
      const Q = window.__qa;
      const r = {};
      r.fight = Q.fightAll(14).done;
      r.bounce = Q.bounce(-3.2, 229.2, { x: -6.6, y: 17.0, z: 229.4 }, { tol: 1.5 });
      r.slinger = Q.near('slinger', 6);
      return r;
    });
    await qshot(page, h, 'cage-C5-tower');
    out.C5.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(-7.8, 229.8);
      const f = Q.fightAll(5).done;
      for (let k = 0; k < 3 && !c.freed; k++) Q.throwAt(-7.8, 229.8);
      return { fight: f, hits: c.hits, freed: c.freed, at: Q.pos() };
    });
  }

  if (want('C6')) {
    await begin(-16, 288, -0.9);
    out.C6 = await h.game((g) => {
      const Q = window.__qa, L = window.__lv;
      const r = {};
      r.fight = Q.fightAll(14).done;
      r.toCrate = Q.walk(-22, 288.6, { tol: 0.3 });
      r.c1 = L.jumpTo({ x: -22, y: 8.2, z: 291 }, { jumpAt: 2.0, tol: 0.7 });
      r.c2 = L.jumpTo({ x: -22, y: 9.4, z: 292.25 }, { jumpAt: 1.6, tol: 0.7 });
      return r;
    });
    await qshot(page, h, 'cage-C6-crates');
    out.C6.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(-20.75, 292.25);
      const r = { tries: [] };
      for (let k = 0; k < 3 && !c.freed; k++) { Q.throwAt(-20.75, 292.25); r.tries.push(c.hits); }
      for (let k = 0; k < 3 && !c.freed; k++) { Q.throwAt(-20.75, 292.25, { jump: true }); r.tries.push('j' + c.hits); }
      return { ...r, hits: c.hits, freed: c.freed, at: Q.pos(), caps: g.ctx.score.glowcaps };
    });
  }

  if (want('C7')) {
    // the courtyard: open the iron gate as a player would (anvil jar), then the ambush; the crates are inside
    await begin(5, 295, 0);
    out.C7 = await h.game((g) => {
      const Q = window.__qa, L = window.__lv, ctx = g.ctx;
      const r = {};
      r.fight = Q.fightAll(14).done;
      ctx.flags.gateFortOpen = true; g.step(30);
      r.gate = !!ctx.flags.gateFortOpen;
      r.in = Q.walk(0, 312);
      const arena = ctx.level.spawned.find((e) => e.type === 'arenaLock');
      for (let k = 0; k < 6 && arena.state !== 'cleared'; k++) { Q.fightAll(30, { maxSteps: 1500 }); g.step(90); }
      r.arena = arena.state;
      r.toCrate = Q.walk(12.4, 310.4, { tol: 0.3 });
      r.c1 = L.jumpTo({ x: 12.4, y: 8.2, z: 312.4 }, { jumpAt: 2.0, tol: 0.7 });
      r.c2 = L.jumpTo({ x: 11.15, y: 9.4, z: 312.4 }, { jumpAt: 1.6, tol: 0.7 });
      return r;
    });
    await qshot(page, h, 'cage-C7-crates');
    out.C7.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(11.15, 313.65);
      const r = { tries: [] };
      for (let k = 0; k < 3 && !c.freed; k++) { Q.throwAt(11.15, 313.65); r.tries.push(c.hits); }
      for (let k = 0; k < 3 && !c.freed; k++) { Q.throwAt(11.15, 313.65, { jump: true }); r.tries.push('j' + c.hits); }
      return { ...r, hits: c.hits, freed: c.freed, at: Q.pos() };
    });
  }

  if (want('C8')) {
    await begin(-3, 336, -1.2);
    out.C8 = await h.game((g) => {
      const Q = window.__qa, L = window.__lv, ctx = g.ctx;
      const r = {};
      r.fight = Q.fightAll(16).done;
      r.toCrate = Q.walk(-5.6, 336.4, { tol: 0.3 });
      r.c1 = L.jumpTo({ x: -7.6, y: 8.2, z: 336.4 }, { jumpAt: 2.0, tol: 0.7 });
      r.c2 = L.jumpTo({ x: -7.6, y: 9.4, z: 337.65 }, { jumpAt: 1.3, tol: 0.7 });
      r.roof = L.jumpTo({ x: -9.6, y: 10.0, z: 337.8 }, { jumpAt: 2.0, tol: 0.8 });
      return r;
    });
    await qshot(page, h, 'cage-C8-roof');
    out.C8.throws = await h.game((g) => {
      const Q = window.__qa; const c = Q.cageNear(-11.5, 337.8);
      for (let k = 0; k < 3 && !c.freed; k++) Q.throwAt(-11.5, 337.8);
      return { hits: c.hits, freed: c.freed, at: Q.pos() };
    });
  }
  out.freed = await h.game((g) => ({ freed: g.ctx.score.cagesFreed, log: window.__qa.log.filter((e) => e.n === 'cage:freed' || e.n === 'player:fell').map((e) => [e.n, e.at]) }));
  return out;
}
