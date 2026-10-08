// QA: the first fights (Mossy Glade grunts) played from the start with real inputs, no god mode.
// Walk + jump the tutorial ledge, fight the meadow grunts with the human-style bot, then the ridge, the
// ravine glide and the two grunts at the glade lantern. Also a deliberately sloppy "button-masher"
// pass (stands still, holds lock, taps throw) to see how much a beginner gets hit.
//   node tools/scenario.mjs tools/scenarios/qa-combat-glade.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { installLevelHelpers } from './level-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installLevelHelpers(page);
  await installQA(page);
  const SHOTS = process.env.QA_SHOTS !== '0';
  await page.evaluate(() => { const qa = window.__qa; qa.bot.react = 0.3; qa.bot.jumpThr = [0.0, 0.35]; qa.bot.seed(5); });
  const shot = async (name) => { if (SHOTS) { await page.evaluate(() => window.__game.setQuality('high')); await settledShot(page, h, name, 900); } };
  const out = {};
  out.meadow = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
    L.walkTo(0, 24, 0.6, 1500);
    L.jumpTo({ x: 0, y: 4.2, z: 31.5 }, { jumpAt: 3.8 });
    const list = () => ctx.enemies.list().filter((e) => e.position.z > 30 && e.position.z < 62);
    const r = qa.encounter({ enemies: list, area: { x: 0, z: 46, r: 12 }, maxSteps: 60 * 90, heal: 2 });
    return { ...r, picks: r.picks.map((p) => p.type + '@' + p.d + (p.los ? '' : '(noLOS)')), hp: ctx.player.hp };
  });
  out.lantern = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
    L.walkTo(0.5, 66, 0.6, 1500);
    L.jumpTo({ x: 0, y: 5.0, z: 88 }, { glide: true, tol: 4 });
    const list = () => ctx.enemies.list().filter((e) => e.position.z > 84 && e.position.z < 110);
    const r = qa.encounter({ enemies: list, area: { x: 0, z: 97, r: 10 }, maxSteps: 60 * 90, heal: 2 });
    return { ...r, picks: r.picks.map((p) => p.type + '@' + p.d + (p.los ? '' : '(noLOS)')), hp: ctx.player.hp };
  });
  // beginner: respawn the glade grunts, stand at the meadow, hold lock and tap throw, never dodge
  out.masher = await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, qa = window.__qa;
    g.gotoCheckpoint('start'); ctx.player.heal(5); g.step(2);
    const defs = [[-4, 43], [5, 46.5], [-2, 56]];
    const spawned = defs.map(([x, z]) => ctx.entities.spawn({ type: 'grunt', pos: [x, 4.2, z], yaw: Math.PI }));
    ctx.entities.flush();
    ctx.player.respawnAt([0, 4.2, 36], 0); g.setCamera(0, 0.25, 7.5); g.step(2);
    const h0 = qa.hits.length, t0 = ctx.time.now;
    let i = 0;
    for (; i < 60 * 40 && spawned.some((e) => e.alive && !e.dying) && ctx.player.state !== 'dead'; i++) {
      const lockOn = ctx.player.lockTarget && ctx.player.lockTarget.alive;
      g.setInput({ lock: lockOn || i % 20 !== 0, throw: i % 18 === 0 });
      g.step(1);
    }
    g.setInput({}); g.step(1);
    return { secs: +(ctx.time.now - t0).toFixed(2), killed: spawned.filter((e) => !e.alive || e.dying).length, hits: qa.hits.slice(h0).map((x) => x.src), hp: ctx.player.hp, dead: ctx.player.state === 'dead' || qa.count('player:died') > 0 };
  });
  await shot('glade-01-after-masher');
  out.watch = await page.evaluate(() => window.__qa.watchReport());
  return out;
}
