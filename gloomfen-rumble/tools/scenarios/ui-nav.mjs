// UI navigation with real key presses (ctx.input path) and mouse clicks:
// title -> settings (sliders/toggles, persistence) -> title -> start -> pause -> pause/settings
// -> Esc back to pause -> resume -> results (skip count-up, play again) -> reload keeps settings.
//   node tools/scenario.mjs tools/scenarios/ui-nav.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots
export default async function (page, h) {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); if (!ok) h.log('FAIL', name, JSON.stringify(info)); };
  const ui = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__ui, a), [fn.toString(), arg]);
  const snap = () => ui((u) => ({ state: u.ctx.state, menu: u.menus.current, stack: u.menus.stack, focus: u.menus.focusLabel, music: u.ctx.settings.music, invertY: u.ctx.settings.invertY }));
  // tap a key, then wait until the UI reflects it (menus read input once per rendered frame)
  async function key(code, until, timeout = 15000) {
    await page.keyboard.press(code);
    if (until) {
      try { await page.waitForFunction(until, null, { timeout, polling: 100 }); } catch { /* reported by the caller's check */ }
    } else await h.wait(900);
    // let one more frame poll the released key, so the next tap is a fresh press for ctx.input
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return snap();
  }
  const focusIs = (label) => new Function(`return window.__ui.menus.focusLabel === ${JSON.stringify(label)}`);

  await page.waitForFunction(() => window.__game && window.__ui && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await ui((u) => { u.devPanel(false); u.ctx.gfx.setQuality('low'); });
  await h.wait(800);

  let s = await snap();
  check('title shown with Start focused', s.state === 'title' && s.menu === 'title' && s.focus === 'Start', s);
  s = await key('ArrowDown', focusIs('Controls'));
  check('ArrowDown -> Controls', s.focus === 'Controls', s);
  s = await key('KeyS', focusIs('Settings'));
  check('S -> Settings', s.focus === 'Settings', s);
  s = await key('ArrowDown', focusIs('Start'));
  check('ArrowDown wraps -> Start', s.focus === 'Start', s);
  s = await key('ArrowUp', focusIs('Settings'));
  check('ArrowUp wraps -> Settings', s.focus === 'Settings', s);
  s = await key('Enter', () => window.__ui.menus.current === 'settings');
  check('Enter opens settings, first row focused', s.menu === 'settings' && s.focus === 'Master volume', s);
  s = await key('ArrowDown', focusIs('Music'));
  s = await key('ArrowLeft', () => window.__ui.ctx.settings.music < 0.6);
  s = await key('ArrowLeft', () => window.__ui.ctx.settings.music < 0.55);
  check('ArrowLeft x2 lowers music 0.6 -> 0.5', Math.abs(s.music - 0.5) < 1e-6, s);
  s = await key('ArrowDown', focusIs('Effects'));
  s = await key('ArrowDown', focusIs('Camera speed'));
  s = await key('ArrowDown', focusIs('Invert camera Y'));
  s = await key('Enter', () => window.__ui.ctx.settings.invertY === true);
  check('Enter toggles invert Y', s.invertY === true && s.focus === 'Invert camera Y', s);
  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gloomfen-rumble.settings.v1')); } catch { return null; } });
  check('settings persisted to localStorage', stored && stored.music === 0.5 && stored.invertY === true && !('quality' in stored), stored);
  await h.shot('nav-settings');
  s = await key('Escape', () => window.__ui.menus.current === 'title');
  check('Esc on settings -> back to title, Settings focused', s.menu === 'title' && s.focus === 'Settings' && s.state === 'title', s);
  s = await key('ArrowUp', focusIs('Controls'));
  s = await key('ArrowUp', focusIs('Start'));
  s = await key('Space', () => window.__ui.ctx.state === 'playing');
  check('Space on Start -> playing, menus hidden', s.state === 'playing' && s.menu === null, s);
  await h.wait(600);

  // --- pause
  s = await key('Escape', () => window.__ui.ctx.state === 'paused' && window.__ui.menus.current === 'pause');
  check('Esc in play -> pause menu, Resume focused', s.state === 'paused' && s.menu === 'pause' && s.focus === 'Resume', s);
  s = await key('ArrowDown', focusIs('Restart from checkpoint'));
  s = await key('ArrowDown', focusIs('Settings'));
  s = await key('Enter', () => window.__ui.menus.current === 'settings');
  check('pause -> Settings', s.menu === 'settings' && s.stack.join('>') === 'pause>settings', s);
  s = await key('Escape', () => window.__ui.menus.current === 'pause');
  check('Esc in pause/settings -> back to pause (game stays paused)', s.state === 'paused' && s.menu === 'pause' && s.focus === 'Settings', s);
  s = await key('Backspace', () => window.__ui.ctx.state === 'playing');
  check('Back (Backspace) on pause -> resume', s.state === 'playing' && s.menu === null, s);
  await h.wait(600);
  s = await key('KeyP', () => window.__ui.ctx.state === 'paused');
  s = await key('ArrowDown', focusIs('Restart from checkpoint'));
  await ui((u) => { u.ctx.player.hp = 2; });
  s = await key('Enter', () => window.__ui.ctx.state === 'playing');
  const hpAfter = await ui((u) => u.ctx.player.hp);
  check('Restart from checkpoint -> playing with full hearts', s.state === 'playing' && hpAfter === 5, { s, hpAfter });
  await h.wait(600);
  s = await key('Escape', () => window.__ui.ctx.state === 'paused');
  s = await key('Escape', () => window.__ui.ctx.state === 'playing');
  check('Esc toggles pause off again', s.state === 'playing', s);

  // --- results: skip the count-up, play again
  await h.wait(600);
  s = await key('KeyR', () => window.__ui.menus.current === 'results');
  check('results shown', s.state === 'results' && s.menu === 'results' && s.focus === 'Play again', s);
  s = await key('Enter', () => document.querySelector('.res-badge').classList.contains('is-in'));
  const big = await page.evaluate(() => document.querySelector('.res-score .big').textContent);
  check('first Enter skips the count-up', big === '48,250' && s.menu === 'results', { big, s });
  s = await key('ArrowRight', focusIs('Title'));
  check('ArrowRight in results footer -> Title', s.focus === 'Title', s);
  s = await key('ArrowLeft', focusIs('Play again'));
  s = await key('Enter', () => window.__ui.ctx.state === 'playing');
  check('Play again -> playing', s.state === 'playing' && s.menu === null, s);

  // --- reload: settings come back; mouse navigation
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__ui && document.fonts.status === 'loaded', null, { timeout: 30000 });
  await ui((u) => { u.devPanel(false); u.ctx.gfx.setQuality('low'); });
  s = await snap();
  check('reload restores music 0.5 + invert Y', Math.abs(s.music - 0.5) < 1e-6 && s.invertY === true, s);
  await h.wait(800);
  await page.click('.menu-title .btn:nth-of-type(2)');
  await page.waitForFunction(() => window.__ui.menus.current === 'controls', null, { timeout: 15000 }).catch(() => {});
  s = await snap();
  check('mouse click Controls -> controls', s.menu === 'controls', s);
  await page.click('.menu-controls .btn');
  await page.waitForFunction(() => window.__ui.menus.current === 'title', null, { timeout: 15000 }).catch(() => {});
  s = await snap();
  check('mouse click Back -> title, Controls focused', s.menu === 'title' && s.focus === 'Controls', s);

  // gamepad-style analog stick (move vector via the input override): hold down -> step + repeat
  await h.wait(400);
  await page.keyboard.press('ArrowUp'); // focus Start (wraps from Controls? no: Controls -> Start)
  await page.waitForFunction(() => window.__ui.menus.focusLabel === 'Start', null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const steps = [];
  await h.game((g) => g.setInput({ move: [0, -1] }));
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) { steps.push(await page.evaluate(() => window.__ui.menus.focusLabel)); await h.wait(120); }
  await h.game((g) => g.setInput(null));
  const distinct = steps.filter((x, i) => i === 0 || x !== steps[i - 1]);
  check('held stick down steps, then repeats', distinct.length >= 3 && distinct[1] === 'Controls', { distinct, steps });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, errors: h.errors.length };
}
