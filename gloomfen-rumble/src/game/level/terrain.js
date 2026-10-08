// Gloomfen terrain: a heightfield composed from shape "features" (data.js), baked
// into a 1 m grid. Physics samples the grid with the SAME triangle split the mesh
// uses, so what you see is exactly what you stand on.
//
//   const hf = createHeightfield(TERRAIN);          // pure (no DOM), usable from node
//   hf.sample(x, z) / hf.normal(x, z, out) / hf.surfaceAt(x, z) / hf.paintAt(x, z)
//   const meshes = buildTerrainMeshes(ctx, hf);     // chunked, vertex-coloured toon meshes
//   const tex = buildDepthTexture(hf, extraFoam)    // water depth + foam mask for water.js
import * as THREE from 'three';
import { valueNoise2, smoothstep, clamp, lerp } from '../../core/mathx.js';

// ---------------------------------------------------------------------------
// Feature evaluation (pure)
// ---------------------------------------------------------------------------
// Feature shapes (see data.js):
//   { shape:'circle', x, z, r }            (rx/rz for an ellipse)
//   { shape:'ring', x, z, r0, r1 }
//   { shape:'rect', x0, z0, x1, z1, round }
//   { shape:'path', pts:[[x, z, y, halfWidth], ...] }   y / width interpolate along the line
// Common: y (target height, path uses per-point y), op:'set'|'min'|'max'|'paint',
//   edge (blend width outside the shape, m), rough (noise amplitude inside),
//   paint:'dirt'|'stone'|'mud'|'sand' (+ paintAmount), clip:{zmin,zmax,xmin,xmax,edge}
export const PAINTS = ['dirt', 'stone', 'mud', 'sand'];

export function fbm(x, z) {
  return valueNoise2(x, z) * 0.55 + valueNoise2(x * 2.07 + 17.3, z * 2.07 - 5.1) * 0.3 + valueNoise2(x * 4.31 - 3.7, z * 4.31 + 11.9) * 0.15;
}

function prepFeature(f) {
  const e = (f.edge ?? 2) + 0.01;
  let x0, x1, z0, z1;
  if (f.shape === 'circle') {
    const rx = f.rx ?? f.r, rz = f.rz ?? f.r;
    x0 = f.x - rx; x1 = f.x + rx; z0 = f.z - rz; z1 = f.z + rz;
  } else if (f.shape === 'ring') {
    x0 = f.x - f.r1; x1 = f.x + f.r1; z0 = f.z - f.r1; z1 = f.z + f.r1;
  } else if (f.shape === 'rect') {
    x0 = f.x0; x1 = f.x1; z0 = f.z0; z1 = f.z1;
  } else if (f.shape === 'path') {
    x0 = z0 = Infinity; x1 = z1 = -Infinity;
    for (const p of f.pts) {
      x0 = Math.min(x0, p[0] - p[3]); x1 = Math.max(x1, p[0] + p[3]);
      z0 = Math.min(z0, p[1] - p[3]); z1 = Math.max(z1, p[1] + p[3]);
    }
  } else throw new Error(`terrain: unknown shape ${f.shape}`);
  const c = f.clip || {};
  if (c.xmin !== undefined) x0 = Math.max(x0, c.xmin - (c.edge ?? 0.6));
  if (c.xmax !== undefined) x1 = Math.min(x1, c.xmax + (c.edge ?? 0.6));
  if (c.zmin !== undefined) z0 = Math.max(z0, c.zmin - (c.edge ?? 0.6));
  if (c.zmax !== undefined) z1 = Math.min(z1, c.zmax + (c.edge ?? 0.6));
  f._bb = [x0 - e, z0 - e, x1 + e, z1 + e];
  f._edge = e - 0.01;
}

// evaluation scratch
let _d = 0, _y = 0;
function evalShape(f, x, z) {
  switch (f.shape) {
    case 'circle': {
      const rx = f.rx ?? f.r, rz = f.rz ?? f.r;
      const dx = (x - f.x) / rx, dz = (z - f.z) / rz;
      _d = (Math.sqrt(dx * dx + dz * dz) - 1) * Math.min(rx, rz);
      _y = f.y; return;
    }
    case 'ring': {
      const d = Math.hypot(x - f.x, z - f.z);
      _d = Math.max(f.r0 - d, d - f.r1);
      _y = f.y; return;
    }
    case 'rect': {
      const r = f.round || 0;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      const hx = (f.x1 - f.x0) / 2 - r, hz = (f.z1 - f.z0) / 2 - r;
      const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz;
      const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
      _d = Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r;
      _y = f.y; return;
    }
    case 'path': {
      const P = f.pts;
      let best = Infinity, by = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const abx = b[0] - a[0], abz = b[1] - a[1];
        const L2 = abx * abx + abz * abz || 1e-9;
        let t = ((x - a[0]) * abx + (z - a[1]) * abz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a[0] + abx * t, pz = a[1] + abz * t;
        const w = a[3] + (b[3] - a[3]) * t;
        const d = Math.hypot(x - px, z - pz) - w;
        if (d < best) { best = d; by = a[2] + (b[2] - a[2]) * t; }
      }
      _d = best; _y = f.y ?? by; return;
    }
  }
}

function clipMask(c, x, z) {
  const e = c.edge ?? 0.6;
  let m = 1;
  if (c.zmin !== undefined) m *= 1 - smoothstep(0, e, c.zmin - z);
  if (c.zmax !== undefined) m *= 1 - smoothstep(0, e, z - c.zmax);
  if (c.xmin !== undefined) m *= 1 - smoothstep(0, e, c.xmin - x);
  if (c.xmax !== undefined) m *= 1 - smoothstep(0, e, x - c.xmax);
  return m;
}

/**
 * Compose the raw (un-gridded) height at x,z. Also fills paintOut[4] (dirt, stone, mud, sand) if given.
 */
export function composeHeight(T, x, z, paintOut) {
  let h = T.base(x, z);
  let rough = T.baseRough ?? 2;
  if (paintOut) paintOut[0] = paintOut[1] = paintOut[2] = paintOut[3] = 0;
  const F = T.features;
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    const bb = f._bb;
    if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
    evalShape(f, x, z);
    const e = f._edge;
    if (_d >= e) continue;
    let m = _d <= 0 ? 1 : 1 - smoothstep(0, e, _d);
    if (f.clip) m *= clipMask(f.clip, x, z);
    if (m <= 0) continue;
    if (f.paint && paintOut) {
      const k = PAINTS.indexOf(f.paint);
      const pm = (f.paintEdge !== undefined ? (_d <= 0 ? 1 : 1 - smoothstep(0, f.paintEdge, _d)) * (f.clip ? clipMask(f.clip, x, z) : 1) : m) * (f.paintAmount ?? 1);
      if (pm > paintOut[k]) paintOut[k] = pm;
    }
    if (f.op === 'paint') continue;
    const nh = h + (_y - h) * m;
    if (f.op === 'min') h = Math.min(h, nh);
    else if (f.op === 'max') h = Math.max(h, nh);
    else h = nh;
    if (f.rough !== undefined || f.op === 'set' || !f.op) rough = rough + ((f.rough ?? 0.15) - rough) * m;
  }
  if (rough > 0) h += rough * (fbm(x * 0.11 + 3.1, z * 0.11 - 7.7) - 0.5) * 2;
  return h;
}

// ---------------------------------------------------------------------------
// Heightfield grid
// ---------------------------------------------------------------------------
/**
 * Bake the terrain description into a grid.
 * T = { grid:{x0,x1,z0,z1,cell}, base(x,z), baseRough, features:[...] }
 */
export function createHeightfield(T) {
  for (const f of T.features) prepFeature(f);
  const { x0, x1, z0, z1, cell } = T.grid;
  const nx = Math.round((x1 - x0) / cell) + 1;
  const nz = Math.round((z1 - z0) / cell) + 1;
  const H = new Float32Array(nx * nz);
  const P = new Uint8Array(nx * nz * 4);   // paint weights 0..255
  const paint = [0, 0, 0, 0];
  for (let iz = 0; iz < nz; iz++) {
    const z = z0 + iz * cell;
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * cell;
      const i = iz * nx + ix;
      H[i] = composeHeight(T, x, z, paint);
      for (let k = 0; k < 4; k++) P[i * 4 + k] = Math.round(clamp(paint[k], 0, 1) * 255);
    }
  }
  const inv = 1 / cell;
  const at = (ix, iz) => {
    ix = ix < 0 ? 0 : ix >= nx ? nx - 1 : ix;
    iz = iz < 0 ? 0 : iz >= nz ? nz - 1 : iz;
    return H[iz * nx + ix];
  };

  // Triangle split matches buildTerrainMeshes: quad (ix,iz) -> (00,01,11) if fz > fx else (00,11,10)
  function sample(x, z) {
    let gx = (x - x0) * inv, gz = (z - z0) * inv;
    if (gx < 0) gx = 0; else if (gx > nx - 1.0001) gx = nx - 1.0001;
    if (gz < 0) gz = 0; else if (gz > nz - 1.0001) gz = nz - 1.0001;
    const ix = gx | 0, iz = gz | 0;
    const fx = gx - ix, fz = gz - iz;
    const i = iz * nx + ix;
    const h00 = H[i], h10 = H[i + 1], h01 = H[i + nx], h11 = H[i + nx + 1];
    if (fz > fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }

  /** Plane normal of the triangle under x,z (writes into out, a {x,y,z} / Vector3). */
  function normal(x, z, out) {
    let gx = (x - x0) * inv, gz = (z - z0) * inv;
    if (gx < 0) gx = 0; else if (gx > nx - 1.0001) gx = nx - 1.0001;
    if (gz < 0) gz = 0; else if (gz > nz - 1.0001) gz = nz - 1.0001;
    const ix = gx | 0, iz = gz | 0;
    const fx = gx - ix, fz = gz - iz;
    const i = iz * nx + ix;
    const h00 = H[i], h10 = H[i + 1], h01 = H[i + nx], h11 = H[i + nx + 1];
    let dx, dz;
    if (fz > fx) { dx = (h11 - h01) * inv; dz = (h01 - h00) * inv; }
    else { dx = (h10 - h00) * inv; dz = (h11 - h10) * inv; }
    const l = Math.sqrt(dx * dx + 1 + dz * dz);
    out.x = -dx / l; out.y = 1 / l; out.z = -dz / l;
    return out;
  }

  /** Bilinear paint weights at x,z -> out[4] in 0..1 (dirt, stone, mud, sand). */
  function paintAt(x, z, out = [0, 0, 0, 0]) {
    const gx = clamp((x - x0) * inv, 0, nx - 1.0001), gz = clamp((z - z0) * inv, 0, nz - 1.0001);
    const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
    for (let k = 0; k < 4; k++) {
      const a = P[(iz * nx + ix) * 4 + k], b = P[(iz * nx + ix + 1) * 4 + k];
      const c = P[((iz + 1) * nx + ix) * 4 + k], d = P[((iz + 1) * nx + ix + 1) * 4 + k];
      out[k] = lerp(lerp(a, b, fx), lerp(c, d, fx), fz) / 255;
    }
    return out;
  }

  const _n = { x: 0, y: 1, z: 0 };
  const _p = [0, 0, 0, 0];
  function surfaceAt(x, z) {
    const h = sample(x, z);
    if (h < 0.9) return 'mud';
    normal(x, z, _n);
    if (_n.y < 0.72) return 'stone';
    paintAt(x, z, _p);
    if (_p[1] > 0.5) return 'stone';
    if (_p[2] > 0.5) return 'mud';
    return 'moss';
  }

  return {
    grid: { x0, z0, x1: x0 + (nx - 1) * cell, z1: z0 + (nz - 1) * cell, cell, nx, nz },
    heights: H, paints: P,
    at, sample, normal, paintAt, surfaceAt,
  };
}

// ---------------------------------------------------------------------------
// Meshes (browser)
// ---------------------------------------------------------------------------
const C = (hex) => new THREE.Color(hex);
const COL = {
  moss: C(0x6f9e45), mossLight: C(0x8fbf55), mossDark: C(0x3f6b3a), teal: C(0x2f6450), olive: C(0x7d8a3e),
  rock: C(0x6c716a), rockDark: C(0x4a4f4c), rockWarm: C(0x7a6f60),
  mud: C(0x4f3d2a), mudWet: C(0x2e281f), sand: C(0x9a8a5a),
  dirt: C(0x8a6a45), dirtDark: C(0x6b5034), stone: C(0x8d8a84), heather: C(0x4e5a3c),
};

/**
 * Colour for a terrain vertex. h height, ny normal.y, p paint weights, x/z position.
 */
const _rk = new THREE.Color();
function terrainColor(out, h, ny, p, x, z) {
  const n1 = valueNoise2(x * 0.17, z * 0.17) * 0.6 + valueNoise2(x * 0.55, z * 0.55) * 0.4;
  const big = valueNoise2(x * 0.032 + 7, z * 0.032 - 3);
  // moss base with large-scale variation
  out.copy(COL.moss).lerp(COL.mossLight, smoothstep(0.55, 0.9, n1) * 0.45);
  out.lerp(COL.mossDark, smoothstep(0.5, 0.15, n1) * 0.5);
  out.lerp(COL.teal, smoothstep(0.5, 0.85, big) * 0.45);
  out.lerp(COL.olive, smoothstep(0.55, 0.9, 1 - big) * 0.3);
  // high boundary tops: darker heather
  out.lerp(COL.heather, smoothstep(11, 18, h) * 0.55);
  // paints
  if (p[3] > 0) out.lerp(COL.sand, p[3] * 0.8);
  if (p[0] > 0) { const d = n1 > 0.5 ? COL.dirt : COL.dirtDark; out.lerp(d, p[0] * (0.75 + 0.25 * n1)); }
  if (p[1] > 0) out.lerp(COL.stone, p[1] * (0.8 + 0.2 * n1));
  // mud near and under water
  const mudK = smoothstep(1.25, 0.35, h);
  if (mudK > 0) out.lerp(COL.mud, mudK * 0.9);
  if (h < 0.05) out.lerp(COL.mudWet, smoothstep(0.05, -0.8, h));
  if (p[2] > 0) out.lerp(COL.mud, p[2] * 0.85);
  // rock on steep slopes
  const steep = smoothstep(0.86, 0.66, ny);
  if (steep > 0) {
    const r = n1 > 0.55 ? COL.rockWarm : n1 < 0.35 ? COL.rockDark : COL.rock;
    _rk.copy(r);
    // layered strata bands + streaks of moss down the face
    const band = 0.5 + 0.5 * Math.sin(h * 1.9 + n1 * 3.0 + big * 4.0);
    _rk.lerp(COL.rockDark, band * 0.45);
    if (valueNoise2(x * 0.9, h * 0.35) > 0.7) _rk.lerp(COL.mossDark, 0.55);
    out.lerp(_rk, steep);
    // mossy lips on cliff tops
    if (ny > 0.7) out.lerp(COL.mossDark, 0.25);
  }
  return out;
}

function detailTexture(M) {
  // grey-ish detail (multiplied with vertex colours): soft blotches + short grass strokes
  return M.canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, w, h);
    let s = 9;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 90; k++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 22, v = 190 + r() * 60;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grd.addColorStop(0, `rgba(${v},${v},${v},0.5)`); grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grd; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    g.lineCap = 'round';
    for (let k = 0; k < 1100; k++) {
      const v = 165 + r() * 90;
      g.strokeStyle = `rgba(${v},${v},${v},0.75)`;
      g.lineWidth = 1 + r() * 1.4;
      const x = r() * w, y = r() * h, len = 3 + r() * 7, a = -Math.PI / 2 + (r() - 0.5) * 1.0;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); g.stroke();
      }
    }
  }, { repeat: [1, 1] });
}

/**
 * Build the terrain as chunked meshes (rows of `chunkRows` grid cells along z).
 * Returns { group, chunks:[mesh], material }.
 */
export function buildTerrainMeshes(ctx, hf, opts = {}) {
  const M = ctx.materials;
  const { x0, z0, cell, nx, nz } = hf.grid;
  const H = hf.heights;
  const chunkRows = opts.chunkRows ?? 48;
  const tex = detailTexture(M);
  const material = M.toon(0xffffff, { vertexColors: true, map: tex });
  material.name = 'terrain';
  const group = new THREE.Group(); group.name = 'terrain';
  const chunks = [];
  const col = new THREE.Color();
  const paint = [0, 0, 0, 0];
  const uvScale = 1 / 7; // detail texture repeat every 7 m

  // shared per-vertex normals/colours over the whole grid (so chunk seams match)
  const NRM = new Float32Array(nx * nz * 3);
  const COLS = new Float32Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const hl = H[iz * nx + Math.max(0, ix - 1)], hr = H[iz * nx + Math.min(nx - 1, ix + 1)];
      const hd = H[Math.max(0, iz - 1) * nx + ix], hu = H[Math.min(nz - 1, iz + 1) * nx + ix];
      let dx = (hr - hl) / (2 * cell), dz = (hu - hd) / (2 * cell);
      const l = Math.sqrt(dx * dx + 1 + dz * dz);
      NRM[i * 3] = -dx / l; NRM[i * 3 + 1] = 1 / l; NRM[i * 3 + 2] = -dz / l;
      const x = x0 + ix * cell, z = z0 + iz * cell;
      for (let k = 0; k < 4; k++) paint[k] = hf.paints[i * 4 + k] / 255;
      // use the steepest adjacent triangle-ish slope for rock colouring
      const ny = 1 / l;
      terrainColor(col, H[i], ny, paint, x, z);
      COLS[i * 3] = col.r; COLS[i * 3 + 1] = col.g; COLS[i * 3 + 2] = col.b;
    }
  }

  for (let r0 = 0; r0 < nz - 1; r0 += chunkRows) {
    const r1 = Math.min(nz - 1, r0 + chunkRows);
    const rows = r1 - r0 + 1;
    const vcount = rows * nx;
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), cols = new Float32Array(vcount * 3), uv = new Float32Array(vcount * 2);
    for (let iz = r0; iz <= r1; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const gi = iz * nx + ix, li = (iz - r0) * nx + ix;
        const x = x0 + ix * cell, z = z0 + iz * cell;
        pos[li * 3] = x; pos[li * 3 + 1] = H[gi]; pos[li * 3 + 2] = z;
        nor[li * 3] = NRM[gi * 3]; nor[li * 3 + 1] = NRM[gi * 3 + 1]; nor[li * 3 + 2] = NRM[gi * 3 + 2];
        cols[li * 3] = COLS[gi * 3]; cols[li * 3 + 1] = COLS[gi * 3 + 1]; cols[li * 3 + 2] = COLS[gi * 3 + 2];
        uv[li * 2] = x * uvScale; uv[li * 2 + 1] = z * uvScale;
      }
    }
    const quads = (rows - 1) * (nx - 1);
    const idx = new Uint32Array(quads * 6);
    let k = 0;
    for (let lz = 0; lz < rows - 1; lz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = lz * nx + ix, b = a + 1, c = a + nx, d = c + 1; // a=00 b=10 c=01 d=11
        idx[k++] = a; idx[k++] = c; idx[k++] = d;   // (00,01,11)
        idx[k++] = a; idx[k++] = d; idx[k++] = b;   // (00,11,10)
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `terrain-${chunks.length}`;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    chunks.push(mesh);
  }
  ctx.scene.add(group);
  return { group, chunks, material, texture: tex };
}

/**
 * Water helper texture over the grid: R = water depth (0..4 m -> 0..1), G = extra foam mask
 * (stumps, pads, posts standing in water), B = 1 where terrain is above water.
 * extraFoam: [{x, z, r}] circles.
 */
export function buildDepthTexture(hf, extraFoam = [], waterLevel = 0) {
  const { x0, z0, cell, nx, nz } = hf.grid;
  const data = new Uint8Array(nx * nz * 4);
  const H = hf.heights;
  for (let i = 0; i < nx * nz; i++) {
    const d = waterLevel - H[i];
    data[i * 4] = Math.round(clamp(d / 4, 0, 1) * 255);
    data[i * 4 + 2] = d < 0 ? 255 : 0;
    data[i * 4 + 3] = 255;
  }
  for (const f of extraFoam) {
    const rr = f.r + 1.2;
    const ix0 = Math.max(0, Math.floor((f.x - rr - x0) / cell)), ix1 = Math.min(nx - 1, Math.ceil((f.x + rr - x0) / cell));
    const iz0 = Math.max(0, Math.floor((f.z - rr - z0) / cell)), iz1 = Math.min(nz - 1, Math.ceil((f.z + rr - z0) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = x0 + ix * cell, z = z0 + iz * cell;
        const d = Math.hypot(x - f.x, z - f.z) - f.r;
        const v = clamp(1 - d / 1.2, 0, 1);
        const i = (iz * nx + ix) * 4 + 1;
        data[i] = Math.max(data[i], Math.round(v * 255));
      }
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  // uv = ((x - x0)/cell + 0.5) / nx  -> scale/offset for the shader
  tex.userData.transform = new THREE.Vector4(1 / (cell * nx), 1 / (cell * nz), (-x0 / cell + 0.5) / nx, (-z0 / cell + 0.5) / nz);
  return tex;
}
