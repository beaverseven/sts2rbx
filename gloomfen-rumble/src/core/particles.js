// Pooled particles in two draw calls: soft alpha-blended puffs and additive sparks/glows.
//   particles.burst({ position, count, color, speed, spread, life, size, gravity, kind:'spark'|'puff'|'glow' })
//   particles.spawn(position, velocity, { color, life, size, gravity, kind, ... })   // single particle (trails)
import * as THREE from 'three';

const KIND_DEFAULTS = {
  puff: { additive: false, grow: 1.9, drag: 3.0, gravity: -0.4, alpha: 0.85, intensity: 1 },
  spark: { additive: true, grow: 0.2, drag: 1.2, gravity: 9, alpha: 1, intensity: 1.6 },
  glow: { additive: true, grow: 0.4, drag: 2.0, gravity: 0, alpha: 1, intensity: 2.0 },
};

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d;
  a = a * a * (3.0 - 2.0 * a);
  gl_FragColor = vec4(vColor, a * vAlpha);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef ADDITIVE
      gl_FragColor.a *= (1.0 - fogF);
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF);
    #endif
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createSystem(capacity, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(capacity * 3);
  const col = new Float32Array(capacity * 3);
  const size = new Float32Array(capacity);
  const alpha = new Float32Array(capacity);
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aColor', aCol);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aAlpha', aAlpha);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 500 } }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: additive ? { ADDITIVE: 1 } : {},
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 20 : 10;
  points.name = additive ? 'particles-additive' : 'particles-alpha';
  const _size = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(_size);
    const fov = camera.isPerspectiveCamera ? camera.fov : 60;
    uniforms.uScale.value = _size.y / (2 * Math.tan((fov * Math.PI) / 360));
  };

  // simulation state (structure of arrays)
  const sim = {
    vel: new Float32Array(capacity * 3),
    life: new Float32Array(capacity), maxLife: new Float32Array(capacity),
    size0: new Float32Array(capacity), size1: new Float32Array(capacity),
    grav: new Float32Array(capacity), drag: new Float32Array(capacity),
    alpha0: new Float32Array(capacity), fadeIn: new Float32Array(capacity),
  };
  return { points, geo, pos, col, size, alpha, aPos, aCol, aSize, aAlpha, sim, capacity, count: 0, ring: 0, dirtyColor: false };
}

export function createParticles(ctx, { capacity = 1500 } = {}) {
  const alphaSys = createSystem(capacity, false);
  const addSys = createSystem(capacity, true);
  const group = new THREE.Group();
  group.name = 'particles';
  group.add(alphaSys.points, addSys.points);
  ctx.scene.add(group);

  const _c = new THREE.Color();
  const _dir = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function emitOne(sys, px, py, pz, vx, vy, vz, life, size0, size1, grav, drag, alpha0, r, g, b) {
    let i;
    if (sys.count < sys.capacity) i = sys.count++;
    else { i = sys.ring; sys.ring = (sys.ring + 1) % sys.capacity; }
    const s = sys.sim;
    sys.pos[i * 3] = px; sys.pos[i * 3 + 1] = py; sys.pos[i * 3 + 2] = pz;
    s.vel[i * 3] = vx; s.vel[i * 3 + 1] = vy; s.vel[i * 3 + 2] = vz;
    s.life[i] = 0; s.maxLife[i] = Math.max(0.02, life);
    s.size0[i] = size0; s.size1[i] = size1;
    s.grav[i] = grav; s.drag[i] = drag; s.alpha0[i] = alpha0;
    s.fadeIn[i] = sys === alphaSys ? 0.08 : 0.0;
    sys.col[i * 3] = r; sys.col[i * 3 + 1] = g; sys.col[i * 3 + 2] = b;
    sys.size[i] = size0; sys.alpha[i] = s.fadeIn[i] > 0 ? 0 : alpha0;
    sys.dirtyColor = true;
  }

  function setColor(color, intensity) {
    if (color === undefined || color === null) _c.setRGB(1, 1, 1);
    else if (Array.isArray(color)) _c.set(color[(Math.random() * color.length) | 0]);
    else _c.set(color);
    _c.multiplyScalar(intensity);
  }

  /**
   * Burst of particles.
   * opts: position (Vector3, required), count=12, color (hex|string|Color|array of them), speed=3,
   *   spread=1 (0 = all along `direction`, 1 = full sphere), direction=up, life=0.6, size=0.3 (m),
   *   gravity (m/s² downward; kind default), kind='puff'|'spark'|'glow', jitter=0.1 (position radius),
   *   drag, grow (end size multiplier), intensity (colour multiplier, >1 blooms), alpha
   */
  function burst(o) {
    const kind = KIND_DEFAULTS[o.kind] ? o.kind : 'puff';
    const d = KIND_DEFAULTS[kind];
    const sys = d.additive ? addSys : alphaSys;
    const count = o.count ?? 12;
    const speed = o.speed ?? 3;
    const spread = o.spread ?? 1;
    const life = o.life ?? 0.6;
    const size = o.size ?? 0.3;
    const grav = o.gravity ?? d.gravity;
    const drag = o.drag ?? d.drag;
    const grow = o.grow ?? d.grow;
    const jitter = o.jitter ?? 0.1;
    const alpha = o.alpha ?? d.alpha;
    const intensity = o.intensity ?? d.intensity;
    const dir = o.direction ? _dir.copy(o.direction).normalize() : _dir.copy(UP);
    const p = o.position;
    for (let k = 0; k < count; k++) {
      // random unit vector
      const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
      _v.set(rr * Math.cos(a), z, rr * Math.sin(a));
      _v.multiplyScalar(spread).addScaledVector(dir, 1 - spread);
      if (_v.lengthSq() < 1e-6) _v.copy(dir);
      _v.normalize().multiplyScalar(speed * (0.45 + Math.random() * 0.55));
      setColor(o.color, intensity);
      const s0 = size * (0.7 + Math.random() * 0.6);
      const jx = (Math.random() * 2 - 1) * jitter, jy = (Math.random() * 2 - 1) * jitter, jz = (Math.random() * 2 - 1) * jitter;
      emitOne(sys, p.x + jx, p.y + jy, p.z + jz, _v.x, _v.y, _v.z, life * (0.7 + Math.random() * 0.6), s0, s0 * grow, grav, drag, alpha, _c.r, _c.g, _c.b);
    }
  }

  /** Single particle with an explicit velocity (trails, jets). Same opts as burst (no count/speed/spread). */
  function spawn(position, velocity, o = {}) {
    const kind = KIND_DEFAULTS[o.kind] ? o.kind : 'glow';
    const d = KIND_DEFAULTS[kind];
    const sys = d.additive ? addSys : alphaSys;
    setColor(o.color, o.intensity ?? d.intensity);
    const size = o.size ?? 0.2;
    emitOne(sys, position.x, position.y, position.z, velocity ? velocity.x : 0, velocity ? velocity.y : 0, velocity ? velocity.z : 0,
      o.life ?? 0.4, size, size * (o.grow ?? d.grow), o.gravity ?? d.gravity, o.drag ?? d.drag, o.alpha ?? d.alpha, _c.r, _c.g, _c.b);
  }

  function updateSystem(sys, dt) {
    const s = sys.sim;
    let i = 0;
    while (i < sys.count) {
      const life = s.life[i] + dt;
      if (life >= s.maxLife[i]) {
        // swap-remove with the last live particle
        const last = --sys.count;
        if (i !== last) copyParticle(sys, last, i);
        continue;
      }
      s.life[i] = life;
      const i3 = i * 3;
      const k = Math.max(0, 1 - s.drag[i] * dt);
      s.vel[i3] *= k; s.vel[i3 + 1] = (s.vel[i3 + 1] - s.grav[i] * dt) * k; s.vel[i3 + 2] *= k;
      sys.pos[i3] += s.vel[i3] * dt; sys.pos[i3 + 1] += s.vel[i3 + 1] * dt; sys.pos[i3 + 2] += s.vel[i3 + 2] * dt;
      const t = life / s.maxLife[i];
      sys.size[i] = s.size0[i] + (s.size1[i] - s.size0[i]) * t;
      const fin = s.fadeIn[i] > 0 ? Math.min(1, life / s.fadeIn[i]) : 1;
      const fout = 1 - t;
      sys.alpha[i] = s.alpha0[i] * fin * fout * (2 - fout); // ease-out fade
      i++;
    }
    sys.ring = sys.ring % Math.max(1, sys.capacity);
    sys.geo.setDrawRange(0, sys.count);
    if (sys.count > 0 || sys._wasActive) {
      sys.aPos.needsUpdate = true; sys.aSize.needsUpdate = true; sys.aAlpha.needsUpdate = true;
      if (sys.dirtyColor) { sys.aCol.needsUpdate = true; sys.dirtyColor = false; }
    }
    sys._wasActive = sys.count > 0;
  }

  function copyParticle(sys, from, to) {
    const s = sys.sim;
    const f3 = from * 3, t3 = to * 3;
    for (let c = 0; c < 3; c++) {
      sys.pos[t3 + c] = sys.pos[f3 + c]; s.vel[t3 + c] = s.vel[f3 + c]; sys.col[t3 + c] = sys.col[f3 + c];
    }
    s.life[to] = s.life[from]; s.maxLife[to] = s.maxLife[from];
    s.size0[to] = s.size0[from]; s.size1[to] = s.size1[from];
    s.grav[to] = s.grav[from]; s.drag[to] = s.drag[from];
    s.alpha0[to] = s.alpha0[from]; s.fadeIn[to] = s.fadeIn[from];
    sys.size[to] = sys.size[from]; sys.alpha[to] = sys.alpha[from];
    sys.dirtyColor = true;
  }

  return {
    group,
    burst, spawn,
    update(dt) { updateSystem(alphaSys, dt); updateSystem(addSys, dt); },
    clear() { alphaSys.count = 0; addSys.count = 0; },
    get count() { return alphaSys.count + addSys.count; },
  };
}
