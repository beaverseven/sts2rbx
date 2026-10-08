// QA: Sunken Bog combat in real positions, no god mode.
//  stumps  : hop the five stumps (route jumps) while the stump slinger at (9, 4, 134) lobs mud; count hits / falls
//  sniper  : try to kill that slinger from the shore with real lock-on throws
//  island  : fight the two island-B2 grunts (+ the pad slinger) on the island; watch for bandits entering water
//  pads    : hop the sinking lily pads under the pad slinger, then the island-B3 grunt
//   node tools/scenario.mjs tools/scenarios/qa-combat-bog.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { installLevelHelpers } from './level-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installLevelHelpers(page);
  await installQA(page);
  const SHOTS = process.env.QA_SHOTS !== '0';
  const STAGES = (process.env.QA_STAGES || 'stumps,sniper,island,pads').split(',');
  await page.evaluate(() => { const qa = window.__qa; qa.bot.react = 0.3; qa.bot.jumpThr = [0.0, 0.35]; qa.bot.seed(3); });
  const shot = async (name) => { if (SHOTS) { await page.evaluate(() => window.__game.setQuality('high')); await settledShot(page, h, name, 900); } };
  const out = {};

  if (STAGES.includes('stumps')) {
    out.stumps = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
      const trials = [];
      const sl = ctx.entities.query('slinger').find((e) => Math.hypot(e.position.x - 9, e.position.z - 134) < 1.5);
      for (let k = 0; k < 4; k++) {
        g.gotoCheckpoint('glade'); ctx.player.heal(5); g.step(4);
        L.walkTo(0, 116, 0.6, 1500);
        const h0 = qa.hits.length, s0 = sl.shots;
        const res = [];
        for (const [x, y, z] of [[1.0, 1.9, 123.0], [-1.5, 2.3, 127.4], [1.0, 1.9, 131.8], [-1.2, 2.5, 136.2], [1.0, 2.1, 140.6]]) {
          const r = L.jumpTo({ x, y, z }, { tol: 1.0 });
          res.push(r.ok ? 'ok' : r.fell ? 'FELL' : 'miss');
          if (!r.ok) break;
        }
        if (res[res.length - 1] === 'ok') { const r = L.jumpTo({ x: 0, y: 1.5, z: 147 }, { tol: 2.5 }); res.push(r.ok ? 'B2' : r.fell ? 'FELL' : 'miss'); }
        trials.push({ res, hits: qa.hits.slice(h0).map((x) => [x.src, x.pos ? x.pos.map((v) => +v.toFixed(1)) : null, x.pos ? (x.onGround ? 'ground' : 'air') : '']), shots: sl.shots - s0, hp: ctx.player.hp, slingerState: sl.state });
      }
      return { trials };
    });
  }
  if (STAGES.includes('sniper')) {
    out.sniper = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
      g.gotoCheckpoint('glade'); ctx.player.heal(5); g.step(4);
      L.walkTo(1.5, 117.5, 0.5, 1500);
      const sl = ctx.entities.query('slinger').find((e) => Math.hypot(e.position.x - 9, e.position.z - 134) < 1.5);
      const hits = [];
      const off = ctx.events.on('projectile:hit', (p) => { if (p.kind !== 'mud') hits.push(p.target ? p.target.type : (p.collider === 'water' ? 'water' : p.collider === 'terrain' ? 'terrain' : 'box')); });
      const h0 = qa.hits.length;
      const yaw = Math.atan2(sl.position.x - ctx.player.position.x, sl.position.z - ctx.player.position.z);
      ctx.cameraRig.setView(yaw, 0.3, 7.5);
      g.setInput({ lock: true }); g.step(1);
      const lock = ctx.player.lockTarget ? ctx.player.lockTarget.type : null;
      const d = Math.hypot(sl.position.x - ctx.player.position.x, sl.position.z - ctx.player.position.z);
      let k = 0;
      for (; k < 10 && sl.alive && !sl.dying; k++) { g.setInput({ lock: true, throw: true }); g.step(57); g.setInput({ lock: true }); g.step(20); }
      off(); g.setInput({}); g.step(2);
      return { lock, dist: +d.toFixed(2), throws: k, hits, killed: !sl.alive || sl.dying, hitsTaken: qa.hits.slice(h0).map((x) => x.src), hp: ctx.player.hp };
    });
  }
  if (STAGES.includes('island')) {
    out.island = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
      g.gotoCheckpoint('glade'); ctx.player.heal(5); g.step(4);
      // arrive on B2 the real way (stumps)
      L.walkTo(0, 116, 0.6, 1500);
      for (const [x, y, z] of [[1.0, 1.9, 123.0], [-1.5, 2.3, 127.4], [1.0, 1.9, 131.8], [-1.2, 2.5, 136.2], [1.0, 2.1, 140.6]]) L.jumpTo({ x, y, z }, { tol: 1.0 });
      L.jumpTo({ x: 0, y: 1.5, z: 147 }, { tol: 2.5 });
      ctx.player.heal(5);
      const region = (e) => e.type === 'grunt' && e.position.z > 140 && e.position.z < 160;
      const list = () => ctx.enemies.list().filter(region);
      const r = qa.encounter({ enemies: list, area: { x: 0, z: 151, r: 6 }, maxSteps: 60 * 90, heal: 2 });
      return { ...r, picks: r.picks.map((p) => p.type + '@' + p.d + (p.los ? '' : '(noLOS)')), pos: L.state().pos, hp: ctx.player.hp };
    });
    await shot('bog-01-island-after');
  }
  if (STAGES.includes('pads')) {
    out.pads = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
      const trials = [];
      const sl = ctx.entities.query('slinger').find((e) => Math.hypot(e.position.x + 9.5, e.position.z - 166.5) < 1.5);
      for (let k = 0; k < 4; k++) {
        ctx.player.respawnAt([0, 1.5, 154], 0); ctx.player.heal(5); g.setCamera(0, 0.25, 7.5); g.step(4);
        L.walkTo(0, 156.0, 0.6, 600);
        const h0 = qa.hits.length, s0 = sl ? sl.shots : 0;
        const res = [];
        for (const [x, z] of [[0, 160.5], [-1.4, 164.0], [0.6, 167.5], [-1.0, 171.0], [0, 174.5]]) {
          const r = L.jumpTo({ x, y: 0.36, z }, { tol: 1.0 });
          res.push(r.ok ? 'ok' : r.fell ? 'FELL' : 'miss');
          if (!r.ok) break;
        }
        if (res[res.length - 1] === 'ok') { const r = L.jumpTo({ x: 0, y: 1.25, z: 180.0 }, { tol: 2.2 }); res.push(r.ok ? 'B3' : r.fell ? 'FELL' : 'miss'); }
        trials.push({ res, hits: qa.hits.slice(h0).map((x) => [x.src, x.pos ? x.pos.map((v) => +v.toFixed(1)) : null, x.pos ? (x.onGround ? 'ground' : 'air') : '']), shots: sl ? sl.shots - s0 : null, hp: ctx.player.hp, slinger: sl ? sl.state : 'none' });
      }
      return { trials };
    });
  }
  out.watch = await page.evaluate(() => window.__qa.watchReport());
  return out;
}
