// Enemies sandbox: the core test arena + a few of each Bog Bandit.
//   node tools/build.mjs --entry src/dev/enemies.js --out dist/dev-enemies --dev
// Keys: 1/2/3 drink an Anvil / Updraft / Seeker tonic, R respawns every bandit, G toggles god mode.
// The boss fight has its own sandbox: src/dev/boss.js.
import { boot } from '../core/boot.js';
import { buildTestArena } from '../core/testArena.js';
import { installEnemies } from '../game/enemies/index.js';

/** Sandbox spawn list (positions in the core test arena). */
export const SANDBOX_SPAWNS = [
  { type: 'grunt', pos: [-3, 1, 13], yaw: Math.PI, patrol: 3 },
  { type: 'grunt', pos: [12, 1, 33], yaw: Math.PI },
  { type: 'grunt', pos: [-15, 1, 10], yaw: -Math.PI / 2, patrol: 5 },   // next to the bog pool
  { type: 'slinger', pos: [20.5, 2.8, 16], yaw: Math.PI, patrol: 0 },   // on the stair landing (1.8 m ledge)
  { type: 'slinger', pos: [26, 1, 40], yaw: Math.PI },
  { type: 'ironbelly', pos: [4, 1, 38], yaw: Math.PI },
  { type: 'ironbelly', pos: [-6, 1, 30], yaw: Math.PI * 0.8 },
];

function buildLevel(ctx) {
  const level = buildTestArena(ctx);
  for (const def of SANDBOX_SPAWNS) ctx.entities.spawn({ ...def });
  return level;
}

const ctx = boot({ startState: 'playing', install: [installEnemies], buildLevel });

function respawnAll() {
  for (const e of ctx.enemies.list()) e.alive = false;
  ctx.entities.flush();
  ctx.enemies.fx.clearAll();
  for (const def of SANDBOX_SPAWNS) ctx.entities.spawn({ ...def });
}
window.__enemies = { respawnAll, spawns: SANDBOX_SPAWNS };

const legend = document.createElement('div');
legend.style.cssText = 'position:fixed;left:12px;bottom:10px;padding:6px 10px;border-radius:8px;background:rgba(26,21,48,.55);' +
  'color:#f3e6c8;font:12px/1.5 system-ui,sans-serif;pointer-events:none;white-space:nowrap';
legend.textContent = 'WASD move · Space jump · J / LMB throw (hold: charge) · K / Shift lock · 1/2/3 tonics · R respawn bandits · G god mode';
document.body.appendChild(legend);
window.addEventListener('keydown', (e) => {
  const kind = { Digit1: 'anvil', Digit2: 'updraft', Digit3: 'seeker' }[e.code];
  if (kind) ctx.player.setTonic(kind);
  if (e.code === 'KeyR') respawnAll();
  if (e.code === 'KeyG') ctx.player.god = !ctx.player.god;
});
