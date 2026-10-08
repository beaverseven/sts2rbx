// Small math helpers shared by every area. All angles in radians.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a0, a1, b0, b1, doClamp = true) => {
  let t = invLerp(a0, a1, v);
  if (doClamp) t = clamp01(t);
  return b0 + (b1 - b0) * t;
};
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing toward b. lambda ~ 1/time-constant. */
export const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);

/** Move cur toward target by at most maxDelta. */
export const approach = (cur, target, maxDelta) =>
  cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);

/** Wrap an angle into (-PI, PI]. */
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

/** Shortest signed difference b - a between two angles. */
export const angleDelta = (a, b) => wrapAngle(b - a);

/** damp() for angles (takes the short way round). */
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

/** approach() for angles. */
export const approachAngle = (a, b, maxDelta) => {
  const d = angleDelta(a, b);
  return Math.abs(d) <= maxDelta ? b : a + Math.sign(d) * maxDelta;
};

/** Yaw (0 = +Z) of a horizontal direction. */
export const yawOf = (x, z) => Math.atan2(x, z);

/**
 * Seeded PRNG (mulberry32). rand(seed) returns a function () => [0,1) with helpers:
 *   r.range(a,b), r.int(a,b) inclusive, r.pick(arr), r.sign(), r.seed
 */
export function rand(seed = 1) {
  let s = (seed >>> 0) || 1;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.seed = seed;
  return r;
}

/** Cheap deterministic 2D hash -> [0,1). */
export const hash2 = (x, y) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth 2D value noise in [0,1). */
export function valueNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Exponential ease-out-back style overshoot curve for pops (t in 0..1). */
export const easeOutBack = (t, s = 1.70158) => {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
