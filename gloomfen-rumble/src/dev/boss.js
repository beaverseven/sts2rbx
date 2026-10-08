// Boss sandbox: a simple Gnarlbelly's Pit (flat circular floor, radius 22 m at y = 2,
// centred on (0, 2, 395)) with the boss on his throne at (0, 2, 402).
//   node tools/build.mjs --entry src/dev/boss.js --out dist/dev-boss --dev
// Keys: 1/2/3 drink an Anvil / Updraft / Seeker tonic, G toggles god mode, V makes the boss dizzy (debug).
// The level area builds the real pit; this is only a test stage.
import * as THREE from 'three';
import { boot } from '../core/boot.js';
import { installEnemies } from '../game/enemies/index.js';
import { smoothstep, rand, valueNoise2, clamp } from '../core/mathx.js';

export const PIT = { center: [0, 2, 395], radius: 22, bossPos: [0, 2, 402], entry: [0, 2, 368] };
const CX = PIT.center[0], CY = PIT.center[1], CZ = PIT.center[2], R = PIT.radius;

function pitHeight(x, z) {
  const d = Math.hypot(x - CX, z - CZ);
  let rim = smoothstep(R + 0.6, R + 4.5, d) * 6.5 + smoothstep(R + 4.5, R + 30, d) * 5 * valueNoise2(x * 0.06 + 3, z * 0.06);
  // entrance corridor from the south
  if (z < CZ) rim *= smoothstep(4.0, 7.0, Math.abs(x - CX));
  return CY + rim + (valueNoise2(x * 0.4, z * 0.4) - 0.5) * 0.06 * smoothstep(R, R + 2, d);
}

function buildPit(ctx) {
  const M = ctx.materials, scene = ctx.scene, r = rand(77);
  const n = new THREE.Vector3();
  ctx.physics.setTerrain({
    sample: pitHeight,
    normal(x, z) { const e = 0.2; return n.set(pitHeight(x - e, z) - pitHeight(x + e, z), 2 * e, pitHeight(x, z - e) - pitHeight(x, z + e)).normalize(); },
    surfaceAt(x, z) { return Math.hypot(x - CX, z - CZ) < R ? 'mud' : 'moss'; },
  });
  ctx.physics.waterLevel = 0;

  // terrain mesh
  const size = 130, seg = 170;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(CX, 0, CZ - 8);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const floorA = new THREE.Color(0x6e5638), floorB = new THREE.Color(0x87704a), rimC = new THREE.Color(0x4d5a36), moss = new THREE.Color(M.palette.moss), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = pitHeight(x, z);
    pos.setY(i, y);
    const d = Math.hypot(x - CX, z - CZ);
    const nz = valueNoise2(x * 0.3, z * 0.3);
    c.copy(floorA).lerp(floorB, nz);
    // trampled rings
    c.multiplyScalar(1 - 0.12 * (0.5 + 0.5 * Math.sin(d * 1.3)) * smoothstep(R, R - 3, d));
    c.lerp(rimC, smoothstep(R - 0.5, R + 1.5, d));
    c.lerp(moss.clone().multiplyScalar(0.75), smoothstep(R + 4, R + 7, d) * (0.6 + 0.4 * nz));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, M.toon(0xffffff, { vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);

  // ring of stones marking the arena edge
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  const stones = new THREE.InstancedMesh(stoneGeo, M.toon(0x8a8478), 64);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const x = CX + Math.sin(a) * (R + 0.6), z = CZ + Math.cos(a) * (R + 0.6);
    if (z < CZ && Math.abs(x - CX) < 4.5) { m4.makeScale(0, 0, 0); stones.setMatrixAt(k, m4); continue; }
    const sc = 0.45 + r() * 0.35;
    m4.compose(p.set(x, pitHeight(x, z) + sc * 0.3, z), q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3)), s.set(sc * 1.2, sc * 0.8, sc));
    stones.setMatrixAt(k, m4);
  }
  stones.castShadow = true; stones.receiveShadow = true;
  M.outline(stones, 0.06);
  scene.add(stones);

  // torches on the rim
  const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 3, 6);
  const bowlGeo = new THREE.CylinderGeometry(0.42, 0.24, 0.35, 8);
  const flameGeo = new THREE.ConeGeometry(0.3, 0.8, 7);
  const postMat = M.toon(M.palette.bark), bowlMat = M.toon(0x5a5f68), flameMat = M.glow(0xffa040, 2.6);
  const haloMat = new THREE.SpriteMaterial({ map: M.softDotTexture(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45, fog: false });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 10;
    const x = CX + Math.sin(a) * (R + 3.2), z = CZ + Math.cos(a) * (R + 3.2);
    const y = pitHeight(x, z);
    const g = new THREE.Group();
    const post = new THREE.Mesh(postGeo, postMat); post.position.y = 1.5; post.castShadow = true;
    const bowl = new THREE.Mesh(bowlGeo, bowlMat); bowl.position.y = 3.1;
    const flame = new THREE.Mesh(flameGeo, flameMat); flame.position.y = 3.6;
    const halo = new THREE.Sprite(haloMat); halo.position.y = 3.6; halo.scale.setScalar(3);
    g.add(post, bowl, flame, halo);
    M.outline(post, 0.03); M.outline(bowl, 0.03);
    g.position.set(x, y, z);
    scene.add(g);
  }
}

/** SANDBOX-ONLY SHIM: a minimal 'tonic' jar (the pickups area owns the real one). */
function registerTonicShim(ctx) {
  if (ctx.entities.hasType('tonic')) return;
  const M = ctx.materials;
  const colors = { anvil: 0x9aa7b8, updraft: 0x8ef06a, seeker: 0xff5fb2 };
  ctx.entities.registerType('tonic', (c, def) => {
    const g = new THREE.Group();
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.6, 12), M.toon(0xd8f0ff, { transparent: true, opacity: 0.55 }));
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.29, 0.42, 12), M.glow(colors[def.kind] || 0xffffff, 1.8));
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.16, 8), M.toon(M.palette.bark));
    jar.position.y = 0.7; liquid.position.y = 0.65; cork.position.y = 1.08;
    g.add(liquid, jar, cork);
    M.outline(jar, 0.02);
    const p = def.pos || [0, 0, 0];
    g.position.set(p[0], p[1], p[2]);
    let cool = 0, t = 0;
    const e = {
      object3d: g, tags: new Set(['pickup', 'tonic']), alive: true, radius: 0.5, team: 'neutral', kind: def.kind,
      get position() { return g.position; },
      update(dt) {
        t += dt;
        if (cool > 0) { cool -= dt; if (cool <= 0) g.visible = true; return; }
        g.rotation.y += dt; jar.position.y = 0.7 + Math.sin(t * 3) * 0.08; liquid.position.y = jar.position.y - 0.05; cork.position.y = jar.position.y + 0.38;
        const pl = c.player.position;
        if (Math.hypot(pl.x - g.position.x, pl.z - g.position.z) < 1.1 && Math.abs(pl.y - g.position.y) < 1.5) {
          c.player.setTonic(def.kind);
          c.particles.burst({ position: g.position, count: 20, color: [colors[def.kind], 0xffffff], speed: 4, life: 0.6, size: 0.2, kind: 'glow' });
          if (def.respawn) { cool = 6; g.visible = false; } else e.alive = false;
        }
      },
      dispose() {},
    };
    return e;
  });
}

function buildLevel(ctx) {
  buildPit(ctx);
  registerTonicShim(ctx);
  ctx.entities.spawn({ type: 'boss', pos: PIT.bossPos, arena: { center: PIT.center, radius: PIT.radius } });
  return {
    name: 'Pit sandbox',
    spawn: { position: PIT.entry, yaw: 0 },
    checkpoints: [{ id: 'pit', position: PIT.entry, yaw: 0 }],
    zone: 'pit',
  };
}

const ctx = boot({ startState: 'playing', install: [installEnemies], buildLevel });
ctx.gfx.setFog(0x2a4a50, 0.012);

const legend = document.createElement('div');
legend.style.cssText = 'position:fixed;left:12px;bottom:10px;padding:6px 10px;border-radius:8px;background:rgba(26,21,48,.55);' +
  'color:#f3e6c8;font:12px/1.5 system-ui,sans-serif;pointer-events:none;white-space:nowrap';
legend.textContent = 'WASD move · Space jump · J / LMB throw · K / Shift lock · 1/2/3 tonics · G god mode · V boss dizzy (debug)';
document.body.appendChild(legend);
// tiny boss bar for the sandbox (the UI area owns the real HUD)
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);width:340px;height:14px;border-radius:7px;border:2px solid #1a1530;background:rgba(26,21,48,.6);display:none';
const fill = document.createElement('div');
fill.style.cssText = 'height:100%;width:100%;border-radius:5px;background:linear-gradient(#ffc35a,#e0702a)';
bar.appendChild(fill);
document.body.appendChild(bar);
ctx.hud = { ...ctx.hud, showBossBar(on) { bar.style.display = on ? 'block' : 'none'; } };
const setFill = (hp, max) => { fill.style.width = `${clamp(hp / max, 0, 1) * 100}%`; };
ctx.events.on('boss:start', ({ maxHp, hp }) => setFill(hp ?? maxHp, maxHp));
ctx.events.on('boss:hurt', ({ hp, maxHp }) => setFill(hp, maxHp));
window.addEventListener('keydown', (ev) => {
  const kind = { Digit1: 'anvil', Digit2: 'updraft', Digit3: 'seeker' }[ev.code];
  if (kind) ctx.player.setTonic(kind);
  if (ev.code === 'KeyG') ctx.player.god = !ctx.player.god;
  if (ev.code === 'KeyV') { const b = ctx.enemies.boss(); if (b && b.fightOn && !b.dying) b.enterDizzy('crash'); }
});

