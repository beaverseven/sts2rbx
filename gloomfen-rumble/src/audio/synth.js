// Low-level synthesis helpers shared by the sfx recipes and the music instruments.
// Everything here works on any BaseAudioContext (realtime or OfflineAudioContext).
//
//   mtof(midi), noteToMidi('F#4'), rng(seed)
//   buffers(ac)            -> { white, pink, brown } looping noise buffers (cached per context)
//   impulse(ac, sec, ...)  -> stereo reverb impulse response (procedural)
//   pluck(ac, kind, midi)  -> Karplus-Strong plucked-string buffer (cached), see PLUCKS
//   softClipCurve()        -> WaveShaper curve that never exceeds 0.99 (final safety stage)
//   env helpers: perc(), adsr(), glide(), contour()

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C4' -> 60, 'F#3' -> 54, 'Bb2' -> 46. Returns null for anything else. */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const n = NOTE_BASE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n + (parseInt(m[3], 10) + 1) * 12;
}

/** Small deterministic PRNG (mulberry32) -> () => [0, 1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Noise buffers (2 s, mono, looped by the players; started at random offsets)
const bufferCache = new WeakMap();
export function buffers(ac) {
  let b = bufferCache.get(ac);
  if (b) return b;
  const sr = ac.sampleRate;
  const len = Math.floor(sr * 2);
  const r = rng(1234);
  const white = ac.createBuffer(1, len, sr);
  const pink = ac.createBuffer(1, len, sr);
  const brown = ac.createBuffer(1, len, sr);
  const w = white.getChannelData(0), p = pink.getChannelData(0), br = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const x = r() * 2 - 1;
    w[i] = x * 0.9;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    br[i] = last * 3.5;
  }
  // make the loop seams continuous for the integrated noises
  for (const d of [p, br]) {
    const fade = 512;
    for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }
  }
  b = { white, pink, brown };
  bufferCache.set(ac, b);
  return b;
}

/**
 * Procedural stereo impulse response: exponentially decaying noise that darkens over time,
 * with a few early reflections. Normalised to unit energy per channel (use convolver.normalize = false).
 */
export function impulse(ac, seconds = 2, { seed = 7, predelay = 0.012, bright = 0.85, dark = 0.12, early = 6 } = {}) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  const r = rng(seed);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const pre = Math.floor(predelay * sr);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const k = t / seconds;
      const env = Math.exp(-6.9 * k) * (k < 0.004 ? k / 0.004 : 1);
      const a = bright + (dark - bright) * Math.min(1, k * 1.6); // lowpass coefficient slides darker
      lp += a * ((r() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    for (let e = 0; e < early; e++) {
      const at = pre + Math.floor((0.008 + r() * 0.06) * sr);
      if (at < len) d[at] += (r() < 0.5 ? -1 : 1) * (0.5 - e * 0.05);
    }
    let sum = 0;
    for (let i = 0; i < len; i++) sum += d[i] * d[i];
    const s = 1 / Math.sqrt(sum || 1);
    for (let i = 0; i < len; i++) d[i] *= s;
  }
  return buf;
}

/**
 * Soft clipper for the very end of the chain. The shaper input is pre-scaled by 0.5, so the
 * curve covers signals in [-2, 2]: linear below 0.7, smooth knee above, never beyond 0.99.
 */
export function softClipCurve(n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(s);
    const y = a < 0.7 ? a : 0.7 + 0.29 * Math.tanh((a - 0.7) / 0.29);
    c[i] = Math.sign(s) * y;
  }
  return c;
}

/** Gentle saturation curve for gritty voices (roars, croaks). */
export function driveCurve(amount = 3, n = 1024) {
  const c = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / norm; }
  return c;
}

// ---------------------------------------------------------------------------
// Karplus-Strong plucked strings, rendered in JS once per (context, kind, midi) and cached.
export const PLUCKS = {
  // bright, short, twangy: excitation picked near the bridge, less averaging
  banjo: { dur: 0.62, S: 0.32, rho: 0.9955, soft: 0.9, pick: 0.13, gain: 0.55 },
  // soft and ringing: finger pluck (lowpassed excitation) mid-string, long decay
  harp: { dur: 1.5, S: 0.5, rho: 0.9988, soft: 0.35, pick: 0.45, gain: 0.5 },
};
const pluckCache = new WeakMap();
export function pluck(ac, kind, midi) {
  let byCtx = pluckCache.get(ac);
  if (!byCtx) { byCtx = new Map(); pluckCache.set(ac, byCtx); }
  const key = kind + midi;
  let entry = byCtx.get(key);
  if (entry) return entry;
  const P = PLUCKS[kind] || PLUCKS.harp;
  const sr = ac.sampleRate;
  const f = mtof(midi);
  const N = Math.max(2, Math.floor(sr / f - P.S));
  const realF = sr / (N + P.S);
  const len = Math.floor(sr * P.dur);
  const buf = ac.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const r = rng(midi * 31 + (kind === 'banjo' ? 7 : 3));
  // excitation
  let lp = 0, mean = 0;
  const exc = new Float32Array(N);
  for (let i = 0; i < N; i++) { lp += P.soft * ((r() * 2 - 1) - lp); exc[i] = lp; }
  const pk = Math.max(1, Math.floor(N * P.pick));
  for (let i = N - 1; i >= pk; i--) exc[i] -= exc[i - pk];
  for (let i = 0; i < N; i++) mean += exc[i];
  mean /= N;
  for (let i = 0; i < N; i++) out[i] = exc[i] - mean;
  // KS loop: y[n] = rho * ((1-S) y[n-N] + S y[n-N-1])
  const S = P.S, rho = P.rho;
  for (let n = N; n < len; n++) out[n] = rho * ((1 - S) * out[n - N] + S * (n - N - 1 >= 0 ? out[n - N - 1] : 0));
  // normalise + fade tail
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = P.gain / (peak || 1);
  const fade = Math.floor(len * 0.25);
  for (let i = 0; i < len; i++) {
    const k = i > len - fade ? (len - i) / fade : 1;
    out[i] *= g * k * k;
  }
  entry = { buffer: buf, rate: f / realF };
  byCtx.set(key, entry);
  return entry;
}
export function hasPluck(ac, kind, midi) {
  const byCtx = pluckCache.get(ac);
  return !!(byCtx && byCtx.has(kind + midi));
}

// ---------------------------------------------------------------------------
// Envelope / automation helpers (all times absolute, in the context's clock)
const EPS = 0.0001;

/** Percussive envelope: 0 -> peak over a, hold h, exponential decay to silence over d. Returns end time. */
export function perc(param, t, peak, a = 0.003, d = 0.2, h = 0) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (h > 0) param.setValueAtTime(peak, t + a + h);
  param.exponentialRampToValueAtTime(EPS, t + a + h + d);
  param.setValueAtTime(0, t + a + h + d + 0.001);
  return t + a + h + d + 0.002;
}

/** Sustained envelope: attack a, settle to peak*sus with time constant dc, release r at t+dur. Returns end time. */
export function adsr(param, t, peak, dur, a = 0.01, dc = 0.1, sus = 0.7, r = 0.08) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (sus !== 1) param.setTargetAtTime(peak * sus, t + a, dc);
  const rel = Math.max(t + a + 0.001, t + dur);
  param.setTargetAtTime(0, rel, r / 4);
  return rel + r * 1.5;
}

/** Exponential frequency glide f0 -> f1 over time (both > 0). */
export function glide(param, t, f0, f1, time) {
  param.setValueAtTime(f0, t);
  param.exponentialRampToValueAtTime(Math.max(1, f1), t + Math.max(0.001, time));
}

/** Exponential contour through points [[dt, value], ...] (dt relative to t, first point at 0). */
export function contour(param, t, pts, scale = 1) {
  param.setValueAtTime(Math.max(EPS, pts[0][1] * scale), t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(Math.max(EPS, pts[i][1] * scale), t + pts[i][0]);
}
