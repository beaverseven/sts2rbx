// Generic pooled projectile system (spore puffs, iron balls, seeker puffs, enemy mud balls).
//   ctx.projectiles.spawn({ team, kind, position, velocity, damage, radius, life, gravity=0,
//                           homing: entity|null, homingStrength, heavy:false, mesh?, range?, owner?, group? })
import * as THREE from 'three';

const KIND_STYLE = {
  puff: { color: 0x5ef2e0, trail: 0x5ef2e0, burst: [0x5ef2e0, 0xc8fff8], halo: 3.4 },
  seeker: { color: 0xff5fb2, trail: 0xff5fb2, burst: [0xff5fb2, 0xffc2e4], halo: 3.2 },
  iron: { color: 0x4a5260, trail: 0xffb35a, burst: [0xffc35a, 0xff8a3a], halo: 0 },
  mud: { color: 0x6b4a2e, trail: 0x5a3e2b, burst: [0x6b4a2e, 0x8a6a40], halo: 0 },
};
const MAX_ACTIVE = 128;

export function createProjectiles(ctx) {
  const { scene, materials, particles, events } = ctx;
  const group = new THREE.Group();
  group.name = 'projectiles';
  scene.add(group);

  const active = [];
  const freeRecords = [];
  const pools = { puff: [], seeker: [], iron: [], mud: [] };
  const unitSphere = new THREE.IcosahedronGeometry(1, 2);
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const haloTex = materials.softDotTexture();
  const mats = {
    puff: materials.glow(KIND_STYLE.puff.color, 2.6),
    seeker: materials.glow(KIND_STYLE.seeker.color, 2.6),
    iron: materials.toon(0x55606e, { emissive: 0x111418 }),
    mud: materials.toon(KIND_STYLE.mud.color),
  };
  const haloMats = {
    puff: new THREE.SpriteMaterial({ map: haloTex, color: KIND_STYLE.puff.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75, fog: false }),
    seeker: new THREE.SpriteMaterial({ map: haloTex, color: KIND_STYLE.seeker.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75, fog: false }),
  };

  function buildMesh(kind) {
    const root = new THREE.Group();
    root.name = `projectile-${kind}`;
    if (kind === 'puff' || kind === 'seeker') {
      const core = new THREE.Mesh(unitSphere, mats[kind]);
      core.scale.setScalar(0.62);
      root.add(core);
      const halo = new THREE.Sprite(haloMats[kind]);
      halo.scale.setScalar(KIND_STYLE[kind].halo);
      root.add(halo);
      root.userData.halo = halo;
    } else if (kind === 'iron') {
      const ball = new THREE.Mesh(unitSphere, mats.iron);
      ball.castShadow = true;
      materials.outline(ball, 0.12);
      root.add(ball);
      // rivet band so the spin reads
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 6, 18), materials.shared(0x8a97a6));
      band.rotation.x = Math.PI / 2;
      ball.add(band);
      root.userData.spinner = ball;
    } else {
      const blob = new THREE.Mesh(blobGeo, mats.mud);
      blob.castShadow = true;
      materials.outline(blob, 0.1);
      root.add(blob);
      root.userData.spinner = blob;
    }
    return root;
  }

  function obtainMesh(kind) {
    const pool = pools[kind];
    const m = pool.length ? pool.pop() : buildMesh(kind);
    m.visible = true;
    group.add(m);
    return m;
  }
  function releaseMesh(p) {
    if (!p.mesh) return;
    group.remove(p.mesh);
    if (p.pooled) pools[p.kind].push(p.mesh);
    p.mesh = null;
  }

  const _dir = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _step = new THREE.Vector3();
  const _cap = new THREE.Vector3();
  const _zero = new THREE.Vector3();
  const _jet = new THREE.Vector3();
  const GLOW_TRAIL = { color: 0, life: 0.22, size: 0.4, kind: 'glow', intensity: 1.5 };
  const SPARK_TRAIL = { color: 0, life: 0.3, size: 0.09, kind: 'spark', gravity: 8 };
  const MUD_TRAIL = { color: 0, life: 0.4, size: 0.2, kind: 'puff', gravity: 6, alpha: 0.7 };

  /**
   * Fire a projectile. Required: team ('player'|'enemy'|'neutral'), position, velocity (Vector3).
   * Optional: kind ('puff'|'iron'|'seeker'|'mud', default 'puff'), damage=1, radius=0.25, life=2,
   * range (m, default Infinity), gravity=0 (m/s² downward), homing (entity), homingStrength (rad/s, 6),
   * heavy=false, mesh (custom Object3D, not pooled), owner, group (volley id), charge (0..1).
   * Returns the projectile record (fields: position, velocity, alive, ...).
   */
  function spawn(o) {
    if (active.length >= MAX_ACTIVE) end(active[0], false);
    const p = freeRecords.pop() || { position: new THREE.Vector3(), velocity: new THREE.Vector3(), origin: new THREE.Vector3() };
    p.alive = true;
    p.team = o.team || 'neutral';
    p.kind = KIND_STYLE[o.kind] ? o.kind : 'puff';
    p.position.copy(o.position);
    p.origin.copy(o.position);
    p.velocity.copy(o.velocity);
    p.damage = o.damage ?? 1;
    p.radius = o.radius ?? 0.25;
    p.life = o.life ?? 2;
    p.range = o.range ?? Infinity;
    p.gravity = o.gravity ?? 0;
    p.homing = o.homing || null;
    p.homingStrength = o.homingStrength ?? 6;
    p.heavy = !!o.heavy;
    p.owner = o.owner || null;
    p.group = o.group ?? null;
    p.charge = o.charge ?? 0;
    p.age = 0;
    p.traveled = 0;
    p.trailAcc = 0;
    if (o.mesh) { p.mesh = o.mesh; p.pooled = false; group.add(p.mesh); }
    else { p.mesh = obtainMesh(p.kind); p.pooled = true; }
    p.mesh.position.copy(p.position);
    p.mesh.scale.setScalar(p.radius);
    active.push(p);
    return p;
  }

  function end(p, burstKind) {
    if (!p.alive) return;
    p.alive = false;
    releaseMesh(p);
    const i = active.indexOf(p);
    if (i >= 0) active.splice(i, 1);
    p.homing = null; p.owner = null;
    freeRecords.push(p);
    if (burstKind === 'impact') impactBurst(p);
    else if (burstKind === 'fizzle') particles.burst({ position: p.position, count: 6, color: KIND_STYLE[p.kind].burst, speed: 1.2, life: 0.35, size: p.radius * 1.4, kind: 'puff' });
    else if (burstKind === 'splash') particles.burst({ position: p.position, count: 10, color: [0x2f5a4a, 0x8fb8a8], speed: 3, spread: 0.5, life: 0.5, size: 0.25, gravity: 9, kind: 'puff' });
  }

  function impactBurst(p) {
    const st = KIND_STYLE[p.kind];
    const scale = 0.6 + p.radius * 1.6;
    if (p.kind === 'iron') {
      particles.burst({ position: p.position, count: 20, color: st.burst, speed: 7, life: 0.45, size: 0.12, kind: 'spark' });
      particles.burst({ position: p.position, count: 6, color: 0x9aa3ad, speed: 1.5, life: 0.5, size: 0.5, kind: 'puff' });
    } else if (p.kind === 'mud') {
      particles.burst({ position: p.position, count: 12, color: st.burst, speed: 3.5, life: 0.5, size: 0.28, gravity: 10, kind: 'puff' });
    } else {
      particles.burst({ position: p.position, count: Math.round(12 * scale), color: st.burst, speed: 4 * scale, life: 0.45, size: 0.22 * scale, kind: 'glow' });
      particles.burst({ position: p.position, count: 5, color: 0xe8fffb, speed: 1.2, life: 0.4, size: 0.45 * scale, kind: 'puff', alpha: 0.5 });
    }
  }

  function hitTargetFor(p) {
    // returns entity/player overlapping the projectile, or null
    const r = p.radius;
    if (p.team !== 'enemy') {
      const list = ctx.entities.list;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || !e.hurt || e.hittable === false || e.team === 'player' || e === p.owner) continue;
        if (p.team === 'neutral' && e.team === 'neutral') continue;
        ctx.entities.closestAxisPoint(e, p.position, _cap);
        const rr = r + (e.radius || 0.5);
        if (_cap.distanceToSquared(p.position) < rr * rr) return e;
      }
    }
    if (p.team !== 'player') {
      const pl = ctx.player;
      if (pl && pl.state !== 'dead' && pl.visible !== false) {
        const pos = pl.position;
        const y = Math.max(pos.y, Math.min(p.position.y, pos.y + pl.height));
        _cap.set(pos.x, y, pos.z);
        const rr = r + pl.radius;
        if (_cap.distanceToSquared(p.position) < rr * rr) return pl;
      }
    }
    return null;
  }

  function onEntityHit(p, target) {
    _dir.copy(p.velocity).normalize();
    let landed;
    if (target === ctx.player) {
      landed = ctx.player.damage(p.damage, p.position);
    } else {
      landed = target.hurt(p.damage, {
        kind: p.kind, heavy: p.heavy, from: p.origin.clone(), dir: _dir.clone(), source: p, charge: p.charge, team: p.team,
      });
    }
    const deflected = landed === false && target !== ctx.player;
    events.emit('projectile:hit', { position: p.position.clone(), target, damage: p.damage, kind: p.kind, deflected });
    if (deflected) {
      particles.burst({ position: p.position, count: 14, color: [0xffe0a0, 0xffffff], speed: 6, life: 0.3, size: 0.1, kind: 'spark' });
      end(p, false);
    } else end(p, 'impact');
  }

  function update(dt) {
    const water = ctx.physics.waterLevel;
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      if (!p || !p.alive) continue;
      p.age += dt;

      // homing: rotate velocity toward the target's centre
      if (p.homing) {
        const h = p.homing;
        if (!h.alive || (h.state === 'dead')) p.homing = null;
        else {
          const hp = h.position || h.object3d.position;
          _to.set(hp.x, hp.y + (h.height ?? (h.radius || 0.5) * 2) * 0.5, hp.z).sub(p.position);
          const speed = p.velocity.length();
          if (speed > 0.01 && _to.lengthSq() > 1e-4) {
            _to.normalize();
            _dir.copy(p.velocity).multiplyScalar(1 / speed);
            const t = Math.min(1, p.homingStrength * dt);
            _dir.lerp(_to, t).normalize();
            p.velocity.copy(_dir).multiplyScalar(speed);
          }
        }
      }
      if (p.gravity) p.velocity.y -= p.gravity * dt;

      // substepped move + collision
      const dist = p.velocity.length() * dt;
      const n = Math.max(1, Math.ceil(dist / Math.max(0.1, p.radius * 0.8)));
      _step.copy(p.velocity).multiplyScalar(dt / n);
      let done = false;
      for (let s = 0; s < n && !done; s++) {
        p.position.add(_step);
        const target = hitTargetFor(p);
        if (target) { onEntityHit(p, target); done = true; break; }
        const w = ctx.physics.sphereHitsWorld(p.position, p.radius * 0.8);
        if (w) {
          events.emit('projectile:hit', { position: p.position.clone(), target: null, damage: p.damage, kind: p.kind, collider: w });
          end(p, 'impact'); done = true; break;
        }
        if (p.position.y < water) {
          events.emit('projectile:hit', { position: p.position.clone(), target: null, damage: p.damage, kind: p.kind, collider: 'water' });
          end(p, 'splash'); done = true; break;
        }
      }
      if (done) continue;
      p.traveled += dist;
      if (p.age >= p.life || p.traveled >= p.range) { end(p, 'fizzle'); continue; }

      // visuals
      const m = p.mesh;
      m.position.copy(p.position);
      const pulse = 1 + Math.sin(p.age * 30) * 0.08;
      m.scale.setScalar(p.radius * pulse);
      if (m.userData.spinner) {
        m.userData.spinner.rotation.x += dt * 14;
        m.userData.spinner.rotation.z += dt * 6;
      }
      p.trailAcc += dt;
      const st = KIND_STYLE[p.kind];
      if (p.kind === 'puff' || p.kind === 'seeker') {
        _jet.copy(p.velocity).multiplyScalar(-0.05);
        GLOW_TRAIL.color = st.trail; GLOW_TRAIL.size = p.radius * 1.9;
        particles.spawn(p.position, _jet, GLOW_TRAIL);
      } else if (p.trailAcc > 0.05) {
        p.trailAcc = 0;
        if (p.kind === 'iron') {
          _jet.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
          SPARK_TRAIL.color = st.trail;
          particles.spawn(p.position, _jet, SPARK_TRAIL);
        } else {
          MUD_TRAIL.color = st.trail; MUD_TRAIL.size = p.radius * 0.8;
          particles.spawn(p.position, _zero, MUD_TRAIL);
        }
      }
    }
  }

  return {
    group, active,
    spawn, update,
    /** Number of live projectiles matching filter(p). */
    count(filter) { let c = 0; for (const p of active) if (!filter || filter(p)) c++; return c; },
    /** Remove a projectile (optionally with its impact burst). */
    kill(p, withBurst = true) { end(p, withBurst ? 'impact' : false); },
    clear() { for (let i = active.length - 1; i >= 0; i--) end(active[i], false); },
  };
}
