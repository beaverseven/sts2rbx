// Audio must never throw: no AudioContext at all, a constructor that throws (blocked by policy),
// and a context that stays suspended (resume() rejects). Every API call must be a silent no-op.
//   node tools/scenario.mjs tools/scenarios/audio-fallback.mjs --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots
// (works on dist/dev-audio/index.html too)
export default async function (page) {
  await page.waitForFunction(() => window.__audioLib);
  const res = await page.evaluate(async () => {
    const { createAudio, installAudio } = window.__audioLib;
    const Saved = window.AudioContext, SavedW = window.webkitAudioContext;
    const exercise = async (a) => {
      const out = {};
      try {
        out.unlock = a.unlock(true);
        out.play = a.play('jump', { position: [1, 2, 3], volume: 1 });
        a.music('glade'); a.music(null); a.music('nope');
        a.setVolumes({ master: 0.5, music: 0.2, sfx: 1 }); a.setVolumes(null);
        a.duck(0.3, 1); a.stopAll();
        out.trackInfo = !!a.trackInfo('boss');
        await new Promise((r) => setTimeout(r, 150));
        out.unlock2 = a.unlock();
        out.state = a.state;
        out.errors = a.stats.errors;
        out.reason = a.stats.reason;
        out.threw = false;
      } catch (e) { out.threw = String(e); }
      return out;
    };
    const results = {};
    // 1. no WebAudio at all
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
    results.missing = await exercise(createAudio(null));
    // 2. constructor throws (autoplay / permissions policy)
    window.AudioContext = function Blocked() { throw new Error('blocked by policy'); };
    results.throwing = await exercise(createAudio(null));
    // 3. context stays suspended, resume() rejects
    window.AudioContext = class Stuck extends Saved {
      get state() { return 'suspended'; }
      resume() { return Promise.reject(new Error('not allowed')); }
    };
    results.suspended = await exercise(createAudio(null));
    // 4. installAudio on a minimal fake ctx with events firing before/without a context
    window.AudioContext = undefined;
    const listeners = {};
    const fake = {
      settings: { master: 0.8, music: 0.6, sfx: 0.9 }, state: 'playing', time: { now: 0, frame: 0, real: 0 },
      events: { on(n, f) { (listeners[n] = listeners[n] || []).push(f); return () => {}; }, emit(n, p) { for (const f of listeners[n] || []) f(p, n); } },
      addSystem(s) { this.sys = s; return () => {}; }, score: { isStub: true, chain: 0 },
    };
    let threw = false;
    try {
      const a = installAudio(fake);
      a.unlock(true);
      for (const n of ['player:jump', 'player:land', 'zone:enter', 'boss:start', 'pickup:glowcap', 'projectile:hit', 'game:state', 'boss:defeated']) fake.events.emit(n, {});
      fake.sys.update(1 / 60, fake); fake.sys.frame(1 / 60, fake);
      results.installed = { state: a.state, errors: a.stats.errors };
    } catch (e) { threw = String(e); }
    results.installThrew = threw;
    window.AudioContext = Saved; window.webkitAudioContext = SavedW;
    return results;
  });
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  check('no AudioContext: silent, disabled, nothing thrown', res.missing.threw === false && res.missing.state === 'disabled' && res.missing.play === null && res.missing.errors === 0, res.missing);
  check('constructor throws: silent, disabled, nothing thrown', res.throwing.threw === false && res.throwing.state === 'disabled' && res.throwing.play === null, res.throwing);
  check('stuck suspended context: unlock false, play no-op, no unhandled rejection', res.suspended.threw === false && res.suspended.unlock === false && res.suspended.play === null && res.suspended.errors === 0, res.suspended);
  check('installAudio + events with no AudioContext: nothing thrown', res.installThrew === false && res.installed && res.installed.errors === 0, res.installed);
  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok), checks };
}
