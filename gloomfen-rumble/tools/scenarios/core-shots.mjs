// Core visual check: Morel close-up at the default camera, a wide arena view, the sky.
//   node tools/scenario.mjs tools/scenarios/core-shots.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
export default async function (page, h) {
  await h.wait(500);
  await h.game((g) => { g.setQuality('high'); g.step(30); });
  await h.wait(600);
  await h.shot('morel-default');
  // run a bit so the scarf trails and the run cycle show
  await h.game((g) => { g.setInput({ move: [0.3, 1] }); g.step(40); });
  await h.wait(600);
  await h.shot('morel-running');
  await h.game((g) => { g.setInput({ move: [0.3, 1] }); g.step(7); g.setCamera(g.ctx.player.yaw + 1.9, 0.12, 3.2); g.step(1); });
  await h.wait(600);
  await h.shot('morel-running-side');
  await h.game((g) => { g.setInput(null); g.step(30); g.ctx.player.damage(1, g.ctx.player.position.clone().setZ(g.ctx.player.position.z + 2)); g.step(4); g.setCamera(g.ctx.player.yaw + 2.6, 0.15, 3.5); g.step(1); });
  await h.wait(600);
  await h.shot('morel-hurt');
  await h.game((g) => { g.step(80); g.ctx.player.damage(9); g.step(9); });
  await h.wait(600);
  await h.shot('morel-splat');
  await h.game((g) => { g.step(200); }); // respawn + let the invulnerability blink finish
  await h.game((g) => { g.setInput(null); g.teleport(-10, 7, 25.5, Math.PI); g.setInput({ jump: true, move: [0, 1] }); g.step(40); });
  await h.wait(600);
  await h.shot('morel-gliding');
  await h.game((g) => { g.setInput(null); g.teleport(4, 1, 2, 0.3); g.step(5); g.setCamera(2.6, 0.12, 6); g.step(1); });
  await h.wait(600);
  await h.shot('morel-front');
  await h.game((g) => { g.teleport(9, 1, -14, 0.25); g.step(5); g.setCamera(0.25, 0.32, 16); g.step(1); });
  await h.wait(600);
  await h.shot('arena-wide');
  await h.game((g) => { g.setCamera(-0.55, -0.25, 6); g.step(1); });
  await h.wait(600);
  await h.shot('sky');
  return h.game((g) => g.state());
}
