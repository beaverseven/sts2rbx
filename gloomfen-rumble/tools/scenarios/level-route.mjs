// Main-route proof: scripted runs (setInput + step, deterministic) through every REQUIRED
// jump of Gloomfen, plus negative checks that the gaps really need the intended move.
//   node tools/scenario.mjs tools/scenarios/level-route.mjs --html dist/dev-level/index.html --shots dist/dev-level/shots
import { installLevelHelpers } from './level-helpers.mjs';

export default async function (page, h) {
  await h.wait(400);
  await installLevelHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const G = (fn, arg) => h.game(fn, arg);
  await G((g) => { g.godMode(false); g.setInput(null); g.step(2); });

  // ---------------------------------------------------------------- glade: tutorial ledge (1.2 m)
  let r = await G((g) => {
    g.player.hp = 5;
    g.teleport(0, 3.1, 22, 0); g.step(10);
    const walk = window.__lv.walkTo(0, 31, 0.3, 240);       // walking into it is blocked
    g.teleport(0, 3.1, 22, 0); g.step(10);
    const jump = window.__lv.jumpTo({ x: 0, y: 4.2, z: 31.5 }, { jumpAt: 3.8 });
    return { walk, jump };
  });
  check('ledge: walking is blocked by the 1.2 m ledge', !r.walk.ok && r.walk.pos[2] < 28.8, r.walk);
  check('ledge: running jump lands on top (y 4.2)', r.jump.ok, r.jump);

  // ---------------------------------------------------------------- glade: ravine (10 m, needs glide)
  r = await G((g) => {
    g.player.hp = 5;
    g.teleport(0, 6.6, 64, 0); g.step(10);
    const noGlide = window.__lv.jumpTo({ x: 0, y: 5.0, z: 88 }, {});
    g.step(80);
    g.player.hp = 5;
    g.teleport(0, 6.6, 64, 0); g.step(10);
    const glide = window.__lv.jumpTo({ x: 0, y: 5.0, z: 88 }, { glide: true, tol: 4 });
    return { noGlide, glide };
  });
  check('ravine: running jump without glide falls in', r.noGlide.fell, r.noGlide);
  check('ravine: running jump + glide lands on the far side', r.glide.ok && r.glide.landing[2] > 85, r.glide);

  // ---------------------------------------------------------------- bog: shore -> 5 stumps -> island B2
  r = await G((g) => {
    g.player.hp = 5;
    g.teleport(0, 1.6, 114, 0); g.step(10);
    const L = window.__lv;
    const out = [];
    const targets = [[1.0, 1.9, 123.0], [-1.5, 2.3, 127.4], [1.0, 1.9, 131.8], [-1.2, 2.5, 136.2], [1.0, 2.1, 140.6]];
    for (const [x, y, z] of targets) { const j = L.jumpTo({ x, y, z }, { tol: 1.0 }); out.push(j); if (!j.ok) return out; }
    out.push(L.jumpTo({ x: 0, y: 1.5, z: 147 }, { tol: 2.5 }));
    return out;
  });
  r.forEach((j, i) => check(`stumps: jump ${i + 1}/${6} (${i < 5 ? 'stump ' + (i + 1) : 'island B2'})`, j.ok, j));

  // ---------------------------------------------------------------- bog: sinking lily pads -> island B3
  r = await G((g) => {
    g.player.hp = 5;
    g.teleport(0, 1.6, 155.5, 0); g.step(20);
    const L = window.__lv;
    const out = [];
    for (const [x, z] of [[0, 160.5], [-1.4, 164.0], [0.6, 167.5], [-1.0, 171.0], [0, 174.5]]) {
      const j = L.jumpTo({ x, y: 0.36, z }, { tol: 1.0 }); out.push(j); if (!j.ok) return out;
    }
    out.push(L.jumpTo({ x: 0, y: 1.25, z: 180.0 }, { tol: 2.2 }));
    // standing still on a pad is not safe: it sinks
    return out;
  });
  r.forEach((j, i) => check(`lily pads: jump ${i + 1}/6 (${i < 5 ? 'pad ' + (i + 1) : 'island B3'})`, j.ok, j));
  r = await G((g) => {
    g.player.hp = 5;
    g.teleport(0, 1.6, 177.5, 0); g.step(15);
    const L = window.__lv;
    const pad5 = g.ctx.level.spawned.find((e) => e.type === 'sinkingPad' && Math.abs(e.position.z - 174.5) < 0.1);
    L.waitFor(() => pad5.state === 'idle', 600);          // the previous run sank it; wait until it resurfaces
    L.aim(0, 174.5);
    const on = L.jumpTo({ x: 0, y: 0.36, z: 174.5 }, { tol: 1.0, jumpAt: 3.2 });
    const fell0 = g.events('player:fell').length;
    g.setInput({}); g.step(150);
    return { on, sankAndFell: g.events('player:fell').length > fell0 };
  });
  check('lily pads: standing still on a pad sinks you into the bog', r.on.ok && r.sankAndFell, r);

  // ---------------------------------------------------------------- bog: raft A -> stump T -> raft B -> island B4
  r = await G((g) => {
    g.player.hp = 5;
    const L = window.__lv;
    const rafts = g.ctx.level.spawned.filter((e) => e.type === 'movingPlatform');
    const A = rafts.find((e) => Math.abs(e.def.path[0][2] - 188.6) < 0.01), B = rafts.find((e) => Math.abs(e.def.path[0][2] - 205.3) < 0.01);
    g.teleport(0, 1.4, 184.5, 0); g.step(10);
    const out = {};
    out.waitA = L.waitFor(() => A.collider.center.z < 188.8, 1200);
    out.toA = L.jumpTo({ x: 0, y: A.collider.max.y, z: A.collider.center.z }, { tol: 1.4, jumpAt: 3.2 });
    out.rideA = L.waitFor(() => A.collider.center.z > 196.8, 900);
    g.step(5);
    out.onAAtEnd = { z: +g.player.position.z.toFixed(2), ground: L.state().ground };
    out.toT = L.jumpTo({ x: 0, y: 1.3, z: 201.2 }, { tol: 1.0 });
    out.waitB = L.waitFor(() => B.collider.center.x < -1.0, 1200);
    out.toB = L.jumpTo({ x: B.collider.center.x, y: B.collider.max.y, z: 205.3 }, { tol: 1.4 });
    out.rideB = L.waitFor(() => B.collider.center.x > 6.8, 900);
    g.step(5);
    out.toB4 = L.jumpTo({ x: 8.5, y: 1.5, z: 211.5 }, { tol: 2.2 });
    return out;
  });
  check('raft A: board at the near end', r.waitA.ok && r.toA.ok, r.toA);
  check('raft A: carried to the far end', r.rideA.ok && r.onAAtEnd.z > 195 && r.onAAtEnd.ground === 'platform', r.onAAtEnd);
  check('stump T: hop off raft A', r.toT.ok, r.toT);
  check('raft B: board from stump T', r.waitB.ok && r.toB.ok, r.toB);
  check('island B4: hop off raft B', r.rideB.ok && r.toB4.ok, r.toB4);

  // ---------------------------------------------------------------- bog: cliff (7.5 m) needs the Updraft Tonic
  r = await G((g) => {
    g.player.hp = 5;
    const L = window.__lv;
    g.player.setTonic(null);
    g.teleport(9, 1.6, 215.5, 0); g.step(10);
    const plain = L.jumpTo({ x: 9, y: 9, z: 225 }, { jumpAt: 6.5, tol: 3 });
    g.teleport(9, 1.6, 215.5, 0); g.step(10);
    g.give('updraft');
    const up = L.jumpTo({ x: 8, y: 9, z: 225.5 }, { updraft: true, riseTo: 10.6, jumpAt: 6.8, tol: 3, maxSteps: 900 });
    return { plain, up, tonic: g.player.tonic };
  });
  check('cliff: a plain jump cannot climb it', !r.plain.ok && r.plain.landing && r.plain.landing[1] < 3, r.plain);
  check('cliff: Updraft Tonic carries Morel onto the plateau (y 9)', r.up.ok, r.up);

  // ---------------------------------------------------------------- fort: bridge, iron gate (needs anvil), pit approach
  r = await G((g) => {
    g.player.hp = 5;
    const L = window.__lv;
    g.player.setTonic(null);
    g.teleport(0, 7.6, 251, 0); g.step(10);
    const fell0 = g.events('player:fell').length;
    let minY = 99;
    const walk = L.walkTo(0, 280, 0.5, 600);
    minY = Math.min(minY, g.player.position.y);
    return { walk, fell: g.events('player:fell').length > fell0 };
  });
  check('fort: the moat bridge carries Morel into the outer yard', r.walk.ok && !r.fell && r.walk.pos[1] > 6.8, r);

  r = await G((g) => {
    const L = window.__lv;
    g.teleport(0, 7.1, 299, 0); g.step(10);
    const blocked = L.walkTo(0, 309, 0.4, 240);
    g.teleport(0, 7.1, 299, 0); g.step(10);
    g.give('anvil');
    L.aim(0, 304.3);
    g.clearEvents();
    g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(50);
    const opened = g.events('gate:open').map((e) => e.payload.id);
    g.step(80);
    const through = L.walkTo(0, 309, 0.4, 300);
    return { blocked, opened, through, flag: !!g.ctx.flags.gateFortOpen };
  });
  check('fort: the iron gate blocks the way while shut', !r.blocked.ok && r.blocked.pos[2] < 304.2, r.blocked);
  check('fort: an Anvil throw opens it (gate:open fortGate, flag set)', r.opened.includes('fortGate') && r.flag, r.opened);
  check('fort: Morel walks through the open gatehouse', r.through.ok, r.through);

  r = await G((g) => {
    const L = window.__lv;
    g.player.setTonic(null);
    g.gotoCheckpoint('fort'); g.step(20);
    const a = L.walkTo(0, 366, 0.5, 600);
    const b = L.walkTo(0, 385, 0.5, 600);
    return { a, b };
  });
  check('pit: the gorge leads from the fort checkpoint down into the pit (floor y 2)', r.a.ok && r.b.ok && Math.abs(r.b.pos[1] - 2) < 0.05, r);

  await G((g) => { g.setInput(null); g.gotoCheckpoint('start'); g.step(5); });
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { passed: checks.length - failed.length, total: checks.length, failed };
}
