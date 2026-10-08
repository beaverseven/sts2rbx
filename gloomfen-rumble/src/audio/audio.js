// Gloomfen Rumble audio: WebAudio engine, synthesized sfx, procedural music, event wiring.
//
//   import { installAudio } from './audio/audio.js';
//   boot({ install: [installAudio, ...] })
//
// installAudio(ctx) replaces ctx.audio with the real engine and subscribes to the game events
// itself (nothing else needs to call it). Contract API:
//   audio.unlock()                                  resume/create the AudioContext (user gesture)
//   audio.play(name, { volume, pitch, position })   sfx by name (see docs/audio.md); unknown names are ignored
//   audio.music(track | null)                       'title' | 'glade' | 'bog' | 'fort' | 'boss' | 'victory'
//   audio.setVolumes({ master, music, sfx })        0..1 (also mirrored into ctx.settings)
// Extensions: duck(level, seconds), stopAll(), state, track, names, tracks, stats, renderOffline(opts).
//
// It never throws: with no AudioContext (or a blocked/suspended one) every call is a silent no-op.
// The AudioContext is created lazily on the first user gesture (no autoplay warnings), music
// requested before that starts as soon as audio unlocks.
import { AudioCore, compiled } from './core.js';
import { SFX, SFX_NAMES, ALIASES } from './sfx.js';
import { TRACK_NAMES, TRACKS } from './tracks.js';
import { renderOffline } from './offline.js';

const LOOKAHEAD = 0.12;     // s of music scheduled ahead of the audio clock
const TICK_MS = 25;         // scheduler interval
const CROSSFADE = 1.5;      // s between tracks
const MAX_VOICES = 40;      // simultaneous sfx voices
const ZONE_TRACK = { glade: 'glade', bog: 'bog', fort: 'fort', pit: null };
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'keydown', 'touchstart', 'touchend', 'click'];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Create the audio engine. `ctx` is optional (spatial audio and settings come from it).
 * options: { settings } overrides when there is no ctx.
 */
export function createAudio(ctx = null, options = {}) {
  const settings = ctx ? ctx.settings : { master: 0.8, music: 0.6, sfx: 0.9, ...(options.settings || {}) };
  let ac = null, core = null, disabled = false, timer = null;
  let wantTrack = null;
  let hidden = typeof document !== 'undefined' ? !!document.hidden : false;
  const lastPlay = Object.create(null);
  const pluckJobs = [];
  const stats = {
    reason: null, errors: 0, lastError: null, created: false,
    played: Object.create(null), dropped: 0, unknown: Object.create(null),
    recent: [], // last 64 plays: { name, t (audio clock), step?, kind?, pan, gain }
    ticks: 0, notes: 0, maxNotesPerTick: 0, maxTickGapMs: 0,
    music: { skipped: 0, muted: 0, catchUps: 0, maxSkip: 0 }, // steps skipped after stalls, steps advanced muted (hidden)
  };
  let lastTickWall = 0;
  const applied = { master: settings.master, music: settings.music, sfx: settings.sfx }; // last volumes sent to the graph

  const noteError = (e) => { stats.errors++; stats.lastError = String((e && e.message) || e); };

  const Ctor = () => (typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null);
  const activationOk = () => {
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    return !ua || ua.hasBeenActive;
  };

  function ensure(force) {
    if (core) return true;
    if (disabled) return false;
    const C = Ctor();
    if (!C) { disabled = true; stats.reason = 'no AudioContext'; return false; }
    // creating a context before any user activation only produces a suspended context + a console warning
    if (!force && !activationOk()) return false;
    try { ac = new C({ latencyHint: 'interactive' }); } catch (e) { disabled = true; stats.reason = 'AudioContext blocked: ' + e; ac = null; return false; }
    try {
      core = new AudioCore(ac, { volumes: settings });
      core.musicStats = stats.music;
      if (hidden) core.musicIn.gain.value = 0;
    } catch (e) {
      disabled = true; stats.reason = 'graph failed: ' + e; noteError(e);
      try { ac.close(); } catch { /* ignore */ }
      ac = null; core = null;
      return false;
    }
    stats.created = true;
    // pre-render plucked strings: the requested track first, then the rest, a few per tick
    const order = [wantTrack, ...TRACK_NAMES].filter((n, i, a) => n && a.indexOf(n) === i);
    pluckJobs.push(...AudioCore.pluckJobs(order));
    if (wantTrack) core.setTrack(wantTrack, ac.currentTime, 0);
    timer = setInterval(tick, TICK_MS);
    applyMix();
    return true;
  }

  function tick() {
    try {
      if (!core) return;
      const wall = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (lastTickWall && !hidden) stats.maxTickGapMs = Math.max(stats.maxTickGapMs, wall - lastTickWall);
      lastTickWall = wall;
      // settings changed directly (UI sliders writing ctx.settings) + duck timer
      if (settings.master !== applied.master || settings.music !== applied.music || settings.sfx !== applied.sfx) audio.setVolumes(settings);
      if (duckUntil && ac.currentTime >= duckUntil) { duckUntil = 0; applyMix(); }
      if (ac.state !== 'running') return;
      const now = ac.currentTime;
      const n = core.scheduleMusic(now, now + LOOKAHEAD, hidden);
      stats.ticks++;
      stats.notes += n;
      if (n > stats.maxNotesPerTick) stats.maxNotesPerTick = n;
      if (pluckJobs.length) core.warmPlucks(pluckJobs, 3);
      runTimers(now);
    } catch (e) { noteError(e); }
  }

  // ------------------------------------------------------------------ timers (audio clock)
  const timers = [];
  function after(sec, fn) { if (core) timers.push({ at: ac.currentTime + sec, fn }); else fn(); }
  function runTimers(now) {
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= now) { const t = timers[i]; timers.splice(i, 1); try { t.fn(); } catch (e) { noteError(e); } }
    }
  }

  // ------------------------------------------------------------------ unlock
  let listening = false;
  const onGesture = () => { audio.unlock(); };
  function addGestureListeners() {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, onGesture, { capture: true, passive: true });
  }
  function removeGestureListeners() {
    if (!listening) return;
    listening = false;
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, onGesture, { capture: true });
  }

  // ------------------------------------------------------------------ spatial
  const _p = { x: 0, y: 0, z: 0 };
  function spatial(pos, ref, out) {
    out.gain = 1; out.pan = 0; out.far = 0;
    const cam = ctx && ctx.camera;
    if (!cam || !pos) return out;
    if (Array.isArray(pos)) { _p.x = pos[0]; _p.y = pos[1]; _p.z = pos[2]; } else { _p.x = pos.x; _p.y = pos.y; _p.z = pos.z; }
    if (!(Number.isFinite(_p.x) && Number.isFinite(_p.y) && Number.isFinite(_p.z))) return out;
    const e = cam.matrixWorld.elements;
    const dx = _p.x - e[12], dy = _p.y - e[13], dz = _p.z - e[14];
    const dc = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let d = dc;
    const pl = ctx.player && ctx.player.position;
    if (pl) { const px = _p.x - pl.x, py = _p.y - pl.y - 0.6, pz = _p.z - pl.z; d = Math.min(dc, Math.sqrt(px * px + py * py + pz * pz)); }
    const maxD = Math.max(45, ref * 7);
    if (d > maxD) { out.gain = 0; return out; }
    let g = d <= ref ? 1 : ref / (ref + (d - ref));
    if (d > maxD * 0.7) g *= (maxD - d) / (maxD * 0.3);
    out.gain = g;
    out.far = clamp01((d - ref) / 40);
    if (dc > 0.01) {
      const side = (dx * e[0] + dy * e[1] + dz * e[2]) / dc; // camera right axis
      out.pan = Math.max(-1, Math.min(1, side)) * 0.8 * clamp01(dc / 3);
    }
    return out;
  }
  const _sp = { gain: 1, pan: 0, far: 0 };

  // ------------------------------------------------------------------ mix state
  let duckLevel = 1, duckUntil = 0;
  function applyMix() {
    if (!core) return;
    const t = ac.currentTime;
    const s = ctx ? ctx.state : 'playing';
    let duck = 1, cutoff = 20000;
    if (s === 'paused') { duck = 0.42; cutoff = 850; }
    else if (s === 'dead') { duck = 0.55; cutoff = 2600; }
    if (t < duckUntil) duck = Math.min(duck, duckLevel);
    const loops = s === 'playing' && !hidden ? 1 : 0;
    core.musicDuck.gain.setTargetAtTime(duck, t, 0.12);
    core.musicFilter.frequency.setTargetAtTime(cutoff, t, 0.1);
    core.loopBus.gain.setTargetAtTime(loops, t, 0.04);
    core.musicIn.gain.setTargetAtTime(hidden ? 0 : 1, t, hidden ? 0.03 : 0.35);
    mix.duck = duck; mix.cutoff = cutoff; mix.loops = loops; mix.hidden = hidden;
  }
  const mix = { duck: 1, cutoff: 20000, loops: 1, hidden: false }; // last targets (AudioParam.value lags on idle nodes)

  function onVisibility() {
    hidden = !!document.hidden;
    try {
      applyMix();
      if (!hidden && core && ac.state !== 'running' && ac.state !== 'closed' && activationOk()) ac.resume().catch(() => {});
    } catch (e) { noteError(e); }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  // ------------------------------------------------------------------ public API
  const audio = {
    isStub: false,

    /** Create/resume the AudioContext. Pass true to skip the user-activation check (tests). */
    unlock(force = false) {
      try {
        if (!ensure(force)) { if (!disabled) addGestureListeners(); return false; }
        if (ac.state === 'running') { removeGestureListeners(); return true; }
        if (ac.state !== 'closed') {
          addGestureListeners();
          const p = ac.resume();
          if (p && p.then) p.then(() => { if (ac.state === 'running') { removeGestureListeners(); applyMix(); } }, () => {});
        }
        return ac.state === 'running';
      } catch (e) { noteError(e); return false; }
    },

    /** Play an sfx. opts: { volume, pitch, position (Vector3|[x,y,z]), ...recipe params }. */
    play(name, opts) {
      try {
        if (!core || ac.state !== 'running') return null;
        const key = AudioCore.resolve(name);
        if (!key) { stats.unknown[name] = (stats.unknown[name] || 0) + 1; return null; }
        const def = SFX[key];
        const now = ac.currentTime;
        const o = opts || {};
        const lp = lastPlay[key];
        if (lp !== undefined && now - lp < (def.gap ?? 0.03)) { stats.dropped++; return null; }
        if (core.liveVoices(now, key) >= (def.max ?? 6) || core.voices.length >= MAX_VOICES) { stats.dropped++; return null; }
        let vol = o.volume ?? 1, pan = 0, wet = def.wet ?? 0.12;
        if (o.position) {
          spatial(o.position, def.ref ?? 7, _sp);
          if (_sp.gain < 0.015) { stats.dropped++; return null; }
          vol *= _sp.gain; pan = _sp.pan; wet += _sp.far * 0.15;
        }
        const vary = def.vary ?? 0.04;
        const pitch = (o.pitch ?? 1) * Math.pow(2, (Math.random() * 2 - 1) * vary);
        vol *= 0.92 + Math.random() * 0.16;
        lastPlay[key] = now;
        stats.played[key] = (stats.played[key] || 0) + 1;
        const rec = { name: key, t: Math.round(now * 1000) / 1000, pan: Math.round(pan * 100) / 100, gain: Math.round(vol * 100) / 100 };
        if (o.step !== undefined) rec.step = o.step;
        if (o.kind !== undefined) rec.kind = o.kind;
        stats.recent.push(rec);
        if (stats.recent.length > 64) stats.recent.shift();
        return core.playSfx(key, now + 0.003, { volume: vol, pitch, pan, wet, params: o });
      } catch (e) { noteError(e); return null; }
    },

    /** Crossfade to a music track (null = silence). Unknown names are ignored. */
    music(name) {
      try {
        if (name !== null && name !== undefined && !TRACKS[name]) return;
        wantTrack = name || null;
        if (core) {
          // pre-render this track's plucked strings first
          const jobs = AudioCore.pluckJobs(wantTrack ? [wantTrack] : []);
          if (jobs.length) pluckJobs.unshift(...jobs);
          core.setTrack(wantTrack, ac.currentTime, CROSSFADE);
        }
      } catch (e) { noteError(e); }
    },

    /** Set any of { master, music, sfx } (0..1); mirrored into ctx.settings. */
    setVolumes(v) {
      try {
        if (!v) return;
        for (const k of ['master', 'music', 'sfx']) if (typeof v[k] === 'number' && Number.isFinite(v[k])) settings[k] = clamp01(v[k]);
        applied.master = settings.master; applied.music = settings.music; applied.sfx = settings.sfx;
        if (core) core.setVolumes(settings);
      } catch (e) { noteError(e); }
    },

    // ---------------------------------------------------------------- extensions
    /** Temporarily lower the music to `level` (0..1) for `seconds`. */
    duck(level = 0.4, seconds = 2) {
      try { if (!core) return; duckLevel = clamp01(level); duckUntil = ac.currentTime + seconds; applyMix(); } catch (e) { noteError(e); }
    },
    /** Silence everything immediately (music players disposed, loops stopped). */
    stopAll() {
      try { if (!core) return; core.stopAllMusic(); for (const k of Object.keys(core.loops)) core.stopLoop(k, 0.05); wantTrack = null; } catch (e) { noteError(e); }
    },
    /** 'none' (not created yet) | 'disabled' | AudioContext.state */
    get state() { return disabled ? 'disabled' : ac ? ac.state : 'none'; },
    /** Requested track name (or null). */
    get track() { return wantTrack; },
    /** Names of the live music players (current + fading). */
    get players() { return core ? core.players.map((p) => ({ name: p.name, gain: p.out.gain.value, fading: p.stopAt !== Infinity, pos: p.pos })) : []; },
    names: SFX_NAMES.slice(),
    aliases: { ...ALIASES },
    tracks: TRACK_NAMES.slice(),
    stats,
    /** Track info: { name, bpm, beats, bars, loopBars, seconds, loopSeconds, parts, firstBar:{part: bar} } */
    trackInfo(name) {
      const c = compiled(name);
      if (!c) return null;
      const firstBar = {};
      c.steps.forEach((st, i) => { if (st) for (const e of st) if (!(e.part in firstBar)) firstBar[e.part] = Math.floor(i / c.spb); });
      return { name, bpm: c.bpm, beats: c.beats, bars: c.total / c.spb, loopBars: (c.total - c.loopStart) / c.spb, seconds: c.seconds, loopSeconds: c.loopSeconds, parts: Object.keys(c.parts), firstBar };
    },
    /** Offline render for tests: see offline.js. Returns a Promise. */
    renderOffline,
    get context() { return ac; },
    get core() { return core; },
    get hidden() { return hidden; },
  };

  // ------------------------------------------------------------------ continuous loops (per render frame)
  let charging = false, chargeSet = -1;
  const glideSet = { speed: -1, rise: null };
  function frame() {
    if (!core || ac.state !== 'running') return;
    if (!timer) return;
    const playing = !ctx || ctx.state === 'playing';
    const pl = ctx && ctx.player;
    // glide wind (also the updraft jet)
    const st = pl ? pl.state : null;
    if (playing && !hidden && (st === 'glide' || st === 'updraft')) {
      const loop = core.loops.glide || core.startLoop('glide');
      const v = pl.velocity;
      const speed = v ? Math.round(Math.hypot(v.x, v.z)) : 0;
      const rise = st === 'updraft';
      if (speed !== glideSet.speed || rise !== glideSet.rise) { glideSet.speed = speed; glideSet.rise = rise; loop.set(speed, rise); }
    } else if (core.loops.glide) { core.stopLoop('glide', 0.15); glideSet.speed = -1; }
    // charge hum
    const level = pl && pl.charge ? pl.charge : 0;
    if (charging && playing && level > 0) {
      const loop = core.loops.charge || core.startLoop('charge');
      const q = Math.round(level * 50) / 50;
      if (q !== chargeSet) { chargeSet = q; loop.set(q); }
    } else {
      if (core.loops.charge) { core.stopLoop('charge', 0.06); chargeSet = -1; }
      if (level <= 0) charging = false;
    }
  }

  audio._internal = {
    frame, applyMix, after, mix, spatial: (p, ref = 7) => ({ ...spatial(p, ref, { gain: 1, pan: 0, far: 0 }) }),
    setCharging(on) { charging = on; },
    recently(name, sec = 0.08) { const k = AudioCore.resolve(name); return !!(core && k && lastPlay[k] !== undefined && ac.currentTime - lastPlay[k] < sec); },
    tick,
  };
  addGestureListeners();
  return audio;
}

// ---------------------------------------------------------------------------
/** Install the audio engine into ctx and wire it to the game events. */
export function installAudio(ctx) {
  const audio = createAudio(ctx);
  ctx.audio = audio;
  wireEvents(ctx, audio);
  return audio;
}

function wireEvents(ctx, audio) {
  const I = audio._internal;
  const play = audio.play;
  const on = (name, fn) => ctx.events.on(name, (p, n) => { try { fn(p || {}, n); } catch (e) { audio.stats.errors++; audio.stats.lastError = String(e && e.message || e); } });
  const posOf = (p) => p.position || (p.entity && p.entity.position) || null;

  // --- music state
  let zone = null, bossActive = false, postBoss = false, victoryReady = false;
  let hornZone = null, hornAt = -1e9;
  function desired() {
    const s = ctx.state;
    if (s === 'title') return 'title';
    if (s === 'results') return 'victory';
    if (s === 'boot') return null;
    if (bossActive) return 'boss';
    if (postBoss) return victoryReady ? 'victory' : null;
    const z = zone ?? (ctx.level ? ctx.level.zone : null);
    if (z && z in ZONE_TRACK) return ZONE_TRACK[z];
    return 'glade';
  }
  const updateMusic = () => audio.music(desired());

  on('game:state', ({ state }) => {
    if (state === 'title') { bossActive = false; postBoss = false; victoryReady = false; }
    I.applyMix();
    updateMusic();
  });
  // a fresh run (integration's play again / quit to title): forget the last run's boss and zone
  on('run:reset', () => { bossActive = false; postBoss = false; victoryReady = false; zone = null; updateMusic(); });
  on('zone:enter', ({ id }) => {
    zone = id;
    const now = ctx.time ? ctx.time.real : 0;
    if (ctx.state === 'playing' && (id !== hornZone || now - hornAt > 30)) { play('zoneEnter', { zone: id }); hornZone = id; hornAt = now; }
    updateMusic();
  });
  on('boss:start', (p) => {
    bossActive = true; postBoss = false;
    play('bossRoar', { position: bossPos() }); // the boss usually plays it himself: the duplicate is dropped
    updateMusic();
  });
  on('boss:phase', ({ phase }) => { if (phase >= 2) audio.duck(0.6, 1.2); });
  on('boss:hurt', () => play('bossHurt', { position: bossPos() }));
  on('boss:defeated', (p) => {
    bossActive = false; postBoss = true; victoryReady = false;
    play('bossDefeated', { position: posOf(p) });
    updateMusic(); // fades the boss music out under the deflating raspberry
    I.after(4.2, () => { if (postBoss) { victoryReady = true; updateMusic(); } });
  });
  on('level:complete', () => { play('levelComplete'); audio.duck(0.35, 2.4); });
  function bossPos() {
    const b = ctx.enemies && ctx.enemies.boss ? ctx.enemies.boss() : null;
    return b ? b.position : null;
  }

  // --- Morel
  let fellAt = -1;
  on('player:jump', () => play('jump'));
  on('player:land', ({ impact = 8 }) => {
    if (impact < 1.5) return;
    play('land', { impact, volume: Math.min(1, 0.4 + impact / 22) });
  });
  on('player:glide', ({ on: open }) => {
    if (open) play('glideOpen');
    else if (ctx.player && !ctx.player.onGround && ctx.player.state !== 'updraft') play('glideClose');
  });
  on('player:throw', ({ kind, charge }) => { I.setCharging(false); play('throw', { kind, charge: charge || 0 }); });
  on('player:charge', ({ level }) => { if (level >= 1) play('chargeFull'); else I.setCharging(true); });
  on('player:step', ({ surface, speed = 6 }) => play('step', { surface, volume: Math.min(1, 0.45 + speed / 15) }));
  on('player:hurt', ({ hp }) => {
    I.setCharging(false);
    if (hp <= 0) return; // 'died' covers it
    if (ctx.time && ctx.time.now - fellAt < 0.05) return; // the splash covers a water fall
    play('hurt');
  });
  on('player:fell', () => { fellAt = ctx.time ? ctx.time.now : 0; play('splash'); });
  on('player:died', () => { I.setCharging(false); play('died'); });
  on('player:respawn', ({ checkpointId }) => {
    play('respawn');
    if (checkpointId && bossActive) { bossActive = false; updateMusic(); } // the boss fight resets on a death respawn
  });

  // --- projectiles
  on('projectile:hit', (p) => {
    const position = p.position, kind = p.kind;
    if (p.deflected) { if (!I.recently('clang') && !I.recently('bossBoing')) play('deflect', { position }); return; }
    if (p.target && p.target === ctx.player) { if (kind === 'mud') play('mudSplat', { position }); return; }
    if (kind === 'mud') { play(p.collider === 'water' ? 'plop' : 'mudSplat', { position, volume: 0.75 }); return; }
    if (p.collider === 'water') { play('plop', { position }); return; }
    if (kind === 'iron') { play('ironHit', { position }); return; }
    if (p.target) { play('puffHit', { position }); return; }
    if (p.collider && p.collider.surface === 'iron') play('deflect', { position });
    else play('puffPoof', { position });
  });

  // --- bandits
  on('enemy:alert', (p) => play('alert', { position: posOf(p) }));
  on('enemy:hurt', (p) => play(p.type === 'dummy' ? 'thwack' : 'enemyHurt', { position: posOf(p) }));
  on('enemy:killed', (p) => play(p.type === 'dummy' ? 'clatter' : 'enemyKilled', { position: posOf(p) }));
  on('armor:break', (p) => play('armorBreak', { position: posOf(p) }));

  // --- pickups / score. The glowcap chime climbs the scale with the combo chain; the chain comes
  // from score:award (whichever order score and audio were installed in).
  let pendingGlow = false, awardChain = 0, awardFrame = -1, ownChain = 0, ownLast = -1e9;
  const frameNo = () => (ctx.time ? ctx.time.frame : 0);
  const glow = (chain) => play('glowcap', { step: Math.max(0, chain - 1) });
  on('pickup:glowcap', () => {
    const sc = ctx.score;
    if (!sc || sc.isStub || typeof sc.award !== 'function') {
      const now = ctx.time ? ctx.time.now : 0;
      ownChain = now - ownLast < 3 ? ownChain + 1 : 1;
      ownLast = now;
      glow(ownChain);
      return;
    }
    if (awardFrame === frameNo()) { glow(awardChain); awardFrame = -1; return; }
    pendingGlow = true;
  });
  on('score:award', (p) => {
    if (p.reason === 'glowcap') {
      if (pendingGlow) { pendingGlow = false; glow(p.chain || 1); } else { awardChain = p.chain || 1; awardFrame = frameNo(); }
    }
    if ((p.multiplier || 1) >= 3) play('scoreTick', { multiplier: p.multiplier, volume: p.reason === 'glowcap' ? 0.6 : 1 });
  });
  on('pickup:berry', (p) => play('berry', { position: posOf(p) }));
  on('tonic:start', ({ kind }) => play('tonicStart', { kind }));
  on('tonic:warning', ({ remaining }) => play('tonicWarn', { remaining }));
  on('tonic:end', ({ kind }) => play('tonicEnd', { kind }));
  on('cage:freed', (p) => play('cageFreed', { position: posOf(p) }));
  on('cage:hit', (p) => play('cageHit', { position: posOf(p) }));       // pickups extra event
  on('pickup:tonic', (p) => play('tonicDrink', { kind: p.kind }));       // pickups extra event (tonic:start adds the jingle)
  on('tonic:respawn', (p) => play('tonicRespawn', { position: posOf(p) }));
  on('checkpoint:reached', () => play('checkpoint'));

  // --- level mechanisms
  on('gate:open', (p) => play(/lantern/i.test(String(p.id || '')) ? 'lanternRise' : 'gateOpen', { position: posOf(p) }));
  on('gate:close', (p) => play('gateClose', { position: posOf(p) }));
  on('arena:lock', () => play('arenaLock'));
  on('arena:clear', () => play('arenaClear'));
  on('level:bounce', (p) => play('bounce', { position: posOf(p) }));
  on('ui:message', () => play('hint'));

  ctx.addSystem({
    order: 90,
    update() {
      // a glowcap whose score:award never came (score finished / zero points): chime anyway
      if (pendingGlow) { pendingGlow = false; glow(ctx.score && ctx.score.chain ? ctx.score.chain : 1); }
    },
    frame() { try { I.frame(); } catch (e) { audio.stats.errors++; audio.stats.lastError = String(e && e.message || e); } },
  });
}
