// Scheduler robustness: a hidden tab (music muted, nothing scheduled) and a stalled main thread
// (no scheduler ticks for seconds while the audio clock keeps running) must not produce a burst
// of stacked notes when ticking resumes.
//   node tools/scenario.mjs tools/scenarios/audio-hidden.mjs --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots
export default async function (page, h) {
  page.setDefaultTimeout(120000);
  await page.waitForFunction(() => window.__audio);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const E = (fn, arg) => page.evaluate(fn, arg);

  // output meter: an analyser after the compressor, sampled from a timer
  await E(() => {
    const a = window.__audio;
    a.unlock(true);
    a.music('boss'); // the densest track
    window.__meter = { max: 0, reset() { this.max = 0; } };
    const wait = setInterval(() => {
      if (!a.core) return;
      clearInterval(wait);
      const an = a.core.ac.createAnalyser(); an.fftSize = 2048;
      a.core.comp.connect(an);
      const buf = new Float32Array(an.fftSize);
      setInterval(() => { an.getFloatTimeDomainData(buf); let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); window.__meter.max = Math.max(window.__meter.max, pk); }, 20);
    }, 20);
  });
  await page.waitForFunction(() => window.__audio.state === 'running' && window.__audio.players.length === 1);
  await h.wait(2500);
  const snap = () => E(() => {
    const a = window.__audio, s = a.stats, ac = a.context, p = a.core.players[0];
    return { notes: s.notes, maxPerTick: s.maxNotesPerTick, music: { ...s.music }, ahead: p ? Math.round((p.nextTime - ac.currentTime) * 1000) : null, hideGain: a.core.musicIn.gain.value, meter: window.__meter.max, t: ac.currentTime };
  });
  const base = await snap();
  await E(() => { window.__audio.stats.maxNotesPerTick = 0; window.__meter.reset(); });
  await h.wait(2000);
  const normal = await snap();
  check('baseline: music plays, notes scheduled in small batches', normal.notes > base.notes && normal.maxPerTick <= 12, normal);

  // 1) stalled main thread while visible: 3 s without a single scheduler tick
  await E(() => { window.__audio.stats.maxNotesPerTick = 0; window.__meter.reset(); });
  const stall = await E(() => {
    const ac = window.__audio.context, t0 = ac.currentTime, w = performance.now();
    while (performance.now() - w < 3000) { /* block */ }
    return Math.round((ac.currentTime - t0) * 100) / 100;
  });
  await h.wait(1500);
  const afterStall = await snap();
  check('audio clock kept running during the stall', stall > 2.5, stall);
  check('after a 3 s stall: no burst (max notes per tick stays small)', afterStall.maxPerTick <= Math.max(12, normal.maxPerTick + 4), { normalMax: normal.maxPerTick, afterMax: afterStall.maxPerTick });
  check('after a 3 s stall: the player jumped ahead (steps skipped, not stacked)', afterStall.music.skipped - normal.music.skipped >= 20 && afterStall.ahead > 0, { skipped: afterStall.music.skipped - normal.music.skipped, catchUps: afterStall.music.catchUps, aheadMs: afterStall.ahead });
  check('after a 3 s stall: output level not louder than normal play', afterStall.meter <= Math.max(normal.meter * 1.4, 0.05), { normalPeak: normal.meter, afterPeak: afterStall.meter });

  // 2) tab hidden for 3 s (plus timer starvation), then visible again
  await E(() => { window.__audio.stats.maxNotesPerTick = 0; window.__meter.reset(); });
  await E(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await h.wait(500);
  const hid = await snap();
  check('hidden tab mutes the music', hid.hideGain < 0.05, hid.hideGain);
  // hidden tabs get ~1 Hz timers: starve the scheduler for 2.5 s, then let it tick (muted) for 1 s
  await E(() => { const w = performance.now(); while (performance.now() - w < 2500) { /* throttled */ } });
  await h.wait(1000);
  const hid2 = await snap();
  check('while hidden nothing is scheduled (steps advance muted)', hid2.notes - hid.notes <= 2 && hid2.music.muted > hid.music.muted, { notes: hid2.notes - hid.notes, muted: hid2.music.muted - hid.music.muted });
  await E(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await E(() => { window.__audio.stats.maxNotesPerTick = 0; window.__meter.reset(); });
  await h.wait(2000);
  const back = await snap();
  check('visible again: music unmuted and playing', back.hideGain > 0.9 && back.notes > hid2.notes, { gain: back.hideGain, notes: back.notes - hid2.notes });
  check('visible again: no burst of stacked notes', back.maxPerTick <= Math.max(12, normal.maxPerTick + 4) && back.meter <= Math.max(normal.meter * 1.4, 0.05), { maxPerTick: back.maxPerTick, peak: back.meter, normalPeak: normal.meter });
  const err = await E(() => ({ errors: window.__audio.stats.errors, last: window.__audio.stats.lastError }));
  check('no internal audio errors', err.errors === 0, err);
  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok), checks };
}
