// Chief Gnarlbelly visual check: dormant on the throne, roar, stomp ring, dizzy, phase-2 plate.
//   node tools/scenario.mjs tools/scenarios/enemies-boss-shots.mjs --html dist/dev-boss/index.html --shots dist/dev-boss/shots
import { installEnemyHelpers } from './enemies-helpers.mjs';

export default async function (page, h) {
  await h.wait(400);
  await installEnemyHelpers(page);
  const camAt = (fn, arg) => h.game(fn, arg);
  await h.game((g) => { g.setQuality('high'); g.godMode(true); g.step(30); const b = g.ctx.enemies.boss(); window.__et.cam([5.5, 4.2, 393], [0, 2.8, 402]); return b.debug(); });
  await h.wait(500);
  await h.shot('boss-dormant');
  await camAt((g) => {
    const et = window.__et, b = g.ctx.enemies.boss();
    g.teleport(0, 2, 388, 0);
    et.until(() => b.state === 'wake' && b.stateT > 0.9, 200);
    et.cam([4, 3.2, 392], [0, 3.2, 401]);
  });
  await h.wait(450);
  await h.shot('boss-roar');
  await camAt((g) => {
    const et = window.__et, b = g.ctx.enemies.boss();
    et.until(() => b.state === 'stompWindup' && b.stateT > 0.6, 400);
    const p = b.position;
    et.cam([p.x + 9, p.y + 3.5, p.z - 8], [p.x, p.y + 2.2, p.z]);
  });
  await h.wait(450);
  await h.shot('boss-stomp-windup');
  await camAt((g) => {
    const et = window.__et, b = g.ctx.enemies.boss();
    et.until(() => b.state === 'stomp' && b.stateT > 0.3, 100);
    const p = b.position;
    et.cam([p.x + 12, p.y + 7, p.z - 12], [p.x, p.y + 1, p.z - 2]);
  });
  await h.wait(450);
  await h.shot('boss-stomp-ring');
  await camAt((g) => {
    const et = window.__et, b = g.ctx.enemies.boss();
    b.enterDizzy('stuck');
    g.step(50);
    const p = b.position;
    const f = [Math.sin(b.yaw), Math.cos(b.yaw)];
    et.cam([p.x + f[0] * 7 + f[1] * 3, p.y + 3.2, p.z + f[1] * 7 - f[0] * 3], [p.x, p.y + 2.4, p.z]);
  });
  await h.wait(450);
  await h.shot('boss-dizzy');
  return h.game((g) => g.ctx.enemies.boss().debug());
}
