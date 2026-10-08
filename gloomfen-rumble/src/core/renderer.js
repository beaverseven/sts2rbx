// Renderer, scene, camera, twilight sky dome, fog, lights with a player-following
// shadow camera, optional bloom, resize and quality management.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const QUALITY = {
  high: { dpr: 2, shadow: 2048, bloom: true },
  medium: { dpr: 1.5, shadow: 2048, bloom: false },
  low: { dpr: 1, shadow: 1024, bloom: false },
};
const SHADOW_EXTENT = 24;     // half-size of the shadow frustum around the player (m)
const FOG_COLOR = 0x2a5a52;   // between sky-mid and moss-dark, darkened for twilight
const FOG_DENSITY = 0.0135;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to the far plane
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uGlowDir;
uniform float uTime;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float h = max(y, 0.0);

  // vertical gradient: teal low, indigo zenith
  vec3 col = mix(uMid, uTop, smoothstep(0.02, 0.6, pow(h, 0.8)));

  // warm amber band hugging the horizon, strongest toward the afterglow azimuth
  vec2 hd = normalize(d.xz + 1e-5);
  float az = max(dot(hd, normalize(uGlowDir.xz)), 0.0);
  float band = exp(-max(y, 0.0) * mix(16.0, 7.0, az * az)) * (0.45 + 0.55 * az * az);
  col = mix(col, uHorizon, clamp(band, 0.0, 1.0) * smoothstep(-0.03, 0.01, y));
  // a few soft cloud wisps across the band
  float wisp = noise3(vec3(d.x * 6.0, y * 30.0, d.z * 6.0) + vec3(uTime * 0.01, 0.0, 0.0));
  wisp = smoothstep(0.55, 0.85, wisp) * exp(-abs(y - 0.12) * 18.0);
  col = mix(col, mix(uMid, uHorizon, 0.35) * 0.8, wisp * 0.5);

  // stars, fading toward the horizon and twinkling a little
  vec3 sp = d * 180.0;
  vec3 cell = floor(sp);
  float rnd = hash13(cell);
  if (rnd > 0.975) {
    vec3 jitter = vec3(hash13(cell + 7.1), hash13(cell + 3.7), hash13(cell + 1.3)) - 0.5;
    float dist = length(fract(sp) - 0.5 - jitter * 0.6);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + rnd * 4.0) + rnd * 60.0);
    float star = smoothstep(0.22, 0.0, dist) * tw * smoothstep(0.06, 0.5, y) * (rnd - 0.975) * 40.0;
    col += vec3(0.85, 0.92, 1.0) * star;
  }

  // big soft moon with a halo
  float md = dot(d, normalize(uMoonDir));
  float halo = pow(max(md, 0.0), 64.0) * 0.18 + pow(max(md, 0.0), 6.0) * 0.05;
  col += uMoonColor * halo;
  float disc = smoothstep(0.99790, 0.99830, md);
  if (disc > 0.0) {
    float mare = noise3(d * 90.0) * 0.6 + noise3(d * 220.0) * 0.4;
    vec3 moon = uMoonColor * (0.92 - 0.22 * smoothstep(0.45, 0.75, mare));
    col = mix(col, moon, disc);
  }

  // below the horizon blend into the fog colour so the ground line disappears
  col = mix(col, uBelow, smoothstep(0.015, -0.06, y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createRenderer(ctx, container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r185: PCF with shadow.radius is the soft filter (PCFSoft is deprecated)
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.outline = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  scene.background = new THREE.Color(FOG_COLOR);

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 700);
  camera.position.set(0, 3, -7);
  scene.add(camera);

  // --- sky dome
  const pal = ctx.materials.palette;
  const moonDir = new THREE.Vector3(-0.42, 0.42, 0.8).normalize();
  const glowDir = new THREE.Vector3(0.55, 0, 1).normalize();
  const skyUniforms = {
    uTop: { value: new THREE.Color(pal.skyTop) },
    uMid: { value: new THREE.Color(pal.skyMid) },
    uHorizon: { value: new THREE.Color(pal.horizon) },
    uBelow: { value: new THREE.Color(FOG_COLOR) },
    uMoonDir: { value: moonDir },
    uMoonColor: { value: new THREE.Color(0xf6f1da) },
    uGlowDir: { value: glowDir },
    uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 48, 24),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);

  // --- lights. The key "moonlight" comes from behind-left of the default camera so
  // faces read well; the visible moon sits ahead-left in the sky (artistic cheat).
  const hemi = new THREE.HemisphereLight(0x8aaed0, 0x2a3a2c, 1.05);
  scene.add(hemi);
  const lightDir = new THREE.Vector3(0.45, 0.85, -0.55).normalize(); // direction TO the light
  const sun = new THREE.DirectionalLight(0xd6e0ff, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_EXTENT; sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT; sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  // warm rim/fill from the afterglow side
  const rim = new THREE.DirectionalLight(pal.horizon, 0.65);
  rim.position.copy(glowDir).multiplyScalar(50).add(new THREE.Vector3(0, 12, 0));
  scene.add(rim, rim.target);

  // --- post
  let composer = null, bloomPass = null;
  function ensureComposer() {
    if (composer) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.4, 0.95);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  const gfx = {
    renderer, scene, camera, sky, hemi, sun, rim,
    lightDir, moonDir, glowDir,
    fog: scene.fog,
    quality: 'high',
    autoQuality: true,
    shadowTarget: new THREE.Vector3(),
    width: 1, height: 1,

    /** 'high' | 'medium' | 'low'. Manual calls disable auto-quality unless opts.auto. */
    setQuality(q, opts = {}) {
      if (!QUALITY[q]) q = 'high';
      if (!opts.auto) gfx.autoQuality = false;
      gfx.quality = q;
      ctx.settings.quality = q;
      const Q = QUALITY[q];
      const size = Q.shadow;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      if (Q.bloom) ensureComposer();
      gfx.resize();
    },

    resize() {
      const w = Math.max(1, container.clientWidth || window.innerWidth);
      const h = Math.max(1, container.clientHeight || window.innerHeight);
      const Q = QUALITY[gfx.quality];
      const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, h); }
      gfx.width = w; gfx.height = h;
    },

    /** Called every rendered frame: sky follows camera, shadow camera follows the target. */
    frame(realDt) {
      skyUniforms.uTime.value += realDt;
      sky.position.copy(camera.position);
      updateShadowCamera();
      trackPerformance(realDt);
    },

    render() {
      if (QUALITY[gfx.quality].bloom && composer) composer.render();
      else renderer.render(scene, camera);
    },

    /** Change fog (level zones may tint it). */
    setFog(color, density) {
      if (color !== undefined) { scene.fog.color.set(color); skyUniforms.uBelow.value.set(color); scene.background.set(color); }
      if (density !== undefined) scene.fog.density = density;
    },
    get bloom() { return bloomPass; },
  };

  // Shadow camera follows ctx.player (or gfx.shadowTarget), snapped to shadow texels
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _t = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  function updateShadowCamera() {
    const target = ctx.player ? ctx.player.position : gfx.shadowTarget;
    _t.copy(target);
    // light-space basis
    _right.crossVectors(lightDir, WORLD_UP);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, lightDir).normalize();
    const texel = (SHADOW_EXTENT * 2) / sun.shadow.mapSize.x;
    const a = Math.round(_t.dot(_right) / texel) * texel;
    const b = Math.round(_t.dot(_up) / texel) * texel;
    const c = _t.dot(lightDir);
    _t.copy(_right).multiplyScalar(a).addScaledVector(_up, b).addScaledVector(lightDir, c);
    sun.target.position.copy(_t);
    sun.position.copy(_t).addScaledVector(lightDir, 70);
    rim.target.position.copy(_t);
    rim.position.copy(_t).addScaledVector(glowDir, 50).setY(_t.y + 14);
  }

  // Auto-quality: sustained slow frames while playing -> 'low' (silent)
  let perfTime = 0, perfFrames = 0, perfSum = 0;
  function trackPerformance(realDt) {
    if (!gfx.autoQuality || gfx.quality === 'low' || ctx.state !== 'playing' || document.hidden) {
      perfTime = perfFrames = perfSum = 0; return;
    }
    if (realDt > 0.25) return; // ignore hitches (tab switches)
    perfTime += realDt; perfFrames++; perfSum += realDt;
    if (perfTime >= 3) {
      if (perfSum / perfFrames > 0.024) gfx.setQuality('low', { auto: true });
      perfTime = perfFrames = perfSum = 0;
    }
  }

  window.addEventListener('resize', () => gfx.resize());
  gfx.setQuality(ctx.settings.quality || 'high', { auto: true });
  return gfx;
}
