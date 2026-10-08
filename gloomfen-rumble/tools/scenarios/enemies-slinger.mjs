// Slinger checks: lead-predicted mud arcs land near Morel while he runs (straight-line trials in
// several directions, god mode so he keeps running), the slinger backs off / closes in to hold its
// 8-14 m band, and the sling wind-up is visible.
//   node tools/scenario.mjs tools/scenarios/enemies-slinger.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots
import { installEnemyHelpers } from './enemies-helpers.mjs';

export default async function (page, h) {
  await h.wait(300);
  await installEnemyHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  await h.game((g) => g.setQuality('high'));

  // --- 1. lead prediction trials
  const r = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null); g.godMode(true);
    const s = et.slinger = et.spawn({ type: 'slinger', pos: [12, 1, 40], yaw: Math.PI, patrol: 0 });
    // camera yaw 0: move.x = +1 runs toward -X, move.y = +1 toward +Z
    const trials = [
      { start: [-2, 1, 28], move: [-1, 0] }, { start: [26, 1, 28], move: [1, 0] },
      { start: [0, 1, 22], move: [-0.7, 0.7] }, { start: [24, 1, 22], move: [0.7, 0.7] },
      { start: [-3, 1, 31], move: [-1, 0] }, { start: [27, 1, 31], move: [1, 0] },
      { start: [12, 1, 16], move: [-0.5, 0.86] }, { start: [3, 1, 25], move: [-1, 0.2] },
    ];
    const out = [];
    let landed = null;
    const off = ctx.events.on('projectile:hit', (p) => {
      if (p.kind !== 'mud' || landed) return;
      const pp = ctx.player.position;
      landed = { miss: Math.hypot(p.position.x - pp.x, p.position.z - pp.z), target: p.target === ctx.player ? 'player' : p.target ? 'entity' : 'world' };
    });
    for (const tr of trials) {
      ctx.projectiles.clear();
      g.setInput(null);
      g.teleport(tr.start[0], tr.start[1], tr.start[2], 0); g.setCamera(0, 0.3, 7.5);
      s.aware = true; s.setState('combat'); s.throwCd = 99; s.sees = true; s.lostT = 0;
      landed = null;
      // get up to speed, then let the slinger start its wind-up
      g.setInput({ move: tr.move }); g.step(20);
      s.throwCd = 0;
      const fired = et.until(() => { g.setInput({ move: tr.move }); return s.state === 'throw' && s.thrown; }, 120);
      const firedAt = ctx.player.position.toArray();
      const land = et.until(() => { g.setInput({ move: tr.move }); return !!landed; }, 150);
      out.push({ fired, land, miss: landed ? +landed.miss.toFixed(2) : null, target: landed && landed.target, flight: s.lastShot ? +s.lastShot.t.toFixed(2) : null, lead: s.lastShot ? +s.lastShot.lead.toFixed(2) : null, pv: s.lastShot ? s.lastShot.pv.map((v) => +v.toFixed(1)) : null, noLeadMiss: landed ? +Math.hypot(firedAt[0] - ctx.player.position.x, firedAt[2] - ctx.player.position.z).toFixed(2) : null });
    }
    off(); g.setInput(null);
    const ok = out.filter((o) => o.miss !== null);
    const avg = ok.reduce((a, o) => a + o.miss, 0) / Math.max(1, ok.length);
    const avgNoLead = ok.reduce((a, o) => a + o.noLeadMiss, 0) / Math.max(1, ok.length);
    return { trials: out, landed: ok.length, avgMiss: +avg.toFixed(2), avgNoLeadMiss: +avgNoLead.toFixed(2), within2: ok.filter((o) => o.miss < 2).length, playerHits: ok.filter((o) => o.target === 'player').length };
  });
  check('every trial throws a mud ball that lands', r.landed === r.trials.length, r);
  check('lead-predicted mud lands near the running target (avg miss < 1.5 m, >= 6/8 within 2 m)', r.avgMiss < 1.5 && r.within2 >= 6, r);
  check('lead matters: aiming at the fire-time position would miss by > 5 m on average', r.avgNoLeadMiss > 5, { avgNoLeadMiss: r.avgNoLeadMiss });

  // --- 2. distance band: too close -> backs off; too far -> closes in
  const r2 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, s = et.slinger;
    ctx.projectiles.clear(); g.setInput(null);
    g.teleport(12, 1, 35, 0);
    s.position.set(12, 1, 40); s.body.velocity.set(0, 0, 0);
    s.aware = true; s.setState('combat'); s.throwCd = 99;
    g.step(180);
    const near = +s.pdist.toFixed(2);
    g.teleport(12, 1, 18, 0);
    g.step(240);
    const far = +s.pdist.toFixed(2);
    return { near, far, y: +s.position.y.toFixed(2) };
  });
  check('too close (5 m) -> backs off past 7 m; too far (22 m) -> closes to <= 16 m', r2.near > 7 && r2.far <= 16, r2);

  // --- 3. screenshots: sling wind-up and a mud ball in flight
  await h.game((g) => {
    const et = window.__et, s = et.slinger;
    g.setInput(null);
    g.teleport(4, 1, 30, 0);
    s.throwCd = 0;
    et.until(() => s.state === 'windup' && s.stateT > 0.4, 300);
    const p = s.position;
    et.cam([p.x - 2.4, p.y + 1.5, p.z - 2.6], [p.x, p.y + 1.25, p.z]);
  });
  await h.wait(450);
  await h.shot('slinger-windup');
  await h.game((g) => {
    const et = window.__et, s = et.slinger, ctx = g.ctx;
    et.until(() => s.state === 'throw' && s.thrown, 120);
    g.step(26);
    const p = s.position, q = ctx.player.position;
    et.cam([(p.x + q.x) / 2 + 10, 4.2, (p.z + q.z) / 2 - 4], [(p.x + q.x) / 2, 2.0, (p.z + q.z) / 2]);
  });
  await h.wait(450);
  await h.shot('slinger-mud-arc');
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}
