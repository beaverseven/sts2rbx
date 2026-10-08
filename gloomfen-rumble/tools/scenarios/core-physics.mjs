// Physics / controller checks in the test arena. Prints PASS/FAIL per check.
//   node tools/scenario.mjs tools/scenarios/core-physics.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
export default async function (page, h) {
  await h.wait(300);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const G = (fn, arg) => h.game(fn, arg);

  // --- step-up lanes (walk +Z into boxes of known height)
  for (const height of [0.2, 0.35, 0.5, 1]) {
    const r = await G((g, ht) => {
      const lane = g.ctx.level.testPoints.lanes[ht];
      g.setInput(null); g.teleport(lane.start[0], lane.start[1], lane.start[2], 0); g.setCamera(0, 0.22, 7.5); g.step(5);
      g.setInput({ move: [0, 1] }); g.step(42); g.setInput(null); g.step(10);
      const p = g.ctx.player.position;
      return { y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
    }, height);
    if (height <= 0.35) check(`step-up onto ${height} m`, Math.abs(r.y - (1 + height)) < 0.01 && r.z > 8.5, r);
    else check(`${height} m box blocks walking`, Math.abs(r.y - 1) < 0.01 && r.z < 8, r);
  }

  // --- wall slide: walk diagonally into the tall wall (z 38..39, x -14..-2)
  {
    const r = await G((g) => {
      g.setInput(null); g.teleport(-6, 1, 35, 0); g.setCamera(0, 0.22, 7.5); g.step(5);
      g.setInput({ move: [0.6, 0.8] }); g.step(30);
      const a = g.ctx.player.position.clone();
      g.step(40);
      const b = g.ctx.player.position.clone(); g.setInput(null);
      return { a: a.toArray().map((v) => +v.toFixed(3)), b: b.toArray().map((v) => +v.toFixed(3)), hitWall: g.ctx.player.body.hitWall };
    });
    check('wall slide (blocked in z, keeps moving along x)', r.b[2] < 38 - 0.3 + 0.01 && r.b[2] > 37.5 && r.a[0] - r.b[0] > 2, r);
  }

  // --- no tunnelling: 60 m falls onto a 0.3 m slab and onto terrain
  {
    const r = await G((g) => {
      const s = g.ctx.level.testPoints.slabCenter;
      g.setInput(null); g.teleport(s[0], s[1] + 60, s[2], 0);
      let maxSpeed = 0;
      for (let i = 0; i < 300 && !g.ctx.player.onGround; i++) { g.step(1); maxSpeed = Math.max(maxSpeed, -g.ctx.player.velocity.y); }
      const y1 = g.ctx.player.position.y;
      g.teleport(0, 61, -6, 0);
      for (let i = 0; i < 300 && !g.ctx.player.onGround; i++) g.step(1);
      return { slabY: +y1.toFixed(3), terrainY: +g.ctx.player.position.y.toFixed(3), maxFallSpeed: +maxSpeed.toFixed(2) };
    });
    check('60 m fall lands on 0.3 m slab (no tunnelling)', Math.abs(r.slabY - 4.0) < 0.01, r);
    check('60 m fall lands on terrain', Math.abs(r.terrainY - 1.0) < 0.01, r);
  }

  // --- ceiling bump with a runtime collider
  {
    const r = await G((g) => {
      const c = g.ctx.physics.addBox({ min: [-1, 3.0, -11], max: [1, 3.5, -9], tag: 'testCeiling' });
      g.setInput(null); g.teleport(0, 1, -10, 0); g.step(5);
      g.setInput({ jump: true }); let maxY = 0, hit = false;
      for (let i = 0; i < 40; i++) { g.step(1); maxY = Math.max(maxY, g.ctx.player.position.y); hit = hit || g.ctx.player.body.hitCeiling; }
      g.setInput(null); g.step(30);
      g.ctx.physics.removeCollider(c);
      return { maxY: +maxY.toFixed(3), hit };
    });
    check('ceiling bump stops the jump', r.hit && r.maxY <= 3.0 - 1.05 + 0.01, r);
  }

  // --- steep mound acts as a wall when climbing
  {
    const r = await G((g) => {
      const m = g.ctx.level.testPoints.mound;
      g.setInput(null); g.teleport(m[0] - 9, 1.5, m[2], Math.PI / 2); g.setCamera(Math.PI / 2, 0.22, 7.5); g.step(10);
      g.setInput({ move: [0, 1] }); g.step(180); g.setInput(null);
      const p = g.ctx.player.position;
      return { y: +p.y.toFixed(2), top: +m[1].toFixed(2), x: +p.x.toFixed(2), centreX: m[0] };
    });
    check('steep (>50°) slope cannot be walked up', r.y < r.top - 2.5, r);
  }

  // --- moving platform carries Morel
  {
    const r = await G((g) => {
      const mv = g.ctx.level.testPoints.mover;
      g.setInput(null);
      const c = mv.collider;
      g.teleport(c.center.x + 0.4, c.max.y + 0.05, c.center.z, 0); g.step(3);
      const off0 = g.ctx.player.position.clone().sub(c.center);
      const start = c.center.clone();
      let on = 0;
      for (let i = 0; i < 150; i++) { g.step(1); if (g.ctx.player.onGround && g.ctx.player.body.ground === c) on++; }
      const off1 = g.ctx.player.position.clone().sub(c.center);
      return { moved: +c.center.distanceTo(start).toFixed(2), drift: +off0.distanceTo(off1).toFixed(3), onSteps: on };
    });
    check('moving platform carries Morel', r.moved > 2 && r.drift < 0.05 && r.onSteps >= 148, r);
  }

  // --- falling in the bog pool costs a heart and respawns on safe ground
  {
    const r = await G((g) => {
      g.clearEvents(); g.godMode(false);
      const e = g.ctx.level.testPoints.poolEdge;
      g.setInput(null); g.ctx.player.hp = 5;
      g.teleport(e[0] + 2, e[1] + 0.2, e[2], -Math.PI / 2); g.setCamera(-Math.PI / 2, 0.22, 7.5); g.step(30);
      g.setInput({ move: [0, 1] });
      let fell = false;
      for (let i = 0; i < 300 && !fell; i++) { g.step(1); fell = g.events('player:fell').length > 0; }
      g.setInput(null); g.step(90);
      const p = g.ctx.player.position;
      const names = g.events().map((x) => x.name).filter((n) => n.startsWith('player:') && n !== 'player:step');
      return { fell, hp: g.ctx.player.hp, pos: p.toArray().map((v) => +v.toFixed(2)), events: names, onGround: g.ctx.player.onGround };
    });
    check('pool fall: -1 heart, respawn on safe ground', r.fell && r.hp === 4 && r.pos[1] > 0.8 && r.onGround && r.events.includes('player:respawn') && r.events.includes('player:hurt'), r);
  }

  // --- hurt: knockback + invulnerability
  {
    const r = await G((g) => {
      const p = g.ctx.player; p.hp = 5; g.setInput(null); g.teleport(0, 1, -4, 0); g.step(100);
      const from = p.position.clone(); from.z += 1;
      const a = p.damage(1, from); g.step(1);
      const vz = p.velocity.z;
      const b = p.damage(1, from); g.step(90);
      const c = p.damage(1, from);
      return { first: a, second: b, afterInvuln: c, knockVz: +vz.toFixed(2), hp: p.hp };
    });
    check('damage knocks back, grants invulnerability', r.first && !r.second && r.afterInvuln && r.knockVz < -5 && r.hp === 3, r);
  }

  // --- death respawns at the checkpoint with full hearts
  {
    const r = await G((g) => {
      g.clearEvents();
      g.gotoCheckpoint('tower'); g.step(30);
      g.teleport(5, 1, 0, 0); g.step(100);
      g.ctx.player.damage(10, null);
      const st1 = g.ctx.state;
      g.step(130);
      const ev = g.events().filter((x) => x.name === 'player:died' || x.name === 'player:respawn' || x.name === 'game:state');
      return { stateWhenDead: st1, state: g.ctx.state, hp: g.ctx.player.hp, pos: g.ctx.player.position.toArray().map((v) => +v.toFixed(2)), ev };
    });
    const resp = r.ev.find((e) => e.name === 'player:respawn');
    check('death -> state dead -> respawn at checkpoint, full hp', r.stateWhenDead === 'dead' && r.state === 'playing' && r.hp === 5 && Math.abs(r.pos[0] + 10) < 0.01 && Math.abs(r.pos[1] - 7) < 0.01 && resp && resp.payload.checkpointId === 'tower', r);
  }

  // --- camera against the wall: Morel's back to the wall, camera must stay in front of it
  {
    const r = await G((g) => {
      const w = g.ctx.level.testPoints.wallFront;
      g.setInput(null); g.teleport(w[0], w[1], w[2], Math.PI); g.step(5);
      g.setCamera(Math.PI, 0.22, 7.5); g.step(30);
      const c = g.ctx.camera.position;
      return { cam: c.toArray().map((v) => +v.toFixed(2)), dist: +g.ctx.cameraRig.currentDistance.toFixed(2) };
    });
    await h.wait(500);
    await h.shot('camera-wall');
    check('camera pulls in instead of clipping into the wall', r.cam[2] < 38 - 0.1, r);
    const r2 = await G((g) => {
      g.setCamera(Math.PI - 0.9, 0.1, 7.5); g.step(30);
      const c = g.ctx.camera.position;
      return { cam: c.toArray().map((v) => +v.toFixed(2)), dist: +g.ctx.cameraRig.currentDistance.toFixed(2) };
    });
    await h.wait(500);
    await h.shot('camera-wall-angled');
    check('camera at an angle to the wall stays in front', r2.cam[2] < 38 - 0.1, r2);
  }

  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { passed: checks.length - failed.length, total: checks.length, failed };
}
