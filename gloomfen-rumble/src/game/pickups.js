// Pickups area: glowcaps (instanced), berries, tonic jars, glowworm cages, lantern checkpoints
// and the Lantern Gate that ends the level.
//
//   import { installPickups } from './game/pickups.js';
//   boot({ install: [installAudio, installScore, installUI, installEnemies, installPickups, installMechanisms] })
//
// Registers the spawn types glowcap, glowcapLine, glowcapRing, berry, tonic, cage, checkpoint,
// lanternGate and sets ctx.pickups (see docs/pickups.md). All geometry is procedural.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, dampAngle, rand, easeOutBack, easeOutCubic, smoothstep } from '../core/mathx.js';

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------
export const PICKUP_TUNING = {
  glowcap: {
    points: 50,
    hover: 0.85,           // m above the ground when a spawn's y is null (centre of the cap)
    magnetRadius: 2.2,     // starts drifting toward Morel
    collectRadius: 0.9,    // collected (distance to Morel's body axis)
    magnetSpeed: [2.2, 10],// m/s at the edge / right next to Morel
    bob: 0.08, spin: 1.7,  // visual
    halo: 1.1,             // halo sprite size (m)
    cull: 120,             // not drawn beyond this distance from the camera (fog hides it anyway)
    nearFade: [0.5, 1.8],  // m from the camera: shrinks away instead of filling the screen (integration)
  },
  berry: { radius: 1.0, heal: 1 },
  tonic: { radius: 1.05, duration: 20, respawn: 8, hover: 0.95 },
  cage: { hits: 2, points: 500, radius: 0.62 },
  checkpoint: { radius: 2.5, side: 1.7 },
  gate: { riseDelay: 1.6, riseTime: 3.4, openTime: 1.4, depth: 5.6 },
};

export const TONIC_STYLE = {
  anvil: { liquid: 0x5f8ad6, glow: 1.25, accent: 0xe4ecf8, halo: 0x8fb4ff, label: 'Anvil Tonic' },
  updraft: { liquid: 0x6fe04a, glow: 1.15, accent: 0xf0ffe0, halo: 0x9cff7a, label: 'Updraft Tonic' },
  seeker: { liquid: 0xf04aa0, glow: 1.15, accent: 0xffe2f2, halo: 0xff70c0, label: 'Seeker Tonic' },
};

/** Thank-you lines of freed glowworms (cycled without repeats). */
export const GLOWWORM_LINES = [
  'Free at last! Thank you, Morel!',
  'Whee! I can see the moon again!',
  'Those toads snore like thunder. Thanks for the rescue!',
  'My antennae are all a-tingle! Thank you!',
  'No more bandit soup for me! Glow on, Morel!',
  "I'll tell the whole fen what you did!",
  'Free! Free! Wiggle-wiggle-free!',
  "You're the bravest mushroom in Gloomfen!",
];

const UP = new THREE.Vector3(0, 1, 0);
const IDLE = 0, MAGNET = 1, COLLECT = 2;

// scratch objects (never escape a function)
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _zero = new THREE.Vector3();
const DEFAULT_DIR = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const toVec = (a, out = new THREE.Vector3()) => (Array.isArray(a) ? out.set(a[0], a[1] ?? 0, a[2]) : out.copy(a));
const hasY = (p) => Array.isArray(p) ? p[1] !== null && p[1] !== undefined && Number.isFinite(p[1]) : p && Number.isFinite(p.y);

/** Highest walkable surface under (x, z) (below hintY + 2.5 if given). */
function groundAt(ctx, x, z, hintY) {
  const ph = ctx.physics;
  let y = ph.groundHeight(x, z, Number.isFinite(hintY) ? hintY + 2.5 : 400);
  if (y === -Infinity) y = ph.groundHeight(x, z, Infinity);
  if (y === -Infinity) y = ph.waterLevel ?? 0;
  return y;
}

/** Squared distance from p to Morel's body axis (feet .. feet + height). */
function playerAxisDist2(ctx, p) {
  const pl = ctx.player, pp = pl.position;
  const y = clamp(p.y, pp.y, pp.y + (pl.height || 1.05));
  const dx = p.x - pp.x, dy = p.y - y, dz = p.z - pp.z;
  return dx * dx + dy * dy + dz * dz;
}
const canCollect = (pl) => pl && pl.state !== 'dead' && pl.visible !== false;

/** Non-indexed copy with a constant vertex colour. */
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (geo !== g) geo.dispose();
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = color && color.isColor ? color : _c.set(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/** Non-indexed copy coloured per vertex by fn(x, y, z, nx, ny, nz, outColor). */
function paintBy(geo, fn) {
  const g = paint(geo, 0xffffff);
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), c);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

/** Transform a geometry in place: position [x,y,z], rotation [x,y,z] (Euler), scale number|[x,y,z]. */
function place(geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = 1) {
  const s = Array.isArray(scl) ? scl : [scl, scl, scl];
  _m.compose(_v.set(pos[0], pos[1], pos[2]), _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), _s.set(s[0], s[1], s[2]));
  geo.applyMatrix4(_m);
  return geo;
}

/** Cylinder from a to b (Vector3), radius r0 at a and r1 at b. */
function cylBetween(a, b, r0, r1 = r0, seg = 6) {
  const dir = _v.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Tube along points with a radius profile radiusAt(u) (u 0..1). */
function taperedTube(points, radius, radiusAt, tubular = 24, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  const pos = g.attributes.position;
  const ring = radial + 1;
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    const c = curve.getPointAt(u);
    const k = radiusAt(u);
    for (let j = 0; j < ring; j++) {
      const idx = i * ring + j;
      pos.setXYZ(idx, c.x + (pos.getX(idx) - c.x) * k, c.y + (pos.getY(idx) - c.y) * k, c.z + (pos.getZ(idx) - c.z) * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Point every UV of a geometry at one texel (merging untextured parts with an atlas). */
function setUV(geo, u, v) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return geo;
}

function merge(list) {
  const g = mergeGeometries(list, false);
  for (const x of list) x.dispose();
  return g;
}

/** Flat additive light pool on the ground (shares the soft dot). */
function groundGlow(A, color, radius, opacity) {
  const mat = new THREE.MeshBasicMaterial({ map: A.dot, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: true });
  const m = new THREE.Mesh(A.flatQuad, mat);
  m.scale.set(radius * 2, 1, radius * 2);
  m.position.y = 0.04;
  m.renderOrder = -2;
  m.userData.noOutline = true;
  return m;
}

/** Toon material whose emissive follows the vertex colour: HDR vertex colours (> 1) glow and bloom. */
function vcolorGlowToon(M, emissive = 0.6, opts = {}) {
  const m = M.toon(0xffffff, { vertexColors: true, emissive: 0xffffff, emissiveIntensity: emissive, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;');
  };
  m.customProgramCacheKey = () => 'gloomfen-vcolor-emissive';
  return m;
}

/**
 * Three-tier distance LOD for one pickup (camera distance, updated by the entity each step):
 *   >= hullDist   outline hulls off
 *   >= detailDist small details off (faces, runes, gloss, jar contents)
 *   >= cullDist   main meshes off: only the shared halo (one draw call for all pickups) remains
 * Only meshes listed here are touched; lod.drop(obj) stops managing an object the entity hides itself.
 */
function makeLod(root, { details = [], main = [], hullDist = 38, detailDist = 55, cullDist = 75 } = {}) {
  const hulls = [];
  root.traverse((o) => { if (o.userData.isOutline) hulls.push(o); });
  let level = 0;
  const apply = (list, on) => { for (const o of list) o.visible = on; };
  return {
    update(d) {
      const l = d >= cullDist ? 3 : d >= detailDist ? 2 : d >= hullDist ? 1 : 0;
      if (l === level) return;
      level = l;
      apply(hulls, l < 1);
      apply(details, l < 2);
      apply(main, l < 3);
    },
    drop(obj) {
      for (const list of [hulls, details, main]) { const i = list.indexOf(obj); if (i >= 0) list.splice(i, 1); }
      if (obj.userData.outline) { const i = hulls.indexOf(obj.userData.outline); if (i >= 0) hulls.splice(i, 1); }
    },
    get level() { return level; },
  };
}

// ---------------------------------------------------------------------------------------------
// Shared assets (built once per ctx)
// ---------------------------------------------------------------------------------------------
const ASSETS = new WeakMap();
function assets(ctx) {
  let A = ASSETS.get(ctx);
  if (A) return A;
  const M = ctx.materials;
  A = {
    dot: M.softDotTexture(),
    flatQuad: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  ASSETS.set(ctx, A);
  return A;
}

// Billboarded instanced halos (one draw call for every glowcap halo).
const HALO_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vTint;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  vec4 mvPosition = center + vec4(position.xy * s, 0.0, 0.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const HALO_FRAG = /* glsl */`
uniform sampler2D map;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
varying vec3 vTint;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(map, vUv).a;
  a = a * a * opacity; // softer, gaussian-like falloff than the raw soft dot
  #if defined( USE_FOG ) && defined( FOG_EXP2 )
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    a *= 1.0 - fogF;
  #endif
  gl_FragColor = vec4(color * vTint, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Glass: fresnel rim + a glossy view-space streak (reads as glass without an outline hull).
const GLASS_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const GLASS_FRAG = /* glsl */`
uniform vec3 uTint;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(vN);
  float f = 1.0 - clamp(abs(dot(n, normalize(vV))), 0.0, 1.0);
  float rim = pow(f, 2.0);
  vec3 col = uTint * (0.55 + 0.8 * rim);
  float a = uOpacity + rim * 0.7;
  float s = dot(n, normalize(vec3(-0.5, 0.45, 0.74)));
  float spec = smoothstep(0.93, 0.985, s);
  float s2 = dot(n, normalize(vec3(0.62, -0.1, 0.78)));
  spec += smoothstep(0.96, 0.99, s2) * 0.4;
  col += vec3(1.05) * spec;
  a = max(a, spec * 0.8);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// Lantern Gate portal: two-colour spiral with a bright core and a rim.
const PORTAL_VERT = /* glsl */`
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PORTAL_FRAG = /* glsl */`
uniform float uTime;
uniform float uOpen;
uniform float uFlare;
varying vec2 vUv;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float open = max(uOpen, 0.001);
  float r = length(p) / open;
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float tw = uTime;
  float sw = a * 3.0 + r * 7.5 - tw * 2.1 + noise(p * 3.0 + tw * 0.3) * 1.4;
  float arms = 0.5 + 0.5 * sin(sw);
  float fine = 0.5 + 0.5 * sin(a * 7.0 - r * 16.0 + tw * 1.4);
  vec3 amber = vec3(1.0, 0.48, 0.08);
  vec3 cyan = vec3(0.12, 0.85, 0.78);
  vec3 deep = vec3(0.03, 0.08, 0.16);
  float m = smoothstep(0.35, 0.75, arms * 0.85 + fine * 0.15);
  vec3 col = mix(cyan, amber, m);
  // dark lanes between the spiral arms give the swirl its contrast
  float lane = smoothstep(0.15, 0.55, arms + fine * 0.2);
  col = mix(deep, col, 0.25 + 0.75 * lane);
  float core = exp(-r * r * 9.0);
  col = mix(col, vec3(1.0, 0.9, 0.7), core * 0.7);
  float rim = smoothstep(0.82, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
  col += mix(amber, cyan, 0.5 + 0.5 * sin(a * 2.0 + tw)) * rim * 0.9;
  col *= 1.0 + uFlare * 1.5;
  float alpha = (1.0 - smoothstep(0.93, 1.0, r)) * (0.82 + 0.18 * lane) * clamp(uOpen * 1.6, 0.0, 1.0);
  gl_FragColor = vec4(col * 0.85, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function fogShaderMaterial(params) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, params.uniforms || {}]);
  return new THREE.ShaderMaterial({ ...params, uniforms, fog: true });
}

// ---------------------------------------------------------------------------------------------
// Glowcaps: one InstancedMesh (+ outline hull + instanced halo) for every glowcap in the level
// ---------------------------------------------------------------------------------------------
function buildGlowcapGeometry() {
  // gem-cut crystal mushroom: 6-sided lathe (table top, crown facets, overhanging rim), flat shaded
  const prof = [
    [0.0, -0.25], [0.072, -0.25], [0.088, -0.225], [0.07, -0.13], [0.06, -0.045],
    [0.19, -0.075], [0.3, -0.045], [0.315, 0.0], [0.255, 0.115], [0.14, 0.205], [0.0, 0.22],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(prof, 6, Math.PI / 6);
  const stem = new THREE.Color(0xc6f6ee), gill = new THREE.Color(0x0f6f7c), rim = new THREE.Color(0x22d2c6),
    crown = new THREE.Color(0x63ecdf), table = new THREE.Color(0xb8fff6);
  const out = paintBy(g, (x, y, z, nx, ny, nz, c) => {
    const r = Math.hypot(x, z);
    if (y < -0.035 && r < 0.095) c.copy(stem);
    else if (y < -0.03 || (r < 0.2 && y < 0)) c.copy(gill);
    else if (y > 0.2) c.copy(table);
    else c.copy(rim).lerp(crown, smoothstep(0.0, 0.2, y));
  });
  // per-facet brightness jitter -> glinting gem facets as it spins
  const col = out.attributes.color;
  const R = rand(5);
  for (let f = 0; f < col.count; f += 3) {
    const k = 0.82 + R() * 0.36;
    for (let j = 0; j < 3; j++) col.setXYZ(f + j, col.getX(f + j) * k, col.getY(f + j) * k, col.getZ(f + j) * k);
  }
  out.computeVertexNormals(); // non-indexed -> per-face normals: faceted crystal look
  return out;
}

function createGlowcapSystem(ctx, P) {
  const M = ctx.materials;
  const T = PICKUP_TUNING.glowcap;
  const group = new THREE.Group();
  group.name = 'glowcaps';
  ctx.scene.add(group);
  const capGeo = buildGlowcapGeometry();
  // emissive follows the vertex/instance colour (table glows bright, gills stay deep teal)
  const capMat = vcolorGlowToon(M, 0.42);
  const haloGeo = new THREE.PlaneGeometry(1, 1);
  const haloMat = fogShaderMaterial({
    uniforms: { map: { value: null }, color: { value: new THREE.Color(0x5ef2e0) }, opacity: { value: 0.42 } },
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  haloMat.uniforms.map.value = P.A.dot;

  const caps = [];
  let capacity = 0, capMesh = null, hull = null, halo = null;
  const white = new THREE.Color(1, 1, 1);
  function build(n) {
    if (capMesh) { group.remove(capMesh, halo); capMesh.dispose(); halo.dispose(); }
    capacity = n;
    capMesh = new THREE.InstancedMesh(capGeo, capMat, n);
    capMesh.name = 'glowcap-caps';
    capMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    capMesh.setColorAt(0, white);
    capMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    capMesh.frustumCulled = false;
    hull = M.outline(capMesh, 0.016);
    hull.frustumCulled = false;
    halo = new THREE.InstancedMesh(haloGeo, haloMat, n);
    halo.name = 'glowcap-halos';
    halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    halo.setColorAt(0, white);
    halo.instanceColor.setUsage(THREE.DynamicDrawUsage);
    halo.frustumCulled = false;
    halo.renderOrder = 6;
    capMesh.count = hull.count = halo.count = 0;
    capMesh.visible = halo.visible = false;
    group.add(capMesh, halo);
  }
  build(192);

  const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
  const BURST = { position: null, count: 14, color: [0x5ef2e0, 0xc8fff8, 0xffffff], speed: 3.6, spread: 1, life: 0.5, size: 0.17, kind: 'glow', intensity: 2.2 };
  const BURST2 = { position: null, count: 6, color: 0xffffff, speed: 5, life: 0.35, size: 0.07, kind: 'spark', gravity: 4 };
  const GLINT = { color: 0xffffff, life: 0.42, size: 0.13, kind: 'glow', intensity: 2.6, drag: 1.5 };
  const glintVel = new THREE.Vector3();
  let glintAcc = 0;
  const sys = {
    caps, group,
    remaining: 0, collected: 0,
    get capacity() { return capacity; },
    get drawn() { return capMesh.count; },

    add(c) {
      if (caps.length + 1 > capacity) build(capacity * 2);
      caps.push(c);
      sys.remaining++;
    },
    remove(c) {
      const i = caps.indexOf(c);
      if (i < 0) return;
      caps[i] = caps[caps.length - 1];
      caps.pop();
      if (c.state !== COLLECT) sys.remaining--;
    },

    updateCap(c, dt) {
      const p = c.object3d.position;
      if (c.state === COLLECT) {
        c.t += dt;
        const k = c.t / 0.24;
        if (k >= 1) { c.scale = 0; c.alive = false; return; }
        const pp = ctx.player.position;
        _v.set(pp.x, pp.y + 1.15, pp.z);
        p.lerp(_v, 1 - Math.exp(-16 * dt));
        c.scale = (1 - k) * (1 + 0.8 * Math.sin(Math.PI * k));
        c.flash = 2.2 - k;
        return;
      }
      if (c.popT < 1) { c.popT = Math.min(1, c.popT + dt / 0.35); c.scale = easeOutBack(c.popT); }
      if (c.flash > 1) c.flash = Math.max(1, c.flash - dt * 3);
      c.bobW = damp(c.bobW, c.state === IDLE ? 1 : 0, 6, dt);
      const pl = ctx.player;
      if (!canCollect(pl)) return;
      const d2 = playerAxisDist2(ctx, p);
      if (d2 < T.collectRadius * T.collectRadius) { sys.collect(c); return; }
      if (d2 < T.magnetRadius * T.magnetRadius) {
        c.state = MAGNET;
        const pp = pl.position;
        _v.set(pp.x - p.x, pp.y + 0.55 - p.y, pp.z - p.z);
        const d = _v.length();
        if (d > 1e-4) {
          const k = 1 - Math.sqrt(d2) / T.magnetRadius;
          const speed = lerp(T.magnetSpeed[0], T.magnetSpeed[1], k * k);
          p.addScaledVector(_v, Math.min(1, (speed * dt) / d));
        }
      } else if (c.state === MAGNET) {
        // Morel moved away: drift back home
        _v.subVectors(c.home, p);
        const d = _v.length();
        if (d < 0.02) { p.copy(c.home); c.state = IDLE; } else p.addScaledVector(_v, Math.min(1, (1.4 * dt) / d));
      }
    },

    collect(c) {
      c.state = COLLECT;
      c.t = 0;
      c.flash = 2.2;
      c.tags.delete('pickup');
      sys.remaining--;
      sys.collected++;
      const pos = c.object3d.position;
      ctx.events.emit('pickup:glowcap', { position: pos.clone(), points: T.points, remaining: sys.remaining });
      BURST.position = pos; BURST2.position = pos;
      ctx.particles.burst(BURST);
      ctx.particles.burst(BURST2);
    },

    /** per fixed step: ambient glints near Morel */
    update(dt) {
      if (!caps.length) return;
      glintAcc += dt;
      const pp = ctx.player.position;
      while (glintAcc > 0.045) {
        glintAcc -= 0.045;
        const c = caps[(Math.random() * caps.length) | 0];
        if (c.state !== IDLE) continue;
        const p = c.object3d.position;
        const dx = p.x - pp.x, dz = p.z - pp.z;
        if (dx * dx + dz * dz > 30 * 30) continue;
        const bob = Math.sin(ctx.time.real * 2.3 + c.phase) * T.bob;
        const a = Math.random() * Math.PI * 2, r = 0.12 + Math.random() * 0.2;
        _v.set(p.x + Math.cos(a) * r, p.y + bob + 0.05 + Math.random() * 0.22, p.z + Math.sin(a) * r);
        glintVel.set(0, 0.35 + Math.random() * 0.4, 0);
        GLINT.color = Math.random() < 0.5 ? 0xffffff : 0x9ffff0;
        ctx.particles.spawn(_v, glintVel, GLINT);
      }
    },

    /** per rendered frame: write instance matrices */
    frame() {
      const t = ctx.time.real;
      const cam = ctx.camera.position;
      const cull2 = T.cull * T.cull;
      const nearFar2 = T.nearFade[1] * T.nearFade[1];
      let n = 0;
      for (let i = 0; i < caps.length; i++) {
        const c = caps[i];
        const p = c.object3d.position;
        const dx = p.x - cam.x, dz = p.z - cam.z;
        if (dx * dx + dz * dz > cull2 || c.scale <= 0.002) continue;
        // right at the lens (camera behind Morel on a narrow path): shrink it away
        const dy = p.y - cam.y, d2 = dx * dx + dy * dy + dz * dz;
        let near = 1;
        if (d2 < nearFar2) { near = (Math.sqrt(d2) - T.nearFade[0]) / (T.nearFade[1] - T.nearFade[0]); if (near <= 0.02) continue; }
        const bob = Math.sin(t * 2.3 + c.phase) * T.bob * c.bobW;
        _v.set(p.x, p.y + bob, p.z);
        _q.setFromAxisAngle(UP, t * T.spin + c.phase).multiply(TILT);
        _s.setScalar(c.scale * near);
        _m.compose(_v, _q, _s);
        capMesh.setMatrixAt(n, _m);
        const tw = (1 + 0.12 * Math.sin(t * 3.3 + c.phase * 1.7)) * c.flash;
        _c.setRGB(tw, tw, tw);
        capMesh.setColorAt(n, _c);
        const hs = T.halo * Math.min(1.3, c.scale) * near * (1 + 0.1 * Math.sin(t * 2.1 + c.phase));
        _m.makeScale(hs, hs, hs).setPosition(_v);
        halo.setMatrixAt(n, _m);
        const hb = c.state === COLLECT ? c.flash : c.state === MAGNET ? 1.35 : 1;
        _c.setRGB(hb, hb, hb);
        halo.setColorAt(n, _c);
        n++;
      }
      capMesh.count = hull.count = halo.count = n;
      capMesh.visible = halo.visible = n > 0;
      if (n > 0) {
        capMesh.instanceMatrix.needsUpdate = true;
        capMesh.instanceColor.needsUpdate = true;
        halo.instanceMatrix.needsUpdate = true;
        halo.instanceColor.needsUpdate = true;
      }
    },
  };
  return sys;
}

// ---------------------------------------------------------------------------------------------
// Halos: every pickup halo (berries, jars, glowworms, lanterns, gate) in ONE instanced billboard
// draw call. Entities add a handle anchored to an Object3D and animate handle.size / opacity.
// ---------------------------------------------------------------------------------------------
function createHaloSystem(ctx, P) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = fogShaderMaterial({
    uniforms: { map: { value: null }, color: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 } },
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  mat.uniforms.map.value = P.A.dot;
  const items = [];
  let capacity = 0, mesh = null;
  function build(n) {
    if (mesh) { ctx.scene.remove(mesh); mesh.dispose(); }
    capacity = n;
    mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = 'pickup-halos';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.count = 0;
    mesh.visible = false;
    ctx.scene.add(mesh);
  }
  build(64);
  // anchor shown = every ancestor visible up to the scene
  const shown = (o) => { while (o) { if (!o.visible) return false; if (o.isScene) return true; o = o.parent; } return false; };
  return {
    get count() { return mesh.count; },
    /** anchor: Object3D; o: { offset:[x,y,z], size (m), color, opacity } -> handle (mutate size/opacity/visible/color) */
    add(anchor, o = {}) {
      const h = {
        anchor, offset: new THREE.Vector3().fromArray(o.offset || [0, 0, 0]),
        size: o.size ?? 1, color: new THREE.Color(o.color ?? 0xffffff), opacity: o.opacity ?? 0.4, visible: true,
      };
      items.push(h);
      if (items.length > capacity) build(capacity * 2);
      return h;
    },
    remove(h) {
      const i = items.indexOf(h);
      if (i >= 0) { items[i] = items[items.length - 1]; items.pop(); }
    },
    frame() {
      let n = 0;
      for (let i = 0; i < items.length; i++) {
        const h = items[i];
        if (!h.visible || h.opacity <= 0.003 || h.size <= 0.001 || !shown(h.anchor)) continue;
        _v.copy(h.offset).applyMatrix4(h.anchor.matrixWorld);
        _m.makeScale(h.size, h.size, h.size).setPosition(_v);
        mesh.setMatrixAt(n, _m);
        _c.copy(h.color).multiplyScalar(h.opacity);
        mesh.setColorAt(n, _c);
        n++;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
    },
  };
}

/** One glowcap entity (the instanced system draws it). */
function createGlowcap(ctx, P, pos, opts = {}) {
  const o = new THREE.Object3D();
  P.holder.add(o); // has a parent -> entities.add() will not put it in the scene
  o.position.copy(pos);
  const sys = P.glowcaps;
  const c = {
    type: 'glowcap', object3d: o, tags: new Set(['glowcap', 'pickup']), alive: true,
    radius: 0.3, height: 0.5, team: 'neutral', hittable: false,
    home: pos.clone(), state: IDLE, t: 0, scale: 1, flash: 1, bobW: 1,
    popT: opts.pop ? 0 : 1,
    phase: Math.random() * Math.PI * 2,
    get position() { return o.position; },
    update(dt) { sys.updateCap(c, dt); },
    dispose() { sys.remove(c); },
  };
  if (opts.pop) c.scale = 0;
  sys.add(c);
  const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`;
  if (ctx.score && ctx.score.registerItem) ctx.score.registerItem('glowcap', key);
  return c;
}

/** Resolve a glowcap position: keep a given y, otherwise hover above the ground. */
function glowcapPos(ctx, x, y, z, hintY, out = new THREE.Vector3()) {
  if (Number.isFinite(y)) return out.set(x, y, z);
  return out.set(x, groundAt(ctx, x, z, hintY) + PICKUP_TUNING.glowcap.hover, z);
}

/** A glowcapLine / glowcapRing returns this group entity; disposing it removes its glowcaps. */
function glowcapGroup(ctx, P, def, points) {
  const o = new THREE.Object3D();
  P.holder.add(o);
  if (points.length) o.position.copy(points[0]);
  const pop = ctx.state === 'playing';
  const children = points.map((p) => ctx.entities.add(createGlowcap(ctx, P, p, { pop })));
  return {
    type: def.type, object3d: o, tags: new Set(['glowcapGroup']), alive: true,
    radius: 0.1, team: 'neutral', hittable: false, children,
    get position() { return o.position; },
    get remaining() { let n = 0; for (const c of children) if (c.alive && c.state !== COLLECT) n++; return n; },
    dispose() { for (const c of children) if (c.alive) ctx.entities.remove(c); },
  };
}

// ---------------------------------------------------------------------------------------------
// Debris: instanced sticks and planks for breaking cages (one draw call)
// ---------------------------------------------------------------------------------------------
function createDebris(ctx) {
  const CAP = 80;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ctx.materials.toon(0xffffff), CAP);
  mesh.name = 'pickup-debris';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.count = 0;
  mesh.visible = false;
  ctx.scene.add(mesh);
  const pieces = [];
  const free = [];
  const dq = new THREE.Quaternion();
  const sys = {
    mesh,
    get count() { return pieces.length; },
    /** size [sx, sy, sz] (m); colour hex */
    spawn(pos, vel, size, color, life = 2.2) {
      if (pieces.length >= CAP) { const old = pieces.shift(); free.push(old); }
      const d = free.pop() || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), axis: new THREE.Vector3(), size: new THREE.Vector3(), color: new THREE.Color() };
      d.pos.copy(pos); d.vel.copy(vel);
      d.q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      d.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      d.spin = 6 + Math.random() * 10;
      d.size.set(size[0], size[1], size[2]);
      d.color.set(color);
      d.life = 0; d.max = life * (0.85 + Math.random() * 0.3);
      d.ground = groundAt(ctx, pos.x, pos.z, pos.y);
      d.gAcc = 0; d.rest = false;
      pieces.push(d);
      return d;
    },
    update(dt) {
      for (let i = pieces.length - 1; i >= 0; i--) {
        const d = pieces[i];
        d.life += dt;
        if (d.life >= d.max) { pieces.splice(i, 1); free.push(d); continue; }
        if (d.rest) continue;
        d.vel.y -= 18 * dt;
        d.pos.addScaledVector(d.vel, dt);
        dq.setFromAxisAngle(d.axis, d.spin * dt);
        d.q.multiply(dq);
        if ((d.gAcc += dt) > 0.15) { d.gAcc = 0; d.ground = groundAt(ctx, d.pos.x, d.pos.z, d.pos.y + 0.3); }
        const h = Math.min(d.size.x, d.size.y, d.size.z) * 0.5;
        if (d.pos.y - h < d.ground) {
          d.pos.y = d.ground + h;
          if (d.vel.y < 0) d.vel.y = -d.vel.y * 0.32;
          d.vel.x *= 0.55; d.vel.z *= 0.55; d.spin *= 0.5;
          if (Math.abs(d.vel.y) < 0.8 && d.vel.lengthSq() < 0.6) { d.rest = true; d.q.setFromEuler(new THREE.Euler(0, Math.random() * 6, 0)); }
        }
      }
    },
    frame() {
      const n = pieces.length;
      for (let i = 0; i < n; i++) {
        const d = pieces[i];
        const shrink = clamp((d.max - d.life) / 0.45, 0, 1);
        _s.copy(d.size).multiplyScalar(shrink);
        _m.compose(d.pos, d.q, _s);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, d.color);
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
    },
  };
  return sys;
}

// ---------------------------------------------------------------------------------------------
// Berry: a cluster of glossy violet-red bog berries on a leaf. Heals 1 heart (stays when full).
// ---------------------------------------------------------------------------------------------
function berryAssets(ctx, A) {
  if (A.berry) return A.berry;
  const M = ctx.materials;
  // leaf: pointed oval, cupped, with a lighter midrib
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.36);
  shape.quadraticCurveTo(0.3, -0.2, 0.26, 0.08);
  shape.quadraticCurveTo(0.2, 0.3, 0, 0.46);
  shape.quadraticCurveTo(-0.2, 0.3, -0.26, 0.08);
  shape.quadraticCurveTo(-0.3, -0.2, 0, -0.36);
  const leafColor = new THREE.Color(0x4f9a3c), leafEdge = new THREE.Color(0x2f6a2a), rib = new THREE.Color(0x9ccf6a);
  const makeLeaf = (scl, rotY, tilt) => {
    const g = new THREE.ShapeGeometry(shape, 10);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, 1.1 * x * x + 0.25 * Math.max(0, -z - 0.15) ** 2 * 3 - 0.08 * Math.max(0, z - 0.2));
    }
    g.computeVertexNormals();
    const pg = paintBy(g, (x, y, z, nx, ny, nz, c) => {
      c.copy(leafColor).lerp(leafEdge, clamp(Math.abs(x) * 3.2, 0, 1) * 0.8);
      if (Math.abs(x) < 0.018) c.copy(rib);
    });
    return place(pg, [0, 0, 0], [tilt, rotY, 0], scl);
  };
  const leaf = merge([makeLeaf(1, 0, 0), makeLeaf(0.72, 2.3, 0.15)]);
  // stem curl + calyx
  const stemCol = new THREE.Color(0x4a3a24);
  const stem = paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0.02, 0.38, 0.02), new THREE.Vector3(0.08, 0.44, 0.0), new THREE.Vector3(0.12, 0.42, -0.04),
  ]), 8, 0.012, 5), stemCol);
  const calyx = paint(place(new THREE.ConeGeometry(0.05, 0.04, 5), [0, 0.355, 0], [Math.PI, 0, 0]), new THREE.Color(0x3c6a2a));
  const leafAll = merge([leaf, stem, calyx]);

  // berries: six spheres in a cluster, slight colour variety
  const spots = [[0, 0.12, 0, 0.13], [0.15, 0.1, 0.06, 0.112], [-0.135, 0.1, 0.07, 0.116], [0.05, 0.1, -0.15, 0.108], [-0.09, 0.105, -0.12, 0.1], [0.015, 0.265, 0.01, 0.112]];
  const tints = [0xa3205a, 0xb3283f, 0x8a1c6a, 0xa8264c, 0x97205f, 0xb52a52];
  const berries = [], gloss = [];
  spots.forEach(([x, y, z, r], i) => {
    berries.push(paintBy(place(new THREE.SphereGeometry(1, 14, 10), [x, y + 0.02, z], [0, 0, 0], r), (bx, by, bz, nx, ny, nz, c) => {
      c.set(tints[i]).lerp(_c.set(0x4a0a2e), clamp(-ny, 0, 1) * 0.45);
    }));
    // glossy highlights just proud of the surface (upper-left key light + a small rim glint)
    gloss.push(paint(place(new THREE.SphereGeometry(1, 8, 6), [x - r * 0.36, y + 0.02 + r * 0.71, z + r * 0.48], [0.5, 0, -0.4], [r * 0.24, r * 0.12, r * 0.18]), 0xffffff));
    gloss.push(paint(place(new THREE.SphereGeometry(1, 6, 4), [x + r * 0.2, y + 0.02 + r * 0.43, z + r * 0.86], [0, 0, 0], r * 0.08), 0xffffff));
  });
  A.berry = {
    geo: merge([leafAll, ...berries]),   // leaf + stem + berries: one mesh, one hull
    glossGeo: merge(gloss),
    mat: vcolorGlowToon(M, 0.16, { side: THREE.DoubleSide }),
    glossMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.45, 1.5) }),
  };
  return A.berry;
}

function createBerry(ctx, P, def) {
  const B = berryAssets(ctx, P.A);
  const M = ctx.materials;
  const T = PICKUP_TUNING.berry;
  const base = toVec(def.pos || [0, 0, 0]);
  if (!hasY(def.pos)) base.y = groundAt(ctx, base.x, base.z);
  const root = new THREE.Group();
  root.name = 'berry';
  root.position.copy(base);
  root.rotation.y = def.yaw ?? Math.random() * Math.PI * 2;
  const float = new THREE.Group();
  float.position.y = 0.36;
  root.add(float);
  const body = new THREE.Mesh(B.geo, B.mat);
  const gloss = new THREE.Mesh(B.glossGeo, B.glossMat);
  gloss.userData.noOutline = true;
  body.castShadow = true;
  M.outline(body, 0.013);
  float.add(body, gloss);
  const halo = P.halos.add(root, { offset: [0, 0.45, 0], size: 1.2, color: 0xff4f8a, opacity: 0.45 });

  const SPARK = { color: [0xff7fb0, 0xffc0d8], life: 0.8, size: 0.11, kind: 'glow', intensity: 2.0, drag: 1.2, gravity: -0.6 };
  const sparkVel = new THREE.Vector3();
  const lod = makeLod(root, { details: [gloss], main: [body], hullDist: 25, detailDist: 40, cullDist: 70 });
  let t = Math.random() * 10, sparkAcc = 0, nudgeT = 0, sq = 0, sqV = 0;
  const e = {
    type: 'berry', object3d: root, tags: new Set(['berry', 'pickup']), alive: true,
    radius: 0.35, height: 0.6, team: 'neutral', hittable: false,
    get position() { return root.position; },
    update(dt) {
      t += dt;
      // squash spring (nudge feedback when Morel is at full health)
      sqV += (-120 * sq - 9 * sqV) * dt;
      sq += sqV * dt;
      float.position.y = 0.36 + Math.sin(t * 2.0) * 0.05;
      float.rotation.y += dt * 0.5;
      float.rotation.z = Math.sin(t * 1.3) * 0.06;
      float.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
      const d = ctx.camera.position.distanceTo(root.position);
      lod.update(d);
      halo.opacity = 0.45 * (0.85 + 0.15 * Math.sin(t * 3));
      if ((sparkAcc += dt) > 0.55) {
        sparkAcc = 0;
        if (d < 30) {
          _v.set(root.position.x + (Math.random() - 0.5) * 0.4, root.position.y + 0.45, root.position.z + (Math.random() - 0.5) * 0.4);
          sparkVel.set(0, 0.4, 0);
          ctx.particles.spawn(_v, sparkVel, SPARK);
        }
      }
      if (nudgeT > 0) nudgeT -= dt;
      const pl = ctx.player;
      if (!canCollect(pl)) return;
      _v.set(root.position.x, root.position.y + 0.4, root.position.z);
      if (playerAxisDist2(ctx, _v) > T.radius * T.radius) return;
      if (pl.hp >= pl.maxHp) {
        if (nudgeT <= 0) { nudgeT = 1.2; sqV += 4; }
        return;
      }
      const healed = pl.heal(T.heal);
      ctx.events.emit('pickup:berry', { position: _v.clone(), hp: pl.hp, healed });
      ctx.particles.burst({ position: _v, count: 16, color: [0xb3283f, 0xff5f8a, 0x8a1c6a], speed: 3.5, life: 0.55, size: 0.16, gravity: 6, kind: 'puff' });
      ctx.particles.burst({ position: _v, count: 14, color: [0xff7fb0, 0xffffff], speed: 3, life: 0.6, size: 0.13, kind: 'glow', intensity: 2.2 });
      e.alive = false;
    },
    dispose() { P.halos.remove(halo); },
  };
  return e;
}

// ---------------------------------------------------------------------------------------------
// Tonic jar: corked glass jar of glowing liquid (anvil / updraft / seeker); calls setTonic.
// ---------------------------------------------------------------------------------------------
function tonicAssets(ctx, A) {
  if (A.tonic) return A.tonic;
  const M = ctx.materials;
  const glassProf = [[0, -0.32], [0.2, -0.32], [0.25, -0.295], [0.28, -0.2], [0.29, -0.06], [0.275, 0.07], [0.215, 0.16], [0.14, 0.215], [0.118, 0.255], [0.13, 0.28], [0.142, 0.3], [0.118, 0.315]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const liqProf = [[0, -0.295], [0.19, -0.295], [0.235, -0.27], [0.262, -0.19], [0.27, -0.06], [0.262, 0.045], [0, 0.045]].map(([r, y]) => new THREE.Vector2(r, y));
  const liquid = new THREE.LatheGeometry(liqProf, 18);
  // brighter toward the surface
  const liquidGeo = paintBy(liquid, (x, y, z, nx, ny, nz, c) => {
    const k = ny > 0.9 ? 1.25 : lerp(0.5, 1.0, smoothstep(-0.29, 0.04, y));
    c.setRGB(k, k, k);
  });
  // cork with a twine wrap and a hanging tag
  const cork = paint(new THREE.CylinderGeometry(0.118, 0.1, 0.14, 10), 0xc99a5e);
  cork.translate(0, 0.35, 0);
  const corkTop = paint(place(new THREE.CylinderGeometry(0.122, 0.118, 0.02, 10), [0, 0.425, 0]), 0xb5864d);
  const twine = paint(place(new THREE.TorusGeometry(0.13, 0.014, 5, 16), [0, 0.255, 0], [Math.PI / 2, 0, 0]), 0xd9bc84);
  const string = paint(cylBetween(new THREE.Vector3(0.0, 0.25, 0.13), new THREE.Vector3(0.03, 0.12, 0.29), 0.005), 0xd9bc84);
  for (const g of [cork, corkTop, twine, string]) setUV(g, 0.1, 0.5);
  const glassMat = fogShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color(0xd8f6ff) }, uOpacity: { value: 0.1 } },
    vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, transparent: true, depthWrite: false,
  });
  // tag icon atlas: 4 cells of 64x80 -> [plain (cork/twine use it), anvil, updraft, seeker]
  const ink = '#2a1d14';
  const ICONS = {
    anvil(g) {
      g.beginPath();
      g.moveTo(8, 32); g.lineTo(56, 32); g.lineTo(56, 40); g.quadraticCurveTo(44, 42, 40, 48); g.lineTo(40, 56);
      g.lineTo(48, 62); g.lineTo(48, 68); g.lineTo(16, 68); g.lineTo(16, 62); g.lineTo(24, 56); g.lineTo(24, 46);
      g.quadraticCurveTo(14, 42, 8, 36); g.closePath(); g.fill();
    },
    updraft(g) {
      g.lineWidth = 5;
      for (const [x, s] of [[20, 1], [32, -1], [44, 1]]) {
        g.beginPath(); g.moveTo(x, 70);
        g.bezierCurveTo(x + 8 * s, 60, x - 8 * s, 50, x, 38); g.stroke();
        g.beginPath(); g.moveTo(x - 6, 42); g.lineTo(x, 32); g.lineTo(x + 6, 42); g.stroke();
      }
    },
    seeker(g) {
      g.lineWidth = 4; g.beginPath();
      for (let k = 0; k <= 60; k++) {
        const a = k * 0.32, r = 3 + k * 0.38;
        const x = 32 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      g.beginPath(); g.arc(32, 50, 3.5, 0, 7); g.fill();
    },
  };
  const atlas = M.canvasTexture(256, 80, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 80);
    ['anvil', 'updraft', 'seeker'].forEach((kind, i) => {
      g.save(); g.translate(64 * (i + 1), 0);
      g.fillStyle = '#f1dfb0'; g.fillRect(0, 0, 64, 80);
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 4; g.strokeRect(2, 2, 60, 76);
      g.fillStyle = '#5a4026'; g.beginPath(); g.arc(32, 10, 4, 0, 7); g.fill();
      g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round';
      ICONS[kind](g);
      g.restore();
    });
  });
  const makeTagGeo = (i) => {
    const g = paint(new THREE.PlaneGeometry(0.15, 0.19), 0xffffff);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 4);
    return place(g, [0.035, 0.07, 0.3], [0.12, 0.15, 0.08]);
  };
  const corkGeos = {};
  ['anvil', 'updraft', 'seeker'].forEach((kind, i) => {
    corkGeos[kind] = merge([cork.clone(), corkTop.clone(), twine.clone(), string.clone(), makeTagGeo(i + 1)]);
  });
  for (const g of [cork, corkTop, twine, string]) g.dispose();
  // contents
  const anvil = merge([
    paint(new THREE.BoxGeometry(0.2, 0.05, 0.08), 0x3a4250).translate(0, 0.06, 0),
    paint(new THREE.BoxGeometry(0.07, 0.07, 0.06), 0x3a4250).translate(0, 0.0, 0),
    paint(new THREE.BoxGeometry(0.14, 0.035, 0.09), 0x343b48).translate(0, -0.05, 0),
    paint(place(new THREE.ConeGeometry(0.035, 0.1, 6), [-0.145, 0.065, 0], [0, 0, Math.PI / 2]), 0x3a4250),
  ]);
  const helixPts = [];
  for (let k = 0; k <= 48; k++) {
    const u = k / 48, a = u * Math.PI * 2 * 2.6, r = lerp(0.17, 0.04, u);
    helixPts.push(new THREE.Vector3(Math.cos(a) * r, lerp(-0.24, 0.02, u), Math.sin(a) * r));
  }
  const spiral = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPts), 80, 0.017, 5, false);
  A.tonic = {
    glassGeo: new THREE.LatheGeometry(glassProf, 20),
    liquidGeo, corkGeos, glassMat,
    corkMat: M.toon(0xffffff, { vertexColors: true, map: atlas, side: THREE.DoubleSide }),
    liquidMats: {},
    anvilGeo: anvil,
    anvilMat: M.toon(0xffffff, { vertexColors: true }),
    spiralGeo: spiral,
    bubbleGeo: new THREE.SphereGeometry(1, 8, 6),
  };
  for (const kind of Object.keys(TONIC_STYLE)) {
    const st = TONIC_STYLE[kind];
    A.tonic.liquidMats[kind] = new THREE.MeshBasicMaterial({ color: new THREE.Color(st.liquid).multiplyScalar(st.glow), vertexColors: true, transparent: true, opacity: kind === 'anvil' ? 0.72 : 0.84, depthWrite: false });
  }
  A.tonic.bubbleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeaffd8).multiplyScalar(2.2) });
  A.tonic.spiralMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2f2).multiplyScalar(2.3) });
  return A.tonic;
}

function createTonic(ctx, P, def) {
  const kind = TONIC_STYLE[def.kind] ? def.kind : 'anvil';
  const st = TONIC_STYLE[kind];
  const J = tonicAssets(ctx, P.A);
  const M = ctx.materials;
  const T = PICKUP_TUNING.tonic;
  const base = toVec(def.pos || [0, 0, 0]);
  if (!hasY(def.pos)) base.y = groundAt(ctx, base.x, base.z);
  const root = new THREE.Group();
  root.name = `tonic-${kind}`;
  root.position.copy(base);
  root.rotation.y = def.yaw ?? 0;
  const float = new THREE.Group();
  float.position.y = T.hover;
  root.add(float);
  const jar = new THREE.Group();
  float.add(jar);
  const liquid = new THREE.Mesh(J.liquidGeo, J.liquidMats[kind]);
  liquid.renderOrder = 1;
  const glass = new THREE.Mesh(J.glassGeo, J.glassMat);
  glass.renderOrder = 2;
  const cork = new THREE.Mesh(J.corkGeos[kind], J.corkMat);
  M.outline(cork, 0.01);
  jar.add(liquid, glass, cork);
  // contents
  let content = null, bubbles = null;
  if (kind === 'anvil') {
    content = new THREE.Mesh(J.anvilGeo, J.anvilMat);
    content.position.y = -0.11;
    jar.add(content);
  } else if (kind === 'seeker') {
    content = new THREE.Mesh(J.spiralGeo, J.spiralMat);
    jar.add(content);
  } else {
    bubbles = new THREE.InstancedMesh(J.bubbleGeo, J.bubbleMat, 9);
    bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bubbles.frustumCulled = false;
    jar.add(bubbles);
  }
  const halo = P.halos.add(float, { size: 1.5, color: st.halo, opacity: 0.4 });
  const pool = groundGlow(P.A, st.halo, 0.5, 0.25);
  root.add(pool);

  const MOTE = { color: [st.halo, st.accent], life: 0.9, size: 0.12, kind: 'glow', intensity: 2.2, drag: 0.5 };
  const moteVel = new THREE.Vector3();
  const lod = makeLod(root, { details: [content || bubbles, cork, pool].filter(Boolean), main: [liquid, glass], hullDist: 22, detailDist: 40, cullDist: 70 });
  let t = Math.random() * 10, cooldown = 0, popT = 1, moteAcc = 0;
  const e = {
    type: 'tonic', kind, object3d: root, tags: new Set(['tonic', 'pickup']), alive: true,
    radius: 0.35, height: 1.3, team: 'neutral', hittable: false, respawn: !!def.respawn,
    get position() { return root.position; },
    get available() { return cooldown <= 0; },
    update(dt) {
      t += dt;
      const camD = ctx.camera.position.distanceTo(root.position);
      lod.update(camD);
      if (cooldown > 0) {
        cooldown -= dt;
        const k = 1 - cooldown / T.respawn;
        pool.material.opacity = (0.1 + 0.25 * k) * (0.7 + 0.3 * Math.sin(t * 6));
        if ((moteAcc += dt) > lerp(0.4, 0.1, k)) {
          moteAcc = 0;
          const a = Math.random() * Math.PI * 2;
          _v.set(root.position.x + Math.cos(a) * 0.5, root.position.y + 0.1, root.position.z + Math.sin(a) * 0.5);
          moteVel.set(-Math.cos(a) * 0.3, 1.0 + k, -Math.sin(a) * 0.3);
          ctx.particles.spawn(_v, moteVel, MOTE);
        }
        if (cooldown <= 0) {
          cooldown = 0; popT = 0; float.visible = true; e.tags.add('pickup');
          _v.set(root.position.x, root.position.y + T.hover, root.position.z);
          ctx.particles.burst({ position: _v, count: 18, color: [st.halo, 0xffffff], speed: 3, life: 0.5, size: 0.15, kind: 'glow', intensity: 2.2 });
          ctx.events.emit('tonic:respawn', { kind, position: _v.clone() });
        }
        return;
      }
      if (popT < 1) popT = Math.min(1, popT + dt / 0.45);
      const s = popT < 1 ? Math.max(0.001, easeOutBack(popT, 2.2)) : 1;
      float.scale.setScalar(s);
      float.position.y = T.hover + Math.sin(t * 2.1) * 0.08;
      jar.rotation.y += dt * 1.1;
      jar.rotation.z = Math.sin(t * 1.3) * 0.09;
      jar.rotation.x = Math.sin(t * 1.7 + 1) * 0.05;
      halo.opacity = 0.4 * (0.85 + 0.15 * Math.sin(t * 2.6));
      halo.size = 1.5 * s;
      pool.material.opacity = 0.22 * (0.8 + 0.2 * Math.sin(t * 2.1 + 1.5));
      if (content) {
        if (kind === 'anvil') { content.rotation.y = -t * 1.6; content.position.y = -0.11 + Math.sin(t * 1.9) * 0.025; }
        else content.rotation.y = -t * 3.2;
      }
      if (bubbles) {
        for (let i = 0; i < 9; i++) {
          const u = (t * 0.45 + i / 9) % 1;
          const a = u * Math.PI * 4 + i * 2.1 - t * 2;
          const r = 0.06 + 0.12 * Math.sin(u * Math.PI);
          const sc = (0.018 + (i % 3) * 0.01) * Math.sin(Math.min(1, u * 1.15) * Math.PI);
          _v.set(Math.cos(a) * r, lerp(-0.27, 0.035, u), Math.sin(a) * r);
          _m.compose(_v, _q.identity(), _s.setScalar(Math.max(0.0001, sc)));
          bubbles.setMatrixAt(i, _m);
        }
        bubbles.instanceMatrix.needsUpdate = true;
      }
      const pl = ctx.player;
      if (popT < 0.6 || !canCollect(pl)) return;
      _v.set(root.position.x, root.position.y + float.position.y, root.position.z);
      if (playerAxisDist2(ctx, _v) > T.radius * T.radius) return;
      pl.setTonic(kind, T.duration);
      ctx.events.emit('pickup:tonic', { kind, position: _v.clone(), duration: T.duration });
      ctx.particles.burst({ position: _v, count: 26, color: [st.halo, st.accent, 0xffffff], speed: 4.5, life: 0.6, size: 0.17, kind: 'glow', intensity: 2.3 });
      ctx.particles.burst({ position: _v2.set(_v.x, _v.y + 0.35, _v.z), count: 6, color: [0xc99a5e, 0xe8c48a], speed: 2.5, spread: 0.4, life: 0.5, size: 0.1, gravity: 9, kind: 'puff' });
      if (e.respawn) {
        cooldown = T.respawn;
        float.visible = false; e.tags.delete('pickup');
      } else e.alive = false;
    },
    dispose() {
      P.halos.remove(halo); pool.material.dispose();
      if (bubbles) bubbles.dispose();
    },
  };
  return e;
}

// ---------------------------------------------------------------------------------------------
// Cage: lashed wooden cage (on a post or hanging) holding a glowworm. 2 hits break it.
// ---------------------------------------------------------------------------------------------
const CAGE = { W: 0.46, H: 1.0, ROOF: 0.34, POST: 0.45, DECK: 0.09 };

function cageAssets(ctx, A) {
  if (A.cage) return A.cage;
  const M = ctx.materials;
  const R = rand(31);
  const { W, H, ROOF } = CAGE;
  const bark = new THREE.Color(0x6e4a2c), rope = new THREE.Color(0xd4b273), iron = new THREE.Color(0x56606c), plank = new THREE.Color(0x8d6842);
  const tint = (c, k) => c.clone().multiplyScalar(k);
  const geos = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const stick = (a, b, r, col = bark) => geos.push(paint(cylBetween(a, b, r, r * 0.85, 6), tint(col, 0.8 + R() * 0.35)));
  const corners = [[-W, -W], [W, -W], [W, W], [-W, W]];
  for (const [x, z] of corners) stick(V(x, -0.02, z), V(x * 1.03, H + 0.07, z * 1.03), 0.046);
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
    const ex = (x1 - x0) * 0.08, ez = (z1 - z0) * 0.08;
    for (const y of [0.06, H - 0.03]) stick(V(x0 - ex, y + (R() - 0.5) * 0.03, z0 - ez), V(x1 + ex, y + (R() - 0.5) * 0.03, z1 + ez), 0.034);
    for (const k of [0.25, 0.5, 0.75]) {
      const x = lerp(x0, x1, k), z = lerp(z0, z1, k);
      stick(V(x + (R() - 0.5) * 0.04, 0.04, z), V(x + (R() - 0.5) * 0.05, H - 0.01, z), 0.022);
    }
  }
  const apex = V(0, H + ROOF, 0);
  for (const [x, z] of corners) stick(V(x * 1.06, H + 0.02, z * 1.06), apex, 0.033);
  // rope lashings at the joints, a knot and hanging loop at the apex
  for (const [x, z] of corners) {
    for (const y of [0.06, H - 0.03]) geos.push(paint(place(new THREE.TorusGeometry(0.058, 0.017, 5, 10), [x, y, z], [Math.PI / 2 + (R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5]), tint(rope, 0.9 + R() * 0.2)));
    geos.push(paint(place(new THREE.TorusGeometry(0.05, 0.014, 5, 10), [x * 0.94, H + 0.06, z * 0.94], [Math.PI / 2 + 0.6, 0, 0.3]), rope));
  }
  geos.push(paint(place(new THREE.SphereGeometry(0.065, 8, 6), [0, H + ROOF, 0]), rope));
  geos.push(paint(place(new THREE.TorusGeometry(0.065, 0.016, 5, 12), [0, H + ROOF + 0.08, 0]), rope));
  // bandit padlock on the front
  geos.push(paint(place(new THREE.TorusGeometry(0.038, 0.011, 5, 10, Math.PI), [0, H - 0.1, W + 0.045]), tint(iron, 1.2)));
  geos.push(paint(place(new THREE.BoxGeometry(0.13, 0.11, 0.05), [0, H - 0.16, W + 0.05], [0, 0, 0.06]), iron));
  geos.push(paint(place(new THREE.BoxGeometry(0.02, 0.04, 0.01), [0.002, H - 0.17, W + 0.077]), 0x1a1a20));
  // floor planks
  for (const z of [-0.3, 0, 0.3]) geos.push(paint(place(new THREE.BoxGeometry(0.98, 0.05, 0.29), [0, 0.0, z], [0, (R() - 0.5) * 0.04, 0]), tint(plank, 0.85 + R() * 0.3)));
  const cageGeo = merge(geos);

  // base: post with root flares and a plank deck
  const base = [];
  const P0 = CAGE.POST;
  base.push(paint(cylBetween(V(0, -0.05, 0), V(0, P0, 0), 0.25, 0.2, 8), tint(bark, 0.9)));
  for (let k = 0; k < 4; k++) {
    const a = k * 1.6 + 0.3;
    base.push(paint(cylBetween(V(Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15), V(Math.cos(a) * 0.42, -0.03, Math.sin(a) * 0.42), 0.09, 0.03, 5), tint(bark, 0.8)));
  }
  for (const z of [-0.36, 0, 0.36]) base.push(paint(place(new THREE.BoxGeometry(1.12, CAGE.DECK, 0.34), [0, P0 + CAGE.DECK / 2, z], [0, (R() - 0.5) * 0.05, 0]), tint(plank, 0.75 + R() * 0.3)));
  const baseGeo = merge(base);
  // post cages draw post + deck + cage as ONE mesh; on break the mesh swaps to the post-only geometry
  const postCageGeo = merge([baseGeo.clone(), cageGeo.clone().translate(0, CAGE.POST + CAGE.DECK, 0)]);
  M.computeOutlineNormals(baseGeo);

  // glowworm: body segments merged (CPU-deformed per cage), head, two face variants
  const SEGS = [[0.15, 0.22, 0.02, 0], [0.14, 0.14, -0.13, 0], [0.12, 0.12, -0.26, 0], [0.095, 0.1, -0.36, 1]];
  const segGeos = [];
  const segIdx = [];
  const bodyCol = new THREE.Color(0x9fdc3c), bellyCol = new THREE.Color(0xe8f59a), tailCol = new THREE.Color(0xe8ff6a).multiplyScalar(2.4);
  SEGS.forEach(([r, y, z, tail], i) => {
    const g = paintBy(place(new THREE.SphereGeometry(1, 14, 10), [0, y, z], [0, 0, 0], [r, r * 0.9, r]), (x, yy, zz, nx, ny, nz, c) => {
      if (tail) c.copy(tailCol);
      else c.copy(bodyCol).lerp(bellyCol, clamp(-ny, 0, 1) * 0.6).multiplyScalar(1 - 0.12 * clamp(Math.abs(zz - z) / r, 0, 1));
    });
    segGeos.push(g);
    for (let k = 0; k < g.attributes.position.count; k++) segIdx.push(i);
  });
  const ink = new THREE.Color(0x1a1426), white = new THREE.Color(0xffffff), cheek = new THREE.Color(0xff8aa8), mouth = new THREE.Color(0x2a1020);
  const antenna = () => {
    const out = [];
    for (const s of [-1, 1]) {
      const pts = [V(s * 0.04, 0.12, 0.02), V(s * 0.08, 0.22, 0.05), V(s * 0.13, 0.3, 0.1), V(s * 0.17, 0.33, 0.14)];
      out.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.011, 5), new THREE.Color(0.32, 0.36, 0.14)));
      out.push(paint(place(new THREE.SphereGeometry(0.036, 10, 8), [s * 0.17, 0.335, 0.14]), new THREE.Color(2.4, 2.3, 0.9)));
      out.push(paint(place(new THREE.SphereGeometry(0.028, 8, 6), [s * 0.108, -0.03, 0.108], [0, 0, 0], [1, 0.6, 0.5]), cheek));
    }
    return out;
  };
  const worriedFace = antenna();
  for (const s of [-1, 1]) {
    worriedFace.push(paint(place(new THREE.SphereGeometry(0.056, 12, 8), [s * 0.066, 0.035, 0.118]), white));
    worriedFace.push(paint(place(new THREE.SphereGeometry(0.034, 10, 8), [s * 0.062, 0.042, 0.162]), ink));
    worriedFace.push(paint(place(new THREE.SphereGeometry(0.012, 6, 4), [s * 0.05, 0.058, 0.19]), white));
    worriedFace.push(paint(cylBetween(V(s * 0.115, 0.098, 0.128), V(s * 0.035, 0.122, 0.152), 0.009, 0.009, 4), ink)); // worried brows
  }
  worriedFace.push(paint(place(new THREE.TorusGeometry(0.02, 0.008, 6, 12), [0, -0.06, 0.148]), mouth));
  const happyFace = antenna();
  for (const s of [-1, 1]) happyFace.push(paint(place(new THREE.TorusGeometry(0.034, 0.01, 5, 10, Math.PI), [s * 0.066, 0.03, 0.15]), ink)); // closed happy eyes
  happyFace.push(paint(place(new THREE.TorusGeometry(0.042, 0.01, 6, 12, Math.PI), [0, -0.03, 0.148], [0, 0, Math.PI]), mouth));
  A.cage = {
    cageGeo, baseGeo, postCageGeo,
    woodMat: M.toon(0xffffff, { vertexColors: true }),
    ropeGeo: paint(new THREE.CylinderGeometry(0.018, 0.018, 1, 5).translate(0, 0.5, 0), rope),
    bodyGeo: merge(segGeos),
    segIdx: new Uint8Array(segIdx),
    headGeo: paint(new THREE.SphereGeometry(0.165, 16, 12), 0xcfe07a),
    worriedGeo: merge(worriedFace),
    happyGeo: merge(happyFace),
    wormMat: vcolorGlowToon(M, 0.32),
    faceMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  return A.cage;
}

function nextGlowwormLine(P) {
  if (!P.lines.length) {
    P.lines = GLOWWORM_LINES.slice();
    for (let i = P.lines.length - 1; i > 0; i--) { const j = (P.rng() * (i + 1)) | 0; [P.lines[i], P.lines[j]] = [P.lines[j], P.lines[i]]; }
  }
  return P.lines.pop();
}

function createCage(ctx, P, def) {
  const C = cageAssets(ctx, P.A);
  const M = ctx.materials;
  const T = PICKUP_TUNING.cage;
  const hanging = !!def.hanging;
  const base = toVec(def.pos || [0, 0, 0]);
  if (!hasY(def.pos)) base.y = groundAt(ctx, base.x, base.z);
  const yaw = def.yaw ?? 0;
  const root = new THREE.Group();
  root.name = hanging ? 'cage-hanging' : 'cage';
  root.position.copy(base);
  root.rotation.y = yaw;
  const cageTop = CAGE.H + CAGE.ROOF + 0.1;
  const ropeLen = def.rope ?? 2.2;
  let pivot = null, swing = null, rope = null, cageMesh;
  const cageGroup = new THREE.Group();   // cage interior frame (the worm lives here)
  if (hanging) {
    pivot = new THREE.Group();            // swings about the rope's top
    pivot.position.y = cageTop + ropeLen;
    root.add(pivot);
    rope = new THREE.Mesh(C.ropeGeo, C.woodMat);
    rope.scale.set(1, ropeLen + 0.05, 1);
    rope.position.y = -ropeLen - 0.03;
    pivot.add(rope, cageGroup);
    cageGroup.position.y = -pivot.position.y;
    cageMesh = new THREE.Mesh(C.cageGeo, C.woodMat);
    cageGroup.add(cageMesh);
  } else {
    swing = new THREE.Group();            // rocks about the post's foot when hit
    root.add(swing);
    cageMesh = new THREE.Mesh(C.postCageGeo, C.woodMat);
    cageMesh.receiveShadow = true;
    swing.add(cageMesh, cageGroup);
    cageGroup.position.y = CAGE.POST + CAGE.DECK;
  }
  cageMesh.castShadow = true;
  M.outline(cageMesh, 0.017);

  // glowworm (faces the cage front, +Z local)
  const worm = new THREE.Group();
  worm.position.set(0, 0.03, -0.02);
  cageGroup.add(worm);
  const bodyGeo = C.bodyGeo.clone();               // per cage: vertices are wiggled on the CPU
  const bodyPos = bodyGeo.attributes.position;
  const basePos = Float32Array.from(bodyPos.array);
  const body = new THREE.Mesh(bodyGeo, C.wormMat); // glowing body: no outline hull (saves a draw call)
  worm.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.4, 0.1);
  worm.add(head);
  const headMesh = new THREE.Mesh(C.headGeo, C.wormMat);
  M.outline(headMesh, 0.012);
  const face = new THREE.Mesh(C.worriedGeo, C.faceMat);
  face.userData.noOutline = true;
  head.add(headMesh, face);
  const halo = P.halos.add(worm, { offset: [0, 0.25, 0], size: 1.5, color: 0xd8ff8a, opacity: 0.38 });
  const segOX = new Float32Array(4), segOY = new Float32Array(4);
  function wiggle(time, amp, speed) {
    for (let i = 0; i < 4; i++) {
      segOX[i] = Math.sin(time * speed - i * 0.9) * amp;
      segOY[i] = Math.max(0, Math.sin(time * speed * 0.5 - i * 1.1)) * 0.015;
    }
    const arr = bodyPos.array, idx = C.segIdx;
    for (let k = 0, n = idx.length; k < n; k++) {
      const sgi = idx[k];
      arr[k * 3] = basePos[k * 3] + segOX[sgi];
      arr[k * 3 + 1] = basePos[k * 3 + 1] + segOY[sgi];
    }
    bodyPos.needsUpdate = true;
  }

  // collider: cage on a post blocks Morel; projectiles hit the entity capsule first (radius 0.62 > 0.45)
  const hTotal = hanging ? cageTop : CAGE.POST + CAGE.DECK + cageTop;
  let collider = ctx.physics.addBox({ min: [base.x - 0.45, base.y, base.z - 0.45], max: [base.x + 0.45, base.y + hTotal - 0.1, base.z + 0.45], surface: 'wood', tag: 'cage' });

  const key = `${base.x.toFixed(2)},${base.y.toFixed(2)},${base.z.toFixed(2)}`;
  if (ctx.score && ctx.score.registerItem) ctx.score.registerItem('cage', key);
  P.cagesTotal.add(key);

  const TRAIL = { color: [0xd8ff8a, 0xfff6b0], life: 0.7, size: 0.16, kind: 'glow', intensity: 2.2, drag: 1 };
  const lod = makeLod(root, { details: [face], main: [cageMesh, rope, body, headMesh].filter(Boolean), hullDist: 30, detailDist: 50, cullDist: 80 });
  let t = Math.random() * 10, hopT = 1 + Math.random() * 2, hopY = 0, hopV = 0, wobX = 0, wobZ = 0, wobVX = 0, wobVZ = 0;
  let freedT = -1, startle = 0, faceYaw = 0;
  const flyFrom = new THREE.Vector3();
  const e = {
    type: 'cage', object3d: root, tags: new Set(['cage', 'target', 'breakable']), alive: true,
    radius: T.radius, height: hTotal, team: 'neutral', hittable: true, hanging,
    hits: 0, freed: false,
    get position() { return root.position; },
    hurt(amount, info) {
      if (e.freed) return false;
      e.hits++;
      // wobble away from the hit (local space)
      const d = info && info.dir ? info.dir : DEFAULT_DIR;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = d.x * c - d.z * s, lz = d.x * s + d.z * c;
      const k = 3.5 + (info && info.heavy ? 3 : 0);
      wobVX += lz * k; wobVZ -= lx * k;
      startle = 1;
      cageCenter(_v);
      ctx.particles.burst({ position: _v, count: 12, color: [0x8d6842, 0xc8a070, 0x6e4a2c], speed: 4, life: 0.5, size: 0.1, gravity: 12, kind: 'puff' });
      if (e.hits >= T.hits) breakCage(d);
      else {
        // a bar snaps off on the side that was hit
        for (let i = 0; i < 2; i++) {
          _v2.set(_v.x - d.x * 0.45 + (Math.random() - 0.5) * 0.3, _v.y + (Math.random() - 0.2) * 0.4, _v.z - d.z * 0.45 + (Math.random() - 0.5) * 0.3);
          _v3.set(d.x * 2.5 + (Math.random() - 0.5) * 2, 3 + Math.random() * 2, d.z * 2.5 + (Math.random() - 0.5) * 2);
          P.debris.spawn(_v2, _v3, [0.045, 0.045, 0.5 + Math.random() * 0.4], 0x6e4a2c, 2.4);
        }
        ctx.events.emit('cage:hit', { entity: e, position: _v.clone(), hits: e.hits, hitsLeft: T.hits - e.hits });
      }
      return true;
    },
    update(dt) {
      t += dt;
      if (e.freed) { updateFreed(dt); return; }
      // cage wobble spring
      wobVX += (-70 * wobX - 6 * wobVX) * dt;
      wobVZ += (-70 * wobZ - 6 * wobVZ) * dt;
      wobX += wobVX * dt; wobZ += wobVZ * dt;
      if (pivot) {
        pivot.rotation.x = wobX * 1.6 + Math.sin(t * 1.1) * 0.03;
        pivot.rotation.z = wobZ * 1.6 + Math.sin(t * 0.9 + 1) * 0.025;
      } else swing.rotation.set(wobX * 0.22, 0, wobZ * 0.22);
      // anxious glowworm: fast nervous bob, wiggle, hops, looks for (and at) Morel
      const pl = ctx.player;
      const pd = Math.hypot(pl.position.x - root.position.x, pl.position.z - root.position.z);
      const near = pd < 10;
      startle = Math.max(0, startle - dt * 1.5);
      hopT -= dt * (near ? 2.2 : 1);
      if (hopT <= 0 && hopY <= 0) { hopV = near ? 2.2 : 1.6; hopT = 1.2 + Math.random() * 2.2; }
      if (startle > 0.9 && hopY <= 0) hopV = 2.6;
      hopV -= 14 * dt;
      hopY = Math.max(0, hopY + hopV * dt);
      if (hopY <= 0 && hopV < 0) hopV = 0;
      worm.position.y = 0.03 + hopY;
      const camD = ctx.camera.position.distanceTo(root.position);
      lod.update(camD);
      if (camD < 45) wiggle(t, 0.025 * (1 + startle), near ? 9 : 6);
      head.position.y = 0.4 + Math.sin(t * 10) * 0.012 + startle * 0.04;
      let targetYaw;
      if (near) {
        _v.set(pl.position.x - root.position.x, 0, pl.position.z - root.position.z);
        const c = Math.cos(-yaw), s = Math.sin(-yaw);
        targetYaw = Math.atan2(_v.x * c + _v.z * s, -_v.x * s + _v.z * c);
        targetYaw = clamp(targetYaw, -1.2, 1.2);
      } else targetYaw = Math.sin(t * 0.7) * 0.7 + Math.sin(t * 2.3) * 0.15;
      faceYaw = dampAngle(faceYaw, targetYaw, near ? 6 : 3, dt);
      worm.rotation.y = faceYaw * 0.4;
      head.rotation.y = faceYaw * 0.6;
      head.rotation.z = Math.sin(t * 3.1) * 0.12;
      head.rotation.x = Math.sin(t * 7) * 0.05 * (near ? 2 : 1) - startle * 0.2;
      halo.opacity = 0.38 * (0.85 + 0.15 * Math.sin(t * 4));
    },
    dispose() {
      if (collider) ctx.physics.removeCollider(collider);
      collider = null;
      P.halos.remove(halo);
      bodyGeo.dispose();
    },
  };

  function cageCenter(out) {
    return out.set(root.position.x, root.position.y + (hanging ? 0.5 : CAGE.POST + CAGE.DECK + 0.5), root.position.z);
  }

  function breakCage(dir) {
    e.freed = true;
    e.hittable = false;
    e.tags.delete('target'); e.tags.delete('breakable');
    e.tags.add('freed');
    if (hanging) { lod.drop(cageMesh); cageMesh.visible = false; }
    else {
      cageMesh.geometry = C.baseGeo;     // keep the post and deck
      if (cageMesh.userData.outline) cageMesh.userData.outline.geometry = C.baseGeo;
      swing.rotation.set(0, 0, 0);
    }
    if (pivot) pivot.rotation.set(0, 0, 0);
    if (collider) {
      if (hanging) { ctx.physics.removeCollider(collider); collider = null; }
      else { collider.max.y = base.y + CAGE.POST + CAGE.DECK; ctx.physics.updateCollider(collider); }
    }
    cageCenter(_v);
    // planks and bars fly apart
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const lx = Math.cos(a) * 0.45, lz = Math.sin(a) * 0.45;
      _v2.set(_v.x + lx * c + lz * s, _v.y + (Math.random() - 0.4) * 0.9, _v.z - lx * s + lz * c);
      _v3.set((_v2.x - _v.x) * 6 + dir.x * 2.5, 3.5 + Math.random() * 4, (_v2.z - _v.z) * 6 + dir.z * 2.5);
      const plankPiece = i % 6 === 0;
      const size = plankPiece ? [0.28, 0.05, 0.55 + Math.random() * 0.3] : [0.045, 0.045, 0.45 + Math.random() * 0.6];
      P.debris.spawn(_v2, _v3, size, plankPiece ? 0x8d6842 : i % 5 === 0 ? 0xd4b273 : 0x6e4a2c, 2.8);
    }
    ctx.particles.burst({ position: _v, count: 22, color: [0x8d6842, 0xc8a070, 0x6e4a2c], speed: 6, life: 0.7, size: 0.16, gravity: 10, kind: 'puff' });
    ctx.particles.burst({ position: _v, count: 26, color: [0xd8ff8a, 0xfff6b0, 0xffffff], speed: 5, life: 0.8, size: 0.16, kind: 'glow', intensity: 2.4 });
    // glowworm cheers, then spirals up
    freedT = 0;
    face.geometry = C.happyGeo;
    flyFrom.copy(worm.position);
    const score = ctx.score;
    P.cagesFreed++;
    const freed = score && !score.isStub && typeof score.cagesFreed === 'number' ? score.cagesFreed + 1 : P.cagesFreed;
    const total = score && !score.isStub && typeof score.cagesTotal === 'number' ? score.cagesTotal : P.cagesTotal.size;
    ctx.events.emit('cage:freed', { position: _v.clone(), points: T.points, freed, total, entity: e });
    ctx.events.emit('ui:message', { text: nextGlowwormLine(P), duration: 3, speaker: 'glowworm' });
  }

  function updateFreed(dt) {
    if (freedT < 0) return;
    freedT += dt;
    const pl = ctx.player;
    if (freedT < 0.7) {
      // happy hops facing Morel
      const k = freedT / 0.7;
      worm.position.y = flyFrom.y + Math.abs(Math.sin(k * Math.PI * 2)) * 0.3;
      _v.set(pl.position.x - root.position.x, 0, pl.position.z - root.position.z);
      const c = Math.cos(-yaw), s = Math.sin(-yaw);
      worm.rotation.y = dampAngle(worm.rotation.y, Math.atan2(_v.x * c + _v.z * s, -_v.x * s + _v.z * c), 10, dt);
      head.rotation.z = Math.sin(freedT * 18) * 0.25;
      return;
    }
    const k = Math.min(1, (freedT - 0.7) / 3.2);
    if (k >= 1) {
      if (worm.visible) {
        worm.visible = false;
        worm.getWorldPosition(_v);
        ctx.particles.burst({ position: _v, count: 20, color: [0xd8ff8a, 0xffffff], speed: 3, life: 0.7, size: 0.14, kind: 'glow', intensity: 2.5 });
      }
      freedT = -1;
      return;
    }
    const a = k * Math.PI * 2 * 2.3;
    const r = 0.2 + k * 1.1;
    worm.position.set(flyFrom.x + Math.cos(a) * r, flyFrom.y + easeOutCubic(k) * 0.4 + k * k * 7.5, flyFrom.z + Math.sin(a) * r);
    worm.rotation.y = -a;
    worm.rotation.z = 0.5;
    const sc = k > 0.8 ? 1 - (k - 0.8) / 0.2 * 0.85 : 1;
    worm.scale.setScalar(sc);
    wiggle(freedT, 0.04, 12);
    halo.opacity = 0.5;
    worm.getWorldPosition(_v);
    ctx.particles.spawn(_v, _zero, TRAIL);
  }

  return e;
}

// ---------------------------------------------------------------------------------------------
// Checkpoint: a carved lantern post. Lights up when Morel passes within 2.5 m.
// ---------------------------------------------------------------------------------------------
function checkpointAssets(ctx, A) {
  if (A.checkpoint) return A.checkpoint;
  const M = ctx.materials;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const wood = new THREE.Color(0x6b4a2e), woodDark = new THREE.Color(0x3f2a1a), woodLight = new THREE.Color(0x8a6440);
  // carved post: octagonal lathe with bands and a knob
  const prof = [[0.2, 0], [0.165, 0.12], [0.125, 0.22], [0.12, 0.58], [0.15, 0.62], [0.15, 0.7], [0.118, 0.74], [0.113, 1.38], [0.145, 1.42], [0.145, 1.5],
    [0.11, 1.54], [0.105, 2.08], [0.14, 2.14], [0.135, 2.24], [0.07, 2.32], [0.0, 2.34]].map(([r, y]) => new THREE.Vector2(r, y));
  const post = paintBy(new THREE.LatheGeometry(prof, 8), (x, y, z, nx, ny, nz, c) => {
    const r = Math.hypot(x, z);
    c.copy(wood).lerp(r > 0.135 ? woodLight : woodDark, r > 0.135 ? 0.5 : clamp((0.125 - r) * 30, 0, 0.6));
    if (y < 0.25) c.lerp(_c.set(0x4e6a34), smoothstep(0.25, 0.0, y) * 0.6); // mossy foot
  });
  // fiddlehead crook arm
  const armPts = [V(0, 2.12, 0), V(0.02, 2.42, 0), V(0.16, 2.62, 0), V(0.42, 2.66, 0), V(0.6, 2.56, 0), V(0.64, 2.42, 0), V(0.56, 2.34, 0), V(0.48, 2.39, 0), V(0.5, 2.46, 0)];
  const arm = paint(taperedTube(armPts, 0.05, (u) => lerp(1.2, 0.45, u), 40, 6), wood);
  // rocks + moss at the foot
  const rocks = [];
  const R = rand(9);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + 0.4, d = 0.32 + R() * 0.1, s = 0.1 + R() * 0.08;
    rocks.push(paint(place(new THREE.IcosahedronGeometry(1, 0), [Math.cos(a) * d, s * 0.35, Math.sin(a) * d], [R() * 3, R() * 3, R() * 3], [s * 1.3, s * 0.8, s]), _c.set(0x7a7f78).multiplyScalar(0.85 + R() * 0.3)));
  }
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9 + 2.2, d = 0.22 + R() * 0.15;
    rocks.push(paint(place(new THREE.ConeGeometry(0.035, 0.16 + R() * 0.1, 4), [Math.cos(a) * d, 0.07, Math.sin(a) * d], [(R() - 0.5) * 0.6, 0, (R() - 0.5) * 0.6]), 0x6f9a45));
  }
  const postGeo = merge([post, arm, ...rocks]);

  // lantern (hangs from the arm; origin = hook point)
  const iron = new THREE.Color(0x2f2a28), brass = new THREE.Color(0xb48a3a);
  const fr = [];
  fr.push(paint(cylBetween(V(0, 0, 0), V(0, -0.2, 0), 0.012, 0.012, 4), iron));
  fr.push(paint(place(new THREE.TorusGeometry(0.03, 0.009, 4, 8), [0, -0.21, 0]), iron));
  fr.push(paint(place(new THREE.ConeGeometry(0.19, 0.15, 6), [0, -0.31, 0]), iron));
  fr.push(paint(place(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 6), [0, -0.385, 0]), iron));
  fr.push(paint(place(new THREE.CylinderGeometry(0.15, 0.12, 0.05, 6), [0, -0.665, 0]), iron));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    fr.push(paint(cylBetween(V(Math.cos(a) * 0.138, -0.4, Math.sin(a) * 0.138), V(Math.cos(a) * 0.138, -0.64, Math.sin(a) * 0.138), 0.013, 0.013, 4), iron));
  }
  fr.push(paint(place(new THREE.SphereGeometry(0.025, 6, 4), [0, -0.385 - 0.05, 0]), brass)); // wick holder
  // little brass bell under the lantern (rings on the bell-ready checkpoint:reached event)
  fr.push(paint(place(new THREE.TorusGeometry(0.02, 0.006, 4, 8), [0, -0.705, 0], [0, Math.PI / 2, 0]), iron));
  fr.push(paint(place(new THREE.LatheGeometry([[0, 0.07], [0.03, 0.068], [0.05, 0.04], [0.058, 0.0], [0.075, -0.045], [0.07, -0.05], [0, -0.03]].map(([r, y]) => new THREE.Vector2(r, y)), 12), [0, -0.79, 0]), brass));
  fr.push(paint(place(new THREE.SphereGeometry(0.018, 6, 4), [0, -0.845, 0]), brass));
  const frameGeo = merge(fr);
  const glassGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.25, 6, 1, true).translate(0, -0.525, 0);
  // flame: white-hot base, amber body, orange tip (HDR vertex colours on an unlit material)
  const hot = new THREE.Color(0xfff2c8).multiplyScalar(3.2), body = new THREE.Color(0xffb040).multiplyScalar(3.0), tip = new THREE.Color(0xff6a20).multiplyScalar(2.6);
  const flameGeo = paintBy(new THREE.LatheGeometry([[0, -0.07], [0.04, -0.05], [0.048, -0.01], [0.03, 0.04], [0, 0.1]].map(([r, y]) => new THREE.Vector2(r, y)), 10), (x, y, z, nx, ny, nz, c) => {
    if (y < -0.02) c.copy(hot).lerp(body, smoothstep(-0.07, -0.02, y));
    else c.copy(body).lerp(tip, smoothstep(0.0, 0.1, y));
  });
  // carved rune plate (a crescent cradling a flame)
  const runeTex = M.canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(32, 34, 24, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(32, 26, 20, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.beginPath(); g.moveTo(32, 8); g.quadraticCurveTo(42, 22, 32, 32); g.quadraticCurveTo(22, 22, 32, 8); g.fill();
  }, { srgb: false });
  A.checkpoint = {
    postGeo, frameGeo, glassGeo, flameGeo, runeTex,
    runeGeo: new THREE.CircleGeometry(0.09, 20),
    woodMat: M.toon(0xffffff, { vertexColors: true }),
    flameMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  return A.checkpoint;
}

function createCheckpoint(ctx, P, def) {
  const K = checkpointAssets(ctx, P.A);
  const M = ctx.materials;
  const T = PICKUP_TUNING.checkpoint;
  const id = def.id ?? `cp${P.cpCounter++}`;
  const yaw = def.yaw ?? 0;
  const spot = toVec(def.pos || [0, 0, 0]);
  if (!hasY(def.pos)) spot.y = groundAt(ctx, spot.x, spot.z);
  // the post stands beside the respawn spot (Morel's right, then left), unless side = 0
  let side = def.side ?? T.side;
  const postPos = spot.clone();
  if (Math.abs(side) > 0.01) {
    let ok = false;
    for (const sgn of [1, -1]) {
      const x = spot.x - Math.cos(yaw) * side * sgn, z = spot.z + Math.sin(yaw) * side * sgn;
      const gy = groundAt(ctx, x, z, spot.y + 0.5);
      if (Math.abs(gy - spot.y) < 0.7) { postPos.set(x, gy, z); ok = true; side *= sgn; break; }
    }
    if (!ok) side = 0;
  }
  const root = new THREE.Group();
  root.name = `checkpoint-${id}`;
  root.position.copy(postPos);
  // arm (+X local) points toward the respawn spot, or forward when the post stands on it
  if (side !== 0) root.rotation.y = Math.atan2(-(spot.z - postPos.z), spot.x - postPos.x);
  else root.rotation.y = yaw - Math.PI / 2;
  const post = new THREE.Mesh(K.postGeo, K.woodMat);
  post.castShadow = true; post.receiveShadow = true;
  M.outline(post, 0.018);
  root.add(post);
  // rune plate on the side facing the approaching player (-Z local when the post is beside the path)
  const runeMat = new THREE.MeshBasicMaterial({ map: K.runeTex, color: 0x3a2a1c, transparent: true, alphaTest: 0.3 });
  const rune = new THREE.Mesh(K.runeGeo, runeMat);
  if (side > 0) { rune.position.set(0, 1.08, -0.122); rune.rotation.y = Math.PI; }
  else if (side < 0) rune.position.set(0, 1.08, 0.122);
  else { rune.position.set(-0.122, 1.08, 0); rune.rotation.y = -Math.PI / 2; }
  root.add(rune);
  // lantern
  const lantern = new THREE.Group();
  lantern.position.set(0.44, 2.6, 0);
  root.add(lantern);
  const frame = new THREE.Mesh(K.frameGeo, K.woodMat);
  M.outline(frame, 0.012);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x232a3a, transparent: true, opacity: 0.92 });
  const glass = new THREE.Mesh(K.glassGeo, glassMat);
  const flame = new THREE.Mesh(K.flameGeo, K.flameMat);
  flame.position.y = -0.5;
  flame.scale.setScalar(0.22); // unlit: a tiny glowing wick ember
  lantern.add(frame, glass, flame);
  const halo = P.halos.add(lantern, { offset: [0, -0.52, 0], size: 1.9, color: 0xffb04a, opacity: 0 });
  const pool = groundGlow(P.A, 0xffa040, 2.4, 0);
  pool.position.x = 0.3;
  pool.visible = false;
  root.add(pool);

  let collider = null;
  if (side !== 0) collider = ctx.physics.addBox({ min: [postPos.x - 0.16, postPos.y, postPos.z - 0.16], max: [postPos.x + 0.16, postPos.y + 2.3, postPos.z + 0.16], surface: 'wood', tag: 'checkpoint' });

  const unlitGlass = new THREE.Color(0x232a3a), litGlass = new THREE.Color(0xffb85a).multiplyScalar(1.7);
  const unlitRune = new THREE.Color(0x3a2a1c), litRune = new THREE.Color(0xffc35a).multiplyScalar(2.2);
  const SPARK = { color: [0xffc35a, 0xff9a40, 0xfff0c0], life: 0.7, size: 0.08, kind: 'spark', gravity: -1.5, drag: 1.2, intensity: 2.2 };
  const RING = { color: [0xffc35a, 0xffe0a0], life: 0.55, size: 0.22, kind: 'glow', intensity: 1.8, drag: 4 };
  const sparkVel = new THREE.Vector3();
  const lod = makeLod(root, { details: [rune, flame], main: [post, frame, glass], hullDist: 35, detailDist: 50, cullDist: 66 });
  let t = Math.random() * 10, litT = -1, swing = 0, swingV = 0, sparkAcc = 0;
  const e = {
    type: 'checkpoint', object3d: root, tags: new Set(['checkpoint']), alive: true,
    radius: 0.3, height: 2.4, team: 'neutral', hittable: false,
    checkpointId: id, yaw, lit: false, side,
    /** respawn point (on the path), not the post */
    get position() { return spot; },
    get postPosition() { return root.position; },
    light(silent = false) {
      if (e.lit) return;
      e.lit = true;
      litT = 0;
      pool.visible = true;
      swingV += 3.2;
      ctx.player.setCheckpoint(id, spot, yaw);
      lantern.getWorldPosition(_v);
      _v.y -= 0.5;
      ctx.particles.burst({ position: _v, count: 30, color: [0xffc35a, 0xff9a40, 0xffffff], speed: 4.5, life: 0.7, size: 0.13, kind: 'glow', intensity: 2.5 });
      ctx.particles.burst({ position: _v, count: 16, color: [0xffe0a0, 0xffffff], speed: 6, life: 0.5, size: 0.07, kind: 'spark', gravity: 6 });
      // a ring of warm light rolling out over the ground
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        _v2.set(spot.x + Math.cos(a) * 0.4, spot.y + 0.15, spot.z + Math.sin(a) * 0.4);
        sparkVel.set(Math.cos(a) * 5, 0.4, Math.sin(a) * 5);
        ctx.particles.spawn(_v2, sparkVel, RING);
      }
      if (!silent) ctx.events.emit('checkpoint:reached', { id, position: spot.clone(), yaw });
    },
    update(dt) {
      t += dt;
      // lantern swing
      swingV += (-30 * swing - 2.2 * swingV) * dt; swing += swingV * dt;
      lantern.rotation.z = swing * 0.25 + Math.sin(t * 0.8) * 0.02;
      lantern.rotation.x = swing * 0.12;
      const camD = ctx.camera.position.distanceTo(root.position);
      lod.update(camD);
      if (litT >= 0) {
        litT += dt;
        const k = Math.min(1, litT / 0.6);
        const flick = 1 + Math.sin(t * 23) * 0.06 + Math.sin(t * 37 + 1) * 0.05;
        const fs = lerp(0.22, 1, easeOutBack(k, 2.5));
        flame.scale.set(fs * flick, fs * (flick + Math.sin(t * 17) * 0.08), fs * flick);
        glassMat.color.copy(unlitGlass).lerp(litGlass, k);
        runeMat.color.copy(unlitRune).lerp(litRune, k);
        halo.opacity = 0.42 * k * flick;
        halo.size = 1.9 * (0.95 + 0.05 * flick);
        pool.material.opacity = 0.3 * k * flick;
        if ((sparkAcc += dt) > 0.35) {
          sparkAcc = 0;
          lantern.getWorldPosition(_v);
          _v.y -= 0.32;
          sparkVel.set((Math.random() - 0.5) * 0.3, 0.6, (Math.random() - 0.5) * 0.3);
          ctx.particles.spawn(_v, sparkVel, SPARK);
        }
      } else {
        flame.scale.setScalar(0.22 + Math.sin(t * 3) * 0.04);
        const pl = ctx.player;
        if (canCollect(pl)) {
          const dx = pl.position.x - spot.x, dz = pl.position.z - spot.z;
          if (dx * dx + dz * dz < T.radius * T.radius && Math.abs(pl.position.y - spot.y) < 3) e.light();
        }
      }
    },
    dispose() {
      if (collider) ctx.physics.removeCollider(collider);
      collider = null;
      glassMat.dispose(); runeMat.dispose(); P.halos.remove(halo); pool.material.dispose();
    },
  };
  return e;
}

// ---------------------------------------------------------------------------------------------
// Lantern Gate: rises after boss:defeated; walking into its portal completes the level.
// ---------------------------------------------------------------------------------------------
function gateAssets(ctx, A) {
  if (A.gate) return A.gate;
  const M = ctx.materials;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const R = rand(414);
  // base arch curve: two legs and a round top, in the XY plane (gate faces +/-Z)
  const archPts = [V(-2.2, -0.7, 0), V(-2.08, 0.5, 0), V(-2.02, 1.7, 0), V(-1.98, 2.75, 0), V(-1.72, 3.7, 0), V(-1.05, 4.38, 0), V(0, 4.64, 0),
    V(1.05, 4.38, 0), V(1.72, 3.7, 0), V(1.98, 2.75, 0), V(2.02, 1.7, 0), V(2.08, 0.5, 0), V(2.2, -0.7, 0)];
  const arch = new THREE.CatmullRomCurve3(archPts);
  const bark = new THREE.Color(0x4a3426), barkLight = new THREE.Color(0x6e4e34), moss = new THREE.Color(0x5d7d3a);
  const barkPaint = (x, y, z, nx, ny, nz, c) => {
    c.copy(bark).lerp(barkLight, clamp(nz * 0.5 + 0.3, 0, 0.6));
    if (ny > 0.55) c.lerp(moss, smoothstep(0.55, 0.9, ny) * 0.85);
  };
  const roots = [];
  const N = 120;
  const tmpN = new THREE.Vector3(), tmpT = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  // twisted strands winding around the arch curve
  for (let s = 0; s < 4; s++) {
    const pts = [];
    const ph = (s / 4) * Math.PI * 2;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const p = arch.getPointAt(u);
      arch.getTangentAt(u, tmpT);
      tmpN.crossVectors(Z, tmpT).normalize(); // in-plane normal
      const feet = Math.max(smoothstep(0.2, 0.0, u), smoothstep(0.8, 1.0, u));
      const off = 0.17 + feet * 0.22;
      const a = ph + u * Math.PI * 2 * 3.2;
      pts.push(p.clone().addScaledVector(tmpN, Math.cos(a) * off).addScaledVector(Z, Math.sin(a) * off));
    }
    roots.push(paintBy(taperedTube(pts, 0.1, (u) => 1 + 1.1 * Math.max(smoothstep(0.18, 0.0, u), smoothstep(0.82, 1.0, u)) - 0.15 * Math.sin(u * Math.PI), 160, 6), barkPaint));
  }
  roots.push(paintBy(taperedTube(archPts, 0.2, (u) => 1 + 0.9 * Math.max(smoothstep(0.15, 0.0, u), smoothstep(0.85, 1.0, u)), 90, 8), barkPaint));
  // root feet flaring along the ground
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4 + R() * 0.5;
      const len = 0.9 + R() * 0.6;
      const p0 = V(sx * 2.1, 0.5, 0);
      const p1 = V(sx * 2.1 + Math.cos(a) * len * 0.5, 0.18, Math.sin(a) * len * 0.5);
      const p2 = V(sx * 2.1 + Math.cos(a) * len, -0.12, Math.sin(a) * len);
      roots.push(paintBy(taperedTube([p0, p1, p2], 0.13, (u) => lerp(1, 0.25, u), 12, 6), barkPaint));
    }
  }
  // twigs on the top arch
  for (let k = 0; k < 7; k++) {
    const u = 0.25 + (k / 6) * 0.5;
    const p = arch.getPointAt(u);
    arch.getTangentAt(u, tmpT);
    tmpN.crossVectors(Z, tmpT).normalize().negate(); // outward
    const sgn = k % 2 ? 1 : -1;
    const p1 = p.clone().addScaledVector(tmpN, 0.5).addScaledVector(Z, sgn * 0.25).add(V(0, 0.15, 0));
    const p2 = p1.clone().addScaledVector(tmpN, 0.35).addScaledVector(tmpT, (R() - 0.5) * 0.6).add(V(0, 0.2, 0));
    roots.push(paintBy(taperedTube([p, p1, p2], 0.06, (u2) => lerp(1, 0.3, u2), 10, 5), barkPaint));
  }
  // hanging moss strands under the arch
  const mossGeos = [];
  for (let k = 0; k < 16; k++) {
    const u = 0.18 + R() * 0.64;
    const p = arch.getPointAt(u);
    const len = 0.3 + R() * 0.7;
    mossGeos.push(paint(place(new THREE.ConeGeometry(0.05 + R() * 0.03, len, 4), [p.x, p.y - 0.15 - len / 2, (R() - 0.5) * 0.4], [0, R() * 3, Math.PI]), _c.set(0x6f8f3e).multiplyScalar(0.8 + R() * 0.3)));
  }
  const rootGeo = merge([...roots, ...mossGeos]);

  // little lanterns hanging from the arch + glowing bulbs on the roots
  const frames = [], glows = [], lanternSpots = [];
  const iron = new THREE.Color(0x2f2a28), rope = new THREE.Color(0xc9a46a);
  [0.3, 0.4, 0.5, 0.6, 0.7].forEach((u, k) => {
    const p = arch.getPointAt(u);
    const drop = [0.55, 0.85, 0.45, 0.85, 0.55][k];
    const top = V(p.x, p.y - 0.12, 0.0);
    const ly = top.y - drop;
    frames.push(paint(cylBetween(top, V(p.x, ly + 0.12, 0), 0.012, 0.012, 4), rope));
    frames.push(paint(place(new THREE.ConeGeometry(0.13, 0.1, 6), [p.x, ly + 0.08, 0]), iron));
    frames.push(paint(place(new THREE.CylinderGeometry(0.1, 0.08, 0.035, 6), [p.x, ly - 0.14, 0]), iron));
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + 0.5;
      frames.push(paint(cylBetween(V(p.x + Math.cos(a) * 0.09, ly - 0.13, Math.sin(a) * 0.09), V(p.x + Math.cos(a) * 0.09, ly + 0.04, Math.sin(a) * 0.09), 0.01, 0.01, 4), iron));
    }
    glows.push(paint(place(new THREE.CylinderGeometry(0.085, 0.085, 0.17, 6), [p.x, ly - 0.045, 0]), new THREE.Color(0xffb04a).multiplyScalar(2.2)));
    lanternSpots.push([p.x, ly - 0.04, 0]);
  });
  for (let k = 0; k < 10; k++) {
    const u = k < 5 ? 0.04 + k * 0.045 : 0.78 + (k - 5) * 0.045;
    const p = arch.getPointAt(u);
    const s = 0.08 + R() * 0.07;
    const col = k % 2 ? new THREE.Color(0x5ef2e0).multiplyScalar(2.0) : new THREE.Color(0xffb04a).multiplyScalar(2.0);
    const side = R() < 0.5 ? -1 : 1;
    glows.push(paint(place(new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), [p.x + (p.x > 0 ? 0.22 : -0.22), p.y, side * 0.3], [0, 0, (p.x > 0 ? -1 : 1) * 0.5], [s, s * 0.6, s]), col));
  }
  A.gate = {
    rootGeo, frameGeo: merge(frames), glowGeo: merge(glows), lanternSpots,
    woodMat: M.toon(0xffffff, { vertexColors: true }),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
    portalGeo: new THREE.CircleGeometry(1, 64),
  };
  return A.gate;
}

function createLanternGate(ctx, P, def) {
  const G = gateAssets(ctx, P.A);
  const M = ctx.materials;
  const T = PICKUP_TUNING.gate;
  const id = def.id ?? 'lanternGate';
  const base = toVec(def.pos || [0, 0, 0]);
  if (!hasY(def.pos)) base.y = groundAt(ctx, base.x, base.z);
  const yaw = def.yaw ?? 0;
  const root = new THREE.Group();
  root.name = 'lantern-gate';
  root.position.copy(base);
  root.rotation.y = yaw;
  root.visible = false;
  const rise = new THREE.Group(); // animated vertical offset
  root.add(rise);
  const roots = new THREE.Mesh(G.rootGeo, G.woodMat);
  roots.castShadow = true; roots.receiveShadow = true;
  M.outline(roots, 0.03);
  const frames = new THREE.Mesh(G.frameGeo, G.woodMat);
  M.outline(frames, 0.01);
  const glows = new THREE.Mesh(G.glowGeo, G.glowMat);
  rise.add(roots, frames, glows);
  const portalMat = fogShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uFlare: { value: 0 } },
    vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const portal = new THREE.Mesh(G.portalGeo, portalMat);
  portal.scale.set(1.82, 2.2, 1);
  portal.position.y = 2.28;
  portal.renderOrder = 3;
  rise.add(portal);
  const halos = G.lanternSpots.map(([x, y, z]) => P.halos.add(rise, { offset: [x, y, z], size: 1.0, color: 0xffb04a, opacity: 0.4 }));
  const bigHalo = P.halos.add(rise, { offset: [0, 2.3, 0], size: 6.5, color: 0xffd08a, opacity: 0 });
  const pool = groundGlow(P.A, 0xffb04a, 3.4, 0);
  root.add(pool);

  const MOTE = { color: 0xffffff, life: 1.1, size: 0.14, kind: 'glow', intensity: 2.2, drag: 0.2 };
  const DUST = { position: null, count: 5, color: [0x6b4a2e, 0x8a6a40, 0x5a4a38], speed: 2.5, spread: 0.7, life: 0.9, size: 0.45, gravity: 1, kind: 'puff' };
  const moteVel = new THREE.Vector3();
  let state = 'hidden', st = 0, t = 0, moteAcc = 0, dustAcc = 0, shakeAcc = 0, flare = 0;
  const colliders = [];
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const toWorld = (lx, lz, out) => out.set(base.x + lx * cosY + lz * sinY, 0, base.z - lx * sinY + lz * cosY);

  const e = {
    type: 'lanternGate', object3d: root, tags: new Set(['lanternGate']), alive: true,
    radius: 2.2, height: 4.8, team: 'neutral', hittable: false, gateId: id,
    get position() { return root.position; },
    get state() { return state; },
    get open() { return portalMat.uniforms.uOpen.value; },
    triggered: false,
    /** Start rising (instant: skip the animation). */
    raise(instant = false) {
      if (state !== 'hidden') return;
      root.visible = true;
      if (instant) { state = 'risen'; st = 0; rise.position.y = 0; addColliders(); openPortal(1); return; }
      state = 'waiting'; st = 0;
      rise.position.y = -T.depth;
    },
    update(dt) {
      t += dt;
      if (state === 'hidden') return;
      st += dt;
      portalMat.uniforms.uTime.value = ctx.time.real;
      if (state === 'waiting') {
        if (st >= T.riseDelay) {
          state = 'rising'; st = 0;
          ctx.events.emit('ui:message', { text: 'The Lantern Gate rises from the pit... step into the light!', duration: 4 });
        }
        return;
      }
      if (state === 'rising') {
        const k = Math.min(1, st / T.riseTime);
        rise.position.y = -T.depth * (1 - easeOutCubic(k));
        rise.position.x = Math.sin(t * 40) * 0.03 * (1 - k);
        if ((shakeAcc += dt) > 0.3 && k < 0.95) { shakeAcc = 0; if (ctx.cameraRig && ctx.cameraRig.shake) ctx.cameraRig.shake(0.1, 0.35); }
        if ((dustAcc += dt) > 0.08) {
          dustAcc = 0;
          for (const sx of [-1, 1]) {
            toWorld(sx * (1.8 + Math.random() * 0.9), (Math.random() - 0.5) * 1.6, _v);
            _v.y = base.y + 0.1;
            DUST.position = _v;
            ctx.particles.burst(DUST);
          }
        }
        if (k >= 1) {
          state = 'opening'; st = 0; rise.position.set(0, 0, 0); addColliders();
          toWorld(0, 0, _v); _v.y = base.y + 2.3;
          ctx.particles.burst({ position: _v, count: 40, color: [0xffb04a, 0x5ef2e0, 0xffffff], speed: 5, life: 0.9, size: 0.2, kind: 'glow', intensity: 2.4 });
        }
        updateHalos(0.3);
        return;
      }
      if (state === 'opening') {
        const k = Math.min(1, st / T.openTime);
        openPortal(easeOutBack(k, 1.4));
        updateHalos(1);
        if (k >= 1) { state = 'risen'; st = 0; ctx.events.emit('gate:open', { id, position: base.clone() }); }
        return;
      }
      // risen: swirl, motes, trigger
      updateHalos(1);
      flare = Math.max(0, flare - dt * 1.5);
      portalMat.uniforms.uFlare.value = flare;
      if ((moteAcc += dt) > 0.045) {
        moteAcc = 0;
        const a = Math.random() * Math.PI * 2;
        const lx = Math.cos(a) * 2.6, ly = 2.28 + Math.sin(a) * 2.9, lz = (Math.random() - 0.5) * 1.2;
        toWorld(lx, lz, _v); _v.y = base.y + ly;
        toWorld(-lx * 0.9, -lz, moteVel); moteVel.x -= base.x; moteVel.z -= base.z; moteVel.y = -(ly - 2.28) * 0.9;
        MOTE.color = Math.random() < 0.5 ? 0xffb04a : 0x5ef2e0;
        ctx.particles.spawn(_v, moteVel, MOTE);
      }
      if (e.triggered) return;
      const pl = ctx.player;
      if (!canCollect(pl) || portalMat.uniforms.uOpen.value < 0.85) return;
      const dx = pl.position.x - base.x, dz = pl.position.z - base.z;
      const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY, ly = pl.position.y - base.y;
      if (Math.abs(lx) < 1.5 && Math.abs(lz) < 0.6 && ly > -0.6 && ly < 3.8) complete();
    },
    dispose() {
      for (const c of colliders) ctx.physics.removeCollider(c);
      colliders.length = 0;
      off();
      portalMat.dispose(); pool.material.dispose(); P.halos.remove(bigHalo);
      for (const h of halos) P.halos.remove(h);
    },
  };

  function openPortal(k) {
    portalMat.uniforms.uOpen.value = Math.max(0, k);
    bigHalo.opacity = 0.14 * clamp(k, 0, 1);
    pool.material.opacity = 0.4 * clamp(k, 0, 1);
  }
  function updateHalos(k) {
    for (let i = 0; i < halos.length; i++) halos[i].opacity = 0.4 * k * (0.85 + 0.15 * Math.sin(t * 5 + i * 1.7));
    bigHalo.opacity = 0.14 * clamp(portalMat.uniforms.uOpen.value, 0, 1) * (0.9 + 0.1 * Math.sin(t * 1.3)) * (1 + flare);
  }
  function addColliders() {
    if (colliders.length) return;
    for (const sx of [-1, 1]) {
      toWorld(sx * 2.08, 0, _v);
      colliders.push(ctx.physics.addBox({ min: [_v.x - 0.32, base.y, _v.z - 0.32], max: [_v.x + 0.32, base.y + 3.4, _v.z + 0.32], surface: 'wood', tag: 'lanternGate' }));
    }
  }
  function complete() {
    e.triggered = true;
    flare = 1;
    ctx.flags.levelComplete = true;
    const score = ctx.score;
    let stats;
    if (score && typeof score.snapshot === 'function') {
      stats = score.snapshot();
      const info = score.rankInfo ? score.rankInfo(stats.total, stats.maxPossible) : null;
      stats.rank = info ? info.rank : score.computeRank ? score.computeRank(stats.total, stats.maxPossible) : null;
      stats.rankRatio = info ? Math.round(info.ratio * 1000) / 1000 : null;
    } else {
      stats = { total: score ? score.points ?? 0 : 0, rank: null };
    }
    _v.copy(ctx.player.position); _v.y += 0.6;
    ctx.particles.burst({ position: _v, count: 50, color: [0xffb04a, 0x5ef2e0, 0xffffff], speed: 6, life: 1.0, size: 0.22, kind: 'glow', intensity: 2.6 });
    ctx.events.emit('level:complete', { stats, gateId: id, position: base.clone() });
  }
  const off = ctx.events.on('boss:defeated', () => e.raise());
  return e;
}

// ---------------------------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------------------------
export function installPickups(ctx) {
  const A = assets(ctx);
  const holder = new THREE.Group();
  holder.name = 'pickup-holder (not in scene)';
  const P = {
    A, holder,
    glowcaps: null, debris: null,
    cagesTotal: new Set(), cagesFreed: 0, cpCounter: 1,
    lines: [], rng: rand(2024),
  };
  P.glowcaps = createGlowcapSystem(ctx, P);
  P.halos = createHaloSystem(ctx, P);
  P.debris = createDebris(ctx);
  const E = ctx.entities;

  E.registerType('glowcap', (c, def) => {
    const p = def.pos || [0, 0, 0];
    const pos = glowcapPos(c, p[0], p[1], p[2], null);
    return createGlowcap(c, P, pos, { pop: c.state === 'playing' });
  });
  E.registerType('glowcapLine', (c, def) => {
    const from = def.from || def.pos || [0, 0, 0], to = def.to || from;
    const n = Math.max(1, def.count | 0 || 5);
    const pts = [];
    const fy = Number.isFinite(from[1]) ? from[1] : null, ty = Number.isFinite(to[1]) ? to[1] : null;
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) : 0.5;
      const x = lerp(from[0], to[0], u), z = lerp(from[2], to[2], u);
      const y = fy !== null && ty !== null ? lerp(fy, ty, u) : null;
      pts.push(glowcapPos(c, x, y, z, fy ?? ty));
    }
    return glowcapGroup(c, P, def, pts);
  });
  E.registerType('glowcapRing', (c, def) => {
    const p = def.pos || [0, 0, 0];
    const n = Math.max(1, def.count | 0 || 6), r = def.radius ?? 2;
    const y = Number.isFinite(p[1]) ? p[1] : null;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (def.phase ?? 0);
      pts.push(glowcapPos(c, p[0] + Math.cos(a) * r, y, p[2] + Math.sin(a) * r, y));
    }
    return glowcapGroup(c, P, def, pts);
  });
  E.registerType('berry', (c, def) => createBerry(c, P, def));
  E.registerType('tonic', (c, def) => createTonic(c, P, def));
  E.registerType('cage', (c, def) => createCage(c, P, def));
  E.registerType('checkpoint', (c, def) => createCheckpoint(c, P, def));
  E.registerType('lanternGate', (c, def) => createLanternGate(c, P, def));

  ctx.addSystem({
    order: 40,
    update(dt) { P.glowcaps.update(dt); P.debris.update(dt); },
    frame() { P.glowcaps.frame(); P.debris.frame(); P.halos.frame(); },
  });

  ctx.pickups = {
    TUNING: PICKUP_TUNING,
    glowcaps: P.glowcaps,
    halos: P.halos,
    debris: P.debris,
    /** Live counts for HUD/debug. */
    stats() {
      return {
        glowcapsLeft: P.glowcaps.remaining, glowcapsCollected: P.glowcaps.collected, glowcapsDrawn: P.glowcaps.drawn,
        cagesFreed: P.cagesFreed, cagesTotal: P.cagesTotal.size,
      };
    },
    /** Raise every Lantern Gate now (what boss:defeated does). */
    raiseGates(instant = false) {
      let n = 0;
      for (const e of ctx.entities.query('lanternGate')) { e.raise(instant); n++; }
      return n;
    },
    /** Light a checkpoint by id without walking there (no event when silent). */
    lightCheckpoint(id, silent = false) {
      const e = ctx.entities.query('checkpoint').find((x) => x.checkpointId === id);
      if (e && e.light) e.light(silent);
      return !!e;
    },
  };
  return ctx.pickups;
}
