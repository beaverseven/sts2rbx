// Enemy effects shared by all bandits and the boss, pooled and stepped by one
// ctx.addSystem({update}) (so they pause with the simulation):
//   fx.shockwave({ position, speed, maxRadius, width, damage, owner, height })  expanding ground ring;
//                 hurts Morel once if he is ON THE GROUND when it passes (jump over it)
//   fx.prop(object3d, { velocity, spin, life, radius, bounce, clone })  short-lived physics debris
//                 (tin pots, cauldron halves, chest plates) that bounces on the ground and fades
//   fx.decal(kind, position, { size, life, rotation })   'crack' | 'splat' | 'marker' ground decals
//   fx.floater(kind, { follow, offset, position, velocity, life, size })  '!' '?' 'z' 'star' pop-ups
//   fx.sfx(name, position, volume)   ctx.audio.play wrapper (never throws)
import * as THREE from 'three';
import { clamp01, easeOutBack, rand } from '../../core/mathx.js';

const fxCache = new WeakMap();

export function getFx(ctx) {
  let fx = fxCache.get(ctx);
  if (!fx) { fx = createFx(ctx); fxCache.set(ctx, fx); }
  return fx;
}

function symbolTexture(M, kind) {
  return M.canvasTexture(128, 128, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.lineJoin = 'round';
    if (kind === 'alert' || kind === 'question') {
      // jagged speech burst
      g.beginPath();
      const n = 14;
      for (let k = 0; k <= n * 2; k++) {
        const a = (k / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? 44 : 56;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.92;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = kind === 'alert' ? '#ffd24a' : '#bfefff';
      g.strokeStyle = '#1a1530'; g.lineWidth = 7;
      g.stroke(); g.fill();
      g.fillStyle = '#1a1530';
      g.font = 'bold 76px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(kind === 'alert' ? '!' : '?', cx, cy + 4);
    } else if (kind === 'z') {
      g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#1a1530'; g.lineWidth = 10; g.strokeText('z', cx, cy);
      g.fillStyle = '#d8f4ff'; g.fillText('z', cx, cy);
    } else if (kind === 'star') {
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? 22 : 54;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = '#fff1a0'; g.strokeStyle = '#ffb02e'; g.lineWidth = 6;
      g.stroke(); g.fill();
    } else if (kind === 'anger') {
      // four bulging veins (cartoon cross), red
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 12; g.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const x0 = cx + Math.cos(a) * 14, y0 = cy + Math.sin(a) * 14;
        const x1 = cx + Math.cos(a) * 46, y1 = cy + Math.sin(a) * 46;
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx + Math.cos(a + 0.6) * 40, cy + Math.sin(a + 0.6) * 40, x1, y1); g.stroke();
      }
    }
  });
}

function createFx(ctx) {
  const { scene, physics, particles, materials: M } = ctx;
  const root = new THREE.Group(); root.name = 'enemy-fx'; scene.add(root);
  const r = rand(99);
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const ZERO = new THREE.Vector3();

  function sfx(name, position, volume = 1) {
    try { ctx.audio.play(name, { position, volume }); } catch { /* audio must never break AI */ }
  }

  // ------------------------------------------------------------------ shockwaves
  const SEG = 72;
  const wallTex = M.canvasTexture(4, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.55, 'rgb(90,60,20)'); grd.addColorStop(0.92, 'rgb(255,220,150)'); grd.addColorStop(1, 'rgb(255,240,200)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
  const wallGeo = new THREE.CylinderGeometry(1, 1, 1, SEG, 1, true).translate(0, 0.5, 0);
  const waves = [];
  function makeWave() {
    const group = new THREE.Group();
    const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, color: new THREE.Color(0xffa040).multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.frustumCulled = false;
    const bandGeo = new THREE.BufferGeometry();
    const pos = new Float32Array((SEG + 1) * 2 * 3);
    bandGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    bandGeo.setIndex(idx);
    const bandMat = new THREE.MeshBasicMaterial({ color: 0x8a6436, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.frustumCulled = false;
    group.add(wall, band);
    group.visible = false;
    root.add(group);
    return { active: false, group, wall, band, bandGeo, pos, center: new THREE.Vector3(), radius: 0, prev: 0, speed: 8, maxRadius: 10, width: 0.5, damage: 1, owner: null, hit: false, dustT: 0, age: 0, height: 0.6 };
  }
  for (let k = 0; k < 6; k++) waves.push(makeWave());

  function shockwave(o) {
    let w = waves.find((x) => !x.active);
    if (!w) { w = makeWave(); waves.push(w); }
    w.active = true;
    w.center.copy(o.position);
    w.radius = o.startRadius ?? 0.4; w.prev = w.radius;
    w.speed = o.speed ?? 8; w.maxRadius = o.maxRadius ?? 10; w.width = o.width ?? 0.5;
    w.damage = o.damage ?? 1; w.owner = o.owner || null; w.hit = false; w.dustT = 0; w.age = 0;
    w.height = o.height ?? 0.6;
    w.group.position.copy(w.center).y += 0.02;
    w.group.visible = true;
    layoutWave(w);
    return w;
  }

  function layoutWave(w) {
    const fade = 1 - clamp01((w.radius - w.maxRadius * 0.75) / (w.maxRadius * 0.25));
    w.wall.scale.set(w.radius, w.height * (0.6 + 0.4 * fade), w.radius);
    w.wall.material.opacity = 0.9 * fade;
    w.band.material.opacity = 0.75 * fade;
    const inner = Math.max(0.05, w.radius - w.width), outer = w.radius + w.width * 0.35;
    const pos = w.pos;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos[i * 6] = c * inner; pos[i * 6 + 1] = 0.03; pos[i * 6 + 2] = s * inner;
      pos[i * 6 + 3] = c * outer; pos[i * 6 + 4] = 0.06; pos[i * 6 + 5] = s * outer;
    }
    w.bandGeo.attributes.position.needsUpdate = true;
  }

  const DUST = { color: 0xb08850, life: 0.55, size: 0.55, kind: 'puff', gravity: -0.5, drag: 2.5, alpha: 0.75 };
  function updateWaves(dt) {
    const pl = ctx.player;
    for (const w of waves) {
      if (!w.active) continue;
      w.age += dt;
      w.prev = w.radius;
      w.radius += w.speed * dt;
      if (w.radius >= w.maxRadius) { w.active = false; w.group.visible = false; continue; }
      layoutWave(w);
      // dust kicked up along the front
      w.dustT -= dt;
      if (w.dustT <= 0) {
        w.dustT = 0.05;
        const n = Math.min(14, 4 + Math.floor(w.radius * 0.8));
        for (let k = 0; k < n; k++) {
          const a = r() * Math.PI * 2;
          _v.set(w.center.x + Math.cos(a) * w.radius, w.center.y + 0.15, w.center.z + Math.sin(a) * w.radius);
          _v2.set(Math.cos(a) * 1.5, 1.2 + r(), Math.sin(a) * 1.5);
          particles.spawn(_v, _v2, DUST);
        }
      }
      // Morel gets hit if he is grounded inside the band this step
      if (!w.hit && pl && pl.state !== 'dead' && pl.visible !== false) {
        const dx = pl.position.x - w.center.x, dz = pl.position.z - w.center.z;
        const d = Math.hypot(dx, dz);
        const pr = pl.radius || 0.3;
        if (d >= w.prev - w.width - pr && d <= w.radius + w.width * 0.35 + pr && Math.abs(pl.position.y - w.center.y) < 0.9) {
          if (pl.onGround) {
            w.hit = true;
            pl.damage(w.damage, w.center);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ props
  const props = [];
  /** Turn an Object3D into tumbling debris. opts.clone: animate a clone (keeps the original). */
  function prop(obj, o = {}) {
    let item = obj;
    obj.updateWorldMatrix(true, true);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    obj.matrixWorld.decompose(pos, quat, scl);
    if (o.clone) item = obj.clone(true);
    if (item.parent) item.parent.remove(item);
    root.add(item);
    item.position.copy(pos); item.quaternion.copy(quat); item.scale.copy(scl);
    item.visible = true;
    item.traverse((m) => { if (m.isMesh && !m.userData.isOutline) m.castShadow = true; });
    const p = {
      obj: item, vel: (o.velocity ? o.velocity.clone() : new THREE.Vector3(0, 5, 0)),
      spin: o.spin ? o.spin.clone() : new THREE.Vector3(r() * 10 - 5, r() * 10 - 5, r() * 10 - 5),
      life: o.life ?? 3, age: 0, radius: o.radius ?? 0.15, bounce: o.bounce ?? 0.42,
      base: scl.clone(), resting: false, sinking: false, sound: o.sound ?? 'clatter', clatterT: 0,
    };
    props.push(p);
    return item;
  }
  function updateProps(dt) {
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i], o = p.obj;
      p.age += dt;
      p.clatterT -= dt;
      if (p.sinking) {
        o.position.y -= 0.6 * dt;
        o.scale.multiplyScalar(1 - dt * 1.2);
        if (p.age > p.life || o.scale.x < 0.05) { remove(i); continue; }
        continue;
      }
      if (!p.resting) {
        p.vel.y -= 24 * dt;
        o.position.addScaledVector(p.vel, dt);
        _q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
        o.quaternion.multiply(_q);
        const gh = physics.groundHeight(o.position.x, o.position.z, o.position.y + 0.6);
        const floor = gh > -Infinity ? gh : -1e9;
        if (o.position.y - p.radius < floor) {
          if (floor < physics.waterLevel + 0.02) {
            p.sinking = true; p.age = Math.max(p.age, p.life - 1.2);
            particles.burst({ position: o.position, count: 10, color: [0x2c5a48, 0x9cc8b0], speed: 2.5, spread: 0.5, life: 0.5, size: 0.25, gravity: 9, kind: 'puff' });
            sfx('splash', o.position, 0.5);
            continue;
          }
          o.position.y = floor + p.radius;
          if (p.vel.y < 0) {
            const impact = -p.vel.y;
            p.vel.y = impact > 1.8 ? impact * p.bounce : 0;
            p.vel.x *= 0.62; p.vel.z *= 0.62;
            p.spin.multiplyScalar(0.55);
            if (impact > 2.5 && p.clatterT <= 0) {
              p.clatterT = 0.12;
              sfx(p.sound, o.position, Math.min(1, impact / 10));
              particles.burst({ position: o.position, count: 5, color: [0xffe0a0, 0xffffff], speed: 3, life: 0.25, size: 0.08, kind: 'spark' });
            }
          }
          if (p.vel.y === 0 && Math.hypot(p.vel.x, p.vel.z) < 0.5) { p.resting = true; p.vel.set(0, 0, 0); }
        }
      }
      if (p.age > p.life) {
        const s = 1 - (p.age - p.life) / 0.35;
        if (s <= 0) { remove(i); continue; }
        o.scale.copy(p.base).multiplyScalar(s);
      }
    }
  }
  function remove(i) {
    const p = props[i];
    if (p.obj.parent) p.obj.parent.remove(p.obj);
    props.splice(i, 1);
  }

  // ------------------------------------------------------------------ decals
  const decalTex = {
    crack: M.canvasTexture(128, 128, (g, w, h) => {
      const rr = rand(5);
      g.strokeStyle = 'rgba(20,14,10,0.95)'; g.lineCap = 'round';
      const branch = (x, y, a, len, width, depth) => {
        if (depth <= 0 || len < 4) return;
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        g.lineWidth = width; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        branch(x2, y2, a + (rr() - 0.5) * 0.9, len * 0.7, width * 0.7, depth - 1);
        if (rr() < 0.55) branch(x2, y2, a + (rr() < 0.5 ? 0.8 : -0.8), len * 0.5, width * 0.6, depth - 1);
      };
      for (let k = 0; k < 7; k++) branch(w / 2, h / 2, (k / 7) * Math.PI * 2 + rr() * 0.5, 16 + rr() * 10, 5, 4);
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 22);
      grd.addColorStop(0, 'rgba(25,18,12,0.85)'); grd.addColorStop(1, 'rgba(25,18,12,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }),
    splat: M.canvasTexture(128, 128, (g, w, h) => {
      const rr = rand(8);
      g.fillStyle = 'rgba(70,46,26,0.9)';
      g.beginPath(); g.arc(w / 2, h / 2, 26, 0, 7); g.fill();
      for (let k = 0; k < 12; k++) {
        const a = rr() * Math.PI * 2, d = 26 + rr() * 26, rad = 4 + rr() * 9;
        g.beginPath(); g.arc(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, rad, 0, 7); g.fill();
        g.lineWidth = rad; g.strokeStyle = 'rgba(70,46,26,0.9)';
        g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d); g.stroke();
      }
      g.fillStyle = 'rgba(150,110,70,0.5)'; g.beginPath(); g.arc(w / 2 - 6, h / 2 - 6, 9, 0, 7); g.fill();
    }),
    marker: M.canvasTexture(128, 128, (g, w, h) => {
      g.strokeStyle = 'rgba(255,120,60,1)'; g.lineWidth = 9;
      g.beginPath(); g.arc(w / 2, h / 2, 52, 0, 7); g.stroke();
      g.lineWidth = 5; g.beginPath(); g.arc(w / 2, h / 2, 30, 0, 7); g.stroke();
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 50);
      grd.addColorStop(0, 'rgba(60,20,10,0.55)'); grd.addColorStop(1, 'rgba(60,20,10,0.1)');
      g.fillStyle = grd; g.beginPath(); g.arc(w / 2, h / 2, 50, 0, 7); g.fill();
    }),
  };
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const decals = [];
  function makeDecal() {
    const mat = new THREE.MeshBasicMaterial({ map: decalTex.crack, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const m = new THREE.Mesh(decalGeo, mat);
    m.visible = false; m.renderOrder = 2;
    root.add(m);
    return { active: false, mesh: m, kind: 'crack', life: 1, age: 0, size: 1, pulse: false };
  }
  for (let k = 0; k < 20; k++) decals.push(makeDecal());
  function decal(kind, position, o = {}) {
    let d = decals.find((x) => !x.active);
    if (!d) { d = decals.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b)); }
    const gh = physics.groundHeight(position.x, position.z, position.y + 0.6);
    if (gh === -Infinity || gh < physics.waterLevel + 0.02) return null;
    d.active = true; d.kind = kind; d.age = 0; d.life = o.life ?? (kind === 'marker' ? 1 : 4);
    d.size = o.size ?? 1.5;
    const m = d.mesh;
    m.material.map = decalTex[kind];
    m.material.blending = kind === 'marker' ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.material.opacity = 1;
    m.position.set(position.x, gh + 0.03, position.z);
    m.rotation.y = o.rotation ?? r() * Math.PI * 2;
    m.scale.setScalar(d.size);
    m.visible = true;
    return d;
  }
  function updateDecals(dt) {
    for (const d of decals) {
      if (!d.active) continue;
      d.age += dt;
      const t = d.age / d.life;
      if (t >= 1) { d.active = false; d.mesh.visible = false; continue; }
      const m = d.mesh;
      if (d.kind === 'marker') {
        // shrinks toward the impact moment, pulsing
        const s = d.size * (1.25 - 0.35 * t) * (1 + Math.sin(d.age * 20) * 0.05);
        m.scale.setScalar(s);
        m.material.opacity = Math.min(1, d.age * 5) * 0.9;
      } else {
        const appear = d.kind === 'crack' ? Math.min(1, d.age * 12) : 1;
        m.scale.setScalar(d.size * (d.kind === 'crack' ? 0.6 + 0.4 * appear : 1));
        m.material.opacity = Math.min(1, (1 - t) * 3);
      }
    }
  }

  // ------------------------------------------------------------------ floaters
  const floatTex = { alert: symbolTexture(M, 'alert'), question: symbolTexture(M, 'question'), z: symbolTexture(M, 'z'), star: symbolTexture(M, 'star'), anger: symbolTexture(M, 'anger') };
  const floaters = [];
  function makeFloater() {
    const mat = new THREE.SpriteMaterial({ map: floatTex.alert, transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.visible = false; s.renderOrder = 30;
    root.add(s);
    return { active: false, sprite: s, follow: null, offset: new THREE.Vector3(), vel: new THREE.Vector3(), life: 1, age: 0, size: 0.8, spin: 0 };
  }
  for (let k = 0; k < 16; k++) floaters.push(makeFloater());
  function floater(kind, o = {}) {
    let f = floaters.find((x) => !x.active);
    if (!f) { f = makeFloater(); floaters.push(f); }
    f.active = true; f.age = 0; f.life = o.life ?? 0.9; f.size = o.size ?? 0.8;
    f.follow = o.follow || null;
    f.offset.copy(o.offset || ZERO);
    f.vel.copy(o.velocity || ZERO);
    f.spin = o.spin ?? 0;
    f.sprite.material.map = floatTex[kind] || floatTex.alert;
    f.sprite.material.opacity = 1;
    f.sprite.material.rotation = o.rotation ?? 0;
    if (f.follow) f.sprite.position.copy(f.follow.position).add(f.offset);
    else f.sprite.position.copy(o.position || ZERO);
    f.sprite.scale.setScalar(0.01);
    f.sprite.visible = true;
    return f;
  }
  function updateFloaters(dt) {
    for (const f of floaters) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) { f.active = false; f.sprite.visible = false; f.follow = null; continue; }
      f.offset.addScaledVector(f.vel, dt);
      if (f.follow) f.sprite.position.copy(f.follow.position).add(f.offset);
      else f.sprite.position.addScaledVector(f.vel, dt);
      const pop = easeOutBack(Math.min(1, f.age / 0.2), 2.2);
      const out = 1 - clamp01((f.age - (f.life - 0.2)) / 0.2);
      f.sprite.scale.setScalar(f.size * Math.max(0.01, pop * out));
      f.sprite.material.rotation += f.spin * dt;
      f.sprite.material.opacity = out;
    }
  }

  // mud splats where mud balls land
  ctx.events.on('projectile:hit', (p) => {
    if (p.kind !== 'mud' || p.target || p.collider === 'water') return;
    decal('splat', p.position, { size: 1.1 + r() * 0.5, life: 5 });
  });

  ctx.addSystem({
    order: 4,
    update(dt) { updateWaves(dt); updateProps(dt); updateDecals(dt); updateFloaters(dt); },
  });

  /** Remove every active effect (sandbox resets). */
  function clearAll() {
    for (const w of waves) { w.active = false; w.group.visible = false; }
    for (let i = props.length - 1; i >= 0; i--) remove(i);
    for (const d of decals) { d.active = false; d.mesh.visible = false; }
    for (const f of floaters) { f.active = false; f.sprite.visible = false; }
  }

  return { root, sfx, shockwave, prop, decal, floater, clearAll, waves, props, decals, floaters, textures: floatTex };
}
