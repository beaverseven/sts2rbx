// Level sandbox: Gloomfen with only the level area installed (pickups / enemies show as
// labelled placeholders). Sandbox-only overlay: toast for ui:message, zone banner,
// draw-call counter; keys 1/2/3 drink a tonic, N / B jump to the next / previous checkpoint.
//   node tools/build.mjs --entry src/dev/level.js --out dist/dev-level --dev
import { boot } from '../core/boot.js';
import { buildLevel } from '../game/level/builder.js';
import { installMechanisms } from '../game/level/mechanisms.js';

const ctx = boot({ startState: 'playing', buildLevel, install: [installMechanisms] });

const css = 'position:fixed;pointer-events:none;color:#f3e6c8;font:13px/1.45 system-ui,sans-serif;background:rgba(26,21,48,.6);border-radius:8px;padding:6px 10px;';
const legend = document.createElement('div');
legend.style.cssText = css + 'left:12px;bottom:10px;white-space:nowrap;font-size:12px';
legend.textContent = 'WASD move · Space jump/glide · J throw · K lock · 1/2/3 tonics · N/B next/prev checkpoint';
const toast = document.createElement('div');
toast.style.cssText = css + 'left:50%;bottom:52px;transform:translateX(-50%);max-width:70%;text-align:center;font-size:15px;display:none';
const zone = document.createElement('div');
zone.style.cssText = css + 'left:50%;top:18px;transform:translateX(-50%);font:600 20px Georgia,serif;letter-spacing:.06em;display:none';
const info = document.createElement('div');
info.style.cssText = css + 'right:10px;top:10px;font:11px monospace';
document.body.append(legend, toast, zone, info);

let toastT = 0, zoneT = 0, calls = 0;
ctx.renderer.info.autoReset = false; // count every pass of a frame (shadow + main + bloom)
ctx.events.on('ui:message', ({ text, duration }) => { toast.textContent = text; toast.style.display = 'block'; toastT = duration ?? 3; });
ctx.events.on('zone:enter', ({ name }) => { zone.textContent = name; zone.style.display = 'block'; zoneT = 3; });
ctx.addSystem({
  frame(dt) {
    if (toastT > 0 && (toastT -= dt) <= 0) toast.style.display = 'none';
    if (zoneT > 0 && (zoneT -= dt) <= 0) zone.style.display = 'none';
    const p = ctx.player.position, ri = ctx.renderer.info;
    calls = ri.render.calls; ri.reset();
    info.textContent = `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · ${ctx.level.zone} · calls ${calls}`;
  },
});

const cpIds = () => window.__game.checkpoints().map((c) => c.id);
let cpIndex = 0;
window.addEventListener('keydown', (e) => {
  const kind = { Digit1: 'anvil', Digit2: 'updraft', Digit3: 'seeker' }[e.code];
  if (kind) ctx.player.setTonic(kind);
  if (e.code === 'KeyN' || e.code === 'KeyB') {
    const ids = cpIds();
    cpIndex = (cpIndex + (e.code === 'KeyN' ? 1 : ids.length - 1)) % ids.length;
    window.__game.gotoCheckpoint(ids[cpIndex]);
  }
});
