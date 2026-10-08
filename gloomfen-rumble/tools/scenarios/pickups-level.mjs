// Pickups in the real Gloomfen level (sandbox ?level=1: level + enemies + mechanisms + score + pickups).
//   node tools/scenario.mjs tools/scenarios/pickups-level.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.goto(page.url().split('?')[0] + '?level=1');
  await page.waitForFunction(() => window.__game && window.__pickupsDev && window.__pickupsDev.levelMode, null, { timeout: 90000 });
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  const content = await h.game((g) => {
    const ctx = g.ctx;
    g.setQuality('high'); g.godMode(true); g.step(5);
    const tags = ctx.entities.countByTag();
    const sc = ctx.score;
    // every glowcap should float above walkable ground
    let below = 0, minGap = Infinity;
    for (const c of ctx.pickups.glowcaps.caps) {
      const p = c.position;
      const gy = ctx.physics.groundHeight(p.x, p.z, p.y + 0.2);
      const gap = p.y - gy;
      if (gap < minGap) minGap = gap;
      if (gap < 0.3) below++;
    }
    const types = (t) => ctx.entities.list.filter((e) => e.type === t).length;
    return {
      glowcaps: tags.glowcap, cages: types('cage'), berries: types('berry'), tonics: types('tonic'), checkpoints: types('checkpoint'), gates: types('lanternGate'),
      placeholders: ctx.entities.list.filter((e) => e.tags.has('placeholder')).map((e) => e.type),
      glowcapsTotal: sc.glowcapsTotal, cagesTotal: sc.cagesTotal, max: sc.maxPossible(), below, minGap: Math.round(minGap * 100) / 100,
      cps: g.checkpoints().map((c) => c.id),
    };
  });
  check('level spawns ~150 glowcaps (data: 159), 8 cages, 8 berries, 4 jars, 4 lantern posts, 1 gate (no placeholders)', content.glowcaps >= 140 && content.glowcaps <= 165 && content.cages === 8 && content.berries === 8 && content.tonics === 4 && content.checkpoints === 4 && content.gates === 1 && content.placeholders.length === 0, content);
  check('score registers every glowcap / 8 cages; maxPossible > 0', content.glowcapsTotal === content.glowcaps && content.cagesTotal === 8 && content.max > 20000, { max: content.max });
  check('every glowcap floats >= 0.3 m above the ground', content.below === 0, { minGap: content.minGap });
  check('no "no factory registered" warnings for pickup types', !warnings.some((w) => /glowcap|berry|tonic|cage|checkpoint|lanternGate/.test(w)), warnings.slice(0, 5));

  await h.game(() => {
    const g = window.__game, ctx = g.ctx;
    const types = new Set(['glowcap', 'berry', 'tonic', 'cage', 'checkpoint', 'lanternGate']);
    window.__pt.share = () => {
      const total = window.__pt.calls().calls;
      const ents = ctx.entities.list.filter((e) => types.has(e.type) && e.type !== 'glowcap');
      const vis = ents.map((e) => e.object3d.visible);
      ents.forEach((e) => { e.object3d.visible = false; });
      const sysObjs = ['glowcaps', 'pickup-halos', 'pickup-debris'].map((n) => ctx.scene.getObjectByName(n));
      const sysVis = sysObjs.map((o) => o.visible);
      sysObjs.forEach((o) => { o.visible = false; });
      const without = window.__pt.calls().calls;
      ents.forEach((e, i) => { e.object3d.visible = vis[i]; });
      sysObjs.forEach((o, i) => { o.visible = sysVis[i]; });
      return { total, pickups: total - without };
    };
  });
  const spots = [
    ['level-start', [0, null, 2], 0, 0.28, 7.5],
    ['level-glade-cp', [0, null, 93], 0, 0.3, 7.5],
    ['level-bog-updraft', [7, null, 209], 0.2, 0.3, 7.5],
    ['level-fort-jar', [4, null, 291], 0.3, 0.3, 7.5],
  ];
  const calls = {};
  for (const [name, p, yaw, pitch, dist] of spots) {
    calls[name] = await h.game((g, a) => {
      const ctx = g.ctx;
      const [x, , z] = a.p;
      const y = ctx.physics.groundHeight(x, z, 200);
      g.teleport(x, y + 0.05, z, a.yaw); g.setCamera(a.yaw, a.pitch, a.dist); g.step(40);
      ctx.level.frame && ctx.level.frame(0.016, ctx);
      return window.__pt.share();
    }, { p, yaw, pitch, dist });
    await h.wait(700);
    await h.shot(name);
  }

  // close-ups in place: cage C1 on its pillar, the glade lantern lit, the gate raised in the pit
  const portrait = async (name, eye, target) => {
    await h.game((g, a) => { g.ctx.level.frame && g.ctx.level.frame(0.016, g.ctx); window.__pt.portrait(a.eye, a.target); }, { eye, target });
    await h.wait(800);
    await h.shot(name);
    await h.game(() => window.__pt.resume());
  };
  await h.game((g) => { g.teleport(-13.6, 9.6, 50.5, 0); g.step(5); g.player.visible = false; });
  await portrait('level-cage-c1', [-11.2, 10.6, 50.8], [-13.6, 9.4, 54.2]);
  const cp = await h.game((g) => {
    g.player.visible = true; g.gotoCheckpoint('glade'); g.step(30);
    const e = g.ctx.entities.list.find((x) => x.checkpointId === 'glade');
    const s = e.position, p = e.postPosition;
    return { s: [s.x, s.y, s.z], p: [p.x, p.y, p.z], lit: e.lit };
  });
  // looking back at the lit lantern from up the path, Morel standing at the respawn spot
  await h.game((g) => { g.player.visible = true; });
  await portrait('level-glade-cp', [cp.s[0] - 2.5, cp.s[1] + 2.4, cp.s[2] + 6], [cp.p[0], cp.p[1] + 1.6, cp.p[2]]);
  check('glade lantern lit when Morel respawns there (gotoCheckpoint)', cp.lit, cp);
  const pit = await h.game((g) => {
    const ctx = g.ctx;
    const gate = window.__pt.find('lanternGate');
    ctx.pickups.raiseGates(true);
    const p = gate.position;
    g.teleport(p.x, p.y, p.z - 8, 0); g.step(10);
    return { state: gate.state, pos: [p.x, p.y, p.z], share: window.__pt.share() };
  });
  calls.pit = pit.share;
  await portrait('level-pit-gate', [pit.pos[0] + 3.5, pit.pos[1] + 2.2, pit.pos[2] - 9.5], [pit.pos[0], pit.pos[1] + 2.3, pit.pos[2]]);
  check('gate rises in the pit', pit.state === 'risen', pit);
  check('pickups add <= 25 draw calls at typical spots and <= 35 in the densest view (fort yard: 2 cages, 3 jars, 2 berries, 2 lanterns in range)',
    Object.entries(calls).every(([k, c]) => c.pickups <= (k === 'level-fort-jar' ? 35 : 25)), calls);

  // level.reset() re-creates every spawn: glowcap groups must take their glowcaps with them
  const reset = await h.game((g) => {
    const ctx = g.ctx;
    const before = { caps: ctx.pickups.glowcaps.caps.length, total: ctx.score.glowcapsTotal, cages: ctx.score.cagesTotal };
    ctx.level.reset();
    ctx.score.reset();
    g.step(5);
    const tags = ctx.entities.countByTag();
    return { before, caps: ctx.pickups.glowcaps.caps.length, entCaps: tags.glowcap, total: ctx.score.glowcapsTotal, cages: ctx.score.cagesTotal, cageEnts: tags.cage, gates: tags.lanternGate };
  });
  check('level.reset() re-spawns every pickup once (all glowcaps back, no duplicates; cages, gate)', reset.caps === reset.before.total && reset.entCaps === reset.before.total && reset.total === reset.before.total && reset.cages === 8 && reset.cageEnts === 8 && reset.gates === 1, reset);

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, calls, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
