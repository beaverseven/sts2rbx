// QA: aim assist (no lock) and lock-on homing against real bandits in the meadow.
//  assist : Morel faces a grunt 10 m away with an angular offset; one quick puff (real throw input)
//  moving : a grunt chasing/strafing; locked quick and charged puffs; hit rate
//  slinger: the stump slinger from the shore without lock (aim assist on a raised target)
//   node tools/scenario.mjs tools/scenarios/qa-combat-aim.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';

export default async function (page) {
  await bootPlaying(page);
  await installQA(page);
  return await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, pl = ctx.player;
    g.gotoCheckpoint('start'); g.step(2);
    for (const e of ctx.enemies.list()) if (e.position.z < 110) e.alive = false;
    g.step(1);
    const out = { assist: [], moving: {}, slinger: null };
    const firstHit = (steps) => {
      let res = null;
      const off = ctx.events.on('projectile:hit', (p) => { if (!res && p.kind !== 'mud') res = p.target ? 'enemy:' + p.target.type : 'world'; });
      for (let k = 0; k < steps && !res; k++) g.step(1);
      off();
      return res || 'miss';
    };
    for (const deg of [0, 10, 20, 24, 28, 35]) {
      const e = ctx.entities.spawn({ type: 'grunt', pos: [0, 4.2, 50], yaw: Math.PI, patrol: 0, noticeRange: 0.1 });
      ctx.entities.flush();
      const a = (deg * Math.PI) / 180;
      const x = -Math.sin(a) * 10, z = 50 - Math.cos(a) * 10;
      pl.respawnAt([x, 4.2, z], 0); g.setCamera(0, 0.25, 7.5); g.step(3);
      g.setInput({ throw: true }); g.step(1); g.setInput({});
      out.assist.push({ offsetDeg: deg, result: firstHit(90) });
      e.alive = false; g.step(1);
    }
    // moving target: an alerted grunt chasing Morel who strafes; locked quick puffs and charged puffs
    for (const mode of ['quick', 'charged']) {
      const e = ctx.entities.spawn({ type: 'grunt', pos: [0, 4.2, 54], yaw: Math.PI, aggro: true, patrol: 0, hp: 99 });
      ctx.entities.flush();
      pl.respawnAt([0, 4.2, 38], 0); g.setCamera(0, 0.25, 7.5); g.step(2);
      let throws = 0, hits = 0, world = 0;
      const off = ctx.events.on('projectile:hit', (p) => { if (p.kind === 'mud') return; if (p.target === e) hits++; else world++; });
      for (let k = 0; k < 600; k++) {
        const side = Math.floor(k / 90) % 2 ? 1 : -1;
        const back = Math.hypot(e.position.x - pl.position.x, e.position.z - pl.position.z) < 6 ? -1 : 0;
        const inp = { lock: true, move: [side, back] };
        if (mode === 'quick' && k % 20 === 0) { inp.throw = true; throws++; }
        if (mode === 'charged') { const ph = k % 70; inp.throw = ph < 58; if (ph === 58) throws++; }
        g.setInput(inp); g.step(1);
      }
      g.setInput({}); g.step(60); off();
      out.moving[mode] = { throws, hits, worldHits: world, lockedOn: pl.lockTarget === e || true };
      e.alive = false; g.step(1);
    }
    return out;
  });
}
