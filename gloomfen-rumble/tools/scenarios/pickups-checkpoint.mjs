// Lantern checkpoints: light within 2.5 m, set the respawn point (die -> respawn there), emit once.
//   node tools/scenario.mjs tools/scenarios/pickups-checkpoint.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  const listed = await h.game((g) => g.checkpoints().map((c) => c.id));
  check('__game.checkpoints() lists the lantern posts (sandA, sandB)', listed.includes('sandA') && listed.includes('sandB'), listed);

  // walk past sandA at ~3 m: not lit; then within 2.5 m: lit
  const walk = await h.game((g) => {
    g.godMode(true);
    const cp = g.ctx.entities.list.find((e) => e.checkpointId === 'sandA');
    const s = cp.position;
    g.teleport(s.x + 3.2, s.y, s.z - 4, 0); g.setCamera(0, 0.3, 7.5); g.step(3);
    g.clearEvents();
    window.__pt.walkTo(s.x + 3.2, s.z + 3, 400);
    const farLit = cp.lit, farEv = g.events('checkpoint:reached').length;
    window.__pt.walkTo(s.x + 1.0, s.z, 400);
    g.step(10);
    const ev = g.events('checkpoint:reached').map((e) => e.payload);
    return { farLit, farEv, lit: cp.lit, ev, playerCp: g.player.checkpoint.id, cpPos: [g.player.checkpoint.position.x, g.player.checkpoint.position.y, g.player.checkpoint.position.z], spot: [s.x, s.y, s.z], post: [cp.postPosition.x, cp.postPosition.z] };
  });
  check('passing at 3.2 m does not light the lantern', !walk.farLit && walk.farEv === 0, walk);
  check('within 2.5 m: lit, checkpoint:reached {id sandA} once, player.setCheckpoint(sandA)', walk.lit && walk.ev.length === 1 && walk.ev[0].id === 'sandA' && walk.playerCp === 'sandA', walk.ev);
  check('respawn point is the path spot (post stands 1.7 m to the side)', Math.hypot(walk.cpPos[0] - walk.spot[0], walk.cpPos[2] - walk.spot[2]) < 0.01 && Math.abs(Math.hypot(walk.post[0] - walk.spot[0], walk.post[1] - walk.spot[2]) - 1.7) < 0.05, walk);

  // die far away -> respawn at sandA
  const die = await h.game((g) => {
    g.teleport(-10, 1, 30, 0); g.step(3);
    g.godMode(false);
    g.clearEvents();
    g.player.die();
    g.step(110);
    g.godMode(true);
    const r = g.events('player:respawn').map((e) => e.payload);
    const p = g.player.position;
    return { r, pos: [p.x, p.y, p.z], state: g.ctx.state };
  });
  check('death respawns Morel at the sandA lantern (player:respawn checkpointId sandA)', die.r.length === 1 && die.r[0].checkpointId === 'sandA' && Math.hypot(die.pos[0] - walk.spot[0], die.pos[2] - walk.spot[2]) < 0.3 && die.state === 'playing', die);

  // standing next to it again: no second event
  const again = await h.game((g) => { g.clearEvents(); g.step(60); return g.events('checkpoint:reached').length; });
  check('checkpoint:reached fires only once', again === 0, again);

  // second checkpoint takes over; the first one does not re-claim it when revisited
  const second = await h.game((g) => {
    const cp = g.ctx.entities.list.find((e) => e.checkpointId === 'sandB');
    const s = cp.position;
    g.teleport(s.x - 4, s.y, s.z, Math.PI / 2); g.setCamera(Math.PI / 2, 0.3, 7.5); g.step(3);
    g.clearEvents();
    window.__pt.walkTo(s.x, s.z, 400);
    const id1 = g.player.checkpoint.id;
    const a = g.ctx.entities.list.find((e) => e.checkpointId === 'sandA').position;
    g.teleport(a.x, a.y, a.z, 0); g.step(30);
    return { id1, id2: g.player.checkpoint.id, ev: g.events('checkpoint:reached').map((e) => e.payload.id) };
  });
  check('sandB lights and becomes the checkpoint; revisiting sandA keeps sandB', second.id1 === 'sandB' && second.id2 === 'sandB' && second.ev.join() === 'sandB', second);

  await h.game((g) => { g.setQuality('high'); g.teleport(5, 1, -10, 0); g.setCamera(0.2, 0.3, 7.5); g.step(30); });
  await h.wait(500);
  await h.shot('checkpoint-gameplay');

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
