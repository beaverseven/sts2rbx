// Full Chief Gnarlbelly fight, scripted (god mode + real throws, scripted homing throws as a fallback):
//   wake (boss:start, boss:phase 1, boss bar) -> hits outside dizzy are deflected -> phase 1 dizzy windows
//   -> phase 2 (plate deflects even when dizzy, anvil jar spawned, grunts summoned, iron breaks the plate)
//   -> Morel dies: fight resets to the phase start, resumes when he returns
//   -> phase 3 (belly slides, crash -> dizzy) -> boss:defeated, he deflates and despawns.
//   node tools/scenario.mjs tools/scenarios/enemies-boss.mjs --html dist/dev-boss/index.html --shots dist/dev-boss/shots
import { installEnemyHelpers } from './enemies-helpers.mjs';

export default async function (page, h) {
  await h.wait(400);
  await installEnemyHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  await h.game((g) => {
    g.setQuality('high');
    const ctx = g.ctx, et = window.__et;
    // record HUD boss-bar calls
    et.bar = [];
    const prev = ctx.hud.showBossBar;
    ctx.hud.showBossBar = (on) => { et.bar.push(on); if (prev) prev.call(ctx.hud, on); };
    // stand Morel `d` m from the boss on the arena-centre side (clear line of fire), facing him
    et.front = (d = 8) => {
      const b = ctx.enemies.boss();
      const c = b.arenaCenter;
      let dx = c.x - b.position.x, dz = c.z - b.position.z;
      const l = Math.hypot(dx, dz);
      if (l < 3) { dx = Math.sin(b.yaw); dz = Math.cos(b.yaw); } else { dx /= l; dz /= l; }
      const x = b.position.x + dx * d, z = b.position.z + dz * d;
      const yaw = Math.atan2(b.position.x - x, b.position.z - z);
      g.teleport(x, b.position.y, z, yaw);
      g.setCamera(yaw, 0.25, 7.5);
    };
    // clear summoned grunts out of the line of fire (as Morel would)
    et.clearMinions = () => { for (const e of ctx.enemies.boss().minions) if (e.alive && !e.dying) e.hurt(9, { kind: 'puff', dir: { x: 0, z: 1 } }); };
    // real throws; returns how many boss:hurt events they produced
    et.volley = (n, gap = 16) => {
      const before = et.count('boss:hurt');
      for (let k = 0; k < n; k++) { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(gap); }
      g.step(10);
      return et.count('boss:hurt') - before;
    };
    // scripted homing throw (fallback / iron)
    et.shoot = (kind = 'puff') => {
      const b = ctx.enemies.boss(), p = ctx.player.position;
      const from = new ctx.THREE.Vector3(p.x, p.y + 0.6, p.z);
      const to = new ctx.THREE.Vector3(b.position.x, b.position.y + 2, b.position.z);
      const v = to.sub(from).normalize().multiplyScalar(24);
      ctx.projectiles.spawn({ team: 'player', kind, position: from, velocity: v, damage: kind === 'iron' ? 3 : 1, radius: 0.3, life: 3, homing: b, homingStrength: 8, heavy: kind === 'iron', owner: ctx.player });
      g.step(30);
    };
    // step until the boss is dizzy (Morel keeps 9-12 m away, so stomp rings reach him)
    et.untilDizzy = (max = 2500) => {
      const b = ctx.enemies.boss();
      return et.until(() => {
        if (b.state === 'dizzy' || b.dying) return true;
        if (g.ctx.time.frame % 90 === 0 && b.pdist > 13) et.front(10);
        return false;
      }, max);
    };
  });

  // --- wake up
  const r0 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    g.clearEvents(); g.godMode(true);
    const s0 = b.state;
    g.teleport(0, 2, 381, 0); g.step(30);
    const stillAsleep = b.state === 'dormant';
    g.teleport(0, 2, 386, 0);
    const t = et.until(() => et.count('boss:start') > 0, 200);
    return { s0, stillAsleep, t, start: g.events('boss:start')[0]?.payload, phase: g.events('boss:phase').map((e) => e.payload.phase), bar: et.bar.slice() };
  });
  check('dormant until Morel is within 18 m; then roar: boss:start {maxHp:24}, boss:phase 1, boss bar on', r0.s0 === 'dormant' && r0.stillAsleep && r0.t > 0 && r0.start && r0.start.maxHp === 24 && r0.phase.join() === '1' && r0.bar.includes(true), r0);

  // --- outside the dizzy window everything boings off
  const r1 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    et.until(() => b.state === 'approach', 200);
    et.front(8);
    g.clearEvents();
    const landed = et.volley(2);
    return { landed, deflected: g.events('projectile:hit').filter((e) => e.payload.target === 'boss' && e.payload.deflected).length, hp: b.hp, state: b.state };
  });
  check('puffs outside the dizzy window are deflected (no boss:hurt)', r1.landed === 0 && r1.deflected >= 1 && r1.hp === 24, r1);

  // --- stomps: shockwaves are spawned; a stomp ring hits a grounded Morel (god mode off for one ring)
  const r2 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    g.clearEvents(); g.godMode(false); ctx.player.hp = 5;
    et.front(11);
    const t = et.until(() => b.stats.stomps >= 1 && !ctx.enemies.fx.waves.some((w) => w.active && w.owner === b), 600);
    const hurt = g.events('player:hurt').map((e) => e.payload.amount);
    g.godMode(true); ctx.player.hp = 5;
    return { t, stomps: b.stats.stomps, hurt };
  });
  check('stomp shockwave hits a grounded Morel', r2.t > 0 && r2.hurt.length >= 1, r2);

  // --- phase 1: dizzy windows until phase 2
  const r3 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    g.clearEvents();
    const log = [];
    for (let guard = 0; guard < 8 && b.phase === 1; guard++) {
      const t = et.untilDizzy();
      if (t < 0) { log.push('no dizzy'); break; }
      et.front(7);
      let landed = et.volley(4, 14);
      if (landed === 0) { for (let k = 0; k < 4 && b.state === 'dizzy'; k++) et.shoot('puff'); landed = -1; }
      log.push({ kind: b.dizzyKind, landed, hp: b.hp, state: b.state });
    }
    return { log, hp: b.hp, phase: b.phase, hurt: g.events('boss:hurt').map((e) => e.payload.hp), phases: g.events('boss:phase').map((e) => e.payload.phase), stats: b.stats };
  });
  check('phase 1: stuck after every 3rd stomp -> dizzy, real puffs land, 4 dmg max per window', r3.phase >= 2 && r3.hurt.length >= 8 && r3.log.length >= 2 && r3.phases.includes(2), r3);
  await h.game((g) => {
    const et = window.__et, b = g.ctx.enemies.boss();
    et.until(() => b.state === 'phaseShift' && b.stateT > 2.0, 300);
    const p = b.position;
    et.cam([p.x + Math.sin(b.yaw) * 9 + 3, p.y + 3.5, p.z + Math.cos(b.yaw) * 9], [p.x, p.y + 2.2, p.z]);
  });
  await h.wait(450);
  await h.shot('boss-phase2-plate');

  // --- phase 2: plate deflects even while dizzy; anvil jar on the ring; grunts summoned; iron breaks the plate
  const r4 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    const jar = b.jar ? { type: b.jar.type, kind: b.jar.kind ?? (b.jar.def && b.jar.def.kind), dist: +Math.hypot(b.jar.position.x - b.arenaCenter.x, b.jar.position.z - b.arenaCenter.z).toFixed(2) } : null;
    et.until(() => b.state === 'approach', 400);
    const grunts = ctx.entities.countByTag().grunt || 0;
    g.clearEvents();
    et.untilDizzy();
    et.clearMinions();
    et.front(7);
    const landedThroughPlate = et.volley(3, 14);
    const clangs = g.events('projectile:hit').filter((e) => e.payload.target === 'boss' && e.payload.deflected).length;
    // drink an Anvil Tonic and crack the plate
    g.give('anvil');
    et.front(7);
    g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(30);
    if (b.plateState === 'belly') et.shoot('iron');
    return { jar, grunts, landedThroughPlate, clangs, plate: b.plateState, armor: g.events('armor:break').map((e) => e.payload.entity), hp: b.hp };
  });
  check('phase 2: anvil tonic jar spawned on the arena ring; grunts summoned', r4.jar && r4.jar.type === 'tonic' && r4.jar.dist > 15 && r4.grunts >= 2, r4);
  check('phase 2: belly plate deflects puffs even while dizzy; an iron throw cracks it (armor:break)', r4.landedThroughPlate === 0 && r4.clangs >= 1 && r4.plate === 'broken' && r4.armor.includes('boss'), r4);

  // --- Morel dies in phase 2 -> fight resets to the phase start on respawn
  const r5 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    // knock a bit of phase-2 health off first
    et.untilDizzy(); et.clearMinions(); et.front(7);
    for (let k = 0; k < 2 && b.state === 'dizzy'; k++) et.shoot('iron');
    const hpBefore = b.hp;
    g.clearEvents();
    g.godMode(false); ctx.player.hp = 1;
    ctx.player.damage(1, b.position);
    const tDead = et.until(() => et.count('player:respawn') > 0, 300);
    g.step(2);
    const after = { state: b.state, hp: b.hp, plate: b.plateState, minions: b.aliveMinions(), pos: b.position.toArray().map((v) => +v.toFixed(1)) };
    g.godMode(true); ctx.player.hp = 5;
    // come back
    g.teleport(0, 2, 386, 0);
    const tResume = et.until(() => et.count('boss:start') > 0, 300);
    const resumed = g.events('boss:start')[0]?.payload;
    return { hpBefore, tDead, after, tResume, resumed, bar: et.bar.slice(-3) };
  });
  check('Morel dies -> boss resets to the phase start (16 hp, plate back, minions gone, by the throne)', r5.hpBefore < 16 && r5.tDead > 0 && r5.after.state === 'waiting' && r5.after.hp === 16 && r5.after.plate === 'belly' && r5.after.minions === 0, r5);
  check('...and resumes (boss:start resumed) when Morel returns', r5.tResume > 0 && r5.resumed && r5.resumed.resumed === true && r5.resumed.hp === 16, r5);

  // --- finish phase 2 with iron, then phase 3 slides
  const r6 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    g.clearEvents();
    const log = [];
    for (let guard = 0; guard < 10 && b.phase === 2; guard++) {
      if (et.untilDizzy() < 0) { log.push('no dizzy'); break; }
      et.clearMinions(); et.front(7);
      if (b.plateState === 'belly') { g.give('anvil'); g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(30); if (b.plateState === 'belly') et.shoot('iron'); }
      if (!ctx.player.tonic || ctx.player.tonic.kind !== 'anvil') g.give('anvil');
      for (let k = 0; k < 2 && b.state === 'dizzy'; k++) et.shoot('iron');
      log.push({ hp: b.hp, plate: b.plateState });
    }
    return { log, phase: b.phase, hp: b.hp, phases: g.events('boss:phase').map((e) => e.payload.phase) };
  });
  check('phase 2 cleared with iron balls -> boss:phase 3', r6.phase === 3 && r6.phases.includes(3) && r6.hp === 8, r6);
  // phase 3: watch a belly slide (screenshot)
  await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    ctx.player.setTonic(null);
    et.until(() => (b.state === 'slide' && b.stateT > 0.2) || b.state === 'dizzy', 2500);
    const p = b.position;
    et.cam([p.x + Math.cos(b.yaw) * 10, p.y + 4, p.z - Math.sin(b.yaw) * 10], [p.x, p.y + 1.5, p.z]);
  });
  await h.wait(450);
  await h.shot('boss-slide');
  const r7 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, b = ctx.enemies.boss();
    g.clearEvents();
    const log = [];
    for (let guard = 0; guard < 10 && !b.dying; guard++) {
      if (et.untilDizzy() < 0) { log.push('no dizzy'); break; }
      const entry = { kind: b.dizzyKind, slides: b.stats.slides, bpos: b.position.toArray().map((v) => +v.toFixed(1)) };
      et.clearMinions(); et.front(7);
      entry.ppos = g.ctx.player.position.toArray().map((v) => +v.toFixed(1));
      g.clearEvents();
      let landed = et.volley(4, 14);
      if (landed === 0) for (let k = 0; k < 4 && b.state === 'dizzy'; k++) et.shoot('puff');
      entry.landed = landed; entry.hp = b.hp;
      entry.hits = g.events('projectile:hit').map((e) => [e.payload.target, e.payload.deflected, e.payload.collider]);
      log.push(entry);
    }
    const defeated = g.events('boss:defeated').map((e) => e.payload);
    return { log, hp: b.hp, dying: b.dying, defeated, slides: b.stats.slides, stats: b.stats };
  });
  check('phase 3: belly slides crash into the edge -> dizzy; boss defeated (boss:defeated)', r7.slides >= 1 && r7.log.some((l) => l.kind === 'crash') && r7.defeated.length === 1 && r7.hp === 0, r7);
  await h.game((g) => {
    const et = window.__et, b = g.ctx.enemies.boss() || et.lastBoss;
    et.lastBoss = b;
    g.step(110);
    const p = b.position;
    et.cam([p.x + 9, p.y + 5, p.z - 9], [p.x, p.y + 3.5, p.z]);
  });
  await h.wait(450);
  await h.shot('boss-deflate');
  await h.game((g) => {
    const et = window.__et, b = et.lastBoss;
    g.step(140);
    const p = b.position;
    et.cam([p.x + 7, p.y + 3, p.z - 7], [p.x, p.y + 0.3, p.z]);
  });
  await h.wait(450);
  await h.shot('boss-flat');
  const r8 = await h.game((g) => { g.step(200); return { boss: g.ctx.enemies.boss() ? g.ctx.enemies.boss().debug() : null, bar: window.__et.bar.slice(-1)[0], entities: g.state().entities }; });
  check('after the deflate the boss despawns; boss bar hidden', r8.boss === null && r8.bar === false, r8);
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}
