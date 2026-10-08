// QA route playtest: Mossy Glade, start -> glade checkpoint, real inputs (setInput + step), no teleports.
//   node tools/scenario.mjs tools/scenarios/qa-route-glade.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = {};
  const seg = (fn, arg) => h.game(fn, arg);

  // 1. spawn -> tutorial ledge, camera left alone (auto-recentre), like a first-time player
  out.start = await seg((g) => {
    const Q = window.__qa, L = window.__lv;
    const r = {};
    r.spawn = Q.snap(); r.camSpawn = Q.cam();
    r.toLedge = Q.walk(0, 26.8, { aim: false });
    // walking into the ledge without jumping
    r.pushLedge = Q.walk(0, 31, { aim: false, max: 120 });
    // a quick tap jump (what a player who has not read the sign does)
    g.setInput({ move: [0, 1], jump: true }); g.step(1); g.setInput({ move: [0, 1] }); g.step(40);
    r.afterTap = Q.snap();
    if (g.ctx.player.position.z < 30) { Q.walk(0, 25.5, { aim: true }); r.ledge = L.jumpTo({ x: 0, y: 4.2, z: 31.5 }, { jumpAt: 3.8 }); }
    r.after = Q.snap();
    return r;
  });
  await qshot(page, h, 'glade-01-ledge');

  // 2. fern meadow: the three meadow grunts, real lock-on throws
  out.meadow = await seg((g) => {
    const Q = window.__qa;
    const r = {};
    r.walk1 = Q.walk(-1, 38, { aim: false });
    r.near = Q.near('bandit', 25);
    r.fight = Q.fightAll(22);
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'glade-02-meadow');

  // 3. optional: cage C1 via the two stone steps and the pillar
  out.c1 = await seg((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx;
    const r = {};
    if (ctx.player.hp < 3) ctx.player.heal(5);
    r.toStep = Q.walk(-6.3, 46.5);
    r.step1 = L.jumpTo({ x: -8.5, y: 5.6, z: 48.3 }, { tol: 1.0 });
    r.step2 = L.jumpTo({ x: -11.1, y: 7.0, z: 50.7 }, { tol: 1.0 });
    const cage = ctx.entities.query('cage').slice().sort((a, b) => a.position.distanceTo(ctx.player.position) - b.position.distanceTo(ctx.player.position))[0];
    r.cage = cage ? { pos: [cage.position.x, cage.position.y, cage.position.z], d: cage.position.distanceTo(ctx.player.position) } : null;
    r.pillar = L.jumpTo({ x: -12.75, y: 8.4, z: 53.35 }, { tol: 0.9 });
    r.onPillar = Q.snap();
    // throw at the cage from where we are: turn toward it, tap throw twice
    for (let k = 0; k < 3 && cage && cage.hittable !== false; k++) {
      const yaw = L.aim(cage.position.x, cage.position.z);
      g.setInput({ move: [0, 0.15] }); g.step(6); g.setInput({}); g.step(2);
      g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(40);
    }
    r.cageFreed = ctx.score.cagesFreed;
    r.snapAfter = Q.snap();
    return r;
  });
  await qshot(page, h, 'glade-03-c1');

  // 4. back down, ridge, lock-on grunt at z 56 if still alive, ravine glide (natural: hold jump all the way)
  out.ravine = await seg((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx;
    const r = {};
    r.down = Q.walk(-6, 52, { aim: true });
    r.fight = Q.fightAll(20);
    r.ridge = Q.walk(0.5, 66, { aim: false });
    r.camRidge = Q.cam();
    r.glide = L.jumpTo({ x: 0, y: 5.0, z: 88 }, { glide: true, tol: 4 });
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'glade-04-after-ravine');

  // 5. the two landing grunts, then BS3 -> pillar C2
  out.c2 = await seg((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx;
    const r = {};
    r.near = Q.near('bandit', 25);
    r.fight = Q.fightAll(22);
    if (ctx.player.hp < 3) { ctx.player.heal(5); r.healed = true; }
    const bs = ctx.entities.query('bounce').map((e) => [e.position.x, e.position.y, e.position.z]);
    r.shrooms = bs;
    r.toShroom = Q.walk(9.0, 91.5);
    const capTop = g.ctx.physics.groundHeight(11.6, 93.4, 30);
    r.capTop = capTop;
    const m0 = Q.mark();
    // jump onto the shroom; when launched, steer toward the pillar centre
    r.onShroom = L.jumpTo({ x: 11.6, y: capTop, z: 93.4 }, { tol: 1.5, maxSteps: 120 });
    r.bounces = Q.since(m0, 'level:bounce').length;
    r.snapAfterShroom = Q.snap();
    return r;
  });
  await qshot(page, h, 'glade-05-shroom');
  return out;
}
