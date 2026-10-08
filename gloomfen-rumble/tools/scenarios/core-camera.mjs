// Camera rig checks: Q/E snap, auto-recentre, look input, shake, lock framing distance.
//   node tools/scenario.mjs tools/scenarios/core-camera.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
export default async function (page, h) {
  await h.wait(300);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  const G = (fn, arg) => h.game(fn, arg);

  const snap = await G((g) => {
    g.setInput(null); g.teleport(0, 1, -4, 0); g.setCamera(0, 0.22, 7.5); g.step(5);
    const y0 = g.ctx.cameraRig.yaw;
    g.setInput({ camLeft: true }); g.step(1); g.setInput({}); g.step(40);
    const y1 = g.ctx.cameraRig.yaw;
    g.setInput({ camRight: true }); g.step(1); g.setInput({}); g.step(1); g.setInput({ camRight: true }); g.step(1); g.setInput({}); g.step(40);
    return { y0, y1: +y1.toFixed(4), y2: +g.ctx.cameraRig.yaw.toFixed(4) };
  });
  check('Q snaps +45°, E twice snaps -90°', Math.abs(snap.y1 - Math.PI / 4) < 0.01 && Math.abs(snap.y2 + Math.PI / 4) < 0.01, snap);

  const rec = await G((g) => {
    g.setInput(null); g.teleport(-1, 1, 30, 0); g.step(5);
    // turn the camera to look along +X with look input (as a mouse would), then run camera-left (-Z)
    for (let i = 0; i < 10; i++) { g.ctx.input.look.set(-Math.PI / 20, 0); g.ctx.cameraRig.update(1 / 60); }
    g.ctx.input.look.set(0, 0);
    g.setInput({ move: [-0.6, 0.8] }); g.step(60);
    const early = g.ctx.cameraRig.yaw;
    g.step(150);
    const late = g.ctx.cameraRig.yaw;
    const moveYaw = Math.atan2(g.ctx.player.velocity.x, g.ctx.player.velocity.z);
    g.setInput({ move: [-1, 0] }); g.step(30); const s0 = g.ctx.cameraRig.yaw; g.step(120); const s1 = g.ctx.cameraRig.yaw;
    g.setInput(null);
    return { early: +early.toFixed(3), late: +late.toFixed(3), moveYaw: +moveYaw.toFixed(3), sidewaysDrift: +Math.abs(s1 - s0).toFixed(4) };
  });
  check('camera holds 1.5 s, then swings behind forward-diagonal movement; pure sideways input does not spin it', Math.abs(rec.early - Math.PI / 2) < 0.02 && rec.late - rec.early > 0.4 && rec.sidewaysDrift < 0.001, rec);

  const look = await G((g) => {
    g.setInput(null); g.teleport(0, 1, -4, 0); g.setCamera(0, 0.22, 7.5); g.step(5);
    const p0 = g.ctx.cameraRig.pitch;
    // simulate mouse look through the internal look vector for 10 steps
    for (let i = 0; i < 10; i++) { g.ctx.input.look.set(0.05, 0.2); g.ctx.cameraRig.update(1 / 60); }
    return { yaw: +g.ctx.cameraRig.yaw.toFixed(3), pitch: +g.ctx.cameraRig.pitch.toFixed(3), p0 };
  });
  check('look input orbits with pitch clamp', Math.abs(look.yaw + 0.5) < 0.01 && look.pitch <= 1.15 + 1e-6 && look.pitch > 1.1, look);

  const sh = await G((g) => {
    g.setInput(null); g.setCamera(0, 0.22, 7.5); g.step(5);
    const a = g.ctx.camera.position.clone();
    g.ctx.cameraRig.shake(0.5, 0.4); g.step(3);
    const b = g.ctx.camera.position.clone();
    g.step(40);
    const c = g.ctx.camera.position.clone();
    g.step(2);
    const d = g.ctx.camera.position.clone();
    return { during: +a.distanceTo(b).toFixed(3), after: +c.distanceTo(d).toFixed(4) };
  });
  check('shake(amount, duration) offsets then settles', sh.during > 0.05 && sh.after < 0.01, sh);

  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { passed: checks.length - failed.length, total: checks.length, failed };
}
