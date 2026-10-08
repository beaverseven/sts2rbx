// QA: Chief Gnarlbelly start to finish WITHOUT god mode and without debug damage.
// A scripted "good human": real lock-on + throw + jump inputs, dodges only what a player can see
// (shockwave rings, mud landing markers, club/stomp/slide wind-ups), pre-charges before dizzy windows,
// fetches the Anvil jar in phase 2, eats the arena berries when low.
//   node tools/scenario.mjs tools/scenarios/qa-combat-boss.mjs --html dist/index.html --shots dist/qa-combat
// env: QA_SHOTS=0 to skip screenshots, QA_HEAL=<hp at which to fetch a berry> (default 3), QA_MAXSTEPS
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';
import { settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await bootPlaying(page);
  await installQA(page);
  const SHOTS = process.env.QA_SHOTS !== '0';
  const HEAL = Number(process.env.QA_HEAL ?? 3);
  const MAX = Number(process.env.QA_MAXSTEPS ?? 60 * 600);
  const HUMAN = { react: Number(process.env.QA_REACT ?? 0), jumpThr: process.env.QA_JUMP ? process.env.QA_JUMP.split(',').map(Number) : null, seed: Number(process.env.QA_SEED ?? 1), pref: Number(process.env.QA_PREF ?? 9.5), diePhase: Number(process.env.QA_DIE_PHASE ?? 0) };
  await page.evaluate(([heal, H]) => {
    const g = window.__game, ctx = g.ctx, qa = window.__qa, pl = ctx.player;
    qa.bot.react = H.react; qa.bot.jumpThr = H.jumpThr; qa.bot.seed(H.seed);
    g.gotoCheckpoint('pit'); g.step(4);
    const b = qa.boss();
    const C = b.arenaCenter;
    const R = (v) => Math.round(v * 100) / 100;
    const F = qa.fight = { steps: 0, deaths: 0, phaseT: {}, windows: [], phaseHits: {}, notes: [], jarFetches: 0, berries: 0, maxMinions: 0, lockLog: [] };
    let curWindow = null, lastPhase = 0;
    ctx.events.on('pickup:berry', () => F.berries++);
    ctx.events.on('pickup:tonic', (p) => { if (p.kind === 'anvil') F.jarFetches++; });
    qa.bossStep = function () {
      const P = pl.position;
      if (b.phase !== lastPhase) { F.phaseT[b.phase] = R(ctx.time.now); lastPhase = b.phase; }
      // dizzy window bookkeeping
      if (b.state === 'dizzy' && !curWindow) curWindow = { phase: b.phase, t: R(ctx.time.now), hp0: b.hp, kind: b.dizzyKind, dist: R(Math.hypot(P.x - b.position.x, P.z - b.position.z)), plate: b.plateState };
      if (b.state !== 'dizzy' && curWindow) { curWindow.dmg = curWindow.hp0 - b.hp; curWindow.len = R(ctx.time.now - curWindow.t); F.windows.push(curWindow); curWindow = null; }
      if (pl.state === 'dead' || pl.visible === false) { g.setInput({}); g.step(1); F.steps++; return; }
      // deliberately go AFK in front of him to test the death reset (phase 2: after the plate is cracked)
      if (H.diePhase && F.deaths === 0 && b.phase === H.diePhase && (b.phase !== 2 || b.plateState === 'broken') && b.state !== 'phaseShift') {
        if (!F.afkT) F.afkT = R(ctx.time.now);
        g.setInput({}); g.step(1); F.steps++; return;
      }
      const minions = b.minions.filter((e) => e.alive && !e.dying && e.hittable !== false);
      F.maxMinions = Math.max(F.maxMinions, minions.length);
      const anvil = pl.tonic && pl.tonic.kind === 'anvil';
      const o = { boss: b, enemies: minions, area: { x: C.x, z: C.z, r: 18.3 }, pref: H.pref, circle: true, groundY: C.y, target: b, holdLock: true, fire: 'none' };
      const inArena = Math.hypot(P.x - C.x, P.z - C.z) < 20;
      if (!b.fightOn || b.state === 'waiting' || b.state === 'dormant' || !inArena) {
        o.goal = { x: C.x, z: C.z - 4 }; o.goalW = 10; o.target = null; o.pref = null; o.circle = false;
        if (!inArena) o.area = null;
        qa.act(o); F.steps++; return;
      }
      const plateOn = b.plateState === 'belly';
      // berries when low
      if (pl.hp <= heal) {
        let best = null, bd = 1e9;
        for (const e of ctx.entities.query('berry')) { const d = Math.hypot(e.position.x - P.x, e.position.z - P.z); if (d < bd && Math.hypot(e.position.x - C.x, e.position.z - C.z) < 22) { bd = d; best = e; } }
        if (best) { o.goal = { x: best.position.x, z: best.position.z }; o.goalW = 9; o.pref = null; o.circle = false; }
      }
      // phase 2: the plate needs iron
      if (plateOn) {
        if (!anvil) {
          const jar = b.jar;
          if (jar && jar.alive && jar.available) { o.goal = { x: jar.position.x, z: jar.position.z }; o.goalW = 10; o.pref = null; o.circle = false; }
          o.fire = 'none';
        } else {
          const boing = ['wake', 'waiting', 'resume', 'phaseShift', 'celebrate'].includes(b.state);
          o.fire = boing ? 'none' : 'quick';
          o.pref = Math.min(8, H.pref);
        }
      }
      // minions close by: deal with them first (unless the Chief is open right now)
      const dizzyOpen = b.state === 'dizzy' && !plateOn;
      let nm = null, nd = 1e9;
      for (const e of minions) { const d = Math.hypot(e.position.x - P.x, e.position.z - P.z); if (d < nd) { nd = d; nm = e; } }
      if (nm && nd < 11 && !dizzyOpen && !(plateOn && anvil)) { o.target = nm; o.fire = 'quick'; }
      // the dizzy window: charged volleys, quick puffs when the window is almost over
      if (dizzyOpen) {
        o.target = b;
        const remain = 3.0 - b.stateT;
        if (anvil) o.fire = 'quick';
        else if (qa.bot.charging) { o.fire = 'charge'; o.releaseAt = remain < 0.25 ? 0.5 : 1; }
        else o.fire = remain > 1.05 ? 'charge' : 'quick';
      } else if (!plateOn || anvil) {
        // pre-charge just before a dizzy window opens
        const third = b.phase < 3 && ((b.state === 'stompWindup' && b.stompCount === 2) || (b.state === 'stomp' && b.stompCount >= 3));
        const slide = b.phase === 3 && (b.state === 'slideWindup' || b.state === 'slide' || b.state === 'crash');
        if ((third || slide) && !anvil && o.target === b) o.fire = 'hold';
      }
      if (pl.lockTarget && F.lockLog[F.lockLog.length - 1] !== pl.lockTarget.type) F.lockLog.push(pl.lockTarget.type);
      qa.act(o);
      F.steps++;
    };
    qa.runBoss = function (until, max) {
      for (let i = 0; i < max; i++) {
        if (b.defeated || until()) return true;
        const dead = pl.state === 'dead';
        qa.bossStep();
        if (!dead && pl.state === 'dead') F.deaths++;
      }
      return false;
    };
  }, [HEAL, HUMAN]);

  const shot = async (name) => { if (SHOTS) { await page.evaluate(() => window.__game.setQuality('high')); await settledShot(page, h, name, 900); } };
  const run = (untilSrc, max) => page.evaluate(([u, m]) => window.__qa.runBoss((0, eval)(u), m), [untilSrc, max]);
  const snap = () => page.evaluate(() => { const b = window.__qa.boss(), pl = window.__game.ctx.player; return { phase: b.phase, hp: b.hp, state: b.state, plate: b.plateState, php: pl.hp, t: window.__game.ctx.time.now, deaths: window.__qa.fight.deaths }; });

  const timeline = [];
  // wake him up
  await run('() => window.__qa.boss().fightOn && window.__qa.boss().state === "approach"', 1200);
  timeline.push(['awake', await snap()]);
  await shot('boss-01-awake');
  // phase 1 until the first dizzy window opens
  await run('() => window.__qa.boss().state === "dizzy"', 6000);
  timeline.push(['first dizzy', await snap()]);
  await shot('boss-02-first-dizzy');
  await run('() => window.__qa.boss().phase >= 2 && window.__qa.boss().state === "summon"', 9000);
  timeline.push(['phase 2', await snap()]);
  await shot('boss-03-phase2-summon');
  await run('() => window.__qa.boss().plateState !== "belly" || window.__qa.boss().phase >= 3', 9000);
  timeline.push(['plate', await snap()]);
  await shot('boss-04-plate-broken');
  if (HUMAN.diePhase === 2) {
    const deathInfo = {};
    await run('() => window.__game.ctx.player.state === "dead"', 6000);
    deathInfo.atDeath = await page.evaluate(() => { const qa = window.__qa, b = qa.boss(), ctx = window.__game.ctx; return { afkT: qa.fight.afkT, t: ctx.time.now, hitsWhileAfk: qa.hits.filter((x) => x.t >= qa.fight.afkT).map((x) => [x.t, x.src, x.bossState]), bossState: b.state, minions: b.minions.filter((e) => e.alive).length }; });
    await page.evaluate(() => { const g = window.__game; g.setInput({}); g.step(30); });
    await shot('boss-death-01-splat');
    deathInfo.splat = await page.evaluate(() => { const qa = window.__qa, b = qa.boss(), ctx = window.__game.ctx; return { state: ctx.state, bossState: b.state, minionStates: b.minions.map((e) => e.alive ? e.state : 'gone') }; });
    await run('() => window.__game.ctx.player.state !== "dead"', 400);
    await page.evaluate(() => { const g = window.__game; g.setInput({}); g.step(2); });
    deathInfo.afterRespawn = await page.evaluate(() => {
      const qa = window.__qa, b = qa.boss(), ctx = window.__game.ctx, pl = ctx.player;
      const gate = ctx.entities.list.find((e) => e.def && e.def.id === 'pitGate');
      const jar = b.jar;
      return { pos: [pl.position.x, pl.position.y, pl.position.z].map(qa.r2), hp: pl.hp, cp: pl.checkpoint.id, bossState: b.state, bossHp: b.hp, phase: b.phase, plate: b.plateState, bossPos: [b.position.x, b.position.z].map(qa.r2),
        minionsAlive: b.minions.filter((e) => e.alive).length, gruntsInPit: ctx.entities.query('grunt').filter((e) => Math.hypot(e.position.x, e.position.z - 395) < 23).length,
        gateOpen: gate ? (gate.isOpen ?? gate.open ?? gate.state) : 'no gate entity', jar: jar ? { alive: jar.alive, available: jar.available, pos: [jar.position.x, jar.position.z].map(qa.r2) } : null,
        berries: ctx.entities.query('berry').filter((e) => Math.hypot(e.position.x, e.position.z - 395) < 23).length, bossBar: ctx.hud.bossVisible, tonic: pl.tonic && pl.tonic.kind,
        mudAlive: ctx.projectiles.active.filter((p) => p.alive && p.team === 'enemy').length, waves: ctx.enemies.fx.waves.filter((w) => w.active).length };
    });
    await shot('boss-death-02-respawn');
    await run('() => window.__qa.boss().state === "resume"', 3000);
    await page.evaluate(() => { const g = window.__game; g.step(40); });
    deathInfo.resumed = await page.evaluate(() => { const qa = window.__qa, b = qa.boss(), ctx = window.__game.ctx; return { bossState: b.state, gateClosed: ctx.entities.list.filter((e) => e.def && e.def.id === 'pitGate').map((e) => e.isOpen), bossBar: ctx.hud.bossVisible, t: ctx.time.now }; });
    await shot('boss-death-03-resume');
    timeline.push(['death', deathInfo]);
  }
  await run('() => window.__qa.boss().phase >= 3 && window.__qa.boss().state === "slideWindup"', 12000);
  timeline.push(['phase 3 slide', await snap()]);
  await shot('boss-05-slide-windup');
  await run('() => false', MAX);
  timeline.push(['end', await snap()]);
  await shot('boss-06-end');

  return await page.evaluate((tl) => {
    const qa = window.__qa, F = qa.fight, b = qa.boss();
    const byPhase = {};
    for (const hh of qa.hits) { const k = hh.phase ?? 0; (byPhase[k] = byPhase[k] || []).push(hh.src); }
    return {
      human: { react: qa.bot.react, jumpThr: qa.bot.jumpThr },
      timeline: tl, defeated: b.defeated, bossHp: b.hp, phase: b.phase, deaths: F.deaths, steps: F.steps, simSeconds: window.__game.ctx.time.now,
      hitsByPhase: byPhase, hits: qa.hits, windows: F.windows, phaseT: F.phaseT, berries: F.berries, jarFetches: F.jarFetches,
      maxMinions: F.maxMinions, lockLog: F.lockLog.slice(0, 40), bot: { dodgeJumps: qa.bot.dodgeJumps, throws: qa.bot.throws, charged: qa.bot.charged },
      stats: b.stats, evlog: qa.evlog.slice(-120),
    };
  }, timeline);
}
