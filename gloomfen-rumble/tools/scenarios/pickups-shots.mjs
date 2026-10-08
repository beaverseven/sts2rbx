// Screenshots of every pickup (close-ups + distance views) in the pickups sandbox.
//   node tools/scenario.mjs tools/scenarios/pickups-shots.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  await h.game((g) => { g.setQuality('high'); g.godMode(true); g.step(30); });
  const portrait = async (name, eye, target, wait = 700) => {
    await h.game((g, a) => window.__pt.portrait(a.eye, a.target), { eye, target });
    await h.wait(wait);
    await h.shot(name);
  };
  const out = {};

  // gameplay view from the spawn
  await h.game((g) => { g.teleport(0, 1, -1.5, 0); g.setCamera(0, 0.28, 7.5); g.step(20); });
  await h.wait(900);
  await h.shot('overview');
  out.overviewCalls = await h.game(() => window.__pt.calls());

  await portrait('glowcaps-close', [1.5, 2.25, 1.6], [0, 1.85, 4.6]);
  await portrait('berry-close', [4.7, 1.95, 2.9], [3.5, 1.35, 4.5]);
  await portrait('tonics-close', [-6.5, 2.3, 2.2], [-6.5, 1.85, 5]);
  await portrait('tonic-updraft-close', [-6.5, 2.1, 3.6], [-6.5, 1.95, 5]);
  await portrait('cage-post-close', [-6 + 0.75, 2.5, 11 + 2.5], [-6, 1.85, 11]);
  await portrait('cage-hanging-close', [12.6, 3.6, 13.6], [14, 3.2, 16]);
  await portrait('checkpoint-unlit', [5.9, 2.2, -7], [4.6, 1.9, -3]);

  // light the checkpoint, let it settle
  await h.game((g) => { window.__pt.resume(); g.ctx.pickups.lightCheckpoint('sandA'); g.step(50); });
  await portrait('checkpoint-lit', [5.9, 2.2, -7], [4.6, 1.9, -3]);
  await portrait('checkpoint-lit-far', [8, 3, -14], [5, 1.8, -3]);

  // Lantern Gate: rise sequence
  await h.game((g) => { window.__pt.resume(); g.ctx.events.emit('boss:defeated', { position: null }); g.step(96 + 100); });
  await portrait('gate-rising', [16, 3.2, 25], [16, 2.6, 34]);
  await h.game((g) => { window.__pt.resume(); g.step(260); });
  await portrait('gate-open', [16, 3.0, 26.5], [16, 2.6, 34]);
  await portrait('gate-open-side', [11, 2.4, 30], [16, 2.4, 34]);

  // distance read (10-25 m)
  await portrait('distance-read', [0, 3.2, -12], [-2, 1.6, 8]);
  await h.game(() => window.__pt.resume());
  return out;
}
