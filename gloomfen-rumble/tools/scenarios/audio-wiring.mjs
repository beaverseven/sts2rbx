// Audio wiring: real gameplay events -> sounds, the music state machine, ducking, loops, spatial
// pan/attenuation, volumes, unknown names, and the "silent until unlocked" rule.
//   node tools/build.mjs --entry src/dev/audio.js --out dist/dev-audio --dev
//   node tools/scenario.mjs tools/scenarios/audio-wiring.mjs --html dist/dev-audio/index.html --shots dist/dev-audio/shots
export default async function (page, h) {
  page.setDefaultTimeout(120000);
  await page.waitForFunction(() => window.__game && window.__game.ctx.audio && !window.__game.ctx.audio.isStub);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const A = (fn, arg) => h.game(fn, arg);

  // --- before any gesture: no context, silent no-ops
  const pre = await A((g) => { const a = g.ctx.audio; return { state: a.state, play: a.play('jump'), track: a.track }; });
  check('no AudioContext before a gesture; play() is a silent no-op', pre.state === 'none' && pre.play === null, pre);
  check('music requested before unlock is remembered', pre.track === 'glade', pre.track);

  await A((g) => g.ctx.audio.unlock(true));
  await page.waitForFunction(() => window.__game.ctx.audio.state === 'running');
  await h.wait(600);
  const m0 = await A((g) => g.ctx.audio.players);
  check('glade starts once unlocked (arena zone -> glade)', m0.length === 1 && m0[0].name === 'glade', m0);

  // --- gameplay: run, jump, land, throw at a dummy, charge, glide, fall in the pool
  const played = async () => A((g) => ({ ...g.ctx.audio.stats.played }));
  await A((g) => {
    g.godMode(true);
    g.teleport(0, 1.05, 0, 0); g.setCamera(0, 0.22, 7.5); g.step(10);
    g.setInput({ move: [0, 1] }); g.step(45);
    g.setInput({ move: [0, 1], jump: true }); g.step(3); g.setInput({ move: [0, 1] }); g.step(45);
    g.setInput(null); g.step(20);
  });
  await h.wait(150);
  await A((g) => { g.teleport(2, 1.05, 12, 0); g.step(10); g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(40); g.setInput(null); });
  await h.wait(150);
  let p = await played();
  for (const n of ['step', 'jump', 'land', 'throw', 'puffHit', 'thwack']) check(`gameplay plays '${n}'`, p[n] > 0, p[n]);

  // charge hum loop (driven per frame) + full-charge ping
  // (loops are driven from render frames: wait on conditions, headless frames can take seconds)
  const until = (fn, ms = 8000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);
  await A((g) => { g.setInput({ throw: true }); g.step(30); });
  const chargeOn = await until(() => !!window.__game.ctx.audio.core.loops.charge);
  await A((g) => { g.step(40); });
  await A((g) => { g.setInput({}); g.step(3); g.setInput(null); });
  const chargeOff = await until(() => !window.__game.ctx.audio.core.loops.charge);
  p = await played();
  check('charge hum loop runs while charging and stops on release', chargeOn && chargeOff, { chargeOn, chargeOff });
  check("full charge plays 'chargeFull'", p.chargeFull > 0, p.chargeFull);

  // glide wind loop
  // a teleport grants coyote time: holding jump first jumps, the leaf opens after the apex
  await A((g) => { g.teleport(0, 14, 0, 0); g.setInput({ jump: true }); g.step(55); });
  await until(() => !!window.__game.ctx.audio.core.loops.glide);
  const glideOn = await A((g) => ({ loop: !!g.ctx.audio.core.loops.glide, state: g.state().player.state }));
  await A((g) => { g.setInput({}); g.step(2); });
  const glideOff = await until(() => !window.__game.ctx.audio.core.loops.glide);
  p = await played();
  check('glide: leaf opens, wind loop while gliding, stops on release', glideOn.loop && glideOn.state === 'glide' && glideOff && p.glideOpen > 0 && p.glideClose > 0, { glideOn, glideOff, open: p.glideOpen, close: p.glideClose });
  await A((g) => { g.setInput(null); g.step(120); g.teleport(-27, 3, 10, 0); g.step(90); });
  await h.wait(150);
  p = await played();
  check("falling in the bog plays 'splash' (not the hurt squeak)", p.splash > 0, { splash: p.splash, hurt: p.hurt || 0 });

  // tonics
  await A((g) => { g.give('seeker'); g.step(1); });
  await h.wait(120);
  await A((g) => { g.ctx.player.tonic.remaining = 3.05; g.step(200); });
  await h.wait(150);
  p = await played();
  check('tonic start / 3 warning ticks / end', p.tonicStart > 0 && p.tonicWarn >= 1 && p.tonicEnd > 0, { start: p.tonicStart, warn: p.tonicWarn, end: p.tonicEnd });

  // glowcap chime climbs the scale with the chain (score stub in this sandbox -> internal chain)
  for (let i = 0; i < 5; i++) { await A((g) => { g.ctx.events.emit('pickup:glowcap', { position: g.ctx.player.position.clone(), points: 50 }); g.step(6); }); await h.wait(60); }
  const steps = await A((g) => g.ctx.audio.stats.recent.filter((r) => r.name === 'glowcap').map((r) => r.step));
  check('glowcap steps rise with the chain', steps.slice(-5).join() === '0,1,2,3,4', steps);
  // with a real score object: the chain comes from score:award
  const steps2 = await A((g) => {
    const ctx = g.ctx, saved = ctx.score;
    const sc = { isStub: false, points: 0, chain: 0, multiplier: 1, timeLeft: 0, award(b) { sc.chain++; ctx.events.emit('score:award', { points: b, base: b, multiplier: 1, reason: 'glowcap', chain: sc.chain }); } };
    const off = ctx.events.on('pickup:glowcap', () => sc.award(50));
    ctx.score = sc;
    return { off: !!off, saved: !!saved };
  });
  await h.wait(700);
  for (let i = 0; i < 3; i++) { await A((g) => { g.ctx.events.emit('pickup:glowcap', { position: g.ctx.player.position.clone(), points: 50 }); g.step(2); }); await h.wait(60); }
  const steps3 = await A((g) => g.ctx.audio.stats.recent.filter((r) => r.name === 'glowcap').map((r) => r.step).slice(-3));
  check('glowcap chime uses score:award chain (score installed after audio)', steps3.join() === '0,1,2', { steps3, steps2 });

  // --- music state machine
  const mus = async () => A((g) => ({ track: g.ctx.audio.track, players: g.ctx.audio.players.map((q) => q.name + (q.fading ? '~' : '')) }));
  await A((g) => g.ctx.events.emit('zone:enter', { id: 'bog', name: 'Sunken Bog' }));
  await h.wait(150);
  const x1 = await mus();
  check('zone:enter bog -> crossfade glade -> bog', x1.track === 'bog' && x1.players.includes('bog') && x1.players.includes('glade~'), x1);
  // 1.5 s on the audio clock (which can lag wall time under SwiftShader load): wait for it
  await until(() => window.__game.ctx.audio.players.length === 1, 10000);
  const x2 = await mus();
  check('old track disposed after the 1.5 s crossfade', x2.players.join() === 'bog', x2);
  p = await played();
  check("zone:enter plays the 'zoneEnter' horn", p.zoneEnter > 0, p.zoneEnter);
  await A((g) => g.ctx.events.emit('zone:enter', { id: 'fort', name: 'Bandit Fort' }));
  await h.wait(100);
  check('zone fort -> fort', (await mus()).track === 'fort');
  await A((g) => g.ctx.events.emit('zone:enter', { id: 'pit', name: "Gnarlbelly's Pit" }));
  await h.wait(100);
  check('zone pit -> music fades out (tension before the boss)', (await mus()).track === null);
  await A((g) => g.ctx.events.emit('boss:start', { maxHp: 24, hp: 24, phase: 1 }));
  await h.wait(100);
  p = await played();
  check("boss:start -> 'boss' track + roar", (await mus()).track === 'boss' && p.bossRoar > 0, p.bossRoar);
  await A((g) => g.ctx.events.emit('boss:defeated', { position: g.ctx.player.position.clone() }));
  await h.wait(200);
  const x3 = await mus();
  await page.waitForFunction(() => window.__game.ctx.audio.track === 'victory', null, { timeout: 15000 }).catch(() => {});
  const x4 = await mus();
  check('boss:defeated -> music out, then victory ~4 s later', x3.track === null && x4.track === 'victory', { x3, x4 });
  await A((g) => g.ctx.setState('title'));
  await h.wait(100);
  check("game:state title -> 'title'", (await mus()).track === 'title');
  await A((g) => g.ctx.setState('results'));
  await h.wait(100);
  check("game:state results -> 'victory'", (await mus()).track === 'victory');
  await A((g) => { g.ctx.setState('playing'); g.ctx.events.emit('zone:enter', { id: 'glade', name: 'Mossy Glade' }); });
  await h.wait(100);
  check("back to playing in the glade -> 'glade'", (await mus()).track === 'glade');

  // --- ducking: paused (lowpass + quieter), dead
  await A((g) => g.ctx.setState('paused'));
  await h.wait(900);
  const duckP = await A((g) => ({ duck: g.ctx.audio.core.musicDuck.gain.value, lp: g.ctx.audio.core.musicFilter.frequency.value, loops: g.ctx.audio._internal.mix.loops }));
  await A((g) => g.ctx.setState('playing'));
  await h.wait(900);
  const duckR = await A((g) => ({ duck: g.ctx.audio.core.musicDuck.gain.value, lp: g.ctx.audio.core.musicFilter.frequency.value }));
  check('pause ducks + muffles the music, resume restores it', Math.abs(duckP.duck - 0.42) < 0.05 && duckP.lp < 1000 && duckP.loops < 0.05 && duckR.duck > 0.95 && duckR.lp > 15000, { duckP, duckR });
  await A((g) => { g.godMode(false); g.ctx.player.die(); g.step(2); });
  await h.wait(800);
  const duckD = await A((g) => ({ state: g.ctx.state, duck: g.ctx.audio.core.musicDuck.gain.value }));
  await A((g) => { g.step(120); g.godMode(true); });
  await h.wait(150);
  p = await played();
  check("death: 'died', music ducked while dead, 'respawn' after", p.died > 0 && duckD.state === 'dead' && Math.abs(duckD.duck - 0.55) < 0.06 && p.respawn > 0, { duckD, died: p.died, respawn: p.respawn });

  // --- spatial
  const sp = await A((g) => {
    const a = g.ctx.audio, e = g.ctx.camera.matrixWorld.elements, pp = g.ctx.player.position;
    const at = (side, dist) => [pp.x + e[0] * side - e[8] * dist, pp.y + 1, pp.z + e[2] * side - e[10] * dist];
    return {
      right: a._internal.spatial(at(8, 0)), left: a._internal.spatial(at(-8, 0)), near: a._internal.spatial(at(0, 2)),
      far30: a._internal.spatial(at(0, 30)), far200: a._internal.spatial(at(0, 200)), farPlay: a.play('clang', { position: at(0, 200) }),
    };
  });
  check('pan follows the camera: right > 0.4, left < -0.4', sp.right.pan > 0.4 && sp.left.pan < -0.4, sp);
  check('distance attenuation: near 1, 30 m quieter, 200 m culled', sp.near.gain > 0.95 && sp.far30.gain < 0.5 && sp.far200.gain === 0 && sp.farPlay === null, sp);

  // --- volumes + settings polling + unknown names
  await A((g) => g.ctx.audio.setVolumes({ music: 0.3 }));
  await A((g) => { g.ctx.settings.sfx = 0.5; });
  await until(() => Math.abs(window.__game.ctx.audio.core.sfxVol.gain.value - Math.pow(0.5, 1.5)) < 0.01, 3000);
  const vol = await A((g) => ({ music: g.ctx.settings.music, mv: g.ctx.audio.core.musicVol.gain.value, sv: g.ctx.audio.core.sfxVol.gain.value }));
  check('setVolumes mirrors ctx.settings; direct ctx.settings edits apply', vol.music === 0.3 && Math.abs(vol.mv - Math.pow(0.3, 1.5) * 0.56) < 0.01 && Math.abs(vol.sv - Math.pow(0.5, 1.5)) < 0.01, vol);
  await A((g) => g.ctx.audio.setVolumes({ music: 0.6, sfx: 0.9 }));
  const unk = await A((g) => ({ r: g.ctx.audio.play('notARealSound'), n: g.ctx.audio.stats.unknown.notARealSound }));
  check('unknown sfx names are ignored (counted, no throw)', unk.r === null && unk.n === 1, unk);
  // every name the enemies area calls directly exists
  const enemyNames = ['yawn', 'bellySlap', 'clubWindup', 'clubSlam', 'slingSpin', 'slingThrow', 'ironbellyGrunt', 'bellyFlop', 'clang', 'cauldronClang', 'potClatter', 'clatter', 'splash', 'bossSnore', 'bossRoar', 'bossStomp', 'bossClubSlam', 'bossInhale', 'bossSpit', 'bossSummon', 'bossCharge', 'bossSlide', 'bossCrash', 'bossDizzy', 'bossHurt', 'bossBoing', 'bossDeflate', 'bossPlop', 'bossDefeated', 'stomp', 'shockwave', 'menuMove', 'menuConfirm', 'menuBack'];
  const missing = await A((g, names) => names.filter((n) => !g.ctx.audio.names.includes(n) && !(n in g.ctx.audio.aliases)), enemyNames);
  check('every sound name other areas call exists', missing.length === 0, missing);

  const st = await A((g) => ({ errors: g.ctx.audio.stats.errors, lastError: g.ctx.audio.stats.lastError, dropped: g.ctx.audio.stats.dropped, played: g.ctx.audio.stats.played }));
  check('no internal audio errors', st.errors === 0, st.lastError);
  await A((g) => { g.realtime(true); g.setQuality('high'); });
  await h.wait(800);
  await h.shot('audio-sandbox');
  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok), checks, played: st.played, dropped: st.dropped };
}
