// Mix balance: renders every part of every track solo (from the bar where it first plays, `SECONDS` s)
// and reports its K-weighted active loudness (~LUFS), so the arrangement can be balanced by perceived
// loudness (lead on top, bass solid but under it, accompaniment and percussion below).
//   node tools/scenario.mjs tools/scenarios/audio-mix.mjs --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots
const SECONDS = 14;
export default async function (page) {
  await page.waitForFunction(() => window.__audio || (window.__game && window.__game.ctx.audio));
  page.setDefaultTimeout(600000);
  return page.evaluate(async (S) => {
    const a = window.__audio || window.__game.ctx.audio;
    const out = {};
    for (const t of a.tracks) {
      const row = {};
      const full = await a.renderOffline({ track: t, clip: false, seconds: S, kWeight: true });
      row._mix = `${full.activeRmsDb} (peak ${full.peakDb})`;
      for (const part of a.trackInfo(t).parts) {
        const r = await a.renderOffline({ track: t, clip: false, solo: part, seconds: S, startBar: a.trackInfo(t).firstBar[part] || 0, kWeight: true });
        row[part] = r.notes ? r.activeRmsDb : 'silent in window';
      }
      out[t] = row;
    }
    return out;
  }, SECONDS);
}
