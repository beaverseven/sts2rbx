// Draw calls and simulation cost with the sandbox's 7 bandits (all chasing Morel), plus an overview shot.
//   node tools/scenario.mjs tools/scenarios/enemies-perf.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots
export default async function (page, h) {
  await h.wait(400);
  const base = await h.game((g) => {
    g.setQuality('high');
    window.__enemies.respawnAll();
    g.teleport(6, 1, 22, 0); g.setCamera(0, 0.35, 9);
    g.godMode(true);
    g.step(10);
    return g.ctx.enemies.list().length;
  });
  await h.wait(600);
  const calls = async () => h.game((g) => { const r = g.ctx.renderer; r.info.autoReset = false; r.info.reset(); g.render(); const c = r.info.render.calls; const t = r.info.render.triangles; r.info.autoReset = true; return { calls: c, triangles: t }; });
  const quiet = await calls();
  await h.shot('overview-start');
  // everyone alerted and closing in
  const sim = await h.game((g) => {
    for (const e of g.ctx.enemies.list()) { e.aware = true; e.setState('alert', 0.5); }
    const t0 = performance.now();
    g.step(240);
    const ms = (performance.now() - t0) / 240;
    g.setCamera(0.4, 0.4, 11); g.step(1);
    return { msPerStep: +ms.toFixed(3), states: g.ctx.enemies.list().map((e) => e.state) };
  });
  await h.wait(600);
  const busy = await calls();
  await h.shot('overview-fight');
  // with no bandits at all, for comparison
  const none = await h.game((g) => {
    for (const e of g.ctx.enemies.list()) e.alive = false;
    g.ctx.entities.flush(); g.ctx.enemies.fx.clearAll(); g.ctx.projectiles.clear();
    const r = g.ctx.renderer; r.info.autoReset = false; r.info.reset(); g.render(); const c = r.info.render.calls; r.info.autoReset = true; return c;
  });
  return { bandits: base, quiet, busy, noBandits: none, sim };
}
