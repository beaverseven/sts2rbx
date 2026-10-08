// UI odds and ends: reduced motion, HUD frame cost, the contract surface (ctx.hud / ctx.menus),
// event wiring (hearts / counters / boss bar / results data) and storage-less settings.
//   node tools/scenario.mjs tools/scenarios/ui-misc.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots
export default async function (page, h) {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); if (!ok) h.log('FAIL', name, JSON.stringify(info)); };
  const ui = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__ui, a), [fn.toString(), arg]);
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const base = page.url().split('?')[0];

  // ---------------------------------------------------------------- contract surface + wiring
  await page.goto(`${base}?state=playing&dev=0`);
  await page.waitForFunction(() => window.__game && window.__ui && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await h.game((g) => { g.setQuality('low'); g.step(2); });
  let r = await ui((u) => ({
    hud: typeof u.ctx.hud.toast === 'function' && typeof u.ctx.hud.showBossBar === 'function' && !u.ctx.hud.isStub,
    menus: typeof u.ctx.menus.show === 'function' && typeof u.ctx.menus.hide === 'function' && !u.ctx.menus.isStub,
    root: !!document.querySelector('#ui > .hud'),
  }));
  check('installUI sets ctx.hud / ctx.menus and builds under #ui', r.hud && r.menus && r.root, r);

  await ui((u) => { u.ctx.hud.toast('Contract toast', 2); u.ctx.hud.showBossBar(true); });
  await frames();
  r = await page.evaluate(() => ({ toast: [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Contract toast')), boss: !document.querySelector('.hud-boss').classList.contains('is-hidden') }));
  check('hud.toast() and hud.showBossBar(true)', r.toast && r.boss, r);
  await ui((u) => u.ctx.hud.showBossBar(false));

  await h.game((g) => { g.ctx.player.damage(1); g.step(1); });
  await frames();
  r = await page.evaluate(() => ({ empty: document.querySelectorAll('.heart.is-empty').length, label: document.querySelector('.hearts').getAttribute('aria-label') }));
  check('player:hurt empties a heart', r.empty === 1 && r.label === 'Health 4 of 5', r);
  await h.game((g) => { g.ctx.player.heal(1); g.step(1); });
  await frames();
  r = await page.evaluate(() => document.querySelectorAll('.heart.is-empty').length);
  check('heal refills it', r === 0, r);

  await ui((u) => { u.fake.glowcap(); u.fake.glowcap(); u.fake.glowworm(); });
  await h.game((g) => g.step(1));
  await frames();
  r = await page.evaluate(() => [...document.querySelectorAll('.cnt')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  check('glowcap + glowworm counters', r[0] === '2/ 48' || r[0] === '2 / 48' || /^2\s*\/\s*48$/.test(r[0]), r);
  check('glowworm counter', /^1\s*\/\s*8$/.test(r[1]), r);

  await ui((u) => { u.ctx.events.emit('boss:start', { maxHp: 24, hp: 24, phase: 1 }); u.ctx.events.emit('boss:hurt', { hp: 18, maxHp: 24 }); u.ctx.events.emit('boss:phase', { phase: 2 }); });
  await frames();
  r = await page.evaluate(() => ({ on: !document.querySelector('.hud-boss').classList.contains('is-hidden'), fill: document.querySelector('.boss-fill').style.transform, pips: [...document.querySelectorAll('.boss-pips i')].map((i) => i.className), label: document.querySelector('.hud-boss').getAttribute('aria-label') }));
  check('boss:start / boss:hurt / boss:phase drive the bar', r.on && /scaleX\(0\.75(00)?\)/.test(r.fill) && r.pips[0] === 'is-done' && r.pips[1] === 'is-on', r);
  await ui((u) => u.ctx.events.emit('boss:defeated', { position: null }));
  await frames();
  r = await page.evaluate(() => document.querySelector('.hud-boss').classList.contains('is-hidden'));
  check('boss:defeated hides the bar', r, r);

  await ui((u) => { u.ctx.events.emit('tonic:start', { kind: 'updraft', duration: 20 }); });
  await frames();
  r = await page.evaluate(() => ({ kind: document.querySelector('.tonic').dataset.kind, hidden: document.querySelector('.tonic').classList.contains('is-hidden') }));
  check('tonic:start without a core tonic still shows the ring (event fallback)', r.kind === 'updraft' && !r.hidden, r);
  await ui((u) => u.ctx.events.emit('tonic:end', { kind: 'updraft' }));
  await frames();

  // results from level:complete stats, set by integration
  await ui((u) => { u.ctx.events.emit('level:complete', { stats: { total: 1234, rank: 'Silver', elapsed: 75, glowcaps: 3, glowcapsTotal: 9, cagesFreed: 1, cagesTotal: 2, bestChain: 4, kills: 2, deaths: 0 } }); u.ctx.setState('results'); });
  await page.waitForFunction(() => window.__ui.menus.current === 'results', null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.res-score .big').textContent === '1,234', null, { timeout: 20000 }).catch(() => {});
  r = await page.evaluate(() => ({ big: document.querySelector('.res-score .big').textContent, rank: document.querySelector('.res-badge').dataset.rank, stats: [...document.querySelectorAll('.stat .v')].map((v) => v.textContent) }));
  check('results use level:complete stats', r.big === '1,234' && r.rank === 'Silver' && r.stats.join('|') === '1:15|3 / 9|1 / 2|4|2|0', r);
  await ui((u) => u.ctx.events.emit('menu:quitTitle'));
  await page.waitForFunction(() => window.__ui.menus.current === 'title', null, { timeout: 10000 }).catch(() => {});
  r = await ui((u) => ({ state: u.ctx.state, menu: u.menus.current, hud: u.hud.visible }));
  check('quit to title: title menu, HUD hidden', r.state === 'title' && r.menu === 'title' && !r.hud, r);

  // ---------------------------------------------------------------- HUD frame cost
  await ui((u) => { u.ctx.events.emit('menu:start'); });
  await h.game((g) => { g.teleport(2, 1, 13, 0); g.setInput({ lock: true }); g.step(20); });
  await ui((u) => { u.fake.combo(12, 200, 'enemy'); u.fake.tonic('seeker', 20); u.fake.bossStart(); u.fake.charge(0.6); });
  r = await ui((u) => {
    const hud = u.hud;
    for (let i = 0; i < 30; i++) hud.frame(1 / 60); // warm up
    const n = 600;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { if (i % 50 === 0) u.fake.combo(3, 50, 'glowcap'); hud.frame(1 / 60); }
    return { msPerFrame: (performance.now() - t0) / n, pops: document.querySelectorAll('.pop[style*="block"]').length, reticle: !document.querySelector('.reticle').classList.contains('is-hidden') };
  });
  h.log('hud.frame cost', JSON.stringify(r));
  check('HUD frame (12 popups, reticle, charge, combo, tonic, boss) < 0.5 ms', r.msPerFrame < 0.5 && r.reticle, r);
  await h.game((g) => { g.setInput(null); g.step(1); });

  // ---------------------------------------------------------------- reduced motion
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}?dev=0`);
  await page.waitForFunction(() => window.__game && window.__ui && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await h.game((g) => { g.setQuality('low'); g.step(1); });
  r = await page.evaluate(() => ({ spores: getComputedStyle(document.querySelector('.logo .spores i')).animationName, letters: getComputedStyle(document.querySelector('.logo-b .lt')).animationName }));
  check('reduced motion: decorative title loops are off', r.spores === 'none' && r.letters === 'none', r);
  await ui((u) => u.ctx.events.emit('menu:start'));
  await h.game((g) => g.step(5));
  await ui((u) => u.fake.zone('fort'));
  await frames();
  r = await page.evaluate(() => ({ card: getComputedStyle(document.querySelector('.zonecard')).animationName, letter: getComputedStyle(document.querySelector('.zc-name span')).animationName }));
  check('reduced motion: zone card fades instead of bouncing letters', r.card === 'zc-fade' && r.letter === 'fade-in', r);
  await page.evaluate(() => { for (const a of document.getAnimations()) { const t = a.effect.getComputedTiming(); if (t.iterations !== Infinity) { try { a.currentTime = Math.min(1200, t.endTime - 1); a.pause(); } catch { /* ignore */ } } } });
  await h.wait(200);
  await h.shot('reduced-zone');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---------------------------------------------------------------- no storage
  await page.goto(`${base}?dev=0`);
  await page.waitForFunction(() => window.__ui, null, { timeout: 30000 });
  r = await page.evaluate(() => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    let ok = true;
    try {
      window.__ui.menus.push('settings');
      window.__ui.menus.screens.settings.items[0].adjust(-1);
    } catch (e) { ok = String(e); }
    const v = window.__ui.ctx.settings.master;
    if (orig) Object.defineProperty(window, 'localStorage', orig);
    return { ok, master: v };
  });
  check('settings work when localStorage throws', r.ok === true && Math.abs(r.master - 0.75) < 1e-6, r);

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, errors: h.errors.length };
}
