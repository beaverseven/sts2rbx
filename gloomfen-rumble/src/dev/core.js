// Core sandbox: boot with the built-in test arena (+ a small controls legend, sandbox only).
//   node tools/build.mjs --entry src/dev/core.js --out dist/dev-core --dev
import { boot } from '../core/boot.js';

const ctx = boot({ startState: 'playing' });

const legend = document.createElement('div');
legend.style.cssText = 'position:fixed;left:12px;bottom:10px;padding:6px 10px;border-radius:8px;background:rgba(26,21,48,.55);' +
  'color:#f3e6c8;font:12px/1.5 system-ui,sans-serif;pointer-events:none;white-space:nowrap';
legend.textContent = 'WASD move · Space jump (hold: glide) · J / LMB throw (hold: charge) · K / Shift / RMB lock · Q/E camera · Esc pause · 1/2/3 tonics';
document.body.appendChild(legend);
window.addEventListener('keydown', (e) => {
  const kind = { Digit1: 'anvil', Digit2: 'updraft', Digit3: 'seeker' }[e.code];
  if (kind) ctx.player.setTonic(kind);
});
