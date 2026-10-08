// UI area entry: installUI(ctx) builds the HUD, menus and touch controls under #ui,
// sets ctx.hud / ctx.menus (+ ctx.ui), follows game:state and drives everything from
// one ctx.addSystem({ frame }) hook. wireMenuIntents(ctx) is an optional default
// wiring of the menu intents to core's state machine (the integrator may use or
// replace it; see docs/ui.md).
import { el } from './dom.js';
import { createHud } from './hud.js';
import { createMenus, MENU_INTENTS } from './menus.js';
import { createTouch } from './touch.js';
import { applyStoredSettings } from './settings.js';

export { MENU_INTENTS };

export function installUI(ctx) {
  let root = document.getElementById('ui');
  if (!root) { root = el('div', null, { id: 'ui' }); document.body.append(root); }
  root.replaceChildren();

  applyStoredSettings(ctx);

  const hud = createHud(ctx, root);
  const touch = createTouch(ctx, root);
  const menus = createMenus(ctx, root, hud);

  // contract surface: ctx.hud.toast / showBossBar, ctx.menus.show / hide
  ctx.hud = hud;
  ctx.menus = menus;
  ctx.ui = { root, hud, menus, touch };

  let lastStats = null;
  ctx.events.on('level:complete', (p) => { lastStats = (p && p.stats) || p || null; });

  // one-time hint for mouse players: the first click on the scene captures the mouse
  let mouseHintShown = false;
  function mouseHint() {
    const inp = ctx.input;
    if (mouseHintShown || !inp || touch.enabled || inp.lastDevice !== 'keyboard' || inp.mouseMode !== 'lock' || inp.pointerLocked) return;
    mouseHintShown = true;
    setTimeout(() => { if (ctx.state === 'playing' && !inp.pointerLocked && !touch.enabled) hud.toast('Click the scene to steer the camera with your mouse.', 3.5, { kind: 'hint' }); }, 900);
  }

  function onState(state, prev) {
    switch (state) {
      case 'title':
        hud.setVisible(false);
        menus.show('title');
        break;
      case 'playing':
        if (menus.current) menus.hide();
        hud.setVisible(true);
        mouseHint();
        break;
      case 'paused':
        hud.setVisible(true);
        menus.show('pause');
        break;
      case 'dead':
        if (menus.current) menus.hide();
        hud.setVisible(true);
        break;
      case 'results':
        hud.setVisible(false);
        // integration may call menus.show('results', stats) right after setState: let that win
        queueMicrotask(() => { if (ctx.state === 'results' && menus.current !== 'results') menus.show('results', lastStats); });
        break;
      default:
        break;
    }
    void prev;
  }
  ctx.events.on('game:state', ({ state, prev }) => onState(state, prev));
  if (ctx.state && ctx.state !== 'boot') onState(ctx.state, null);

  let quality = null;
  ctx.addSystem({
    order: 1000, // after gameplay systems, so the HUD shows this frame's values
    frame(dt) {
      const q = (ctx.gfx && ctx.gfx.quality) || ctx.settings.quality;
      if (q !== quality) { quality = q; root.classList.toggle('q-low', q === 'low'); }
      hud.frame(dt);
      menus.frame(dt);
      touch.frame(dt);
    },
  });
  return ctx.ui;
}

/**
 * Optional default wiring of the menu intents (usable as an installer:
 * boot({ install: [..., installUI, wireMenuIntents] })). The integrator can replace it.
 *   menu:start              -> new run if one was already played, then 'playing'
 *   menu:resume             -> 'playing'
 *   menu:restartCheckpoint  -> full hearts, respawn at the checkpoint (emits player:respawn), 'playing'
 *   menu:quitTitle          -> 'title'
 *   menu:playAgain          -> level.reset(), score.reset(), back to the level spawn, 'playing'
 *   level:complete          -> 'results' after 1.2 s
 */
export function wireMenuIntents(ctx) {
  const ev = ctx.events;
  let runStarted = false;

  function newRun() {
    const lvl = ctx.level || {};
    try { if (typeof lvl.reset === 'function') lvl.reset(); } catch (e) { console.error(e); }
    try { if (ctx.score && typeof ctx.score.reset === 'function') ctx.score.reset(); } catch (e) { console.error(e); }
    ctx.flags.levelComplete = false;
    const p = ctx.player;
    if (!p) return;
    const sp = (lvl.spawn && lvl.spawn.position) || [0, 2, 0];
    const yaw = (lvl.spawn && lvl.spawn.yaw) || 0;
    const cp = lvl.checkpoints && lvl.checkpoints[0];
    p.setCheckpoint(cp ? cp.id : 'start', cp ? cp.position : sp, cp ? cp.yaw ?? 0 : yaw);
    if (p.tonic) p.setTonic(null);
    p.heal(p.maxHp);
    p.respawnAt(sp, yaw);
    if (ctx.cameraRig && ctx.cameraRig.snapBehind) ctx.cameraRig.snapBehind();
    // like a checkpoint respawn: boss fight / arena locks reset themselves on it
    ev.emit('player:respawn', { position: p.position.clone(), checkpointId: p.checkpoint.id });
  }

  ev.on(MENU_INTENTS.start, () => {
    if (runStarted) newRun();
    runStarted = true;
    ctx.setState('playing');
  });
  ev.on(MENU_INTENTS.resume, () => { if (ctx.state === 'paused') ctx.setState('playing'); });
  ev.on(MENU_INTENTS.restartCheckpoint, () => {
    const p = ctx.player;
    if (p) {
      const cp = p.checkpoint;
      p.heal(p.maxHp);
      p.respawnAt(cp.position, cp.yaw);
      ev.emit('player:respawn', { position: p.position.clone(), checkpointId: cp.id });
    }
    ctx.setState('playing');
  });
  ev.on(MENU_INTENTS.quitTitle, () => ctx.setState('title'));
  ev.on(MENU_INTENTS.playAgain, () => {
    newRun();
    runStarted = true;
    ctx.setState('playing');
  });
  ev.on('level:complete', () => {
    setTimeout(() => { if (ctx.state === 'playing' || ctx.state === 'dead') ctx.setState('results'); }, 1200);
  });
}
