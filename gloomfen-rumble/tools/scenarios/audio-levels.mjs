// Audio levels: renders every music track (the whole loop) and every sfx offline through the real
// mixer graph and checks peak / RMS.
//   node tools/build.mjs --entry src/audio/lab.js --out dist/dev-audio/lab --dev
//   node tools/scenario.mjs tools/scenarios/audio-levels.mjs --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots
// (also works on dist/dev-audio/index.html, just slower because the 3D arena renders meanwhile)
// Checks:
//   * nothing clips: raw peak (before the final soft clipper, every volume at 1) < 0 dBFS
//   * nothing is silent: every track's active RMS > -40 dBFS, every sfx peak > -36 dBFS
//   * no NaNs, no DC offset
//   * the tracks sit within a 6 dB loudness window of each other
//   * at the default settings the music sits below the sfx (music RMS < loud sfx peaks)
export default async function (page) {
  await page.waitForFunction(() => window.__audio || (window.__game && window.__game.ctx.audio && window.__game.ctx.audio.renderOffline));
  page.setDefaultTimeout(600000);
  const res = await page.evaluate(async () => {
    const a = window.__audio || window.__game.ctx.audio;
    const t0 = performance.now();
    const pick = (r) => ({ peakDb: r.peakDb, rmsDb: r.rmsDb, activeRmsDb: r.activeRmsDb, maxWindowRmsDb: r.maxWindowRmsDb, clipped: r.clipped, nan: r.nan, dc: r.dc, seconds: r.seconds, notes: r.notes });
    const defaults = { master: 0.8, music: 0.6, sfx: 0.9 };
    const tracks = {};
    for (const t of a.tracks) {
      const raw = await a.renderOffline({ track: t, clip: false });
      const game = await a.renderOffline({ track: t, volumes: defaults, seconds: 20 });
      const i = a.trackInfo(t);
      tracks[t] = { bpm: i.bpm, bars: i.bars, loopBars: i.loopBars, loopSeconds: Math.round(i.loopSeconds * 10) / 10, raw: pick(raw), game: pick(game) };
    }
    const sfx = {};
    const variants = { land: { impact: 28 }, throw: { kind: 'puff', charge: 1 }, step: { surface: 'wood' }, glowcap: { step: 13 }, tonicStart: { kind: 'anvil' }, zoneEnter: { zone: 'pit' } };
    for (const n of a.names) {
      const r = await a.renderOffline({ sfx: n, clip: false, params: variants[n] || {} });
      const g = await a.renderOffline({ sfx: n, volumes: defaults, params: variants[n] || {} });
      sfx[n] = { peakDb: r.peakDb, activeRmsDb: r.activeRmsDb, activeSec: r.activeSec, gamePeakDb: g.peakDb, nan: r.nan, dc: r.dc };
    }
    return { tracks, sfx, ms: Math.round(performance.now() - t0) };
  });
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const rawRms = [];
  for (const [t, r] of Object.entries(res.tracks)) {
    check(`${t}: raw peak < 0 dBFS`, r.raw.peakDb < 0, r.raw.peakDb);
    check(`${t}: not silent`, r.raw.activeRmsDb > -40, r.raw.activeRmsDb);
    check(`${t}: no NaN / DC`, r.raw.nan === 0 && Math.abs(r.raw.dc) < 0.01, `${r.raw.nan} ${r.raw.dc}`);
    check(`${t}: game output never reaches 0 dBFS`, r.game.peakDb < 0 && r.game.clipped === 0, r.game.peakDb);
    rawRms.push(r.raw.activeRmsDb);
  }
  check('tracks within 6 dB of each other', Math.max(...rawRms) - Math.min(...rawRms) <= 6, rawRms.join(' '));
  const quiet = [], hot = [], bad = [];
  for (const [n, r] of Object.entries(res.sfx)) {
    if (!(r.peakDb > -36)) quiet.push(`${n} ${r.peakDb}`);
    if (!(r.peakDb < 0)) hot.push(`${n} ${r.peakDb}`);
    if (r.nan || Math.abs(r.dc) > 0.01) bad.push(n);
  }
  check('every sfx audible (peak > -36 dBFS)', quiet.length === 0, quiet.join(', '));
  check('no sfx clips (raw peak < 0 dBFS)', hot.length === 0, hot.join(', '));
  check('no sfx NaN / DC', bad.length === 0, bad.join(', '));
  const musicGame = Math.max(...Object.values(res.tracks).map((r) => r.game.activeRmsDb));
  const loudSfx = ['jump', 'throw', 'puffHit', 'enemyHurt', 'bossStomp'].map((n) => res.sfx[n].gamePeakDb);
  check('music sits under the sfx at default settings', loudSfx.every((p) => p > musicGame), `music RMS ${musicGame} vs sfx peaks ${loudSfx.join(' ')}`);
  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok), checks, ...res };
}
