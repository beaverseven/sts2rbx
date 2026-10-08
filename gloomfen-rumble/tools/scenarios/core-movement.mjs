// Movement measurements (numbers for level designers). Deterministic via __game.step.
//   node tools/scenario.mjs tools/scenarios/core-movement.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
import { installHelpers } from './core-helpers.mjs';

export default async function (page, h) {
  await h.wait(300);
  await installHelpers(page);
  const T = (o) => page.evaluate((a) => window.__t.jump(a), o);
  const flat = [0, 1, -6];
  const res = {};
  res.standingFullJump = await T({ start: flat, yaw: 0, jump: 'hold' });
  res.standingTap = await T({ start: flat, yaw: 0, jump: 'tap' });
  res.runningFullJump = await T({ start: [0, 1, -8], yaw: Math.PI / 2, move: [0, 1], runSteps: 30, jump: 'hold' });
  res.runningTapJump = await T({ start: [0, 1, -8], yaw: Math.PI / 2, move: [0, 1], runSteps: 30, jump: 'tap' });
  res.runningJumpGlide = await T({ start: [-14, 1, -6], yaw: Math.PI / 2, move: [0, 1], runSteps: 30, jump: 'holdGlide' });
  // 6 m tower edge at z = 24, run toward -Z
  const tower = [-10, 7, 27.6];
  res.ledge6_walkOff = await T({ start: tower, yaw: Math.PI, move: [0, 1], jump: 'none' });
  res.ledge6_walkOffGlide = await T({ start: tower, yaw: Math.PI, move: [0, 1], jump: 'walkGlide', glideAfterAir: 9 });
  res.ledge6_jumpGlide = await T({ start: tower, yaw: Math.PI, move: [0, 1], runSteps: 22, jump: 'holdGlide' });
  res.ledge6_jumpNoGlide = await T({ start: tower, yaw: Math.PI, move: [0, 1], runSteps: 22, jump: 'hold' });
  const runSpeed = await page.evaluate(() => { const g = window.__game; g.setInput(null); g.teleport(0, 1, -8, Math.PI / 2); g.ctx.cameraRig.setView(Math.PI / 2, 0.22, 7.5); g.step(5); g.setInput({ move: [0, 1] }); g.step(40); const v = g.ctx.player.velocity; const s = Math.hypot(v.x, v.z); g.setInput(null); return Math.round(s * 1000) / 1000; });
  res.runSpeed = runSpeed;
  for (const [k, v] of Object.entries(res)) h.log(k, JSON.stringify(v));
  return res;
}
