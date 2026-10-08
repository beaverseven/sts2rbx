// End-to-end playthrough of the shipped build (dist/index.html):
//   title renders -> Start (real Enter key) -> walk/jump the opening (real W/Space keys, then scripted
//   input) -> fight the first grunts with real throws -> every checkpoint in order (teleport, zone event,
//   music, screenshot, draw calls, a few seconds of simulation) -> a slinger and an ironbelly (Anvil)
//   with real throws -> Chief Gnarlbelly to completion (god mode) -> Lantern Gate -> results screen
//   -> Play again (real Enter key) resets the whole run.
//   node tools/scenario.mjs tools/scenarios/integ-playthrough.mjs --html dist/index.html --shots dist/integ/shots
import { installIntegHelpers, watchConsole, waitForGame, settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  const consoleLog = watchConsole(page);
  await page.reload();                         // capture console output from the very first line
  await waitForGame(page, 'title');
  await installIntegHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const perf = [];

  // ------------------------------------------------------------------ title
  await h.wait(2500);
  await h.game((g) => g.setQuality('high'));
  await settledShot(page, h, '01-title', 800);
  const t0 = await h.game((g) => ({
    state: g.ctx.state, menu: g.ctx.menus.current, track: g.ctx.audio.track,
    counts: g.ctx.entities.countByTag(), entities: g.ctx.entities.list.length,
    max: g.ctx.score.maxPossible(), base: g.ctx.score.levelBase, glowcaps: g.ctx.score.glowcapsTotal, cages: g.ctx.score.cagesTotal,
    logo: !!document.querySelector('.menu-title.is-on, .menu.menu-title'),
  }));
  check('title screen: state title, title menu, title music, world built', t0.state === 'title' && t0.menu === 'title' && t0.track === 'title' && t0.entities > 250, { ...t0, counts: undefined });
  check('score maximum pinned to the whole level (159 glowcaps, 8 cages, every bandit, boss)', t0.glowcaps === 159 && t0.cages === 8 && t0.base > 25000 && t0.max === Math.round(t0.base * 1.8), { base: t0.base, max: t0.max });

  // ------------------------------------------------------------------ start with the real keyboard
  await page.keyboard.press('Enter');
  await waitForGame(page, 'playing', 20000);
  await page.waitForFunction(() => window.__it.count('zone:enter') > 0, null, { timeout: 20000 });
  const s1 = await h.game((g) => ({ ...window.__it.snap(), audio: g.ctx.audio.state, zones: g.events('zone:enter').map((e) => e.payload.id) }));
  check('Enter on Start -> playing, glade zone, glade music, audio unlocked', s1.state === 'playing' && s1.zones[0] === 'glade' && s1.track === 'glade' && s1.audio === 'running', s1);

  // real keys in real time: W runs forward, Space jumps
  const z0 = s1.pos[2];
  await page.keyboard.down('KeyW');
  await page.waitForFunction((z) => window.__game.ctx.player.position.z > z + 2, z0, { timeout: 30000 }).catch(() => {});
  const jumps0 = await h.game(() => window.__it.count('player:jump'));
  await page.keyboard.press('Space');
  await page.waitForFunction((n) => window.__it.count('player:jump') > n, jumps0, { timeout: 15000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const s2 = await h.game(() => ({ ...window.__it.snap(), jumps: window.__it.count('player:jump') }));
  check('real W key runs Morel forward, real Space jumps', s2.pos[2] > z0 + 2 && s2.jumps > jumps0, { z0, z: s2.pos[2], jumps: s2.jumps });
  await h.game((g) => g.setQuality('high'));
  await settledShot(page, h, '02-opening-run', 600);

  // ------------------------------------------------------------------ the opening: tutorial ledge + first grunts
  const r3 = await h.game((g) => {
    const L = window.__lv, it = window.__it;
    g.step(1);                                           // manual stepping from here on
    const log = [];
    log.push(['meadow', L.walkTo(0, 24, 0.6, 1500).ok]);
    log.push(['ledge', L.jumpTo({ x: 0, y: 4.2, z: 31.5 }, { jumpAt: 3.8 }).ok]);
    const grunts = () => g.ctx.entities.query('grunt').filter((e) => e.position.z < 60 && e.alive && !e.dying);
    const before = grunts().length;
    const f = it.fight(() => (it.kills.grunt || 0) >= 2, { target: () => grunts().sort((a, b) => a.position.distanceTo(g.ctx.player.position) - b.position.distanceTo(g.ctx.player.position))[0], maxSteps: 2400 });
    return { log, before, fight: f, kills: { ...it.kills }, hurts: g.events('enemy:hurt').length, snap: it.snap(), score: g.ctx.score.points };
  });
  check('opening: meadow walk + tutorial ledge jump (scripted input)', r3.log.every((l) => l[1]), r3.log);
  check('fight: two glade grunts killed with real lock-on throws, score awarded', (r3.kills.grunt || 0) >= 2 && r3.score >= 400, { fight: r3.fight, kills: r3.kills, score: r3.score, hp: r3.snap.hp });
  await h.game((g) => { const pl = g.ctx.player; g.setCamera(pl.yaw + 0.5, 0.3, 7.5); g.step(1); });
  await settledShot(page, h, '03-after-grunts', 700);

  // continue the glade route on foot to the glade checkpoint (ravine glide)
  const r4 = await h.game((g) => {
    const L = window.__lv;
    const pl = g.ctx.player;
    const log = [];
    const ok = (n, r) => { log.push([n, !!r.ok]); if (pl.hp <= 2) pl.heal(pl.maxHp); return r.ok; };
    ok('fern meadow', L.walkTo(-1.5, 45, 0.6, 1500));
    ok('ridge', L.walkTo(0.5, 66, 0.6, 1500));
    ok('ravine glide', L.jumpTo({ x: 0, y: 5.0, z: 88 }, { glide: true, tol: 4 }));
    ok('glade checkpoint', L.walkTo(1, 100, 0.6, 1500));
    g.step(30);
    return { log, cp: pl.checkpoint.id, reached: g.events('checkpoint:reached').map((e) => e.payload.id), snap: window.__it.snap() };
  });
  check('glade route on foot: ridge, ravine glide, glade lantern lights (checkpoint:reached glade)', r4.log.every((l) => l[1]) && r4.cp === 'glade' && r4.reached.includes('glade'), r4);

  // ------------------------------------------------------------------ every checkpoint in order
  const expect = { start: ['glade', 'glade'], glade: ['glade', 'glade'], bog: ['bog', 'bog'], fort: ['fort', 'fort'], pit: ['pit', null] };
  const cps = await h.game((g) => g.checkpoints().map((c) => c.id));
  check('checkpoints in order', cps.join() === 'start,glade,bog,fort,pit', cps);
  for (const id of cps) {
    const r = await h.game((g, id2) => {
      const it = window.__it;
      g.godMode(true);
      const z0 = it.count('zone:enter');
      g.gotoCheckpoint(id2);
      g.step(6);
      const zones = g.events('zone:enter').slice(-(it.count('zone:enter') - z0) || 0).map((e) => e.payload.id);
      const after = it.snap();
      const err0 = g.ctx.audio.stats ? g.ctx.audio.stats.errors : 0;
      g.step(180);                                     // three seconds of simulation at the checkpoint
      g.ctx.player.heal(5);
      return { zones: it.count('zone:enter') > z0 ? zones : [], after, end: it.snap(), audioErrors: (g.ctx.audio.stats ? g.ctx.audio.stats.errors : 0) - err0 };
    }, id);
    await h.game((g) => g.setQuality('high'));
    await h.wait(900);
    const dc = await h.game(() => window.__it.drawCalls());
    perf.push({ at: id, ...dc });
    await settledShot(page, h, `04-checkpoint-${id}`);
    const [zone, track] = expect[id];
    const zoneOk = r.after.zone === zone && (id === 'start' || id === 'glade' || r.zones.includes(zone));
    check(`checkpoint ${id}: zone ${zone} (event fired on entry), music ${track}, 3 s of simulation`, zoneOk && r.end.track === track && r.end.state === 'playing' && r.audioErrors === 0, { zones: r.zones, zone: r.after.zone, track: r.end.track, pos: r.end.pos, drawCalls: dc });
  }

  // ------------------------------------------------------------------ a slinger and an ironbelly, real throws
  const r5 = await h.game((g) => {
    const it = window.__it, ctx = g.ctx;
    g.godMode(false); ctx.player.heal(5);
    const near = (type, x, z) => ctx.entities.query(type).filter((e) => !e.dying).sort((a, b) => Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z))[0];
    const sl = near('slinger', 9, 134);
    const at = it.standNear(sl, 13, Math.atan2(-7, 11));     // on island B2, 13 m from his stump
    const k0 = it.kills.slinger || 0;
    const f = it.fight(() => (it.kills.slinger || 0) > k0, { target: () => sl, maxSteps: 2400 });
    return { at, slinger: sl.position.toArray().map((v) => +v.toFixed(1)), fight: f, kills: { ...it.kills }, snap: it.snap() };
  });
  check('fight: a perched slinger killed with real lock-on throws', (r5.kills.slinger || 0) >= 1, r5);
  const r6 = await h.game((g) => {
    const it = window.__it, ctx = g.ctx;
    ctx.player.heal(5);
    const ib = ctx.entities.query('ironbelly').filter((e) => !e.dying).sort((a, b) => Math.hypot(a.position.x + 16, a.position.z - 285) - Math.hypot(b.position.x + 16, b.position.z - 285))[0];
    it.standNear(ib, 8, Math.PI / 2);           // on the yard side of him
    const armor0 = it.count('armor:break'), k0 = it.kills.ironbelly || 0;
    // puffs first: they clang off his cauldron
    const clang = it.fight(() => it.count('projectile:hit') > 0 && g.events('projectile:hit').some((e) => e.payload.target === 'ironbelly' && e.payload.deflected), { target: () => ib, maxSteps: 600 });
    const hpAfterPuffs = ib.hp;
    g.give('anvil');
    const f = it.fight(() => (it.kills.ironbelly || 0) > k0, { target: () => ib, maxSteps: 2400 });
    return { clang: clang.done, hpAfterPuffs, fight: f, armor: it.count('armor:break') - armor0, kills: { ...it.kills }, snap: it.snap() };
  });
  check('fight: ironbelly deflects puffs, Anvil iron breaks his cauldron (armor:break), then he falls', r6.clang && r6.armor >= 1 && (r6.kills.ironbelly || 0) >= 1, r6);
  await h.game((g) => { g.ctx.player.setTonic(null); g.step(2); });

  // ------------------------------------------------------------------ Chief Gnarlbelly
  const r7 = await h.game((g) => {
    const et = window.__et, it = window.__it, ctx = g.ctx, L = window.__lv;
    g.godMode(true); ctx.player.heal(5);
    g.gotoCheckpoint('pit'); g.step(4);
    const b = ctx.enemies.boss();
    const log = [];
    const walk = L.walkTo(0, 387, 0.8, 900);
    const woke = et.until(() => it.count('boss:start') > 0, 400);
    log.push({ walk: walk.ok, woke, gateClosed: g.events('gate:close').some((e) => e.payload.id === 'pitGate') });
    const front = (d = 8) => {
      const c = b.arenaCenter;
      let dx = c.x - b.position.x, dz = c.z - b.position.z;
      const l = Math.hypot(dx, dz);
      if (l < 3) { dx = Math.sin(b.yaw); dz = Math.cos(b.yaw); } else { dx /= l; dz /= l; }
      const x = b.position.x + dx * d, z = b.position.z + dz * d;
      const yaw = Math.atan2(b.position.x - x, b.position.z - z);
      g.teleport(x, b.position.y, z, yaw); g.setCamera(yaw, 0.25, 7.5);
    };
    const untilDizzy = () => et.until(() => {
      if (b.state === 'dizzy' || b.dying) return true;
      if (ctx.time.frame % 90 === 0 && b.pdist > 13) front(10);
      return false;
    }, 2500);
    const clearMinions = () => { let n = 0; for (const e of b.minions) if (e.alive && !e.dying) { e.hurt(9, { kind: 'puff', dir: { x: 0, z: 1 } }); n++; } return n; };
    const volley = (n, gap = 14) => {
      const before = it.count('boss:hurt');
      for (let k = 0; k < n && b.state === 'dizzy'; k++) { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(gap); }
      g.step(8);
      return it.count('boss:hurt') - before;
    };
    let fallbacks = 0, minionsCleared = 0, jarDrunk = false;
    for (let guard = 0; guard < 40 && !b.dying; guard++) {
      if (b.phase === 2 && b.plateState === 'belly') {
        // drink the real Anvil jar the Chief put on the arena ring, then crack the plate with real iron throws
        if (b.jar && b.jar.alive && (!ctx.player.tonic || ctx.player.tonic.kind !== 'anvil')) {
          const j = b.jar.position;
          const w = L.walkTo(j.x, j.z, 0.5, 900);
          g.step(10);
          jarDrunk = jarDrunk || (ctx.player.tonic && ctx.player.tonic.kind === 'anvil');
          log.push({ jar: w.ok, tonic: ctx.player.tonic && ctx.player.tonic.kind });
        }
        if (!ctx.player.tonic || ctx.player.tonic.kind !== 'anvil') g.give('anvil');
        front(9);
        it.fight(() => b.plateState !== 'belly' || b.dying, { target: () => b, maxSteps: 500, heal: false });
        log.push({ plate: b.plateState });
        continue;
      }
      if (untilDizzy() < 0) { log.push('no dizzy'); break; }
      if (b.dying) break;
      minionsCleared += clearMinions();
      front(7);
      let landed = volley(4);
      if (landed === 0 && b.state === 'dizzy') { fallbacks++; for (let k = 0; k < 3 && b.state === 'dizzy'; k++) it.shoot(b, ctx.player.tonic && ctx.player.tonic.kind === 'anvil' ? 'iron' : 'puff'); }
      log.push({ phase: b.phase, hp: b.hp, landed });
    }
    const defeated = it.count('boss:defeated');
    return { log, defeated, hp: b.hp, phases: g.events('boss:phase').map((e) => e.payload.phase), fallbacks, minionsCleared, jarDrunk, stats: b.stats, score: ctx.score.points };
  });
  check('boss: wakes when Morel enters the pit (boss:start), the pit gate closes', r7.log[0] && r7.log[0].woke >= 0 && r7.log[0].gateClosed, r7.log[0]);
  check('boss: phases 1 -> 2 -> 3 and defeated (boss:defeated), mostly real throws', r7.defeated === 1 && r7.hp === 0 && r7.phases.includes(2) && r7.phases.includes(3), { phases: r7.phases, fallbacks: r7.fallbacks, minionsCleared: r7.minionsCleared, jarDrunk: r7.jarDrunk, steps: r7.log.length, score: r7.score });
  await h.game((g) => { const b = window.__et; void b; g.step(60); g.setCamera(Math.PI, 0.25, 9); g.step(1); });
  await settledShot(page, h, '05-boss-defeated', 800);

  // ------------------------------------------------------------------ the Lantern Gate
  const r8 = await h.game((g) => {
    const it = window.__it, L = window.__lv;
    const t = window.__et.until(() => g.events('gate:open').some((e) => e.payload.id === 'lanternGate'), 900);
    g.step(60);
    const w1 = L.walkTo(0, 410, 0.6, 900);
    return { t, w1: w1.ok, gateOpen: g.events('gate:open').map((e) => e.payload.id), snap: it.snap() };
  });
  check('Lantern Gate rises and opens after the boss falls (gate:open lanternGate)', r8.t >= 0, r8);
  await h.game((g) => { g.setCamera(0, 0.2, 7.5); g.step(1); });
  await settledShot(page, h, '06-lantern-gate', 800);
  const r9 = await h.game((g) => {
    const it = window.__it, L = window.__lv;
    L.walkTo(0, 415.5, 0.5, 600);
    const complete = it.count('level:complete');
    const t = window.__et.until(() => g.ctx.state === 'results', 200);
    const lcEv = g.events('level:complete')[0];
    const resEv = g.events('game:state').find((e) => e.payload.state === 'results');
    const lc = lcEv ? lcEv.payload.stats : null;
    const delay = lcEv && resEv ? +((resEv.frame - lcEv.frame) / 60).toFixed(2) : null;
    return { complete, t, delay, state: g.ctx.state, stats: lc, snapshot: g.ctx.score.snapshot(), rank: g.ctx.score.rankInfo(), track: g.ctx.audio.track };
  });
  check('walking into the portal: level:complete once, results state 1.2 s (simulated) later, victory music', r9.complete === 1 && r9.state === 'results' && r9.delay !== null && Math.abs(r9.delay - 1.2) < 0.05 && r9.track === 'victory', { complete: r9.complete, delay: r9.delay, track: r9.track });
  // the count-up runs on real frames (~2 fps headless): wait until the rank badge is stamped
  await page.waitForFunction(() => document.querySelector('.menu-results.is-on .res-badge.is-in'), null, { timeout: 60000 }).catch(() => {});
  const dom = await page.evaluate(() => {
    const q = (s) => { const n = document.querySelector(s); return n ? n.textContent.trim() : null; };
    return {
      big: q('.menu-results .res-score .big'), rank: q('.menu-results .rk-name'), note: q('.menu-results .res-meter-text'),
      stats: [...document.querySelectorAll('.menu-results .stat')].map((n) => n.textContent.trim()),
    };
  });
  await settledShot(page, h, '07-results');
  const st = r9.stats || {};
  const sensible = st.total === r9.snapshot.total && st.total > 0 && ['Bronze', 'Silver', 'Gold', 'Glowing'].includes(st.rank) && st.glowcaps <= st.glowcapsTotal && st.glowcapsTotal === 159 && st.cagesTotal === 8 && st.kills >= 4 && st.elapsed > 0 && st.maxPossible === Math.round(t0.base * 1.8);
  check('results: sensible numbers (total, rank, glowcaps x/159, cages x/8, kills, time, maximum)', sensible, { stats: st, rank: r9.rank });
  check('results screen shows the score, rank and stats', dom.big && dom.big.replace(/\D/g, '') === String(st.total) && dom.rank === st.rank && dom.stats.length >= 6, dom);

  // ------------------------------------------------------------------ Play again
  await page.keyboard.press('Enter');              // skips the count-up if it is still running
  await h.wait(500);
  const focus = await h.game((g) => g.ctx.menus.focusLabel);
  if (g_isPlaying(await h.game((g) => g.ctx.state)) === false) await page.keyboard.press('Enter');
  await waitForGame(page, 'playing', 20000);
  const r10 = await h.game((g, t0c) => {
    const ctx = g.ctx;
    g.step(3);
    const counts = ctx.entities.countByTag();
    const diff = {};
    for (const k of new Set([...Object.keys(counts), ...Object.keys(t0c)])) if ((counts[k] || 0) !== (t0c[k] || 0)) diff[k] = [t0c[k] || 0, counts[k] || 0];
    const b = ctx.enemies.boss();
    return {
      snap: window.__it.snap(), diff, entities: ctx.entities.list.length, flags: Object.keys(ctx.flags),
      boss: b ? { state: b.state, hp: b.hp } : null, glowcaps: ctx.score.glowcaps, max: ctx.score.maxPossible(),
      gateHidden: ctx.entities.query('lanternGate').every((e) => !e.risen && !e.triggered), track: ctx.audio.track,
      bossBar: ctx.hud.bossVisible,
    };
  }, t0.counts);
  check('Play again: fresh run (score 0, Morel at the start, full hearts, checkpoint start, no flags)', r10.snap.score === 0 && r10.snap.pos[2] < 5 && r10.snap.hp === 5 && r10.snap.checkpoint === 'start' && r10.flags.length === 0, { focus, ...r10.snap, flags: r10.flags });
  check('Play again: every entity re-spawned exactly once (tag counts match the first boot), boss dormant at full hp', Object.keys(r10.diff).length === 0 && r10.entities === t0.entities && r10.boss && r10.boss.state === 'dormant' && r10.boss.hp === 24, { diff: r10.diff, entities: [t0.entities, r10.entities], boss: r10.boss });
  check('Play again: glade music again, boss bar hidden, same maximum', r10.track === 'glade' && r10.bossBar === false && r10.max === t0.max, { track: r10.track, bossBar: r10.bossBar, max: r10.max });
  await settledShot(page, h, '08-play-again', 900);

  const errors = consoleLog.filter((l) => !/GPU stall due to ReadPixels/.test(l));
  check('zero console errors or warnings', errors.length === 0 && h.errors.length === 0, errors.slice(0, 10));
  return { passed: checks.filter((c) => c.ok).length, total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name), perf };
}

function g_isPlaying(state) { return state === 'playing'; }
