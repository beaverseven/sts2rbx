// Built-in test arena used by main.js (until the real level lands) and by every
// area sandbox: gentle hills, a bog pool, boxes/ledges/steps of known heights, a
// wall, stairs, a glide tower, a moving platform, a thin slab for fall tests and
// straw training dummies ('dummy' entity type: 3 hp, respawns).
//
//   import { buildTestArena, registerDummyType } from '../core/testArena.js';
//   boot({ buildLevel: buildTestArena })          // default anyway
// The returned level has `testPoints` with named positions for scenario scripts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep, lerp, clamp, rand, valueNoise2, damp } from './mathx.js';

const GROUND = 1.0;
const PAD = { x0: -16, z0: -8, x1: 34, z1: 44 };     // flat test pad at y = GROUND
const POOL = { x: -27, z: 10, r: 9 };
const MOUND = { x: 30, z: -22 };

function rectDistance(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** Arena heightfield (y at x,z). Exported so tests can reason about it. */
export function arenaHeight(x, z) {
  const hills = 0.9 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06 - 0.4)
    + 0.45 * Math.sin(x * 0.15 - z * 0.12) + 0.25 * Math.sin(z * 0.21 + x * 0.05) + 0.5;
  const flat = smoothstep(0, 12, rectDistance(x, z, PAD));
  let h = GROUND + hills * flat;
  // enclosing hills
  const edge = Math.max(Math.abs(x - 9), Math.abs(z - 18));
  h += smoothstep(52, 78, edge) * 10 + smoothstep(50, 80, edge) * Math.sin(x * 0.2 + z * 0.13) * 1.5;
  // bog pool
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  h = lerp(h, -1.5, 1 - smoothstep(POOL.r * 0.45, POOL.r, pd));
  // steep mound (> 50 degree flanks) for slope tests
  const md = Math.hypot(x - MOUND.x, z - MOUND.z);
  h += 6.5 * (1 - smoothstep(1.5, 6.0, md));
  return h;
}

function makeTerrain(ctx) {
  const n = new THREE.Vector3();
  const terrain = {
    sample: arenaHeight,
    normal(x, z) {
      const e = 0.2;
      return n.set(arenaHeight(x - e, z) - arenaHeight(x + e, z), 2 * e, arenaHeight(x, z - e) - arenaHeight(x, z + e)).normalize();
    },
    surfaceAt(x, z) { return arenaHeight(x, z) < 0.7 ? 'mud' : 'moss'; },
  };
  ctx.physics.setTerrain(terrain);

  // mesh
  const size = 180, seg = 150;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(9, 0, 18);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const pal = ctx.materials.palette;
  const moss = new THREE.Color(pal.moss), mossDark = new THREE.Color(pal.mossDark), mud = new THREE.Color(0x5b4a33), sand = new THREE.Color(0x9a8a5a);
  const cool = new THREE.Color(0x2f5a4c), olive = new THREE.Color(0x7d8a3e);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = arenaHeight(x, z);
    pos.setY(i, y);
    const nrm = terrain.normal(x, z);
    const noise = valueNoise2(x * 0.18, z * 0.18) * 0.6 + valueNoise2(x * 0.6, z * 0.6) * 0.4;
    const big = valueNoise2(x * 0.035 + 7, z * 0.035 - 3);
    c.copy(moss).multiplyScalar(0.8).lerp(mossDark, clamp((1 - nrm.y) * 2.2 + noise * 0.45 + 0.1, 0, 1));
    c.lerp(cool, smoothstep(0.45, 0.85, big) * 0.55);
    c.lerp(olive, smoothstep(0.55, 0.9, 1 - big) * 0.35);
    if (y < 0.9) c.lerp(mud, smoothstep(0.9, 0.2, y));
    if (y > 0.2 && y < 0.6) c.lerp(sand, 0.2);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const grassTex = ctx.materials.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, w, h);
    const r = rand(7);
    g.lineCap = 'round';
    for (let k = 0; k < 700; k++) {
      const v = 175 + r() * 80;
      g.strokeStyle = `rgba(${v},${v},${v},0.8)`;
      g.lineWidth = 1 + r() * 1.5;
      const x = r() * w, y = r() * h, len = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); g.stroke();
      }
    }
  }, { repeat: [70, 70] });
  const mat = ctx.materials.toon(0xffffff, { vertexColors: true, map: grassTex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'arena-terrain';
  ctx.scene.add(mesh);
  return { terrain, mesh };
}

// --- box helpers --------------------------------------------------------------
function boxGeometry(min, max, texScale = 1) {
  const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  // world-scaled UVs per face (+x,-x,+y,-y,+z,-z)
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / texScale, uv.getY(i) * dims[f][1] / texScale);
    }
  }
  return g;
}

function woodTexture(M) {
  return M.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#8a6440'; g.fillRect(0, 0, w, h);
    const r = rand(3);
    for (let p = 0; p < 4; p++) {
      const y = p * 32;
      g.fillStyle = `rgb(${120 + r() * 30},${86 + r() * 20},${54 + r() * 14})`;
      g.fillRect(0, y + 2, w, 28);
      g.strokeStyle = 'rgba(60,36,20,0.35)'; g.lineWidth = 1;
      for (let k = 0; k < 6; k++) { g.beginPath(); const yy = y + 5 + r() * 22; g.moveTo(0, yy); g.bezierCurveTo(40, yy + r() * 4 - 2, 80, yy + r() * 4 - 2, w, yy); g.stroke(); }
      g.fillStyle = '#3a2416'; g.fillRect(0, y, w, 2);
      g.fillStyle = '#4a3020'; g.beginPath(); g.arc(10 + r() * 100, y + 16, 2.5, 0, 7); g.fill();
    }
  }, { repeat: [1, 1] });
}

function stoneTexture(M) {
  return M.canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#6f7470'; g.fillRect(0, 0, w, h);
    const r = rand(11);
    const rows = 4;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * 32;
      for (let x = -1; x < 3; x++) {
        const v = 115 + r() * 35;
        g.fillStyle = `rgb(${v - 6},${v + 4},${v - 4})`;
        g.fillRect(x * 64 + off + 2, y * 32 + 2, 60, 28);
        g.fillStyle = 'rgba(120,160,90,0.35)';
        if (r() < 0.5) g.fillRect(x * 64 + off + 2, y * 32 + 2, 60, 5 + r() * 6);
      }
    }
  }, { repeat: [1, 1] });
}

function labelSprite(M, text) {
  const tex = M.canvasTexture(256, 96, (g, w, h) => {
    g.fillStyle = 'rgba(26,21,48,0.82)';
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 18); g.fill();
    g.strokeStyle = '#ffc35a'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#ffe9b8'; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(1.4, 0.52, 1);
  return s;
}

// --- training dummy ------------------------------------------------------------
function burlapTexture(M) {
  return M.canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#a5845a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,48,26,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < w; k += 3) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
  }, { repeat: [3, 2] });
}

let dummyAssets = null;
function getDummyAssets(ctx) {
  if (dummyAssets) return dummyAssets;
  const M = ctx.materials;
  const sackProfile = [[0, 0.0], [0.24, 0.02], [0.32, 0.14], [0.34, 0.32], [0.3, 0.5], [0.2, 0.6], [0.14, 0.64], [0, 0.65]].map(([r, y]) => new THREE.Vector2(r, y));
  const targetTex = M.canvasTexture(64, 64, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const rings = ['#f3e6c8', '#c8453a', '#f3e6c8', '#c8453a'];
    rings.forEach((col, k) => { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 30 - k * 7.5, 0, 7); g.fill(); });
  });
  dummyAssets = {
    sackGeo: new THREE.LatheGeometry(sackProfile, 16),
    headGeo: new THREE.SphereGeometry(0.2, 14, 10),
    postGeo: new THREE.CylinderGeometry(0.055, 0.07, 1.7, 8),
    barGeo: new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6),
    tuftGeo: new THREE.ConeGeometry(0.07, 0.22, 5),
    ropeGeo: new THREE.TorusGeometry(0.31, 0.025, 5, 16),
    targetGeo: new THREE.CircleGeometry(0.17, 20),
    baseGeo: new THREE.CylinderGeometry(0.3, 0.38, 0.12, 10),
    sackMat: M.toon(0xffffff, { map: burlapTexture(M) }),
    strawMat: M.toon(M.palette.straw),
    postMat: M.toon(M.palette.bark),
    ropeMat: M.toon(0x6b5232),
    targetMat: M.toon(0xffffff, { map: targetTex }),
  };
  return dummyAssets;
}

function getDummyMerged(A) {
  if (A.merged) return A.merged;
  const part = (geo, pos, rot = [0, 0, 0], scl = [1, 1, 1]) => {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
    return g.applyMatrix4(m);
  };
  const straw = [part(A.tuftGeo, [-0.55, 1.08, 0], [0, 0, Math.PI / 2]), part(A.tuftGeo, [0.55, 1.08, 0], [0, 0, -Math.PI / 2])];
  for (let k = 0; k < 4; k++) straw.push(part(A.tuftGeo, [Math.cos(k * 1.9) * 0.08, 1.6, Math.sin(k * 1.9) * 0.08], [Math.sin(k * 2.3) * 0.5, 0, Math.cos(k * 1.7) * 0.5]));
  A.merged = {
    sack: mergeGeometries([part(A.sackGeo, [0, 0.55, 0]), part(A.headGeo, [0, 1.42, 0])]),
    wood: mergeGeometries([part(A.postGeo, [0, 0.85, 0]), part(A.barGeo, [0, 1.08, 0], [0, 0, Math.PI / 2])]),
    straw: mergeGeometries(straw),
    rope: part(A.ropeGeo, [0, 1.0, 0], [Math.PI / 2, 0, 0], [0.75, 0.75, 1]),
    target: part(A.targetGeo, [0, 0.88, 0.335], [-0.12, 0, 0]),
  };
  return A.merged;
}

/** Registers the 'dummy' entity type (straw training dummy, 3 hp, respawns after 3 s). */
export function registerDummyType(ctx) {
  ctx.entities.registerType('dummy', (c, def) => createDummy(c, def));
}

function createDummy(ctx, def) {
  const A = getDummyAssets(ctx);
  const M = ctx.materials;
  const root = new THREE.Group(); root.name = 'dummy';
  const p = def.pos || [0, 0, 0];
  root.position.set(p[0], p[1], p[2]);
  root.rotation.y = def.yaw ?? Math.PI;
  const base = new THREE.Mesh(A.baseGeo, A.postMat); base.position.y = 0.06; root.add(base);
  const tilt = new THREE.Group(); root.add(tilt);           // wobble/topple pivot at the base
  // static parts are pre-merged per material (shared by all dummies) to keep draw calls low
  const D = getDummyMerged(A);
  for (const [geo, mat, outline] of [[D.sack, A.sackMat, true], [D.wood, A.postMat, true], [D.straw, A.strawMat, true], [D.rope, A.ropeMat, false], [D.target, A.targetMat, false]]) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = mat !== A.targetMat && mat !== A.ropeMat;
    tilt.add(m);
    if (outline) M.outline(m, 0.02);
  }
  M.outline(base, 0.02);
  base.castShadow = true;

  const collider = ctx.physics.addBox({ min: [p[0] - 0.12, p[1], p[2] - 0.12], max: [p[0] + 0.12, p[1] + 1.55, p[2] + 0.12], surface: 'wood', tag: 'dummy' });

  const e = {
    type: 'dummy', object3d: root, tags: new Set(['enemy', 'dummy', 'target']), alive: true,
    radius: 0.42, height: 1.65, team: 'enemy', hittable: true,
    hp: 3, maxHp: 3,
    get position() { return root.position; },
    wobX: 0, wobZ: 0, wobVX: 0, wobVZ: 0, downT: -1, popT: 1,
    hurt(amount, info) {
      if (!e.hittable) return false;
      e.hp -= amount;
      // wobble away from the hit direction (in local space)
      const d = info && info.dir ? info.dir : new THREE.Vector3(0, 0, 1);
      const yaw = root.rotation.y;
      const lx = d.x * Math.cos(yaw) - d.z * Math.sin(yaw);
      const lz = d.x * Math.sin(yaw) + d.z * Math.cos(yaw);
      const k = (info && info.heavy ? 9 : 5) + amount * 1.5;
      e.wobVX += lz * k; e.wobVZ -= lx * k;
      ctx.particles.burst({ position: new THREE.Vector3(root.position.x, root.position.y + 1.0, root.position.z), count: 12 + amount * 4, color: [0xd9b75e, 0xf0d890, 0xa5845a], speed: 4, life: 0.6, size: 0.14, gravity: 9, kind: 'puff' });
      if (e.hp <= 0) {
        e.hp = 0; e.hittable = false; e.tags.delete('enemy'); e.downT = 0; collider.enabled = false;
        ctx.events.emit('enemy:killed', { entity: e, type: 'dummy', position: root.position.clone(), points: 0 });
        ctx.particles.burst({ position: new THREE.Vector3(root.position.x, root.position.y + 0.9, root.position.z), count: 26, color: [0xd9b75e, 0xf0d890], speed: 6, life: 0.9, size: 0.2, gravity: 10, kind: 'puff' });
      } else {
        ctx.events.emit('enemy:hurt', { entity: e, type: 'dummy', amount, hp: e.hp });
      }
      return true;
    },
    update(dt) {
      if (e.downT >= 0) {
        e.downT += dt;
        const k = Math.min(1, e.downT / 0.45);
        tilt.rotation.x = lerp(tilt.rotation.x, 1.5, k * k);
        tilt.rotation.z = damp(tilt.rotation.z, 0, 6, dt);
        if (e.downT > 3) {
          // respawn pop
          e.downT = -1; e.hp = e.maxHp; e.hittable = true; e.tags.add('enemy'); collider.enabled = true;
          tilt.rotation.set(0, 0, 0); e.wobX = e.wobZ = e.wobVX = e.wobVZ = 0; e.popT = 0;
          ctx.particles.burst({ position: new THREE.Vector3(root.position.x, root.position.y + 0.8, root.position.z), count: 14, color: [0xffc35a, 0xffffff], speed: 3, life: 0.5, size: 0.12, kind: 'glow' });
        }
        return;
      }
      e.wobVX += (-90 * e.wobX - 5 * e.wobVX) * dt;
      e.wobVZ += (-90 * e.wobZ - 5 * e.wobVZ) * dt;
      e.wobX = clamp(e.wobX + e.wobVX * dt, -0.9, 0.9);
      e.wobZ = clamp(e.wobZ + e.wobVZ * dt, -0.9, 0.9);
      tilt.rotation.set(e.wobX, 0, e.wobZ);
      if (e.popT < 1) {
        e.popT = Math.min(1, e.popT + dt / 0.35);
        const s = 1 + Math.sin(e.popT * Math.PI) * 0.25;
        tilt.scale.set(1 / Math.sqrt(s), e.popT * s, 1 / Math.sqrt(s));
      } else tilt.scale.set(1, 1, 1);
    },
    dispose(c) { c.physics.removeCollider(collider); },
  };
  return e;
}

// --- moving platform (arena-local; the level area owns the real 'movingPlatform') ----
function createArenaMover(ctx, opts) {
  const M = ctx.materials;
  const size = opts.size;
  const geo = boxGeometry([-size[0] / 2, -size[1] / 2, -size[2] / 2], [size[0] / 2, size[1] / 2, size[2] / 2], 1.5);
  const mesh = new THREE.Mesh(geo, M.toon(0xffffff, { map: opts.woodTex }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  M.outline(mesh, 0.04);
  // glowing corner studs so it reads as "special"
  const stud = new THREE.SphereGeometry(0.1, 8, 6);
  const studMat = M.glow(M.palette.glowCyan, 2.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const s = new THREE.Mesh(stud, studMat);
    s.position.set(sx * (size[0] / 2 - 0.2), size[1] / 2 + 0.02, sz * (size[2] / 2 - 0.2));
    mesh.add(s);
  }
  const root = new THREE.Group(); root.add(mesh);
  const a = new THREE.Vector3(...opts.from), b = new THREE.Vector3(...opts.to);
  root.position.copy(a);
  const col = ctx.physics.addMover(ctx.physics.addBox({ center: opts.from, size, surface: 'wood', tag: 'arenaMover' }));
  const len = a.distanceTo(b);
  let t = 0, dir = 1, pause = 0;
  const e = {
    type: 'arenaMover', object3d: root, tags: new Set(['mover']), alive: true, radius: 1.5, team: 'neutral',
    collider: col,
    get position() { return root.position; },
    update(dt) {
      if (pause > 0) { pause -= dt; col.setPosition(root.position); return; }
      t += (dir * opts.speed * dt) / len;
      if (t >= 1) { t = 1; dir = -1; pause = opts.pause; }
      if (t <= 0) { t = 0; dir = 1; pause = opts.pause; }
      const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65; // eased ends
      root.position.lerpVectors(a, b, s);
      col.setPosition(root.position);
    },
    dispose(c) { c.physics.removeCollider(col); },
  };
  return e;
}

// --- decor -------------------------------------------------------------------
function addDecor(ctx, r) {
  const M = ctx.materials, pal = M.palette, scene = ctx.scene;
  const group = new THREE.Group(); group.name = 'arena-decor';
  scene.add(group);

  // glowing mushrooms (instanced stems + caps)
  const spots = [];
  for (let k = 0; k < 70; k++) {
    let x, z;
    if (k < 22) { const a = r() * Math.PI * 2, d = POOL.r + 0.5 + r() * 4; x = POOL.x + Math.cos(a) * d; z = POOL.z + Math.sin(a) * d; }
    else { x = r.range(-45, 62); z = r.range(-30, 66); if (rectDistance(x, z, PAD) < 2) continue; }
    const y = arenaHeight(x, z);
    if (y < 0.6) continue;
    spots.push([x, y, z, 0.5 + r() * 0.9, r() < 0.55 ? pal.glowCyan : pal.glowMagenta]);
  }
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.08, 1, 6).translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
  const stems = new THREE.InstancedMesh(stemGeo, M.toon(0xe8dcc0), spots.length);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pV = new THREE.Vector3(), col = new THREE.Color();
  spots.forEach(([x, y, z, h, c], i) => {
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3));
    m4.compose(pV.set(x, y, z), q, s.set(1, h * 0.55, 1)); stems.setMatrixAt(i, m4);
    m4.compose(pV.set(x, y + h * 0.55, z), q, s.setScalar(0.7 + h * 0.6)); caps.setMatrixAt(i, m4);
    caps.setColorAt(i, col.set(c).multiplyScalar(2.1));
  });
  stems.castShadow = true;
  group.add(stems, caps);

  // twisted trees around the edges
  const trunkGeos = [], leafGeos = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + r() * 0.2;
    const d = 46 + r() * 14;
    const x = 9 + Math.cos(a) * d, z = 18 + Math.sin(a) * d;
    const y = arenaHeight(x, z) - 0.3;
    const hgt = 6 + r() * 5;
    const pts = [];
    for (let j = 0; j <= 5; j++) pts.push(new THREE.Vector3(Math.sin(j * 0.9 + k) * 0.6 * (j / 5), (j / 5) * hgt, Math.cos(j * 0.7 + k) * 0.5 * (j / 5)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tg = new THREE.TubeGeometry(curve, 8, 0.35, 6, false);
    // taper
    const tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const yy = tp.getY(i) / hgt;
      const cp = curve.getPoint(clamp(yy, 0, 1));
      const kx = tp.getX(i) - cp.x, kz = tp.getZ(i) - cp.z;
      const taper = lerp(1.25, 0.45, yy);
      tp.setXYZ(i, cp.x + kx * taper + x, tp.getY(i) + y, cp.z + kz * taper + z);
    }
    tg.computeVertexNormals();
    trunkGeos.push(tg);
    const top = curve.getPoint(1);
    for (let j = 0; j < 4; j++) {
      const lg = new THREE.IcosahedronGeometry(1.4 + r() * 1.2, 0);
      lg.scale(1.2, 0.75, 1.2);
      lg.translate(x + top.x + (r() - 0.5) * 2.6, y + top.y + (r() - 0.3) * 1.4, z + top.z + (r() - 0.5) * 2.6);
      leafGeos.push(lg);
    }
  }
  const trunks = new THREE.Mesh(mergeGeometries(trunkGeos), M.toon(pal.bark));
  const leaves = new THREE.Mesh(mergeGeometries(leafGeos), M.toon(0x355e33));
  trunks.castShadow = leaves.castShadow = true;
  M.outline(trunks, 0.06); M.outline(leaves, 0.08);
  group.add(trunks, leaves);

  // rocks
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, M.toon(0x7d8479), 26);
  for (let i = 0; i < 26; i++) {
    let x = r.range(-40, 58), z = r.range(-26, 62);
    if (rectDistance(x, z, PAD) < 3) { x -= 60; }
    const sc = 0.4 + r() * 1.1;
    m4.compose(pV.set(x, arenaHeight(x, z) + sc * 0.2, z), q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), s.set(sc * 1.3, sc * 0.8, sc));
    rocks.setMatrixAt(i, m4);
  }
  rocks.castShadow = true; rocks.receiveShadow = true;
  group.add(rocks);

  // grass tufts
  const bladeGeo = new THREE.ConeGeometry(0.035, 0.3, 3).translate(0, 0.15, 0);
  const grassCount = 900;
  const grass = new THREE.InstancedMesh(bladeGeo, M.toon(0x6f9a45), grassCount);
  let gi = 0;
  for (let i = 0; i < grassCount * 2 && gi < grassCount; i++) {
    const x = r.range(-50, 68), z = r.range(-34, 70);
    const y = arenaHeight(x, z);
    if (y < 0.8) continue;
    const sc = 0.6 + r() * 0.9;
    m4.compose(pV.set(x, y - 0.03, z), q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5)), s.set(sc, sc * (0.8 + r() * 0.8), sc));
    grass.setMatrixAt(gi++, m4);
  }
  grass.count = gi;
  grass.receiveShadow = true;
  group.add(grass);

  // lantern post near the spawn
  const lantern = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), M.toon(pal.bark));
  post.position.y = 1.2;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.07), M.toon(pal.bark)); arm.position.set(0.25, 2.3, 0);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.34, 6), M.toon(0x3a2a20)); cage.position.set(0.5, 2.0, 0);
  const glowCore = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), M.glow(pal.amber, 2.2)); glowCore.position.set(0.5, 2.0, 0); glowCore.userData.noOutline = true;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.softDotTexture(), color: pal.amber, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32, fog: false }));
  halo.position.copy(glowCore.position); halo.scale.setScalar(1.3);
  lantern.add(post, arm, cage, glowCore, halo);
  M.outline(post, 0.02); M.outline(arm, 0.02); M.outline(cage, 0.02);
  post.castShadow = true;
  lantern.position.set(-3.5, GROUND, -2.5);
  lantern.rotation.y = Math.PI * 0.75;
  group.add(lantern);

  // fireflies
  const ffCount = 70;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(ffCount * 3);
  const ffSeed = [];
  for (let i = 0; i < ffCount; i++) {
    const x = r.range(-40, 58), z = r.range(-26, 62);
    ffSeed.push([x, arenaHeight(x, z) + 0.6 + r() * 2.2, z, r() * 10]);
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3).setUsage(THREE.DynamicDrawUsage));
  const ffMat = new THREE.PointsMaterial({ map: M.softDotTexture(), color: new THREE.Color(0xd8ff8a).multiplyScalar(2.0), size: 0.16, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  group.add(fireflies);
  const animateFireflies = (t) => {
    for (let i = 0; i < ffCount; i++) {
      const [x, y, z, ph] = ffSeed[i];
      ffPos[i * 3] = x + Math.sin(t * 0.4 + ph) * 1.2;
      ffPos[i * 3 + 1] = y + Math.sin(t * 0.9 + ph * 2) * 0.35;
      ffPos[i * 3 + 2] = z + Math.cos(t * 0.33 + ph) * 1.2;
    }
    ffGeo.attributes.position.needsUpdate = true;
  };
  animateFireflies(0);
  return { group, animateFireflies };
}

// --- arena ---------------------------------------------------------------------
/** Build the test arena into ctx. Returns the level object (see docs/core.md "Level object"). */
export function buildTestArena(ctx) {
  const M = ctx.materials, physics = ctx.physics, scene = ctx.scene;
  const r = rand(1234);
  if (!ctx.entities.hasType('dummy')) registerDummyType(ctx);
  makeTerrain(ctx);
  physics.waterLevel = 0;

  // simple bog water (the level area owns the real water shader)
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    M.toon(M.palette.bog, { transparent: true, opacity: 0.88, emissive: 0x0c2a26 }));
  water.position.set(9, 0, 18);
  water.receiveShadow = true;
  water.name = 'arena-water';
  scene.add(water);
  // lily pads in the pool
  const padGeo = new THREE.CircleGeometry(0.7, 14, 0.3, Math.PI * 2 - 0.3).rotateX(-Math.PI / 2);
  const padMat = M.toon(0x4f8f3a, { side: THREE.DoubleSide });
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2, d = r() * POOL.r * 0.5;
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(POOL.x + Math.cos(a) * d, 0.03, POOL.z + Math.sin(a) * d);
    pad.rotation.y = r() * 6; pad.scale.setScalar(0.6 + r() * 0.7);
    scene.add(pad);
  }

  const woodTex = woodTexture(M), stoneTex = stoneTexture(M);
  const stoneMat = M.toon(0xffffff, { map: stoneTex });
  const woodMat = M.toon(0xffffff, { map: woodTex });
  const stoneGeos = [], woodGeos = [];
  const labels = new THREE.Group(); labels.name = 'arena-labels'; scene.add(labels);
  const tp = { lanes: {}, ladder: [], dummies: [] };

  const box = (min, max, kind = 'stone', tag = null, texScale = 2) => {
    const c = physics.addBox({ min, max, surface: kind, tag });
    (kind === 'wood' ? woodGeos : stoneGeos).push(boxGeometry(min, max, texScale));
    return c;
  };
  const label = (text, x, y, z) => { const s = labelSprite(M, text); s.position.set(x, y, z); labels.add(s); };

  // step lanes: walk +Z from z=4 into boxes at z 8..11
  [[0.2, 4], [0.35, 7], [0.5, 10], [1.0, 13], [2.0, 16]].forEach(([h, x]) => {
    const c = box([x - 1, GROUND, 8], [x + 1, GROUND + h, 11], 'stone', `step${h}`);
    label(`${h.toFixed(h < 1 ? 2 : 1)} m`, x, GROUND + h + 0.7, 8.2);
    tp.lanes[h] = { start: [x, GROUND, 4], box: c };
  });

  // stairs: 6 steps of 0.3 m, then a landing at +1.8 m
  for (let k = 0; k < 6; k++) box([19, GROUND, 8 + k], [22, GROUND + 0.3 * (k + 1), 9 + k], 'wood', 'stairs', 1.5);
  box([19, GROUND, 14], [22, GROUND + 1.8, 18], 'wood', 'landing', 1.5);
  label('stairs 0.3', 20.5, GROUND + 2.6, 7.6);

  // jump ladder (1.5 m rises) up to the 6 m glide tower
  [[14, 2.5], [17.5, 4.0], [21, 5.5]].forEach(([z, top]) => {
    tp.ladder.push(box([-6, GROUND, z], [-4, top, z + 2], 'wood', 'ladder', 1.5));
  });
  box([-12, GROUND, 24], [-8, GROUND + 6, 28], 'stone', 'tower', 2);
  label('6 m', -10, GROUND + 6.8, 24);
  tp.towerTop = [-10, GROUND + 6, 26];
  tp.towerEdge = [-10, GROUND + 6, 24.3];   // walk -Z off this edge for glide tests

  // tall wall for camera-collision tests
  tp.wall = box([-14, GROUND, 38], [-2, GROUND + 8, 39], 'stone', 'wall', 2);
  tp.wallFront = [-8, GROUND, 37.4];

  // thin slab (0.3 m) for the 60 m fall / tunnelling test
  tp.slab = box([28, 3.7, 32], [32, 4.0, 36], 'wood', 'slab', 1.5);
  tp.slabCenter = [30, 4.0, 34];

  const stoneMesh = new THREE.Mesh(mergeGeometries(stoneGeos), stoneMat);
  const woodMesh = new THREE.Mesh(mergeGeometries(woodGeos), woodMat);
  for (const m of [stoneMesh, woodMesh]) { m.castShadow = true; m.receiveShadow = true; M.outline(m, 0.035); scene.add(m); }

  // moving platform
  const mover = createArenaMover(ctx, { size: [3, 0.5, 3], from: [27, 2.0, 12], to: [27, 2.0, 26], speed: 3, pause: 1, woodTex });
  ctx.entities.add(mover);
  tp.mover = mover;
  tp.moverStart = [27, 2.25, 12];

  // dummies
  for (const pos of [[2, GROUND, 18], [8, GROUND, 24], [-2, GROUND, 32]]) {
    tp.dummies.push(ctx.entities.spawn({ type: 'dummy', pos, yaw: Math.PI }));
  }

  tp.pool = [POOL.x, 0, POOL.z];
  tp.poolEdge = [POOL.x + POOL.r + 1.5, arenaHeight(POOL.x + POOL.r + 1.5, POOL.z), POOL.z];
  tp.mound = [MOUND.x, arenaHeight(MOUND.x, MOUND.z), MOUND.z];
  tp.open = [0, GROUND, -4];

  const decor = addDecor(ctx, r);

  const level = {
    name: 'Test Arena',
    isTestArena: true,
    spawn: { position: [0, GROUND, 0], yaw: 0 },
    checkpoints: [
      { id: 'start', position: [0, GROUND, 0], yaw: 0 },
      { id: 'tower', position: tp.towerTop, yaw: Math.PI },
      { id: 'far', position: [12, GROUND, 40], yaw: Math.PI },
    ],
    zone: 'arena',
    testPoints: tp,
    update() {},
    frame(realDt) { decor.animateFireflies(ctx.time.real); void realDt; },
  };
  return level;
}
