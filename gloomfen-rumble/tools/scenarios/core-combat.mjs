// Combat checks: quick + charged throws, lock-on strafe, tonics, puff cap.
//   node tools/scenario.mjs tools/scenarios/core-combat.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
export default async function (page, h) {
  await h.wait(300);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const G = (fn, arg) => h.game(fn, arg);
  await G((g) => { g.setQuality('high'); g.godMode(true); });

  // --- quick throws: 3 taps kill a 3 hp dummy
  {
    const r = await G((g) => {
      g.clearEvents(); g.setInput(null);
      g.teleport(2, 1, 10, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
      for (let k = 0; k < 3; k++) { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(25); }
      g.step(20);
      const ev = g.events();
      return {
        throws: ev.filter((e) => e.name === 'player:throw').map((e) => [e.payload.kind, e.payload.charge]),
        hits: ev.filter((e) => e.name === 'projectile:hit').map((e) => [e.payload.target, e.payload.damage]),
        hurt: ev.filter((e) => e.name === 'enemy:hurt').length,
        killed: ev.filter((e) => e.name === 'enemy:killed').map((e) => e.payload.type),
      };
    });
    check('3 quick puffs hit and kill the dummy', r.throws.length === 3 && r.hits.filter((x) => x[0] === 'dummy').length === 3 && r.hurt === 2 && r.killed.length === 1, r);
  }

  // --- charged throw: one 3-damage hit kills
  {
    const r = await G((g) => {
      g.clearEvents(); g.setInput(null);
      g.teleport(8, 1, 16, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
      g.setInput({ throw: true }); g.step(58);
      const charge = g.ctx.player.charge;
      return { charge };
    });
    await h.wait(400);
    await h.shot('charging');
    const r2 = await G((g) => {
      g.setInput({}); g.step(40);
      const ev = g.events();
      return {
        charges: ev.filter((e) => e.name === 'player:charge').map((e) => e.payload.level),
        throw: ev.filter((e) => e.name === 'player:throw').map((e) => e.payload),
        hits: ev.filter((e) => e.name === 'projectile:hit').map((e) => [e.payload.target, e.payload.damage]),
        killed: ev.filter((e) => e.name === 'enemy:killed').length,
      };
    });
    check('charged throw (3 dmg) kills the dummy in one hit', r.charge >= 0.99 && r2.charges.join() === '0,1' && r2.hits.length === 1 && r2.hits[0][1] === 3 && r2.killed === 1, { ...r, ...r2 });
  }

  // --- lock-on picks the dummy in front and strafes around it
  {
    const r = await G((g) => {
      g.step(200); // dummies respawn
      g.clearEvents(); g.setInput(null);
      g.teleport(8, 1, 17, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
      g.setInput({ lock: true }); g.step(2);
      const p = g.ctx.player;
      const t = p.lockTarget;
      const start = p.position.clone();
      g.setInput({ lock: true, move: [-1, 0] }); g.step(70);
      const tp = t ? t.position : null;
      const ang = tp ? Math.atan2(tp.x - p.position.x, tp.z - p.position.z) : 0;
      const yawErr = Math.abs(Math.atan2(Math.sin(p.yaw - ang), Math.cos(p.yaw - ang)));
      const distStart = tp ? Math.hypot(tp.x - start.x, tp.z - start.z) : 0;
      const distEnd = tp ? Math.hypot(tp.x - p.position.x, tp.z - p.position.z) : 0;
      return { target: t && t.type, targetPos: tp && tp.toArray(), moved: +p.position.distanceTo(start).toFixed(2), yawErr: +yawErr.toFixed(3), locking: p.locking, distStart: +distStart.toFixed(2), distEnd: +distEnd.toFixed(2), state: p.state };
    });
    await h.wait(400);
    await h.shot('lock-on-strafe');
    check('lock-on picks the dummy; Morel strafes facing it', r.target === 'dummy' && r.moved > 3 && r.yawErr < 0.12 && r.locking, r);
    const r2 = await G((g) => {
      g.clearEvents();
      g.setInput({ lock: true, move: [-1, 0], throw: true }); g.step(1); g.setInput({ lock: true, move: [-1, 0] }); g.step(40);
      const hits = g.events('projectile:hit').map((e) => e.payload.target);
      g.setInput(null); g.step(5);
      return { hits, lockAfterRelease: g.ctx.player.lockTarget };
    });
    check('locked throw while strafing homes onto the target', r2.hits.includes('dummy') && r2.lockAfterRelease === null, r2);
  }

  // --- aim assist bends a puff toward a dummy slightly off-axis
  {
    const r = await G((g) => {
      g.step(200); g.clearEvents(); g.setInput(null);
      g.teleport(-2 + 2.2, 1, 22, 0); g.setCamera(0, 0.22, 7.5); g.step(10); // dummy 3 at (-2, 1, 32): ~12 deg off
      g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(40);
      return { hits: g.events('projectile:hit').map((e) => e.payload.target) };
    });
    check('soft aim assist bends a puff onto an off-axis dummy', r.hits.includes('dummy'), r);
  }

  // --- max 3 puffs alive
  {
    const r = await G((g) => {
      // iron balls live ~0.85 s, longer than 3 cooldowns, so the cap is what limits the 4th throw
      g.setInput(null); g.give('anvil'); g.teleport(-10, 1, -6, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
      let maxAlive = 0, throws = 0; g.clearEvents();
      for (let k = 0; k < 8; k++) {
        g.setInput({ throw: true }); g.step(1); g.setInput({});
        for (let i = 0; i < 13; i++) { g.step(1); maxAlive = Math.max(maxAlive, g.ctx.projectiles.count((p) => p.owner === g.ctx.player)); }
      }
      throws = g.events('player:throw').length;
      g.ctx.player.setTonic(null);
      return { maxAlive, throws };
    });
    check('never more than 3 throws alive (4th is blocked)', r.maxAlive === 3 && r.throws < 8 && r.throws >= 4, r);
  }

  // --- Anvil tonic: iron balls, 3 dmg heavy -> one-shot the dummy
  {
    const r = await G((g) => {
      g.step(200); g.clearEvents(); g.setInput(null);
      g.give('anvil');
      g.teleport(2, 1, 10, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
      g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(4);
      const live = g.ctx.projectiles.active.map((p) => [p.kind, p.heavy, p.damage]);
      return { live };
    });
    await h.wait(400);
    await h.shot('anvil-throw');
    const r2 = await G((g) => {
      g.step(40);
      const ev = g.events();
      return {
        start: ev.filter((e) => e.name === 'tonic:start').map((e) => e.payload),
        throwKind: ev.filter((e) => e.name === 'player:throw').map((e) => e.payload.kind),
        hits: ev.filter((e) => e.name === 'projectile:hit').map((e) => [e.payload.target, e.payload.damage, e.payload.kind]),
        killed: ev.filter((e) => e.name === 'enemy:killed').length,
      };
    });
    check('anvil tonic: iron ball, 3 dmg heavy, one-shots dummy', r.live.length && r.live[0][0] === 'iron' && r.live[0][1] === true && r2.start[0] && r2.start[0].kind === 'anvil' && r2.start[0].duration === 20 && r2.throwKind[0] === 'iron' && r2.hits[0] && r2.hits[0][1] === 3 && r2.killed === 1, { ...r, ...r2 });
  }

  // --- Updraft tonic: holding jump in the air rises at 6 m/s
  {
    const r = await G((g) => {
      g.clearEvents(); g.setInput(null);
      g.give('updraft');
      g.teleport(0, 1, -6, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
      const y0 = g.ctx.player.position.y;
      g.setInput({ jump: true }); g.step(90);
      const p = g.ctx.player;
      return { rise: +(p.position.y - y0).toFixed(2), vy: +p.velocity.y.toFixed(2), state: p.state, ended: g.events('tonic:end').map((e) => e.payload.kind) };
    });
    await h.wait(400);
    await h.shot('updraft');
    const r2 = await G((g) => { g.setInput(null); g.step(240); return { onGround: g.ctx.player.onGround }; });
    check('updraft tonic: rises at 6 m/s while jump held (previous tonic ended)', r.state === 'updraft' && Math.abs(r.vy - 6) < 0.01 && r.rise > 6 && r.ended.includes('anvil') && r2.onGround, r);
  }

  // --- Seeker tonic: three homing puffs per throw
  {
    const r = await G((g) => {
      g.step(200); g.clearEvents(); g.setInput(null);
      g.give('seeker');
      g.teleport(3, 1, 12, 0.3); g.setCamera(0.3, 0.22, 7.5); g.step(10);
      g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(3);
      const live = g.ctx.projectiles.active.filter((p) => p.kind === 'seeker').map((p) => p.homing && p.homing.type);
      return { live };
    });
    await h.wait(400);
    await h.shot('seeker-volley');
    const r2 = await G((g) => {
      g.step(80);
      const ev = g.events();
      return { hits: ev.filter((e) => e.name === 'projectile:hit').map((e) => [e.payload.target, e.payload.kind]), throws: ev.filter((e) => e.name === 'player:throw').map((e) => e.payload.kind) };
    });
    check('seeker tonic: one throw = 3 homing seeker puffs that hit dummies', r.live.length === 3 && r.live.every((x) => x === 'dummy') && r2.throws.length === 1 && r2.throws[0] === 'seeker' && r2.hits.filter((x) => x[0] === 'dummy' && x[1] === 'seeker').length === 3, { ...r, ...r2 });
  }

  // --- tonic timer events
  {
    const r = await G((g) => {
      g.clearEvents();
      g.ctx.player.setTonic('seeker', 4.5);
      g.step(60 * 5);
      return { ev: g.events((e) => e.name.startsWith('tonic:')).map((e) => [e.name, e.payload.kind, e.payload.remaining ?? e.payload.duration]), tonic: g.ctx.player.tonic };
    });
    const names = r.ev.map((e) => e[0] + (e[2] !== undefined && e[0] === 'tonic:warning' ? e[2] : ''));
    check('tonic: start -> warning 3,2,1 -> end', names.join(',') === 'tonic:start,tonic:warning3,tonic:warning2,tonic:warning1,tonic:end' && r.tonic === null, { names });
  }

  await G((g) => { g.godMode(false); g.setInput(null); });
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { passed: checks.length - failed.length, total: checks.length, failed };
}
