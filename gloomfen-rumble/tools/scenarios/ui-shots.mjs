// UI visual pass: every menu and HUD state, screenshotted. Run it at desktop and phone sizes:
//   node tools/scenario.mjs tools/scenarios/ui-shots.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots
//   node tools/scenario.mjs tools/scenarios/ui-shots.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots --w 400 --h 860
//   (add --w 844 --h 390 for a landscape phone)
// Shot names are prefixed with the viewport (e.g. 960x540-01-title.png).
export default async function (page, h) {
  const vp = page.viewportSize();
  const pre = `${vp.width}x${vp.height}`;
  const phone = vp.width < 720 || vp.height < 480;
  const ui = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__ui, a), [fn.toString(), arg]);
  const shot = (name) => h.shot(`${pre}-${name}`);
  // Headless SwiftShader renders ~2 fps, so CSS/Web animations start late. seek(ms) moves every
  // finite animation forward to ms after its start, which makes the shots deterministic.
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
  // wait for two rendered frames (the HUD reacts to state in its frame hook), then seek
  const settle = async (ms) => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await seek(ms);
  };
  const out = {};

  await page.waitForFunction(() => window.__game && window.__ui && document.fonts && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await ui((u) => { u.devPanel(false); u.ctx.gfx.setQuality('high'); });
  await h.game((g) => g.step(1)); // manual stepping: the simulation only moves when we say so
  await h.wait(1500);
  await settle(1200);
  await h.wait(250);
  await shot('01-title');
  await thaw();

  // --- title sub pages
  await ui((u) => u.menus.push('controls'));
  await h.wait(700);
  await settle(1200);
  await h.wait(250);
  await shot('02-controls');
  await thaw();
  await ui((u) => { u.menus.pop(); u.menus.push('settings'); });
  await h.wait(700);
  await settle(1200);
  await h.wait(250);
  await shot('03-settings');
  await thaw();
  await ui((u) => u.menus.pop());

  // --- start, HUD
  await ui((u) => u.ctx.events.emit('menu:start'));
  await h.game((g) => { g.teleport(2, 1, 4, 0); g.setCamera(0.35, 0.25, 7.5); g.step(30); });
  await h.wait(500);
  await ui((u) => { u.fake.combo(7, 50, 'glowcap'); });
  await h.game((g) => g.step(2));
  await h.wait(380);
  await settle(300);
  await h.wait(250);
  await shot('04-hud-combo');
  await thaw();
  out.afterCombo = await h.game((g) => g.state());

  await ui((u) => { u.fake.combo(12, 200, 'enemy'); u.fake.tonic('seeker', 20); u.fake.glowworm(); });
  await h.game((g) => g.step(2));
  await h.wait(450);
  await settle(380);
  await h.wait(250);
  await shot('05-hud-bigcombo-tonic');
  await thaw();

  // --- boss bar + lock-on + charge (face a dummy and hold lock)
  await ui((u) => { u.fake.bossStart(); });
  await h.game((g) => { g.teleport(2, 1, 13, 0); g.setInput({ lock: true }); g.step(20); });
  await ui((u) => { u.fake.bossHit(5); u.fake.charge(0.7); });
  await h.wait(900);
  await settle(1000);
  await h.wait(250);
  await shot('06-boss-lock-charge');
  await thaw();
  out.lock = await h.game((g) => g.state().player.lock);
  await ui((u) => { u.fake.bossHit(6); u.fake.charge(1); });
  await h.wait(700);
  await settle(1000);
  await h.wait(250);
  await shot('07-boss-phase2-fullcharge');
  await thaw();
  await h.game((g) => { g.setInput(null); g.step(2); });

  // --- hurt flash + hearts
  await ui((u) => { u.fake.hurt(); });
  await h.wait(120);
  await settle(110);
  await h.wait(250);
  await shot('08-hurt-flash');
  await thaw();
  await ui((u) => { u.fake.setHp(1); });
  await h.wait(900);
  await settle(1000);
  await h.wait(250);
  await shot('09-low-hp');
  await thaw();
  await ui((u) => { u.fake.heal(4); });
  await h.wait(300);
  await settle(330);
  await h.wait(250);
  await shot('10-heal-refill');
  await thaw();

  // --- zone card
  await ui((u) => { u.fake.zone('bog'); });
  await h.wait(1100);
  await settle(1500);
  await h.wait(250);
  await shot('11-zone-card');
  await thaw();

  // --- toasts
  await h.wait(1800);
  await ui((u) => { u.fake.toast(0); u.fake.toast(1); });
  await h.wait(600);
  await settle(500);
  await h.wait(250);
  await shot('12-toasts');
  await thaw();

  // --- tonic warning + boss defeated
  await ui((u) => { u.fake.tonic('anvil', 2.5); u.fake.bossDefeat(); });
  await h.game((g) => g.step(6));
  await h.wait(400);
  await settle(700);
  await h.wait(250);
  await shot('13-tonic-warning');
  await thaw();

  // --- death splat
  await ui((u) => { u.fake.die(); });
  await h.game((g) => g.step(3));
  await h.wait(350);
  await settle(520);
  await h.wait(250);
  await shot('14-splat-card');
  await thaw();
  await h.wait(1100);
  await settle(1300);
  await h.wait(250);
  await shot('15-splat-curtain');
  await thaw();
  await h.game((g) => g.step(110));
  await h.wait(300);
  await settle(260);
  await h.wait(250);
  await shot('16-respawn-wipe');
  await thaw();
  await h.wait(900);

  // --- pause + pause settings
  await h.game((g) => { g.ctx.setState('paused'); });
  await h.wait(700);
  await settle(1000);
  await h.wait(250);
  await shot('17-pause');
  await thaw();
  await ui((u) => { u.menus.push('settings'); });
  await h.wait(600);
  await settle(1000);
  await h.wait(250);
  await shot('18-pause-settings');
  await thaw();
  await ui((u) => { u.menus.pop(); u.menus.push('controls'); });
  await h.wait(600);
  await settle(1000);
  await h.wait(250);
  await shot('19-pause-controls');
  await thaw();
  await ui((u) => { u.menus.pop(); u.ctx.events.emit('menu:resume'); });

  // --- results
  await ui((u) => { u.fake.results(); });
  await h.wait(900);
  await settle(600);
  await h.wait(250);
  await shot('20-results-counting');
  await thaw();
  await h.wait(2400);
  await settle(2000);
  await h.wait(250);
  await shot('21-results');
  await thaw();

  // --- touch controls (phone sizes)
  if (phone) {
    await ui((u) => { u.ctx.events.emit('menu:playAgain'); u.touch.enable(true); u.fake.bossStart(); u.fake.bossHit(4); });
    await h.game((g) => { g.setCamera(0.3, 0.25, 7.5); g.step(10); });
    await page.evaluate(() => {
      const zone = document.querySelector('.tzone');
      const W = innerWidth, H = innerHeight;
      const down = (id, x, y) => zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
      const move = (id, x, y) => zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
      down(31, W * 0.24, H * 0.78);
      move(31, W * 0.24 + 30, H * 0.78 - 34);
      const jump = document.querySelector('.tbtn-jump');
      jump.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 32, pointerType: 'touch', clientX: W - 60, clientY: H - 80, bubbles: true, cancelable: true }));
    });
    await h.wait(500);
    await settle(1500);
    await h.wait(250);
    await shot('22-touch');
    await thaw();
    out.touchInput = await h.game((g) => { g.step(1); const i = g.ctx.input; return { move: [i.move.x, i.move.y], jump: i.down('jump'), device: i.lastDevice }; });
  }
  out.errors = h.errors.length;
  return out;
}
