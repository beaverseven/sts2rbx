// Close-up portraits of each bandit (visual check).
//   node tools/scenario.mjs tools/scenarios/enemies-portraits.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots
export default async function (page, h) {
  await h.wait(400);
  await h.game((g) => {
    g.setQuality('high');
    const ctx = g.ctx;
    for (const e of ctx.enemies.list()) e.alive = false;
    ctx.entities.flush();
    // a line-up, nobody notices anything
    g.spawn({ type: 'grunt', pos: [0, 1, 4], yaw: Math.PI, patrol: 0, noticeRange: 0 });
    g.spawn({ type: 'slinger', pos: [2.2, 1, 4], yaw: Math.PI, patrol: 0, noticeRange: 0 });
    g.spawn({ type: 'ironbelly', pos: [-2.4, 1, 4], yaw: Math.PI, patrol: 0, noticeRange: 0 });
    g.teleport(4.2, 1, 3, -Math.PI / 2);
    g.step(20);
  });
  const cam = (p, t) => h.game((g, a) => { const c = g.ctx.camera; c.position.set(...a.p); c.lookAt(...a.t); }, { p, t });
  await cam([1.2, 2.4, -1.8], [0, 1.05, 4]);
  await h.wait(500);
  await h.shot('lineup');
  await cam([0.9, 1.5, 1.5], [0, 0.85, 4]);
  await h.wait(400);
  await h.shot('grunt-front');
  await cam([-2.4, 1.6, 6.7], [0, 0.8, 4]);
  await h.wait(400);
  await h.shot('grunt-back');
  await cam([3.3, 1.6, 1.6], [2.2, 0.95, 4]);
  await h.wait(400);
  await h.shot('slinger-front');
  await cam([-3.6, 1.6, 1.3], [-2.4, 0.8, 4]);
  await h.wait(400);
  await h.shot('ironbelly-front');
  return h.game((g) => g.ctx.enemies.list().map((e) => e.debug()));
}
