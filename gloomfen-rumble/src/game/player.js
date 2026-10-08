// Morel — the hero. Procedural model (primitives + canvas textures), procedural
// animation and the full platformer controller (run, jump, glide, throw/charge,
// lock-on strafe, health, water, death, tonics).
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, dampAngle, approach, angleDelta, easeOutBack, hash2 } from '../core/mathx.js';

export const TUNING = {
  // locomotion
  runSpeed: 8.5, strafeSpeed: 7.0, groundAccel: 70, groundDecel: 80, airAccel: 28, airDrag: 3,
  turnLambda: 16, chargeMoveScale: 0.8,
  // jumping
  jumpVelocity: 11.5, gravityUp: 32, gravityDown: 48, jumpCut: 0.55, coyoteTime: 0.12, jumpBuffer: 0.12,
  maxFallSpeed: 40,
  // glide / updraft
  glideFallSpeed: 2.4, glideMaxSpeed: 7.5, glideCatch: 45, updraftSpeed: 6, updraftAccel: 30, updraftMaxRise: 30,
  // throwing
  throwCooldown: 0.22, chargeTime: 0.9, quickCharge: 0.2, maxPuffs: 3,
  puff: { damage: 1, speed: 26, range: 18, radius: 0.26 },
  charged: { damage: 3, speed: 32, range: 26, radius: 0.48 },
  iron: { damage: 3, chargedDamage: 4, speed: 24, range: 20, radius: 0.3, gravity: 2.5 },
  seeker: { damage: 1, chargedDamage: 2, speed: 20, range: 30, radius: 0.2, spread: 0.45, homing: 5 },
  aimAssistCone: 25 * Math.PI / 180, aimAssistRange: 22, aimAssistHoming: 5, aimAssistInitial: 0.35, lockHoming: 8,
  // lock-on
  lockRange: 22, lockKeepRange: 30, lockCone: 75 * Math.PI / 180,
  // health
  maxHp: 5, invulnTime: 1.3, knockback: 7, knockbackUp: 6, hurtStun: 0.35,
  waterMargin: 0.3, killY: -30, fallRespawnDelay: 0.7, deathTime: 1.4,
  // body
  radius: 0.32, height: 1.05,
  tonicDuration: 20,
};

const TONIC_COLORS = { anvil: 0x9aa7b8, updraft: 0x8ef06a, seeker: 0xff5fb2 };

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const CELLS_U = 9, CELLS_V = 5;
let _f1 = 0, _f2 = 0;
/** Periodic (in u) cellular noise -> sets _f1/_f2. u,v in [0,1]. */
function cellular(u, v) {
  const x = u * CELLS_U, y = v * CELLS_V * 1.0;
  const ix = Math.floor(x), iy = Math.floor(y);
  _f1 = 9; _f2 = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const wx = ((cx % CELLS_U) + CELLS_U) % CELLS_U;
      const px = cx + 0.15 + 0.7 * hash2(wx, cy);
      const py = cy + 0.15 + 0.7 * hash2(wx + 101, cy + 37);
      const dx = x - px, dy = (y - py) * 1.15;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < _f1) { _f2 = _f1; _f1 = d; } else if (d < _f2) _f2 = d;
    }
  }
}

function buildCapGeometry() {
  const pts = [new THREE.Vector2(0.17, -0.02)];
  const N = 24;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const r = 0.275 * Math.pow(1 - t, 0.55) * (1 + 0.13 * Math.sin(t * Math.PI)) + (t < 1 ? 0 : 0);
    pts.push(new THREE.Vector2(Math.max(0, r), 0.02 + t * 0.6));
  }
  const segs = 40;
  const geo = new THREE.LatheGeometry(pts, segs);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  // honeycomb pits: push vertices inward along the normal inside each cell
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.02 || y < 0.03) continue;
    cellular(u, v);
    const pit = THREE.MathUtils.smoothstep(_f2 - _f1, 0.03, 0.4);
    const depth = 0.024 * pit * Math.min(1, r / 0.12);
    pos.setXYZ(i, x - nor.getX(i) * depth, y - nor.getY(i) * depth * 0.5, z - nor.getZ(i) * depth);
  }
  geo.computeVertexNormals();
  // weld the lathe seam normals
  const P = pts.length;
  for (let j = 0; j < P; j++) {
    const a = j, b = segs * P + j;
    const nx = nor.getX(a) + nor.getX(b), ny = nor.getY(a) + nor.getY(b), nz = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l); nor.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return geo;
}

function drawCapTexture(g, w, h) {
  const img = g.createImageData(w, h);
  const ridge = [232, 190, 112], ridgeHi = [255, 228, 160], pitA = [150, 88, 34], pitB = [70, 36, 14];
  for (let py = 0; py < h; py++) {
    const v = 1 - (py + 0.5) / h;
    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      cellular(u, v);
      const e = _f2 - _f1;
      const pit = THREE.MathUtils.smoothstep(e, 0.03, 0.15);
      const deep = THREE.MathUtils.smoothstep(e, 0.15, 0.6);
      const hi = 1 - THREE.MathUtils.smoothstep(e, 0.0, 0.05);
      const k = (py * w + px) * 4;
      for (let c = 0; c < 3; c++) {
        let col = lerp(ridge[c], pitA[c], pit);
        col = lerp(col, pitB[c], deep);
        col = lerp(col, ridgeHi[c], hi * 0.6);
        img.data[k + c] = col;
      }
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function buildStalkGeometry() {
  const prof = [
    [0.0, 0.08], [0.12, 0.085], [0.18, 0.11], [0.205, 0.16], [0.212, 0.23], [0.205, 0.31],
    [0.193, 0.4], [0.186, 0.48], [0.186, 0.56], [0.15, 0.6], [0.0, 0.61],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(prof, 28);
}

function buildLeafGeometry() {
  // dock leaf: long oval with a pointed tip, domed like a parasol (convex up)
  const shape = new THREE.Shape();
  const L = 0.66, W = 0.46;
  shape.moveTo(0, -L);
  shape.bezierCurveTo(W * 0.9, -L * 0.85, W * 1.1, -L * 0.1, W * 0.75, L * 0.45);
  shape.bezierCurveTo(W * 0.5, L * 0.8, W * 0.15, L * 0.95, 0, L * 1.15);
  shape.bezierCurveTo(-W * 0.15, L * 0.95, -W * 0.5, L * 0.8, -W * 0.75, L * 0.45);
  shape.bezierCurveTo(-W * 1.1, -L * 0.1, -W * 0.9, -L * 0.85, 0, -L);
  const geo = new THREE.ShapeGeometry(shape, 18);
  // ShapeGeometry lies in XY; turn into XZ and dome it
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const d2 = (x / W) * (x / W) * 0.8 + (y / L) * (y / L);
    const wave = Math.sin(y * 9) * 0.014 * Math.abs(x / W);
    pos.setXYZ(i, x, -0.26 * d2 + wave, -y);
    uv.setXY(i, x / (2 * W) + 0.5, y / (2.3 * L) + 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

function drawLeafTexture(g, w, h) {
  g.fillStyle = '#5ea13c'; g.fillRect(0, 0, w, h);
  // soft mottling
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${40 + Math.random() * 30},${110 + Math.random() * 40},${30 + Math.random() * 20},0.25)`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 18, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = '#a8dc74'; g.lineCap = 'round';
  g.lineWidth = 7; g.beginPath(); g.moveTo(w / 2, h * 0.02); g.lineTo(w / 2, h * 0.98); g.stroke();
  g.lineWidth = 3;
  for (let k = 0; k < 9; k++) {
    const y = h * (0.12 + k * 0.095);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(w / 2, y);
      g.quadraticCurveTo(w / 2 + s * w * 0.22, y - h * 0.03, w / 2 + s * w * 0.46, y - h * 0.11); g.stroke();
    }
  }
}

function buildMorel(ctx) {
  const M = ctx.materials;
  const pal = M.palette;
  const mats = [];
  const toon = (c, o) => { const m = M.toon(c, o); mats.push(m); return m; };

  const root = new THREE.Group(); root.name = 'morel';
  const visual = new THREE.Group(); visual.name = 'morel-visual';
  root.add(visual);

  // --- stalk body
  const stalkMat = toon(pal.cream);
  const body = new THREE.Mesh(buildStalkGeometry(), stalkMat);
  body.name = 'stalk';
  visual.add(body);

  // --- cap
  const capTex = M.canvasTexture(256, 256, drawCapTexture);
  const capMat = toon(0xffffff, { map: capTex });
  const capPivot = new THREE.Group(); capPivot.position.y = 0.52; visual.add(capPivot);
  const cap = new THREE.Mesh(buildCapGeometry(), capMat);
  cap.name = 'cap';
  capPivot.add(cap);

  // --- face (on the stalk, just under the brim)
  const eyeMat = toon(0x15102a);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeGeo = new THREE.SphereGeometry(0.062, 16, 12);
  const glintGeo = new THREE.SphereGeometry(0.019, 8, 6);
  const eyes = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.074, 0.44, 0.158);
    pivot.rotation.y = s * 0.36;
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(0.9, 1.3, 0.62);
    pivot.add(eye);
    const g1 = new THREE.Mesh(glintGeo, glintMat); g1.position.set(s * 0.018, 0.035, 0.034); g1.userData.noOutline = true;
    const g2 = new THREE.Mesh(glintGeo, glintMat); g2.scale.setScalar(0.5); g2.position.set(-s * 0.014, -0.022, 0.036); g2.userData.noOutline = true;
    pivot.add(g1, g2);
    visual.add(pivot);
    eyes.push(pivot);
  }
  const mouthMat = toon(0x3a1630);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 6, 12, Math.PI), mouthMat);
  mouth.position.set(0, 0.355, 0.183);
  mouth.rotation.set(0.25, 0, Math.PI);
  mouth.userData.noOutline = true;
  visual.add(mouth);
  const blushMat = toon(0xf0a2a0);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), blushMat);
    b.scale.set(1.3, 0.75, 0.35);
    b.position.set(s * 0.13, 0.375, 0.15);
    b.rotation.y = s * 0.7;
    b.userData.noOutline = true;
    visual.add(b);
  }

  // --- scarf (ring + knot; tails are simulated in world space)
  const scarfMat = toon(pal.scarf);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.052, 10, 28), scarfMat);
  scarf.rotation.x = Math.PI / 2;
  scarf.scale.set(1, 1, 0.85);
  scarf.position.y = 0.3;
  visual.add(scarf);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), scarfMat);
  knot.position.set(0.05, 0.3, -0.21);
  visual.add(knot);

  // --- arms (pivot at the shoulder; mitten hand at the end)
  const armGeo = new THREE.CapsuleGeometry(0.045, 0.09, 4, 10);
  const handGeo = new THREE.SphereGeometry(0.056, 12, 10);
  const arms = [];
  for (const s of [-1, 1]) {           // s = +1 left (+X), -1 right (-X) when facing +Z
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.175, 0.255, 0.0);
    const arm = new THREE.Mesh(armGeo, stalkMat);
    arm.position.y = -0.075;
    shoulder.add(arm);
    const hand = new THREE.Mesh(handGeo, stalkMat);
    hand.position.y = -0.15;
    shoulder.add(hand);
    visual.add(shoulder);
    arms.push({ shoulder, hand, side: s });
  }
  const armR = arms.find((a) => a.side === -1); // right arm (-X): throwing / parasol arm
  const armL = arms.find((a) => a.side === 1);

  // --- legs
  const legGeo = new THREE.CapsuleGeometry(0.05, 0.05, 4, 10);
  const footGeo = new THREE.SphereGeometry(0.07, 12, 10);
  const footMat = toon(0xd9c296);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.085, 0.13, 0);
    const leg = new THREE.Mesh(legGeo, stalkMat);
    leg.position.y = -0.045;
    hip.add(leg);
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.scale.set(0.85, 0.62, 1.25);
    foot.position.set(0, -0.092, 0.025);
    hip.add(foot);
    visual.add(hip);
    legs.push({ hip, side: s });
  }

  // --- charge orb (in the right hand)
  const orb = new THREE.Group();
  orb.position.y = -0.17;
  armR.shoulder.add(orb);
  const orbMat = M.glow(pal.glowCyan, 1.9);
  const orbCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), orbMat);
  orbCore.userData.noOutline = true;
  orb.add(orbCore);
  const orbHaloMat = new THREE.SpriteMaterial({ map: M.softDotTexture(), color: pal.glowCyan, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5, fog: false });
  const orbHalo = new THREE.Sprite(orbHaloMat);
  orbHalo.scale.setScalar(3.0);
  orb.add(orbHalo);
  orb.scale.setScalar(0.001);
  orb.visible = false;

  // --- dock-leaf parasol (only while gliding)
  const leafPivot = new THREE.Group();          // attached to the right shoulder
  armR.shoulder.add(leafPivot);
  const leafTex = M.canvasTexture(128, 256, drawLeafTexture);
  const leafMat = toon(0xffffff, { map: leafTex, side: THREE.DoubleSide });
  const stemMat = toon(0x6f9a3a);
  // stem rises past the cap brim then hooks inward so the leaf is centred over his head
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(-0.05, 0.45, 0), new THREE.Vector3(-0.02, 0.85, 0),
    new THREE.Vector3(0.1, 1.04, 0), new THREE.Vector3(0.24, 1.1, 0),
  ]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 16, 0.018, 6, false), stemMat);
  leafPivot.add(stem);
  const leaf = new THREE.Mesh(buildLeafGeometry(), leafMat);
  leaf.position.set(0.24, 1.12, 0);
  leaf.rotation.y = Math.PI / 2; // long axis across, so it reads as a canopy from behind
  leaf.scale.setScalar(1.15);
  leafPivot.add(leaf);
  leafPivot.position.y = -0.15;
  leafPivot.scale.setScalar(0.001);
  leafPivot.visible = false;

  // outlines + shadows on everything solid
  M.outline(body, 0.016);
  M.outline(cap, 0.016);
  for (const e of eyes) M.outline(e.children[0], 0.012);
  M.outline(scarf, 0.014); M.outline(knot, 0.014);
  for (const a of arms) { M.outline(a.shoulder.children[0], 0.014); M.outline(a.hand, 0.014); }
  for (const l of legs) { M.outline(l.hip.children[0], 0.014); M.outline(l.hip.children[1], 0.014); }
  M.outline(leaf, 0.012); M.outline(stem, 0.008);
  // shadows from the big shapes only (face details and the orb would just cost draw calls)
  const noShadow = new Set([eyeMat, glintMat, orbMat, mouthMat, blushMat]);
  root.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline) { o.castShadow = !noShadow.has(o.material); o.receiveShadow = false; }
  });

  return { root, visual, body, capPivot, cap, eyes, mouth, scarf, knot, arms, armL, armR, legs, orb, orbCore, orbMat, orbHaloMat, leafPivot, leaf, mats, stalkMat, scarfMat };
}

// world-space trailing scarf ends (verlet chains)
// All 6 ribbon segments are one InstancedMesh (+ one instanced outline hull): 2 draw calls instead of 12.
// The darker tip segments get an instance colour (tip / scarf ratio) on the shared scarf material, so
// the hurt flash still reaches them.
function buildScarfTails(ctx, scarfMat) {
  const group = new THREE.Group(); group.name = 'morel-scarf-tails';
  const SEG = 3, LEN = 0.085;
  const segGeo = new THREE.BoxGeometry(0.07, LEN, 0.02).translate(0, LEN / 2, 0);
  const mesh = new THREE.InstancedMesh(segGeo, scarfMat, 2 * SEG);
  mesh.castShadow = false;
  mesh.frustumCulled = false;            // instances move with Morel; a cached bounding sphere would go stale
  const tip = new THREE.Color(0x4f8a32), base = scarfMat.color, one = new THREE.Color(1, 1, 1);
  const tipTint = new THREE.Color(tip.r / Math.max(base.r, 1e-3), tip.g / Math.max(base.g, 1e-3), tip.b / Math.max(base.b, 1e-3));
  const hull = ctx.materials.outline(mesh, 0.012);
  hull.frustumCulled = false;
  group.add(mesh);
  const tails = [];
  for (let t = 0; t < 2; t++) {
    const nodes = [], prev = [], index = [], widths = [];
    for (let k = 0; k <= SEG; k++) { nodes.push(new THREE.Vector3()); prev.push(new THREE.Vector3()); }
    for (let k = 0; k < SEG; k++) {
      const i = t * SEG + k;
      mesh.setColorAt(i, k === SEG - 1 ? tipTint : one);
      index.push(i);
      widths.push(1 - k * 0.12);
    }
    tails.push({ nodes, prev, index, widths, side: t === 0 ? -1 : 1 });
  }
  mesh.instanceColor.needsUpdate = true;
  return { group, tails, SEG, LEN, mesh };
}

// reticle sprite shown on the lock-on target
function buildReticle(ctx) {
  const tex = ctx.materials.canvasTexture(128, 128, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.strokeStyle = 'rgba(255,214,120,1)'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < 4; k++) {
      g.save(); g.rotate(k * Math.PI / 2);
      g.beginPath(); g.moveTo(-14, -50); g.lineTo(0, -36); g.lineTo(14, -50); g.stroke();
      g.restore();
    }
    g.strokeStyle = 'rgba(255,240,200,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
  });
  const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 50;
  s.visible = false;
  return s;
}

function buildBlobShadow(ctx) {
  const tex = ctx.materials.canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.75)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x0b0718, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 2;
  m.name = 'morel-blob-shadow';
  return m;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
export function createPlayer(ctx) {
  const T = TUNING;
  const { events, physics, particles, input } = ctx;
  const model = buildMorel(ctx);
  const scarfTails = buildScarfTails(ctx, model.scarfMat);
  const reticle = buildReticle(ctx);
  const blob = buildBlobShadow(ctx);
  const fx = new THREE.Group(); fx.name = 'morel-fx';
  fx.add(scarfTails.group, reticle, blob);
  ctx.scene.add(model.root, fx);

  const body = {
    position: model.root.position,
    velocity: new THREE.Vector3(),
    radius: T.radius, height: T.height, stepHeight: 0.4,
    onGround: false, ground: null, groundNormal: new THREE.Vector3(0, 1, 0), wallNormal: new THREE.Vector3(),
    hitCeiling: false, hitWall: false,
  };

  // scratch
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const _m4 = new THREE.Matrix4();
  // reused particle option objects (no per-step allocations)
  const SPORE_OPTS = { color: 0x8ef06a, life: 0.5, size: 0.22, kind: 'glow', grow: 1.6, intensity: 1.6 };
  const AURA_OPTS = { color: 0xffffff, life: 0.6, size: 0.1, kind: 'glow' };
  const CHARGE_OPTS = { color: null, life: 0.4, size: 0.08, kind: 'glow', drag: 0 };
  const UP = new THREE.Vector3(0, 1, 0);
  const _groups = new Set();

  // controller state
  let coyote = 0, jumpBuf = 0, jumping = false, jumpCutDone = false, airTime = 0;
  let gliding = false, updrafting = false, lastGroundY = 0;
  let charging = false, chargeT = 0, chargeAnnounced = false, chargeFullAnnounced = false, cooldown = 0, pendingThrow = -1;
  let invulnT = 0, hurtT = 0, fellT = -1, deadT = -1;
  let volleyId = 0;
  let safeTimer = 0;
  const safePos = new THREE.Vector3(0, 2, 0);
  let safeYaw = 0;
  const checkpoint = { id: 'start', position: new THREE.Vector3(0, 2, 0), yaw: 0 };
  let tonicWarnNext = 3;
  let stepDustT = 0, footT = 0, lastFootSign = 1;
  let god = false;

  // animation state
  const anim = {
    t: 0, runPhase: 0, blinkT: 2.5, blink: 0, sq: 0, sqV: 0, lean: 0, side: 0,
    capX: 0, capZ: 0, capVX: 0, capVZ: 0, prevVX: 0, prevVZ: 0,
    leafOpen: 0, throwT: 0, orbScale: 0, popT: 1, yOff: 0, splat: 0, hurtFlash: 0,
  };

  const player = {
    object3d: model.root,
    model,
    body,
    tags: new Set(['player']),
    team: 'player',
    alive: true,
    radius: T.radius,
    height: T.height,
    get position() { return body.position; },
    get velocity() { return body.velocity; },
    yaw: 0,
    hp: T.maxHp,
    maxHp: T.maxHp,
    state: 'ground',
    tonic: null,
    lockTarget: null,
    locking: false,
    charge: 0,
    visible: true,
    cameraNear: false,   // set by the camera rig when it is pulled in so close that Morel would fill the view
    get onGround() { return body.onGround; },
    get invulnerable() { return god || invulnT > 0 || deadT >= 0 || fellT >= 0; },
    get god() { return god; },
    set god(v) { god = !!v; },
    get checkpoint() { return checkpoint; },
    get safePosition() { return safePos; },

    update, respawnAt, teleport, setCheckpoint, heal, damage, launch, setTonic,
    hurt(amount, info) { return damage(amount, info && info.from); },
    /** Snap all smoothing (scarf, camera helpers) after a teleport. */
    resetVisuals,
    die,
  };

  // ------------------------------------------------------------------ helpers
  function forwardOf(yaw, out) { return out.set(Math.sin(yaw), 0, Math.cos(yaw)); }
  function rightOf(yaw, out) { return out.set(-Math.cos(yaw), 0, Math.sin(yaw)); }

  function setTonic(kind, duration = T.tonicDuration) {
    if (!kind) { endTonic(); return; }
    if (player.tonic && player.tonic.kind !== kind) endTonic();
    player.tonic = { kind, remaining: duration, duration };
    tonicWarnNext = 3;
    events.emit('tonic:start', { kind, duration });
    particles.burst({ position: _v.copy(body.position).setY(body.position.y + 0.6), count: 26, color: [TONIC_COLORS[kind] || 0xffffff, 0xffffff], speed: 4, life: 0.7, size: 0.18, kind: 'glow' });
    applyTonicLook();
  }
  function endTonic() {
    if (!player.tonic) return;
    const kind = player.tonic.kind;
    player.tonic = null;
    events.emit('tonic:end', { kind });
    applyTonicLook();
  }
  function applyTonicLook() {
    const k = player.tonic ? player.tonic.kind : null;
    const c = k === 'anvil' ? 0x8a97a6 : k === 'seeker' ? 0xff5fb2 : 0x5ef2e0;
    model.orbMat.color.set(c).multiplyScalar(k === 'anvil' ? 1.1 : 1.9);
    model.orbHaloMat.color.set(c);
  }

  function setCheckpoint(id, position, yaw = 0) {
    checkpoint.id = id;
    if (Array.isArray(position)) checkpoint.position.set(position[0], position[1], position[2]);
    else checkpoint.position.copy(position);
    checkpoint.yaw = yaw;
  }

  function respawnAt(position, yaw = player.yaw) {
    if (Array.isArray(position)) body.position.set(position[0], position[1], position[2]);
    else body.position.copy(position);
    body.velocity.set(0, 0, 0);
    body.onGround = false; body.ground = null;
    if (body._carry) body._carry.collider = null;
    // settle onto the ground under the spawn point
    const gy = physics.groundHeight(body.position.x, body.position.z, body.position.y + 0.5);
    if (gy > -Infinity && gy > body.position.y - 3) body.position.y = gy;
    player.yaw = yaw;
    model.root.rotation.y = yaw;
    deadT = -1; fellT = -1; hurtT = 0;
    jumping = false; gliding = false; updrafting = false; charging = false; pendingThrow = -1;
    player.lockTarget = null;
    anim.popT = 0; anim.splat = 0; anim.sq = 0; anim.sqV = 0;
    model.visual.visible = true;
    player.visible = true;
    safePos.copy(body.position); safeYaw = yaw;
    lastGroundY = body.position.y;
    resetVisuals();
    if (ctx.cameraRig && ctx.cameraRig.snapBehind) ctx.cameraRig.snapBehind();
  }

  /** Move instantly (no ground settling, no pop, keeps hp). Used by __game.teleport. */
  function teleport(position, yaw) {
    if (Array.isArray(position)) body.position.set(position[0], position[1], position[2]);
    else body.position.copy(position);
    body.velocity.set(0, 0, 0);
    body.onGround = false; body.ground = null;
    if (body._carry) body._carry.collider = null;
    if (yaw !== undefined && yaw !== null) { player.yaw = yaw; model.root.rotation.y = yaw; }
    jumping = false; setGlide(false); updrafting = false; airTime = 0;
    if (fellT >= 0) { fellT = -1; }
    if (deadT < 0) { model.visual.visible = true; player.visible = true; }
    lastGroundY = body.position.y;
    resetVisuals();
    if (ctx.cameraRig && ctx.cameraRig.snapBehind) ctx.cameraRig.snapBehind();
  }

  function heal(n = 1) {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + n);
    return player.hp - before;
  }

  function damage(n = 1, fromPosition = null) {
    if (player.invulnerable || n <= 0) return false;
    player.hp = Math.max(0, player.hp - n);
    events.emit('player:hurt', { amount: n, hp: player.hp, maxHp: player.maxHp, position: body.position.clone() });
    cancelCharge();
    if (player.hp <= 0) { die(); return true; }
    invulnT = T.invulnTime;
    hurtT = T.hurtStun;
    anim.hurtFlash = 1;
    // knockback away from the source
    if (fromPosition) _v.set(body.position.x - fromPosition.x, 0, body.position.z - fromPosition.z);
    else forwardOf(player.yaw, _v).multiplyScalar(-1);
    if (_v.lengthSq() < 1e-6) forwardOf(player.yaw, _v).multiplyScalar(-1);
    _v.normalize();
    body.velocity.x = _v.x * T.knockback;
    body.velocity.z = _v.z * T.knockback;
    body.velocity.y = T.knockbackUp;
    body.onGround = false;
    jumping = false; setGlide(false);
    particles.burst({ position: _a.copy(body.position).setY(body.position.y + 0.6), count: 10, color: [0xffffff, 0xffd0d0], speed: 3.5, life: 0.35, size: 0.16, kind: 'glow' });
    return true;
  }

  function die() {
    if (deadT >= 0) return;
    deadT = 0;
    player.hp = 0;
    body.velocity.set(0, 0, 0);
    cancelCharge();
    setGlide(false);
    updrafting = false;
    player.lockTarget = null;
    endTonic();
    player.state = 'dead';
    events.emit('player:died', { position: body.position.clone() });
    if (ctx.state === 'playing') ctx.setState('dead');
  }

  function launch(vy) {
    body.velocity.y = vy;
    body.onGround = false;
    if (body._carry) body._carry.collider = null;
    jumping = false; jumpCutDone = true; coyote = 0; jumpBuf = 0;
    setGlide(false);
    anim.sqV += 7;
  }

  function setGlide(on) {
    if (gliding === on) return;
    gliding = on;
    events.emit('player:glide', { on });
  }

  function cancelCharge() {
    charging = false; chargeT = 0; chargeAnnounced = false; chargeFullAnnounced = false; pendingThrow = -1;
  }

  function resetVisuals() {
    for (const tail of scarfTails.tails) {
      tailAnchor(tail, _a);
      for (let k = 0; k < tail.nodes.length; k++) {
        tail.nodes[k].copy(_a).y -= k * scarfTails.LEN;
        tail.prev[k].copy(tail.nodes[k]);
      }
    }
    anim.yOff = 0;
  }

  // ------------------------------------------------------------------ targeting
  function targetCenter(e, out) {
    const p = e.position || e.object3d.position;
    return out.set(p.x, p.y + (e.height ?? (e.radius || 0.5) * 2) * 0.5, p.z);
  }

  function pickLockTarget() {
    const cam = ctx.cameraRig;
    const camYaw = cam ? cam.yaw : player.yaw;
    forwardOf(camYaw, _w);
    let best = null, bestScore = Infinity;
    for (const e of ctx.entities.query('enemy')) {
      if (e.hittable === false) continue;
      const ep = e.position || e.object3d.position;
      _v.set(ep.x - body.position.x, 0, ep.z - body.position.z);
      const d = _v.length();
      if (d > T.lockRange) continue;
      const ang = d > 0.01 ? Math.acos(clamp(_v.dot(_w) / d, -1, 1)) : 0;
      if (ang > T.lockCone && d > 6) continue; // close enemies are always eligible
      const score = d * (1 + ang * 1.2);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  /** Nearest enemy within the aim-assist cone around dir from origin. */
  function aimAssistTarget(origin, dir, range) {
    let best = null, bestScore = Infinity;
    const cosCone = Math.cos(T.aimAssistCone);
    for (const e of ctx.entities.query('enemy')) {
      if (e.hittable === false) continue;
      targetCenter(e, _v).sub(origin);
      const d = _v.length();
      if (d > range || d < 0.01) continue;
      // horizontal cone (vertical handled by aiming at the target)
      const hl = Math.hypot(_v.x, _v.z) || 1;
      const c = (_v.x * dir.x + _v.z * dir.z) / hl;
      if (c < cosCone) continue;
      const score = d * (2 - c);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function aliveVolleys() {
    _groups.clear();
    for (const p of ctx.projectiles.active) if (p.owner === player && p.alive) _groups.add(p.group);
    return _groups.size;
  }

  function handPosition(out) {
    forwardOf(player.yaw, _a); rightOf(player.yaw, _b);
    return out.copy(body.position).addScaledVector(_a, 0.32).addScaledVector(_b, 0.16).setY(body.position.y + 0.55);
  }

  function fire(charge) {
    const tonic = player.tonic ? player.tonic.kind : null;
    const kind = tonic === 'anvil' ? 'iron' : tonic === 'seeker' ? 'seeker' : 'puff';
    const origin = handPosition(new THREE.Vector3());
    const facing = forwardOf(player.yaw, new THREE.Vector3());
    const group = ++volleyId;
    const full = charge >= 1;
    let damage, speed, range, radius, gravity = 0;
    if (kind === 'iron') {
      damage = full ? T.iron.chargedDamage : T.iron.damage;
      speed = lerp(T.iron.speed, T.iron.speed * 1.2, charge); range = lerp(T.iron.range, T.charged.range, charge);
      radius = lerp(T.iron.radius, T.iron.radius * 1.5, charge); gravity = T.iron.gravity;
    } else if (kind === 'seeker') {
      damage = full ? T.seeker.chargedDamage : T.seeker.damage;
      speed = T.seeker.speed; range = T.seeker.range; radius = lerp(T.seeker.radius, T.seeker.radius * 1.4, charge);
    } else {
      damage = full ? T.charged.damage : charge >= 0.5 ? 2 : T.puff.damage;
      speed = lerp(T.puff.speed, T.charged.speed, charge); range = lerp(T.puff.range, T.charged.range, charge);
      radius = lerp(T.puff.radius, T.charged.radius, charge);
    }
    const locked = player.lockTarget && player.lockTarget.alive ? player.lockTarget : null;

    if (kind === 'seeker') {
      // three small homing puffs, fanned out, each preferring a different target
      const targets = [];
      if (locked) targets.push(locked);
      const cands = ctx.entities.query('enemy').slice().sort((a, b) => (a.position || a.object3d.position).distanceToSquared(body.position) - (b.position || b.object3d.position).distanceToSquared(body.position));
      for (const e of cands) {
        if (targets.length >= 3) break;
        if (targets.includes(e) || e.hittable === false) continue;
        if ((e.position || e.object3d.position).distanceTo(body.position) > T.seeker.range) continue;
        targets.push(e);
      }
      for (let k = 0; k < 3; k++) {
        const ang = player.yaw + (k - 1) * T.seeker.spread;
        const dir = new THREE.Vector3(Math.sin(ang), 0.12, Math.cos(ang)).normalize();
        const target = targets.length ? targets[k % targets.length] : null;
        ctx.projectiles.spawn({
          team: 'player', kind: 'seeker', position: origin, velocity: dir.multiplyScalar(speed), damage, radius,
          life: range / speed + 0.6, range, homing: target, homingStrength: T.seeker.homing, owner: player, group, charge,
        });
      }
    } else {
      const dir = facing.clone();
      let homing = null, homingStrength = 0;
      if (locked) {
        targetCenter(locked, dir).sub(origin).normalize();
        homing = locked; homingStrength = T.lockHoming;
      } else {
        const assist = aimAssistTarget(origin, facing, Math.min(range, T.aimAssistRange));
        if (assist) {
          // aim at the target's height, keep mostly the facing direction and bend in flight
          targetCenter(assist, _v).sub(origin).normalize();
          const hd = Math.hypot(_v.x, _v.z) || 1;
          dir.set(facing.x, _v.y / hd, facing.z).normalize().lerp(_v, T.aimAssistInitial).normalize();
          homing = assist; homingStrength = T.aimAssistHoming;
        }
      }
      if (gravity) dir.y += 0.06; // iron balls lob a touch
      ctx.projectiles.spawn({
        team: 'player', kind, position: origin, velocity: dir.normalize().multiplyScalar(speed), damage, radius,
        life: range / speed + 0.5, range, gravity, homing, homingStrength, heavy: kind === 'iron', owner: player, group, charge,
      });
    }
    cooldown = T.throwCooldown;
    anim.throwT = 0.28;
    events.emit('player:throw', { position: origin, charge, kind });
    particles.burst({ position: origin, count: kind === 'iron' ? 6 : 8, color: kind === 'iron' ? [0xffc35a, 0xffffff] : kind === 'seeker' ? 0xff5fb2 : 0x5ef2e0, speed: 2.5, life: 0.25, size: 0.12, kind: kind === 'iron' ? 'spark' : 'glow', direction: facing, spread: 0.6 });
  }

  // ------------------------------------------------------------------ hazards
  function fallInWater() {
    fellT = 0;
    player.state = 'hurt';
    const pos = body.position.clone();
    events.emit('player:fell', { position: pos });
    particles.burst({ position: _a.set(pos.x, physics.waterLevel + 0.1, pos.z), count: 22, color: [0x2c5a48, 0x9cc8b0, 0x1f3b33], speed: 5, spread: 0.45, life: 0.7, size: 0.32, gravity: 14, kind: 'puff' });
    particles.burst({ position: _a, count: 10, color: 0x5ef2e0, speed: 2, life: 0.5, size: 0.12, kind: 'glow' });
    body.velocity.set(0, 0, 0);
    setGlide(false); updrafting = false; cancelCharge();
    model.visual.visible = false; player.visible = false;
    if (!god) {
      player.hp = Math.max(0, player.hp - 1);
      events.emit('player:hurt', { amount: 1, hp: player.hp, maxHp: player.maxHp, position: pos });
    }
  }

  function trackSafeGround(dt) {
    if (!body.onGround || body.onSteep) { safeTimer = 0; return; }
    if (body.ground && body.ground.isMover) return;
    if (body.ground && body.ground.tag === 'unsafe') return;
    safeTimer += dt;
    if (safeTimer < 0.15) return;
    const p = body.position;
    if (p.y < physics.waterLevel + T.waterMargin + 0.5) return;
    const probe = 0.75;
    for (let k = 0; k < 4; k++) {
      const x = p.x + (k === 0 ? probe : k === 1 ? -probe : 0), z = p.z + (k === 2 ? probe : k === 3 ? -probe : 0);
      const gy = physics.groundHeight(x, z, p.y + 0.45);
      if (!(gy > p.y - 0.6) || gy < physics.waterLevel + T.waterMargin + 0.3) return;
    }
    safePos.copy(p); safeYaw = player.yaw; safeTimer = 0;
  }

  // ------------------------------------------------------------------ update
  function update(dt) {
    const playing = ctx.state === 'playing';
    anim.t += dt;
    if (deadT >= 0) { updateDead(dt); animate(dt); return; }
    if (fellT >= 0) {
      fellT += dt;
      if (fellT >= T.fallRespawnDelay) {
        fellT = -1;
        if (player.hp <= 0 && !god) { model.visual.visible = true; player.visible = true; die(); }
        else {
          respawnAt(safePos, safeYaw);
          invulnT = T.invulnTime;
          events.emit('player:respawn', { position: body.position.clone(), checkpointId: null });
          popBurst();
        }
      }
      animate(dt);
      return;
    }

    const mx = playing ? input.move.x : 0, my = playing ? input.move.y : 0;
    const jumpPressed = playing && input.pressed('jump');
    const jumpDown = playing && input.down('jump');
    const throwPressed = playing && input.pressed('throw');
    const throwDown = playing && input.down('throw');
    const throwReleased = playing && input.released('throw');
    const lockDown = playing && input.down('lock');
    const lockPressed = playing && input.pressed('lock');

    invulnT = Math.max(0, invulnT - dt);
    hurtT = Math.max(0, hurtT - dt);
    cooldown = Math.max(0, cooldown - dt);
    const stunned = hurtT > 0;

    // --- lock-on
    player.locking = lockDown;
    if (lockPressed) player.lockTarget = pickLockTarget();
    if (lockDown) {
      const lt = player.lockTarget;
      if (lt) {
        const lp = lt.position || lt.object3d.position;
        if (!lt.alive || !lt.tags.has('enemy') || lt.hittable === false || lp.distanceTo(body.position) > T.lockKeepRange) player.lockTarget = pickLockTarget();
      }
    } else player.lockTarget = null;

    // --- desired horizontal velocity (camera relative)
    const camYaw = ctx.cameraRig ? ctx.cameraRig.yaw : player.yaw;
    forwardOf(camYaw, _a); rightOf(camYaw, _b);
    const wx = _b.x * mx + _a.x * my, wz = _b.z * mx + _a.z * my;
    const wishLen = Math.min(1, Math.hypot(wx, wz));
    const v = body.velocity;
    let maxSpeed = gliding ? T.glideMaxSpeed : player.locking ? T.strafeSpeed : T.runSpeed;
    if (charging && chargeT > 0.15) maxSpeed *= T.chargeMoveScale;
    if (!stunned) {
      const tx = wx * maxSpeed, tz = wz * maxSpeed;
      let accel;
      if (body.onGround) accel = wishLen > 0.05 ? T.groundAccel : T.groundDecel;
      else accel = wishLen > 0.05 ? T.airAccel : T.airDrag;
      let dx = tx - v.x, dz = tz - v.z;
      if (!body.onGround && wishLen <= 0.05) { dx = -v.x; dz = -v.z; }
      const dl = Math.hypot(dx, dz);
      const maxD = accel * dt;
      if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
      v.x += dx; v.z += dz;
      if (gliding) {
        const hs = Math.hypot(v.x, v.z);
        if (hs > T.glideMaxSpeed) { const k = Math.max(T.glideMaxSpeed, hs - 12 * dt) / hs; v.x *= k; v.z *= k; }
      }
    } else {
      v.x = approach(v.x, 0, 6 * dt); v.z = approach(v.z, 0, 6 * dt);
    }

    // --- facing
    let targetYaw = player.yaw;
    const lt = player.lockTarget;
    if (lt) {
      const lp = lt.position || lt.object3d.position;
      targetYaw = Math.atan2(lp.x - body.position.x, lp.z - body.position.z);
    } else if (!player.locking && !stunned && wishLen > 0.1) {
      targetYaw = Math.atan2(wx, wz);
    }
    player.yaw = dampAngle(player.yaw, targetYaw, gliding ? T.turnLambda * 0.6 : T.turnLambda, dt);

    // --- jump / coyote / buffer
    if (body.onGround) coyote = T.coyoteTime; else coyote = Math.max(0, coyote - dt);
    if (jumpPressed) jumpBuf = T.jumpBuffer; else jumpBuf = Math.max(0, jumpBuf - dt);
    if (jumpBuf > 0 && coyote > 0 && !stunned) {
      v.y = T.jumpVelocity;
      jumping = true; jumpCutDone = false;
      coyote = 0; jumpBuf = 0;
      body.onGround = false;
      if (body._carry && body._carry.collider) {
        // inherit platform motion
        const m = body._carry.collider;
        if (m.delta) { v.x += m.delta.x / dt * 0.5; v.z += m.delta.z / dt * 0.5; v.y += Math.max(0, m.delta.y / dt); }
        body._carry.collider = null;
      }
      anim.sqV += 9;
      events.emit('player:jump', { position: body.position.clone() });
      particles.burst({ position: _v.copy(body.position).setY(body.position.y + 0.05), count: 6, color: 0xb9ad8a, speed: 1.6, spread: 0.9, life: 0.45, size: 0.22, kind: 'puff', alpha: 0.5 });
    }
    if (jumping && !jumpDown && v.y > 0 && !jumpCutDone) { v.y *= 1 - T.jumpCut; jumpCutDone = true; }
    if (v.y <= 0) jumping = false;

    // --- glide / updraft
    const airborne = !body.onGround;
    const wantUp = airborne && jumpDown && !stunned && player.tonic && player.tonic.kind === 'updraft' && !jumping;
    const riseCapped = body.position.y > lastGroundY + T.updraftMaxRise;
    updrafting = !!wantUp && !riseCapped;
    setGlide(airborne && jumpDown && !stunned && !jumping && v.y < 0.5 && !updrafting);

    // --- gravity
    if (updrafting) {
      v.y = approach(v.y, T.updraftSpeed, T.updraftAccel * dt);
      if (Math.random() < 0.9) {
        _v.set((Math.random() - 0.5) * 1.2, -4 - Math.random() * 2, (Math.random() - 0.5) * 1.2);
        SPORE_OPTS.color = Math.random() < 0.5 ? 0x8ef06a : 0xdfffb0;
        particles.spawn(_a.copy(body.position).setY(body.position.y - 0.05), _v, SPORE_OPTS);
      }
    } else {
      if (gliding) {
        // parasol: fall speed is capped; a fast fall is caught quickly (not instantly)
        if (v.y > -T.glideFallSpeed) v.y = Math.max(v.y - T.gravityDown * dt, -T.glideFallSpeed);
        else v.y = Math.min(-T.glideFallSpeed, v.y + T.glideCatch * dt);
      } else {
        v.y -= (v.y > 0 ? T.gravityUp : T.gravityDown) * dt;
      }
      if (v.y < -T.maxFallSpeed) v.y = -T.maxFallSpeed;
    }

    // --- move
    const wasGround = body.onGround;
    const vyBefore = v.y;
    physics.moveCharacter(body, dt);
    if (body.stepped > 0) anim.yOff -= body.stepped;
    if (body.onGround) {
      lastGroundY = body.position.y;
      jumping = false;
      if (!wasGround) {
        const impact = Math.max(0, -vyBefore);
        setGlide(false);
        if (airTime > 0.08 || impact > 3) {
          events.emit('player:land', { position: body.position.clone(), impact });
          anim.sq = -Math.min(0.36, 0.05 + impact * 0.012); anim.sqV = 0;
          if (impact > 7) particles.burst({ position: _v.copy(body.position).setY(body.position.y + 0.05), count: Math.min(16, 4 + Math.round(impact)), color: 0xb9ad8a, speed: 2.5, spread: 0.9, direction: UP, life: 0.5, size: 0.26, kind: 'puff', alpha: 0.55 });
        }
      }
      airTime = 0;
    } else airTime += dt;
    if (body.hitCeiling) jumping = false;

    // --- throw / charge
    if (throwPressed && !stunned) { charging = true; chargeT = 0; chargeAnnounced = false; chargeFullAnnounced = false; }
    if (charging) {
      if (stunned) cancelCharge();
      else if (throwReleased || (!throwDown && pendingThrow < 0)) {
        if (throwReleased) {
          const c = clamp01(chargeT / T.chargeTime);
          pendingThrow = c < T.quickCharge ? 0 : c;
        }
        charging = false;
      } else {
        chargeT += dt;
        if (chargeT > 0.15 && !chargeAnnounced) { chargeAnnounced = true; events.emit('player:charge', { level: 0 }); }
        if (chargeT >= T.chargeTime && !chargeFullAnnounced) {
          chargeFullAnnounced = true;
          events.emit('player:charge', { level: 1 });
          handPosition(_v);
          particles.burst({ position: _v, count: 14, color: [0xffffff, model.orbHaloMat.color.getHex()], speed: 3, life: 0.35, size: 0.1, kind: 'glow' });
        }
      }
    }
    if (pendingThrow >= 0 && cooldown <= 0) {
      if (aliveVolleys() < T.maxPuffs) fire(pendingThrow);
      else {
        handPosition(_v);
        particles.burst({ position: _v, count: 5, color: 0x9fdcd4, speed: 1, life: 0.3, size: 0.12, kind: 'puff' });
      }
      pendingThrow = -1; chargeT = 0;
    }
    player.charge = charging ? clamp01(chargeT / T.chargeTime) : 0;

    // --- tonic timer
    const tonic = player.tonic;
    if (tonic) {
      tonic.remaining -= dt;
      while (tonicWarnNext >= 1 && tonic.remaining <= tonicWarnNext && tonic.remaining > 0) {
        events.emit('tonic:warning', { kind: tonic.kind, remaining: tonicWarnNext });
        tonicWarnNext--;
      }
      if (tonic.remaining <= 0) endTonic();
      else if (Math.random() < 0.25) {
        _v.set(body.position.x + (Math.random() - 0.5) * 0.8, body.position.y + 0.2 + Math.random() * 0.9, body.position.z + (Math.random() - 0.5) * 0.8);
        AURA_OPTS.color = TONIC_COLORS[tonic.kind];
        particles.spawn(_v, _a.set(0, 0.6, 0), AURA_OPTS);
      }
    }

    // --- water / kill plane
    const onSolidBox = body.onGround && body.ground && body.ground !== 'terrain';
    if ((body.position.y < physics.waterLevel + T.waterMargin && !onSolidBox) || body.position.y < T.killY) {
      fallInWater();
    } else {
      trackSafeGround(dt);
    }

    // --- state + footsteps
    player.state = stunned ? 'hurt' : body.onGround ? 'ground' : updrafting ? 'updraft' : gliding ? 'glide' : 'air';
    const hs = Math.hypot(v.x, v.z);
    if (body.onGround && hs > 1) {
      footT += dt * (2 + hs * 0.55);
      if (footT >= 1) {
        footT -= 1;
        events.emit('player:step', { position: body.position.clone(), surface: body.surface, speed: hs });
        if (hs > 6) {
          stepDustT++;
          if (stepDustT % 2 === 0) particles.burst({ position: _v.copy(body.position).setY(body.position.y + 0.04), count: 2, color: 0xb9ad8a, speed: 0.8, spread: 1, life: 0.4, size: 0.18, kind: 'puff', alpha: 0.4 });
        }
      }
    } else footT = 0.6;

    animate(dt);
  }

  function updateDead(dt) {
    deadT += dt;
    if (deadT < 0.2) anim.splat = Math.min(1, deadT / 0.12);
    if (deadT >= 0.2 && model.visual.visible) {
      model.visual.visible = false; player.visible = false;
      particles.burst({ position: _v.copy(body.position).setY(body.position.y + 0.2), count: 22, color: [0xe8c98a, 0xffc35a, 0xf3e6c8], speed: 4, life: 0.7, size: 0.3, kind: 'puff' });
      particles.burst({ position: _v, count: 16, color: 0xffc35a, speed: 5, life: 0.6, size: 0.12, kind: 'spark', gravity: 6 });
    }
    if (deadT >= T.deathTime) {
      player.hp = player.maxHp;
      respawnAt(checkpoint.position, checkpoint.yaw);
      invulnT = T.invulnTime;
      events.emit('player:respawn', { position: body.position.clone(), checkpointId: checkpoint.id });
      if (ctx.state === 'dead') ctx.setState('playing');
      popBurst();
    }
  }

  function popBurst() {
    particles.burst({ position: _v.copy(body.position).setY(body.position.y + 0.5), count: 18, color: [0x5ef2e0, 0xffffff, 0xffc35a], speed: 3.5, life: 0.6, size: 0.14, kind: 'glow' });
  }

  // ------------------------------------------------------------------ animation
  function tailAnchor(tail, out) {
    const s = model.visual.scale;
    forwardOf(player.yaw, _a); rightOf(player.yaw, _b);
    return out.copy(body.position)
      .addScaledVector(_a, -0.22)
      .addScaledVector(_b, -tail.side * 0.05 - 0.04)
      .setY(body.position.y + (0.3 + anim.yOff) * s.y);
  }

  function updateTails(dt) {
    const LEN = scarfTails.LEN;
    const gx = 0, gy = -5.5, gz = 0;
    for (const tail of scarfTails.tails) {
      const { nodes, prev } = tail;
      tailAnchor(tail, nodes[0]);
      prev[0].copy(nodes[0]);
      for (let k = 1; k < nodes.length; k++) {
        const n = nodes[k], p = prev[k];
        const vx = (n.x - p.x) * 0.9, vy = (n.y - p.y) * 0.9, vz = (n.z - p.z) * 0.9;
        p.copy(n);
        n.x += vx + gx * dt * dt; n.y += vy + gy * dt * dt; n.z += vz + gz * dt * dt;
        // flutter
        n.y += Math.sin(anim.t * 9 + k * 1.7 + tail.side) * 0.0009 * k;
      }
      for (let it = 0; it < 3; it++) {
        for (let k = 1; k < nodes.length; k++) {
          const a = nodes[k - 1], b = nodes[k];
          _v.subVectors(b, a);
          const d = _v.length() || 1e-6;
          b.copy(a).addScaledVector(_v, LEN / d);
          // keep out of the body cylinder
          const dx = b.x - body.position.x, dz = b.z - body.position.z;
          const hd = Math.hypot(dx, dz);
          if (hd < 0.24 && b.y > body.position.y && b.y < body.position.y + 0.62) {
            const k2 = 0.24 / (hd || 1e-6);
            b.x = body.position.x + dx * k2; b.z = body.position.z + dz * k2;
          }
        }
      }
      // orient each ribbon segment: +Y along the chain, thin side facing Morel's back
      forwardOf(player.yaw, _w);
      for (let k = 0; k < tail.index.length; k++) {
        _v.subVectors(nodes[k + 1], nodes[k]).normalize();       // y axis
        _b.copy(_w).addScaledVector(_v, -_w.dot(_v));              // z axis = facing, orthogonalised
        if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0);
        _b.normalize();
        _a.crossVectors(_v, _b).multiplyScalar(tail.widths[k]);   // x axis (segment width taper)
        _m4.makeBasis(_a, _v, _b).setPosition(nodes[k]);
        scarfTails.mesh.setMatrixAt(tail.index[k], _m4);
      }
    }
    scarfTails.mesh.instanceMatrix.needsUpdate = true;
  }

  function animate(dt) {
    const m = model;
    const v = body.velocity;
    const hs = Math.hypot(v.x, v.z);
    const runAmt = body.onGround ? clamp01(hs / T.runSpeed) : 0;
    const air = !body.onGround && deadT < 0;
    m.root.rotation.y = player.yaw;

    // local velocity (for strafing and lean)
    forwardOf(player.yaw, _a); rightOf(player.yaw, _b);
    const lz = v.x * _a.x + v.z * _a.z;   // forward speed
    const lx = v.x * _b.x + v.z * _b.z;   // rightward speed
    const strafing = player.locking && body.onGround && hs > 0.5;

    // stride
    if (body.onGround && hs > 0.3) anim.runPhase += dt * (5 + hs * 1.45);
    const ph = anim.runPhase;
    const sw = Math.sin(ph);

    // squash/stretch spring
    anim.sqV += (-260 * anim.sq - 16 * anim.sqV) * dt;
    anim.sq += anim.sqV * dt;
    anim.sq = clamp(anim.sq, -0.45, 0.45);
    let sy = 1 + anim.sq, sxz = 1 - anim.sq * 0.5;
    // breathing when idle
    if (body.onGround && hs < 0.3) sy += Math.sin(anim.t * 2.4) * 0.015;
    // death splat
    if (deadT >= 0) { sy = lerp(sy, 0.16, anim.splat); sxz = lerp(sxz, 1.75, anim.splat); }
    // respawn pop
    if (anim.popT < 1) {
      anim.popT = Math.min(1, anim.popT + dt / 0.38);
      const k = Math.max(0.001, easeOutBack(anim.popT, 2.2));
      sy *= k; sxz *= k;
    }
    m.visual.scale.set(sxz, sy, sxz);

    // step smoothing + bob
    anim.yOff = damp(anim.yOff, 0, 18, dt);
    const bob = Math.abs(Math.sin(ph)) * 0.055 * runAmt;
    m.visual.position.y = anim.yOff + bob;

    // lean into motion and acceleration
    const ax = (v.x - anim.prevVX) / Math.max(dt, 1e-4), az = (v.z - anim.prevVZ) / Math.max(dt, 1e-4);
    anim.prevVX = v.x; anim.prevVZ = v.z;
    const accF = ax * _a.x + az * _a.z, accR = ax * _b.x + az * _b.z;
    const leanTarget = strafing ? 0.05 : (body.onGround ? 0.2 * runAmt : clamp(lz / T.runSpeed, -1, 1) * 0.12) + clamp(accF * 0.004, -0.12, 0.12);
    anim.lean = damp(anim.lean, gliding ? 0.08 : leanTarget, 10, dt);
    const sideTarget = gliding ? Math.sin(anim.t * 2.6) * 0.13 : clamp(-lx * 0.02 - accR * 0.002, -0.2, 0.2);
    anim.side = damp(anim.side, sideTarget, 8, dt);
    m.visual.rotation.set(anim.lean, 0, anim.side);

    // cap wobble (spring driven by acceleration)
    anim.capVX += (-150 * anim.capX - 9 * anim.capVX - accF * 0.012 + (air ? -v.y * 0.02 : 0)) * dt;
    anim.capVZ += (-150 * anim.capZ - 9 * anim.capVZ + accR * 0.012) * dt;
    anim.capX = clamp(anim.capX + anim.capVX * dt, -0.35, 0.35);
    anim.capZ = clamp(anim.capZ + anim.capVZ * dt, -0.35, 0.35);
    const runWobble = Math.sin(ph * 2) * 0.04 * runAmt;
    m.capPivot.rotation.set(anim.capX + runWobble, 0, anim.capZ + Math.sin(anim.t * 1.3) * 0.015);

    // legs
    const [legR, legL] = m.legs; // side -1 = right (-X), +1 = left
    if (air) {
      const dangle = gliding || updrafting ? Math.sin(anim.t * 7) * 0.35 : 0;
      const tuck = v.y > 0 ? -0.6 : 0.25;
      legL.hip.rotation.set(tuck + dangle, 0, 0.1);
      legR.hip.rotation.set(tuck * 0.6 - dangle, 0, -0.1);
    } else if (strafing && Math.abs(lx) > Math.abs(lz)) {
      legL.hip.rotation.set(0, 0, 0.45 * sw * runAmt);
      legR.hip.rotation.set(0, 0, 0.45 * sw * runAmt);
    } else {
      const dir = lz >= -0.2 ? 1 : -1;
      legL.hip.rotation.set(sw * 1.05 * runAmt * dir, 0, 0.05);
      legR.hip.rotation.set(-sw * 1.05 * runAmt * dir, 0, -0.05);
    }

    // arms
    const armR = m.armR.shoulder, armL = m.armL.shoulder; // armR side -1 (-X)
    let rX = -sw * 0.9 * runAmt, rZ = -0.35, lX = sw * 0.9 * runAmt, lZ = 0.35;
    if (air && !gliding && !updrafting) {
      const up = v.y > 0 ? 1 : 0.7;
      rZ = -1.6 * up; lZ = 1.6 * up; rX = -0.2 + Math.sin(anim.t * 14) * 0.15 * (1 - up); lX = rX;
    }
    if (updrafting) { rZ = -2.4; lZ = 2.4; rX = 0; lX = 0; }
    if (gliding || anim.leafOpen > 0.05) {
      rZ = lerp(rZ, -2.95, anim.leafOpen); rX = lerp(rX, 0.15, anim.leafOpen);
      lZ = lerp(lZ, 1.2, anim.leafOpen); lX = lerp(lX, Math.sin(anim.t * 3) * 0.2, anim.leafOpen);
    }
    // throw wind-up / release
    if (charging && chargeT > 0.06) {
      const w = clamp01(chargeT / 0.15);
      rX = lerp(rX, -2.5, w); rZ = lerp(rZ, -0.5, w);
      rX += Math.sin(anim.t * 30) * 0.05 * player.charge;
    }
    if (anim.throwT > 0) {
      anim.throwT = Math.max(0, anim.throwT - dt);
      const k = anim.throwT / 0.28;         // 1 -> 0
      const swing = k > 0.7 ? lerp(1.3, -2.4, (k - 0.7) / 0.3) : lerp(0, 1.3, k / 0.7);
      rX = swing; rZ = -0.35;
    }
    armR.rotation.set(rX, 0, rZ);
    armL.rotation.set(lX, 0, lZ);

    // charge orb
    const orbTarget = charging && chargeT > 0.12 ? 0.07 + 0.17 * player.charge : 0;
    anim.orbScale = damp(anim.orbScale, orbTarget, 18, dt);
    m.orb.visible = anim.orbScale > 0.005;
    const pulse = 1 + Math.sin(anim.t * (player.charge >= 1 ? 26 : 12)) * (player.charge >= 1 ? 0.12 : 0.05);
    m.orb.scale.setScalar(Math.max(0.001, anim.orbScale * pulse));
    if (charging && chargeT > 0.15 && Math.random() < 0.5) {
      handPosition(_v);
      _w.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.6);
      CHARGE_OPTS.color = m.orbHaloMat.color;
      particles.spawn(_a.copy(_v).add(_w), _w.multiplyScalar(-2.2), CHARGE_OPTS);
    }

    // leaf parasol
    anim.leafOpen = approach(anim.leafOpen, gliding ? 1 : 0, dt * (gliding ? 6 : 4));
    m.leafPivot.visible = anim.leafOpen > 0.01;
    const lo = gliding ? easeOutBack(anim.leafOpen, 2.4) : anim.leafOpen;
    m.leafPivot.scale.setScalar(Math.max(0.001, lo));
    // counter-rotate so the stem points up (leaning slightly outward) whatever the arm does
    m.leafPivot.rotation.set(-rX, 0, -rZ + Math.sin(anim.t * 2.6) * 0.04);
    // tipped back so the canopy reads from the default chase camera
    m.leaf.rotation.set(Math.sin(anim.t * 3.1) * 0.06 - 0.42, Math.PI / 2 + Math.sin(anim.t * 1.7) * 0.1, Math.sin(anim.t * 2.3) * 0.05);

    // eyes: blink, hurt squint
    anim.blinkT -= dt;
    if (anim.blinkT <= 0) { anim.blink = 0.14; anim.blinkT = 2 + Math.random() * 3.5; }
    anim.blink = Math.max(0, anim.blink - dt);
    let eyeY = anim.blink > 0 ? 0.12 : 1;
    if (hurtT > 0 || deadT >= 0 || fellT >= 0) eyeY = 0.3;
    for (const e of m.eyes) e.scale.y = damp(e.scale.y, eyeY, 40, dt);
    const mouthOpen = air && v.y > 2 ? 1.4 : hurtT > 0 ? 1.6 : 1;
    m.mouth.scale.set(1, mouthOpen, 1);

    // hurt flash + invulnerability blink
    anim.hurtFlash = Math.max(0, anim.hurtFlash - dt * 3);
    const flash = anim.hurtFlash > 0 && Math.floor(anim.t * 20) % 2 === 0 ? 0.55 : 0;
    for (const mat of m.mats) mat.emissive.setRGB(flash, flash * 0.35, flash * 0.35);
    const blinkHide = invulnT > 0 && deadT < 0 && fellT < 0 && Math.floor(anim.t * 14) % 2 === 0 && anim.popT >= 1;
    const show = player.visible && !blinkHide && !player.cameraNear;
    m.visual.visible = show;
    scarfTails.group.visible = show;
    if (player.visible) updateTails(dt);

    // reticle on the lock target
    const lt = player.lockTarget;
    if (lt && lt.alive) {
      targetCenter(lt, reticle.position);
      const sc = 1.1 + (lt.radius || 0.5) * 1.6;
      reticle.scale.setScalar(sc * (1 + Math.sin(anim.t * 6) * 0.06));
      reticle.material.rotation = anim.t * 1.5;
      reticle.visible = true;
    } else reticle.visible = false;

    // blob shadow
    const gy = physics.groundHeight(body.position.x, body.position.z, body.position.y + 0.1);
    if (gy > -Infinity && player.visible && body.position.y - gy < 12) {
      const hgt = body.position.y - gy;
      blob.visible = true;
      blob.position.set(body.position.x, gy + 0.03, body.position.z);
      const s = 0.78 * (1 - clamp01(hgt / 10) * 0.45);
      blob.scale.set(s, 1, s);
      blob.material.opacity = 0.42 * (1 - clamp01(hgt / 12) * 0.7);
    } else blob.visible = false;
  }

  // initial placement
  resetVisuals();
  applyTonicLook();
  return player;
}
