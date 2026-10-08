// Gloomfen props: textures, a per-chunk / per-material static geometry batcher, and
// builders for every structure kind in data.js plus decor (trees, rocks, glowing
// mushrooms, reeds, lily pads, lanterns, torches, banners, pit, fort...).
// Ambient renderables (instanced grass, fireflies, halos, backdrop silhouettes) live here too.
//
// Everything static is baked into a few merged meshes per 48 m z-chunk and material:
//   toon  (vertex colours, outlined, casts)   flat  (vertex colours, no outline/shadow)
//   glow  (HDR vertex colours, unlit, blooms) wood / stone / crate (textured, outlined, casts)
//   cloth (banner texture, wind sway, double-sided)
import * as THREE from 'three';
import { rand, clamp, lerp, smoothstep, valueNoise2 } from '../../core/mathx.js';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** Matrix from position, rotation (yaw, pitch, roll as Euler YXZ) and scale. */
export function T(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}
const C = (hex) => new THREE.Color(hex);
export const PCOL = {
  bark: C(0x5a3e2b), barkDark: C(0x3b281c), barkLight: C(0x7a5a3e), wood: C(0x9b7448), woodTop: C(0xc9a06a), ring: C(0x8a6a44),
  moss: C(0x7fae4e), mossDark: C(0x3f6b3a), mossDeep: C(0x2c4f30), sage: C(0x9db48a), leafA: C(0x3d6e3c), leafB: C(0x2f5a3e), leafTop: C(0x6a9a48),
  rock: C(0x767b74), rockDark: C(0x50554f), rockLight: C(0x9a9d92), stone: C(0xb5b2aa),
  cream: C(0xeadcb8), bone: C(0xe8dcc0), iron: C(0x8a97a6), ironDark: C(0x55606c), rust: C(0x8a5a3a),
  straw: C(0xc9a24e), strawDark: C(0x8f6e2e), burlap: C(0x9c7b50), burlapDark: C(0x6e5434), rope: C(0x9b8156),
  reed: C(0x6f8a3c), reedDark: C(0x4d6630), cattail: C(0x5a3a22), lily: C(0x4f8f3a), lilyDark: C(0x3a6e2e),
  maroon: C(0x7a2a2a), mustard: C(0xd9a441), ink: C(0x1a1530), white: C(0xffffff),
};
const LUM = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** HDR glow colour normalised so its luminance is ~target (bloom threshold is 0.95). */
export function glowColor(hex, target = 1.5) {
  const c = new THREE.Color(hex);
  const k = clamp(target / Math.max(0.05, LUM(c)), 1.3, 5);
  return c.multiplyScalar(k);
}

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

export function makeTextures(M) {
  const wood = M.canvasTexture(256, 256, (g, w, h) => {
    const r = seeded(31);
    g.fillStyle = '#b7926a'; g.fillRect(0, 0, w, h);
    const rows = 4, ph = h / rows;
    for (let p = 0; p < rows; p++) {
      const y = p * ph;
      const v = 0.85 + r() * 0.25;
      g.fillStyle = `rgb(${Math.round(190 * v)},${Math.round(150 * v)},${Math.round(108 * v)})`;
      g.fillRect(0, y + 3, w, ph - 5);
      g.strokeStyle = 'rgba(70,42,22,0.28)'; g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) { const yy = y + 7 + r() * (ph - 14); g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + r() * 6 - 3, w * 0.7, yy + r() * 6 - 3, w, yy); g.stroke(); }
      g.fillStyle = 'rgba(55,32,18,0.9)'; g.fillRect(0, y, w, 3);
      const off = r() * w;
      g.fillRect(off, y, 3, ph); // butt joint
      g.fillStyle = 'rgba(60,60,70,0.8)';
      for (const xx of [off - 8, off + 10]) { g.beginPath(); g.arc((xx + w) % w, y + ph * 0.3, 2.2, 0, 7); g.arc((xx + w) % w, y + ph * 0.72, 2.2, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(80,50,28,0.6)'; g.beginPath(); g.ellipse(r() * w, y + ph / 2, 5, 3, 0, 0, 7); g.fill();
    }
  }, { repeat: [1, 1] });
  const stone = M.canvasTexture(256, 256, (g, w, h) => {
    const r = seeded(7);
    g.fillStyle = '#5d605c'; g.fillRect(0, 0, w, h);
    const rows = 5, rh = h / rows;
    for (let y = 0; y < rows; y++) {
      let x = -(y % 2) * 40 - r() * 20;
      while (x < w) {
        const bw = 50 + r() * 50;
        const v = 150 + r() * 50;
        g.fillStyle = `rgb(${v - 8},${v},${v - 10})`;
        g.beginPath(); g.roundRect(x + 3, y * rh + 3, bw - 6, rh - 6, 6); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 6, y * rh + 5, bw - 12, 4);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 5, y * rh + rh - 10, bw - 10, 5);
        if (r() < 0.35) { g.fillStyle = 'rgba(110,150,80,0.45)'; g.beginPath(); g.ellipse(x + bw * r(), y * rh + 6, 12 + r() * 14, 5, 0, 0, 7); g.fill(); }
        x += bw;
      }
    }
    // wrap seam fix: copy left 4 px band to the right is overkill; bricks tile closely enough
  }, { repeat: [1, 1] });
  const crate = M.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#b48b5c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,50,25,0.35)'; g.lineWidth = 1;
    for (let y = 16; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 2); g.stroke(); }
    g.fillStyle = '#7a5532';
    g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14); g.fillRect(0, 0, 14, h); g.fillRect(w - 14, 0, 14, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 4); g.fillRect(-80, -7, 160, 14); g.restore();
    g.fillStyle = '#3d2817'; for (const [x, y] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    g.strokeStyle = '#4a2f1a'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  });
  const banner = M.canvasTexture(128, 256, (g, w, h) => {
    // ragged maroon burlap with an original bandit emblem: a dented tin pot over crossed ladles
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#7a2a2a';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 40);
    const teeth = 5;
    for (let k = teeth; k >= 0; k--) { const x = (k / teeth) * w; g.lineTo(x, h - (k % 2 ? 8 : 34) - (k * 7) % 11); }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,10,10,0.25)'; g.lineWidth = 1;
    for (let x = 2; x < w; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = '#d9a441'; g.fillRect(0, 10, w, 7); g.fillRect(0, 22, w, 3);
    const cx = w / 2, cy = 112;
    g.fillStyle = '#efe2c0'; g.beginPath(); g.arc(cx, cy, 44, 0, 7); g.fill();
    g.strokeStyle = '#1a1530'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 32, cy + 30); g.lineTo(cx + 26, cy - 28); g.stroke();
    g.beginPath(); g.moveTo(cx + 32, cy + 30); g.lineTo(cx - 26, cy - 28); g.stroke();
    g.fillStyle = '#1a1530';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 27, cy - 30, 9, 6, s * 0.8, 0, 7); g.fill(); }
    g.beginPath(); g.moveTo(cx - 26, cy + 10); g.quadraticCurveTo(cx - 24, cy - 24, cx, cy - 26); g.quadraticCurveTo(cx + 24, cy - 24, cx + 26, cy + 10); g.closePath(); g.fill();
    g.fillRect(cx - 33, cy + 8, 66, 8);
    g.fillStyle = '#efe2c0'; g.beginPath(); g.moveTo(cx - 6, cy - 22); g.lineTo(cx + 2, cy - 12); g.lineTo(cx - 8, cy - 6); g.fill(); // dent
    g.fillStyle = '#d9a441'; for (const s of [-1, 0, 1]) { g.beginPath(); g.arc(cx + s * 16, cy + 58, 5, 0, 7); g.fill(); }
  });
  return { wood, stone, crate, banner };
}

// ---------------------------------------------------------------------------
// primitive geometry cache (shared, never mutated)
// ---------------------------------------------------------------------------
const GEO = new Map();
export function geo(key, make) {
  let g = GEO.get(key);
  if (!g) {
    g = make();
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    GEO.set(key, g);
  }
  return g;
}
export function disposeGeoCache() { for (const g of GEO.values()) g.dispose(); GEO.clear(); }

const G = {
  cyl: (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1).translate(0, 0.5, 0)),          // r 1, y 0..1
  cylT: (top, seg = 8) => geo(`cylT${top}_${seg}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1).translate(0, 0.5, 0)),
  cone: (seg = 6) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg, 1).translate(0, 0.5, 0)),               // base at y 0
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  boxB: () => geo('boxB', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),                                    // bottom at y 0
  sphere: (w = 10, h = 7) => geo(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)),
  hemi: (w = 12) => geo(`hemi${w}`, () => new THREE.SphereGeometry(1, w, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
  ico: (d = 0) => geo(`ico${d}`, () => new THREE.IcosahedronGeometry(1, d)),
  rock: (v) => geo(`rock${v}`, () => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const r = seeded(101 + v * 17);
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let f = seen.get(k); if (f === undefined) { f = 0.78 + r() * 0.4; seen.set(k, f); }
      p.setXYZ(i, p.getX(i) * f, Math.max(p.getY(i) * f, -0.35), p.getZ(i) * f);
    }
    g.computeVertexNormals();
    return g;
  }),
  blob: (v) => geo(`blob${v}`, () => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let f = seen.get(k);
      if (f === undefined) { f = 0.86 + valueNoise2(x * 2.3 + v * 3.1, z * 2.3 + y * 1.7 + v) * 0.3; seen.set(k, f); }
      p.setXYZ(i, x * f, y * f * (y < 0 ? 0.55 : 1), z * f);
    }
    g.computeVertexNormals();
    return g;
  }),
  pot: () => geo('pot', () => {
    // tin pot helmet: dome + brim (lathe)
    // profile listed bottom -> top so the lathe faces point outward
    const pts = [[0.45, 0.04], [0.5, 0.0], [0.63, 0.0], [0.62, 0.04], [0.5, 0.06], [0.48, 0.16], [0.45, 0.36], [0.36, 0.52], [0.2, 0.6], [0, 0.62]].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, 12);
    return g;
  }),
  blade: () => geo('blade', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    return g;
  }),
  disc: (seg = 14) => geo(`disc${seg}`, () => new THREE.CircleGeometry(1, seg, 0.25, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2)),
};
export { G as PRIM };

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------
const _mv = new THREE.Vector3(), _mn = new THREE.Vector3(), _nm = new THREE.Matrix3(), _mc = new THREE.Color();
/**
 * Bake parts [{ geometry, matrix, color }] into one indexed BufferGeometry with a vertex
 * colour attribute (+ normal / uv / outlineNormal per opts). color: Color | fn(px,py,pz,nx,ny,nz,out).
 * Geometries flagged userData.disposable are disposed after baking.
 */
export function mergeParts(parts, opts = {}) {
  let verts = 0, idxCount = 0;
  for (const p of parts) { verts += p.geometry.attributes.position.count; idxCount += p.geometry.index.count; }
  const pos = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
  const nor = opts.normal !== false ? new Float32Array(verts * 3) : null;
  const onr = opts.outline ? new Float32Array(verts * 3) : null;
  const uvs = opts.uv ? new Float32Array(verts * 2) : null;
  const index = new Uint32Array(idxCount);
  let vo = 0, io = 0;
  for (const part of parts) {
    const g = part.geometry, m = part.matrix;
    _nm.getNormalMatrix(m);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, O = g.attributes.outlineNormal || N;
    const fn = typeof part.color === 'function' ? part.color : null;
    for (let i = 0; i < P.count; i++) {
      const px = P.getX(i), py = P.getY(i), pz = P.getZ(i);
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      _mv.set(px, py, pz).applyMatrix4(m);
      const o = (vo + i) * 3;
      pos[o] = _mv.x; pos[o + 1] = _mv.y; pos[o + 2] = _mv.z;
      if (nor) { _mn.set(nx, ny, nz).applyMatrix3(_nm).normalize(); nor[o] = _mn.x; nor[o + 1] = _mn.y; nor[o + 2] = _mn.z; }
      if (onr) { _mn.set(O.getX(i), O.getY(i), O.getZ(i)).applyMatrix3(_nm).normalize(); onr[o] = _mn.x; onr[o + 1] = _mn.y; onr[o + 2] = _mn.z; }
      if (uvs) { uvs[(vo + i) * 2] = U ? U.getX(i) : 0; uvs[(vo + i) * 2 + 1] = U ? U.getY(i) : 0; }
      if (fn) fn(px, py, pz, nx, ny, nz, _mc); else _mc.copy(part.color || PCOL.white);
      col[o] = _mc.r; col[o + 1] = _mc.g; col[o + 2] = _mc.b;
    }
    const I = g.index;
    for (let k = 0; k < I.count; k++) index[io + k] = I.getX(k) + vo;
    vo += P.count; io += I.count;
    if (g.userData.disposable) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nor) out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (onr) out.setAttribute('outlineNormal', new THREE.BufferAttribute(onr, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// batcher
// ---------------------------------------------------------------------------
/**
 * createBatcher(ctx, textures, { chunkSize, zBase })
 *   B.add(mat, geometry, matrix, color, z?)   color: Color | hex | fn(px,py,pz,nx,ny,nz,outColor) (local space)
 *   B.addBox(mat, min, max, color, uvScale)    world-aligned box with world-scaled UVs (textured mats)
 *   B.build(scene) -> { group, meshes, materials }
 */
export function createBatcher(ctx, tex, opts = {}) {
  const M = ctx.materials;
  const chunkSize = opts.chunkSize ?? 48, zBase = opts.zBase ?? -48;
  const buckets = new Map();
  const windUniforms = { uTime: { value: 0 } };

  const clothMat = M.toon(0xffffff, { vertexColors: true, map: tex.banner, side: THREE.DoubleSide, alphaTest: 0.5 });
  clothMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = (1.0 - uv.y);
        float ph = position.x * 0.7 + position.z * 0.5;
        transformed.x += sin(uTime * 1.7 + ph) * 0.12 * sway * sway;
        transformed.z += sin(uTime * 2.3 + ph * 1.3 + uv.y * 3.0) * 0.16 * sway;`);
  };
  clothMat.customProgramCacheKey = () => 'gloomfen-cloth';

  const MATS = {
    toon: { mat: M.toon(0xffffff, { vertexColors: true }), outline: 0.04, cast: true, uv: false },
    flat: { mat: M.toon(0xffffff, { vertexColors: true }), outline: 0, cast: false, uv: false },
    glow: { mat: new THREE.MeshBasicMaterial({ vertexColors: true }), outline: 0, cast: false, uv: false, noNormal: true },
    wood: { mat: M.toon(0xffffff, { vertexColors: true, map: tex.wood }), outline: 0.035, cast: true, uv: true },
    stone: { mat: M.toon(0xffffff, { vertexColors: true, map: tex.stone }), outline: 0.035, cast: true, uv: true },
    crate: { mat: M.toon(0xffffff, { vertexColors: true, map: tex.crate }), outline: 0.03, cast: true, uv: true },
    cloth: { mat: clothMat, outline: 0, cast: false, uv: true },
  };
  for (const [k, v] of Object.entries(MATS)) v.mat.name = `level-${k}`;

  function add(mat, geometry, matrix, color, z) {
    const cfg = MATS[mat];
    if (!cfg) throw new Error(`batcher: unknown material ${mat}`);
    if (cfg.outline) M.computeOutlineNormals(geometry);
    const zz = z ?? matrix.elements[14];
    const chunk = Math.max(0, Math.floor((zz - zBase) / chunkSize));
    const key = `${mat}|${chunk}`;
    let b = buckets.get(key);
    if (!b) { b = { mat, chunk, parts: [], verts: 0, idx: 0 }; buckets.set(key, b); }
    let col = color;
    if (typeof col === 'number' || typeof col === 'string') col = new THREE.Color(col);
    b.parts.push({ geometry, matrix, color: col, uvScale: null });
    b.verts += geometry.attributes.position.count;
    b.idx += geometry.index.count;
    return b.parts[b.parts.length - 1];
  }

  /**
   * Box with world-scaled UVs. Without `matrix` min/max are world coords; with `matrix`
   * min/max are local coords transformed by it (the chunk follows the matrix).
   */
  function addBox(mat, min, max, color, uvScale = 1.5, matrix = null) {
    const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / uvScale, uv.getY(i) * dims[f][1] / uvScale);
    }
    g.userData.disposable = true;
    const m = T((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    if (matrix) m.premultiply(matrix);
    return add(mat, g, m, color);
  }

  function build(scene) {
    const group = new THREE.Group(); group.name = 'level-props';
    const meshes = [];
    for (const b of buckets.values()) {
      const cfg = MATS[b.mat];
      const geo2 = mergeParts(b.parts, { normal: !cfg.noNormal, uv: cfg.uv, outline: !!cfg.outline });
      const mesh = new THREE.Mesh(geo2, cfg.mat);
      mesh.name = `props-${b.mat}-${b.chunk}`;
      mesh.castShadow = cfg.cast; mesh.receiveShadow = b.mat !== 'glow';
      if (cfg.outline) M.outline(mesh, cfg.outline);
      group.add(mesh);
      meshes.push(mesh);
    }
    buckets.clear();
    scene.add(group);
    return { group, meshes, materials: Object.values(MATS).map((c) => c.mat), windUniforms };
  }

  return { add, addBox, build, MATS, windUniforms };
}

// colour function helpers ---------------------------------------------------
/** Vertical gradient (local y from y0 to y1). */
export const grad = (c0, c1, y0 = 0, y1 = 1) => (px, py, pz, nx, ny, nz, out) => out.copy(c0).lerp(c1, clamp((py - y0) / (y1 - y0), 0, 1));
/** Top faces get `top`, sides `side` (by local normal). */
export const topSide = (top, side, k = 0.6) => (px, py, pz, nx, ny, nz, out) => out.copy(side).lerp(top, smoothstep(k - 0.15, k + 0.15, ny));

// ---------------------------------------------------------------------------
// decor builders (B = batcher, r = seeded rand)
// ---------------------------------------------------------------------------
const taperTube = (curve, segs, radius, radial, t0 = 1.0, t1 = 0.35) => {
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const p = g.attributes.position;
  const pts = curve.getSpacedPoints(segs);
  // TubeGeometry: (segs+1) rings of (radial+1) verts
  for (let s = 0; s <= segs; s++) {
    const c = pts[s], t = lerp(t0, t1, s / segs);
    for (let k = 0; k <= radial; k++) {
      const i = s * (radial + 1) + k;
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * t, c.y + (p.getY(i) - c.y) * t, c.z + (p.getZ(i) - c.z) * t);
    }
  }
  g.computeVertexNormals();
  g.userData.disposable = true;
  return g;
};

/** Twisted bog tree with layered canopy blobs, hanging moss and the odd glowing shelf fungus. */
export function addTree(B, x, y, z, s, r, opts = {}) {
  const h = (6.5 + r() * 4) * s;
  const lean = opts.lean ?? (r() - 0.5) * 0.6;
  const yaw = r() * Math.PI * 2;
  const pts = [];
  for (let j = 0; j <= 5; j++) {
    const t = j / 5;
    pts.push(new THREE.Vector3(Math.sin(t * 2.6 + yaw) * 0.7 * s * t + lean * t * t * h * 0.3, t * h, Math.cos(t * 2.1 + yaw) * 0.6 * s * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunkR = (0.42 + r() * 0.12) * s;
  const barkFn = (px, py, pz, nx, ny, nz, out) => {
    const k = valueNoise2(Math.atan2(pz - 0, px) * 2.5, py * 0.6);
    out.copy(PCOL.barkDark).lerp(PCOL.bark, clamp(py / (h * 0.5), 0, 1) * 0.8 + k * 0.25).lerp(PCOL.mossDark, smoothstep(0.3, 0.0, py) * 0.6);
  };
  B.add('toon', taperTube(curve, 9, trunkR, 7, 1.25, 0.4), T(x, y - 0.3, z), barkFn);
  // root flares
  const roots = 4 + (r() * 2 | 0);
  for (let k = 0; k < roots; k++) {
    const a = yaw + (k / roots) * Math.PI * 2 + r() * 0.4;
    B.add('toon', G.cone(5), T(x + Math.cos(a) * trunkR * 0.9, y - 0.25, z + Math.sin(a) * trunkR * 0.9, -a + Math.PI / 2, 0, -1.05, trunkR * 0.55, 1.4 * s, trunkR * 0.4), PCOL.barkDark);
  }
  // branches + canopy clusters
  const tips = [curve.getPoint(1)];
  const nb = opts.branches ?? 2 + (r() * 2 | 0);
  for (let k = 0; k < nb; k++) {
    const t = 0.5 + r() * 0.32;
    const o = curve.getPoint(t);
    const a = yaw + k * 2.4 + r();
    const len = (2.2 + r() * 1.8) * s;
    const bc = new THREE.CatmullRomCurve3([
      o.clone(),
      o.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.5, len * 0.25, Math.sin(a) * len * 0.5)),
      o.clone().add(new THREE.Vector3(Math.cos(a) * len, len * 0.55 + r() * 0.6, Math.sin(a) * len)),
    ]);
    B.add('toon', taperTube(bc, 4, trunkR * 0.45, 5, 1, 0.45), T(x, y - 0.3, z), PCOL.bark);
    tips.push(bc.getPoint(1));
  }
  const canopyFn = (dark, top) => (px, py, pz, nx, ny, nz, out) => out.copy(dark).lerp(top, smoothstep(-0.3, 0.7, ny) * 0.9 + smoothstep(-0.2, 0.6, py) * 0.1);
  const leafTop = opts.autumn ? new THREE.Color(0x8a9a40) : PCOL.leafTop;
  for (let ti = 0; ti < tips.length; ti++) {
    const tp = tips[ti];
    const cs = (ti === 0 ? 2.3 : 1.6) * s * (0.85 + r() * 0.3);
    const layers = 2 + (r() < 0.5 ? 1 : 0);
    for (let l = 0; l < layers; l++) {
      const rr = cs * (1 - l * 0.28);
      const ox = (r() - 0.5) * cs * 0.6, oz = (r() - 0.5) * cs * 0.6;
      B.add('toon', G.blob(1 + ((r() * 4) | 0)), T(x + tp.x + ox, y - 0.3 + tp.y + l * cs * 0.42 - 0.2, z + tp.z + oz, r() * 6, 0, 0, rr * 1.25, rr * 0.62, rr * 1.15), canopyFn(ti % 2 ? PCOL.leafB : PCOL.leafA, leafTop));
    }
    // hanging moss strands under the canopy
    const strands = r() < 0.55 ? 1 + (r() * 3 | 0) : 0;
    for (let k = 0; k < strands; k++) {
      const a = r() * Math.PI * 2, d = cs * (0.55 + r() * 0.5);
      const len = (0.5 + r() * 0.9) * s;
      B.add('flat', G.cone(3), T(x + tp.x + Math.cos(a) * d, y - 0.3 + tp.y - 0.05 - len, z + tp.z + Math.sin(a) * d, r() * 3, Math.PI, 0, 0.05 * s, len, 0.05 * s), grad(PCOL.mossDeep, PCOL.mossDark, 0, 1));
    }
  }
  // glowing shelf fungus on the trunk
  if (opts.fungus ?? r() < 0.45) {
    const col = r() < 0.5 ? glowColor(0x5ef2e0, 1.4) : glowColor(0xff5fb2, 1.2);
    for (let k = 0; k < 3; k++) {
      const t = 0.15 + k * 0.09 + r() * 0.05;
      const o = curve.getPoint(t);
      const a = yaw + r() * 2;
      B.add('glow', G.hemi(8), T(x + o.x + Math.cos(a) * trunkR * 0.95, y - 0.3 + o.y, z + o.z + Math.sin(a) * trunkR * 0.95, -a, 0, 0, 0.32 * s, 0.1 * s, 0.32 * s), col);
    }
  }
  return { top: y + h, trunkR };
}

/** Faceted mossy rock. */
export function addRock(B, x, y, z, s, r, opts = {}) {
  const v = (r() * 6) | 0;
  const moss = opts.moss ?? 0.7;
  const fn = (px, py, pz, nx, ny, nz, out) => {
    const k = valueNoise2(px * 3 + v, pz * 3 - v);
    out.copy(k > 0.5 ? PCOL.rock : PCOL.rockDark).lerp(PCOL.rockLight, smoothstep(0.65, 0.95, k) * 0.5);
    out.lerp(PCOL.moss, smoothstep(0.35, 0.85, ny) * moss * (0.6 + 0.4 * k));
  };
  B.add(opts.flat ? 'flat' : 'toon', G.rock(v), T(x, y + s * 0.15, z, r() * 6, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3, s * (1 + r() * 0.5), s * (0.55 + r() * 0.35), s * (0.9 + r() * 0.4)), fn);
}

/** Cluster of glowing mushrooms (stems flat-shaded toon, caps bloom). */
export function addShrooms(B, x, y, z, r, opts = {}) {
  const n = opts.count ?? 3 + (r() * 4 | 0);
  const hex = opts.color ?? (r() < 0.55 ? 0x5ef2e0 : 0xff5fb2);
  const capCol = glowColor(hex, opts.bright ?? 1.45);
  const dimCol = glowColor(hex, 0.75);
  const sc = opts.scale ?? 1;
  const spots = [];
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = k === 0 ? 0 : 0.18 + r() * 0.5 * sc;
    const h = (k === 0 ? 0.55 + r() * 0.5 : 0.2 + r() * 0.45) * sc;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const tilt = (r() - 0.5) * 0.4;
    B.add('flat', G.cylT(0.7, 6), T(px, y - 0.05, pz, 0, tilt, tilt * 0.5, 0.06 * sc + h * 0.06, h + 0.05, 0.06 * sc + h * 0.06), grad(PCOL.cream, new THREE.Color(0xf6efd8), 0, 1));
    const cr = (0.14 + h * 0.32) * (k === 0 ? 1.15 : 1);
    B.add('glow', G.hemi(10), T(px + tilt * h * 0.5, y + h - 0.02, pz, 0, 0, 0, cr, cr * 0.62, cr), (qx, qy, qz, nx, ny, nz, out) => out.copy(dimCol).lerp(capCol, smoothstep(0.0, 0.5, qy)));
    spots.push([px, y + h + cr * 0.5, pz, cr]);
  }
  return { color: hex, spots };
}

/** Reed clump with a couple of cattails. */
export function addReeds(B, x, y, z, r, s = 1) {
  const n = 5 + (r() * 6 | 0);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = r() * 0.45 * s;
    const h = (0.9 + r() * 1.0) * s;
    B.add('flat', G.cone(3), T(x + Math.cos(a) * d, y - 0.1, z + Math.sin(a) * d, r() * 3, (r() - 0.5) * 0.35, (r() - 0.5) * 0.35, 0.045 * s, h, 0.045 * s), grad(PCOL.reedDark, PCOL.reed, 0, 1));
  }
  const nc = r() < 0.7 ? 1 + (r() * 2 | 0) : 0;
  for (let k = 0; k < nc; k++) {
    const a = r() * 6, d = r() * 0.3, h = (1.3 + r() * 0.5) * s;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    B.add('flat', G.cyl(4), T(px, y - 0.1, pz, 0, 0, 0, 0.02, h, 0.02), PCOL.reedDark);
    B.add('flat', G.cyl(6), T(px, y - 0.1 + h - 0.05, pz, 0, 0, 0, 0.06, 0.32, 0.06), PCOL.cattail);
  }
}

/** Floating lily pad (+ optional glowing bud). */
export function addLilyPad(B, x, z, r, s = 1) {
  const sc = (0.45 + r() * 0.7) * s;
  B.add('flat', G.disc(12), T(x, 0.03, z, r() * 6, 0, 0, sc, 1, sc), (px, py, pz, nx, ny, nz, out) => out.copy(PCOL.lilyDark).lerp(PCOL.lily, clamp(Math.hypot(px, pz), 0, 1)));
  if (r() < 0.22) B.add('glow', G.cone(5), T(x + 0.1 * sc, 0.03, z, 0, 0, 0, 0.09, 0.16, 0.09), glowColor(0xff8fd0, 1.2));
}

/** Fern / bush clump (flat leaves fanning out). */
export function addFern(B, x, y, z, r, s = 1) {
  const n = 7 + (r() * 4 | 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.3;
    const len = (0.35 + r() * 0.3) * s;
    B.add('flat', G.cone(3), T(x, y - 0.02, z, -a, 1.25 + r() * 0.3, 0, 0.09 * s, len, 0.02 * s), grad(PCOL.mossDeep, PCOL.leafTop, 0, 1));
  }
}

/** Fallen mossy log (decor). */
export function addLog(B, x, y, z, yaw, len, rad, r) {
  B.add('toon', G.cyl(8), T(x, y + rad * 0.7, z, yaw, Math.PI / 2, 0, rad, len, rad).multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0)),
    (px, py, pz, nx, ny, nz, out) => {
      out.copy(PCOL.bark).lerp(PCOL.barkDark, valueNoise2(py * 4, Math.atan2(pz, px) * 2) * 0.6);
      if (Math.abs(ny) > 0.9) out.copy(PCOL.woodTop);
      out.lerp(PCOL.moss, smoothstep(0.2, 0.9, nz) * 0.7);
    });
  // stubby branch
  B.add('toon', G.cylT(0.5, 5), T(x + Math.sin(yaw) * len * 0.2, y + rad * 1.2, z + Math.cos(yaw) * len * 0.2, yaw, 0.6, 0.8, rad * 0.35, rad * 2.2, rad * 0.35), PCOL.bark);
  addShrooms(B, x - Math.sin(yaw) * len * 0.25, y + rad * 1.3, z - Math.cos(yaw) * len * 0.25, r, { count: 3, scale: 0.6 });
}

// ---------------------------------------------------------------------------
// structure builders: each returns nothing; uses env = { B, physics, hf, r, halos, beacons, foam }
// ---------------------------------------------------------------------------
function collider(env, min, max, surface, tag) {
  return env.physics.addBox({ min, max, surface, tag });
}

const stumpFn = (h0, h1, rr) => (px, py, pz, nx, ny, nz, out) => {
  if (ny > 0.9) {
    const d = Math.hypot(px, pz);
    const ring = 0.5 + 0.5 * Math.sin(d * 22);
    out.copy(PCOL.woodTop).lerp(PCOL.ring, ring * 0.35 + smoothstep(0.8, 1.0, d) * 0.6);
    const mossy = valueNoise2(px * 3 + rr, pz * 3) > 0.62 && d > 0.55;
    if (mossy) out.lerp(PCOL.moss, 0.75);
  } else {
    const a = Math.atan2(pz, px);
    const groove = 0.5 + 0.5 * Math.sin(a * 9 + valueNoise2(py * 2, a) * 2);
    out.copy(PCOL.barkDark).lerp(PCOL.bark, groove * 0.7);
    out.lerp(PCOL.mossDark, smoothstep(0.35, 0.0, py) * 0.7 + smoothstep(0.92, 1, py) * 0.25);
  }
};

export const STRUCTURE_BUILDERS = {
  stump(env, s) {
    const { B, r } = env;
    const base = s.tall ? -1.8 : -1.6;
    const h = s.top - base;
    B.add('toon', G.cylT(0.9, 14), T(s.x, base, s.z, r() * 6, 0, 0, s.r * 1.05, h, s.r * 1.05), stumpFn(0, h, s.r));
    // roots
    const n = 5;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.5;
      B.add('toon', G.cone(5), T(s.x + Math.cos(a) * s.r * 0.95, -0.25, s.z + Math.sin(a) * s.r * 0.95, -a + Math.PI / 2, 0, -1.15, s.r * 0.35, 1.0, s.r * 0.28), PCOL.barkDark);
    }
    if (s.tall) {
      for (let k = 0; k < 5; k++) {
        const a = r() * Math.PI * 2;
        B.add('toon', G.cone(4), T(s.x + Math.cos(a) * s.r * 0.95, s.top - 0.1, s.z + Math.sin(a) * s.r * 0.95, a, 0, 0, 0.14, 0.4 + r() * 0.6, 0.14), PCOL.bark);
      }
    }
    if (r() < 0.6) addShrooms(B, s.x + s.r * 0.75, s.top * 0.4 + 0.2, s.z - s.r * 0.6, r, { count: 3, scale: 0.55 });
    const hh = s.r * 0.72;
    collider(env, [s.x - hh, base, s.z - hh], [s.x + hh, s.top, s.z + hh], 'wood', 'stump');
    env.foam.push({ x: s.x, z: s.z, r: s.r * 1.05 });
  },

  pillar(env, s) {
    const { B, r } = env;
    const h = s.top - s.base;
    const fn = (y0, hh) => (px, py, pz, nx, ny, nz, out) => {
      const wy = y0 + py * hh;                         // world-ish height for strata bands
      const k = valueNoise2(Math.atan2(pz, px) * 3 + s.x, wy * 0.9);
      const band = 0.5 + 0.5 * Math.sin(wy * 2.6 + k * 2.0);
      out.copy(PCOL.rock).lerp(PCOL.rockDark, band * 0.55).lerp(PCOL.rockLight, smoothstep(0.75, 0.95, k) * 0.45);
      if (ny > 0.9) out.copy(PCOL.moss).lerp(PCOL.mossDark, k * 0.5);
      else if (k > 0.7) out.lerp(PCOL.mossDark, 0.5);
    };
    // faceted column: three stacked, slightly offset drums + an overhanging mossy cap
    const h1 = h * 0.42, h2 = h * 0.36, h3 = h - h1 - h2;
    B.add('toon', G.cylT(0.9, 8), T(s.x, s.base, s.z, r() * 6, 0, 0, s.r * 1.15, h1, s.r * 1.15), fn(s.base, h1));
    B.add('toon', G.cylT(0.93, 8), T(s.x + 0.08, s.base + h1 - 0.05, s.z - 0.06, r() * 6, 0, 0, s.r * 1.04, h2 + 0.05, s.r * 1.04), fn(s.base + h1, h2));
    B.add('toon', G.cylT(1.06, 8), T(s.x - 0.05, s.base + h1 + h2 - 0.05, s.z + 0.05, r() * 6, 0, 0, s.r * 0.96, h3 + 0.05, s.r * 0.96), fn(s.base + h1 + h2, h3));
    B.add('toon', G.cylT(1.0, 9), T(s.x, s.top - 0.22, s.z, r() * 6, 0, 0, s.r * 1.08, 0.24, s.r * 1.08), (px, py, pz, nx, ny, nz, out) => out.copy(ny > 0.5 ? PCOL.moss : PCOL.mossDark));
    for (let k = 0; k < 3; k++) addRock(B, s.x + (r() - 0.5) * s.r * 2.6, s.base + 0.2, s.z + (r() - 0.5) * s.r * 2.6, s.r * 0.6, r);
    // trailing vines
    for (let k = 0; k < 4; k++) {
      const a = r() * Math.PI * 2, len = 0.8 + r() * 1.6;
      B.add('flat', G.cone(3), T(s.x + Math.cos(a) * s.r * 0.98, s.top - len + 0.05, s.z + Math.sin(a) * s.r * 0.98, 0, Math.PI, 0, 0.08, len, 0.08), PCOL.mossDark);
    }
    const hh = s.r * 0.72;
    collider(env, [s.x - hh, s.base, s.z - hh], [s.x + hh, s.top, s.z + hh], 'stone', 'pillar');
    if (s.base < 0.2) env.foam.push({ x: s.x, z: s.z, r: s.r * 1.1 });
  },

  rockLedge(env, s) {
    const { B, r } = env;
    const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max;
    const n = Math.max(1, Math.round((x1 - x0) / 2.6));
    const w = (x1 - x0) / n;
    const mossTop = topSide(PCOL.moss, PCOL.white, 0.7);
    for (let k = 0; k < n; k++) {
      const ax = x0 + k * w, bx = ax + w;
      const dz = (r() - 0.5) * 0.25, dy = -r() * 0.04;
      B.addBox('stone', [ax + 0.02, y0, z0 + dz + 0.05], [bx - 0.02, y1 + dy, z1 + dz * 0.5], mossTop, 1.6);
      // moss drape on the front face
      for (let j = 0; j < 2; j++) {
        const px = ax + 0.4 + r() * (w - 0.8), len = 0.4 + r() * 0.7;
        B.add('flat', G.cone(3), T(px, y1 - len + 0.02, z0 - 0.02, 0, Math.PI, 0, 0.16, len, 0.05), PCOL.mossDark);
      }
      if (r() < 0.6) addFern(B, ax + r() * w, y1, z1 - 0.4 - r() * 0.8, r, 0.6);
    }
    collider(env, s.min, s.max, 'stone', 'ledge');
  },

  stoneStep(env, s) {
    const { B, r } = env;
    B.addBox('stone', s.min, s.max, topSide(PCOL.moss, PCOL.white, 0.7), 1.6);
    if (r() < 0.7) addShrooms(B, s.max[0] - 0.3, s.max[1], s.max[2] - 0.3, r, { count: 2, scale: 0.5 });
    collider(env, s.min, s.max, 'stone', 'step');
  },

  brokenBridge(env, s) {
    const { B, r } = env;
    for (const [zz, yy, dir] of [[s.z0, s.y0, 1], [s.z1, s.y1, -1]]) {
      for (const side of [-1, 1]) {
        const px = s.x + side * 1.5;
        B.add('toon', G.cyl(6), T(px, yy - 0.6, zz - dir * 0.6, 0, 0.12 * dir, 0, 0.16, 2.4, 0.16), PCOL.bark);
        // dangling rope
        const top = new THREE.Vector3(px, yy + 1.6, zz - dir * 0.45);
        const rope = new THREE.CatmullRomCurve3([top, top.clone().add(new THREE.Vector3(side * 0.1, -1.5, dir * 0.6)), top.clone().add(new THREE.Vector3(side * 0.25, -3.6 - r(), dir * 0.9))]);
        const g = new THREE.TubeGeometry(rope, 6, 0.04, 4); g.userData.disposable = true;
        B.add('flat', g, new THREE.Matrix4(), PCOL.rope);
      }
      // a few planks still hanging
      for (let k = 0; k < 3; k++) {
        B.addBox('wood', [-1.3, -0.06, -0.2], [1.3, 0.06, 0.2], PCOL.white, 1.2, T(s.x + (r() - 0.5) * 0.4, yy - 0.6 - k * 0.9, zz + dir * (0.1 + k * 0.25), (r() - 0.5) * 0.3, 1.2 + r() * 0.3, (r() - 0.5) * 0.4));
      }
    }
  },

  bridge(env, s) {
    const { B, r } = env;
    const w = s.width;
    for (let z = s.z0 + 0.22; z < s.z1; z += 0.46) {
      const jy = -r() * 0.03;
      B.addBox('wood', [-w / 2 - 0.15 + r() * 0.2, -0.12, -0.2], [w / 2 + 0.15 - r() * 0.2, 0, 0.2], PCOL.white.clone().multiplyScalar(0.85 + r() * 0.25), 1.4, T(s.x, s.y + jy, z, (r() - 0.5) * 0.05));
    }
    for (const side of [-1, 1]) {
      B.addBox('wood', [s.x + side * (w / 2 - 0.4) - 0.15, s.y - 0.45, s.z0], [s.x + side * (w / 2 - 0.4) + 0.15, s.y - 0.12, s.z1], PCOL.barkLight, 1.4);
      // posts + rope rails
      const posts = [];
      for (let z = s.z0 + 0.3; z <= s.z1; z += (s.z1 - s.z0 - 0.6) / 4) posts.push(z);
      for (const pz of posts) B.add('toon', G.cyl(6), T(s.x + side * (w / 2 + 0.1), s.y - 2.6, pz, 0, 0, 0, 0.14, 3.7, 0.14), PCOL.bark);
      for (let k = 0; k < posts.length - 1; k++) {
        for (const ry of [1.05, 0.55]) {
          const a = new THREE.Vector3(s.x + side * (w / 2 + 0.1), s.y + ry, posts[k]);
          const b = new THREE.Vector3(s.x + side * (w / 2 + 0.1), s.y + ry, posts[k + 1]);
          const m = a.clone().lerp(b, 0.5); m.y -= 0.25;
          const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 8, 0.035, 4); g.userData.disposable = true;
          B.add('flat', g, new THREE.Matrix4(), PCOL.rope);
        }
      }
    }
    collider(env, [s.x - w / 2, s.y - 0.4, s.z0], [s.x + w / 2, s.y, s.z1], 'wood', 'bridge');
  },

  palisade(env, s) {
    const { B, r } = env;
    const [ax, az] = s.from, [bx, bz] = s.to;
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const th = s.thick ?? 1.0;
    const rows = th > 1.5 ? 2 : 1;
    const step = 0.46;
    for (let row = 0; row < rows; row++) {
      const off = rows === 1 ? 0 : (row - 0.5) * (th - 0.6);
      const nx = -dz * off, nz = dx * off;
      for (let d = step * 0.5 + (row * step) / 2; d < len; d += step) {
        const px = ax + dx * d + nx, pz = az + dz * d + nz;
        const rr = 0.2 + r() * 0.05;
        const hh = s.height - (row ? 0.5 : 0) + (r() - 0.5) * 0.7;
        const tint = PCOL.bark.clone().lerp(r() < 0.5 ? PCOL.barkLight : PCOL.barkDark, r() * 0.5);
        B.add('toon', G.cyl(6), T(px, s.y - 0.8, pz, r() * 6, (r() - 0.5) * 0.04, (r() - 0.5) * 0.04, rr, hh + 0.8, rr), grad(PCOL.barkDark, tint, 0, 0.5));
        B.add('toon', G.cone(6), T(px, s.y + hh, pz, r() * 6, 0, 0, rr, 0.55 + r() * 0.2, rr), (qx, qy, qz, nx2, ny2, nz2, out) => out.copy(PCOL.woodTop).lerp(PCOL.bark, qy < 0.3 ? 0.6 : 0));
      }
    }
    // binding beams on the inner (+z / toward the level centre) face
    for (const by of [1.2, s.height - 1.0]) {
      const ox = -dz * (th / 2 + 0.08), oz = dx * (th / 2 + 0.08);
      for (const sg of [1, -1]) {
        if (rows === 1 && sg === -1) continue;
        B.add('toon', G.box(), T(ax + dx * len / 2 + ox * sg, s.y + by, az + dz * len / 2 + oz * sg, Math.atan2(dx, dz), 0, 0, 0.16, 0.22, len), PCOL.barkDark);
      }
    }
    const minx = Math.min(ax, bx) - (Math.abs(dz) > 0.5 ? th / 2 : 0), maxx = Math.max(ax, bx) + (Math.abs(dz) > 0.5 ? th / 2 : 0);
    const minz = Math.min(az, bz) - (Math.abs(dx) > 0.5 ? th / 2 : 0), maxz = Math.max(az, bz) + (Math.abs(dx) > 0.5 ? th / 2 : 0);
    collider(env, [minx, s.y - 1.5, minz], [maxx, s.y + s.height, maxz], 'wood', 'wall');
  },

  gatePosts(env, s) {
    const { B } = env;
    for (const side of [-1, 1]) {
      const cx = s.x + side * (s.half + 0.45);
      B.addBox('wood', [cx - 0.5, s.y - 0.6, s.z - 0.6], [cx + 0.5, s.y + s.height, s.z + 0.6], PCOL.barkLight, 1.2);
      B.add('toon', G.cone(4), T(cx, s.y + s.height, s.z, Math.PI / 4, 0, 0, 0.8, 0.9, 0.8), PCOL.strawDark);
      collider(env, [cx - 0.5, s.y - 1, s.z - 0.6], [cx + 0.5, s.y + s.height, s.z + 0.6], 'wood', 'wall');
      if (s.doors === 'open') {
        // door leaf swung fully open, lying flat against the inner face of the wall
        const x0 = s.x + side * (s.half + 0.95), x1 = s.x + side * (s.half + 0.95 + s.half * 0.9);
        const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
        const dz = s.z + 0.62;
        B.addBox('wood', [lo, s.y, dz], [hi, s.y + s.height - 1.4, dz + 0.18], PCOL.white, 1.0);
        for (const by of [0.8, s.height - 2.4]) B.addBox('toon', [lo + 0.05, s.y + by, dz + 0.16], [hi - 0.05, s.y + by + 0.16, dz + 0.24], PCOL.ironDark);
        collider(env, [lo, s.y, dz], [hi, s.y + s.height - 1.4, dz + 0.24], 'wood', 'door');
      }
    }
    if (s.doors !== 'none') {
      B.addBox('wood', [s.x - s.half - 1.0, s.y + s.height - 0.9, s.z - 0.45], [s.x + s.half + 1.0, s.y + s.height - 0.2, s.z + 0.45], PCOL.barkLight, 1.2);
      collider(env, [s.x - s.half, s.y + s.height - 0.9, s.z - 0.45], [s.x + s.half, s.y + s.height - 0.2, s.z + 0.45], 'wood', 'lintel');
      // a battered tin pot hung over the gate as a trophy
      B.add('toon', G.pot(), T(s.x, s.y + s.height - 1.6, s.z - 0.5, 0, 0.25, 0.3, 0.9), PCOL.iron);
    }
  },

  gatehouse(env, s) {
    const { B } = env;
    for (const side of [-1, 1]) {
      const x0 = s.x + side * s.half, x1 = s.x + side * (s.half + 1.6);
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      B.addBox('stone', [lo, s.y - 0.5, s.z0], [hi, s.y + 2.4, s.z1], topSide(PCOL.moss, PCOL.white, 0.7), 1.4);
      B.addBox('wood', [lo + 0.1, s.y + 2.4, s.z0 + 0.1], [hi - 0.1, s.y + s.height, s.z1 - 0.1], PCOL.barkLight, 1.2);
      collider(env, [lo, s.y - 1, s.z0], [hi, s.y + s.height, s.z1], 'stone', 'wall');
    }
    // lintel / walkway over the passage + parapet
    B.addBox('wood', [s.x - s.half - 1.6, s.y + 5.4, s.z0], [s.x + s.half + 1.6, s.y + 6.0, s.z1], PCOL.barkLight, 1.2);
    collider(env, [s.x - s.half, s.y + 5.4, s.z0], [s.x + s.half, s.y + 6.0, s.z1], 'wood', 'lintel');
    for (let k = 0; k < 6; k++) {
      const px = s.x - s.half - 1.2 + k * ((2 * s.half + 2.4) / 5);
      B.add('toon', G.cyl(6), T(px, s.y + 6.0, s.z0 + 0.25, 0, 0, 0, 0.18, 1.2, 0.18), PCOL.bark);
      B.add('toon', G.cone(6), T(px, s.y + 7.2, s.z0 + 0.25, 0, 0, 0, 0.18, 0.45, 0.18), PCOL.woodTop);
    }
  },

  tower(env, s) {
    const { B, r } = env;
    const hs = s.size / 2, top = s.y + s.height, roofY = top + (s.roof ?? 2.6);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [cx, cz] of corners) {
      const px = s.x + cx * (hs - 0.2), pz = s.z + cz * (hs - 0.2);
      B.add('toon', G.cyl(6), T(px, s.y - 0.5, pz, 0, 0, 0, 0.17, roofY - s.y + 0.6, 0.17), grad(PCOL.barkDark, PCOL.bark, 0, 0.4));
      collider(env, [px - 0.17, s.y - 0.5, pz - 0.17], [px + 0.17, top + 1.0, pz + 0.17], 'wood', 'post');
    }
    // cross bracing on each side
    const bh = s.height * 0.5;
    for (let side = 0; side < 4; side++) {
      const [ax, az] = corners[side], [bx, bz] = corners[(side + 1) % 4];
      const mx = s.x + (ax + bx) / 2 * (hs - 0.2), mz = s.z + (az + bz) / 2 * (hs - 0.2);
      const yaw = Math.atan2(bx - ax, bz - az);
      const L = Math.hypot(s.size - 0.4, bh);
      for (const sg of [-1, 1]) B.add('toon', G.box(), T(mx, s.y + bh * 0.5 + 0.3, mz, yaw, sg * Math.atan2(bh, s.size - 0.4), 0, 0.1, 0.12, L), PCOL.bark);
      B.add('toon', G.box(), T(mx, s.y + bh + 0.3, mz, yaw, 0, 0, 0.12, 0.14, s.size - 0.3), PCOL.barkDark);
    }
    // platform
    B.addBox('wood', [s.x - hs, top - 0.28, s.z - hs], [s.x + hs, top, s.z + hs], PCOL.white, 1.2);
    collider(env, [s.x - hs, top - 0.28, s.z - hs], [s.x + hs, top, s.z + hs], 'wood', 'platform');
    // railings
    const sides = [['nz', [-hs, -hs], [hs, -hs]], ['px', [hs, -hs], [hs, hs]], ['pz', [hs, hs], [-hs, hs]], ['nx', [-hs, hs], [-hs, -hs]]];
    for (const [name, a, b] of sides) {
      if (s.open === name) continue;
      const lo = [s.x + Math.min(a[0], b[0]), s.z + Math.min(a[1], b[1])], hi = [s.x + Math.max(a[0], b[0]), s.z + Math.max(a[1], b[1])];
      const t = 0.06;
      for (const ry of [0.9, 0.5]) B.addBox('toon', [lo[0] - t, top + ry - 0.05, lo[1] - t], [hi[0] + t, top + ry + 0.05, hi[1] + t], PCOL.bark);
      collider(env, [lo[0] - t, top, lo[1] - t], [hi[0] + t, top + 0.95, hi[1] + t], 'wood', 'rail');
    }
    // roof
    B.add('toon', G.cone(4), T(s.x, roofY, s.z, Math.PI / 4, 0, 0, s.size * 0.95, 1.8, s.size * 0.95), (px, py, pz, nx, ny, nz, out) => out.copy(PCOL.strawDark).lerp(PCOL.straw, 0.3 + 0.5 * valueNoise2(Math.atan2(pz, px) * 8, py * 10)));
    // hanging banner from the platform edge
    const bm = T(s.x, top - 0.25, s.z - hs - 0.05, 0);
    B.add('cloth', geo('bannerPlane', () => new THREE.PlaneGeometry(1.0, 2.0, 2, 6).translate(0, -1.0, 0)), bm, PCOL.white);
    if (s.beacon) {
      const by = roofY + 1.75;
      B.add('toon', G.cylT(1.3, 7), T(s.x, by, s.z, 0, 0, 0, 0.35, 0.45, 0.35), PCOL.ironDark);
      B.add('glow', G.cone(7), T(s.x, by + 0.3, s.z, 0, 0, 0, 0.32, 0.9, 0.32), glowColor(0xffb347, 2.2));
      B.add('glow', G.cone(5), T(s.x, by + 0.35, s.z, 0.5, 0, 0, 0.18, 1.2, 0.18), glowColor(0xffe28a, 2.6));
      env.beacons.push([s.x, by + 0.7, s.z, 0xffb347, 9]);
      env.halos.push([s.x, by + 0.7, s.z, 0xffa040, 3.4, 1]);
    }
  },

  crates(env, s) {
    const { B, r } = env;
    for (const [dx, dz, n] of s.layout) {
      const cx = s.x + dx, cz = s.z + dz;
      for (let k = 0; k < n; k++) {
        const y0 = s.y + k * 1.2;
        const tint = PCOL.white.clone().multiplyScalar(0.82 + r() * 0.25);
        B.addBox('crate', [cx - 0.6, y0, cz - 0.6], [cx + 0.6, y0 + 1.2, cz + 0.6], tint, 1.2);
      }
      collider(env, [cx - 0.6, s.y - 0.2, cz - 0.6], [cx + 0.6, s.y + n * 1.2, cz + 0.6], 'wood', 'crate');
    }
  },

  hut(env, s) {
    const { B } = env;
    const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.z - s.d / 2, z1 = s.z + s.d / 2;
    B.addBox('wood', [x0, s.y - 0.3, z0], [x1, s.y + s.h - 0.25, z1], PCOL.barkLight, 1.2);
    B.addBox('toon', [x0 - 0.35, s.y + s.h - 0.25, z0 - 0.35], [x1 + 0.35, s.y + s.h, z1 + 0.35], (px, py, pz, nx, ny, nz, out) => out.copy(ny > 0.5 ? PCOL.straw : PCOL.strawDark));
    B.addBox('flat', [s.x - 0.55, s.y, z1 + 0.01], [s.x + 0.55, s.y + 1.9, z1 + 0.04], PCOL.ink);
    collider(env, [x0, s.y - 0.3, z0], [x1, s.y + s.h, z1], 'wood', 'hut');
  },

  tent(env, s) {
    const { B } = env;
    const w = 3.2, d = 3.6, h = 2.3;
    const slope = Math.atan2(h, w / 2);
    const L = Math.hypot(h, w / 2);
    for (const side of [-1, 1]) {
      const m = T(s.x, s.y, s.z, s.yaw).multiply(T(side * w / 4, h / 2, 0, 0, 0, side * (Math.PI / 2 - slope), 0.06, L, d));
      B.add('toon', G.box(), m, (px, py, pz, nx, ny, nz, out) => out.copy(PCOL.burlap).lerp(PCOL.burlapDark, 0.5 + 0.5 * Math.sin(pz * 9)));
    }
    for (const e of [-1, 1]) B.add('toon', G.cyl(5), T(s.x, s.y, s.z, s.yaw).multiply(T(0, 0, e * d / 2, 0, 0, 0, 0.07, h + 0.4, 0.07)), PCOL.bark);
    // dark doorway triangle at the front
    const hw = Math.cos(s.yaw), hz = -Math.sin(s.yaw);
    const ex = Math.abs(hw) * w / 2 + Math.abs(Math.sin(s.yaw)) * d / 2, ez = Math.abs(hz) * w / 2 + Math.abs(Math.cos(s.yaw)) * d / 2;
    collider(env, [s.x - ex * 0.8, s.y - 0.2, s.z - ez * 0.8], [s.x + ex * 0.8, s.y + 1.7, s.z + ez * 0.8], 'wood', 'tent');
  },

  campfire(env, s) {
    const { B, r } = env;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      addRock(B, s.x + Math.cos(a) * 0.85, s.y - 0.05, s.z + Math.sin(a) * 0.85, 0.24, r, { moss: 0.1, flat: true });
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI + 0.3;
      B.add('toon', G.cyl(6), T(s.x, s.y + 0.18, s.z, a, Math.PI / 2 - 0.35, 0, 0.09, 1.3, 0.09).multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0)), PCOL.barkDark);
    }
    B.add('glow', G.ico(0), T(s.x, s.y + 0.12, s.z, 0, 0, 0, 0.45, 0.14, 0.45), glowColor(0xff6a2a, 1.2));
    B.add('glow', G.cone(7), T(s.x, s.y + 0.15, s.z, 0, 0, 0, 0.42, 1.0, 0.42), glowColor(0xff9a3a, 1.8));
    B.add('glow', G.cone(5), T(s.x + 0.05, s.y + 0.15, s.z, 0.6, 0, 0, 0.22, 1.35, 0.22), glowColor(0xffe08a, 2.4));
    // cook pot on a tripod
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      B.add('toon', G.cyl(4), T(s.x + Math.cos(a) * 0.9, s.y, s.z + Math.sin(a) * 0.9, -a, 0, 0.42, 0.04, 2.1, 0.04), PCOL.bark);
    }
    B.add('toon', G.pot(), T(s.x, s.y + 1.25, s.z, 0, Math.PI, 0, 0.55), PCOL.ironDark);
    env.halos.push([s.x, s.y + 0.9, s.z, 0xff8a30, 3.2, 1]);
    env.fires.push([s.x, s.y + 0.6, s.z]);
  },

  trophyPile(env, s) {
    const { B, r } = env;
    const sc = s.small ? 0.7 : 1;
    const layers = s.small ? [[4, 0.0], [2, 0.55]] : [[6, 0.0], [4, 0.55], [2, 1.1]];
    for (const [n, y] of layers) {
      for (let k = 0; k < n; k++) {
        const px = s.x + (k - (n - 1) / 2) * 0.62 * sc + (r() - 0.5) * 0.12, pz = s.z + (r() - 0.5) * 0.4;
        const up = r() < 0.5;
        const c = new THREE.Color(0xb4c0cc).lerp(r() < 0.4 ? PCOL.rust : PCOL.iron, r() * 0.55);
        B.add('toon', G.pot(), T(px, s.y + y * sc + (up ? 0 : 0.62 * sc * 0.9), pz, r() * 6, up ? (r() - 0.5) * 0.4 : Math.PI + (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, 0.7 * sc), c);
      }
    }
    B.add('toon', G.cyl(5), T(s.x, s.y, s.z + 0.3, 0, 0, 0, 0.06, 2.6 * sc, 0.06), PCOL.bark);
    B.add('toon', G.pot(), T(s.x, s.y + 2.55 * sc, s.z + 0.3, 0.4, 0.3, 0, 0.8 * sc), PCOL.iron);
    const hw = 2.0 * sc;
    collider(env, [s.x - hw, s.y - 0.2, s.z - 0.6], [s.x + hw, s.y + 1.1 * sc, s.z + 0.6], 'iron', 'trophies');
  },

  pitWall(env, s) {
    const { B, r } = env;
    const R = s.r, th = s.thick, R2 = R + th / 2;
    const segLen = 1.55;
    const N = Math.ceil((Math.PI * 2 * R2) / segLen);
    const stoneCol = (px, py, pz, nx, ny, nz, out) => out.copy(PCOL.white).lerp(PCOL.moss, ny > 0.6 ? 0.55 : 0);
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI * 2;
      const cx = s.x + Math.cos(a) * R2, cz = s.z + Math.sin(a) * R2;
      if (cz < s.z && Math.abs(cx - s.x) < s.gapHalf + 0.9) continue; // entrance
      const h = s.top - s.y + 0.6 + (r() - 0.5) * 0.25;
      const w = (Math.PI * 2 * R2) / N + 0.08;
      const yaw = Math.atan2(Math.cos(a), Math.sin(a)); // face the centre (local z radial)
      B.addBox('stone', [-w / 2, 0, -th / 2], [w / 2, h, th / 2], stoneCol, 1.5, T(cx, s.y - 0.6, cz, yaw));
      if (i % 2 === 0) {
        B.addBox('stone', [-w * 0.3, 0, -th * 0.45], [w * 0.3, 0.6, th * 0.45], stoneCol, 1.5, T(cx, s.y - 0.6 + h, cz, yaw));
      } else if (r() < 0.5) {
        B.add('toon', G.cone(4), T(cx, s.y - 0.6 + h, cz, r(), (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, 0.09, 0.9, 0.09), PCOL.woodTop);
      }
    }
    // colliders: small AABBs around the ring (inner faces at ~R)
    const step = 0.55, size = 0.7;
    const Rc = R + size / 2;
    const Nc = Math.ceil((Math.PI * 2 * Rc) / step);
    for (let i = 0; i < Nc; i++) {
      const a = (i + 0.5) / Nc * Math.PI * 2;
      const cx = s.x + Math.cos(a) * Rc, cz = s.z + Math.sin(a) * Rc;
      if (cz < s.z && Math.abs(cx - s.x) < s.gapHalf + size / 2) continue;
      collider(env, [cx - size / 2, s.y - 1, cz - size / 2], [cx + size / 2, s.top + 0.4, cz + size / 2], 'stone', 'pitWall');
    }
    // gate towers flanking the entrance
    const zIn = s.z - R, zOut = s.z - R - th;
    for (const side of [-1, 1]) {
      const x0 = s.x + side * s.gapHalf, x1 = s.x + side * (s.gapHalf + 3.3);
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      B.addBox('stone', [lo, s.y - 0.6, zOut - 2.0], [hi, s.top + 1.2, zIn + 0.7], stoneCol, 1.5);
      collider(env, [lo, s.y - 1, zOut - 2.0], [hi, s.top + 1.2, zIn + 0.7], 'stone', 'pitWall');
      for (let k = 0; k < 3; k++) {
        B.add('toon', G.cone(4), T(lo + (hi - lo) * (0.2 + k * 0.3), s.top + 1.2, zOut - 0.6, r(), 0, 0, 0.12, 1.1, 0.12), PCOL.bone);
      }
      // big horn-like bones on the towers
      B.add('toon', G.cone(6), T(s.x + side * (s.gapHalf + 0.35), s.top + 0.9, zOut - 2.1, 0, -0.5, side * -0.9, 0.22, 2.4, 0.22), PCOL.bone);
    }
    // lintel bones across the gate top
    B.add('toon', G.cyl(8), T(s.x - s.gapHalf - 0.6, s.top + 0.8, zOut - 1.0, 0, 0, -Math.PI / 2, 0.2, 2 * s.gapHalf + 1.2, 0.2), PCOL.bone);
    // wall sconces on the inner face (no colliders, above head height)
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / 8) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const sx = s.x + ca * (R - 0.25), sz = s.z + sa * (R - 0.25), sy = s.y + 3.4;
      B.add('toon', G.box(), T(sx, sy - 0.1, sz, Math.atan2(ca, sa), 0, 0, 0.12, 0.12, 0.7), PCOL.ironDark);
      B.add('toon', G.cylT(1.4, 7), T(sx - ca * 0.3, sy, sz - sa * 0.3, 0, 0, 0, 0.16, 0.26, 0.16), PCOL.ironDark);
      B.add('glow', G.cone(6), T(sx - ca * 0.3, sy + 0.22, sz - sa * 0.3, 0, 0, 0, 0.15, 0.5, 0.15), glowColor(0xff9a3a, 2.0));
      B.add('glow', G.cone(5), T(sx - ca * 0.3, sy + 0.24, sz - sa * 0.3, 0.7, 0, 0, 0.09, 0.62, 0.09), glowColor(0xffe08a, 2.6));
      env.halos.push([sx - ca * 0.3, sy + 0.5, sz - sa * 0.3, 0xff9040, 2.4, 1]);
      env.fires.push([sx - ca * 0.3, sy + 0.45, sz - sa * 0.3]);
    }
    // rim torches
    const nt = env.data.PIT_TORCHES;
    for (let i = 0; i < nt; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / nt) * Math.PI * 2;
      const tx = s.x + Math.cos(a) * (R + th + 0.7), tz = s.z + Math.sin(a) * (R + th + 0.7);
      if (tz > s.z + R - 1 && Math.abs(tx - s.x) < 5) continue; // throne spot
      STRUCTURE_BUILDERS.torch(env, { x: tx, z: tz, y: s.top - 0.2, tall: 1.2 });
    }
  },

  chiefTotem(env, s) {
    const { B, r } = env;
    // stone dais behind the pit's back wall: a tall totem of trophy tin pots under a glowing crown pot,
    // flanked by torches (the Chief's seat itself is built by the boss area inside the pit)
    B.addBox('stone', [s.x - 3.2, s.y - 0.4, s.z - 2.0], [s.x + 3.2, s.y + 1.4, s.z + 2.2], PCOL.white, 1.4);
    for (const sx of [-1, 1]) STRUCTURE_BUILDERS.torch(env, { x: s.x + sx * 3.6, z: s.z - 1.0, y: s.y, tall: 2.6 });
    const y0 = s.y + 1.4;
    B.add('toon', G.cyl(8), T(s.x, y0 - 0.2, s.z, 0, 0, 0, 0.32, 6.4, 0.32), grad(PCOL.barkDark, PCOL.bark, 0, 0.6));
    for (let k = 0; k < 5; k++) {
      const c = new THREE.Color(0xb4c0cc).lerp(k % 2 ? PCOL.rust : PCOL.iron, 0.3 + r() * 0.3);
      B.add('toon', G.pot(), T(s.x, y0 + 0.9 + k * 0.95, s.z, r() * 6, Math.PI + (r() - 0.5) * 0.3, (r() - 0.5) * 0.3, 0.75 + k * 0.04), c);
    }
    B.add('toon', G.box(), T(s.x, y0 + 4.6, s.z, 0, 0, 0, 4.2, 0.22, 0.22), PCOL.barkDark);
    for (const sx of [-1.8, -0.9, 0.9, 1.8]) STRUCTURE_BUILDERS.bone(env, { x: s.x + sx, y: y0 + 4.1, z: s.z - 0.15, s: 0.5 });
    B.add('toon', G.pot(), T(s.x, y0 + 6.1, s.z, 0, 0.15, 0, 1.25), PCOL.iron);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      B.add('toon', G.cone(4), T(s.x + Math.cos(a) * 0.55, y0 + 6.75, s.z + Math.sin(a) * 0.55, 0, 0, 0, 0.12, 0.6, 0.12), PCOL.mustard);
    }
    B.add('glow', G.sphere(8, 6), T(s.x, y0 + 7.15, s.z, 0, 0, 0, 0.26), glowColor(0xffc35a, 2.2));
    for (let k = 0; k < 4; k++) STRUCTURE_BUILDERS.bone(env, { x: s.x + (r() - 0.5) * 5, y: s.y + 1.42, z: s.z - 0.8 - r() * 1.0, s: 0.6 + r() * 0.4 });
    env.halos.push([s.x, y0 + 7.15, s.z, 0xffc35a, 3.0, 0]);
  },

  barrels(env, s) {
    const { B, r } = env;
    const band = (px, py, pz, nx, ny, nz, out) => {
      if (Math.abs(ny) > 0.9) out.copy(PCOL.woodTop);
      else out.copy((py > 0.12 && py < 0.2) || (py > 0.8 && py < 0.88) ? PCOL.ironDark : PCOL.barkLight).lerp(PCOL.bark, 0.5 + 0.5 * Math.sin(Math.atan2(pz, px) * 8) * 0.4);
    };
    for (let k = 0; k < s.n; k++) {
      const a = (k / Math.max(1, s.n)) * Math.PI * 2 + r(), d = s.n > 1 ? 0.55 : 0;
      const bx = s.x + Math.cos(a) * d, bz = s.z + Math.sin(a) * d;
      B.add('toon', geo('barrel', () => {
        const pts = [[0, 0], [0.4, 0], [0.47, 0.25], [0.49, 0.5], [0.47, 0.75], [0.4, 1.0], [0, 1.0]].map(([x, y]) => new THREE.Vector2(x, y));
        return new THREE.LatheGeometry(pts, 10);
      }), T(bx, s.y, bz, r() * 6, 0, 0, 1, 1.05 + r() * 0.1, 1), band);
      collider(env, [bx - 0.42, s.y, bz - 0.42], [bx + 0.42, s.y + 1.05, bz + 0.42], 'wood', 'barrel');
    }
    const ns = s.sacks ?? 2;
    for (let k = 0; k < ns; k++) {
      const a = r() * Math.PI * 2, d = 0.9 + r() * 0.5;
      B.add('toon', G.sphere(8, 6), T(s.x + Math.cos(a) * d, s.y + 0.22, s.z + Math.sin(a) * d, r() * 6, (r() - 0.5) * 0.4, 0, 0.42, 0.3, 0.32), (px, py, pz, nx, ny, nz, out) => out.copy(PCOL.burlap).lerp(PCOL.burlapDark, smoothstep(0.2, -0.6, ny)));
    }
  },

  bone(env, s) {
    const { B, r } = env;
    const yaw = r() * Math.PI * 2, L = 1.3 * s.s;
    const m = T(s.x, s.y + 0.12 * s.s, s.z, yaw, Math.PI / 2, 0);
    B.add('flat', G.cyl(6), m.clone().multiply(T(0, -L / 2, 0, 0, 0, 0, 0.09 * s.s, L, 0.09 * s.s)), PCOL.bone);
    for (const e of [-1, 1]) for (const o of [-1, 1]) B.add('flat', G.sphere(6, 4), m.clone().multiply(T(o * 0.1 * s.s, e * L / 2, 0, 0, 0, 0, 0.14 * s.s)), PCOL.bone);
  },

  ribcage(env, s) {
    const { B } = env;
    const yaw = s.yaw;
    for (let k = 0; k < 5; k++) {
      const z = (k - 2) * 0.55 * s.s;
      for (const side of [-1, 1]) {
        const g = geo('rib', () => new THREE.TorusGeometry(1, 0.07, 5, 10, Math.PI * 0.62));
        const m = T(s.x, s.y, s.z, yaw).multiply(T(0, 0, z, side < 0 ? Math.PI : 0, 0, 0, s.s * (1.1 - Math.abs(k - 2) * 0.15)));
        B.add('flat', g, m, PCOL.bone);
      }
    }
    B.add('flat', G.cyl(6), T(s.x, s.y + 0.1, s.z, yaw, Math.PI / 2, 0).multiply(T(0, -1.6 * s.s, 0, 0, 0, 0, 0.1 * s.s, 3.2 * s.s, 0.1 * s.s)), PCOL.bone);
  },

  torch(env, s) {
    const { B } = env;
    const hgt = s.tall ?? 1.7;
    B.add('toon', G.cyl(6), T(s.x, s.y - 0.3, s.z, 0, 0, 0, 0.09, hgt + 0.3, 0.09), PCOL.bark);
    B.add('toon', G.cylT(1.4, 7), T(s.x, s.y + hgt - 0.05, s.z, 0, 0, 0, 0.17, 0.3, 0.17), PCOL.ironDark);
    B.add('glow', G.cone(6), T(s.x, s.y + hgt + 0.18, s.z, 0, 0, 0, 0.17, 0.55, 0.17), glowColor(0xff9a3a, 2.0));
    B.add('glow', G.cone(5), T(s.x, s.y + hgt + 0.2, s.z, 0.7, 0, 0, 0.1, 0.7, 0.1), glowColor(0xffe08a, 2.6));
    env.halos.push([s.x, s.y + hgt + 0.45, s.z, 0xff9040, 2.0, 1]);
    env.fires.push([s.x, s.y + hgt + 0.4, s.z]);
  },

  lantern(env, s) {
    const { B } = env;
    const yaw = s.yaw ?? 0;
    const ax = Math.sin(yaw) * 0.55, az = Math.cos(yaw) * 0.55;
    B.add('toon', G.cyl(6), T(s.x, s.y - 0.3, s.z, 0, 0, 0, 0.08, 2.75, 0.08), PCOL.bark);
    B.add('toon', G.box(), T(s.x + ax * 0.5, s.y + 2.35, s.z + az * 0.5, yaw, 0, 0, 0.07, 0.07, 0.65), PCOL.bark);
    B.add('toon', G.cylT(0.75, 6), T(s.x + ax, s.y + 1.86, s.z + az, 0, 0, 0, 0.16, 0.36, 0.16), PCOL.ironDark);
    B.add('toon', G.cone(6), T(s.x + ax, s.y + 2.2, s.z + az, 0, 0, 0, 0.2, 0.18, 0.2), PCOL.ironDark);
    B.add('glow', G.sphere(8, 6), T(s.x + ax, s.y + 2.03, s.z + az, 0, 0, 0, 0.13), glowColor(0xffc35a, 2.2));
    env.halos.push([s.x + ax, s.y + 2.03, s.z + az, 0xffc35a, 1.6, 0]);
  },

  banner(env, s) {
    const { B } = env;
    B.add('toon', G.cyl(6), T(s.x, s.y - 0.4, s.z, 0, 0, 0, 0.08, 4.6, 0.08), PCOL.bark);
    B.add('toon', G.box(), T(s.x, s.y + 4.0, s.z, s.yaw, 0, 0, 1.3, 0.08, 0.08), PCOL.bark);
    B.add('toon', G.pot(), T(s.x, s.y + 4.2, s.z, 0, 0, 0, 0.28), PCOL.iron);
    B.add('cloth', geo('bannerPlane', () => new THREE.PlaneGeometry(1.0, 2.0, 2, 6).translate(0, -1.0, 0)), T(s.x, s.y + 3.95, s.z, s.yaw, 0, 0, 1.15, 1.25, 1), PCOL.white);
  },
};

// ---------------------------------------------------------------------------
// Ambient renderables
// ---------------------------------------------------------------------------
const POINT_VERT = /* glsl */`
attribute vec3 color;
attribute vec2 info;      // x = size (m), y = phase / flicker flag
uniform float uTime;
uniform float uScale;
uniform float uFogDensity;
uniform float uFogScale;
uniform float uAnim;      // 1 = fireflies wander + blink, 0 = halos (flicker if info.y > 0)
varying vec3 vColor;
void main() {
  vec3 p = position;
  float ph = info.y;
  float k = 1.0;
  if (uAnim > 0.5) {
    p += vec3(sin(uTime * 0.37 + ph) * 1.3, sin(uTime * 0.83 + ph * 2.0) * 0.4, cos(uTime * 0.29 + ph * 1.3) * 1.3);
    float b = 0.5 + 0.5 * sin(uTime * (1.4 + fract(ph) * 1.8) + ph * 7.0);
    k = 0.25 + 0.75 * b * b;
  } else if (ph > 0.5) {
    k = 0.8 + 0.12 * sin(uTime * 11.0 + ph * 3.0) + 0.08 * sin(uTime * 23.0 + ph * 5.0);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  gl_PointSize = info.x * uScale / max(depth, 0.5);
  float f = uFogDensity * uFogScale * depth;
  float fog = exp(-f * f);
  vColor = color * k * fog;
}`;
const POINT_FRAG = /* glsl */`
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * (0.6 + 0.4 * smoothstep(0.5, 0.0, d));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Additive soft points: halos, beacons (fogScale low) and fireflies (anim).
 * items: [[x, y, z, hexColor, size, flickerOrPhase]], intensity multiplies colours.
 */
export function createPoints(ctx, items, opts = {}) {
  const n = items.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), info = new Float32Array(n * 2);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    pos[i * 3] = it[0]; pos[i * 3 + 1] = it[1]; pos[i * 3 + 2] = it[2];
    c.set(it[3]).multiplyScalar(opts.intensity ?? 1);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    info[i * 2] = it[4]; info[i * 2 + 1] = it[5] ?? 0;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('info', new THREE.BufferAttribute(info, 2));
  g.computeBoundingSphere();
  const uniforms = {
    uTime: { value: 0 }, uScale: { value: 500 }, uFogDensity: { value: 0.012 }, uFogScale: { value: opts.fogScale ?? 1 }, uAnim: { value: opts.anim ? 1 : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = !opts.anim && !opts.noCull;
  pts.name = opts.name || 'points';
  pts.renderOrder = 5;
  ctx.scene.add(pts);
  return {
    object: pts, uniforms,
    frame(time) {
      uniforms.uTime.value = time;
      const cam = ctx.camera;
      uniforms.uScale.value = (ctx.gfx.height * ctx.renderer.getPixelRatio() * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
      uniforms.uFogDensity.value = ctx.scene.fog ? ctx.scene.fog.density : 0;
    },
  };
}

/**
 * Instanced grass tufts with vertex-shader wind, chunked along z for culling.
 * spots: [[x, y, z, scale, yaw, tint]]
 */
export function createGrass(ctx, spots, opts = {}) {
  const M = ctx.materials;
  const chunkSize = opts.chunkSize ?? 48, zBase = opts.zBase ?? -48;
  // tuft: 5 blades fanning out
  const pos = [], cols = [], nor = [];
  const base = new THREE.Color(0x3b6a33), tip = new THREE.Color(0xa9cf62);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const ox = Math.cos(a) * 0.06, oz = Math.sin(a) * 0.06;
    const lx = Math.cos(a + Math.PI / 2) * 0.045, lz = Math.sin(a + Math.PI / 2) * 0.045;
    const h = 0.32 + (k % 3) * 0.09;
    const lean = 0.12 + (k % 2) * 0.06;
    pos.push(ox - lx, 0, oz - lz, ox + lx, 0, oz + lz, ox * 3 + Math.cos(a) * lean, h, oz * 3 + Math.sin(a) * lean);
    for (let j = 0; j < 3; j++) nor.push(0, 1, 0);
    cols.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const uniforms = { uTime: { value: 0 } };
  const mat = M.toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 wp = vec2(0.0);
        #endif
        float bend = position.y * position.y * 6.0;
        float w = sin(uTime * 1.6 + wp.x * 0.35 + wp.y * 0.21) * 0.6 + sin(uTime * 2.7 + wp.x * 0.9 - wp.y * 0.6) * 0.4;
        transformed.x += w * 0.09 * bend;
        transformed.z += cos(uTime * 1.3 + wp.y * 0.4) * 0.05 * bend;`);
  };
  mat.customProgramCacheKey = () => 'gloomfen-grass';
  mat.name = 'level-grass';
  const byChunk = new Map();
  for (const s of spots) {
    const k = Math.max(0, Math.floor((s[2] - zBase) / chunkSize));
    if (!byChunk.has(k)) byChunk.set(k, []);
    byChunk.get(k).push(s);
  }
  const group = new THREE.Group(); group.name = 'grass';
  const meshes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), ev = new THREE.Euler(), cc = new THREE.Color();
  for (const [, list] of byChunk) {
    const im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((s, i) => {
      ev.set(0, s[4], 0);
      m4.compose(pv.set(s[0], s[1] - 0.02, s[2]), q.setFromEuler(ev), sv.set(s[3], s[3] * (0.8 + (i % 7) * 0.07), s[3]));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, cc.copy(s[5]));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere(); im.computeBoundingBox();
    im.receiveShadow = true;
    im.castShadow = false;
    group.add(im);
    meshes.push(im);
  }
  ctx.scene.add(group);
  return { group, meshes, uniforms, material: mat, geometry: g };
}

/**
 * Distant silhouette rings (hills + spiky treelines) around the level. Unlit, no fog,
 * vertex colours fade into the fog colour at the bottom.
 */
export function createBackdrop(ctx, fogColor) {
  const layers = [
    { rx: 150, rz: 330, h: 26, col: 0x17302f, trees: 0.8, seed: 3 },
    { rx: 215, rz: 390, h: 44, col: 0x1f3d3b, trees: 0.45, seed: 7 },
    { rx: 285, rz: 455, h: 70, col: 0x2a4c48, trees: 0.15, seed: 11 },
  ];
  const cz = 200;
  const pos = [], col = [], idx = [];
  const bottom = new THREE.Color(fogColor), c = new THREE.Color();
  for (const L of layers) {
    const N = 260;
    const r = rand(L.seed);
    const top = [];
    for (let i = 0; i < N; i++) {
      const t = i / N;
      let h = L.h * (0.45 + 0.55 * valueNoise2(t * 9 + L.seed, 0.5)) + L.h * 0.25 * valueNoise2(t * 31, L.seed);
      if (r() < L.trees) h += 3 + r() * 6 * (L.h / 30);
      top.push(h);
    }
    const v0 = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * L.rx, z = cz + Math.sin(a) * L.rz;
      const h = top[i % N];
      pos.push(x, -25, z, x, h, z);
      c.copy(bottom); col.push(c.r, c.g, c.b);
      c.set(L.col); col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < N; i++) {
      const a = v0 + i * 2, b = a + 2;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: true });
  mat.name = 'level-backdrop';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'backdrop';
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  ctx.scene.add(mesh);
  return { mesh, material: mat, geometry: g };
}
