// Bog water: one opaque plane at waterLevel with a custom shader.
//  - colour from water depth (baked terrain depth texture, see terrain.buildDepthTexture)
//  - animated ripple normals (3 octaves of scrolling value noise)
//  - soft foam where it meets terrain (depth ~0) and around stumps/posts (texture G channel),
//    with slow foam lines creeping toward the shore
//  - fresnel toward the fog/sky colour and a fake moon glint along the reflected view ray
//  - up to 8 expanding ripple rings (fish, frogs, splashes) fed by addRipple(x, z)
// Waterfalls are ribbons that follow the terrain with a scrolling-streak shader.
import * as THREE from 'three';

const WATER_VERT = /* glsl */`
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform sampler2D uDepth;
uniform vec4 uDepthXf;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uFoam;
uniform vec4 uRipples[8];
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float waves(vec2 p) {
  float h = vnoise(p * 0.32 + vec2(uTime * 0.05, uTime * 0.035)) * 0.55;
  h += vnoise(p * 0.85 - vec2(uTime * 0.09, -uTime * 0.07)) * 0.3;
  h += vnoise(p * 2.4 + vec2(uTime * 0.17, uTime * 0.12)) * 0.15;
  return h;
}
void main() {
  vec2 p = vWorld.xz;
  float e = 0.18;
  float h0 = waves(p);
  vec3 n = normalize(vec3((h0 - waves(p + vec2(e, 0.0))) / e * 0.22, 1.0, (h0 - waves(p + vec2(0.0, e))) / e * 0.22));
  float ringFoam = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float d = length(p - r.xy);
    float rad = 0.3 + r.z * 1.7;
    float band = exp(-pow((d - rad) * 2.6, 2.0)) * r.w * exp(-r.z * 1.1);
    vec2 dir = (p - r.xy) / max(d, 0.001);
    n.xz += dir * band * sin((d - rad) * 10.0) * 0.7;
    ringFoam += band * 0.6;
  }
  n = normalize(n);
  vec4 dt = texture2D(uDepth, p * uDepthXf.xy + uDepthXf.zw);
  float depth = dt.r * 4.0;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 4.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 2.0, depth));
  // faint streaky sheen from the ripples
  col *= 0.88 + 0.24 * smoothstep(0.35, 0.75, h0);
  col = mix(col, uSky, clamp(fres * 0.75 + 0.06, 0.0, 0.8));
  // fake moon glint along the reflected ray (HDR -> blooms on 'high')
  vec3 R = reflect(-V, n);
  float m = max(dot(R, uMoonDir), 0.0);
  float dist = length(cameraPosition - vWorld);
  col += uMoonColor * (pow(m, 1400.0) * 2.4 * smoothstep(90.0, 15.0, dist) + pow(m, 60.0) * 0.07);
  // shore + obstacle foam
  float fn = vnoise(p * 2.1 + vec2(uTime * 0.21, -uTime * 0.17));
  float shore = 1.0 - smoothstep(0.0, 0.42, depth);
  float lines = smoothstep(0.6, 0.92, sin(depth * 16.0 - uTime * 1.5 + fn * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.1, 0.9, depth));
  float foam = shore * (0.45 + 0.55 * fn) + lines * 0.55;
  foam += dt.g * smoothstep(0.25, 0.7, fn + dt.g * 0.45);
  foam += ringFoam * (0.4 + 0.6 * fn);
  foam = clamp(foam, 0.0, 1.0) * (1.0 - dt.b);
  col = mix(col, uFoam, foam * 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWater(ctx, { depthTex, grid, waterLevel = 0 }) {
  const width = grid.x1 - grid.x0, depth = grid.z1 - grid.z0;
  const geo = new THREE.PlaneGeometry(width, depth, 8, 32).rotateX(-Math.PI / 2);
  geo.translate((grid.x0 + grid.x1) / 2, waterLevel, (grid.z0 + grid.z1) / 2);
  const ripples = [];
  for (let i = 0; i < 8; i++) ripples.push(new THREE.Vector4(0, 0, 0, 0));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uTime: { value: 0 },
    uDepth: { value: depthTex },
    uDepthXf: { value: depthTex.userData.transform },
    uMoonDir: { value: (ctx.gfx.moonDir || new THREE.Vector3(-0.4, 0.4, 0.8)).clone().normalize() },
    uMoonColor: { value: new THREE.Color(0xf6f1da) },
    uDeep: { value: new THREE.Color(0x0f2420) },
    uShallow: { value: new THREE.Color(0x2c4a36) },
    uSky: { value: new THREE.Color(0x3a7a7a) },
    uFoam: { value: new THREE.Color(0xb9d8c4) },
    uRipples: { value: ripples },
  });
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true });
  material.name = 'bog-water';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'bog-water';
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  ctx.scene.add(mesh);

  let next = 0;
  const skyMid = new THREE.Color(0x2c6d74);
  return {
    mesh, material, uniforms,
    /** Start an expanding ripple ring at x,z (strength 0..1). */
    addRipple(x, z, strength = 1) {
      const r = ripples[next]; next = (next + 1) % ripples.length;
      r.set(x, z, 0, strength);
    },
    frame(time, realDt) {
      uniforms.uTime.value = time;
      for (const r of ripples) if (r.w > 0) { r.z += realDt; if (r.z > 3) r.w = 0; }
      // sky reflection follows the fog tint
      if (ctx.scene.fog) uniforms.uSky.value.copy(ctx.scene.fog.color).lerp(skyMid, 0.45).multiplyScalar(1.15);
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Waterfalls
// ---------------------------------------------------------------------------
const FALL_VERT = /* glsl */`
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FALL_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // vUv.x across, vUv.y along the fall (0 = top) scaled in metres
  float s = vnoise(vec2(vUv.x * 9.0, vUv.y * 0.9 - uTime * 2.6)) * 0.65 + vnoise(vec2(vUv.x * 23.0, vUv.y * 2.0 - uTime * 4.0)) * 0.35;
  float streak = smoothstep(0.42, 0.85, s);
  float side = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  vec3 dark = vec3(0.12, 0.28, 0.27);
  vec3 lite = vec3(0.75, 0.92, 0.88);
  vec3 col = mix(dark, lite, streak * 0.75 + 0.1);
  float a = side * (0.55 + 0.4 * streak);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Terrain-following waterfall ribbons. falls: [{ from:[x,z], to:[x,z], width }]
 * sample(x,z) -> terrain height. Returns { mesh, frame(time), feet:[[x,y,z]] }.
 */
export function createWaterfalls(ctx, falls, sample, waterLevel = 0) {
  const pos = [], uv = [], idx = [];
  const feet = [];
  for (const f of falls) {
    const [ax, az] = f.from, [bx, bz] = f.to;
    const L = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const px = -dz, pz = dx;
    const N = Math.max(8, Math.ceil(L / 0.5));
    const base = pos.length / 3;
    let along = 0, prevY = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      const y = Math.max(sample(cx, cz) + 0.25, waterLevel + 0.02);
      if (prevY !== null) along += Math.hypot(L / N, y - prevY);
      prevY = y;
      for (const sgn of [-1, 1]) {
        const w = f.width * (0.5 + 0.5 * t) * 0.5;   // widens toward the foot
        pos.push(cx + px * w * sgn, y, cz + pz * w * sgn);
        uv.push(sgn < 0 ? 0 : 1, along);
      }
    }
    for (let i = 0; i < N; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    feet.push([bx, Math.max(sample(bx, bz), waterLevel) + 0.3, bz]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  uniforms.uTime = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, fog: true,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  material.name = 'waterfall';
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'waterfalls';
  mesh.renderOrder = 2;
  ctx.scene.add(mesh);
  return {
    mesh, feet,
    frame(time) { uniforms.uTime.value = time; },
    dispose() { g.dispose(); material.dispose(); },
  };
}
