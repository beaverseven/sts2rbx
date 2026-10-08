// buildLevel(ctx) -> level. Builds Gloomfen from data.js:
//   terrain (heightfield physics + chunked vertex-coloured mesh), static colliders and merged
//   prop geometry per chunk/material, decor scatter, bog water + waterfalls, instanced grass,
//   fireflies / halos / landmark beacons, backdrop silhouettes, per-zone fog, and the
//   entity spawns (spawnAll). Registers the level entity types (installMechanisms).
//
// level = { name, spawn, checkpoints, zones, bounds, zone, spawnAll(), reset(), dispose(),
//           update(dt), frame(realDt), heightfield, water, spawned, stats }
import * as THREE from 'three';
import { rand, clamp, lerp, smoothstep, valueNoise2 } from '../../core/mathx.js';
import { createHeightfield, buildTerrainMeshes, buildDepthTexture } from './terrain.js';
import * as DATA from './data.js';
import {
  makeTextures, createBatcher, STRUCTURE_BUILDERS, addTree, addRock, addShrooms, addReeds, addLilyPad, addFern, addLog,
  createPoints, createGrass, createBackdrop, disposeGeoCache, T,
} from './props.js';
import { createWater, createWaterfalls } from './water.js';
import { installMechanisms, MECHANISM_TYPES, signParts, hazardParts } from './mechanisms.js';

const CHUNK = 48;
const Z_BASE = -48;
const BOUNDS = { min: [-62, -60, -40], max: [62, 220, 462] };
// distance culling (m): past ~150 m the fog has swallowed everything anyway
const CULL = { terrain: 190, props: 150, flat: 90, glow: 130, cloth: 100, grass: 70, outline: 70, entities: 105 };

// ---------------------------------------------------------------------------
// exclusion helpers for decor scatter
// ---------------------------------------------------------------------------
function makeExclusion(hf) {
  const route = DATA.ROUTE;
  const routeDist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i], [bx, bz] = route[i + 1];
      const abx = bx - ax, abz = bz - az, L2 = abx * abx + abz * abz || 1e-9;
      const t = clamp(((x - ax) * abx + (z - az) * abz) / L2, 0, 1);
      const d = Math.hypot(x - ax - abx * t, z - az - abz * t);
      if (d < best) best = d;
    }
    return best;
  };
  // structure / spawn footprints as [x0, z0, x1, z1]
  const boxes = [];
  const pushBox = (x0, z0, x1, z1) => boxes.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
  for (const s of DATA.STRUCTURES) {
    switch (s.kind) {
      case 'rockLedge': case 'stoneStep': pushBox(s.min[0], s.min[2], s.max[0], s.max[2]); break;
      case 'stump': case 'pillar': pushBox(s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r); break;
      case 'palisade': { const t = (s.thick ?? 1) / 2 + 0.6; pushBox(s.from[0] - t, s.from[1] - t, s.to[0] + t, s.to[1] + t); break; }
      case 'tower': pushBox(s.x - s.size / 2 - 0.5, s.z - s.size / 2 - 0.5, s.x + s.size / 2 + 0.5, s.z + s.size / 2 + 0.5); break;
      case 'bridge': pushBox(s.x - s.width / 2 - 1, s.z0, s.x + s.width / 2 + 1, s.z1); break;
      case 'brokenBridge': pushBox(s.x - 2.5, s.z0 - 1.5, s.x + 2.5, s.z1 + 1.5); break;
      case 'waterfall': pushBox(Math.min(s.from[0], s.to[0]) - 2, Math.min(s.from[1], s.to[1]) - 2, Math.max(s.from[0], s.to[0]) + 2, Math.max(s.from[1], s.to[1]) + 2); break;
      default: if (s.x !== undefined) pushBox(s.x - 3, s.z - 3, s.x + 3, s.z + 3);
    }
  }
  const points = [];
  for (const sp of DATA.SPAWNS) {
    if (!sp.pos || sp.type === 'zoneTrigger') continue;
    const r = MECHANISM_TYPES[sp.type] ? 2.6 : sp.type.startsWith('glowcap') ? 0.8 : 1.6;
    points.push([sp.pos[0], sp.pos[2], r]);
    if (sp.type === 'movingPlatform') for (const p of sp.path) points.push([p[0], p[2], 2.6]);
    if (sp.type === 'glowcapLine') for (let k = 0; k <= 4; k++) { const t = k / 4; points.push([lerp(sp.from[0], sp.to[0], t), lerp(sp.from[2], sp.to[2], t), 1]); }
  }
  for (const l of DATA.LANTERNS) points.push([l[0], l[1], 1.2]);
  for (const l of DATA.TORCHES) points.push([l[0], l[1], 1.0]);
  const zoneBlock = (x, z) =>
    (x > -35 && x < 35 && z > 265 && z < 349) ||           // fort
    (Math.hypot(x, z - 395) < 31) ||                        // pit + rim
    (x > -7.5 && x < 7.5 && z > 343 && z < 377);           // gorge
  return {
    routeDist,
    blocked(x, z, pad = 0, routeClear = 0) {
      if (routeClear > 0 && routeDist(x, z) < routeClear) return true;
      for (const b of boxes) if (x > b[0] - pad && x < b[2] + pad && z > b[1] - pad && z < b[3] + pad) return true;
      for (const p of points) { const dx = x - p[0], dz = z - p[1], rr = p[2] + pad; if (dx * dx + dz * dz < rr * rr) return true; }
      return false;
    },
    zoneBlock,
  };
}

// ---------------------------------------------------------------------------
// decor scatter
// ---------------------------------------------------------------------------
function scatterDecor(env, ex) {
  const { B, hf, physics } = env;
  const r = rand(4242);
  const n = { x: 0, y: 1, z: 0 }, n2 = { x: 0, y: 1, z: 0 };
  const { x0, x1, z0, z1 } = hf.grid;
  const stats = { trees: 0, rocks: 0, shrooms: 0, reeds: 0, pads: 0, ferns: 0, logs: 0, grass: 0 };
  const shroomSpots = [];
  const treeSpots = [];
  const inside = (x, z, m = 2) => x > x0 + m && x < x1 - m && z > z0 + m && z < z1 - m;

  // --- trees (jittered grid)
  for (let gz = z0 + 4; gz < z1 - 4; gz += 6.5) {
    for (let gx = x0 + 4; gx < x1 - 4; gx += 6.5) {
      const x = gx + (r() - 0.5) * 5, z = gz + (r() - 0.5) * 5;
      if (!inside(x, z, 4)) continue;
      const h = hf.sample(x, z); hf.normal(x, z, n);
      if (h < 0.9 || n.y < 0.78) continue;
      const high = h > 10.5;
      const dRoute = ex.routeDist(x, z);
      // dense along the corridor edges, sparse silhouettes on the high ground, none far out
      let p = high ? (dRoute < 45 ? 0.2 : 0.04) : 0.55;
      if (Math.abs(x) > 52) p *= 0.3;
      if (r() > p) continue;
      if (ex.zoneBlock(x, z) || ex.blocked(x, z, 1.5, high ? 3 : 6.5)) continue;
      // canopies must not intrude into higher walkable ground nearby (cliff tops, plateaus)
      let intrude = false;
      for (let k = 0; k < 8 && !intrude; k++) {
        const a = (k / 8) * Math.PI * 2;
        const sx = x + Math.cos(a) * 6.5, sz = z + Math.sin(a) * 6.5;
        const sh = hf.sample(sx, sz);
        if (sh > h + 2.5 && sh < 11.5) { hf.normal(sx, sz, n2); if (n2.y > 0.8) intrude = true; }
      }
      if (intrude) continue;
      const s = high ? 1.1 + r() * 0.5 : 0.8 + r() * 0.45;
      const t = addTree(B, x, h, z, s, r, { fungus: !high && r() < 0.5 });
      treeSpots.push([x, h, z]);
      if (!high || h < 12) {
        const tr = t.trunkR * 0.85;
        physics.addBox({ min: [x - tr, h - 0.6, z - tr], max: [x + tr, h + 3.2, z + tr], surface: 'wood', tag: 'tree' });
      }
      stats.trees++;
    }
  }
  // mangrove-ish trees on the decorative bog islands
  for (const [ix, iz] of [[-23, 133], [-25, 193], [27, 199], [18, 133], [-17, 170]]) {
    const h = hf.sample(ix, iz);
    addTree(B, ix + 0.5, h, iz - 0.4, 1.15, r, { fungus: true, branches: 3 });
    addShrooms(B, ix - 1.5, h, iz + 1.0, r, { count: 5, scale: 1.2 });
    shroomSpots.push([ix - 1.5, h + 0.6, iz + 1.0, 0x5ef2e0]);
    physics.addBox({ min: [ix + 0.1, h - 0.6, iz - 0.8], max: [ix + 0.9, h + 3, iz], surface: 'wood', tag: 'tree' });
    stats.trees++;
  }

  // --- rocks
  for (let gz = z0 + 3; gz < z1 - 3; gz += 5.5) {
    for (let gx = x0 + 3; gx < x1 - 3; gx += 5.5) {
      const x = gx + (r() - 0.5) * 4.5, z = gz + (r() - 0.5) * 4.5;
      const h = hf.sample(x, z); hf.normal(x, z, n);
      if (h < -0.6 || h > 22 || r() > (n.y < 0.85 ? 0.5 : 0.18)) continue;
      if (ex.zoneBlock(x, z) && !(Math.hypot(x, z - 395) > 24 && Math.hypot(x, z - 395) < 31)) continue;
      if (ex.blocked(x, z, 1.2, 3.4)) continue;
      const s = (n.y < 0.85 ? 0.8 + r() * 1.3 : 0.35 + r() * 0.8);
      addRock(B, x, h - 0.15, z, s, r);
      if (s > 0.85 && h < 11 && h > 0.2) physics.addBox({ min: [x - s * 0.8, h - 0.5, z - s * 0.7], max: [x + s * 0.8, h + s * 0.55, z + s * 0.7], surface: 'stone', tag: 'rock' });
      stats.rocks++;
    }
  }

  // --- big boulders embedded in cliff faces to break up the walls
  for (let gz = z0 + 4; gz < z1 - 4; gz += 6) {
    for (let gx = x0 + 4; gx < x1 - 4; gx += 6) {
      const x = gx + (r() - 0.5) * 5, z = gz + (r() - 0.5) * 5;
      const h = hf.sample(x, z); hf.normal(x, z, n);
      if (n.y > 0.62 || h < 0.5 || h > 26 || r() > 0.5) continue;
      if (ex.zoneBlock(x, z) || ex.blocked(x, z, 1.0, 3.0)) continue;
      addRock(B, x, h - 0.9, z, 1.6 + r() * 1.8, r, { moss: 0.9 });
      stats.rocks++;
    }
  }

  // --- glowing mushrooms: at tree feet and along the route edges
  for (const [tx, th, tz] of treeSpots) {
    if (th > 11 || r() > 0.65) continue;
    const a = r() * Math.PI * 2, d = 1.1 + r() * 1.2;
    const x = tx + Math.cos(a) * d, z = tz + Math.sin(a) * d;
    if (ex.blocked(x, z, 0.3, 2.0)) continue;
    const res = addShrooms(B, x, hf.sample(x, z), z, r);
    shroomSpots.push([x, hf.sample(x, z) + 0.6, z, res.color]);
    stats.shrooms++;
  }
  const route = DATA.ROUTE;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i], [bx, bz] = route[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    for (let d = 2; d < L; d += 7 + r() * 5) {
      const t = d / L, side = r() < 0.5 ? -1 : 1, off = 2.6 + r() * 2.2;
      const x = ax + (bx - ax) * t + (-(bz - az) / L) * side * off, z = az + (bz - az) * t + ((bx - ax) / L) * side * off;
      const h = hf.sample(x, z); hf.normal(x, z, n);
      if (h < 0.5 || n.y < 0.8 || ex.zoneBlock(x, z) || ex.blocked(x, z, 0.4, 2.2)) continue;
      const res = addShrooms(B, x, h, z, r, { scale: 0.9 + r() * 0.5 });
      shroomSpots.push([x, h + 0.7, z, res.color]);
      stats.shrooms++;
    }
  }
  // a few big hero mushroom clumps
  for (const [x, z, c] of [[-7, 12, 0xff5fb2], [8.5, 22, 0x5ef2e0], [-11, 62, 0x5ef2e0], [10, 66, 0xff5fb2], [-12, 92, 0xff5fb2], [6, 238, 0x5ef2e0], [-11, 226, 0xff5fb2], [-4, 186, 0xff5fb2], [6.5, 149, 0x5ef2e0]]) {
    const h = hf.sample(x, z);
    addShrooms(B, x, h, z, r, { color: c, count: 6, scale: 1.8, bright: 1.6 });
    shroomSpots.push([x, h + 1.2, z, c]);
    stats.shrooms++;
  }

  // --- reeds along shores, lily pads on open water
  for (let gz = z0 + 2; gz < z1 - 2; gz += 1.7) {
    for (let gx = x0 + 2; gx < x1 - 2; gx += 1.7) {
      const x = gx + (r() - 0.5) * 1.5, z = gz + (r() - 0.5) * 1.5;
      const h = hf.sample(x, z);
      if (h > -0.7 && h < 0.9) {
        if (r() < 0.5 && !ex.blocked(x, z, 0.5, 1.8)) { addReeds(B, x, Math.max(h, -0.15), z, r, 0.75 + r() * 0.55); stats.reeds++; }
      } else if (h < -0.8 && r() < 0.04) {
        if (!ex.blocked(x, z, 1.2, 2.6)) { addLilyPad(B, x, z, r); stats.pads++; }
      }
    }
  }
  // --- ferns on mossy ground near the corridor
  for (let gz = z0 + 2; gz < z1 - 2; gz += 3.6) {
    for (let gx = -40; gx < 40; gx += 3.6) {
      const x = gx + (r() - 0.5) * 3, z = gz + (r() - 0.5) * 3;
      const h = hf.sample(x, z); hf.normal(x, z, n);
      if (h < 1 || h > 11 || n.y < 0.85 || r() > 0.2) continue;
      if (ex.zoneBlock(x, z) || ex.blocked(x, z, 0.3, 2.4)) continue;
      addFern(B, x, h, z, r, 0.8 + r() * 0.6);
      stats.ferns++;
    }
  }
  // --- fallen logs (decor, off the path)
  for (const [x, z, yaw, len] of [[-9, 18, 0.8, 4.5], [11, 8, -0.4, 3.5], [-12, 44, 1.6, 5], [12, 57, 0.3, 4], [-11, 98, -0.9, 4.5], [11, 108, 1.2, 3.5], [-14, 236, 0.5, 5], [13, 243, -1.2, 4], [-3, 152.5, 1.4, 3]]) {
    if (ex.routeDist(x, z) < 2.5) continue;
    addLog(B, x, hf.sample(x, z), z, yaw, len, 0.38, r);
    stats.logs++;
  }
  // --- pit floor bones
  const pr = rand(77);
  for (let k = 0; k < 16; k++) {
    const a = pr() * Math.PI * 2, d = 6 + pr() * 14;
    const x = Math.cos(a) * d, z = 395 + Math.sin(a) * d;
    if (Math.abs(x) < 4 && z < 380) continue;                   // entrance lane
    if (Math.abs(x) < 4.5 && z > 399 && z < 408) continue;       // the boss's own throne sits at z ~403.5-405
    STRUCTURE_BUILDERS.bone(env, { x, y: DATA.PIT.y + 0.02, z, s: 0.8 + pr() * 0.8 });
  }
  for (const [x, z, yaw, s] of [[-15, 400, 0.6, 1.1], [14, 404, -0.9, 1.3], [-9, 380, 2.2, 0.9], [12, 384, 1.0, 0.8]]) STRUCTURE_BUILDERS.ribcage(env, { x, y: DATA.PIT.y, z, yaw, s });

  env.shroomSpots = shroomSpots;
  return stats;
}

function grassSpots(hf, ex) {
  const r = rand(99);
  const n = { x: 0, y: 1, z: 0 };
  const paint = [0, 0, 0, 0];
  const out = [];
  const { z0, z1 } = hf.grid;
  const cA = new THREE.Color(0x9cc06a), cB = new THREE.Color(0x6f9a48), cC = new THREE.Color(0xb5c46a);
  for (let z = z0 + 2; z < z1 - 2; z += 1.05) {
    for (let x = -44; x < 44; x += 1.05) {
      const px = x + (r() - 0.5) * 1.0, pz = z + (r() - 0.5) * 1.0;
      const h = hf.sample(px, pz);
      if (h < 0.75 || h > 10.5) continue;
      hf.normal(px, pz, n);
      if (n.y < 0.86) continue;
      hf.paintAt(px, pz, paint);
      if (paint[0] > 0.35 || paint[1] > 0.3) continue;
      if (ex.zoneBlock(px, pz)) continue;
      if (r() > 0.72) continue;
      const tint = cB.clone().lerp(r() < 0.5 ? cA : cC, r());
      out.push([px, h, pz, 0.6 + r() * 0.5, r() * Math.PI * 2, tint]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
export function buildLevel(ctx, opts = {}) {
  const t0 = performance.now();
  const { physics, materials: M, scene } = ctx;
  for (const name of Object.keys(MECHANISM_TYPES)) if (!ctx.entities.hasType(name)) { installMechanisms(ctx); break; }
  physics.waterLevel = DATA.WATER_LEVEL;

  // --- terrain
  const hf = createHeightfield(DATA.TERRAIN);
  const nrm = new THREE.Vector3();
  physics.setTerrain({
    sample: hf.sample,
    normal: (x, z) => hf.normal(x, z, nrm),
    surfaceAt: hf.surfaceAt,
  });
  const terrain = buildTerrainMeshes(ctx, hf, { chunkRows: CHUNK });
  const tTerrain = performance.now();

  // --- static props
  const textures = makeTextures(M);
  const B = createBatcher(ctx, textures, { chunkSize: CHUNK, zBase: Z_BASE });
  const env = { B, physics, hf, r: rand(2024), halos: [], beacons: [], fires: [], foam: [], colliders: [], data: DATA, shroomSpots: [] };
  // record every static collider created while building (so dispose() can remove exactly those)
  const trackPhysics = physics.addBox;
  physics.addBox = (def) => { const c = trackPhysics(def); env.colliders.push(c); return c; };
  const falls = [];
  let decorStats, ex;
  const bakedY = new Map();   // data.js signs / thorns whose meshes are baked (y used again by spawnAll)
  try {
    for (const s of DATA.STRUCTURES) {
      if (s.kind === 'waterfall') { falls.push(s); continue; }
      const fn = STRUCTURE_BUILDERS[s.kind];
      if (!fn) { console.warn(`[level] no builder for structure kind ${s.kind}`); continue; }
      fn(env, s);
    }
    for (const [x, z] of DATA.LANTERNS) STRUCTURE_BUILDERS.lantern(env, { x, z, y: hf.sample(x, z), yaw: x < 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (const [x, z] of DATA.TORCHES) STRUCTURE_BUILDERS.torch(env, { x, z, y: physics.groundHeight(x, z, 60) });
    for (const [x, z, yaw] of DATA.BANNERS) STRUCTURE_BUILDERS.banner(env, { x, z, y: physics.groundHeight(x, z, 60), yaw });
    // signposts and thorn patches placed by data.js are static: bake their meshes into the batch
    // (the entities then only carry the sign face / the damage trigger)
    for (const sd of DATA.SPAWNS) {
      if (sd.type !== 'sign' && sd.type !== 'hazard') continue;
      const y = sd.pos[1] ?? physics.groundHeight(sd.pos[0], sd.pos[2], 200);
      bakedY.set(sd, y);
      const m = T(sd.pos[0], y, sd.pos[2], sd.type === 'sign' ? (sd.yaw ?? 0) : 0);
      const bp = sd.type === 'sign' ? signParts() : hazardParts(sd);
      for (const p of bp.parts) B.add('toon', p.geometry, m.clone().multiply(p.matrix), p.color);
      for (const p of bp.glow) B.add('glow', p.geometry, m.clone().multiply(p.matrix), p.color);
    }
    ex = makeExclusion(hf);
    decorStats = scatterDecor(env, ex);
  } finally {
    physics.addBox = trackPhysics;
  }
  const props = B.build(scene);
  const tProps = performance.now();

  // --- water + waterfalls
  const depthTex = buildDepthTexture(hf, env.foam, DATA.WATER_LEVEL);
  const water = createWater(ctx, { depthTex, grid: hf.grid, waterLevel: DATA.WATER_LEVEL });
  const waterfalls = createWaterfalls(ctx, falls, hf.sample, DATA.WATER_LEVEL);

  // --- grass
  const grass = createGrass(ctx, grassSpots(hf, ex), { chunkSize: CHUNK, zBase: Z_BASE });

  // --- glow points: halos (lanterns, torches, fires, mushrooms), beacons (far-visible), fireflies
  const haloItems = env.halos.slice();
  for (const [x, y, z, c] of env.shroomSpots) haloItems.push([x, y, z, c, 1.7, 0]);
  for (const f of waterfalls.feet) haloItems.push([f[0], f[1], f[2], 0x9fd8c8, 4.0, 0]);
  const halos = createPoints(ctx, haloItems, { intensity: 0.55, name: 'halos' });
  const beaconItems = env.beacons.slice();
  // pit glow column + fort haze: big dim points that read through the fog as landmarks
  for (let k = 0; k < 7; k++) beaconItems.push([0, DATA.PIT.y + 6 + k * 5, DATA.PIT.z, k < 3 ? 0xff7a3a : 0xc0504a, 26 - k * 2.2, 0]);
  for (const [x, z] of [[-10, 276], [10, 276], [0, 306], [0, 340]]) beaconItems.push([x, 15, z, 0xff9a4a, 9, 0]);
  const beacons = createPoints(ctx, beaconItems, { intensity: 0.5, fogScale: 0.16, name: 'beacons', noCull: true });
  const fr = rand(55);
  const flies = [];
  for (let i = 0; i < 420; i++) {
    const x = fr.range(-36, 36), z = fr.range(-14, 420);
    const h = hf.sample(x, z);
    if (h > 11 || ex.zoneBlock(x, z) && fr() < 0.6) continue;
    const base = Math.max(h, 0) + 0.6 + fr() * 2.6;
    const col = fr() < 0.82 ? 0xd8ff8a : fr() < 0.5 ? 0x5ef2e0 : 0xff8fd0;
    flies.push([x, base, z, col, 0.14 + fr() * 0.08, fr() * 100]);
  }
  for (const [x, y, z, c] of env.shroomSpots) if (fr() < 0.6) flies.push([x + fr.range(-1, 1), y + 0.6 + fr() * 1.2, z + fr.range(-1, 1), c, 0.1, fr() * 100]);
  const fireflies = createPoints(ctx, flies, { intensity: 1.9, anim: true, name: 'fireflies' });

  // --- backdrop silhouettes
  const backdrop = createBackdrop(ctx, DATA.ZONES[0].fog);

  // --- level object
  const cps = DATA.CHECKPOINTS.map((c) => ({ id: c.id, position: [c.position[0], groundY(c.position[0], c.position[2], c.position[1] + 3), c.position[2]], yaw: c.yaw }));
  function groundY(x, z, from = 200) {
    const y = physics.groundHeight(x, z, from);
    return y > -Infinity ? y : hf.sample(x, z);
  }
  const spawned = [];
  const zonesOut = DATA.ZONES.map((z) => ({ id: z.id, name: z.name, bounds: { min: [-90, -60, z.z0], max: [90, 140, z.z1] }, fog: z.fog, density: z.density }));
  const chunkObjects = [];
  for (const m of terrain.chunks) chunkObjects.push([m, CULL.terrain]);
  for (const m of props.meshes) chunkObjects.push([m, CULL[m.name.split('-')[1]] ?? CULL.props]);
  for (const m of grass.meshes) chunkObjects.push([m, CULL.grass]);
  for (const [m] of chunkObjects) { if (m.isInstancedMesh) m.computeBoundingBox(); else m.geometry.computeBoundingBox(); }

  const offs = [];
  // Fort smoke snuffs an active Updraft so it cannot carry Morel over the palisades.
  offs.push(ctx.events.on('zone:enter', (z) => {
    if (z && z.id === 'fort' && ctx.player && ctx.player.tonic && ctx.player.tonic.kind === 'updraft') {
      ctx.player.setTonic(null);
      ctx.events.emit('ui:message', { text: "The fort's cook-smoke snuffs out your Updraft!", duration: 3 });
    }
  }));

  const fogCol = new THREE.Color(), fogA = new THREE.Color(), fogB = new THREE.Color();
  let rippleT = 0, emberT = 0, splashT = 0;
  const _v = new THREE.Vector3(), _b = new THREE.Box3();
  const EMBER = { color: 0xffa040, life: 1.1, size: 0.07, kind: 'spark', gravity: -1.2, drag: 0.6, intensity: 2.2 };
  const SPRAY = { position: _v, count: 3, color: [0xcfe8e0, 0x9fd8c8], speed: 1.6, spread: 0.6, life: 0.9, size: 0.6, kind: 'puff', alpha: 0.35, grow: 2 };
  const emberVel = new THREE.Vector3();

  const level = {
    isStub: false,
    name: 'Gloomfen',
    spawn: { position: cps[0].position.slice(), yaw: cps[0].yaw },
    checkpoints: cps,
    zones: zonesOut,
    bounds: BOUNDS,
    zone: 'glade',
    heightfield: hf,
    water,
    data: DATA,
    spawned,
    stats: { buildMs: 0, decor: decorStats, colliders: env.colliders.length, propMeshes: props.meshes.length, grass: grass.meshes.reduce((a, m) => a + m.count, 0), fireflies: flies.length },
    groundY,
    entityCullDistance: CULL.entities,

    /** Spawn every entity in data.js (pos[1] === null snaps to the ground). Returns the spawned entities. */
    spawnAll() {
      for (const sd of DATA.SPAWNS) {
        const d = JSON.parse(JSON.stringify(sd));
        if (d.pos && (d.pos[1] === null || d.pos[1] === undefined)) d.pos[1] = groundY(d.pos[0], d.pos[2]);
        if (bakedY.has(sd)) { d.baked = true; d.pos[1] = bakedY.get(sd); }
        const e = ctx.entities.spawn(d);
        if (e && typeof e === 'object') spawned.push(e);
      }
      ctx.entities.flush();
      return spawned;
    },

    /** Restart the level: mechanisms reset, every spawned entity re-created, level flags cleared. */
    reset() {
      for (const e of spawned) if (e.reset) e.reset();
      for (const e of spawned) if (e.alive) ctx.entities.remove(e);
      ctx.entities.flush();
      spawned.length = 0;
      for (const k of ['gateFortOpen', 'arenaClear_courtyard']) delete ctx.flags[k];
      level.zone = 'glade';
      level.spawnAll();
    },

    /** Remove everything the level created (meshes, colliders, terrain, entities, listeners). */
    dispose() {
      for (const o of offs) o();
      for (const e of spawned) if (e.alive) ctx.entities.remove(e);
      ctx.entities.flush();
      spawned.length = 0;
      for (const c of env.colliders) physics.removeCollider(c);
      physics.setTerrain(null);
      const objs = [terrain.group, props.group, water.mesh, waterfalls.mesh, grass.group, halos.object, beacons.object, fireflies.object, backdrop.mesh];
      for (const o of objs) {
        if (o.parent) o.parent.remove(o);
        o.traverse((m) => { if ((m.isMesh || m.isPoints) && !m.userData.isOutline && m.geometry) m.geometry.dispose(); });
      }
      for (const mat of [terrain.material, ...props.materials, grass.material, halos.object.material, beacons.object.material, fireflies.object.material, backdrop.material]) mat.dispose();
      water.dispose(); waterfalls.dispose(); grass.geometry.dispose();
      for (const t of [terrain.texture, depthTex, ...Object.values(textures)]) t.dispose();
      disposeGeoCache();
    },

    update(dt) {
      // safety net far outside the playable area (top of the boundary country)
      const pl = ctx.player;
      if (pl && pl.state !== 'dead') {
        const p = pl.position, v = pl.velocity;
        if (p.x < BOUNDS.min[0]) { p.x = BOUNDS.min[0]; if (v.x < 0) v.x = 0; }
        if (p.x > BOUNDS.max[0]) { p.x = BOUNDS.max[0]; if (v.x > 0) v.x = 0; }
        if (p.z < BOUNDS.min[2]) { p.z = BOUNDS.min[2]; if (v.z < 0) v.z = 0; }
        if (p.z > BOUNDS.max[2]) { p.z = BOUNDS.max[2]; if (v.z > 0) v.z = 0; }
      }
    },

    frame(realDt) {
      const t = ctx.time.real;
      water.frame(t, realDt);
      waterfalls.frame(t);
      halos.frame(t); beacons.frame(t); fireflies.frame(t);
      props.windUniforms.uTime.value = t;
      grass.uniforms.uTime.value = t;
      const cam = ctx.camera.position;
      // per-zone fog, blended across a 24 m band around each boundary
      const cz = cam.z;
      let zi = DATA.ZONES.length - 1;
      for (let i = 0; i < DATA.ZONES.length; i++) if (cz < DATA.ZONES[i].z1) { zi = i; break; }
      const Z = DATA.ZONES[zi];
      fogA.set(Z.fog);
      let dens = Z.density;
      const next = DATA.ZONES[zi + 1], prev = DATA.ZONES[zi - 1];
      if (next && cz > Z.z1 - 12) { const k = smoothstep(Z.z1 - 12, Z.z1 + 12, cz) ; fogCol.copy(fogA).lerp(fogB.set(next.fog), k); dens = lerp(Z.density, next.density, k); }
      else if (prev && cz < Z.z0 + 12) { const k = smoothstep(Z.z0 - 12, Z.z0 + 12, cz); fogCol.copy(fogB.set(prev.fog)).lerp(fogA, k); dens = lerp(prev.density, Z.density, k); }
      else fogCol.copy(fogA);
      ctx.gfx.setFog(fogCol, dens);
      // distance culling of chunked meshes (everything past the fog is invisible anyway)
      for (let i = 0; i < chunkObjects.length; i++) {
        const [m, dist] = chunkObjects[i];
        const bb = m.isInstancedMesh ? m.boundingBox : m.geometry.boundingBox;
        if (!bb) continue;
        _b.copy(bb);
        const d = _b.distanceToPoint(cam);
        m.visible = d < dist;
        if (m.userData.outline) m.userData.outline.visible = d < CULL.outline;
      }
      // Entity distance culling (safety net for every area): past the fog, hide entity meshes.
      // Only entities this pass hid are made visible again, so entities' own visibility logic
      // (blinking, despawn effects) is left alone. Skips anything with e.noCull. The boss is culled
      // too (integration): from the start area he was ~11-20 draw calls hidden only by the fog.
      // level.entityCullDistance = 0 disables it.
      const cd = level.entityCullDistance;
      if (cd > 0) {
        const list = ctx.entities.list, cd2 = cd * cd;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const o = e.object3d;
          if (!o || e.noCull) continue;
          const p = e.position || o.position;
          const dx = p.x - cam.x, dz = p.z - cam.z;
          const far = dx * dx + dz * dz > cd2;
          if (far) { if (o.visible) { o.visible = false; e._levelCulled = true; } }
          else if (e._levelCulled) { o.visible = true; e._levelCulled = false; }
        }
      }
      // ambient life near the camera: ripples on the bog, embers from fires, waterfall spray
      if (!ctx.simulating) return;
      rippleT -= realDt;
      if (rippleT <= 0) {
        rippleT = 0.35 + Math.random() * 0.6;
        for (let tries = 0; tries < 6; tries++) {
          const x = cam.x + (Math.random() - 0.5) * 44, z = cam.z + 4 + Math.random() * 34;
          if (hf.sample(x, z) < -0.5) { water.addRipple(x, z, 0.5 + Math.random() * 0.5); break; }
        }
      }
      emberT -= realDt;
      if (emberT <= 0) {
        emberT = 0.12;
        for (const f of env.fires) {
          if (Math.abs(f[2] - cam.z) > 30 || Math.abs(f[0] - cam.x) > 30) continue;
          _v.set(f[0] + (Math.random() - 0.5) * 0.3, f[1], f[2] + (Math.random() - 0.5) * 0.3);
          emberVel.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6);
          ctx.particles.spawn(_v, emberVel, EMBER);
        }
      }
      splashT -= realDt;
      if (splashT <= 0) {
        splashT = 0.25;
        for (const f of waterfalls.feet) {
          if (Math.hypot(f[0] - cam.x, f[2] - cam.z) > 45) continue;
          _v.set(f[0], f[1] - 0.1, f[2]);
          ctx.particles.burst(SPRAY);
          if (Math.random() < 0.5) water.addRipple(f[0] + (Math.random() - 0.5) * 2, f[2] + (Math.random() - 0.5) * 2, 0.6);
        }
      }
    },
  };

  if (opts.spawn !== false) level.spawnAll();
  level.stats.buildMs = Math.round(performance.now() - t0);
  level.stats.terrainMs = Math.round(tTerrain - t0);
  level.stats.propsMs = Math.round(tProps - tTerrain);
  return level;
}

export { installMechanisms };
