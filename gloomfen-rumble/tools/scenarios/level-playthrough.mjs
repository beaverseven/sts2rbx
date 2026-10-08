// Continuous playthrough: spawn -> pit floor with NO teleports, driven only by setInput + step.
// Tonic jars are placeholders in the level sandbox, so "drinking" one is simulated with
// __game.give(kind) when Morel stands next to the jar's spawn position; the courtyard waves are
// placeholders too, so they are despawned once they appear (as if defeated).
//   node tools/scenario.mjs tools/scenarios/level-playthrough.mjs --html dist/dev-level/index.html --shots dist/dev-level/shots
import { installLevelHelpers } from './level-helpers.mjs';

export default async function (page, h) {
  await h.wait(400);
  await installLevelHelpers(page);
  const res = await h.game((g) => {
    const L = window.__lv;
    const log = [];
    let ok = true;
    const P = () => g.ctx.player;
    g.godMode(false); g.setInput(null);
    g.gotoCheckpoint('start'); g.step(10);
    g.clearEvents();
    const t0 = g.ctx.time.now;
    const fail = (what, r) => { ok = false; log.push({ step: what, ok: false, r }); };
    const walk = (x, z, what, tol = 0.6) => { if (!ok) return; const r = L.walkTo(x, z, tol, 1500); if (!r.ok) fail(what, r); else log.push({ step: what, ok: true, at: r.pos }); };
    const jump = (t, o, what) => { if (!ok) return; const r = L.jumpTo(t, o); if (!r.ok) fail(what, r); else log.push({ step: what, ok: true, landing: r.landing }); };
    const drink = (kind) => { g.give(kind); log.push({ step: `drink ${kind}`, ok: true }); };
    const raft = (z0) => g.ctx.level.spawned.find((e) => e.type === 'movingPlatform' && Math.abs(e.def.path[0][2] - z0) < 0.01);

    // --- Mossy Glade
    walk(0, 24, 'meadow to the ledge');
    jump({ x: 0, y: 4.2, z: 31.5 }, { jumpAt: 3.8 }, 'tutorial ledge');
    walk(-1.5, 45, 'fern meadow');
    walk(0.5, 66, 'ridge');
    jump({ x: 0, y: 5.0, z: 88 }, { glide: true, tol: 4 }, 'ravine glide');
    walk(1, 100, 'glade checkpoint');
    walk(0, 116, 'down to the bog shore');
    // --- Sunken Bog
    for (const [x, y, z] of [[1.0, 1.9, 123.0], [-1.5, 2.3, 127.4], [1.0, 1.9, 131.8], [-1.2, 2.5, 136.2], [1.0, 2.1, 140.6]]) jump({ x, y, z }, { tol: 1.0 }, `stump z ${z}`);
    jump({ x: 0, y: 1.5, z: 147 }, { tol: 2.5 }, 'island B2');
    walk(0, 156.0, 'B2 north shore');
    for (const [x, z] of [[0, 160.5], [-1.4, 164.0], [0.6, 167.5], [-1.0, 171.0], [0, 174.5]]) jump({ x, y: 0.36, z }, { tol: 1.0 }, `lily pad z ${z}`);
    jump({ x: 0, y: 1.25, z: 180.0 }, { tol: 2.2 }, 'island B3');
    walk(0, 184.6, 'B3 north shore', 0.4);
    if (ok) {
      const A = raft(188.6), B = raft(205.3);
      if (!L.waitFor(() => A.collider.center.z < 188.8, 1500).ok) fail('wait raft A', null);
      jump({ x: 0, y: A.collider.max.y, z: A.collider.center.z }, { tol: 1.4, jumpAt: 3.2 }, 'board raft A');
      if (ok && !L.waitFor(() => A.collider.center.z > 196.8, 900).ok) fail('ride raft A', null);
      g.step(5);
      jump({ x: 0, y: 1.3, z: 201.2 }, { tol: 1.0 }, 'stump T');
      if (ok && !L.waitFor(() => B.collider.center.x < -1.0, 1500).ok) fail('wait raft B', null);
      if (ok) jump({ x: B.collider.center.x, y: B.collider.max.y, z: 205.3 }, { tol: 1.4 }, 'board raft B');
      if (ok && !L.waitFor(() => B.collider.center.x > 6.8, 900).ok) fail('ride raft B', null);
      g.step(5);
      jump({ x: 8.5, y: 1.5, z: 211.5 }, { tol: 2.2 }, 'island B4');
    }
    walk(9, 215.0, 'to the updraft jar', 0.9);
    if (ok) drink('updraft');
    jump({ x: 8, y: 9, z: 225.5 }, { updraft: true, riseTo: 10.6, jumpAt: 6.8, tol: 3, maxSteps: 900 }, 'updraft up the cliff');
    walk(0, 239, 'bog checkpoint (plateau)');
    // --- Bandit Fort
    walk(0, 262, 'onto the moat bridge');
    walk(0, 280, 'through the fort gate');
    walk(5.5, 296.6, 'to the anvil jar', 0.9);
    if (ok) {
      drink('anvil');
      walk(0, 299, 'face the iron gate', 0.4);
      // throws fly along Morel's facing: take a small step toward the gate so he turns to it
      L.aim(0, 304.3); g.setInput({ move: [0, 0.25] }); g.step(14); g.setInput({}); g.step(4);
      g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(90);
      if (!g.ctx.flags.gateFortOpen) fail('iron gate opened', g.events('projectile:hit').slice(-2));
      else log.push({ step: 'iron gate opened by an anvil throw', ok: true });
    }
    walk(0, 312, 'into the courtyard (ambush)');
    if (ok) {
      const arena = g.ctx.level.spawned.find((e) => e.type === 'arenaLock');
      for (let wave = 0; wave < 2; wave++) {
        if (!L.waitFor(() => arena.wave === wave && arena.enemies.length > 0, 400).ok) { fail(`arena wave ${wave + 1} spawned`, arena.state); break; }
        g.step(30);
        for (const e of arena.enemies) e.alive = false;      // placeholders: "defeat" the wave
        g.step(2);
      }
      if (ok && !L.waitFor(() => arena.state === 'cleared', 300).ok) fail('arena cleared', arena.state);
      g.step(80);
    }
    walk(0, 338.5, 'out through the courtyard exit');
    walk(0, 352, 'fort checkpoint (back gate)');
    // --- Gnarlbelly's Pit
    walk(0, 366, 'pit checkpoint (gorge)');
    walk(0, 380, 'through the pit gate');
    walk(0, 395, 'pit centre');
    const p = P().position;
    return {
      ok, seconds: +(g.ctx.time.now - t0).toFixed(1), end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], hp: P().hp,
      falls: g.events('player:fell').length, hurts: g.events('player:hurt').map((e) => e.payload.position),
      zones: g.events('zone:enter').map((e) => e.payload.id), log,
    };
  });
  for (const s of res.log) h.log(s.ok ? 'PASS' : 'FAIL', s.step, JSON.stringify(s.r || s.landing || s.at || ''));
  await h.wait(500);
  await h.shot('playthrough-end');
  return { ok: res.ok, seconds: res.seconds, end: res.end, hp: res.hp, falls: res.falls, hurts: res.hurts, zones: res.zones, steps: res.log.length };
}
