// Results screen layout in the shipped build: a finished run (level:complete with Gold-level stats)
// -> results after 1.2 s -> count-up -> rank badge + rank meter. Run at several viewports:
//   node tools/scenario.mjs tools/scenarios/integ-results.mjs --html dist/index.html --shots dist/integ/shots [--w 400 --h 860]
import { installIntegHelpers, waitForGame, settledShot } from './integ-helpers.mjs';

export default async function (page, h) {
  await waitForGame(page, 'title');
  await installIntegHelpers(page);
  await page.keyboard.press('Enter');
  await waitForGame(page, 'playing', 20000);
  const vp = page.viewportSize();
  const r = await h.game((g) => {
    const ctx = g.ctx, max = ctx.score.maxPossible();
    g.step(2);
    const stats = {
      total: 46200, points: 46200, bestChain: 41, glowcaps: 151, glowcapsTotal: 159, cagesFreed: 8, cagesTotal: 8,
      kills: 37, deaths: 2, elapsed: 1012.4, bossDefeated: true, maxPossible: max,
    };
    const info = ctx.score.rankInfo(stats.total, max);
    stats.rank = info.rank; stats.rankRatio = info.ratio;
    ctx.events.emit('level:complete', { stats });
    window.__et.until(() => ctx.state === 'results', 120);
    return { state: ctx.state, rank: info.rank, ratio: +info.ratio.toFixed(3), next: info.next, nextAt: info.nextAt };
  });
  await page.waitForFunction(() => document.querySelector('.menu-results.is-on .res-badge.is-in'), null, { timeout: 60000 });
  const dom = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (s) => { const n = q(s); if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return { big: q('.menu-results .res-score .big').textContent, rank: q('.menu-results .rk-name').textContent, note: q('.menu-results .res-meter-text').textContent, fill: q('.menu-results .rm-fill').style.width, bar: rect('.menu-results .rm-bar'), badge: rect('.menu-results .res-badge'), panel: rect('.menu-results .panel-results'), overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  await settledShot(page, h, `09-results-${vp.width}x${vp.height}`, 400);
  return { r, dom };
}
