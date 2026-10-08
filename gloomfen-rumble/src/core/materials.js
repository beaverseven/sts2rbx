// Shared toon look: 3-step gradient map, palette, inverted-hull outlines, canvas textures.
import * as THREE from 'three';

// Palette (ARCHITECTURE.md "Visual direction") + a few character colours.
// Keys are camelCase; the hyphenated table tokens are aliased too (palette['sky-top']).
const PALETTE = {
  skyTop: 0x1b1f4a,
  skyMid: 0x2c6d74,
  horizon: 0xf2a65a,
  moss: 0x7fae4e,
  mossDark: 0x3f6b3a,
  bark: 0x5a3e2b,
  bog: 0x1f3b33,
  glowCyan: 0x5ef2e0,
  glowMagenta: 0xff5fb2,
  amber: 0xffc35a,
  iron: 0x8a97a6,
  outline: 0x1a1530,
  // extras used by core models
  cream: 0xf3e6c8,
  ochre: 0xc9892f,
  capDark: 0x6e3f1a,
  scarf: 0x5f9a3c,
  straw: 0xd9b75e,
  burlap: 0x9c7b50,
  mud: 0x6b4a2e,
  stone: 0x8c8a8f,
  leaf: 0x5c9e3a,
  updraft: 0x8ef06a,
  white: 0xffffff,
  ink: 0x120e22,
};
const ALIASES = {
  'sky-top': 'skyTop', 'sky-mid': 'skyMid', 'moss-dark': 'mossDark',
  'glow-cyan': 'glowCyan', 'glow-magenta': 'glowMagenta',
};
for (const [alias, key] of Object.entries(ALIASES)) PALETTE[alias] = PALETTE[key];
Object.freeze(PALETTE);

export function createMaterials() {
  // 3-step toon ramp (shadow / mid / lit), sampled with nearest filtering.
  const ramp = new Uint8Array([84, 168, 255]);
  const gradientMap = new THREE.DataTexture(ramp, ramp.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const sharedCache = new Map();
  const outlineCache = new Map();
  const outlineNormalsDone = new WeakSet();

  /**
   * New MeshToonMaterial with the shared gradient map.
   * color: number | string | THREE.Color. opts: any MeshToonMaterial parameters.
   * Returns a fresh material (safe to mutate, e.g. for hurt flashes).
   */
  function toon(color = 0xffffff, opts = {}) {
    return new THREE.MeshToonMaterial({ color, gradientMap, ...opts });
  }

  /** Cached toon material shared by everyone asking for the same color+opts. Do not mutate. */
  function shared(color = 0xffffff, opts = {}) {
    const key = `${typeof color === 'object' ? color.getHexString() : color}|${JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v))}`;
    let m = sharedCache.get(key);
    if (!m) { m = toon(color, opts); sharedCache.set(key, m); }
    return m;
  }

  /**
   * Unlit HDR colour for glowing bits (spore puffs, mushrooms, lantern cores).
   * intensity > 1 pushes it over the bloom threshold on quality 'high'.
   */
  function glow(color = PALETTE.glowCyan, intensity = 2.2, opts = {}) {
    const c = new THREE.Color(color).multiplyScalar(intensity);
    return new THREE.MeshBasicMaterial({ color: c, ...opts });
  }

  function outlineMaterial(color, thickness) {
    const key = `${color}|${thickness}`;
    let m = outlineCache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    const uThickness = { value: thickness };
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uOutlineThickness = uThickness;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 outlineNormal;\nuniform float uOutlineThickness;')
        .replace('#include <begin_vertex>', 'vec3 transformed = position + outlineNormal * uOutlineThickness;');
    };
    m.customProgramCacheKey = () => 'gloomfen-outline';
    m.userData.isOutline = true;
    outlineCache.set(key, m);
    return m;
  }

  /** Adds an `outlineNormal` attribute: normals averaged over coincident vertices (crack-free hulls). */
  function computeOutlineNormals(geometry) {
    if (outlineNormalsDone.has(geometry) || geometry.attributes.outlineNormal) return;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const n = pos.count;
    const groups = new Map();
    const keyOf = new Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos.getX(i) * 1e4)}_${Math.round(pos.getY(i) * 1e4)}_${Math.round(pos.getZ(i) * 1e4)}`;
      keyOf[i] = k;
      let acc = groups.get(k);
      if (!acc) { acc = [0, 0, 0]; groups.set(k, acc); }
      acc[0] += nor.getX(i); acc[1] += nor.getY(i); acc[2] += nor.getZ(i);
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = groups.get(keyOf[i]);
      const len = Math.hypot(a[0], a[1], a[2]) || 1;
      out[i * 3] = a[0] / len; out[i * 3 + 1] = a[1] / len; out[i * 3 + 2] = a[2] / len;
    }
    geometry.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
    outlineNormalsDone.add(geometry);
  }

  function outlineOne(mesh, thickness, color) {
    computeOutlineNormals(mesh.geometry);
    const mat = outlineMaterial(color, thickness);
    let hull;
    if (mesh.isInstancedMesh) {
      hull = new THREE.InstancedMesh(mesh.geometry, mat, mesh.count);
      hull.instanceMatrix = mesh.instanceMatrix; // share transforms
    } else {
      hull = new THREE.Mesh(mesh.geometry, mat);
    }
    hull.name = 'outline';
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.userData.isOutline = true;
    hull.raycast = () => {};
    mesh.add(hull);
    mesh.userData.outline = hull;
    return hull;
  }

  /**
   * Inverted-hull outline. thickness is in the mesh's local units (default 0.025).
   * For a Mesh returns the hull mesh (added as a child, shares geometry);
   * for any other Object3D outlines every descendant mesh (skips userData.noOutline)
   * and returns an array of hulls.
   */
  function outline(obj, thickness = 0.025, color = PALETTE.outline) {
    if (obj.isMesh) return outlineOne(obj, thickness, color);
    const meshes = [];
    obj.traverse((o) => {
      if (o.isMesh && !o.userData.isOutline && !o.userData.noOutline && !o.userData.outline) meshes.push(o);
    });
    return meshes.map((m) => outlineOne(m, thickness, color));
  }

  /**
   * CanvasTexture drawn once by drawFn(g2d, w, h).
   * opts: { repeat:[u,v] (enables RepeatWrapping), srgb:true, nearest:false }
   */
  function canvasTexture(w, h, drawFn, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    drawFn(g, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
    if (opts.repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    if (opts.nearest) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; }
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  /** Soft round white sprite (used by particles, halos, blob shadows). Cached. */
  let softDot = null;
  function softDotTexture() {
    if (softDot) return softDot;
    softDot = canvasTexture(64, 64, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, { srgb: false });
    return softDot;
  }

  return {
    palette: PALETTE,
    gradientMap,
    toon, shared, glow, outline, canvasTexture, softDotTexture, computeOutlineNormals,
  };
}

export { PALETTE };
