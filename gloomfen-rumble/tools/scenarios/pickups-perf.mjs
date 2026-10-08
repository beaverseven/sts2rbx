// Draw calls and step cost: glowcaps are instanced (caps + outline hull + halos = 3 calls for any number).
//   node tools/scenario.mjs tools/scenarios/pickups-perf.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  const r = await h.game((g) => {
    const ctx = g.ctx;
    g.setQuality('high'); g.godMode(true);
    const types = ['glowcap', 'berry', 'tonic', 'cage', 'checkpoint', 'lanternGate'];
    const sys = ['glowcaps', 'pickup-halos', 'pickup-debris'].map((n) => ctx.scene.getObjectByName(n));
    const pickupEnts = () => ctx.entities.list.filter((e) => types.includes(e.type));
    const setAll = (on, only = null) => {
      for (const e of pickupEnts()) if (e.type !== 'glowcap') e.object3d.visible = on && (!only || only === e.type);
      ctx.pickups.glowcaps.group.visible = on && (!only || only === 'glowcap');
      sys[1].visible = on; // halos mesh visibility is also driven per frame; frame() below re-applies
    };
    const measure = () => { ctx.pickups.halos.frame(); ctx.pickups.glowcaps.frame(); return window.__pt.calls().calls; };
    // spawn view
    g.teleport(0, 1, -1.5, 0); g.setCamera(0, 0.28, 7.5); g.step(20);
    const all = measure();
    setAll(false); ctx.scene.getObjectByName('pickup-halos').visible = false;
    const halosFrame = ctx.pickups.halos.frame; ctx.pickups.halos.frame = () => {};
    const none = window.__pt.calls().calls;
    ctx.pickups.halos.frame = halosFrame;
    const per = {};
    for (const t of types) { setAll(true, t); ctx.pickups.halos.frame = () => {}; ctx.scene.getObjectByName('pickup-halos').visible = false; per[t] = window.__pt.calls().calls - none; ctx.pickups.halos.frame = halosFrame; }
    setAll(true);
    per.halos = measure() - none - Object.values(per).reduce((a, b) => a + b, 0);

    // 150 more glowcaps on the meadow behind the spawn, viewed from above
    const before150 = ctx.pickups.glowcaps.caps.length;
    window.__pickupsDev.spawnField(150);
    const n = ctx.pickups.glowcaps.caps.length;
    g.teleport(4, 1, -2, Math.PI); g.setCamera(Math.PI, 0.5, 9); g.step(10);
    const field = measure();
    const drawn = ctx.pickups.glowcaps.drawn;
    ctx.pickups.glowcaps.group.visible = false;
    const fieldNoCaps = window.__pt.calls().calls;
    ctx.pickups.glowcaps.group.visible = true;
    const glowcapCalls = field - fieldNoCaps;

    // fixed-step cost with ~170 glowcaps + everything else
    const t0 = performance.now();
    g.step(600);
    const stepMs = (performance.now() - t0) / 600;
    // frame-side instancing cost
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) { ctx.pickups.glowcaps.frame(); ctx.pickups.halos.frame(); }
    const frameMs = (performance.now() - t1) / 200;
    return { all, none, per, before150, n, field, fieldNoCaps, glowcapCalls, drawn, stepMs, frameMs, info: ctx.renderer.info.memory };
  });
  check('172 glowcaps (22 + 150) render in 3 draw calls (caps + outline hull + halos)', r.n === 172 && r.glowcapCalls <= 3 && r.drawn >= 150, r);
  // spawn view holds 2 berries, 3 jars, 2 cages, 2 checkpoints (gate hidden); per-instance budget
  const per = { berry: r.per.berry / 2, tonic: r.per.tonic / 3, cage: r.per.cage / 2, checkpoint: r.per.checkpoint / 2 };
  check('per-instance draw calls (incl. outline hulls + shadow casters): berry <= 4, jar <= 6, cage <= 10, checkpoint <= 8', per.berry <= 4 && per.tonic <= 6 && per.cage <= 10 && per.checkpoint <= 8, per);
  check('all pickups in the spawn view add < 65 draw calls', r.all - r.none < 65, { all: r.all, arenaOnly: r.none });
  await h.wait(500);
  await h.shot('perf-150-glowcaps');
  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, numbers: r, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
