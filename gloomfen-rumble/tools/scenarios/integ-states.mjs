// Game-state machine of the shipped build (dist/index.html), driven with the real mouse and keyboard
// where the player would use them:
//   mouse click on Start -> Esc pauses (simulation frozen, pause menu) -> P resumes -> hidden tab pauses,
//   Resume button -> die (dead, splat card) -> respawn at the last lit checkpoint with full hearts ->
//   pause menu "Restart from checkpoint" inside the locked ambush (gates and wave reset) and in the boss
//   fight (fight resets, pit gate reopens) -> "Quit to title" (fresh run behind the title) -> Start again.
//   node tools/scenario.mjs tools/scenarios/integ-states.mjs --html dist/index.html --shots dist/integ/shots
import { installIntegHelpers, watchConsole, waitForGame, settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  const consoleLog = watchConsole(page);
  await page.reload();
  await waitForGame(page, 'title');
  await installIntegHelpers(page);
  await h.wait(1500);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const btn = (screen, label) => page.click(`.menu-${screen}.is-on button:has-text("${label}")`);

  // ------------------------------------------------------------------ mouse: Start
  await btn('title', 'Start');
  await waitForGame(page, 'playing', 20000);
  await page.waitForFunction(() => window.__game.ctx.time.now > 0.5, null, { timeout: 30000 });
  check('mouse click on Start -> playing (real-time loop running)', true, await h.game(() => window.__it.snap()));

  // ------------------------------------------------------------------ Esc pauses, P resumes
  await page.keyboard.press('Escape');
  await waitForGame(page, 'paused', 15000);
  const p1 = await h.game((g) => ({ t: g.ctx.time.now, menu: g.ctx.menus.current, locked: g.ctx.input.pointerLocked, mix: g.ctx.audio._internal && g.ctx.audio._internal.mix ? { ...g.ctx.audio._internal.mix } : null }));
  await h.wait(1500);
  const p2 = await h.game((g) => ({ t: g.ctx.time.now, state: g.ctx.state }));
  check('Esc -> paused: pause menu, simulation frozen, pointer lock released', p1.menu === 'pause' && p2.t === p1.t && p2.state === 'paused' && p1.locked === false, { p1, p2 });
  await h.game((g) => g.setQuality('high'));
  await settledShot(page, h, '20-paused', 700);
  await page.keyboard.press('KeyP');
  await waitForGame(page, 'playing', 15000);
  await page.waitForFunction((t) => window.__game.ctx.time.now > t + 0.2, p2.t, { timeout: 30000 });
  const p3 = await h.game((g) => ({ state: g.ctx.state, menu: g.ctx.menus.current, states: g.events('game:state').map((e) => `${e.payload.prev}>${e.payload.state}`) }));
  check('P -> playing again, time advances, game:state emitted for every change (boot>title precedes the debug log)', p3.state === 'playing' && !p3.menu && p3.states.join() === 'title>playing,playing>paused,paused>playing', p3);

  // ------------------------------------------------------------------ hidden tab pauses; Resume button
  await h.game(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const v1 = await h.game((g) => g.ctx.state);
  await h.game(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await h.wait(400);
  await btn('pause', 'Resume');
  await waitForGame(page, 'playing', 15000);
  check('hidden tab -> paused; Resume button -> playing', v1 === 'paused', { v1 });

  // ------------------------------------------------------------------ die -> splat -> respawn at the checkpoint
  const d1 = await h.game((g) => {
    const it = window.__it, pl = g.ctx.player;
    g.step(1);                                            // manual stepping from here on
    g.gotoCheckpoint('glade'); g.step(20);                // lights the glade lantern
    const lit = g.events('checkpoint:reached').map((e) => e.payload.id);
    g.teleport(0.5, 6.8, 66, 0); g.step(10);
    const deaths0 = g.ctx.score.deaths;
    pl.damage(5, pl.position.clone().setZ(pl.position.z + 1));
    g.step(30);
    return { lit, state: g.ctx.state, pstate: pl.state, deaths: g.ctx.score.deaths - deaths0, splat: !!document.querySelector('.splat.is-on') };
  });
  await settledShot(page, h, '21-dead-splat', 900);
  const d2 = await h.game((g) => {
    const it = window.__it, pl = g.ctx.player;
    window.__et.until(() => g.ctx.state === 'playing', 200);
    g.step(2);
    const rs = g.events('player:respawn').slice(-1)[0];
    return { snap: it.snap(), respawn: rs && rs.payload, dist: Math.hypot(pl.position.x - g.ctx.player.checkpoint.position.x, pl.position.z - g.ctx.player.checkpoint.position.z) };
  });
  check('death: dead state, splat card, death counted', d1.state === 'dead' && d1.pstate === 'dead' && d1.splat && d1.deaths === 1 && d1.lit.includes('glade'), d1);
  check('respawn at the glade checkpoint with full hearts, back to playing', d2.snap.state === 'playing' && d2.snap.hp === 5 && d2.respawn && d2.respawn.checkpointId === 'glade' && d2.dist < 1, d2);
  await settledShot(page, h, '22-respawned', 900);

  // ------------------------------------------------------------------ restart from checkpoint inside the locked ambush
  const a1 = await h.game((g) => {
    const pl = g.ctx.player;
    g.godMode(true);
    g.gotoCheckpoint('bog'); g.step(10);
    g.teleport(0, 7.1, 314, 0);
    const arena = g.ctx.level.spawned.find((e) => e.type === 'arenaLock');
    window.__et.until(() => arena.state === 'locked' && arena.enemies.length > 0, 300);
    g.step(20);
    return { state: arena.state, wave: arena.wave, enemies: arena.enemies.length, gatesClosed: arena.gates.every((x) => !x.open) };
  });
  await h.game((g) => g.ctx.setState('paused'));    // (Esc needs the real-time loop; the menu path is what is tested here)
  await h.wait(500);
  await btn('pause', 'Restart from checkpoint');
  await waitForGame(page, 'playing', 15000);
  const a2 = await h.game((g) => {
    const arena = g.ctx.level.spawned.find((e) => e.type === 'arenaLock');
    g.step(30);
    return { state: arena.state, enemies: arena.enemies.length, gatesOpen: arena.gates.every((x) => x.open), resets: g.events('arena:reset').length, snap: window.__it.snap() };
  });
  check('ambush locked, then pause -> Restart from checkpoint: back at the bog lantern, ambush idle, gates open, wave gone', a1.state === 'locked' && a2.state === 'idle' && a2.enemies === 0 && a2.gatesOpen && a2.snap.checkpoint === 'bog' && a2.snap.pos[2] < 245, { a1, a2 });

  // ------------------------------------------------------------------ restart from checkpoint in the boss fight
  const b1 = await h.game((g) => {
    const L = window.__lv, it = window.__it;
    g.gotoCheckpoint('pit'); g.step(5);
    L.walkTo(0, 387, 0.8, 900);
    window.__et.until(() => it.count('boss:start') > 0, 300);
    g.step(120);
    const b = g.ctx.enemies.boss();
    const gate = g.ctx.level.spawned.find((e) => e.id === 'pitGate');
    return { boss: b.state, fight: b.fightOn, gateOpen: gate.isOpen, track: g.ctx.audio.track };
  });
  await h.game((g) => g.ctx.setState('paused'));
  await h.wait(500);
  await btn('pause', 'Restart from checkpoint');
  await waitForGame(page, 'playing', 15000);
  const b2 = await h.game((g) => {
    g.step(30);
    const b = g.ctx.enemies.boss();
    const gate = g.ctx.level.spawned.find((e) => e.id === 'pitGate');
    return { boss: b.state, hp: b.hp, gateOpen: gate.isOpen, track: g.ctx.audio.track, bar: g.ctx.hud.bossVisible, snap: window.__it.snap() };
  });
  check('boss fight on (pit gate shut, boss music), Restart from checkpoint: fight resets, gate reopens, Morel at the pit lantern', b1.fight && !b1.gateOpen && b1.track === 'boss' && b2.boss === 'waiting' && b2.gateOpen && b2.track === null && !b2.bar && b2.snap.checkpoint === 'pit', { b1, b2 });

  // ------------------------------------------------------------------ quit to title -> fresh run; start again with Enter
  await h.game((g) => { g.ctx.score.award(500, 'test'); g.ctx.setState('paused'); });
  await h.wait(500);
  await btn('pause', 'Quit to title');
  await waitForGame(page, 'title', 15000);
  const q1 = await h.game((g) => ({ snap: window.__it.snap(), menu: g.ctx.menus.current, boss: g.ctx.enemies.boss().state, flags: Object.keys(g.ctx.flags), tonic: g.ctx.player.tonic }));
  check('Quit to title: title menu + music, fresh run prepared (score 0, Morel at the start, boss asleep)', q1.menu === 'title' && q1.snap.track === 'title' && q1.snap.score === 0 && q1.snap.pos[2] < 5 && q1.snap.checkpoint === 'start' && q1.boss === 'dormant' && q1.flags.length === 0, q1);
  await settledShot(page, h, '23-quit-title', 1200);
  await page.keyboard.press('Enter');
  await waitForGame(page, 'playing', 15000);
  const q2 = await h.game((g) => { g.step(3); return window.__it.snap(); });
  check('Start again from the title: playing in the glade with glade music', q2.state === 'playing' && q2.zone === 'glade' && q2.track === 'glade', q2);

  // ------------------------------------------------------------------ repeated new runs do not leak
  const leak = await h.game((g) => {
    const ctx = g.ctx, mem = () => ({ ...ctx.renderer.info.memory, entities: ctx.entities.list.length, colliders: ctx.physics.colliders.length, movers: ctx.physics.movers.length, systems: ctx.systems.length, scene: ctx.scene.children.length });
    const run = () => { ctx.flow.newRun(); g.step(30); g.render(); };
    run();
    const a = mem();
    for (let i = 0; i < 3; i++) run();
    return { a, b: mem() };
  });
  check('three more fresh runs: no growth in entities, colliders, systems, scene objects, geometries or textures', ['entities', 'colliders', 'movers', 'systems', 'scene', 'geometries', 'textures'].every((k) => leak.b[k] <= leak.a[k]), leak);

  const errors = consoleLog.filter((l) => !/GPU stall due to ReadPixels/.test(l));
  check('zero console errors or warnings', errors.length === 0 && h.errors.length === 0, errors.slice(0, 10));
  return { passed: checks.filter((c) => c.ok).length, total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name) };
}
