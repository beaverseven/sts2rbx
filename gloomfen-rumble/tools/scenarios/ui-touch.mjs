// Touch controls with real multi-touch (CDP touch emulation): joystick + jump at the same time,
// right-half camera drag, hold-to-charge throw, pause button, tapping a menu button.
//   node tools/scenario.mjs tools/scenarios/ui-touch.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots --w 400 --h 860
export default async function (page, h) {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); if (!ok) h.log('FAIL', name, JSON.stringify(info)); };
  const base = page.url().split('?')[0];
  await page.goto(`${base}?state=playing&dev=0`);
  await page.waitForFunction(() => window.__game && window.__ui && document.fonts.status === 'loaded', null, { timeout: 30000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })) });
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const vp = page.viewportSize();
  const W = vp.width, H = vp.height;

  await h.game((g) => { g.setQuality('low'); g.godMode(true); g.teleport(2, 1, 2, 0); g.setCamera(0, 0.25, 7.5); g.step(20); });
  // first touch switches the touch layer on (devices without a coarse pointer)
  await touch('touchStart', [[9, W * 0.5, H * 0.5]]);
  await touch('touchEnd', []);
  await frame();
  const on = await page.evaluate(() => ({ on: window.__ui.touch.enabled, active: window.__ui.touch.active, mode: document.getElementById('ui').classList.contains('touch-mode') }));
  check('first touch enables the touch layer', on.on && on.active && on.mode, on);

  const btn = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const jumpXY = await btn('.tbtn-jump');
  const throwXY = await btn('.tbtn-throw');
  const pauseXY = await btn('.tpause');

  // joystick (finger 0) + jump (finger 1) together
  const sx = W * 0.22, sy = H * 0.75;
  await touch('touchStart', [[0, sx, sy]]);
  await touch('touchMove', [[0, sx + 2, sy - 40]]);
  await touch('touchStart', [[0, sx + 2, sy - 40], [1, jumpXY[0], jumpXY[1]]]);
  await frame();
  const both = await h.game((g) => { const y0 = g.ctx.player.position.y; g.step(12); const i = g.ctx.input; return { move: [i.move.x, i.move.y], jump: i.down('jump'), dy: g.ctx.player.position.y - y0, onGround: g.ctx.player.onGround }; });
  check('stick pushes forward while jump is held', both.move[1] > 0.6 && both.jump, both);
  check('Morel jumps while running', both.dy > 0.3 && !both.onGround, both);
  await h.shot(`${W}x${H}-touch-stick-jump`);
  await touch('touchEnd', [[1, jumpXY[0], jumpXY[1]]]); // CDP: touchEnd lists the points that lift
  await frame();
  const rel1 = await h.game((g) => { g.step(2); const i = g.ctx.input; return { move: [i.move.x, i.move.y], jump: i.down('jump') }; });
  check('lifting the jump finger releases jump, stick stays', !rel1.jump && rel1.move[1] > 0.6, rel1);
  await touch('touchEnd', []);
  await frame();
  const rel2 = await h.game((g) => { g.step(2); const i = g.ctx.input; return { move: [i.move.x, i.move.y] }; });
  check('lifting the stick finger stops moving', rel2.move[0] === 0 && rel2.move[1] === 0, rel2);

  // camera drag on the right half (finger 2)
  const yaw0 = await h.game((g) => { g.step(30); return g.ctx.cameraRig.yaw; });
  await touch('touchStart', [[2, W * 0.7, H * 0.4]]);
  for (let k = 1; k <= 4; k++) { await touch('touchMove', [[2, W * 0.7 - k * 25, H * 0.4]]); await h.game((g) => g.step(1)); }
  await touch('touchEnd', []);
  const yaw1 = await h.game((g) => { g.step(2); return g.ctx.cameraRig.yaw; });
  check('right-half drag turns the camera', Math.abs(yaw1 - yaw0) > 0.15, { yaw0, yaw1 });

  // hold throw to charge, release to throw (finger 3)
  await h.game((g) => g.clearEvents());
  await touch('touchStart', [[3, throwXY[0], throwXY[1]]]);
  await frame();
  const ch = await h.game((g) => { g.step(45); return g.ctx.player.charge; });
  await frame();
  const ring = await page.evaluate(() => { const c = document.querySelector('.tbtn-throw .tring circle'); return Number(c.getAttribute('stroke-dashoffset')); });
  await touch('touchEnd', []);
  await frame();
  const thrown = await h.game((g) => { g.step(4); return g.events('player:throw').map((e) => e.payload.charge); });
  check('holding Throw charges', ch > 0.6, { ch });
  check('throw button ring shows the charge', ring < 40, { ring });
  check('releasing Throw throws a charged puff', thrown.length === 1 && thrown[0] > 0.6, { thrown });

  // pause button
  await touch('touchStart', [[4, pauseXY[0], pauseXY[1]]]);
  await touch('touchEnd', []);
  await frame();
  await h.game((g) => g.step(1));
  await page.waitForFunction(() => window.__ui.menus.current === 'pause', null, { timeout: 15000 }).catch(() => {});
  const pz = await page.evaluate(() => ({ state: window.__ui.ctx.state, menu: window.__ui.menus.current, idle: document.querySelector('.touch').classList.contains('is-idle') }));
  check('pause button pauses, touch controls hide', pz.state === 'paused' && pz.menu === 'pause' && pz.idle, pz);

  // tap Resume
  await h.wait(600);
  const resumeXY = await btn('.menu-pause .btn');
  await touch('touchStart', [[5, resumeXY[0], resumeXY[1]]]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__ui.ctx.state === 'playing', null, { timeout: 15000 }).catch(() => {});
  const rs = await page.evaluate(() => ({ state: window.__ui.ctx.state, idle: document.querySelector('.touch').classList.contains('is-idle') }));
  check('tapping Resume resumes, touch controls return', rs.state === 'playing' && !rs.idle, rs);

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, errors: h.errors.length };
}
