// QA: lock-on and puffs against the fort's tower slingers from the yard floor (real lock + throw inputs).
//   node tools/scenario.mjs tools/scenarios/qa-combat-towerlock.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { installLevelHelpers } from './level-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installLevelHelpers(page);
  await installQA(page);
  const out = {};
  // walk in over the bridge like a player and press lock while looking into the yard
  out.enter = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, L = window.__lv, qa = window.__qa;
    g.gotoCheckpoint('bog'); g.step(4);
    // the plateau grunts are dealt with elsewhere; remove them so they do not follow us
    for (const e of ctx.enemies.list()) if (e.position.z < 252) e.alive = false;
    g.step(2);
    L.walkTo(0, 256, 0.6, 900);
    L.walkTo(0, 270.5, 0.6, 900);
    g.setInput({}); g.step(2);
    const P = ctx.player.position;
    const near = ctx.enemies.list().filter((e) => e.position.z > 266 && e.position.z < 304).map((e) => ({ type: e.type, d: qa.r2(Math.hypot(e.position.x - P.x, e.position.z - P.z)), dy: qa.r2(e.position.y - P.y), los: qa.los(e), state: e.state, sees: e.sees }));
    ctx.cameraRig.setView(0, 0.3, 7.5);           // looking straight into the yard (+Z)
    g.setInput({ lock: true }); g.step(1);
    const lt = ctx.player.lockTarget;
    return { pos: [P.x, P.y, P.z].map(qa.r2), near, pick: lt ? { type: lt.type, pos: [lt.position.x, lt.position.y, lt.position.z].map(qa.r2), los: qa.los(lt) } : null };
  });
  await page.evaluate(() => window.__game.setQuality('high'));
  await settledShot(page, h, 'tower-01-lock-pick', 900);
  // throw 6 charged + 6 quick puffs at whatever lock picked, and see where they land
  out.throws = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, qa = window.__qa;
    const hits = [];
    const off = ctx.events.on('projectile:hit', (p) => { if (p.kind !== 'mud') hits.push({ target: p.target ? p.target.type : null, collider: p.collider ? (p.collider === 'terrain' ? 'terrain' : p.collider.tag || p.collider.surface || 'box') : null, y: qa.r2(p.position.y) }); });
    const lt0 = ctx.player.lockTarget;
    for (let k = 0; k < 6; k++) { g.setInput({ lock: true, throw: true }); g.step(58); g.setInput({ lock: true }); g.step(20); }
    for (let k = 0; k < 6; k++) { g.setInput({ lock: true, throw: true }); g.step(1); g.setInput({ lock: true }); g.step(16); }
    g.step(40);
    off();
    const lt = ctx.player.lockTarget;
    return { lockedOn: lt0 && lt0.type, stillLocked: lt === lt0, targetHp: lt0 && lt0.hp, targetAlive: lt0 && lt0.alive, hits, hp: ctx.player.hp, slingers: ctx.entities.query('slinger').filter((e) => e.position.z > 266 && e.position.z < 280).map((e) => ({ state: e.state, sees: e.sees, aware: e.aware, shots: e.shots })) };
  });
  await page.evaluate(() => { const g = window.__game; g.setInput({ lock: true, throw: true }); g.step(30); g.setInput({ lock: true }); g.step(3); });
  await settledShot(page, h, 'tower-02-puff-into-tower', 300);
  return out;
}
