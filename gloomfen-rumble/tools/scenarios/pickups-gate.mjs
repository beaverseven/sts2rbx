// Lantern Gate: hidden until boss:defeated, rises, opens; walking in emits level:complete with stats + rank.
//   node tools/scenario.mjs tools/scenarios/pickups-gate.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  // before the boss falls: hidden, no colliders, walking through does nothing
  const before = await h.game((g) => {
    g.godMode(true);
    const gate = window.__pt.find('lanternGate');
    const p = gate.position;
    g.clearEvents();
    g.teleport(p.x, p.y, p.z - 4, 0); g.setCamera(0, 0.3, 7.5); g.step(3);
    window.__pt.walkTo(p.x, p.z + 3, 300);
    const cols = g.ctx.physics.queryBox(new g.ctx.THREE.Vector3(p.x - 3, p.y, p.z - 1), new g.ctx.THREE.Vector3(p.x + 3, p.y + 3, p.z + 1)).filter((c) => c.tag === 'lanternGate');
    return { visible: gate.object3d.visible, state: gate.state, complete: g.events('level:complete').length, cols: cols.length, z: g.player.position.z, gz: p.z };
  });
  check('gate hidden before boss:defeated (invisible, no colliders, no level:complete)', !before.visible && before.state === 'hidden' && before.complete === 0 && before.cols === 0 && before.z > before.gz + 2, before);

  // some score so the stats are interesting
  await h.game((g) => {
    const sc = g.ctx.score;
    sc.reset();
    g.teleport(0, 1, 0.5, 0); g.setCamera(0, 0.3, 7.5); g.step(3);
    g.setInput({ move: [0, 1] }); g.step(100); g.setInput({}); g.step(5);
  });

  const rise = await h.game((g) => {
    const gate = window.__pt.find('lanternGate');
    g.clearEvents();
    g.ctx.events.emit('boss:defeated', { position: gate.position.clone() });
    g.step(30);
    const s1 = gate.state, v1 = gate.object3d.visible;
    g.step(100); // past the 1.6 s delay
    const s2 = gate.state;
    const msg = g.events('ui:message').map((e) => e.payload.text);
    g.step(210); // rise 3.4 s
    const s3 = gate.state;
    g.step(90); // open 1.4 s
    const s4 = gate.state, open = gate.open;
    const opened = g.events('gate:open').map((e) => e.payload.id);
    const p = gate.position;
    const cols = g.ctx.physics.queryBox(new g.ctx.THREE.Vector3(p.x - 3, p.y, p.z - 1), new g.ctx.THREE.Vector3(p.x + 3, p.y + 3, p.z + 1)).filter((c) => c.tag === 'lanternGate');
    return { s1, v1, s2, s3, s4, open, opened, msg, cols: cols.length };
  });
  check('boss:defeated -> waits, rises, opens (gate:open lanternGate)', rise.v1 && rise.s1 === 'waiting' && rise.s2 === 'rising' && rise.s4 === 'risen' && rise.open > 0.95 && rise.opened.includes('lanternGate'), rise);
  check('rising announces itself (ui:message) and the root pillars get colliders', rise.msg.length >= 1 && rise.cols === 2, rise);

  await h.game((g) => {
    g.setQuality('high');
    const p = window.__pt.find('lanternGate').position;
    g.teleport(p.x - 1.5, p.y, p.z - 7, 0.2); g.setCamera(0.1, 0.22, 6.5); g.step(30);
  });
  await h.wait(600);
  await h.shot('gate-approach');

  const enter = await h.game((g) => {
    const gate = window.__pt.find('lanternGate');
    const p = gate.position;
    g.clearEvents();
    window.__pt.walkTo(p.x, p.z + 1.5, 600);
    g.step(10);
    const lc = g.events('level:complete').map((e) => e.payload);
    window.__pt.walkTo(p.x, p.z - 1.5, 300);
    window.__pt.walkTo(p.x, p.z + 1.5, 300);
    const lc2 = g.events('level:complete').length;
    return { lc, lc2, flag: g.ctx.flags.levelComplete, completed: g.ctx.score.completed };
  });
  const st = enter.lc[0] && enter.lc[0].stats;
  check('walking into the portal emits level:complete once', enter.lc.length === 1 && enter.lc2 === 1 && enter.flag === true, enter);
  check('stats = score snapshot + rank (total, glowcaps 8/22, cages, elapsed, rank)', st && st.total === 600 + 5000 * 2 && st.glowcaps === 8 && st.glowcapsTotal === 22 && st.cagesTotal === 2 && st.elapsed > 0 && ['Bronze', 'Silver', 'Gold', 'Glowing'].includes(st.rank) && st.maxPossible > 0, st);
  check('score stops after completion (clock frozen)', enter.completed === true, enter.completed);
  await h.wait(500);
  await h.shot('gate-complete');

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
