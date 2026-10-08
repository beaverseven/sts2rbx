// Level-area entity types (registered by installMechanisms(ctx); buildLevel calls it too):
//   movingPlatform {size, path, speed, pause, style}   kinematic raft/plank ping-ponging along a path
//   sinkingPad     {radius}                            lily pad that sinks while stood on, then resurfaces
//   bounceShroom   {power}                             launches Morel (player.launch(power)) on landing
//   ironGate       {id, size, flag}                    opens on an 'iron' projectile hit or ctx.flags[flag]
//   eventGate      {id, size, closeOn, openOn, startOpen}  portcullis driven by events (pit entrance)
//   arenaLock      {id, bounds, gates, waves}          locks gates while its waves are alive
//   sign           {title, text}                       readable signpost; ui:message when Morel is near
//   zoneTrigger    {id, name, bounds}                  zone:enter once per entry; sets ctx.level.zone
//   hazard         {kind:'thorns', size}               damages Morel on touch
// All are team 'neutral', have no hurt() (projectiles pass), and dispose their colliders.
import * as THREE from 'three';
import { clamp, lerp, rand, easeOutBack, smoothstep } from '../../core/mathx.js';
import { T, PCOL, PRIM as G, mergeParts, glowColor, grad, geo } from './props.js';

const UP = new THREE.Vector3(0, 1, 0);

// shared materials per ctx (vertex-coloured toon + glow)
function mats(ctx) {
  if (!ctx._levelMats) {
    const M = ctx.materials;
    ctx._levelMats = {
      toon: M.toon(0xffffff, { vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
    ctx._levelMats.toon.name = 'mech-toon';
    ctx._levelMats.glow.name = 'mech-glow';
  }
  return ctx._levelMats;
}

/** Build a group with one outlined toon mesh (+ optional glow mesh) from parts. */
function partsMesh(ctx, parts, glowParts = null, outline = 0.03, cast = true) {
  const m = mats(ctx);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(mergeParts(parts, { outline: outline > 0 }), m.toon);
  mesh.castShadow = cast; mesh.receiveShadow = true;
  if (outline > 0) ctx.materials.outline(mesh, outline);
  group.add(mesh);
  let glowMesh = null;
  if (glowParts && glowParts.length) {
    glowMesh = new THREE.Mesh(mergeParts(glowParts, { normal: false }), m.glow);
    group.add(glowMesh);
  }
  return { group, mesh, glowMesh };
}

function disposeGroup(group) {
  group.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.geometry.dispose(); });
}

const isDefeated = (e) => !e || e.alive === false || e.dead === true || (typeof e.hp === 'number' && e.hp <= 0 && e.hittable === false);

function playerOverlapsBox(player, min, max, pad = 0) {
  const p = player.position, r = player.radius ?? 0.32, h = player.height ?? 1.05;
  if (p.y + h < min.y || p.y > max.y) return false;
  const cx = clamp(p.x, min.x, max.x), cz = clamp(p.z, min.z, max.z);
  const dx = p.x - cx, dz = p.z - cz;
  return dx * dx + dz * dz < (r + pad) * (r + pad);
}

const inBounds = (p, b) => p.x >= b.min[0] && p.x <= b.max[0] && p.y >= b.min[1] && p.y <= b.max[1] && p.z >= b.min[2] && p.z <= b.max[2];

// ---------------------------------------------------------------------------
// movingPlatform
// ---------------------------------------------------------------------------
function createMovingPlatform(ctx, def) {
  const size = def.size || [3, 0.5, 3];
  const path = (def.path && def.path.length >= 2 ? def.path : [def.pos, def.pos]).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const r = rand(Math.floor(path[0].x * 13 + path[0].z * 7) + 5);
  // visual: lashed logs along the longer horizontal axis, top flush with the collider top
  const parts = [], glow = [];
  const alongZ = size[2] >= size[0];
  const across = alongZ ? size[0] : size[2], len = alongZ ? size[2] : size[0];
  const n = Math.max(3, Math.round(across / 0.6));
  const rad = across / n / 2;
  const top = size[1] / 2;
  for (let k = 0; k < n; k++) {
    const o = -across / 2 + rad + k * rad * 2;
    const L = len * (0.92 + r() * 0.12);
    const m = alongZ ? T(o, top - rad, -L / 2, 0, Math.PI / 2, 0, rad, L, rad) : T(-L / 2, top - rad, o, 0, 0, -Math.PI / 2, rad, L, rad);
    parts.push({ geometry: G.cyl(7), matrix: m, color: (px, py, pz, nx, ny, nz, out) => { out.copy(PCOL.bark).lerp(PCOL.barkLight, r() * 0.0 + 0.3 * Math.abs(nx)); if (Math.abs(ny) > 0.9) out.copy(PCOL.woodTop); } });
  }
  // lashing ropes across
  for (const f of [-0.3, 0.3]) {
    const m = alongZ ? T(0, top - rad * 0.2, f * len, 0, 0, Math.PI / 2, 0.06, across + 0.1, 0.06) : T(f * len, top - rad * 0.2, 0, Math.PI / 2, 0, Math.PI / 2, 0.06, across + 0.1, 0.06);
    parts.push({ geometry: geo('cylC8', () => new THREE.CylinderGeometry(1, 1, 1, 8)), matrix: m, color: PCOL.rope });
  }
  // tiny glowing shroom on a corner so rafts read as "special" at night
  glow.push({ geometry: G.hemi(8), matrix: T(across / 2 - 0.25, top + 0.12, len / 2 - 0.3, 0, 0, 0, 0.16, 0.11, 0.16), color: glowColor(0x5ef2e0, 1.6) });
  parts.push({ geometry: G.cyl(5), matrix: T(across / 2 - 0.25, top - 0.05, len / 2 - 0.3, 0, 0, 0, 0.04, 0.18, 0.04), color: PCOL.cream });
  const { group } = partsMesh(ctx, parts, glow, 0.035);
  const rotate = alongZ ? 0 : 0;
  group.rotation.y = rotate;
  group.position.copy(path[0]);
  const col = ctx.physics.addMover(ctx.physics.addBox({ center: path[0].toArray(), size, surface: 'wood', tag: 'platform' }));

  // cumulative lengths for ping-pong travel
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) { const L = path[i].distanceTo(path[i + 1]); segs.push(L); total += L; }
  const speed = def.speed ?? 2.5, pause = def.pause ?? 1.0;
  let s = 0, dir = 1, wait = pause * 0.5, t = 0, rippleT = 0;
  const posAt = (d, out) => {
    let k = 0;
    while (k < segs.length - 1 && d > segs[k]) { d -= segs[k]; k++; }
    return out.lerpVectors(path[k], path[k + 1], segs[k] ? clamp(d / segs[k], 0, 1) : 0);
  };
  const tmp = new THREE.Vector3();
  const e = {
    type: 'movingPlatform', def, object3d: group, tags: new Set(['platform', 'mover']), alive: true, radius: Math.max(size[0], size[2]) / 2, team: 'neutral',
    collider: col,
    get position() { return group.position; },
    update(dt) {
      t += dt;
      if (wait > 0) wait -= dt;
      else {
        // ease near the ends (slow in / slow out over the first/last metre)
        const edge = Math.min(s, total - s);
        const v = speed * (0.35 + 0.65 * smoothstep(0, 1.2, edge));
        s += dir * v * dt;
        if (s >= total) { s = total; dir = -1; wait = pause; }
        if (s <= 0) { s = 0; dir = 1; wait = pause; }
      }
      posAt(s, tmp);
      tmp.y += Math.sin(t * 1.7) * 0.03;          // gentle bob (collider follows)
      group.position.copy(tmp);
      group.rotation.z = Math.sin(t * 1.3) * 0.015;
      col.setPosition(tmp);
      rippleT -= dt;
      if (rippleT <= 0 && wait <= 0 && tmp.y < 1) {
        rippleT = 0.9;
        const w = ctx.level && ctx.level.water;
        if (w) w.addRipple(tmp.x - (path[1].x - path[0].x) * 0.1 * dir, tmp.z - (path[1].z - path[0].z) * 0.1 * dir, 0.5);
      }
    },
    reset() { s = 0; dir = 1; wait = pause * 0.5; },
    dispose(c) { c.physics.removeCollider(col); disposeGroup(group); },
  };
  e.update(0);
  return e;
}

// ---------------------------------------------------------------------------
// sinkingPad
// ---------------------------------------------------------------------------
function createSinkingPad(ctx, def) {
  const R = def.radius ?? 1.2;
  const rest = new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]);
  const r = rand(Math.floor(rest.x * 31 + rest.z * 17) + 3);
  const parts = [];
  // thick pad: short cylinder with a notch drawn by a darker wedge; top flush with rest y
  parts.push({ geometry: geo('padCyl', () => new THREE.CylinderGeometry(1, 0.94, 1, 18, 1, false, 0.32, Math.PI * 2 - 0.64)), matrix: T(0, -0.09, 0, r() * 6, 0, 0, R, 0.18, R), color: (px, py, pz, nx, ny, nz, out) => {
    const d = Math.hypot(px, pz);
    out.copy(PCOL.lilyDark).lerp(PCOL.lily, smoothstep(0.1, 0.9, d));
    if (ny > 0.9) out.lerp(new THREE.Color(0x6fb04a), 0.25 + 0.25 * Math.sin(Math.atan2(pz, px) * 9));
    else out.multiplyScalar(0.7);
  } });
  const glowP = [];
  if (r() < 0.75) {
    const a = r() * 6, d = R * 0.45;
    glowP.push({ geometry: G.cone(6), matrix: T(Math.cos(a) * d, 0, Math.sin(a) * d, 0, 0, 0, 0.16, 0.28, 0.16), color: glowColor(0xff8fd0, 1.25) });
    glowP.push({ geometry: G.cone(6), matrix: T(Math.cos(a) * d, 0, Math.sin(a) * d, 0.6, 0, 0, 0.11, 0.36, 0.11), color: glowColor(0xffd0ec, 1.6) });
  }
  const { group } = partsMesh(ctx, parts, glowP, 0, false);   // flat pads: no outline hull (saves a draw call each)
  group.position.copy(rest);
  const half = R * 0.72;
  const thick = 0.3;
  const col = ctx.physics.addMover(ctx.physics.addBox({ center: [rest.x, rest.y - thick / 2, rest.z], size: [half * 2, thick, half * 2], surface: 'moss', tag: 'unsafe' }));
  const SINK_DELAY = 0.35, SINK_SPEED = 0.42, DROP_AT = -0.26, BOTTOM = -0.9, HIDE_TIME = 2.2, RISE_TIME = 0.9;
  let state = 'idle', t = 0, y = rest.y, wob = 0;
  const clearMax = new THREE.Vector3();   // reused: "is Morel standing where the pad resurfaces?" box top
  const e = {
    type: 'sinkingPad', def, object3d: group, tags: new Set(['pad']), alive: true, radius: R, team: 'neutral', collider: col,
    get position() { return group.position; },
    get state() { return state; },
    update(dt) {
      const pl = ctx.player;
      const standing = pl && pl.body && pl.body.onGround && pl.body.ground === col;
      t += dt;
      switch (state) {
        case 'idle':
          if (standing) { state = 'loaded'; t = 0; const w = ctx.level && ctx.level.water; if (w) w.addRipple(rest.x, rest.z, 0.7); }
          break;
        case 'loaded':
          wob = Math.sin(t * 30) * 0.03 * (1 - t / SINK_DELAY);
          y = rest.y - 0.05 * (t / SINK_DELAY);
          if (t >= SINK_DELAY) { state = 'sinking'; t = 0; }
          break;
        case 'sinking':
          y -= SINK_SPEED * dt * (1 + t * 0.8);
          if (y < DROP_AT && col.enabled) col.enabled = false;
          if (y <= BOTTOM) { y = BOTTOM; state = 'hidden'; t = 0; }
          break;
        case 'hidden':
          if (t >= HIDE_TIME) { state = 'rising'; t = 0; }
          break;
        case 'rising': {
          const k = clamp(t / RISE_TIME, 0, 1);
          y = lerp(BOTTOM, rest.y, easeOutBack(k, 1.2));
          if (k >= 0.7 && !col.enabled && !(pl && playerOverlapsBox(pl, col.min, clearMax.set(col.max.x, rest.y + 1, col.max.z)))) col.enabled = true;
          if (k >= 1) { y = rest.y; state = 'idle'; t = 0; col.enabled = true; }
          break;
        }
      }
      group.position.set(rest.x, y, rest.z);
      group.rotation.x = wob; group.rotation.z = wob * 0.7;
      col.setPosition(rest.x, Math.max(y, BOTTOM) - thick / 2, rest.z);
    },
    reset() { state = 'idle'; t = 0; y = rest.y; col.enabled = true; },
    dispose(c) { c.physics.removeCollider(col); disposeGroup(group); },
  };
  e.update(0);
  return e;
}

// ---------------------------------------------------------------------------
// bounceShroom
// ---------------------------------------------------------------------------
function createBounceShroom(ctx, def) {
  const p = new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]);
  const power = def.power ?? 18;
  const CAP_TOP = 0.85, CAP_R = 1.05;
  const parts = [], glowP = [];
  parts.push({ geometry: G.cylT(0.75, 10), matrix: T(0, 0, 0, 0, 0, 0, 0.32, 0.62, 0.32), color: grad(new THREE.Color(0xd9caa4), PCOL.cream, 0, 1) });
  // cap: squashed hemisphere with an underside disc
  parts.push({ geometry: G.hemi(16), matrix: T(0, 0.52, 0, 0, 0, 0, CAP_R, CAP_TOP - 0.52 + 0.02, CAP_R), color: (px, py, pz, nx, ny, nz, out) => out.set(0xb8407a).lerp(new THREE.Color(0xe0609a), smoothstep(0.2, 0.9, ny)) });
  parts.push({ geometry: geo('discFull', () => new THREE.CircleGeometry(1, 16).rotateX(Math.PI / 2)), matrix: T(0, 0.53, 0, 0, 0, 0, CAP_R * 0.98, 1, CAP_R * 0.98), color: new THREE.Color(0x7a3a5a) });
  // glowing spots
  const r = rand(Math.floor(p.x * 7 + p.z * 3) + 9);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + r() * 0.4, d = k === 0 ? 0 : 0.45 + r() * 0.35;
    const ang = d / CAP_R * 1.2;
    const sy = 0.52 + (CAP_TOP - 0.52) * Math.cos(ang);
    glowP.push({ geometry: G.sphere(8, 5), matrix: T(Math.cos(a) * d, sy + 0.01, Math.sin(a) * d, 0, 0, 0, 0.12 + r() * 0.06, 0.05, 0.12 + r() * 0.06), color: glowColor(0x5ef2e0, 1.7) });
  }
  const built = partsMesh(ctx, parts, glowP, 0.03);
  const root = new THREE.Group();
  const squash = new THREE.Group();
  squash.add(built.group);
  root.add(squash);
  root.position.copy(p);
  const half = 0.78;
  const cap = ctx.physics.addBox({ min: [p.x - half, p.y + 0.5, p.z - half], max: [p.x + half, p.y + CAP_TOP, p.z + half], surface: 'moss', tag: 'unsafe' });
  const stem = ctx.physics.addBox({ min: [p.x - 0.25, p.y - 0.2, p.z - 0.25], max: [p.x + 0.25, p.y + 0.5, p.z + 0.25], surface: 'wood', tag: 'unsafe' });
  let sq = 0, sqV = 0, cool = 0;
  const pos = new THREE.Vector3();
  const e = {
    type: 'bounceShroom', def, object3d: root, tags: new Set(['bounce']), alive: true, radius: CAP_R, team: 'neutral', power,
    get position() { return root.position; },
    update(dt) {
      cool -= dt;
      const pl = ctx.player;
      if (cool <= 0 && pl && pl.body && pl.body.onGround && pl.body.ground === cap && pl.state !== 'dead') {
        pl.launch(power);
        cool = 0.25;
        sqV -= 9;
        pos.set(p.x, p.y + CAP_TOP + 0.1, p.z);
        ctx.particles.burst({ position: pos, count: 18, color: [0x5ef2e0, 0xff8fd0, 0xffffff], speed: 4.5, spread: 0.7, life: 0.6, size: 0.16, kind: 'glow' });
        ctx.events.emit('level:bounce', { position: pos.clone(), power });
      }
      // springy squash
      sqV += (-120 * sq - 9 * sqV) * dt;
      sq += sqV * dt;
      sq = clamp(sq, -0.45, 0.45);
      squash.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    },
    dispose(c) { c.physics.removeCollider(cap); c.physics.removeCollider(stem); disposeGroup(root); },
  };
  return e;
}

// ---------------------------------------------------------------------------
// gates (portcullis visuals shared by ironGate / eventGate / arenaLock)
// ---------------------------------------------------------------------------
function portcullisParts(size, style) {
  const [w, h, d] = size;
  const parts = [];
  const iron = style === 'iron';
  const barCol = iron ? PCOL.iron : PCOL.bark;
  const n = Math.max(3, Math.round(w / (iron ? 0.42 : 0.5)));
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + (k + 0.5) * (w / n);
    const rr = iron ? 0.07 : 0.13;
    parts.push({ geometry: G.cyl(iron ? 6 : 7), matrix: T(x, 0, 0, 0, 0, 0, rr, h, rr), color: iron ? (px, py, pz, nx, ny, nz, out) => out.copy(PCOL.iron).lerp(PCOL.ironDark, 0.4 + 0.3 * Math.sin(py * 7 + k)) : grad(PCOL.barkDark, PCOL.bark, 0, 1) });
    parts.push({ geometry: G.cone(6), matrix: T(x, h, 0, 0, 0, 0, rr * 1.6, iron ? 0.35 : 0.5, rr * 1.6), color: iron ? PCOL.ironDark : PCOL.woodTop });
  }
  const bands = iron ? [0.25, h * 0.5, h - 0.35] : [0.6, h - 0.8];
  for (const by of bands) parts.push({ geometry: G.box(), matrix: T(0, by, 0, 0, 0, 0, w, iron ? 0.14 : 0.22, d * (iron ? 0.6 : 0.8)), color: iron ? PCOL.ironDark : PCOL.barkDark });
  if (iron) {
    // rivets + a big padlock plate
    for (const by of bands) for (let k = 0; k <= n; k++) parts.push({ geometry: G.sphere(6, 4), matrix: T(-w / 2 + k * (w / n), by, d * 0.32, 0, 0, 0, 0.05), color: PCOL.rust });
    parts.push({ geometry: G.box(), matrix: T(0, h * 0.5, d * 0.35, 0, 0, 0, 0.6, 0.7, 0.1), color: PCOL.rust });
  }
  return parts;
}

/**
 * Sliding gate: hidden below ground when open, rises when closed (arena/event gates),
 * or sinks away when opened (iron gates). Returns a controller.
 */
function createGate(ctx, gdef, style, startOpen) {
  const [w, h, d] = gdef.size;
  const p = new THREE.Vector3(gdef.pos[0], gdef.pos[1], gdef.pos[2]);
  const { group } = partsMesh(ctx, portcullisParts(gdef.size, style), null, 0.03);
  group.position.copy(p);
  const col = ctx.physics.addBox({ min: [p.x - w / 2, p.y - 0.5, p.z - d / 2], max: [p.x + w / 2, p.y + h, p.z + d / 2], surface: style === 'iron' ? 'iron' : 'wood', tag: 'gate' });
  let open = !!startOpen, k = open ? 1 : 0; // k: 1 = fully open (sunk)
  col.enabled = !open;
  group.visible = !open;
  const burst = new THREE.Vector3();
  const g = {
    group, collider: col, get open() { return open; },
    set(o, instant = false) {
      if (o === open) return;
      open = o;
      col.enabled = !o;
      group.visible = true;
      if (instant) k = o ? 1 : 0;
      burst.set(p.x, p.y + 0.2, p.z);
      ctx.particles.burst({ position: burst, count: 26, color: [0x9c8a6a, 0x6b5a44], speed: 3, spread: 1, life: 0.8, size: 0.5, kind: 'puff', direction: UP, alpha: 0.6 });
      if (ctx.cameraRig && ctx.player && ctx.player.position.distanceTo(p) < 18) ctx.cameraRig.shake(0.12, 0.3);
    },
    update(dt) {
      const target = open ? 1 : 0;
      if (k !== target) {
        k = target > k ? Math.min(target, k + dt / (open ? 1.3 : 0.45)) : Math.max(target, k - dt / 0.45);
      }
      group.position.y = p.y - (h + 0.4) * smoothstep(0, 1, k);
      group.visible = k < 0.999;
      // closing gates jitter a little as they slam in
      group.position.x = p.x + (k > 0 && k < 1 ? Math.sin(ctx.time.now * 60) * 0.02 : 0);
    },
    dispose() { ctx.physics.removeCollider(col); disposeGroup(group); },
  };
  g.update(0);
  return g;
}

// ironGate ------------------------------------------------------------------
function createIronGate(ctx, def) {
  const gate = createGate(ctx, { pos: def.pos, size: def.size || [6, 5, 0.5] }, 'iron', false);
  const root = new THREE.Group();
  root.add(gate.group);
  // gate group is positioned in world space; keep the root at the origin
  const flag = def.flag ?? `gateOpen_${def.id}`;
  let hintT = 0;
  const pos = new THREE.Vector3(def.pos[0], def.pos[1] + 1.5, def.pos[2]);
  const open = () => {
    if (gate.open) return;
    gate.set(true);
    ctx.flags[flag] = true;
    ctx.particles.burst({ position: pos, count: 30, color: [0xffc35a, 0xffffff, 0x8a97a6], speed: 7, spread: 1, life: 0.6, size: 0.12, kind: 'spark', gravity: 12 });
    ctx.events.emit('gate:open', { id: def.id, position: pos.clone() });
  };
  const off = ctx.events.on('projectile:hit', (hit) => {
    if (!hit || hit.collider !== gate.collider || gate.open) return;
    if (hit.kind === 'iron') open();
    else {
      ctx.particles.burst({ position: hit.position, count: 10, color: [0xffe0a0, 0xffffff], speed: 6, life: 0.3, size: 0.1, kind: 'spark' });
      if (ctx.time.now > hintT) {
        hintT = ctx.time.now + 10;
        ctx.events.emit('ui:message', { text: 'Clang! Puffs bounce off iron. Find an Anvil Tonic!', duration: 3 });
      }
    }
  });
  const e = {
    type: 'ironGate', def, id: def.id, object3d: root, tags: new Set(['gate']), alive: true, radius: (def.size?.[0] ?? 6) / 2, team: 'neutral',
    collider: gate.collider,
    get position() { return pos; },
    get isOpen() { return gate.open; },
    open,
    update(dt) {
      if (!gate.open && ctx.flags[flag]) open();
      gate.update(dt);
    },
    reset() { gate.set(false, true); delete ctx.flags[flag]; },
    dispose() { off(); gate.dispose(); },
  };
  return e;
}

// eventGate -----------------------------------------------------------------
function createEventGate(ctx, def) {
  const gate = createGate(ctx, { pos: def.pos, size: def.size || [6, 5, 0.5] }, def.style || 'wood', def.startOpen !== false);
  const root = new THREE.Group();
  root.add(gate.group);
  const offs = [];
  const pos = new THREE.Vector3(def.pos[0], def.pos[1] + 1.5, def.pos[2]);
  if (def.closeOn) offs.push(ctx.events.on(def.closeOn, () => { if (gate.open) { gate.set(false); ctx.events.emit('gate:close', { id: def.id, position: pos.clone() }); } }));
  for (const name of [].concat(def.openOn || [])) offs.push(ctx.events.on(name, () => { if (!gate.open) { gate.set(true); ctx.events.emit('gate:open', { id: def.id, position: pos.clone() }); } }));
  return {
    type: 'eventGate', def, id: def.id, object3d: root, tags: new Set(['gate']), alive: true, radius: 3, team: 'neutral',
    collider: gate.collider,
    get position() { return pos; },
    get isOpen() { return gate.open; },
    setOpen(o) { gate.set(o); },
    update(dt) { gate.update(dt); },
    reset() { gate.set(def.startOpen !== false, true); },
    dispose() { for (const o of offs) o(); gate.dispose(); },
  };
}

// arenaLock -----------------------------------------------------------------
function createArenaLock(ctx, def) {
  const root = new THREE.Group();
  const gates = (def.gates || []).map((g) => createGate(ctx, g, g.style || 'wood', true));
  for (const g of gates) root.add(g.group);
  const waves = def.waves || [];
  let state = 'idle', wave = -1, alive = [], delay = 0, pendingReset = false;
  const pos = new THREE.Vector3(...(def.pos || [0, 0, 0]));
  const flag = def.flag ?? `arenaClear_${def.id}`;
  const pop = new THREE.Vector3();
  const spawnWave = (i) => {
    wave = i;
    alive = [];
    for (const sd of waves[i]) {
      const d = JSON.parse(JSON.stringify(sd));
      d.arena = def.id;
      const ent = ctx.entities.spawn(d);
      if (ent) alive.push(ent);
      pop.set(d.pos[0], d.pos[1] + 0.6, d.pos[2]);
      ctx.particles.burst({ position: pop, count: 16, color: [0x9c8a6a, 0xd9c49a], speed: 3, spread: 1, life: 0.7, size: 0.45, kind: 'puff', alpha: 0.7 });
    }
    ctx.events.emit('arena:wave', { id: def.id, wave: i, count: alive.length });
  };
  const resetArena = () => {
    for (const ent of alive) if (ent && ent.alive) ctx.entities.remove(ent);
    alive = [];
    wave = -1; state = 'idle'; delay = 0;
    for (const g of gates) g.set(true);
    ctx.events.emit('arena:reset', { id: def.id });
  };
  const offs = [
    ctx.events.on('player:died', () => { if (state === 'locked') pendingReset = true; }),
    // any checkpoint respawn while locked (a death, or the pause menu's "Restart from checkpoint",
    // which leaves Morel outside the closed gates) puts the ambush back to idle
    ctx.events.on('player:respawn', (p) => { if ((pendingReset || state === 'locked') && p && p.checkpointId) { pendingReset = false; resetArena(); } }),
  ];
  const e = {
    type: 'arenaLock', def, id: def.id, object3d: root, tags: new Set(['arena']), alive: true, radius: 1, team: 'neutral',
    get position() { return pos; },
    get state() { return state; },
    get wave() { return wave; },
    get enemies() { return alive; },
    gates,
    update(dt) {
      for (const g of gates) g.update(dt);
      const pl = ctx.player;
      if (state === 'idle') {
        if (pl && pl.state !== 'dead' && inBounds(pl.position, def.bounds) && waves.length) {
          state = 'locked';
          for (const g of gates) g.set(false);
          ctx.events.emit('arena:lock', { id: def.id });
          delay = 0.6;
          wave = -1;
        }
      } else if (state === 'locked' && !pendingReset) {
        if (delay > 0) { delay -= dt; if (delay <= 0) spawnWave(wave + 1); return; }
        if (wave >= 0 && alive.every(isDefeated)) {
          if (wave + 1 < waves.length) delay = 1.2;   // short breather, then the next wave
          else {
            state = 'cleared';
            for (const g of gates) g.set(true);
            ctx.flags[flag] = true;
            ctx.events.emit('arena:clear', { id: def.id });
            ctx.events.emit('ui:message', { text: 'Ambush beaten! The gates swing open.', duration: 3 });
          }
        }
      }
    },
    reset() { resetArena(); delete ctx.flags[flag]; for (const g of gates) g.set(true, true); },
    dispose() { for (const o of offs) o(); for (const g of gates) g.dispose(); },
  };
  return e;
}

// ---------------------------------------------------------------------------
// sign
// ---------------------------------------------------------------------------
function signTexture(M, title, text) {
  return M.canvasTexture(512, 320, (g, w, h) => {
    // planks
    g.fillStyle = '#c9a571'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k % 2 ? 'rgba(120,80,40,0.10)' : 'rgba(255,240,200,0.08)';
      g.fillRect(0, k * h / 4, w, h / 4);
      g.fillStyle = 'rgba(70,40,20,0.55)'; g.fillRect(0, k * h / 4, w, 3);
    }
    g.strokeStyle = 'rgba(90,55,25,0.25)'; g.lineWidth = 2;
    for (let k = 0; k < 18; k++) { const y = 10 + k * 17; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 5, w * 0.6, y - 5, w, y + 2); g.stroke(); }
    g.strokeStyle = '#5a3a1e'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#5a1f1f';
    g.font = 'bold 44px Georgia, "Times New Roman", serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(title || '', w / 2, 22);
    g.fillStyle = 'rgba(90,31,31,0.6)'; g.fillRect(w / 2 - 150, 74, 300, 3);
    g.fillStyle = '#2e1c0e';
    g.font = '30px Georgia, "Times New Roman", serif';
    const lines = String(text || '').split('\n');
    lines.forEach((ln, i) => g.fillText(ln, w / 2, 96 + i * 44));
  });
}

const SIGN = { BW: 1.9, BH: 1.2, BY: 1.15 };
/** Signpost geometry in local space (yaw 0: the face points -Z, read while walking +Z). */
export function signParts() {
  const { BW, BH, BY } = SIGN;
  const parts = [];
  for (const sx of [-0.75, 0.75]) parts.push({ geometry: G.cyl(6), matrix: T(sx, -0.4, 0.1, 0, 0, 0, 0.07, BY + BH + 0.55, 0.07), color: grad(PCOL.barkDark, PCOL.bark, 0, 0.5) });
  parts.push({ geometry: G.box(), matrix: T(0, BY + BH / 2, 0, 0, 0, 0, BW + 0.12, BH + 0.12, 0.1), color: PCOL.barkDark });
  parts.push({ geometry: G.cone(4), matrix: T(0, BY + BH + 0.06, 0, Math.PI / 4, 0, 0, 0.18, 0.2, 0.18), color: PCOL.bark });
  const glow = [{ geometry: G.sphere(8, 6), matrix: T(0, BY + BH + 0.32, 0.02, 0, 0, 0, 0.1), color: glowColor(0xffc35a, 2.0) }];
  return { parts, glow };
}

function createSign(ctx, def) {
  const M = ctx.materials;
  const root = new THREE.Group();
  root.position.fromArray(def.pos);
  root.rotation.y = def.yaw ?? 0;
  const { BW, BH, BY } = SIGN;
  // def.baked: the builder already merged post + board into the static level geometry
  if (!def.baked) {
    const sp = signParts();
    root.add(partsMesh(ctx, sp.parts, sp.glow, 0.025).group);
  }
  const tex = signTexture(M, def.title, def.text);
  const faceMat = M.toon(0xffffff, { map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), faceMat);
  face.position.set(0, BY + BH / 2, -0.056);
  face.rotation.y = Math.PI;
  face.receiveShadow = true;
  root.add(face);
  // back of the board shows plain planks (the face plane is one-sided)
  const message = def.toast ?? `${def.title ? def.title + ': ' : ''}${String(def.text || '').replace(/\n/g, ' ')}`;
  let shown = false;
  return {
    type: 'sign', def, object3d: root, tags: new Set(['sign']), alive: true, radius: 0.6, team: 'neutral',
    get position() { return root.position; },
    update() {
      const pl = ctx.player;
      if (!pl) return;
      const p = pl.position, s = root.position;
      const dx = p.x - s.x, dz = p.z - s.z, d2 = dx * dx + dz * dz;
      if (!shown && d2 < 3.4 * 3.4 && Math.abs(p.y - s.y) < 2.5) {
        shown = true;
        ctx.events.emit('ui:message', { text: message, duration: def.duration ?? 5, source: 'sign' });
      } else if (shown && d2 > 7 * 7) shown = false;
    },
    reset() { shown = false; },
    dispose() { disposeGroup(root); face.geometry.dispose(); faceMat.dispose(); tex.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// zoneTrigger
// ---------------------------------------------------------------------------
function createZoneTrigger(ctx, def) {
  const root = new THREE.Group();
  root.position.fromArray(def.pos || [0, 0, 0]);
  let inside = false;
  return {
    type: 'zoneTrigger', def, id: def.id, object3d: root, tags: new Set(['zone']), alive: true, radius: 0, team: 'neutral',
    get position() { return root.position; },
    get inside() { return inside; },
    update() {
      const pl = ctx.player;
      if (!pl) return;
      const now = inBounds(pl.position, def.bounds);
      if (now && !inside) {
        if (ctx.level && !ctx.level.isStub) ctx.level.zone = def.id;
        ctx.events.emit('zone:enter', { id: def.id, name: def.name });
      }
      inside = now;
    },
    reset() { inside = false; },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// hazard (thorns)
// ---------------------------------------------------------------------------
/** Bramble geometry in local space for a thorns patch of `size`. */
export function hazardParts(def) {
  const size = def.size || [2, 1, 2];
  const r = rand(Math.floor(def.pos[0] * 11 + def.pos[2] * 5) + 1);
  const parts = [], glowP = [];
  const vine = new THREE.Color(0x4a2238), vineDark = new THREE.Color(0x2c1424), spike = new THREE.Color(0xe8d8c0);
  const nv = Math.max(4, Math.round(size[0] * size[2] * 1.6));
  for (let k = 0; k < nv; k++) {
    const pts = [];
    const x0 = (r() - 0.5) * size[0], z0 = (r() - 0.5) * size[2];
    const a = r() * Math.PI * 2;
    for (let j = 0; j < 5; j++) {
      const t = j / 4;
      pts.push(new THREE.Vector3(x0 + Math.cos(a + t * 3) * 0.5 * t, Math.sin(t * Math.PI) * size[1] * (0.6 + r() * 0.5), z0 + Math.sin(a + t * 3) * 0.5 * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tg = new THREE.TubeGeometry(curve, 8, 0.06, 5, false); tg.userData.disposable = true;
    parts.push({ geometry: tg, matrix: new THREE.Matrix4(), color: grad(vineDark, vine, 0, size[1]) });
    for (let s = 0; s < 6; s++) {
      const q = curve.getPoint(0.1 + s * 0.15), tn = curve.getTangent(0.1 + s * 0.15);
      const side = new THREE.Vector3(-tn.z, 0.4, tn.x).normalize().multiplyScalar(s % 2 ? 1 : -1);
      const m = new THREE.Matrix4().compose(q, new THREE.Quaternion().setFromUnitVectors(UP, side), new THREE.Vector3(0.035, 0.2, 0.035));
      parts.push({ geometry: G.cone(4), matrix: m, color: spike });
    }
    if (r() < 0.5) glowP.push({ geometry: G.sphere(6, 4), matrix: T(pts[2].x, pts[2].y + 0.05, pts[2].z, 0, 0, 0, 0.07), color: glowColor(0xff3a5a, 1.1) });
  }
  return { parts, glow: glowP };
}

function createHazard(ctx, def) {
  const size = def.size || [2, 1, 2];
  const p = new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]);
  let group;
  if (def.baked) group = new THREE.Group();
  else { const hp = hazardParts(def); group = partsMesh(ctx, hp.parts, hp.glow, 0.02).group; }
  group.position.copy(p);
  const min = new THREE.Vector3(p.x - size[0] / 2, p.y - 0.2, p.z - size[2] / 2);
  const max = new THREE.Vector3(p.x + size[0] / 2, p.y + size[1], p.z + size[2] / 2);
  const src = new THREE.Vector3();
  return {
    type: 'hazard', def, kind: def.kind || 'thorns', object3d: group, tags: new Set(['hazard']), alive: true, radius: Math.max(size[0], size[2]) / 2, team: 'neutral',
    bounds: { min, max },
    get position() { return group.position; },
    update() {
      const pl = ctx.player;
      if (!pl || pl.state === 'dead' || pl.invulnerable) return;
      if (playerOverlapsBox(pl, min, max, -0.05)) {
        // knock away from the nearest point of the patch centre line
        src.set(clamp(pl.position.x, p.x - size[0] * 0.3, p.x + size[0] * 0.3), pl.position.y, clamp(pl.position.z, p.z - size[2] * 0.3, p.z + size[2] * 0.3));
        if (src.distanceToSquared(pl.position) < 1e-4) src.set(p.x, pl.position.y, p.z - 1);
        if (pl.damage(1, src)) ctx.particles.burst({ position: pl.position, count: 10, color: [0x4a2238, 0xe8d8c0], speed: 3, life: 0.4, size: 0.12, kind: 'spark' });
      }
    },
    dispose() { disposeGroup(group); },
  };
}

// ---------------------------------------------------------------------------
export const MECHANISM_TYPES = {
  movingPlatform: createMovingPlatform,
  sinkingPad: createSinkingPad,
  bounceShroom: createBounceShroom,
  ironGate: createIronGate,
  eventGate: createEventGate,
  arenaLock: createArenaLock,
  sign: createSign,
  zoneTrigger: createZoneTrigger,
  hazard: createHazard,
};

/** Register every level-area entity type (idempotent). */
export function installMechanisms(ctx) {
  for (const [name, fn] of Object.entries(MECHANISM_TYPES)) ctx.entities.registerType(name, fn);
}
