// Level mechanisms + zones + content counts. Prints PASS/FAIL per check.
//   node tools/scenario.mjs tools/scenarios/level-mechanisms.mjs --html dist/dev-level/index.html --shots dist/dev-level/shots
import { installLevelHelpers } from './level-helpers.mjs';

export default async function (page, h) {
  await h.wait(400);
  await installLevelHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const G = (fn, arg) => h.game(fn, arg);
  await G((g) => { g.godMode(false); g.setInput(null); g.step(2); });

  // ------------------------------------------------------------ content counts (data.js)
  let r = await G((g) => {
    const D = g.ctx.level.data;
    const c = {};
    const all = [...D.SPAWNS];
    for (const s of D.SPAWNS) if (s.type === 'arenaLock') for (const w of s.waves) all.push(...w);
    for (const s of all) {
      const n = s.type === 'glowcapLine' || s.type === 'glowcapRing' ? s.count : 1;
      const k = s.type.startsWith('glowcap') ? 'glowcaps' : s.type === 'tonic' ? `tonic:${s.kind}` : s.type;
      c[k] = (c[k] || 0) + n;
    }
    return c;
  });
  check('content: ~150 glowcaps', r.glowcaps >= 140 && r.glowcaps <= 165, r.glowcaps);
  check('content: 8 cages, 22 grunts, 9 slingers, 5 ironbellies', r.cage === 8 && r.grunt === 22 && r.slinger === 9 && r.ironbelly === 5, r);
  check('content: tonics updraft/anvil/seeker present, boss + lanternGate', r['tonic:updraft'] >= 1 && r['tonic:anvil'] >= 1 && r['tonic:seeker'] >= 1 && r.boss === 1 && r.lanternGate === 1, r);
  r = await G((g) => g.checkpoints().map((c) => c.id));
  check('checkpoints in order start, glade, bog, fort, pit', JSON.stringify(r) === JSON.stringify(['start', 'glade', 'bog', 'fort', 'pit']), r);

  // ------------------------------------------------------------ zone triggers fire in route order, once per entry
  r = await G((g) => {
    g.clearEvents();
    const seq = [[0, 3.1, 4], [0, 3.1, 12], [0, 1.6, 147], [0, 1.6, 152], [0, 9.1, 239], [0, 7.6, 251], [0, 7.1, 280], [0, 7.1, 300], [0, 3.9, 366], [0, 2.1, 390], [0, 3.1, 2]];
    for (const p of seq) { g.teleport(p[0], p[1], p[2], 0); g.step(3); }
    return { order: g.events('zone:enter').map((e) => e.payload.id), zone: g.ctx.level.zone };
  });
  check('zones: zone:enter fires in order bog -> fort -> pit (-> glade on return), once per entry', JSON.stringify(r.order) === JSON.stringify(['bog', 'fort', 'pit', 'glade']) && r.zone === 'glade', r);

  // ------------------------------------------------------------ signs
  r = await G((g) => {
    g.teleport(0, 3.1, 0, 0); g.step(5); g.clearEvents();
    window.__lv.walkTo(-2.4, 6.0, 0.4, 300);
    const first = g.events('ui:message').map((e) => e.payload.text);
    window.__lv.walkTo(-2.0, 6.5, 0.3, 60);
    const repeat = g.events('ui:message').length;
    g.teleport(0, 3.1, 18, 0); g.step(5); g.teleport(-2.4, 3.1, 6, 0); g.step(5);
    return { first, repeat, again: g.events('ui:message').length };
  });
  check('sign: walking up to it shows its text once (ui:message)', r.first.length === 1 && /Welcome to Gloomfen/.test(r.first[0]) && r.repeat === 1, r);
  check('sign: re-arms after walking away', r.again === 2, r);

  // ------------------------------------------------------------ thorns
  r = await G((g) => {
    g.player.hp = 5; g.teleport(4.5, 4.4, 41.5, 0); g.step(10); g.clearEvents();
    window.__lv.walkTo(8.5, 41.5, 0.3, 120);
    const hurt = g.events('player:hurt');
    return { hurt: hurt.length, hp: g.player.hp };
  });
  check('thorns: touching them hurts (1 heart) with knockback', r.hurt >= 1 && r.hp <= 4, r);

  // ------------------------------------------------------------ bounce shrooms -> optional pillars / tower
  r = await G((g) => {
    const L = window.__lv;
    const out = {};
    const shrooms = g.ctx.level.spawned.filter((e) => e.type === 'bounceShroom');
    const runTo = (s, start, target, tol) => {
      g.player.hp = 5; g.teleport(start[0], start[1], start[2], 0); g.step(15); g.clearEvents();
      const top = s.position.y + 0.85;
      const land = L.jumpTo({ x: s.position.x, y: top, z: s.position.z }, { tol: 0.9, jumpAt: 2.4 });
      // launched: steer to the target while airborne, glide once falling
      let maxY = -99, i = 0;
      for (; i < 360; i++) {
        L.aim(target[0], target[2]);
        const p = g.player.position, d = Math.hypot(target[0] - p.x, target[2] - p.z);
        g.setInput({ move: [0, d < 0.4 ? 0 : Math.min(1, d / 1.5 + 0.2)], jump: g.player.velocity.y < 0 });
        g.step(1);
        maxY = Math.max(maxY, p.y);
        if (i > 20 && g.player.onGround) break;
      }
      g.setInput({}); g.step(5);
      const p = g.player.position;
      return { land: land.ok, bounces: g.events('level:bounce').length, maxY: +maxY.toFixed(2), end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], ok: Math.abs(p.y - target[1]) < 0.3 && Math.hypot(p.x - target[0], p.z - target[2]) < 1.5 };
    };
    const near = (x, z) => shrooms.find((s) => Math.hypot(s.position.x - x, s.position.z - z) < 1);
    out.bs1 = runTo(near(-5.6, 151.6), [-1, 1.6, 151.6], [-10.4, 7.2, 155.6]);
    out.bs3 = runTo(near(11.6, 93.4), [7.5, 5.1, 93.4], [15.6, 9.6, 95.5]);
    out.bs2 = runTo(near(-3.2, 229.2), [1.5, 9.1, 229.2], [-7.3, 17.0, 229.6]);
    return out;
  });
  check('bounce shroom BS1 (bog) launches Morel onto the cage pillar (y 7.2)', r.bs1.bounces >= 1 && r.bs1.ok, r.bs1);
  check('bounce shroom BS3 (glade) launches Morel onto the cage pillar (y 9.6)', r.bs3.bounces >= 1 && r.bs3.ok, r.bs3);
  check('bounce shroom BS2 (plateau) launches Morel onto the watchtower (y 17)', r.bs2.bounces >= 1 && r.bs2.ok, r.bs2);

  // ------------------------------------------------------------ sinking pad: sinks, drops Morel, resurfaces
  r = await G((g) => {
    const pad = g.ctx.level.spawned.find((e) => e.type === 'sinkingPad');
    g.player.hp = 5; g.teleport(pad.position.x, 1.2, pad.position.z, 0); g.step(30);
    const onIt = g.player.body.ground === pad.collider;
    g.clearEvents();
    const states = [];
    for (let i = 0; i < 420; i++) { g.step(1); if (states[states.length - 1] !== pad.state) states.push(pad.state); }
    return { onIt, states, fell: g.events('player:fell').length, enabled: pad.collider.enabled, y: +pad.position.y.toFixed(2) };
  });
  check('sinking pad: idle -> loaded -> sinking -> hidden -> rising -> idle, Morel drops in', r.onIt && r.fell === 1 && r.states.join(',').includes('loaded,sinking,hidden,rising,idle') && r.enabled && Math.abs(r.y - 0.36) < 0.02, r);

  // ------------------------------------------------------------ iron gate: puffs bounce off with a hint
  r = await G((g) => {
    g.player.setTonic(null); g.player.hp = 5;
    g.teleport(0, 7.1, 299, 0); g.step(10); window.__lv.aim(0, 304.3); g.clearEvents();
    g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(40);
    const gate = g.ctx.level.spawned.find((e) => e.type === 'ironGate');
    return { hits: g.events('projectile:hit').map((e) => e.payload.collider), msgs: g.events('ui:message').length, open: gate.isOpen };
  });
  check('iron gate: a spore puff clangs off (hint toast, stays shut)', r.hits.length >= 1 && r.msgs === 1 && !r.open, r);

  // ------------------------------------------------------------ arena lock: lock, waves, clear, open
  r = await G((g) => {
    const L = window.__lv;
    const arena = g.ctx.level.spawned.find((e) => e.type === 'arenaLock');
    const gate = g.ctx.level.spawned.find((e) => e.type === 'ironGate');
    gate.open();
    g.step(90);
    g.player.hp = 5; g.teleport(0, 7.1, 309, 0); g.step(5); g.clearEvents();
    L.walkTo(0, 314, 0.4, 200);
    g.step(60);
    const out = { lock: g.events('arena:lock').length, gatesShut: arena.gates.every((x) => x.collider.enabled), wave0: arena.enemies.length };
    for (const e of arena.enemies) e.alive = false;
    g.step(120);
    out.wave1 = arena.enemies.length; out.waveEvents = g.events('arena:wave').map((e) => e.payload.wave);
    for (const e of arena.enemies) e.alive = false;
    g.step(60);
    out.clear = g.events('arena:clear').length; out.gatesOpen = arena.gates.every((x) => !x.collider.enabled); out.flag = !!g.ctx.flags.arenaClear_courtyard;
    g.step(80);
    out.exit = L.walkTo(0, 338, 0.4, 400).ok;
    return out;
  });
  check('arena: entering locks both gates and spawns wave 1 (3)', r.lock === 1 && r.gatesShut && r.wave0 === 3, r);
  check('arena: clearing wave 1 brings wave 2 (4)', r.wave1 === 4 && JSON.stringify(r.waveEvents) === '[0,1]', r);
  check('arena: clearing wave 2 opens the gates (arena:clear, flag) and the exit is walkable', r.clear === 1 && r.gatesOpen && r.flag && r.exit, r);

  r = await G((g) => {
    const L = window.__lv;
    const arena = g.ctx.level.spawned.find((e) => e.type === 'arenaLock');
    arena.reset();
    g.player.hp = 5; g.player.setCheckpoint('bog', [0, 9, 239], 0);
    g.teleport(0, 7.1, 309, 0); g.step(5); g.clearEvents();
    L.walkTo(0, 314, 0.4, 200); g.step(60);
    const locked = arena.state, spawned = arena.enemies.slice();
    g.player.die();
    g.step(130);
    return { locked, resets: g.events('arena:reset').length, state: arena.state, gatesOpen: arena.gates.every((x) => !x.collider.enabled), removed: spawned.every((e) => !e.alive), at: g.player.checkpoint.id };
  });
  check('arena: dying inside resets it (enemies removed, gates open, idle) once Morel respawns', r.locked === 'locked' && r.resets === 1 && r.state === 'idle' && r.gatesOpen && r.removed, r);

  // ------------------------------------------------------------ pit gate closes on boss:start, opens on boss:defeated / death
  r = await G((g) => {
    const gate = g.ctx.level.spawned.find((e) => e.type === 'eventGate');
    const a = gate.isOpen;
    g.ctx.events.emit('boss:start', { maxHp: 30 }); g.step(40);
    const b = gate.isOpen, col = gate.collider.enabled;
    g.ctx.events.emit('boss:defeated', { position: g.player.position.clone() }); g.step(80);
    return { startOpen: a, closed: !b && col, reopened: gate.isOpen && !gate.collider.enabled };
  });
  check('pit gate: open -> closes on boss:start -> opens on boss:defeated', r.startOpen && r.closed && r.reopened, r);

  // ------------------------------------------------------------ updraft snuffed entering the fort; bounds safety net
  r = await G((g) => {
    g.player.hp = 5; g.teleport(0, 9.1, 245, 0); g.step(5);
    g.give('updraft'); g.clearEvents();
    g.teleport(0, 7.6, 255, 0); g.step(5);
    const snuff = { tonic: g.player.tonic, msg: g.events('ui:message').map((e) => e.payload.text) };
    g.teleport(90, 40, 200, 0); g.step(3);
    const p = g.player.position;
    return { snuff, clamped: [+p.x.toFixed(2), +p.z.toFixed(2)] };
  });
  check('updraft is snuffed when Morel enters the fort zone', r.snuff.tonic === null && r.snuff.msg.some((m) => /Updraft/.test(m)), r.snuff);
  check('bounds: far outside the level is clamped back (x <= 62)', r.clamped[0] <= 62, r.clamped);

  await G((g) => { g.setInput(null); g.gotoCheckpoint('start'); g.step(5); });
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { passed: checks.length - failed.length, total: checks.length, failed };
}
