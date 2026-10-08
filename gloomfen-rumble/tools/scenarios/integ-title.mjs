// Title screen framing at a few orbit angles (and portrait).
//   node tools/scenario.mjs tools/scenarios/integ-title.mjs --html dist/index.html --shots dist/integ/shots
export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.state === 'title', null, { timeout: 60000 });
  await h.wait(2500);
  const out = [];
  for (const yaw of [0, 1.6, 3.2, 4.7]) {
    await h.game((g, y) => { g.setQuality('high'); g.ctx.cameraRig.yaw = y; }, yaw);
    await h.wait(1500);
    await h.shot(`title-yaw-${yaw}`);
    out.push(await h.game((g) => ({ state: g.ctx.state, cam: g.ctx.camera.position.toArray().map((v) => +v.toFixed(2)) })));
  }
  return out;
}
