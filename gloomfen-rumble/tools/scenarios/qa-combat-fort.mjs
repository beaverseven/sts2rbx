// QA: real-position fights without god mode — bog plateau grunts, then the Bandit Fort outer yard
// (4 grunts, 2 tower slingers, 3 ironbellies, Anvil jar), the ambush courtyard (2 waves) and the back yard.
// The bot plays like a human: aims the camera at the nearest bandit, presses lock, takes the game's pick,
// throws charged puffs at range and quick puffs up close, fetches the Anvil jar for armoured ironbellies,
// dodges visible telegraphs and does not run into the bog or off ledges.
//   node tools/scenario.mjs tools/scenarios/qa-combat-fort.mjs --html dist/index.html --shots dist/qa-combat
// env: QA_SHOTS=0, QA_REACT (default 0.3), QA_STAGES=plateau,yard,court,back
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { installLevelHelpers } from './level-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installLevelHelpers(page);
  await installQA(page);
  const SHOTS = process.env.QA_SHOTS !== '0';
  const STAGES = (process.env.QA_STAGES || 'plateau,yard,court,back').split(',');
  const REACT = Number(process.env.QA_REACT ?? 0.3);
  await page.evaluate((react) => { const qa = window.__qa; qa.bot.react = react; qa.bot.jumpThr = [0.0, 0.35]; qa.bot.seed(7); }, REACT);
  const shot = async (name) => { if (SHOTS) { await page.evaluate(() => window.__game.setQuality('high')); await settledShot(page, h, name, 900); } };
  const out = {};

  if (STAGES.includes('plateau')) {
    out.plateau = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa;
      g.gotoCheckpoint('bog'); g.step(4);
      const region = (e) => e.type !== 'boss' && e.position.z > 220 && e.position.z < 252 && Math.abs(e.position.x) < 18 && e.position.y < 12;
      const list = () => ctx.enemies.list().filter(region);
      const n0 = list().length;
      const r = qa.encounter({ enemies: list, area: { x: 0, z: 238, r: 12 }, maxSteps: 3600, heal: 2 });
      return { n0, ...r, hp: ctx.player.hp };
    });
  }
  if (STAGES.includes('yard')) {
    out.yardWalk = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, L = window.__lv;
      if (!ctx.player.checkpoint || ctx.player.checkpoint.id !== 'bog') { g.gotoCheckpoint('bog'); g.step(4); }
      ctx.player.heal(5);
      const a = L.walkTo(0, 256, 0.6, 900);
      const b = L.walkTo(0, 271, 0.6, 900);
      return { a: a.ok, b: b.ok, pos: L.state().pos, hp: ctx.player.hp };
    });
    await shot('fort-01-yard-enter');
    out.yard = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa;
      const region = (e) => e.type !== 'boss' && e.position.z > 266 && e.position.z < 304 && Math.abs(e.position.x) < 32 && e.position.y < 11; // tower slingers: unreachable (qa-combat-towergrid)
      const list = () => ctx.enemies.list().filter(region);
      const n0 = list().map((e) => e.type);
      const r = qa.encounter({ enemies: list, area: { x: 0, z: 287, r: 17 }, maxSteps: Number(window.__qaYardSteps || 60 * 150), heal: 2, jars: [{ x: 6, z: 297 }], trace: 60 });
      return { n0, ...r, hp: ctx.player.hp, deaths: qa.count('player:died') };
    });
    await shot('fort-02-yard-after');
  }
  if (STAGES.includes('court')) {
    out.court = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
      if (!ctx.flags.gateFortOpen) {
        // open the iron gate the real way: Anvil jar, iron throw at the gate
        const jar = ctx.entities.query('tonic').find((e) => Math.hypot(e.position.x - 6, e.position.z - 297) < 1.5);
        L.walkTo(4.5, 297, 0.4, 900);
        for (let k = 0; k < 600 && jar && !jar.available; k++) g.step(1);
        L.walkTo(6, 297, 0.3, 900); g.step(5);
        L.walkTo(0, 301.5, 0.4, 600);
        L.walkTo(0, 303.2, 0.3, 300);   // face the gate
        for (let k = 0; k < 6 && !ctx.flags.gateFortOpen; k++) { L.aim(0, 306); g.setInput({ move: [0, 0.3], throw: true }); g.step(1); g.setInput({ move: [0, 0.3] }); g.step(40); }
        g.setInput({}); g.step(2);
      }
      const gate = !!ctx.flags.gateFortOpen;
      ctx.player.heal(5);
      L.walkTo(0, 306, 0.5, 600);
      L.walkTo(0, 313, 0.5, 600);
      const t0 = ctx.time.now;
      const lock = qa.evlog.find((x) => x.n === 'arena:lock');
      const list = () => ctx.enemies.list().filter((e) => e.position.z > 309 && e.position.z < 333 && Math.abs(e.position.x) < 16);
      const rounds = [];
      for (let k = 0; k < 8 && !ctx.flags.arenaClear_courtyard; k++) {
        g.step(20);
        const rr = qa.encounter({ enemies: list, area: { x: 0, z: 320, r: 11 }, maxSteps: 60 * 90, heal: 2, until: () => ctx.flags.arenaClear_courtyard });
        if (rr.steps) rounds.push({ steps: rr.steps, kills: rr.kills, hits: rr.hits, oddPicks: rr.oddPicks, picks: rr.picks.map((p) => p.type + '@' + p.d + (p.los ? '' : '(noLOS)')), deaths: rr.deaths, left: rr.left });
      }
      const r = { rounds, waves: qa.evlog.filter((x) => x.n === 'arena:wave' || x.n === 'arena:clear').length };
      const r2 = null;
      return { gate, locked: !!lock, ...r, r2, clear: !!ctx.flags.arenaClear_courtyard, secs: ctx.time.now - t0, hp: ctx.player.hp, deaths: qa.count('player:died') };
    });
    await shot('fort-03-court-after');
  }
  if (STAGES.includes('back')) {
    out.back = await page.evaluate(() => {
      const g = window.__game, ctx = g.ctx, qa = window.__qa, L = window.__lv;
      ctx.player.heal(5);
      L.walkTo(0, 331, 0.6, 600);
      L.walkTo(0, 335, 0.6, 600);
      const region = (e) => e.type !== 'boss' && e.position.z > 332 && e.position.z < 362 && Math.abs(e.position.x) < 20 && e.position.y < 11;
      const list = () => ctx.enemies.list().filter(region);
      const n0 = list().map((e) => e.type);
      const r = qa.encounter({ enemies: list, area: { x: 0, z: 342, r: 10 }, maxSteps: 60 * 150, heal: 2, jars: [{ x: 5.5, z: 338.5 }] });
      return { n0, ...r, hp: ctx.player.hp, deaths: qa.count('player:died') };
    });
    await shot('fort-04-back-after');
  }
  out.watch = await page.evaluate(() => window.__qa.watchReport());
  out.allHits = await page.evaluate(() => window.__qa.hits);
  return out;
}
