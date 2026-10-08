// QA combat probe: boot the shipped page, start, go to the pit checkpoint, report arena entities, screenshot.
//   node tools/scenario.mjs tools/scenarios/qa-combat-probe.mjs --html dist/index.html --shots dist/qa-combat
import { waitForGame, settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await waitForGame(page, 'title');
  const r = await h.game((g) => {
    const ctx = g.ctx;
    g.start();
    g.step(2);
    g.gotoCheckpoint('pit');
    g.step(10);
    const b = ctx.enemies.boss();
    const ents = ctx.entities.list.filter((e) => e.position && Math.hypot(e.position.x, e.position.z - 395) < 30).map((e) => ({ type: e.type, tags: [...e.tags], pos: [e.position.x, e.position.y, e.position.z].map((v) => +v.toFixed(2)) }));
    return { state: g.state(), boss: b && b.debug(), ents, waves: ctx.enemies.fx.waves.length, cam: ctx.cameraRig.yaw };
  });
  await h.game((g) => g.setQuality('high'));
  await settledShot(page, h, 'probe-pit', 1500);
  return r;
}
