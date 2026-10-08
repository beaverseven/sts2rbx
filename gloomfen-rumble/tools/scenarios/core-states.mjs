// State machine + real keyboard input (real-time loop, not step()).
//   node tools/scenario.mjs tools/scenarios/core-states.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
export default async function (page, h) {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  await page.goto(page.url().split('?')[0] + '?state=title');
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.real > 0.3, null, { timeout: 15000 });
  const t0 = await h.game((g) => ({ state: g.ctx.state, yaw: g.ctx.cameraRig.yaw }));
  await page.waitForFunction((y) => window.__game.ctx.cameraRig.yaw > y + 0.02, t0.yaw, { timeout: 15000 }).catch(() => null);
  const t1 = await h.game((g) => ({ state: g.ctx.state, yaw: g.ctx.cameraRig.yaw, time: g.ctx.time.now }));
  await h.shot('title-orbit');
  check('?state=title starts in title; camera orbits; sim frozen', t0.state === 'title' && t1.yaw > t0.yaw && t1.time === 0, { t0, t1 });

  await h.game((g) => g.start());
  await page.waitForFunction(() => window.__game.ctx.time.now > 0.2, null, { timeout: 8000 });
  // real keyboard: run forward and jump
  await page.keyboard.down('KeyW');
  await h.wait(1200);
  await page.keyboard.press('Space');
  await h.wait(300);
  await page.keyboard.up('KeyW');
  await h.wait(500);
  const k = await h.game((g) => ({ state: g.ctx.state, z: g.ctx.player.position.z, jumps: g.events('player:jump').length }));
  check('keyboard W runs forward, Space jumps', k.state === 'playing' && k.z > 0.5 && k.jumps >= 1, k);

  // headless SwiftShader frames are slow: wait for the state instead of a fixed delay
  const waitState = (st) => page.waitForFunction((x) => window.__game.ctx.state === x, st, { timeout: 8000 }).catch(() => null);
  await page.keyboard.press('Escape');
  await waitState('paused');
  const p1 = await h.game((g) => ({ state: g.ctx.state, time: g.ctx.time.now }));
  await h.wait(700);
  const p2 = await h.game((g) => ({ state: g.ctx.state, time: g.ctx.time.now }));
  await page.keyboard.press('KeyP');
  await waitState('playing');
  const p3 = await h.game((g) => ({ state: g.ctx.state }));
  check('Esc pauses (sim frozen), P resumes', p1.state === 'paused' && p2.time === p1.time && p3.state === 'playing', { p1, p2, p3 });

  const ev = await h.game((g) => g.events('game:state').map((e) => `${e.payload.prev}->${e.payload.state}`));
  check('game:state events emitted', ev.includes('title->playing') && ev.includes('playing->paused') && ev.includes('paused->playing'), ev);
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { passed: checks.length - failed.length, total: checks.length, failed };
}
