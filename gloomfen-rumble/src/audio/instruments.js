// Music instruments. Each voice is (core, dest, t, midi, dur, vel) -> end time and schedules
// short-lived nodes into `dest` (a part bus). Pitched voices take a MIDI note; drums ignore it.
// Shared per-part effects (accordion bellows LFO, banjo body resonance...) live in PART_FX and
// are built once per track instance by the sequencer.
import { mtof, pluck, perc, adsr, glide } from './synth.js';

const clampF = (f) => Math.min(18000, Math.max(20, f));

function osc(ac, type, f, det = 0) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = f;
  if (det) o.detune.value = det;
  return o;
}
function gainNode(ac, v = 0) { const g = ac.createGain(); g.gain.value = v; return g; }
function biquad(ac, type, f, Q = 0.7, gain = 0) {
  const b = ac.createBiquadFilter();
  b.type = type; b.frequency.value = clampF(f); b.Q.value = Q;
  if (gain) b.gain.value = gain;
  return b;
}
function noiseSrc(core, color = 'white') {
  const s = core.ac.createBufferSource();
  s.buffer = core.noise[color];
  s.loop = true;
  return s;
}
function startStop(src, t, end, offset) {
  if (offset !== undefined) src.start(t, offset); else src.start(t);
  src.stop(end + 0.02);
}

// ---------------------------------------------------------------------------
// Pitched voices
function pluckVoice(kind, ring) {
  return (core, dest, t, midi, dur, vel) => {
    const ac = core.ac;
    const { buffer, rate } = pluck(ac, kind, midi);
    const s = ac.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const g = gainNode(ac, vel);
    // damp after the written duration (strings are muted for staccato notes) but let short notes ring a bit
    const damp = t + Math.max(dur, ring);
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, damp, 0.07);
    s.connect(g); g.connect(dest);
    const end = Math.min(t + buffer.duration / rate, damp + 0.4);
    startStop(s, t, end);
    return end;
  };
}

/** Round tuba: saw + triangle, lowpass with a quick "blat" opening, slight pitch scoop. */
function tuba(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const o1 = osc(ac, 'sawtooth', f), o2 = osc(ac, 'triangle', f, 4);
  glide(o1.frequency, t, f * 0.975, f, 0.05);
  glide(o2.frequency, t, f * 0.975, f, 0.05);
  const lp = biquad(ac, 'lowpass', f * 1.3, 1.6);
  lp.frequency.setValueAtTime(clampF(f * 1.3), t);
  lp.frequency.exponentialRampToValueAtTime(clampF(Math.min(2200, f * 6)), t + 0.035);
  lp.frequency.setTargetAtTime(clampF(f * 2.4), t + 0.04, 0.09);
  const m1 = gainNode(ac, 0.45), m2 = gainNode(ac, 0.8);
  const g = gainNode(ac, 0);
  o1.connect(m1); o2.connect(m2); m1.connect(lp); m2.connect(lp); lp.connect(g); g.connect(dest);
  const end = adsr(g.gain, t, vel, dur, 0.018, 0.12, 0.72, 0.07);
  startStop(o1, t, end); startStop(o2, t, end);
  return end;
}

/** Brassy horn: two detuned saws through an opening lowpass. */
function horn(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const o1 = osc(ac, 'sawtooth', f, -5), o2 = osc(ac, 'sawtooth', f, 6);
  const lp = biquad(ac, 'lowpass', f, 1.2);
  lp.frequency.setValueAtTime(clampF(f * 1.1), t);
  lp.frequency.exponentialRampToValueAtTime(clampF(Math.min(5200, f * (4 + vel * 3))), t + 0.06);
  lp.frequency.setTargetAtTime(clampF(Math.min(3600, f * 3)), t + 0.07, 0.15);
  const g = gainNode(ac, 0);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
  const end = adsr(g.gain, t, vel * 0.5, dur, 0.035, 0.2, 0.8, 0.12);
  startStop(o1, t, end); startStop(o2, t, end);
  return end;
}

/** Marimba: sine + tuned 4th partial with a fast decay and a soft mallet click. */
function marimba(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const d = Math.min(0.9, Math.max(0.22, 0.9 - (midi - 60) * 0.022));
  const o1 = osc(ac, 'sine', f), o2 = osc(ac, 'sine', f * 3.99), o3 = osc(ac, 'sine', f * 9.8);
  const g1 = gainNode(ac), g2 = gainNode(ac), g3 = gainNode(ac);
  const end = perc(g1.gain, t, vel * 0.7, 0.004, d);
  perc(g2.gain, t, vel * 0.13, 0.003, d * 0.18);
  perc(g3.gain, t, vel * 0.03, 0.002, 0.025);
  o1.connect(g1); o2.connect(g2); o3.connect(g3);
  g1.connect(dest); g2.connect(dest); g3.connect(dest);
  startStop(o1, t, end); startStop(o2, t, t + d * 0.3); startStop(o3, t, t + 0.05);
  return end;
}

/** Kalimba: sine with a slight pitch settle + inharmonic tine overtone. */
function kalimba(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const d = Math.min(1.2, Math.max(0.35, 1.2 - (midi - 60) * 0.025));
  const o1 = osc(ac, 'sine', f), o2 = osc(ac, 'sine', f * 6.27);
  glide(o1.frequency, t, f * 1.012, f, 0.04);
  const g1 = gainNode(ac), g2 = gainNode(ac);
  const end = perc(g1.gain, t, vel * 0.62, 0.002, d);
  perc(g2.gain, t, vel * 0.12, 0.001, 0.06);
  o1.connect(g1); o2.connect(g2); g1.connect(dest); g2.connect(dest);
  startStop(o1, t, end); startStop(o2, t, t + 0.1);
  return end;
}

/** Glockenspiel / music-box bell: bar-mode partials. */
function glock(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const ratios = [1, 2.76, 5.4], gains = [0.5, 0.16, 0.06], decs = [1.1, 0.35, 0.12];
  let end = t;
  for (let i = 0; i < 3; i++) {
    const o = osc(ac, 'sine', f * ratios[i]);
    const g = gainNode(ac);
    const e = perc(g.gain, t, vel * gains[i], 0.0015, decs[i]);
    o.connect(g); g.connect(dest);
    startStop(o, t, e);
    if (e > end) end = e;
  }
  return end;
}

/** Wheezy accordion reed: two detuned saws + a quiet square an octave down (bellows LFO is per part). */
function accordion(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const o1 = osc(ac, 'sawtooth', f, -9), o2 = osc(ac, 'sawtooth', f, 8), o3 = osc(ac, 'square', f * 0.5);
  const m3 = gainNode(ac, 0.22);
  const g = gainNode(ac, 0);
  o1.connect(g); o2.connect(g); o3.connect(m3); m3.connect(g); g.connect(dest);
  const end = adsr(g.gain, t, vel * 0.28, dur, 0.05, 0.15, 0.85, 0.1);
  startStop(o1, t, end); startStop(o2, t, end); startStop(o3, t, end);
  return end;
}

/** Clarinet-ish lead: square through a tracking lowpass, delayed vibrato, breathy onset. */
function clarinet(core, dest, t, midi, dur, vel) {
  const ac = core.ac, f = mtof(midi);
  const o = osc(ac, 'square', f);
  const lp = biquad(ac, 'lowpass', Math.min(4200, f * 3.4), 0.9);
  const g = gainNode(ac, 0);
  o.connect(lp); lp.connect(g); g.connect(dest);
  const end = adsr(g.gain, t, vel * 0.32, dur, 0.035, 0.2, 0.82, 0.07);
  if (dur > 0.22) {
    const l = osc(ac, 'sine', 5.3);
    const lg = gainNode(ac, 0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + 0.16);
    lg.gain.linearRampToValueAtTime(13, t + Math.min(dur, 0.6));
    l.connect(lg); lg.connect(o.detune);
    startStop(l, t, end);
  }
  // breath chiff
  const n = noiseSrc(core, 'pink');
  const bp = biquad(ac, 'bandpass', Math.min(5000, f * 3), 1.2);
  const ng = gainNode(ac);
  perc(ng.gain, t, vel * 0.06, 0.01, 0.07);
  n.connect(bp); bp.connect(ng); ng.connect(dest);
  startStop(n, t, t + 0.1, Math.random() * 1.5);
  startStop(o, t, end);
  return end;
}

// ---------------------------------------------------------------------------
// Drums (midi ignored)
function kick(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const o = osc(ac, 'sine', 140);
  glide(o.frequency, t, 140, 46, 0.09);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.85, 0.002, 0.28);
  o.connect(g); g.connect(dest);
  startStop(o, t, end);
  const n = noiseSrc(core);
  const lp = biquad(ac, 'lowpass', 2500);
  const ng = gainNode(ac);
  perc(ng.gain, t, vel * 0.15, 0.0005, 0.008);
  n.connect(lp); lp.connect(ng); ng.connect(dest);
  startStop(n, t, t + 0.02, Math.random());
  return end;
}
function snare(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const n = noiseSrc(core);
  const bp = biquad(ac, 'bandpass', 3000, 0.55);
  const ng = gainNode(ac);
  const end = perc(ng.gain, t, vel * 0.5, 0.001, 0.13);
  n.connect(bp); bp.connect(ng); ng.connect(dest);
  startStop(n, t, end, Math.random() * 1.5);
  const o = osc(ac, 'triangle', 195);
  glide(o.frequency, t, 195, 160, 0.06);
  const g = gainNode(ac);
  perc(g.gain, t, vel * 0.45, 0.001, 0.07);
  o.connect(g); g.connect(dest);
  startStop(o, t, t + 0.09);
  return end;
}
function brush(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const n = noiseSrc(core);
  const bp = biquad(ac, 'bandpass', 3800, 0.7);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.3, 0.014, 0.11);
  n.connect(bp); bp.connect(g); g.connect(dest);
  startStop(n, t, end, Math.random() * 1.5);
  return end;
}
function hat(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const n = noiseSrc(core);
  const hp = biquad(ac, 'highpass', 7000, 0.7);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.22, 0.001, 0.035);
  n.connect(hp); hp.connect(g); g.connect(dest);
  startStop(n, t, end, Math.random() * 1.5);
  return end;
}
function shaker(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const n = noiseSrc(core);
  const hp = biquad(ac, 'highpass', 5200, 0.7);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.2, 0.018, 0.05);
  n.connect(hp); hp.connect(g); g.connect(dest);
  startStop(n, t, end, Math.random() * 1.5);
  return end;
}
function woodblock(freq) {
  return (core, dest, t, _m, _d, vel) => {
    const ac = core.ac;
    const o = osc(ac, 'sine', freq);
    glide(o.frequency, t, freq, freq * 0.95, 0.03);
    const g = gainNode(ac);
    const end = perc(g.gain, t, vel * 0.42, 0.001, 0.07);
    o.connect(g); g.connect(dest);
    startStop(o, t, end);
    const n = noiseSrc(core);
    const bp = biquad(ac, 'bandpass', freq * 2.1, 5);
    const ng = gainNode(ac);
    perc(ng.gain, t, vel * 0.25, 0.0005, 0.012);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    startStop(n, t, t + 0.03, Math.random());
    return end;
  };
}
/** Bog frog: buzzy square with a falling pitch, chopped at ~30 Hz, through a throat formant. */
function frog(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const o = osc(ac, 'square', 150);
  glide(o.frequency, t, 152, 104, 0.13);
  const bp = biquad(ac, 'bandpass', 640, 3.5);
  const am = gainNode(ac, 0.5);
  const l = osc(ac, 'square', 31);
  const lg = gainNode(ac, 0.5);
  l.connect(lg); lg.connect(am.gain);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.55, 0.006, 0.07, 0.06);
  o.connect(bp); bp.connect(am); am.connect(g); g.connect(dest);
  startStop(o, t, end); startStop(l, t, end);
  return end;
}
/** Water droplet "plip": a fast upward sine sweep. */
function drop(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const o = osc(ac, 'sine', 480);
  glide(o.frequency, t, 480, 1500, 0.045);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.32, 0.001, 0.075);
  o.connect(g); g.connect(dest);
  startStop(o, t, end);
  return end;
}
/** Dented tin pot: inharmonic partials, short. The bandits' backbeat. */
function pot(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const fr = [530, 1255, 2190], gs = [0.26, 0.15, 0.09], ds = [0.2, 0.09, 0.05];
  let end = t;
  for (let i = 0; i < 3; i++) {
    const o = osc(ac, i === 0 ? 'triangle' : 'sine', fr[i]);
    const g = gainNode(ac);
    const e = perc(g.gain, t, vel * gs[i], 0.001, ds[i]);
    o.connect(g); g.connect(dest);
    startStop(o, t, e);
    end = Math.max(end, e);
  }
  return end;
}
/** Timpani-ish boom. */
function boom(core, dest, t, _m, _d, vel) {
  const ac = core.ac;
  const o = osc(ac, 'sine', 96);
  glide(o.frequency, t, 100, 72, 0.25);
  const g = gainNode(ac);
  const end = perc(g.gain, t, vel * 0.8, 0.003, 0.85);
  o.connect(g); g.connect(dest);
  startStop(o, t, end);
  const o2 = osc(ac, 'triangle', 188);
  const g2 = gainNode(ac);
  perc(g2.gain, t, vel * 0.2, 0.002, 0.2);
  o2.connect(g2); g2.connect(dest);
  startStop(o2, t, t + 0.25);
  const n = noiseSrc(core, 'brown');
  const lp = biquad(ac, 'lowpass', 380);
  const ng = gainNode(ac);
  perc(ng.gain, t, vel * 0.5, 0.002, 0.16);
  n.connect(lp); lp.connect(ng); ng.connect(dest);
  startStop(n, t, t + 0.2, Math.random());
  return end;
}

export const INSTRUMENTS = {
  banjo: pluckVoice('banjo', 0.16),
  harp: pluckVoice('harp', 0.9),
  tuba,
  horn,
  marimba,
  kalimba,
  glock,
  accordion,
  clarinet,
  // drums
  kick, snare, brush, hat, shaker, frog, drop, pot, boom,
  wbHi: woodblock(1180),
  wbLo: woodblock(790),
};

/** Drum lane letters used in track patterns. */
export const KIT = { k: 'kick', s: 'snare', b: 'brush', h: 'hat', z: 'shaker', w: 'wbHi', W: 'wbLo', f: 'frog', d: 'drop', p: 'pot', t: 'boom' };

/** Instruments rendered from cached Karplus-Strong buffers (pre-warmed by the engine). */
export const PLUCKED = new Set(['banjo', 'harp']);

/**
 * Per-part effect chains, built once per track instance. Returns { input, nodes:[...], lfos:[...] };
 * the chain's output is already connected to `out`.
 */
export const PART_FX = {
  accordion(ac, out) {
    const lp = biquad(ac, 'lowpass', 2300, 0.6);
    const reed = biquad(ac, 'peaking', 1150, 1.1, 3);
    const trem = gainNode(ac, 0.85);
    // wheeze (fast, shallow) + bellows (slow, deeper)
    const l1 = osc(ac, 'sine', 5.6), l1g = gainNode(ac, 0.06);
    const l2 = osc(ac, 'sine', 0.27), l2g = gainNode(ac, 0.12);
    l1.connect(l1g); l1g.connect(trem.gain);
    l2.connect(l2g); l2g.connect(trem.gain);
    lp.connect(reed); reed.connect(trem); trem.connect(out);
    return { input: lp, nodes: [lp, reed, trem, l1g, l2g], lfos: [l1, l2] };
  },
  banjo(ac, out) {
    const hp = biquad(ac, 'highpass', 140, 0.7);
    const body = biquad(ac, 'peaking', 1500, 1.3, 5);
    hp.connect(body); body.connect(out);
    return { input: hp, nodes: [hp, body], lfos: [] };
  },
  tuba(ac, out) {
    const lp = biquad(ac, 'lowpass', 1400, 0.6);
    lp.connect(out);
    return { input: lp, nodes: [lp], lfos: [] };
  },
};
