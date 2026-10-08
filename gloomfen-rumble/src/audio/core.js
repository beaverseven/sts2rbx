// AudioCore: the node graph + sfx voices + music players for one BaseAudioContext.
// Used by the realtime engine (audio.js) and by offline renders (OfflineAudioContext) alike.
//
// Graph:
//   track parts -> track gain -> musicIn(hide) -> musicDuck -> musicFilter -> musicVol --\
//   music reverb (convolver) -> musicIn                                                  +-> master -> compressor -> [pre 0.5 -> soft clip] -> destination
//   voices -> [pan] -> sfxIn -> sfxVol -------------------------------------------------/
//   voices -> send -> sfx reverb (convolver) -> sfxVol
import { buffers, impulse, softClipCurve, pluck, hasPluck } from './synth.js';
import { SFX, ALIASES } from './sfx.js';
import { compileTrack, TrackPlayer, notesUsed } from './sequencer.js';
import { PLUCKED } from './instruments.js';
import { TRACKS } from './tracks.js';

/** Slider value (0..1) -> gain. Slightly curved so the low half of a slider is usable. */
export const volumeGain = (v) => (v > 0 ? Math.pow(Math.min(1, v), 1.5) : 0);
/** Fixed bus trims: the music is mixed hot inside the tracks, this keeps it under the sfx. */
export const MUSIC_TRIM = 0.56;
export const SFX_TRIM = 1;

const compiledCache = new Map();
export function compiled(name) {
  let c = compiledCache.get(name);
  if (!c && TRACKS[name]) { c = compileTrack(TRACKS[name]); compiledCache.set(name, c); }
  return c || null;
}

/** Per-play builder handed to sfx recipes. */
export class Voice {
  constructor(core, t, out, pitch) {
    this.core = core;
    this.ac = core.ac;
    this.t = t;
    this.out = out;
    this.p = pitch;
    this.end = t;
    this.last = null;
  }
  /** Start/stop a source node and remember the one that ends last (for cleanup). */
  run(src, t, end, offset) {
    if (offset !== undefined) src.start(t, offset); else src.start(t);
    src.stop(end);
    if (end >= this.end) { this.end = end; this.last = src; }
    return src;
  }
  rand() { return Math.random(); }
}

export class AudioCore {
  /**
   * @param {BaseAudioContext} ac
   * @param {object} opts { volumes:{master,music,sfx}, clip=true (final soft clipper), dest (default ac.destination) }
   */
  constructor(ac, opts = {}) {
    this.ac = ac;
    this.noise = buffers(ac);
    this.curves = new Map();
    const vol = opts.volumes || { master: 1, music: 1, sfx: 1 };
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    const out = opts.dest || ac.destination; // offline measurement may insert filters here

    // master chain
    this.master = g(volumeGain(vol.master));
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp);
    if (opts.clip !== false) {
      this.pre = g(0.5);
      this.clip = ac.createWaveShaper();
      this.clip.curve = softClipCurve();
      this.comp.connect(this.pre); this.pre.connect(this.clip); this.clip.connect(out);
    } else {
      this.comp.connect(out);
    }

    // music
    this.musicVol = g(volumeGain(vol.music) * MUSIC_TRIM);
    this.musicVol.connect(this.master);
    this.musicFilter = ac.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.5;
    this.musicFilter.connect(this.musicVol);
    this.musicDuck = g(1);
    this.musicDuck.connect(this.musicFilter);
    this.musicIn = g(1); // hidden-tab mute lives here
    this.musicIn.connect(this.musicDuck);
    this.musicVerb = ac.createConvolver();
    this.musicVerb.normalize = false;
    this.musicVerb.buffer = impulse(ac, 2.4, { seed: 11 });
    this.musicVerbOut = g(0.55);
    this.musicVerb.connect(this.musicVerbOut);
    this.musicVerbOut.connect(this.musicIn);

    // sfx
    this.sfxVol = g(volumeGain(vol.sfx) * SFX_TRIM);
    this.sfxVol.connect(this.master);
    this.sfxIn = g(1);
    this.sfxIn.connect(this.sfxVol);
    this.sfxVerb = ac.createConvolver();
    this.sfxVerb.normalize = false;
    this.sfxVerb.buffer = impulse(ac, 1.5, { seed: 5, bright: 0.7 });
    this.sfxVerbOut = g(0.6);
    this.sfxVerb.connect(this.sfxVerbOut);
    this.sfxVerbOut.connect(this.sfxVol);
    this.loopBus = g(1); // continuous loops (glide wind, charge hum); muted when not playing
    this.loopBus.connect(this.sfxIn);

    this.hasPanner = typeof ac.createStereoPanner === 'function';
    this.players = [];   // TrackPlayers (current + fading)
    this.current = null; // current TrackPlayer or null
    this.voices = [];    // { name, end }
    this.loops = {};
  }

  curve(key, make) {
    let c = this.curves.get(key);
    if (!c) { c = make(); this.curves.set(key, c); }
    return c;
  }

  setVolumes(v, t = this.ac.currentTime, tau = 0.05) {
    if (v.master !== undefined) this.master.gain.setTargetAtTime(volumeGain(v.master), t, tau);
    if (v.music !== undefined) this.musicVol.gain.setTargetAtTime(volumeGain(v.music) * MUSIC_TRIM, t, tau);
    if (v.sfx !== undefined) this.sfxVol.gain.setTargetAtTime(volumeGain(v.sfx) * SFX_TRIM, t, tau);
  }

  // ------------------------------------------------------------------ sfx
  static resolve(name) { return SFX[name] ? name : (ALIASES[name] && SFX[ALIASES[name]] ? ALIASES[name] : null); }

  /** Count live voices (prunes finished ones). */
  liveVoices(now, name) {
    const vs = this.voices;
    let n = 0;
    for (let i = vs.length - 1; i >= 0; i--) {
      if (vs[i].end <= now) { vs.splice(i, 1); continue; }
      if (!name || vs[i].name === name) n++;
    }
    return n;
  }

  /**
   * Play an sfx recipe at time t. opts: { volume, pitch, pan (-1..1), wet, params }.
   * Returns { name, end, stop(fade) } or null if the name is unknown.
   */
  playSfx(name, t, opts = {}) {
    const def = SFX[name];
    if (!def) return null;
    const ac = this.ac;
    const out = ac.createGain();
    out.gain.value = (opts.volume ?? 1) * (def.vol ?? 1);
    let tail = out;
    if (opts.pan && this.hasPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      out.connect(p);
      tail = p;
    }
    tail.connect(opts.dest || this.sfxIn);
    const wet = opts.wet ?? def.wet ?? 0.12;
    let send = null;
    if (wet > 0) { send = ac.createGain(); send.gain.value = wet; tail.connect(send); send.connect(this.sfxVerb); }
    const v = new Voice(this, t, out, opts.pitch ?? 1);
    try { def.fn(v, opts.params || {}); } catch (e) {
      out.disconnect(); if (tail !== out) tail.disconnect(); if (send) send.disconnect();
      throw e; // counted by the caller (audio.play never throws)
    }
    const end = v.end;
    if (v.last) {
      v.last.onended = () => { out.disconnect(); if (tail !== out) tail.disconnect(); if (send) send.disconnect(); };
    }
    this.voices.push({ name, end });
    return {
      name, end,
      stop(fade = 0.05) {
        const now = ac.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0, now + fade);
      },
    };
  }

  // ------------------------------------------------------------------ continuous loops
  /**
   * Start a named continuous loop (idempotent). Kinds:
   *   'glide'  airy wind under the leaf parasol: loop.set(speed m/s, rise: updraft jet)
   *   'charge' rising hum while a throw charges: loop.set(level 0..1)
   */
  startLoop(kind, t = this.ac.currentTime) {
    if (this.loops[kind]) return this.loops[kind];
    const ac = this.ac;
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(this.loopBus);
    const nodes = [out], srcs = [];
    let loop;
    if (kind === 'glide') {
      const n = ac.createBufferSource(); n.buffer = this.noise.pink; n.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
      const b = ac.createBufferSource(); b.buffer = this.noise.brown; b.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const bg = ac.createGain(); bg.gain.value = 0.7;
      const flutter = ac.createOscillator(); flutter.frequency.value = 0.7;
      const fg = ac.createGain(); fg.gain.value = 120;
      flutter.connect(fg); fg.connect(bp.frequency);
      n.connect(bp); bp.connect(out); b.connect(lp); lp.connect(bg); bg.connect(out);
      n.start(t, Math.random()); b.start(t, Math.random()); flutter.start(t);
      srcs.push(n, b, flutter); nodes.push(bp, lp, bg, fg);
      out.gain.setTargetAtTime(0.16, t, 0.08);
      loop = {
        kind, out,
        set(speed = 0, rise = false) {
          const now = ac.currentTime;
          bp.frequency.setTargetAtTime(rise ? 1500 : 600 + speed * 70, now, 0.15);
          out.gain.setTargetAtTime(rise ? 0.22 : 0.11 + Math.min(1, speed / 8) * 0.08, now, 0.15);
        },
      };
    } else if (kind === 'charge') {
      const o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 190;
      const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 190; o2.detune.value = 9;
      const o3 = ac.createOscillator(); o3.type = 'sine'; o3.frequency.value = 380;
      const m3 = ac.createGain(); m3.gain.value = 0.3;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
      const trem = ac.createGain(); trem.gain.value = 0.8;
      const l = ac.createOscillator(); l.frequency.value = 6;
      const lg = ac.createGain(); lg.gain.value = 0.2;
      l.connect(lg); lg.connect(trem.gain);
      o1.connect(lp); o2.connect(lp); o3.connect(m3); m3.connect(lp); lp.connect(trem); trem.connect(out);
      for (const o of [o1, o2, o3, l]) { o.start(t); srcs.push(o); }
      nodes.push(m3, lp, trem, lg);
      out.gain.setTargetAtTime(0.07, t, 0.05);
      loop = {
        kind, out,
        set(level = 0) {
          const now = ac.currentTime;
          const f = 190 * Math.pow(2, level * 1.0);
          o1.frequency.setTargetAtTime(f, now, 0.03);
          o2.frequency.setTargetAtTime(f, now, 0.03);
          o3.frequency.setTargetAtTime(f * 2, now, 0.03);
          l.frequency.setTargetAtTime(6 + level * 12, now, 0.05);
          lp.frequency.setTargetAtTime(1200 + level * 2200, now, 0.05);
          out.gain.setTargetAtTime(0.05 + level * 0.05, now, 0.05);
        },
      };
    } else {
      out.disconnect();
      return null;
    }
    loop.stop = (fade = 0.12) => {
      if (this.loops[kind] !== loop) return;
      delete this.loops[kind];
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, fade / 3);
      const end = now + fade * 2 + 0.05;
      for (const s of srcs) s.stop(end);
      srcs[0].onended = () => { for (const nd of nodes) nd.disconnect(); for (const s of srcs) s.disconnect(); };
    };
    this.loops[kind] = loop;
    return loop;
  }

  stopLoop(kind, fade) { const l = this.loops[kind]; if (l) l.stop(fade); }

  // ------------------------------------------------------------------ music
  /** Plucked-string buffers a track needs (so they can be rendered ahead of time). */
  static pluckJobs(names) {
    const jobs = [];
    for (const n of names) { const c = compiled(n); if (c) jobs.push(...notesUsed(c, PLUCKED)); }
    return jobs;
  }
  warmPlucks(jobs, max = 4) {
    let done = 0;
    while (jobs.length && done < max) { const [inst, midi] = jobs.shift(); if (!hasPluck(this.ac, inst, midi)) { pluck(this.ac, inst, midi); done++; } }
    return jobs.length;
  }

  /**
   * Crossfade to a track (name or null for silence) starting at t. The previous track fades out
   * over `fade` seconds and is disposed once silent; a track that is still fading out is revived
   * instead of restarted.
   */
  setTrack(name, t = this.ac.currentTime, fade = 1.5) {
    const cur = this.current;
    if (cur && cur.name === name) return cur;
    if (cur) cur.fadeOut(t, fade);
    if (!name) { this.current = null; return null; }
    const fading = this.players.find((p) => p.name === name && !p.disposed && p.stopAt !== Infinity);
    if (fading) { fading.revive(t, fade); this.current = fading; return fading; }
    const c = compiled(name);
    if (!c) { this.current = null; return null; }
    const p = new TrackPlayer(this, c);
    p.start(t + 0.03, cur ? fade : 0.4);
    this.players.push(p);
    this.current = p;
    return p;
  }

  /** Schedule all players up to `horizon`; dispose players whose fade-out finished. */
  scheduleMusic(now, horizon, mute = false) {
    let notes = 0;
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.stopAt <= now) { p.dispose(); this.players.splice(i, 1); continue; }
      notes += p.schedule(now, horizon, mute);
    }
    return notes;
  }

  stopAllMusic() {
    for (const p of this.players) p.dispose();
    this.players.length = 0;
    this.current = null;
  }
}
