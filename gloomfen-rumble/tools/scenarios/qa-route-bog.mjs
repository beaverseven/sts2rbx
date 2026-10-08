// QA route playtest: Sunken Bog, glade checkpoint -> bog checkpoint, real inputs, real bandits.
//   node tools/scenario.mjs tools/scenarios/qa-route-bog.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = {};
  await h.game((g) => { g.gotoCheckpoint('glade'); g.ctx.cameraRig.snapBehind(); g.step(10); });

  out.stumps = await h.game((g) => {
    const Q = window.__qa;
    const r = {};
    r.shore = Q.walk(0, 116, { aim: false });
    r.jumps = [];
    for (const [x, y, z] of [[1.0, 1.9, 123.0], [-1.5, 2.3, 127.4], [1.0, 1.9, 131.8], [-1.2, 2.5, 136.2], [1.0, 2.1, 140.6]]) {
      const j = Q.jump({ x, y, z }, { tol: 1.0 }); r.jumps.push({ z, ok: j.ok, takeoff: j.takeoff, landing: j.landing, events: j.events });
      if (!j.ok) break;
    }
    r.b2 = Q.jump({ x: 0, y: 1.5, z: 147 }, { tol: 2.5 });
    r.snap = Q.snap();
    r.hurts = Q.log.filter((e) => e.n === 'player:hurt').length;
    return r;
  });
  await qshot(page, h, 'bog-01-b2');

  out.b2 = await h.game((g) => {
    const Q = window.__qa;
    const r = {};
    r.near = Q.near('bandit', 20);
    r.fight = Q.fightAll(16);
    r.snap = Q.snap();
    return r;
  });

  out.pads = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const r = {};
    if (ctx.player.hp < 3) { ctx.player.heal(5); r.healed = true; }
    r.north = Q.walk(0, 156.0, { tol: 0.4 });
    r.jumps = [];
    for (const [x, z] of [[0, 160.5], [-1.4, 164.0], [0.6, 167.5], [-1.0, 171.0], [0, 174.5]]) {
      const j = Q.jump({ x, y: 0.36, z }, { tol: 1.0 }); r.jumps.push({ z, ok: j.ok, landing: j.landing, events: j.events });
      if (!j.ok) break;
    }
    r.b3 = Q.jump({ x: 0, y: 1.25, z: 180.0 }, { tol: 2.2 });
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'bog-02-b3');

  out.rafts = await h.game((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx;
    const r = {};
    r.near = Q.near('bandit', 12);
    r.fight = Q.fightAll(10);
    const raft = (z0) => ctx.level.spawned.find((e) => e.type === 'movingPlatform' && Math.abs(e.def.path[0][2] - z0) < 0.01);
    const A = raft(188.6), B = raft(205.3);
    r.edge = Q.walk(0, 184.6, { tol: 0.4 });
    r.waitA = L.waitFor(() => A.collider.center.z < 188.8, 1500).ok;
    r.boardA = Q.jump({ x: 0, y: A.collider.max.y, z: A.collider.center.z }, { tol: 1.4, jumpAt: 3.2 });
    r.rideA = L.waitFor(() => A.collider.center.z > 196.8, 900).ok;
    g.step(5);
    r.stumpT = Q.jump({ x: 0, y: 1.3, z: 201.2 }, { tol: 1.0 });
    r.waitB = L.waitFor(() => B.collider.center.x < -1.0, 1500).ok;
    r.boardB = Q.jump({ x: B.collider.center.x, y: B.collider.max.y, z: 205.3 }, { tol: 1.4 });
    r.rideB = L.waitFor(() => B.collider.center.x > 6.8, 900).ok;
    g.step(5);
    r.b4 = Q.jump({ x: 8.5, y: 1.5, z: 211.5 }, { tol: 2.2 });
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'bog-03-b4');

  out.cliff = await h.game((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx;
    const r = {};
    r.toJar = Q.walk(9, 215.6, { tol: 0.5 });
    r.tonic = ctx.player.tonic ? ctx.player.tonic.kind : null;
    r.up = Q.jump({ x: 8, y: 9, z: 225.5 }, { updraft: true, riseTo: 10.6, jumpAt: 6.8, tol: 3, maxSteps: 900 });
    r.snap = Q.snap();
    r.near = Q.near('bandit', 20);
    return r;
  });
  await qshot(page, h, 'bog-04-plateau');

  out.plateau = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const r = {};
    r.fight = Q.fightAll(18, { maxSteps: 3000 });
    r.cp = Q.walk(0, 239, { aim: false });
    r.snap = Q.snap();
    r.hurts = Q.log.filter((e) => e.n === 'player:hurt').map((e) => ({ at: e.at, hp: e.hp, nearest: e.nearest, mud: e.mud, thorns: e.thorns }));
    r.falls = Q.log.filter((e) => e.n === 'player:fell').map((e) => e.at);
    return r;
  });
  await qshot(page, h, 'bog-05-checkpoint');
  return out;
}
