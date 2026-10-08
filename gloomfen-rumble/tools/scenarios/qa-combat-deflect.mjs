// QA: what a player sees when puffs are deflected — an armoured ironbelly in the fort yard and
// Chief Gnarlbelly outside his dizzy window / behind his belly plate. Real lock + throw inputs.
// Screenshots are taken a few steps after the hit (render without stepping).
//   node tools/scenario.mjs tools/scenarios/qa-combat-deflect.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installQA(page);
  const out = {};
  const shotAfterHit = async (name, setup) => {
    const r = await page.evaluate(setup);
    await page.evaluate(() => window.__game.setQuality('high'));
    await h.wait(600);
    await h.shot(name);
    return r;
  };
  // ironbelly: stand 7 m in front of the one at (-16, 285), lock, quick puff, freeze right after the clang
  out.ironbelly = await shotAfterHit('deflect-01-ironbelly-clang', () => {
    const g = window.__game, ctx = g.ctx;
    g.gotoCheckpoint('bog'); g.step(2);
    const ib = ctx.entities.query('ironbelly').find((e) => Math.hypot(e.position.x + 16, e.position.z - 285) < 3);
    for (const e of ctx.enemies.list()) if (e !== ib && e.position.z > 260 && e.position.z < 300) e.alive = false;
    const p = ib.position;
    const x = p.x + 6.5, z = p.z - 3;
    ctx.player.respawnAt([x, 7, z], Math.atan2(p.x - x, p.z - z));
    g.setCamera(Math.atan2(p.x - x, p.z - z), 0.25, 7.5); g.step(3);
    const msgs = [];
    const off = ctx.events.on('ui:message', (m) => msgs.push(m.text));
    const hits = [];
    const off2 = ctx.events.on('projectile:hit', (q) => hits.push({ target: q.target && q.target.type, deflected: q.deflected }));
    g.setInput({ lock: true }); g.step(1);
    let k = 0;
    for (; k < 60 && !hits.length; k++) { g.setInput({ lock: true, throw: k === 0 }); g.step(1); }
    g.step(2);
    off(); off2();
    return { lock: ctx.player.lockTarget && ctx.player.lockTarget.type, hits, msgs, ibHp: ib.hp, armored: ib.armored };
  });
  // a full volley of 4 more puffs: any hint toast?
  out.ironbellyVolley = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx;
    const msgs = [];
    const off = ctx.events.on('ui:message', (m) => msgs.push(m.text));
    for (let k = 0; k < 6; k++) { g.setInput({ lock: true, throw: true }); g.step(1); g.setInput({ lock: true }); g.step(20); }
    g.setInput({}); g.step(30);
    off();
    return { msgs, deflects: window.__qa.count('projectile:hit') };
  });
  // the boss: wake him, throw at him while he walks (boing), then at the plate in phase 2 (clang)
  out.boss = await shotAfterHit('deflect-02-boss-boing', () => {
    const g = window.__game, ctx = g.ctx;
    g.gotoCheckpoint('pit'); g.step(2);
    const b = ctx.enemies.boss();
    ctx.player.respawnAt([0, 2, 386], 0); g.setCamera(0, 0.25, 7.5);
    for (let i = 0; i < 400 && b.state !== 'approach'; i++) g.step(1);
    const hits = [];
    const off = ctx.events.on('projectile:hit', (q) => hits.push({ target: q.target && q.target.type, deflected: q.deflected }));
    g.setInput({ lock: true }); g.step(1);
    for (let k = 0; k < 60 && !hits.length; k++) { g.setInput({ lock: true, throw: k === 0 }); g.step(1); }
    g.step(2); off();
    return { hits, state: b.state, deflected: b.stats.deflected };
  });
  return out;
}
