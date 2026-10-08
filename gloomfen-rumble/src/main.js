// Gloomfen Rumble — game entry (integration).
//
// Boots core with every area installed, builds Gloomfen and hands control to the game
// flow (src/game/flow.js: title -> playing <-> paused / dead -> results -> play again).
//
// Artifact viewer hot reload: when the page runs inside the claude.ai artifact viewer,
// window.claude.hot keeps a small snapshot (checkpoint, score, settings) across a
// republish, so a viewer who has the game open resumes at their last checkpoint.
// Outside the viewer window.claude is undefined and both hooks are no-ops.
import { boot } from './core/boot.js';
import { installScore } from './game/score.js';
import { installAudio } from './audio/audio.js';
import { installUI } from './ui/index.js';
import { installEnemies } from './game/enemies/index.js';
import { installPickups } from './game/pickups.js';
import { buildLevel, installMechanisms } from './game/level/builder.js';
import { installFlow } from './game/flow.js';

let started = false;

function start(data) {
  if (started) return;
  started = true;
  let ctx;
  try {
    ctx = boot({
      startState: 'title',
      buildLevel,
      // score before audio (the glowcap chime reads score:award), audio before UI (stored volumes
      // reach the real engine), entity types before buildLevel spawns them, the flow last.
      install: [installScore, installAudio, installUI, installEnemies, installPickups, installMechanisms, installFlow],
    });
  } catch (err) {
    console.error(err);
    showFatal(err);
    return;
  }
  ctx.flow.levelReady();
  ctx.flow.restore(data);
  window.claude?.hot?.snapshot?.(() => ctx.flow.snapshot());
}

/** The game needs WebGL; say so plainly instead of leaving a blank page. */
function showFatal(err) {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;'
    + 'background:#1b1f4a;color:#f3e6c8;font:600 17px/1.5 system-ui,sans-serif;z-index:99';
  box.textContent = 'Gloomfen Rumble could not start: this browser or device did not give it a WebGL canvas. '
    + 'Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration turned on.';
  void err;
  document.body.append(box);
}

if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
