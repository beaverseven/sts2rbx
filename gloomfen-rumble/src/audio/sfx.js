// Sound-effect recipes. Every sound is synthesized when played.
//
// SFX[name] = { fn(v, prm), vary, gap, max, ref, wet, vol }
//   fn       builds the sound with the Voice `v` (see core.js) starting at v.t; prm = play() params
//   vary     random pitch spread (fraction, ±); default 0.04
//   gap      min seconds between two plays of this name (duplicates dropped); default 0.03
//   max      max simultaneous voices of this name (oldest-first stealing is not needed: extra plays drop)
//   ref      distance (m) under which a positioned sound is at full volume; default 7
//   wet      reverb send; default 0.12
//   vol      overall trim
//
// Helpers (times are offsets from the voice start, frequencies are scaled by v.p = pitch):
//   tone(v, {t, type, f, f1, ft, pts, a, h, d, g, filt, vib, am, det, fixed, to})
//   nz(v, {t, color, a, h, d, g, filt, filt2, am, to})
//   bell(v, {t, f, ratios, gains, d, g, a, fixed, to})
//   croak(v, {t, type, pts, a, h, d, g, formants, am, drive, to})
import { mtof, perc, contour, glide, driveCurve } from './synth.js';

const clampF = (f) => Math.min(19000, Math.max(20, f));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---------------------------------------------------------------------------
// Builders
function filterFrom(v, spec, t) {
  const f = v.ac.createBiquadFilter();
  f.type = spec.type || 'lowpass';
  const p = spec.fixed === false ? v.p : 1;
  if (spec.pts) contour(f.frequency, t, spec.pts, p);
  else if (spec.f1) glide(f.frequency, t + (spec.at || 0), clampF(spec.f * p), clampF(spec.f1 * p), spec.ft || 0.1);
  else f.frequency.setValueAtTime(clampF(spec.f * p), t);
  f.Q.value = spec.Q ?? (f.type === 'bandpass' ? 1.5 : 0.7);
  if (spec.gain) f.gain.value = spec.gain;
  return f;
}

function addAM(v, node, t, end, am) {
  // am = [rate, depth, type?, rateEnd?]
  const g = v.ac.createGain();
  g.gain.value = 1 - am[1];
  const l = v.ac.createOscillator();
  l.type = am[2] || 'sine';
  if (am[3]) glide(l.frequency, t, am[0], am[3], end - t);
  else l.frequency.value = am[0];
  const lg = v.ac.createGain();
  lg.gain.value = am[1];
  l.connect(lg); lg.connect(g.gain);
  node.connect(g);
  v.run(l, t, end);
  return g;
}

export function tone(v, o) {
  const ac = v.ac, t = v.t + (o.t || 0);
  const a = o.a ?? 0.003, h = o.h ?? 0, d = o.d ?? 0.2;
  const end = t + a + h + d + 0.01;
  const osc = ac.createOscillator();
  osc.type = o.type || 'sine';
  const p = o.fixed ? 1 : v.p;
  if (o.pts) contour(osc.frequency, t, o.pts, p);
  else if (o.f1) glide(osc.frequency, t + (o.fat || 0), o.f * p, o.f1 * p, o.ft ?? a + h + d);
  else osc.frequency.setValueAtTime(o.f * p, t);
  if (o.det) osc.detune.value = o.det;
  let node = osc;
  if (o.vib) {
    const l = ac.createOscillator();
    l.frequency.value = o.vib[0];
    const lg = ac.createGain();
    lg.gain.setValueAtTime(o.vib[1], t);
    if (o.vib[2]) lg.gain.linearRampToValueAtTime(o.vib[3] ?? 0, t + o.vib[2]);
    l.connect(lg); lg.connect(osc.detune);
    v.run(l, t, end);
  }
  if (o.filt) { const f = filterFrom(v, o.filt, t); node.connect(f); node = f; }
  if (o.am) node = addAM(v, node, t, end, o.am);
  const g = ac.createGain();
  perc(g.gain, t, o.g ?? 0.3, a, d, h);
  node.connect(g);
  g.connect(o.to || v.out);
  v.run(osc, t, end);
  return g;
}

export function nz(v, o) {
  const ac = v.ac, t = v.t + (o.t || 0);
  const a = o.a ?? 0.003, h = o.h ?? 0, d = o.d ?? 0.15;
  const end = t + a + h + d + 0.01;
  const s = ac.createBufferSource();
  s.buffer = v.core.noise[o.color || 'white'];
  s.loop = true;
  if (o.rate) s.playbackRate.value = o.rate;
  let node = s;
  if (o.filt) { const f = filterFrom(v, o.filt, t); node.connect(f); node = f; }
  if (o.filt2) { const f = filterFrom(v, o.filt2, t); node.connect(f); node = f; }
  if (o.am) node = addAM(v, node, t, end, o.am);
  const g = ac.createGain();
  perc(g.gain, t, o.g ?? 0.3, a, d, h);
  node.connect(g);
  g.connect(o.to || v.out);
  v.run(s, t, end, Math.random() * 1.8);
  return g;
}

export function bell(v, o) {
  const ratios = o.ratios || [1, 2.76, 5.4, 8.93];
  const gains = o.gains || [1, 0.4, 0.2, 0.1];
  const g = o.g ?? 0.2, d = o.d ?? 0.8;
  for (let i = 0; i < ratios.length; i++) {
    tone(v, { t: o.t, type: 'sine', f: o.f * ratios[i], a: o.a ?? 0.002, d: d / (1 + i * (o.damp ?? 0.9)), g: g * gains[i], fixed: o.fixed, to: o.to, det: o.det ? o.det * (i % 2 ? 1 : -1) : 0 });
  }
}

/** Voiced sound through parallel formant filters (croaks, roars, squeaks). */
export function croak(v, o) {
  const ac = v.ac, t = v.t + (o.t || 0);
  const a = o.a ?? 0.01, h = o.h ?? 0.1, d = o.d ?? 0.12;
  const end = t + a + h + d + 0.01;
  const osc = ac.createOscillator();
  osc.type = o.type || 'sawtooth';
  contour(osc.frequency, t, o.pts, o.fixed ? 1 : v.p);
  let src = osc;
  if (o.vib) {
    const l = ac.createOscillator(); l.frequency.value = o.vib[0];
    const lg = ac.createGain(); lg.gain.value = o.vib[1];
    l.connect(lg); lg.connect(osc.detune);
    v.run(l, t, end);
  }
  if (o.drive) {
    const ws = ac.createWaveShaper();
    ws.curve = v.core.curve('drive' + o.drive, () => driveCurve(o.drive));
    src.connect(ws); src = ws;
  }
  if (o.am) src = addAM(v, src, t, end, o.am);
  const g = ac.createGain();
  perc(g.gain, t, o.g ?? 0.3, a, d, h);
  for (const fm of o.formants || [[700, 5, 1], [1200, 6, 0.6]]) {
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    if (Array.isArray(fm[0])) contour(f.frequency, t, fm[0]); else f.frequency.value = fm[0];
    f.Q.value = fm[1];
    const fg = ac.createGain();
    fg.gain.value = fm[2] * Math.sqrt(fm[1]) * 0.6; // narrow bands pass little energy: compensate
    src.connect(f); f.connect(fg); fg.connect(g);
  }
  g.connect(o.to || v.out);
  v.run(osc, t, end);
  return g;
}

/** Struck metal: detuned inharmonic partials + an impact transient. */
function metal(v, o) {
  bell(v, { t: o.t, f: o.f, ratios: o.ratios || [1, 2.32, 3.91, 5.37, 7.1], gains: o.gains || [1, 0.7, 0.5, 0.35, 0.2], d: o.d ?? 0.8, g: o.g ?? 0.2, damp: o.damp ?? 0.5, det: 9 });
  nz(v, { t: o.t, a: 0.0008, d: 0.03, g: (o.g ?? 0.2) * 1.4, filt: { type: 'bandpass', f: o.f * 6, Q: 0.9 } });
}

function thud(v, o) {
  tone(v, { t: o.t, f: o.f || 110, f1: o.f1 || 45, ft: o.ft || 0.12, a: 0.002, d: o.d || 0.22, g: o.g || 0.4 });
  nz(v, { t: o.t, color: 'brown', a: 0.002, d: (o.d || 0.22) * 0.7, g: (o.g || 0.4) * 0.8, filt: { type: 'lowpass', f: o.lp || 500 } });
}

function splashCore(v, g = 0.4) {
  nz(v, { a: 0.004, d: 0.4, g, filt: { type: 'bandpass', f: 2600, f1: 650, ft: 0.3, Q: 0.7 } });
  nz(v, { color: 'brown', a: 0.003, d: 0.25, g: g * 0.8, filt: { type: 'lowpass', f: 420 } });
  for (let i = 0; i < 4; i++) tone(v, { t: 0.12 + i * 0.07 + v.rand() * 0.05, f: 380 + v.rand() * 300, f1: 1100 + v.rand() * 500, ft: 0.03, a: 0.002, d: 0.05, g: g * 0.16 });
}

const STEP_SURF = {
  moss(v, g) { nz(v, { color: 'pink', a: 0.004, d: 0.06, g: g * 0.9, filt: { type: 'lowpass', f: 900 } }); tone(v, { f: 95, f1: 60, a: 0.002, d: 0.05, g: g * 0.35 }); },
  mud(v, g) { nz(v, { a: 0.006, d: 0.09, g: g * 0.7, filt: { type: 'bandpass', f: 900, f1: 320, ft: 0.08, Q: 3 } }); tone(v, { f: 140, f1: 90, d: 0.05, g: g * 0.25 }); },
  wood(v, g) { tone(v, { type: 'triangle', f: 210, f1: 170, a: 0.001, d: 0.06, g: g * 0.7 }); nz(v, { a: 0.001, d: 0.02, g: g * 0.4, filt: { type: 'bandpass', f: 1600, Q: 2 } }); },
  stone(v, g) { nz(v, { a: 0.001, d: 0.03, g: g * 0.6, filt: { type: 'highpass', f: 2200 } }); tone(v, { f: 900, f1: 700, a: 0.001, d: 0.025, g: g * 0.15 }); nz(v, { color: 'pink', a: 0.002, d: 0.05, g: g * 0.4, filt: { type: 'lowpass', f: 700 } }); },
  iron(v, g) { bell(v, { f: 1300, ratios: [1, 2.3], gains: [1, 0.5], d: 0.12, g: g * 0.25 }); nz(v, { color: 'pink', a: 0.002, d: 0.05, g: g * 0.4, filt: { type: 'lowpass', f: 800 } }); },
};

// pentatonic-ish chime scale for glowcap chains (G major from G5)
const GLOW_SCALE = [0, 2, 4, 5, 7, 9, 11];
export function glowcapMidi(step) {
  const s = Math.max(0, step | 0);
  const capped = s < 14 ? s : 7 + ((s - 14) % 7); // climb two octaves, then sparkle in the top one
  return 79 + GLOW_SCALE[capped % 7] + 12 * Math.floor(capped / 7);
}

const ZONE_HORN = {
  glade: [[60, 0], [67, 0.42], [64, 0.42]],
  bog: [[57, 0], [64, 0.5], [60, 0.5]],
  fort: [[58, 0], [65, 0.3], [70, 0.6]],
  pit: [[40, 0], [46, 0.55]],
  default: [[60, 0], [67, 0.42]],
};

// ---------------------------------------------------------------------------
export const SFX = {
  // ------------------------------------------------------------- Morel
  jump: {
    vary: 0.05, gap: 0.05, max: 3,
    fn(v) {
      tone(v, { type: 'triangle', pts: [[0, 200], [0.07, 520], [0.26, 470]], a: 0.004, h: 0.03, d: 0.22, g: 0.3, vib: [21, 80, 0.25, 0], filt: { type: 'lowpass', f: 2600 } });
      tone(v, { pts: [[0, 400], [0.07, 1040], [0.2, 950]], a: 0.004, d: 0.13, g: 0.08 });
      nz(v, { a: 0.002, d: 0.06, g: 0.08, filt: { type: 'bandpass', f: 1800, Q: 0.8 } });
    },
  },
  land: {
    vary: 0.05, vol: 0.8, gap: 0.06, max: 2,
    fn(v, prm) {
      const k = clamp01(((prm.impact ?? 8) - 2) / 18);
      tone(v, { f: 120 - 40 * k, f1: 42, ft: 0.12, a: 0.002, d: 0.14 + 0.14 * k, g: 0.3 + 0.35 * k });
      nz(v, { color: 'brown', a: 0.002, d: 0.08 + 0.12 * k, g: 0.25 + 0.3 * k, filt: { type: 'lowpass', f: 500 + 700 * k } });
      nz(v, { color: 'pink', a: 0.003, d: 0.07, g: 0.06 + 0.1 * k, filt: { type: 'bandpass', f: 1400, Q: 0.8 } });
    },
  },
  glideOpen: {
    vary: 0.06, vol: 2.0, gap: 0.15,
    fn(v) {
      for (let i = 0; i < 3; i++) nz(v, { t: i * 0.045, a: 0.004, d: 0.05, g: 0.24 - i * 0.05, filt: { type: 'bandpass', f: 1400 - i * 220, Q: 1.3 } });
      nz(v, { color: 'pink', t: 0.04, a: 0.07, d: 0.35, g: 0.24, filt: { type: 'bandpass', f: 450, f1: 1200, ft: 0.3, Q: 0.9 } });
    },
  },
  glideClose: {
    vary: 0.06, vol: 2.5, gap: 0.15,
    fn(v) {
      for (let i = 0; i < 2; i++) nz(v, { t: i * 0.05, a: 0.004, d: 0.045, g: 0.12 - i * 0.04, filt: { type: 'bandpass', f: 1100 - i * 200, Q: 1.3 } });
    },
  },
  throw: {
    vary: 0.07, vol: 1.4, gap: 0.04, max: 4,
    fn(v, prm) {
      const c = prm.charge || 0, kind = prm.kind || 'puff';
      if (kind === 'iron') {
        nz(v, { color: 'pink', a: 0.01, d: 0.22 + 0.1 * c, g: 0.38, filt: { type: 'bandpass', f: 300, f1: 1100, ft: 0.18, Q: 1.2 } });
        tone(v, { type: 'triangle', f: 180, f1: 115, ft: 0.15, a: 0.003, d: 0.15, g: 0.2 });
        bell(v, { t: 0.01, f: 1250, ratios: [1, 2.41], gains: [1, 0.4], d: 0.3, g: 0.05 });
      } else if (kind === 'seeker') {
        for (let i = 0; i < 3; i++) {
          nz(v, { t: i * 0.035, a: 0.008, d: 0.14, g: 0.15, filt: { type: 'bandpass', f: 900 + i * 300, f1: 3200 + i * 400, ft: 0.14, Q: 1.5 } });
          tone(v, { t: i * 0.035, f: 1400 + i * 350, f1: 2100 + i * 500, ft: 0.1, a: 0.003, d: 0.12, g: 0.045 });
        }
      } else {
        nz(v, { a: 0.008, d: 0.16 + 0.12 * c, g: 0.3 + 0.12 * c, filt: { type: 'bandpass', f: 600, f1: 2200 + 1200 * c, ft: 0.15, Q: 1.3 } });
        tone(v, { f: 320 + 200 * c, f1: 640 + 300 * c, ft: 0.08, a: 0.003, d: 0.08, g: 0.08 });
      }
      if (c > 0.5) nz(v, { color: 'brown', a: 0.01, d: 0.3, g: 0.32 * c, filt: { type: 'lowpass', f: 420 } });
    },
  },
  chargeFull: {
    vary: 0, gap: 0.2,
    fn(v) {
      bell(v, { f: 1568, ratios: [1, 2.0, 3.01, 4.2], gains: [1, 0.35, 0.2, 0.1], d: 0.6, g: 0.15 });
      tone(v, { t: 0.05, f: 3136, a: 0.01, d: 0.3, g: 0.03, vib: [9, 30] });
    },
  },
  hurt: {
    vary: 0.06, gap: 0.2,
    fn(v) {
      croak(v, { type: 'triangle', pts: [[0, 690], [0.06, 1060], [0.24, 560]], a: 0.005, h: 0.08, d: 0.14, g: 0.32, formants: [[[[0, 650], [0.2, 420]], 3, 1], [[[0, 1100], [0.2, 750]], 4, 0.6], [2700, 6, 0.25]] });
      tone(v, { f: 160, f1: 90, d: 0.08, g: 0.15 });
    },
  },
  died: {
    vary: 0.02, vol: 1.5, gap: 0.5, wet: 0.2,
    fn(v) {
      // splat
      nz(v, { color: 'brown', a: 0.002, d: 0.3, g: 0.45, filt: { type: 'lowpass', f: 650 } });
      nz(v, { a: 0.002, d: 0.2, g: 0.3, filt: { type: 'bandpass', f: 1100, f1: 260, ft: 0.18, Q: 1.6 } });
      // sad "bwaa-aaah": a muted horn that sags and wobbles
      const wah = (t, pts, d, h, g) => croak(v, { t, type: 'sawtooth', pts, a: 0.04, h, d, g, vib: [5.5, 28],
        formants: [[[[0, 380], [0.12, 1100], [h + d, 450]], 2.2, 1], [1400, 3, 0.25]] });
      wah(0.3, [[0, 233], [0.3, 226]], 0.08, 0.3, 0.2);
      wah(0.72, [[0, 220], [0.25, 212], [1.05, 150]], 0.35, 0.85, 0.22);
    },
  },
  respawn: {
    vary: 0.04, gap: 0.3,
    fn(v) {
      tone(v, { pts: [[0, 240], [0.09, 920]], a: 0.002, h: 0.02, d: 0.12, g: 0.3 });
      nz(v, { color: 'pink', a: 0.004, d: 0.12, g: 0.14, filt: { type: 'lowpass', f: 1600 } });
      bell(v, { t: 0.07, f: 1568, ratios: [1, 2.0], gains: [1, 0.3], d: 0.35, g: 0.07 });
      bell(v, { t: 0.13, f: 2093, ratios: [1, 2.0], gains: [1, 0.3], d: 0.35, g: 0.06 });
    },
  },
  step: {
    vary: 0.1, gap: 0.07, max: 2, wet: 0.04, vol: 0.5,
    fn(v, prm) { (STEP_SURF[prm.surface] || STEP_SURF.moss)(v, 0.5); },
  },

  // ------------------------------------------------------------- projectiles
  puffHit: {
    vary: 0.08, gap: 0.025, max: 5,
    fn(v) {
      tone(v, { f: 900, f1: 260, ft: 0.05, a: 0.001, d: 0.07, g: 0.38 });
      nz(v, { a: 0.001, d: 0.04, g: 0.16, filt: { type: 'highpass', f: 1800 } });
      nz(v, { color: 'pink', t: 0.01, a: 0.01, d: 0.18, g: 0.14, filt: { type: 'lowpass', f: 1300 } });
    },
  },
  puffPoof: {
    vary: 0.1, gap: 0.03, max: 4, vol: 1.5,
    fn(v) {
      nz(v, { color: 'pink', a: 0.006, d: 0.2, g: 0.22, filt: { type: 'lowpass', f: 1000 } });
      tone(v, { f: 500, f1: 190, ft: 0.05, a: 0.002, d: 0.06, g: 0.12 });
    },
  },
  ironHit: {
    vary: 0.05, gap: 0.04, max: 3, wet: 0.18,
    fn(v) {
      metal(v, { f: 220, d: 0.9, g: 0.2 });
      tone(v, { f: 110, f1: 62, ft: 0.15, a: 0.002, d: 0.22, g: 0.32 });
    },
  },
  deflect: {
    vary: 0.08, gap: 0.04, max: 3,
    fn(v) {
      bell(v, { f: 2300, ratios: [1, 1.58, 2.24], gains: [1, 0.6, 0.4], d: 0.18, g: 0.1, damp: 0.4 });
      nz(v, { a: 0.0008, d: 0.015, g: 0.18, filt: { type: 'highpass', f: 4000 } });
    },
  },
  mudSplat: {
    vary: 0.08, gap: 0.04, max: 3,
    fn(v) {
      nz(v, { a: 0.002, d: 0.16, g: 0.36, filt: { type: 'bandpass', f: 850, f1: 260, ft: 0.12, Q: 2.2 } });
      nz(v, { color: 'brown', a: 0.002, d: 0.12, g: 0.25, filt: { type: 'lowpass', f: 320 } });
      tone(v, { f: 210, f1: 110, ft: 0.06, d: 0.07, g: 0.14 });
    },
  },
  splash: {
    vary: 0.06, gap: 0.08, max: 3, wet: 0.2,
    fn(v) { splashCore(v, 0.42); },
  },
  plop: {
    vary: 0.1, gap: 0.04, max: 3,
    fn(v) {
      tone(v, { f: 260, f1: 900, ft: 0.035, a: 0.002, d: 0.06, g: 0.24 });
      nz(v, { a: 0.002, d: 0.05, g: 0.08, filt: { type: 'bandpass', f: 1200, Q: 1 } });
    },
  },

  // ------------------------------------------------------------- bandits
  alert: {
    vary: 0.1, gap: 0.12, max: 3, ref: 9,
    fn(v) {
      nz(v, { a: 0.02, d: 0.06, g: 0.07, filt: { type: 'bandpass', f: 1500, Q: 1 } });
      croak(v, { t: 0.05, pts: [[0, 145], [0.13, 160], [0.32, 300]], a: 0.02, h: 0.18, d: 0.1, g: 0.34, formants: [[640, 5, 1], [1180, 6, 0.6], [2450, 7, 0.2]], am: [32, 0.45], drive: 2 });
    },
  },
  enemyHurt: {
    vary: 0.1, gap: 0.05, max: 3, ref: 9,
    fn(v) {
      croak(v, { pts: [[0, 250], [0.18, 150]], a: 0.005, h: 0.06, d: 0.12, g: 0.34, formants: [[750, 5, 1], [1250, 6, 0.6], [2500, 7, 0.15]], am: [38, 0.5], drive: 2 });
      nz(v, { a: 0.003, d: 0.1, g: 0.15, filt: { type: 'bandpass', f: 1200, f1: 450, ft: 0.1, Q: 2 } });
    },
  },
  enemyKilled: {
    vary: 0.08, gap: 0.05, max: 3, ref: 9, wet: 0.18,
    fn(v) {
      nz(v, { color: 'pink', a: 0.005, d: 0.32, g: 0.3, filt: { type: 'lowpass', f: 1600 } });
      tone(v, { f: 720, f1: 170, ft: 0.07, a: 0.001, d: 0.09, g: 0.36 });
      tone(v, { t: 0.07, pts: [[0, 1100], [0.06, 1900], [0.24, 850]], a: 0.01, h: 0.04, d: 0.16, g: 0.11, vib: [18, 45] });
    },
  },
  thwack: {
    vary: 0.1, gap: 0.05, max: 3,
    fn(v) {
      nz(v, { a: 0.001, d: 0.07, g: 0.35, filt: { type: 'bandpass', f: 2200, Q: 0.9 } });
      tone(v, { type: 'triangle', f: 300, f1: 180, ft: 0.05, a: 0.001, d: 0.07, g: 0.25 });
    },
  },
  armorBreak: {
    vary: 0.04, vol: 0.6, gap: 0.2, max: 2, ref: 10, wet: 0.22,
    fn(v) {
      metal(v, { f: 175, ratios: [1, 1.47, 2.09, 2.83, 3.71, 5.22], gains: [1, 0.8, 0.6, 0.5, 0.35, 0.2], d: 1.3, g: 0.17 });
      nz(v, { a: 0.001, d: 0.35, g: 0.32, filt: { type: 'highpass', f: 1500 } });
      thud(v, { f: 120, f1: 50, d: 0.25, g: 0.38, lp: 300 });
      for (let i = 0; i < 5; i++) bell(v, { t: 0.09 + i * 0.07 + v.rand() * 0.04, f: 1500 + v.rand() * 1800, ratios: [1, 2.7], gains: [1, 0.3], d: 0.12, g: 0.05 });
    },
  },
  clang: {
    vary: 0.06, gap: 0.04, max: 3, ref: 8, wet: 0.16,
    fn(v) {
      metal(v, { f: 380, ratios: [1, 2.08, 2.92, 4.41], gains: [1, 0.6, 0.4, 0.25], d: 0.45, g: 0.17 });
      tone(v, { f: 150, f1: 90, ft: 0.06, d: 0.08, g: 0.2 });
    },
  },
  cauldronClang: {
    vary: 0.08, gap: 0.06, max: 3, ref: 8,
    fn(v) { metal(v, { f: 250, ratios: [1, 2.21, 3.4, 4.9], gains: [1, 0.6, 0.4, 0.2], d: 0.5, g: 0.17 }); thud(v, { f: 100, d: 0.12, g: 0.2 }); },
  },
  potClatter: {
    vary: 0.1, gap: 0.05, max: 3,
    fn(v) { for (let i = 0; i < 3; i++) metal(v, { t: [0, 0.07, 0.115][i], f: 690 + i * 40, ratios: [1, 2.3, 3.7], gains: [1, 0.5, 0.3], d: 0.14, g: 0.12 - i * 0.03 }); },
  },
  clatter: {
    vary: 0.12, gap: 0.05, max: 4,
    fn(v) {
      for (let i = 0; i < 2; i++) {
        tone(v, { t: i * 0.06, type: 'triangle', f: 420 + i * 90, f1: 300, ft: 0.04, a: 0.001, d: 0.05, g: 0.16 - i * 0.05 });
        nz(v, { t: i * 0.06, a: 0.001, d: 0.02, g: 0.12, filt: { type: 'bandpass', f: 2400, Q: 2 } });
      }
    },
  },
  clubWindup: {
    vary: 0.06, vol: 2.0, gap: 0.2, ref: 8,
    fn(v) { nz(v, { color: 'pink', a: 0.32, d: 0.12, g: 0.22, filt: { type: 'bandpass', f: 240, f1: 760, ft: 0.4, Q: 1.6 } }); },
  },
  clubSlam: {
    vary: 0.06, gap: 0.1, ref: 8,
    fn(v) {
      thud(v, { f: 100, f1: 40, d: 0.25, g: 0.42 });
      nz(v, { a: 0.001, d: 0.07, g: 0.22, filt: { type: 'bandpass', f: 1300, Q: 1.2 } });
    },
  },
  slingSpin: {
    vary: 0.06, vol: 2.0, gap: 0.3, ref: 8,
    fn(v) { nz(v, { color: 'pink', a: 0.1, h: 0.42, d: 0.12, g: 0.2, filt: { type: 'bandpass', f: 950, Q: 2 }, am: [8, 0.85, 'sine', 11] }); },
  },
  slingThrow: {
    vary: 0.06, gap: 0.1, ref: 8,
    fn(v) {
      nz(v, { a: 0.001, d: 0.025, g: 0.3, filt: { type: 'highpass', f: 2500 } });
      nz(v, { color: 'pink', a: 0.01, d: 0.16, g: 0.2, filt: { type: 'bandpass', f: 500, f1: 1800, ft: 0.15, Q: 1.3 } });
    },
  },
  ironbellyGrunt: {
    vary: 0.06, gap: 0.3, ref: 9,
    fn(v) { croak(v, { pts: [[0, 112], [0.25, 84]], a: 0.02, h: 0.15, d: 0.13, g: 0.38, formants: [[500, 5, 1], [920, 6, 0.55], [2300, 7, 0.12]], am: [24, 0.5], drive: 3 }); },
  },
  bellyFlop: {
    vary: 0.05, gap: 0.2, ref: 10, wet: 0.16,
    fn(v) {
      thud(v, { f: 85, f1: 34, ft: 0.25, d: 0.42, g: 0.5, lp: 420 });
      nz(v, { a: 0.003, d: 0.22, g: 0.25, filt: { type: 'bandpass', f: 950, f1: 280, ft: 0.18, Q: 1.8 } });
    },
  },
  bellySlap: {
    vary: 0.08, gap: 0.08, ref: 8,
    fn(v) {
      nz(v, { a: 0.0008, d: 0.05, g: 0.4, filt: { type: 'bandpass', f: 1800, Q: 0.7 } });
      tone(v, { f: 165, f1: 100, ft: 0.06, d: 0.09, g: 0.28 });
    },
  },
  yawn: {
    vary: 0.08, gap: 1, ref: 8,
    fn(v) {
      croak(v, { pts: [[0, 175], [0.35, 215], [1.0, 115]], a: 0.15, h: 0.5, d: 0.4, g: 0.2, formants: [[[[0, 820], [1.0, 420]], 4, 1], [[[0, 1250], [1.0, 800]], 5, 0.6]], am: [20, 0.3] });
      nz(v, { color: 'pink', a: 0.2, h: 0.5, d: 0.4, g: 0.05, filt: { type: 'bandpass', f: 1200, Q: 1 } });
    },
  },

  // ------------------------------------------------------------- boss
  bossSnore: {
    vary: 0.04, gap: 0.8, ref: 14,
    fn(v) {
      croak(v, { pts: [[0, 62], [0.7, 70], [1.3, 58]], a: 0.35, h: 0.45, d: 0.45, g: 0.3, formants: [[380, 4, 1], [800, 5, 0.5]], am: [17, 0.6], drive: 2 });
      nz(v, { color: 'brown', a: 0.3, h: 0.4, d: 0.5, g: 0.18, filt: { type: 'lowpass', f: 380 } });
      nz(v, { color: 'pink', t: 0.75, a: 0.08, d: 0.5, g: 0.08, filt: { type: 'bandpass', f: 1500, Q: 0.8 } });
    },
  },
  bossRoar: {
    vary: 0.03, gap: 0.5, ref: 18, wet: 0.25,
    fn(v) {
      croak(v, { pts: [[0, 68], [0.25, 96], [1.0, 86], [1.55, 58]], a: 0.08, h: 0.95, d: 0.55, g: 0.42, formants: [[[[0, 480], [0.3, 640], [1.5, 420]], 3, 1], [[[0, 850], [0.3, 1050], [1.5, 760]], 4, 0.7], [2400, 5, 0.25]], am: [24, 0.35], drive: 4 });
      nz(v, { color: 'pink', a: 0.1, h: 0.85, d: 0.5, g: 0.3, filt: { type: 'bandpass', f: 600, f1: 950, ft: 0.6, Q: 1.5 }, am: [17, 0.4] });
      nz(v, { color: 'brown', a: 0.05, h: 0.6, d: 0.6, g: 0.32, filt: { type: 'lowpass', f: 200 } });
    },
  },
  bossStomp: {
    vary: 0.04, gap: 0.12, ref: 20, wet: 0.2,
    fn(v) {
      tone(v, { f: 66, f1: 27, ft: 0.5, a: 0.002, d: 0.7, g: 0.6 });
      nz(v, { color: 'brown', a: 0.002, d: 0.5, g: 0.5, filt: { type: 'lowpass', f: 180 } });
      nz(v, { a: 0.001, d: 0.03, g: 0.18, filt: { type: 'lowpass', f: 1300 } });
    },
  },
  shockwave: {
    vary: 0.05, gap: 0.15, ref: 16,
    fn(v) {
      nz(v, { color: 'brown', a: 0.05, h: 0.3, d: 0.6, g: 0.4, filt: { type: 'lowpass', f: 320 } });
      nz(v, { color: 'pink', a: 0.03, h: 0.2, d: 0.5, g: 0.18, filt: { type: 'bandpass', f: 420, f1: 140, ft: 0.8, Q: 1.2 } });
      tone(v, { f: 48, f1: 38, a: 0.05, h: 0.2, d: 0.5, g: 0.25 });
    },
  },
  bossClubSlam: {
    vary: 0.04, gap: 0.2, ref: 18, wet: 0.2,
    fn(v) {
      thud(v, { f: 80, f1: 30, ft: 0.4, d: 0.6, g: 0.6, lp: 260 });
      nz(v, { a: 0.001, d: 0.09, g: 0.3, filt: { type: 'bandpass', f: 1500, Q: 1 } });
      for (let i = 0; i < 3; i++) tone(v, { t: 0.1 + i * 0.08 + v.rand() * 0.04, type: 'triangle', f: 380 + v.rand() * 200, f1: 250, ft: 0.04, d: 0.05, g: 0.08 });
    },
  },
  bossInhale: {
    vary: 0.04, vol: 1.6, gap: 0.4, ref: 16,
    fn(v) {
      nz(v, { color: 'pink', a: 0.65, d: 0.1, g: 0.26, filt: { type: 'bandpass', f: 380, f1: 1500, ft: 0.7, Q: 1.4 } });
      croak(v, { pts: [[0, 70], [0.7, 105]], a: 0.5, h: 0.1, d: 0.12, g: 0.12, formants: [[400, 4, 1]], am: [20, 0.4] });
    },
  },
  bossSpit: {
    vary: 0.06, gap: 0.08, ref: 14,
    fn(v) {
      tone(v, { f: 320, f1: 110, ft: 0.06, a: 0.001, d: 0.07, g: 0.32 });
      nz(v, { a: 0.003, d: 0.14, g: 0.32, filt: { type: 'bandpass', f: 1100, f1: 500, ft: 0.12, Q: 1.8 } });
    },
  },
  bossSummon: {
    vary: 0.03, gap: 0.5, ref: 18, wet: 0.2,
    fn(v) {
      croak(v, { pts: [[0, 130], [0.12, 175], [0.3, 150]], a: 0.02, h: 0.18, d: 0.12, g: 0.36, formants: [[[[0, 520], [0.25, 380]], 4, 1], [[[0, 900], [0.25, 2000]], 5, 0.6]], am: [26, 0.4], drive: 3 });
      tone(v, { t: 0.42, pts: [[0, 1900], [0.08, 2500], [0.4, 2350], [0.55, 2900]], a: 0.02, h: 0.35, d: 0.15, g: 0.08, vib: [6, 25] });
    },
  },
  bossCharge: {
    vary: 0.03, gap: 0.4, ref: 16,
    fn(v) {
      croak(v, { pts: [[0, 58], [0.85, 112]], a: 0.2, h: 0.5, d: 0.2, g: 0.32, formants: [[450, 4, 1], [900, 5, 0.6]], am: [30, 0.5], drive: 4 });
      nz(v, { color: 'pink', a: 0.6, d: 0.2, g: 0.14, filt: { type: 'bandpass', f: 300, f1: 900, ft: 0.8, Q: 1.3 } });
    },
  },
  bossSlide: {
    vary: 0.04, gap: 0.5, ref: 16,
    fn(v) {
      nz(v, { color: 'brown', a: 0.05, h: 0.9, d: 0.3, g: 0.32, filt: { type: 'lowpass', f: 450 }, am: [14, 0.4] });
      nz(v, { a: 0.05, h: 0.9, d: 0.3, g: 0.12, filt: { type: 'bandpass', f: 1300, Q: 3 }, am: [23, 0.5] });
      tone(v, { pts: [[0, 820], [0.6, 980], [1.2, 760]], a: 0.1, h: 0.8, d: 0.3, g: 0.04, vib: [7, 40] });
    },
  },
  bossCrash: {
    vary: 0.04, gap: 0.3, ref: 18, wet: 0.22,
    fn(v) {
      thud(v, { f: 90, f1: 32, ft: 0.35, d: 0.55, g: 0.6, lp: 300 });
      nz(v, { a: 0.001, d: 0.25, g: 0.3, filt: { type: 'bandpass', f: 1300, Q: 0.8 } });
      for (let i = 0; i < 4; i++) tone(v, { t: 0.08 + i * 0.07 + v.rand() * 0.05, type: 'triangle', f: 330 + v.rand() * 250, f1: 220, ft: 0.05, d: 0.06, g: 0.1 });
    },
  },
  bossDizzy: {
    vary: 0.03, gap: 0.8, ref: 16, wet: 0.25,
    fn(v) {
      for (let i = 0; i < 6; i++) tone(v, { t: i * 0.17, pts: [[0, 2300 + (i % 2) * 300], [0.05, 3200 + (i % 3) * 200], [0.11, 2500]], a: 0.005, h: 0.02, d: 0.09, g: 0.07 });
      tone(v, { pts: [[0, 600], [0.5, 900], [1.0, 500]], a: 0.05, h: 0.7, d: 0.25, g: 0.05, vib: [9, 60] });
    },
  },
  bossHurt: {
    vary: 0.05, gap: 0.08, ref: 18,
    fn(v) {
      croak(v, { pts: [[0, 175], [0.32, 92]], a: 0.01, h: 0.12, d: 0.25, g: 0.44, formants: [[460, 4, 1], [880, 5, 0.6], [2300, 6, 0.15]], am: [22, 0.5], drive: 3 });
      tone(v, { f: 100, f1: 48, ft: 0.15, d: 0.18, g: 0.3 });
    },
  },
  bossBoing: {
    vary: 0.06, gap: 0.06, ref: 16,
    fn(v) {
      tone(v, { pts: [[0, 95], [0.05, 195], [0.5, 172]], a: 0.003, h: 0.05, d: 0.45, g: 0.38, vib: [11, 130, 0.5, 0] });
      tone(v, { type: 'triangle', pts: [[0, 190], [0.05, 390], [0.4, 344]], a: 0.003, d: 0.35, g: 0.1, vib: [11, 130, 0.4, 0] });
    },
  },
  bossDeflate: {
    vary: 0.02, gap: 1, ref: 30, wet: 0.2,
    fn(v) {
      // raspberry: buzzing lips (chopped saw) through mouth formants, sagging in pitch
      croak(v, { pts: [[0, 330], [0.5, 270], [1.6, 175], [2.3, 85]], a: 0.04, h: 1.9, d: 0.35, g: 0.34, formants: [[[[0, 900], [2.3, 500]], 3, 1], [1500, 4, 0.5]], am: [52, 0.65, 'square', 34] });
      nz(v, { color: 'pink', a: 0.05, h: 1.9, d: 0.3, g: 0.12, filt: { type: 'bandpass', f: 1500, Q: 1.2 }, am: [11, 0.7] });
    },
  },
  bossPlop: {
    vary: 0.03, gap: 0.5, ref: 20, wet: 0.2,
    fn(v) {
      thud(v, { f: 95, f1: 40, d: 0.35, g: 0.5, lp: 420 });
      nz(v, { a: 0.002, d: 0.3, g: 0.35, filt: { type: 'bandpass', f: 1000, f1: 260, ft: 0.25, Q: 1.6 } });
    },
  },
  bossDefeated: {
    vary: 0.02, vol: 0.8, gap: 1, ref: 30, wet: 0.3,
    fn(v) {
      tone(v, { f: 620, f1: 85, ft: 0.25, a: 0.002, d: 0.3, g: 0.42 });
      nz(v, { color: 'pink', a: 0.01, d: 0.7, g: 0.36, filt: { type: 'lowpass', f: 2600, f1: 600, ft: 0.6 } });
      thud(v, { f: 80, f1: 30, d: 0.5, g: 0.4 });
      for (let i = 0; i < 7; i++) bell(v, { t: 0.1 + i * 0.06 + v.rand() * 0.04, f: 1800 + v.rand() * 2200, ratios: [1, 2.0], gains: [1, 0.3], d: 0.35, g: 0.05 });
    },
  },

  // ------------------------------------------------------------- pickups / world
  glowcap: {
    vary: 0, gap: 0.02, max: 10, ref: 10,
    fn(v, prm) {
      const f = mtof(glowcapMidi(prm.step || 0));
      bell(v, { f, ratios: [1, 2.0, 3.01], gains: [1, 0.35, 0.18], d: 0.55, g: 0.19, fixed: true });
      nz(v, { a: 0.001, d: 0.012, g: 0.05, filt: { type: 'highpass', f: 6000 } });
      if ((prm.step || 0) >= 7) bell(v, { t: 0.05, f: f * 1.5, ratios: [1, 2.0], gains: [1, 0.3], d: 0.3, g: 0.06, fixed: true });
    },
  },
  berry: {
    vary: 0.05, gap: 0.08,
    fn(v) {
      nz(v, { a: 0.004, d: 0.15, g: 0.3, filt: { type: 'bandpass', f: 950, f1: 300, ft: 0.12, Q: 3 } });
      tone(v, { pts: [[0, 290], [0.07, 720]], a: 0.003, d: 0.1, g: 0.2 });
      [2093, 2637, 3136].forEach((f, i) => bell(v, { t: 0.09 + i * 0.045, f, ratios: [1, 2.0], gains: [1, 0.3], d: 0.25, g: 0.05 }));
    },
  },
  tonicStart: {
    vary: 0, gap: 0.3, wet: 0.25,
    fn(v, prm) {
      const kind = prm.kind || 'seeker';
      if (kind === 'anvil') {
        [48, 55, 60, 64, 67].forEach((m, i) => metal(v, { t: i * 0.07, f: mtof(m + 12), ratios: [1, 2.0, 2.92], gains: [1, 0.4, 0.25], d: 0.4, g: 0.1 }));
        metal(v, { t: 0.4, f: 1046, ratios: [1, 2.76, 4.1], gains: [1, 0.5, 0.3], d: 1.0, g: 0.12 });
        nz(v, { color: 'brown', a: 0.3, d: 0.2, g: 0.2, filt: { type: 'lowpass', f: 300 } });
      } else if (kind === 'updraft') {
        tone(v, { pts: [[0, 520], [0.55, 1750]], a: 0.05, h: 0.4, d: 0.25, g: 0.1, vib: [7, 35] });
        nz(v, { color: 'pink', a: 0.35, d: 0.3, g: 0.2, filt: { type: 'bandpass', f: 500, f1: 2400, ft: 0.6, Q: 1.2 } });
        [67, 69, 72, 74, 76, 79].forEach((m, i) => bell(v, { t: 0.06 + i * 0.065, f: mtof(m), ratios: [1, 2.0], gains: [1, 0.25], d: 0.4, g: 0.09 }));
      } else {
        [76, 79, 83, 84, 88, 91, 95, 96].forEach((m, i) => bell(v, { t: i * 0.04, f: mtof(m), ratios: [1, 2.76], gains: [1, 0.25], d: 0.35, g: 0.08 }));
        tone(v, { pts: [[0, 1200], [0.3, 2600]], a: 0.02, h: 0.15, d: 0.2, g: 0.04, am: [16, 0.6] });
      }
    },
  },
  tonicWarn: {
    vary: 0, gap: 0.3,
    fn(v, prm) {
      const r = prm.remaining ?? 3;
      const f = 1350 + (3 - r) * 260;
      tone(v, { type: 'triangle', f, f1: f * 0.94, ft: 0.03, a: 0.001, d: 0.06, g: 0.22 });
      tone(v, { t: 0.09, type: 'triangle', f: f * 0.75, f1: f * 0.7, ft: 0.03, a: 0.001, d: 0.06, g: 0.14 });
    },
  },
  tonicEnd: {
    vary: 0, gap: 0.3, wet: 0.2,
    fn(v) {
      [79, 76, 72].forEach((m, i) => bell(v, { t: i * 0.11, f: mtof(m), ratios: [1, 2.0, 3.0], gains: [1, 0.3, 0.12], d: 0.45, g: 0.11 }));
      nz(v, { color: 'pink', t: 0.15, a: 0.03, d: 0.4, g: 0.1, filt: { type: 'bandpass', f: 2200, f1: 400, ft: 0.4, Q: 1 } });
    },
  },
  cageFreed: {
    vary: 0.03, gap: 0.3, ref: 12, wet: 0.22,
    fn(v) {
      // wood crack + splinters
      nz(v, { a: 0.0008, d: 0.08, g: 0.45, filt: { type: 'bandpass', f: 1500, Q: 1 } });
      tone(v, { type: 'triangle', f: 230, f1: 95, ft: 0.08, a: 0.001, d: 0.1, g: 0.3 });
      for (let i = 0; i < 4; i++) nz(v, { t: 0.04 + i * 0.03 + v.rand() * 0.02, a: 0.0005, d: 0.015, g: 0.15, filt: { type: 'bandpass', f: 2500 + v.rand() * 1500, Q: 3 } });
      // the freed glowworm's happy chirp trill
      tone(v, { t: 0.18, pts: [[0, 1800], [0.05, 2600], [0.1, 2200], [0.16, 3000], [0.3, 2700]], a: 0.01, h: 0.15, d: 0.15, g: 0.1, vib: [28, 70] });
      [84, 88, 91].forEach((m, i) => bell(v, { t: 0.36 + i * 0.07, f: mtof(m), ratios: [1, 2.0], gains: [1, 0.3], d: 0.5, g: 0.09 }));
    },
  },
  cageHit: {
    vary: 0.08, gap: 0.06, max: 3, ref: 12,
    fn(v) {
      tone(v, { type: 'triangle', f: 260, f1: 150, ft: 0.06, a: 0.001, d: 0.09, g: 0.3 });
      nz(v, { a: 0.0008, d: 0.05, g: 0.3, filt: { type: 'bandpass', f: 1700, Q: 1.4 } });
      for (let i = 0; i < 2; i++) nz(v, { t: 0.03 + i * 0.035, a: 0.0005, d: 0.015, g: 0.12, filt: { type: 'bandpass', f: 2800 + v.rand() * 1200, Q: 3 } });
      tone(v, { t: 0.08, pts: [[0, 2400], [0.05, 3100], [0.12, 2600]], a: 0.005, d: 0.08, g: 0.05 }); // the glowworm inside squeaks
    },
  },
  tonicDrink: {
    vary: 0.05, gap: 0.3, wet: 0.1,
    fn(v) {
      // cork pop
      tone(v, { f: 520, f1: 1400, ft: 0.03, a: 0.001, d: 0.05, g: 0.28 });
      nz(v, { a: 0.0008, d: 0.02, g: 0.2, filt: { type: 'bandpass', f: 2500, Q: 1.5 } });
      // two gulps: a throat resonance that drops in pitch
      for (let i = 0; i < 2; i++) {
        const t = 0.1 + i * 0.16;
        nz(v, { t, color: 'pink', a: 0.01, d: 0.09, g: 0.32, filt: { type: 'bandpass', pts: [[0, 900], [0.09, 380]], Q: 6 } });
        tone(v, { t, f: 210, f1: 140, ft: 0.08, a: 0.005, d: 0.08, g: 0.1 });
      }
    },
  },
  tonicRespawn: {
    vary: 0.04, gap: 0.3, ref: 10, wet: 0.3,
    fn(v) {
      nz(v, { color: 'pink', a: 0.08, d: 0.25, g: 0.12, filt: { type: 'bandpass', f: 1800, f1: 4000, ft: 0.3, Q: 1.2 } });
      [84, 91, 96].forEach((m, i) => bell(v, { t: 0.05 + i * 0.05, f: mtof(m), ratios: [1, 2.0], gains: [1, 0.3], d: 0.4, g: 0.05 }));
    },
  },
  lanternRise: {
    vary: 0, gap: 2, ref: 30, wet: 0.45,
    fn(v) {
      // warm swell (soft saw chord through an opening lowpass) + rising chimes
      for (const m of [48, 55, 60, 64, 67]) for (const det of [-6, 6]) tone(v, { type: 'sawtooth', f: mtof(m), det, a: 0.6, h: 0.9, d: 1.2, g: 0.035, filt: { type: 'lowpass', pts: [[0, 300], [0.8, 2200], [2.6, 700]] } });
      [72, 76, 79, 83, 84, 88, 91].forEach((m, i) => bell(v, { t: 0.25 + i * 0.11, f: mtof(m), ratios: [1, 2.0, 3.0], gains: [1, 0.3, 0.1], d: 0.9, g: 0.06 }));
    },
  },
  checkpoint: {
    vary: 0, gap: 1, wet: 0.35,
    fn(v) {
      const strike = (t, f, g) => bell(v, { t, f, ratios: [0.5, 1, 1.19, 1.5, 2.0, 2.52, 3.0], gains: [0.45, 1, 0.45, 0.35, 0.3, 0.15, 0.1], d: 2.4, g, damp: 0.6 });
      strike(0, 523.25, 0.13);
      strike(0.32, 783.99, 0.1);
    },
  },
  zoneEnter: {
    vary: 0, gap: 1, wet: 0.4,
    fn(v, prm) {
      const notes = ZONE_HORN[prm.zone] || ZONE_HORN.default;
      for (const [m, t] of notes) {
        const f = mtof(m);
        // soft horn: saw through a slowly opening lowpass
        for (const det of [-6, 6]) tone(v, { t, type: 'sawtooth', f, det, a: 0.25, h: 0.55, d: 0.7, g: 0.07, filt: { type: 'lowpass', pts: [[0, f * 1.2], [0.3, Math.min(2400, f * 5)], [1.4, f * 2]] } });
      }
    },
  },
  scoreTick: {
    vary: 0.02, gap: 0.09, max: 2, vol: 1.4,
    fn(v, prm) {
      const k = 1 + ((prm.multiplier || 3) - 3) * 0.06;
      tone(v, { type: 'square', f: 1975 * k, a: 0.001, d: 0.035, g: 0.05, filt: { type: 'lowpass', f: 5000 } });
      tone(v, { t: 0.045, type: 'square', f: 2637 * k, a: 0.001, d: 0.11, g: 0.05, filt: { type: 'lowpass', f: 6000 } });
    },
  },
  levelComplete: {
    vary: 0, gap: 2, wet: 0.35,
    fn(v) {
      [60, 64, 67, 72, 76].forEach((m, i) => tone(v, { t: i * 0.08, f: mtof(m), a: 0.002, d: 0.5, g: 0.16 }));
      [72, 76, 79, 84].forEach((m) => bell(v, { t: 0.45, f: mtof(m), ratios: [1, 2.0, 3.0], gains: [1, 0.3, 0.1], d: 1.6, g: 0.07 }));
      for (let i = 0; i < 6; i++) bell(v, { t: 0.5 + i * 0.09, f: 2400 + v.rand() * 2400, ratios: [1], gains: [1], d: 0.3, g: 0.035 });
    },
  },
  bounce: {
    vary: 0.04, gap: 0.12, max: 2, ref: 10,
    fn(v) {
      tone(v, { pts: [[0, 135], [0.06, 330], [0.4, 300]], a: 0.003, h: 0.05, d: 0.36, g: 0.38, vib: [14, 95, 0.4, 0] });
      tone(v, { type: 'triangle', pts: [[0, 270], [0.06, 660], [0.35, 600]], a: 0.003, d: 0.25, g: 0.07, vib: [14, 95, 0.35, 0] });
      nz(v, { a: 0.003, d: 0.1, g: 0.18, filt: { type: 'bandpass', f: 650, Q: 2 } });
    },
  },
  gateOpen: {
    vary: 0.03, gap: 1, ref: 16, wet: 0.2,
    fn(v) {
      nz(v, { color: 'brown', a: 0.1, h: 0.9, d: 0.4, g: 0.36, filt: { type: 'bandpass', f: 260, Q: 1.2 }, am: [11, 0.5] });
      tone(v, { type: 'sawtooth', pts: [[0, 140], [0.8, 118], [1.2, 125]], a: 0.1, h: 0.9, d: 0.3, g: 0.07, filt: { type: 'bandpass', f: 900, Q: 8 }, vib: [5, 40] });
      for (let i = 0; i < 5; i++) metal(v, { t: 0.1 + i * 0.2 + v.rand() * 0.06, f: 900 + v.rand() * 500, ratios: [1, 2.3], gains: [1, 0.4], d: 0.1, g: 0.04 });
      thud(v, { t: 1.35, f: 100, d: 0.25, g: 0.35 });
    },
  },
  gateClose: {
    vary: 0.03, vol: 0.8, gap: 1, ref: 16, wet: 0.2,
    fn(v) {
      thud(v, { f: 110, f1: 42, d: 0.35, g: 0.5 });
      metal(v, { f: 260, ratios: [1, 2.2, 3.5], gains: [1, 0.5, 0.3], d: 0.6, g: 0.12 });
    },
  },
  arenaLock: {
    vary: 0, gap: 1, wet: 0.25,
    fn(v) {
      thud(v, { f: 95, f1: 38, d: 0.5, g: 0.5 });
      for (const m of [40, 46, 52]) for (const det of [-5, 5]) tone(v, { t: 0.02, type: 'sawtooth', f: mtof(m), det, a: 0.02, h: 0.25, d: 0.5, g: 0.06, filt: { type: 'lowpass', pts: [[0, 300], [0.06, 1600], [0.8, 500]] } });
      metal(v, { t: 0.05, f: 300, ratios: [1, 2.2, 3.6], gains: [1, 0.5, 0.3], d: 0.5, g: 0.08 });
    },
  },
  arenaClear: {
    vary: 0, gap: 1, wet: 0.3,
    fn(v) {
      [55, 60, 64, 67, 72].forEach((m, i) => { for (const det of [-5, 5]) tone(v, { t: i * 0.09, type: 'sawtooth', f: mtof(m), det, a: 0.02, h: i === 4 ? 0.5 : 0.06, d: i === 4 ? 0.6 : 0.12, g: 0.05, filt: { type: 'lowpass', f: 2200 } }); });
      bell(v, { t: 0.36, f: 1046.5, ratios: [1, 2.0, 3.0], gains: [1, 0.3, 0.1], d: 1.2, g: 0.08 });
    },
  },
  hint: {
    vary: 0.02, gap: 0.5, vol: 1.3,
    fn(v) {
      tone(v, { f: 1180, f1: 1480, ft: 0.05, a: 0.004, d: 0.1, g: 0.07 });
      tone(v, { t: 0.06, f: 1760, a: 0.003, d: 0.16, g: 0.05 });
    },
  },

  // ------------------------------------------------------------- menus
  menuMove: {
    vary: 0.03, gap: 0.03, max: 2,
    fn(v) {
      tone(v, { type: 'triangle', f: 940, f1: 860, ft: 0.03, a: 0.001, d: 0.035, g: 0.14 });
      nz(v, { a: 0.0005, d: 0.01, g: 0.06, filt: { type: 'bandpass', f: 3000, Q: 2 } });
    },
  },
  menuConfirm: {
    vary: 0, gap: 0.06,
    fn(v) {
      tone(v, { f: 784, a: 0.002, d: 0.16, g: 0.16 }); tone(v, { f: 784 * 3.99, a: 0.001, d: 0.03, g: 0.03 });
      tone(v, { t: 0.07, f: 1175, a: 0.002, d: 0.25, g: 0.16 }); tone(v, { t: 0.07, f: 1175 * 3.99, a: 0.001, d: 0.03, g: 0.03 });
    },
  },
  menuBack: {
    vary: 0, gap: 0.06,
    fn(v) {
      tone(v, { f: 1175, a: 0.002, d: 0.12, g: 0.12 });
      tone(v, { t: 0.07, f: 784, a: 0.002, d: 0.2, g: 0.12 });
    },
  },
};

// Aliases: names other areas may use for the same sounds.
export const ALIASES = {
  stomp: 'bossStomp', bossStart: 'bossRoar', roar: 'bossRoar', fanfare: 'levelComplete',
  pop: 'puffHit', clink: 'deflect', croak: 'enemyHurt', coin: 'scoreTick', bell: 'checkpoint',
  horn: 'zoneEnter', menuSelect: 'menuConfirm', menuCancel: 'menuBack', click: 'menuMove',
};

/** Every playable sfx name (recipes, not aliases). */
export const SFX_NAMES = Object.keys(SFX);
