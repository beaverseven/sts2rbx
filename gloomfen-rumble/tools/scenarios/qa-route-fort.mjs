// QA route playtest: Bandit Fort + gorge + pit entrance, bog checkpoint -> pit, real inputs, real bandits.
//   node tools/scenario.mjs tools/scenarios/qa-route-fort.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = {};
  await h.game((g) => { g.gotoCheckpoint('bog'); g.ctx.cameraRig.snapBehind(); g.step(10); });
  out.approach = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const r = {};
    r.fightPlateau = Q.fightAll(16).done;
    r.bridge = Q.walk(0, 262, { aim: false });
    r.gate = Q.walk(0, 271, { aim: false });
    r.near = Q.near('bandit', 30).map((b) => `${b.type}@${b.pos.join(',')} ${b.d}m`);
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'fort-01-gate');

  out.yard = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const r = {};
    r.fight1 = Q.fightAll(14, { maxSteps: 3000 });
    if (ctx.player.hp <= 2) { ctx.player.heal(5); r.healed1 = true; }
    r.walk = Q.walk(0, 285);
    r.fight2 = Q.fightAll(16, { maxSteps: 3000 });
    if (ctx.player.hp <= 2) { ctx.player.heal(5); r.healed2 = true; }
    r.armoured = Q.near('armored', 40).map((b) => `${b.type}@${b.pos.join(',')} ${b.d}m`);
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'fort-02-yard');

  out.gate = await h.game((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx;
    const r = {};
    // a puff at the gate first (what a player tries), then the anvil jar
    r.toGate = Q.walk(0, 300.5, { tol: 0.4 });
    r.puffAt = Q.throwAt(0, 304.35);
    g.step(30);
    r.hintToasts = g.events('ui:message').slice(-3).map((e) => e.payload && e.payload.text);
    r.toJar = Q.walk(6, 297, { tol: 0.5 });
    r.tonic = ctx.player.tonic ? ctx.player.tonic.kind : null;
    // the 3 ironbellies with anvil: break armour with iron
    r.ironFight = Q.fightAll(14, { maxSteps: 2400 });
    r.tonic2 = ctx.player.tonic ? ctx.player.tonic.kind : null;
    if (!ctx.player.tonic) { r.backToJar = Q.walk(6, 297, { tol: 0.5 }); g.step(60); r.backToJar2 = Q.walk(6.3, 297.3, { tol: 0.3 }); }
    r.tonic3 = ctx.player.tonic ? ctx.player.tonic.kind : null;
    r.toGate2 = Q.walk(0, 300.5, { tol: 0.4 });
    r.ironAt = Q.throwAt(0, 304.35);
    g.step(60);
    r.open = !!ctx.flags.gateFortOpen;
    r.snap = Q.snap();
    return r;
  });
  await qshot(page, h, 'fort-03-irongate');

  out.ambush = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const r = {};
    if (ctx.player.hp <= 2) { ctx.player.heal(5); r.healed = true; }
    r.through = Q.walk(0, 312, { aim: false });
    const arena = ctx.level.spawned.find((e) => e.type === 'arenaLock');
    r.state0 = arena.state;
    g.step(60);
    r.waves = [];
    for (let k = 0; k < 8 && arena.state !== 'cleared'; k++) {
      const f = Q.fightAll(30, { maxSteps: 1500 });
      r.waves.push({ wave: arena.wave, state: arena.state, fight: { throws: f.throws, steps: f.steps, hurt: f.hurt, done: f.done, left: f.left }, hp: ctx.player.hp });
      if (ctx.player.hp <= 2) { ctx.player.heal(5); r.waves.push('healed'); }
      g.step(90);
    }
    r.arena = arena.state;
    return r;
  });
  await qshot(page, h, 'fort-04-courtyard');

  out.back = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const r = {};
    r.exit = Q.walk(0, 336, { aim: false });
    r.fight = Q.fightAll(16, { maxSteps: 3000 });
    if (ctx.player.hp <= 2) { ctx.player.heal(5); r.healed = true; }
    r.cp = Q.walk(0, 352, { aim: false });
    r.cpId = ctx.player.checkpoint.id;
    r.fight2 = Q.fightAll(14);
    r.gorge = Q.walk(0, 366, { aim: false });
    r.cpId2 = ctx.player.checkpoint.id;
    r.gateWalk = Q.walk(0, 378, { aim: false });
    r.snap = Q.snap();
    r.hurts = Q.log.filter((e) => e.n === 'player:hurt').map((e) => ({ at: e.at, hp: e.hp, nearest: e.nearest && `${e.nearest.type} ${e.nearest.d}m`, mud: e.mud }));
    r.time = g.ctx.time.now;
    return r;
  });
  await qshot(page, h, 'fort-05-pit-entrance');
  return out;
}
