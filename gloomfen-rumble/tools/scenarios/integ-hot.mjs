// Artifact-viewer hot reload (window.claude.hot) against the shipped build (dist/index.html):
//   1. no window.claude: boots to the title (the hooks are no-ops)
//   2. a viewer stub with hot.ready(): start() is handed to it, a snapshot fn is registered; play to the
//      fort, earn points, change a setting, take the snapshot
//   3. reload with hot.data = that snapshot (no ready): resumes paused at the fort lantern with the score
//      and settings; Resume continues there (zone + music follow)
//   node tools/scenario.mjs tools/scenarios/integ-hot.mjs --html dist/index.html --shots dist/integ/shots
import { installIntegHelpers, watchConsole, waitForGame, settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  const consoleLog = watchConsole(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };

  // 1. plain page (the runner already loaded it without window.claude)
  await waitForGame(page, 'title');
  const r1 = await h.game((g) => ({ state: g.ctx.state, claude: typeof window.claude }));
  check('without window.claude: boots normally to the title', r1.state === 'title' && r1.claude === 'undefined', r1);

  // 2. viewer stub with ready()
  await page.addInitScript(() => {
    if (window.__hotStage === 'data') return;
    window.__hotLog = [];
    window.claude = { hot: {
      ready(fn) { window.__hotLog.push('ready'); setTimeout(() => fn(undefined), 0); },
      snapshot(fn) { window.__hotLog.push('snapshot'); window.__hotSnapFn = fn; },
    } };
  });
  await page.reload();
  await waitForGame(page, 'title');
  await installIntegHelpers(page);
  const r2 = await h.game((g) => ({ log: window.__hotLog.slice(), state: g.ctx.state, snap: window.__hotSnapFn ? window.__hotSnapFn() : null }));
  check('hot.ready(start) path: start runs, snapshot fn registered, title snapshot has no checkpoint', r2.log.join() === 'ready,snapshot' && r2.state === 'title' && r2.snap && r2.snap.checkpointId === null && r2.snap.state === 'title', r2);
  await page.keyboard.press('Enter');
  await waitForGame(page, 'playing', 20000);
  const snap = await h.game((g) => {
    g.step(2);
    g.godMode(true);
    g.gotoCheckpoint('fort'); g.step(20);
    g.ctx.score.award(200, 'enemy', null, { type: 'grunt' });
    g.ctx.score.kills = 1; g.ctx.score.killsByType = { grunt: 1 };
    g.ctx.audio.setVolumes({ music: 0.35 });
    g.ctx.settings.sensitivity = 1.4;
    return JSON.parse(JSON.stringify(window.__hotSnapFn()));
  });
  check('snapshot while playing: checkpoint fort, score, settings (JSON-safe)', snap.checkpointId === 'fort' && snap.score.total >= 200 && snap.score.kills === 1 && snap.settings.music === 0.35 && snap.settings.sensitivity === 1.4, snap);

  // 3. reload with the snapshot as hot.data (the viewer's other entry path)
  await page.addInitScript((data) => {
    window.__hotStage = 'data';
    window.__hotLog = [];
    window.claude = { hot: { data, snapshot(fn) { window.__hotLog.push('snapshot'); window.__hotSnapFn = fn; } } };
  }, snap);
  await page.reload();
  await waitForGame(page, 'paused', 60000);
  await installIntegHelpers(page);
  const r3 = await h.game((g) => ({
    snap: window.__it.snap(), menu: g.ctx.menus.current, score: g.ctx.score.snapshot(), music: g.ctx.settings.music, sens: g.ctx.settings.sensitivity,
    log: window.__hotLog.slice(), lit: g.ctx.entities.query('checkpoint').filter((e) => e.lit).map((e) => e.checkpointId),
  }));
  check('hot.data path: resumes paused at the fort lantern (pause menu), score + kills + settings restored', r3.snap.state === 'paused' && r3.menu === 'pause' && r3.snap.checkpoint === 'fort' && Math.abs(r3.snap.pos[2] - 352) < 1 && r3.score.total === snap.score.total && r3.score.glowcaps === snap.score.glowcaps && r3.score.kills === 1 && r3.music === 0.35 && r3.sens === 1.4 && r3.lit.includes('fort') && r3.snap.zone === 'fort', r3);
  await h.game((g) => g.setQuality('high'));
  await settledShot(page, h, '30-hot-resumed', 900);
  await page.click('.menu-pause.is-on button:has-text("Resume")');
  await waitForGame(page, 'playing', 15000);
  const r4 = await h.game((g) => { g.step(3); return { snap: window.__it.snap(), zones: g.events('zone:enter').map((e) => e.payload.id) }; });
  check('Resume continues at the fort: zone:enter fort, fort music', r4.snap.state === 'playing' && r4.zones.includes('fort') && r4.snap.track === 'fort', r4);

  const errors = consoleLog.filter((l) => !/GPU stall due to ReadPixels/.test(l));
  check('zero console errors or warnings', errors.length === 0 && h.errors.length === 0, errors.slice(0, 10));
  return { passed: checks.filter((c) => c.ok).length, total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name) };
}
