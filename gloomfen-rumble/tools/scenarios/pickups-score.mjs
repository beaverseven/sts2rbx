// Score + combo rules (pickups sandbox).
//   node tools/scenario.mjs tools/scenarios/pickups-score.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  // 1) walking through the glowcap line raises score and chain; x2 from the 5th cap
  const walk = await h.game((g) => {
    const sc = g.ctx.score;
    g.godMode(true);
    g.teleport(0, 1, 0.5, 0); g.setCamera(0, 0.3, 7.5); g.step(5);
    sc.reset(); g.clearEvents();
    g.setInput({ move: [0, 1] }); g.step(100); g.setInput({}); g.step(2);
    const awards = g.events('score:award').map((e) => e.payload);
    return {
      glowcaps: sc.glowcaps, chain: sc.chain, points: sc.points, mult: sc.multiplier,
      pickups: g.events('pickup:glowcap').length,
      awardMults: awards.map((a) => a.multiplier), awardPoints: awards.map((a) => a.points), reasons: [...new Set(awards.map((a) => a.reason))],
      state: g.state().combo,
    };
  });
  check('walking the 8-cap line collects all 8 (pickup:glowcap x8)', walk.glowcaps === 8 && walk.pickups === 8, walk);
  check('chain = 8 and multiplier x2 after 8 events', walk.chain === 8 && walk.mult === 2, walk.state);
  check('awards: 4 x1 then x2 from the 5th (50,50,50,50,100,100,100,100 = 600)', walk.points === 600 && walk.awardMults.join() === '1,1,1,1,2,2,2,2', walk.awardPoints);
  await h.wait(300);
  await h.shot('score-after-line');

  // 2) multiplier steps by chain length (1-4 x1, 5-9 x2, 10-19 x3, 20-34 x4, 35-49 x5, 50+ x6)
  const steps = await h.game((g) => {
    const sc = g.ctx.score;
    sc.reset();
    const at = {};
    for (let i = 1; i <= 55; i++) { sc.award(10, 'test'); at[i] = sc.multiplier; }
    return { at, chain: sc.chain, best: sc.bestChain };
  });
  const want = { 1: 1, 4: 1, 5: 2, 9: 2, 10: 3, 19: 3, 20: 4, 34: 4, 35: 5, 49: 5, 50: 6, 55: 6 };
  const bad = Object.entries(want).filter(([c, m]) => steps.at[c] !== m);
  check('multiplier steps at chain 5/10/20/35/50', bad.length === 0, { bad, sample: want });

  // 3) the timer lapses after 3 s without a scoring event -> combo:end
  const lapse = await h.game((g) => {
    const sc = g.ctx.score;
    g.clearEvents();
    g.step(60); // 1 s of draining
    const updates1s = g.events('combo:update').length;
    const mid = { chain: sc.chain, timeLeft: Math.round(sc.timeLeft * 100) / 100 };
    g.step(125); // past 3.0 s total
    const end = g.events('combo:end').map((e) => e.payload);
    return { updates1s, mid, end, chainAfter: sc.chain, multAfter: sc.multiplier, best: sc.bestChain };
  });
  check('throttled combo:update ~10 Hz while the timer drains', lapse.updates1s >= 8 && lapse.updates1s <= 12, lapse.updates1s);
  check('chain survives 1 s (timeLeft ~2.0)', lapse.mid.chain === 55 && Math.abs(lapse.mid.timeLeft - 2.0) < 0.05, lapse.mid);
  check('timer lapse emits combo:end {chain 55, reason timeout} and resets to x1', lapse.end.length === 1 && lapse.end[0].chain === 55 && lapse.end[0].reason === 'timeout' && lapse.chainAfter === 0 && lapse.multAfter === 1, lapse.end);
  check('bestChain remembers 55', lapse.best === 55, lapse.best);

  // 4) a scoring event inside the window extends the chain; outside it starts a new one
  const windowT = await h.game((g) => {
    const sc = g.ctx.score;
    sc.reset();
    sc.award(50, 't'); g.step(170); sc.award(50, 't'); // 2.83 s later: extends
    const a = sc.chain;
    g.step(185); sc.award(50, 't'); // 3.08 s later: lapsed in between -> new chain
    return { a, b: sc.chain };
  });
  check('event at 2.8 s extends the chain, after 3.1 s a new chain starts', windowT.a === 2 && windowT.b === 1, windowT);

  // 5) getting hurt drains the timer -> combo:end (reason hurt)
  const hurt = await h.game((g) => {
    const sc = g.ctx.score, pl = g.player;
    sc.reset(); g.godMode(false);
    for (let i = 0; i < 6; i++) sc.award(50, 't');
    g.clearEvents();
    pl.damage(1, pl.position.clone().setZ(pl.position.z + 1));
    const end = g.events('combo:end').map((e) => e.payload);
    const upd = g.events('combo:update').map((e) => e.payload);
    const r = { end, lastUpdate: upd[upd.length - 1], chain: sc.chain, timeLeft: sc.timeLeft, hp: pl.hp };
    pl.heal(5); g.godMode(true); g.step(90);
    return r;
  });
  check('player:hurt drains the combo: combo:end reason hurt, timeLeft 0', hurt.end.length === 1 && hurt.end[0].reason === 'hurt' && hurt.end[0].chain === 6 && hurt.chain === 0 && hurt.timeLeft === 0 && hurt.lastUpdate.timeLeft === 0, hurt);

  // 6) other sources: dummy kills (sandbox override 100), cage/berry/boss events, kills counter
  const sources = await h.game((g) => {
    const sc = g.ctx.score, ev = g.ctx.events;
    sc.reset(); g.clearEvents();
    ev.emit('enemy:killed', { entity: null, type: 'grunt', position: g.player.position.clone(), points: 200 });
    ev.emit('enemy:killed', { entity: null, type: 'slinger', position: g.player.position.clone() }); // no points -> table 250
    ev.emit('boss:phase', { phase: 1 });  // fight start: no points
    ev.emit('boss:phase', { phase: 2 });  // 2000
    ev.emit('boss:phase', { phase: 2 });  // duplicate: ignored
    ev.emit('boss:phase', { phase: 3 });  // 2000
    ev.emit('boss:defeated', { position: g.player.position.clone() }); // 5000
    ev.emit('boss:defeated', { position: g.player.position.clone() }); // ignored
    const aw = g.events('score:award').map((e) => [e.payload.reason, e.payload.base, e.payload.multiplier, e.payload.points]);
    return { aw, kills: sc.kills, byType: sc.killsByType, points: sc.points, chain: sc.chain };
  });
  const expectPts = 200 + 250 + 2000 + 2000 + 5000; // chain 1..5 -> the 5th (boss) is x2
  check('enemy/boss awards: grunt 200, slinger 250 (table), phase 2 & 3 2000 each, defeat 5000 (x2 as 5th in chain)',
    sources.aw.length === 5 && sources.points === expectPts + 5000 && sources.kills === 2, sources);

  // 7) dummy kills with the sandbox override count as 100-point kills
  const dummy = await h.game((g) => {
    const sc = g.ctx.score;
    sc.reset(); g.clearEvents();
    const d = g.ctx.entities.list.find((e) => e.type === 'dummy' && e.hittable);
    for (let i = 0; i < 3; i++) d.hurt(1, { dir: g.player.position.clone().set(0, 0, 1), kind: 'puff' });
    return { kills: sc.kills, points: sc.points, aw: g.events('score:award').map((e) => e.payload.reason) };
  });
  check('dummy kill (sandbox override 100) scores as an enemy kill', dummy.kills === 1 && dummy.points === 100, dummy);

  // 8) play clock only runs while playing; deaths counter; snapshot/ranks
  const clock = await h.game((g) => {
    const sc = g.ctx.score, ctx = g.ctx;
    sc.reset();
    g.step(60);
    const a = sc.elapsed;
    ctx.setState('paused'); g.step(60); const b = sc.elapsed; ctx.setState('playing');
    g.godMode(false); g.player.die(); g.step(110); g.godMode(true);
    const snap = sc.snapshot();
    const ranks = [[96, 100], [95, 100], [80, 100], [79, 100], [60, 100], [59, 100], [35, 100], [10, 100]].map(([t, m]) => sc.computeRank(t, m));
    return { a, b, deaths: sc.deaths, keys: Object.keys(snap), snap, ranks, info: sc.rankInfo(0, 1000), max: sc.maxPossible(), state: ctx.state };
  });
  check('elapsed advances 1.0 s while playing and not while paused', Math.abs(clock.a - 1) < 0.02 && Math.abs(clock.b - clock.a) < 1e-6, clock);
  check('player:died counts a death; back to playing after the 1.6 s splat', clock.deaths === 1 && clock.state === 'playing', clock.deaths);
  const needKeys = ['total', 'chain', 'multiplier', 'bestChain', 'glowcaps', 'glowcapsTotal', 'cagesFreed', 'cagesTotal', 'kills', 'elapsed', 'deaths', 'maxPossible'];
  check('snapshot() has every counter', needKeys.every((k) => clock.keys.includes(k)), clock.keys);
  check('computeRank thresholds 95/80/60 (+Bronze floor)', clock.ranks.join() === 'Glowing,Glowing,Gold,Silver,Silver,Bronze,Bronze,Bronze', clock.ranks);
  check('maxPossible counts glowcaps/cages/boss (22 caps, 2 cages in the sandbox)', clock.snap.glowcapsTotal === 22 && clock.snap.cagesTotal === 2 && clock.max > 0, { max: clock.max, snap: clock.snap });

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
