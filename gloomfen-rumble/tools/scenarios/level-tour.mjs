// Level tour: teleport to every checkpoint and a few key views, screenshot each and count the
// draw calls of one full frame (shadow + main + bloom passes) on quality 'high'.
//   node tools/scenario.mjs tools/scenarios/level-tour.mjs --html dist/dev-level/index.html --shots dist/dev-level/shots
// Optional: TOUR=name1,name2 to limit the views.
const VIEWS = [
  // name, position, player yaw, camera [yaw, pitch, distance]
  ['cp-start', 'start'], ['cp-glade', 'glade'], ['cp-bog', 'bog'], ['cp-fort', 'fort'], ['cp-pit', 'pit'],
  ['ledge', [0, 3, 24], 0, [0, 0.2, 7.5]],
  ['ravine', [0.5, 6.5, 70], 0, [0.15, 0.25, 8]],
  ['landing-back', [2, 5, 92], Math.PI, [Math.PI + 0.3, 0.2, 9]],
  ['shore-stumps', [0, 1.6, 116], 0, [0.1, 0.32, 9]],
  ['island-b2', [2, 1.5, 147], 0, [-0.2, 0.3, 9]],
  ['lily-pads', [0, 1.5, 157], 0, [0.15, 0.4, 8]],
  ['rafts', [0, 1.3, 184.5], 0, [0.35, 0.35, 9]],
  ['cliff', [8, 1.5, 211], 0, [0.1, 0.05, 8]],
  ['plateau-tower', [3, 9, 223], 0, [-0.5, 0.15, 10]],
  ['fort-approach', [0, 7.5, 250], 0, [0, 0.18, 9]],
  ['fort-yard', [0, 7, 278], 0, [0.25, 0.3, 9]],
  ['iron-gate', [1, 7, 296], 0, [0, 0.2, 8]],
  ['courtyard', [0, 7, 312], 0, [0.0, 0.35, 10]],
  ['back-yard', [0, 7, 336], 0, [0.2, 0.3, 9]],
  ['pit-inside', [0, 2, 380], 0, [0, 0.3, 11]],
  ['pit-throne', [0, 2, 405], 0, [0, 0.12, 9]],
  ['start-look-ahead', [0, 3, 0], 0, [0, -0.05, 6]],
  ['start-waterfall', [-9, 3, -2], -1.6, [-1.75, 0.12, 7]],
  ['ravine-waterfall', [6, 6.5, 73], 1.4, [1.35, 0.15, 8]],
  ['landmarks-from-glade', [0, 5, 104], 0, [0.02, 0.02, 7.5]],
  ['landmarks-from-bog', [0, 1.6, 147], 0, [0.0, 0.05, 7.5]],
  ['bird-bog', [-12, 26, 140], 0.5, [0.5, 0.55, 12]],
];
export default async function (page, h) {
  await h.wait(500);
  const only = (process.env.TOUR || '').split(',').filter(Boolean);
  const out = {};
  await h.game((g) => { g.setQuality('high'); g.godMode(true); g.step(2); });
  for (const [name, at, yaw, cam] of VIEWS) {
    if (only.length && !only.includes(name)) continue;
    const r = await h.game((g, a) => {
      const [name, at, yaw, cam] = a;
      g.setInput(null);
      if (typeof at === 'string') g.gotoCheckpoint(at);
      else { g.teleport(at[0], at[1] + 0.5, at[2], yaw); }
      g.step(30);
      if (cam) g.setCamera(cam[0], cam[1], cam[2]);
      g.step(2);
      g.ctx.level.frame(0);                      // update distance culling for this camera spot
      const ri = g.ctx.renderer.info;
      const was = ri.autoReset;
      ri.autoReset = false; ri.reset();
      g.render();
      const calls = ri.render.calls, tris = ri.render.triangles;
      // the level's own cost: hide other areas' placeholder markers (they are not distance-culled)
      const ph = g.ctx.entities.query('placeholder').slice();
      for (const e of ph) e.object3d.visible = false;
      ri.reset(); g.render();
      const levelCalls = ri.render.calls, levelTris = ri.render.triangles;
      for (const e of ph) e.object3d.visible = true;
      ri.reset();
      ri.autoReset = was;
      const p = g.ctx.player.position;
      return { calls, levelCalls, levelTris, tris, pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], zone: g.ctx.level.zone };
    }, [name, at, yaw, cam]);
    await h.wait(700);
    await h.shot(name);
    out[name] = r;
    h.log(name, JSON.stringify(r));
  }
  out.stats = await h.game((g) => g.ctx.level.stats);
  return out;
}
