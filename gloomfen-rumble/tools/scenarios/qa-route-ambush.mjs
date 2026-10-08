// QA route playtest: the courtyard ambush (arenaLock) wave 2 slingers on the crate stacks, and the outer-yard
// tower slingers. Where do Morel's lock-on puffs go? Logs every projectile:hit of player puffs.
//   node tools/scenario.mjs tools/scenarios/qa-route-ambush.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = {};
  await h.game((g) => {
    const ctx = g.ctx;
    window.__hits = [];
    ctx.events.on('projectile:hit', (p) => {
      if (p.kind === 'mud') return;
      const c = p.collider;
      window.__hits.push({ ent: p.target ? (p.target.type || 'entity') : null, col: c ? (typeof c === 'string' ? c : (c.tag || c.surface || 'box')) : null, at: p.position ? [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)] : null, defl: !!p.deflected });
    });
  });
  // --- the courtyard ambush, entered after opening the gate by flag (the gate itself is tested elsewhere)
  out.ambush = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx, pl = ctx.player;
    g.godMode(true);
    // clear the outer and back yard so only arena enemies are around
    for (const e of ctx.entities.query('bandit')) e.alive = false; g.step(2);
    ctx.flags.gateFortOpen = true;
    pl.respawnAt([0, 7, 300], 0); ctx.cameraRig.snapBehind(); g.step(40);
    Q.walk(0, 312, { aim: false });
    const arena = ctx.level.spawned.find((e) => e.type === 'arenaLock');
    const r = { lock: arena.state };
    g.step(60);
    r.w1 = Q.fightAll(30, { maxSteps: 1500 });
    for (let i = 0; i < 300 && arena.wave < 1; i++) g.step(1);
    g.step(80);
    const wave2 = arena.enemies.map((e) => ({ type: e.type, pos: [+e.position.x.toFixed(2), +e.position.y.toFixed(2), +e.position.z.toFixed(2)], hp: e.hp, st: e.state }));
    r.wave2AtSpawn = wave2;
    window.__hits.length = 0;
    // kill the two grunts, then focus the slingers
    r.w2 = Q.fightAll(30, { maxSteps: 2400 });
    r.wave2After = arena.enemies.map((e) => ({ type: e.type, alive: e.alive, pos: [+e.position.x.toFixed(2), +e.position.y.toFixed(2), +e.position.z.toFixed(2)], hp: e.hp, st: e.state, hittable: e.hittable }));
    const tally = {};
    for (const hh of window.__hits) { const k = hh.ent ? 'entity:' + hh.ent + (hh.defl ? '(deflected)' : '') : 'world:' + hh.col; tally[k] = (tally[k] || 0) + 1; }
    r.hitTally = tally;
    r.sampleWorldHits = window.__hits.filter((x) => !x.ent).slice(0, 8);
    r.arena = arena.state;
    r.morel = Q.pos();
    return r;
  });
  await qshot(page, h, 'ambush-wave2');
  // --- a player who walks up to a crate-stack slinger and throws from close range
  out.close = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx;
    const arena = ctx.level.spawned.find((e) => e.type === 'arenaLock');
    const sl = arena.enemies.filter((e) => e.alive !== false && e.type === 'slinger');
    const r = { slingers: sl.length, tries: [] };
    window.__hits.length = 0;
    for (const s of sl) {
      const w = Q.walk(s.position.x + (s.position.x > 0 ? -4 : 4), s.position.z - 3, { tol: 0.6 });
      const f = window.__it.fight(() => s.alive === false || s.hp <= 0, { target: () => s, maxSteps: 900, heal: false });
      r.tries.push({ walk: w.ok, at: Q.pos(), throws: f.throws, killed: s.alive === false || s.hp <= 0, sl: [+s.position.x.toFixed(2), +s.position.y.toFixed(2), +s.position.z.toFixed(2)], st: s.state });
    }
    const tally = {};
    for (const hh of window.__hits) { const k = hh.ent ? 'entity:' + hh.ent + (hh.defl ? '(deflected)' : '') : 'world:' + hh.col; tally[k] = (tally[k] || 0) + 1; }
    r.hitTally = tally;
    for (let i = 0; i < 200; i++) g.step(1);
    r.arena = arena.state;
    return r;
  });
  await qshot(page, h, 'ambush-close');
  // --- outer-yard tower slingers from the ground (fresh run)
  out.towers = await h.game((g) => {
    const Q = window.__qa, ctx = g.ctx, pl = ctx.player;
    ctx.flow.newRun(); g.step(2); g.godMode(true);
    for (const e of ctx.entities.query('bandit')) if (e.type !== 'slinger' || e.position.z > 280) e.alive = false; g.step(2);
    const r = {};
    const spots = [[0, 272], [-5, 280], [-10, 284], [-14, 278]];
    for (const [x, z] of spots) {
      pl.respawnAt([x, 7, z], Math.PI); ctx.cameraRig.snapBehind(); g.step(20);
      window.__hits.length = 0;
      const target = ctx.entities.query('slinger').filter((e) => e.alive !== false).sort((a, b) => a.position.distanceTo(pl.position) - b.position.distanceTo(pl.position))[0];
      if (!target) break;
      const f = window.__it.fight(() => target.alive === false || target.hp <= 0, { target: () => target, maxSteps: 600, heal: false });
      const tally = {};
      for (const hh of window.__hits) { const k = hh.ent ? 'entity:' + hh.ent + (hh.defl ? '(deflected)' : '') : 'world:' + hh.col; tally[k] = (tally[k] || 0) + 1; }
      r[`from ${x},${z}`] = { target: [target.position.x, target.position.y, target.position.z], throws: f.throws, killed: target.alive === false || target.hp <= 0, tally, locks: f.locks };
    }
    return r;
  });
  return out;
}
