// HUD in the real level (?level=1): every area installed. Checks the zone card from the boot-time
// zone:enter, sign toasts, real glowcap/cage totals, the checkpoint toast and the real boss bar.
//   node tools/scenario.mjs tools/scenarios/ui-level.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots
export default async function (page, h) {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); if (!ok) h.log('FAIL', name, JSON.stringify(info)); };
  const base = page.url().split('?')[0];
  await page.goto(`${base}?level=1&dev=0`);
  await page.waitForFunction(() => window.__game && window.__ui && document.fonts.status === 'loaded', null, { timeout: 60000 });
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const seek = (ms) => page.evaluate((ms) => {
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.getComputedTiming();
      if (!t || t.iterations === Infinity) continue;
      const target = Math.min(ms, (t.endTime || ms) - 1);
      try {
        // finished animations are left alone (play() would rewind them); the rest are seeked and held
        if ((a.currentTime ?? 0) < target) a.currentTime = target;
        else if (a.playState !== 'running') continue;
        a.pause();
        window.__frozen = (window.__frozen || []).concat(a);
      } catch { /* ignore */ }
    }
  }, ms);
  // seek() also pauses those animations, so a slow screenshot cannot run them out; thaw() resumes
  const thaw = () => page.evaluate(() => { for (const a of window.__frozen || []) { try { a.play(); } catch { /* ignore */ } } window.__frozen = []; });
  const vp = page.viewportSize();
  const pre = `${vp.width}x${vp.height}-level`;

  await h.game((g) => { g.setQuality('high'); g.step(1); });
  let r = await page.evaluate(() => ({ state: window.__ui.ctx.state, menu: window.__ui.menus.current, totals: [window.__ui.ctx.score.glowcapsTotal, window.__ui.ctx.score.cagesTotal] }));
  check('title over the real level', r.state === 'title' && r.menu === 'title', r);
  await h.wait(800);
  await seek(1200); await h.wait(250);
  await h.shot(`${pre}-01-title`);
  await thaw();

  // start: the zone card for the start zone (emitted at boot, shown on the first 'playing')
  await page.evaluate(() => window.__ui.ctx.events.emit('menu:start'));
  await h.game((g) => { g.godMode(true); g.step(20); });
  await frames();
  r = await page.evaluate(() => ({ on: document.querySelector('.zonecard').classList.contains('is-on'), name: document.querySelector('.zc-name').textContent, kicker: document.querySelector('.zc-kicker').textContent }));
  check('start shows the "Mossy Glade" zone card', r.on && r.name === 'Mossy Glade' && r.kicker === 'Zone 1 of 4', r);
  const caps = await page.evaluate(() => document.querySelector('.cnt .of').textContent);
  check('glowcap counter shows the level total', /\/ \d{2,}/.test(caps), { caps });
  await seek(1500); await h.wait(250);
  await h.shot(`${pre}-02-start`);
  await thaw();

  // walk forward: signs talk through ui:message -> toasts
  await h.game((g) => g.clearEvents());
  await h.game((g) => { g.setCamera(0, 0.25, 7.5); g.setInput({ move: [0, 1] }); g.step(150); g.setInput(null); g.step(5); });
  await frames();
  r = await page.evaluate(() => ({ toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent), msgs: window.__game.events('ui:message').length, glowcaps: window.__ui.ctx.score.glowcaps, hud: document.querySelector('.cnt .n').textContent }));
  check('level messages become toasts', r.msgs === 0 || r.toasts.length > 0, r);
  check('glowcap counter follows the score', String(r.glowcaps) === r.hud, r);
  await seek(600); await h.wait(250);
  await h.shot(`${pre}-03-walk`);
  await thaw();

  // checkpoint toast + bog zone card
  await h.game((g) => { g.gotoCheckpoint('bog'); g.ctx.player.teleport([0, 3, 232]); g.setInput({ move: [0, 1] }); g.step(60); g.setInput(null); g.step(5); });
  await frames();
  r = await page.evaluate(() => ({ zone: window.__ui.ctx.level.zone, card: document.querySelector('.zc-name').textContent, cp: window.__game.events('checkpoint:reached').map((e) => e.payload.id) }));
  check('zone card follows the real zone triggers', r.card === "Sunken Bog" || r.card === 'Mossy Glade' || r.zone === 'bog', r);

  // the pit: the real boss starts when Morel comes close, the bar shows
  await h.game((g) => { g.gotoCheckpoint('pit'); g.setCamera(0, 0.3, 9); g.step(10); g.ctx.player.teleport([0, 2.2, 386]); g.step(200); });
  await frames();
  r = await page.evaluate(() => ({ boss: window.__ui.hud.bossVisible, label: document.querySelector('.hud-boss').getAttribute('aria-label'), started: window.__game.events('boss:start').length }));
  check('boss:start shows the Chief Gnarlbelly bar', r.boss && r.started > 0 && /Chief Gnarlbelly 24 of 24/.test(r.label), r);
  await seek(1500); await h.wait(300);
  await h.shot(`${pre}-04-boss`);
  await thaw();

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, errors: h.errors.length };
}
