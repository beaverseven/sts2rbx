// QA: does a grunt's club hit where it visibly lands? Morel stands still at distance d in front of a
// grunt that is already swinging (wind-up started at 1.8 m, then Morel steps back), for several d.
// Also the Chief's club slam: distance from the visible crack line at which Morel still gets hit.
//   node tools/scenario.mjs tools/scenarios/qa-combat-reach.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installQA(page);
  const out = {};
  out.grunt = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, pl = ctx.player;
    g.gotoCheckpoint('start'); g.step(2);
    for (const e of ctx.enemies.list()) if (e.position.z < 70) e.alive = false;
    g.step(1);
    const res = [];
    for (const d of [1.8, 2.0, 2.2, 2.35, 2.5, 2.7]) {
      const e = ctx.entities.spawn({ type: 'grunt', pos: [0, 4.2, 45], yaw: 0, aggro: true, patrol: 0 });
      ctx.entities.flush();
      // Morel 1.7 m in front -> the grunt starts its wind-up; then Morel is put at distance d (still in front)
      pl.respawnAt([0, 4.2, 46.7], Math.PI); g.setCamera(Math.PI, 0.25, 7.5);
      let k = 0;
      for (; k < 240 && e.state !== 'windup'; k++) g.step(1);
      pl.teleport([0, e.position.y, e.position.z + d], Math.PI);
      const hp0 = pl.hp;
      let impact = null;
      for (let j = 0; j < 60 && e.state !== 'recover'; j++) { g.step(1); if (e.state === 'swing' && e.stateT > 0.07 && !impact) impact = Math.sin(e.yaw) * 1.25; }
      const dz = pl.position.z - e.position.z;
      res.push({ d, hit: pl.hp < hp0, grunt: [e.position.x, e.position.z].map((v) => +v.toFixed(2)), centreDist: +Math.hypot(pl.position.x - e.position.x, dz).toFixed(2), clubImpactAhead: 1.25, gapClubToMorelEdge: +(d - 1.25 - pl.radius).toFixed(2) });
      e.alive = false; g.step(1);
      pl.heal(5); g.step(80); // let invulnerability run out
    }
    return res;
  });
  // screenshot: the case at 2.35 m right at the moment of the hit
  await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, pl = ctx.player;
    const e = ctx.entities.spawn({ type: 'grunt', pos: [0, 4.2, 45], yaw: 0, aggro: true, patrol: 0 });
    ctx.entities.flush();
    pl.respawnAt([0, 4.2, 46.7], Math.PI);
    for (let k = 0; k < 240 && e.state !== 'windup'; k++) g.step(1);
    pl.teleport([0, e.position.y, e.position.z + 2.35], Math.PI);
    for (let j = 0; j < 60; j++) { g.step(1); if (e.state === 'swing' && e.stateT >= 0.1) break; }
    // side view so the gap is visible
    for (const e of ctx.entities.list) if (e.tags.has('glowcap') || e.type === 'glowcap') e.object3d.visible = false;
    ctx.cameraRig.setView(Math.PI / 2, 0.2, 5.5);
    g.setQuality('high');
    window.__qaReachHp = pl.hp;
  });
  await settledShot(page, h, 'reach-01-grunt-2.35m', 1200);
  out.shotHp = await page.evaluate(() => window.__qaReachHp);
  return out;
}
