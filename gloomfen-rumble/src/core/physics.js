// Character physics for a platformer: static AABBs in a uniform spatial hash,
// kinematic movers that carry what stands on them, a floor-only heightfield
// terrain, a water level, and the queries the game needs.
//
//   const box = physics.addBox({ min:[x,y,z], max:[x,y,z], surface:'wood', tag:'ledge', data })
//   const plat = physics.addMover(physics.addBox({...})); plat.setPosition(centerVec3) // every step
//   physics.setTerrain({ sample(x,z) -> y, normal(x,z) -> Vector3 })
//   physics.moveCharacter(body, dt)   // body = { position, velocity, radius, height, ... }
import * as THREE from 'three';

const CELL = 4;                 // spatial hash cell size (m)
const BIG_CELLS = 256;          // colliders spanning more cells than this live in a separate list
const MAX_SUB = 0.12;           // max displacement per substep (m)
const STEP_UP = 0.4;            // grounded step-up height
const AIR_STEP = 0.12;          // ledge forgiveness while airborne
const MAX_SLOPE_COS = Math.cos(50 * Math.PI / 180); // steeper terrain acts as a wall when climbing
const SUPPORT_FRAC = 0.65;      // fraction of radius that must be over a box to stand on it
const EPS = 0.02;

const keyOf = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
const toVec3 = (a, out = new THREE.Vector3()) => (Array.isArray(a) ? out.set(a[0], a[1], a[2]) : out.copy(a));

export function createPhysics(_ctx) {
  const cells = new Map();
  const big = [];
  const movers = [];
  const colliders = [];
  const cand = [];              // reused candidate list
  let stamp = 1;
  let nextId = 1;
  let terrain = null;

  const _n = new THREE.Vector3();
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  // ---------------------------------------------------------------- colliders
  function insert(c) {
    const ix0 = Math.floor(c.min.x / CELL), ix1 = Math.floor(c.max.x / CELL);
    const iz0 = Math.floor(c.min.z / CELL), iz1 = Math.floor(c.max.z / CELL);
    c._cells.length = 0;
    if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > BIG_CELLS) { big.push(c); c._big = true; return; }
    c._big = false;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = keyOf(ix, iz);
        let list = cells.get(k);
        if (!list) { list = []; cells.set(k, list); }
        list.push(c);
        c._cells.push(k);
      }
    }
  }
  function unhash(c) {
    for (const k of c._cells) {
      const list = cells.get(k);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
      if (!list.length) cells.delete(k);
    }
    c._cells.length = 0;
    if (c._big) { const i = big.indexOf(c); if (i >= 0) big.splice(i, 1); c._big = false; }
  }

  /**
   * Add a static box. def: { min, max } or { center, size } (arrays or Vector3),
   * surface ('moss'|'wood'|'stone'|'mud'|'iron'), tag, data. Returns the collider.
   */
  function addBox(def) {
    const c = {
      id: nextId++,
      min: new THREE.Vector3(), max: new THREE.Vector3(),
      surface: def.surface || 'stone', tag: def.tag ?? null, data: def.data ?? null,
      enabled: true, isMover: false,
      _cells: [], _big: false, _stamp: 0,
    };
    if (def.center && def.size) {
      toVec3(def.center, _c); toVec3(def.size, _d).multiplyScalar(0.5);
      c.min.copy(_c).sub(_d); c.max.copy(_c).add(_d);
    } else {
      toVec3(def.min, c.min); toVec3(def.max, c.max);
    }
    // normalise inverted boxes
    for (const a of ['x', 'y', 'z']) if (c.min[a] > c.max[a]) { const t = c.min[a]; c.min[a] = c.max[a]; c.max[a] = t; }
    colliders.push(c);
    insert(c);
    return c;
  }

  function removeCollider(c) {
    if (!c) return;
    unhash(c);
    let i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1);
    i = movers.indexOf(c); if (i >= 0) movers.splice(i, 1);
  }

  /** Re-index a static collider after editing its min/max by hand. */
  function updateCollider(c) {
    if (c.isMover) return;
    unhash(c); insert(c);
  }

  /**
   * Turn a collider into a kinematic mover. Returns the same collider with
   *   setPosition(center | x,y,z)  move it (call once per step); records .delta
   *   center (Vector3), half (Vector3), delta (Vector3, last move)
   * Characters standing on it are carried by its motion.
   */
  function addMover(c) {
    if (c.isMover) return c;
    unhash(c);
    c.isMover = true;
    c.center = new THREE.Vector3().addVectors(c.min, c.max).multiplyScalar(0.5);
    c.half = new THREE.Vector3().subVectors(c.max, c.min).multiplyScalar(0.5);
    c.delta = new THREE.Vector3();
    c.setPosition = (x, y, z) => {
      if (typeof x === 'object') { y = Array.isArray(x) ? x[1] : x.y; z = Array.isArray(x) ? x[2] : x.z; x = Array.isArray(x) ? x[0] : x.x; }
      c.delta.set(x - c.center.x, y - c.center.y, z - c.center.z);
      c.center.set(x, y, z);
      c.min.copy(c.center).sub(c.half);
      c.max.copy(c.center).add(c.half);
    };
    movers.push(c);
    return c;
  }

  /** Fill `cand` with enabled colliders overlapping the xz rect (deduped). */
  function gather(minx, minz, maxx, maxz) {
    cand.length = 0;
    stamp++;
    const ix0 = Math.floor(minx / CELL), ix1 = Math.floor(maxx / CELL);
    const iz0 = Math.floor(minz / CELL), iz1 = Math.floor(maxz / CELL);
    if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > 4096) {
      // absurdly large query: just test everything
      for (const c of colliders) if (c.enabled && !c.isMover) { c._stamp = stamp; cand.push(c); }
    } else {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const list = cells.get(keyOf(ix, iz));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (c._stamp === stamp || !c.enabled) continue;
            c._stamp = stamp;
            if (c.max.x < minx || c.min.x > maxx || c.max.z < minz || c.min.z > maxz) continue;
            cand.push(c);
          }
        }
      }
    }
    for (let i = 0; i < big.length; i++) {
      const c = big[i];
      if (c._stamp === stamp || !c.enabled) continue;
      c._stamp = stamp; cand.push(c);
    }
    for (let i = 0; i < movers.length; i++) {
      const c = movers[i];
      if (!c.enabled) continue;
      c._stamp = stamp; cand.push(c);
    }
    return cand;
  }

  /**
   * Colliders overlapping a world box. Returns `out` (a new array if omitted).
   */
  function queryBox(min, max, out = []) {
    out.length = 0;
    gather(min.x, min.z, max.x, max.z);
    for (const c of cand) {
      if (c.max.x < min.x || c.min.x > max.x || c.max.y < min.y || c.min.y > max.y || c.max.z < min.z || c.min.z > max.z) continue;
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- terrain
  function setTerrain(t) {
    terrain = t || null;
    physics.terrain = terrain;
  }
  function terrainHeight(x, z) { return terrain ? terrain.sample(x, z) : -Infinity; }
  function terrainNormal(x, z, out) {
    if (!terrain) return out.set(0, 1, 0);
    if (terrain.normal) {
      const n = terrain.normal(x, z);
      return out.set(n.x, n.y, n.z).normalize();
    }
    const e = 0.25;
    const hx = terrain.sample(x + e, z) - terrain.sample(x - e, z);
    const hz = terrain.sample(x, z + e) - terrain.sample(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // ---------------------------------------------------------------- characters
  const circleOverlaps = (c, x, z, r) => {
    const cx = x < c.min.x ? c.min.x : x > c.max.x ? c.max.x : x;
    const cz = z < c.min.z ? c.min.z : z > c.max.z ? c.max.z : z;
    const dx = x - cx, dz = z - cz;
    return dx * dx + dz * dz < r * r;
  };

  // per-call state for moveCharacter (single-threaded, so module scratch is fine)
  let sx = 0, sy = 0, sz = 0;

  function resolveHorizontal(body, r, h, allowance) {
    const p = body.position, v = body.velocity;
    for (let iter = 0; iter < 2; iter++) {
      let any = false;
      for (let i = 0; i < cand.length; i++) {
        const c = cand[i];
        if (c.max.y <= p.y + allowance) continue;   // walkable / step-able: vertical pass handles it
        if (c.min.y >= p.y + h) continue;            // above head
        const cx = p.x < c.min.x ? c.min.x : p.x > c.max.x ? c.max.x : p.x;
        const cz = p.z < c.min.z ? c.min.z : p.z > c.max.z ? c.max.z : p.z;
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, push;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; push = r - d;
        } else {
          // centre inside the box footprint: exit along the shallowest side
          const l = p.x - c.min.x, rr = c.max.x - p.x, b = p.z - c.min.z, f = c.max.z - p.z;
          const m = Math.min(l, rr, b, f);
          if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === b) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
          push = m + r;
        }
        p.x += nx * push; p.z += nz * push;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) { v.x -= vn * nx; v.z -= vn * nz; }
        const sn = sx * nx + sz * nz;
        if (sn < 0) { sx -= sn * nx; sz -= sn * nz; }
        body.hitWall = true;
        if (body.wallNormal) body.wallNormal.set(nx, 0, nz);
        body.wallCollider = c;
        any = true;
      }
      if (!any) break;
    }
  }

  /** Steep terrain blocks climbing: undo the uphill part of a horizontal move. */
  function terrainWall(body, ox, oz) {
    if (!terrain) return;
    const p = body.position;
    const th = terrain.sample(p.x, p.z);
    if (th <= p.y + 0.05) return;
    terrainNormal(p.x, p.z, _n);
    if (_n.y >= MAX_SLOPE_COS) return;
    let hx = _n.x, hz = _n.z;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const mx = p.x - ox, mz = p.z - oz;
    const into = mx * hx + mz * hz;
    if (into >= 0) return; // moving downhill
    // slide: remove the uphill component of this substep
    p.x = ox + mx - into * hx;
    p.z = oz + mz - into * hz;
    if (terrain.sample(p.x, p.z) > p.y + 0.05) {
      terrainNormal(p.x, p.z, _n);
      if (_n.y < MAX_SLOPE_COS) { p.x = ox; p.z = oz; }
    }
    const v = body.velocity;
    const vn = v.x * hx + v.z * hz;
    if (vn < 0) { v.x -= vn * hx; v.z -= vn * hz; }
    const sn = sx * hx + sz * hz;
    if (sn < 0) { sx -= sn * hx; sz -= sn * hz; }
    body.hitWall = true;
    if (body.wallNormal) body.wallNormal.set(hx, 0, hz);
    body.wallCollider = 'terrain';
  }

  // result of findSupport
  let supY = -Infinity, supCol = null;
  /** Highest surface in [lo, hi] under the footprint. Boxes rising above `stepFrom` use the full radius. */
  function findSupport(x, z, r, lo, hi, stepFrom, allowStepRadius) {
    supY = -Infinity; supCol = null;
    const rs = r * SUPPORT_FRAC;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      const top = c.max.y;
      if (top < lo || top > hi || top <= supY) continue;
      const rad = allowStepRadius && top > stepFrom + 0.01 ? r : rs;
      if (!circleOverlaps(c, x, z, rad)) continue;
      supY = top; supCol = c;
    }
    if (terrain) {
      const th = terrain.sample(x, z);
      if (th >= lo && th > supY) { supY = th; supCol = 'terrain'; } // floor-only: always lifts
    }
  }

  /**
   * Move a character body by its velocity for dt, resolving collisions.
   * body: { position (feet), velocity, radius=0.35, height=1, stepHeight=0.4,
   *         onGround, ground, groundNormal, hitCeiling, hitWall, wallNormal?, noSnap? }
   * Writes onGround / ground (collider|'terrain'|null) / groundNormal / surface /
   * hitCeiling / hitWall / wallNormal / onSteep / stepped (height climbed this call).
   */
  function moveCharacter(body, dt) {
    const p = body.position, v = body.velocity;
    const r = body.radius ?? 0.35, h = body.height ?? 1.0;
    const stepUp = body.stepHeight ?? STEP_UP;
    if (!body.groundNormal) body.groundNormal = new THREE.Vector3(0, 1, 0);

    // 1) carried by the mover we stood on last step
    if (body._carry && body._carry.collider && body.onGround && body.ground === body._carry.collider) {
      const m = body._carry.collider;
      if (m.enabled && movers.includes(m)) {
        p.x += m.center.x - body._carry.pos.x;
        p.y += m.center.y - body._carry.pos.y;
        p.z += m.center.z - body._carry.pos.z;
      }
    }

    const wasGround = !!body.onGround;
    body.hitWall = false; body.hitCeiling = false; body.onSteep = false; body.wallCollider = null;
    body.stepped = 0;
    const startY = p.y;

    let dx = v.x * dt, dy = v.y * dt, dz = v.z * dt;
    const travel = Math.max(Math.hypot(dx, dz), Math.abs(dy));
    const n = Math.min(48, Math.max(1, Math.ceil(travel / MAX_SUB)));
    const margin = r + 0.6;
    gather(Math.min(p.x, p.x + dx) - margin, Math.min(p.z, p.z + dz) - margin,
      Math.max(p.x, p.x + dx) + margin, Math.max(p.z, p.z + dz) + margin);

    sx = dx / n; sy = dy / n; sz = dz / n;
    let grounded = false, groundCol = null;
    const allowance = wasGround ? stepUp : AIR_STEP;

    for (let i = 0; i < n; i++) {
      // --- horizontal
      const ox = p.x, oz = p.z;
      p.x += sx; p.z += sz;
      resolveHorizontal(body, r, h, allowance);
      if (sx !== 0 || sz !== 0) terrainWall(body, ox, oz);

      // --- vertical
      const oldY = p.y;
      p.y += sy;
      if (sy > 0) {
        const rc = r * 0.8;
        for (let k = 0; k < cand.length; k++) {
          const c = cand[k];
          if (c.min.y < oldY + h - EPS || c.min.y >= p.y + h) continue;
          if (!circleOverlaps(c, p.x, p.z, rc)) continue;
          p.y = c.min.y - h;
          body.hitCeiling = true;
          if (v.y > 0) v.y = 0;
          sy = 0;
        }
      }
      const hi = oldY + (sy <= 0 ? allowance : Math.min(allowance, AIR_STEP));
      findSupport(p.x, p.z, r, p.y - EPS, hi, oldY, wasGround);
      if (supCol !== null && supY >= p.y - EPS) {
        if (supCol === 'terrain') {
          terrainNormal(p.x, p.z, _n);
          if (supY > p.y) p.y = supY;
          if (_n.y < MAX_SLOPE_COS) {
            // too steep to stand: slide along the slope
            body.onSteep = true;
            const vn = v.x * _n.x + v.y * _n.y + v.z * _n.z;
            if (vn < 0) { v.x -= vn * _n.x; v.y -= vn * _n.y; v.z -= vn * _n.z; }
            if (sy < 0) sy = 0;
          } else if (v.y <= 0.01) {
            grounded = true; groundCol = 'terrain'; body.groundNormal.copy(_n);
            if (v.y < 0) v.y = 0;
            if (sy < 0) sy = 0;
          }
        } else {
          if (supY > p.y) p.y = supY;
          if (v.y <= 0.01) {
            grounded = true; groundCol = supCol; body.groundNormal.copy(UP);
            if (v.y < 0) v.y = 0;
            if (sy < 0) sy = 0;
          }
        }
      }
    }

    // 2) snap down to stay glued to slopes and small steps while walking
    if (!grounded && wasGround && v.y <= 0 && !body.noSnap) {
      const speed = Math.hypot(v.x, v.z);
      const snap = Math.max(stepUp, speed * dt * 1.3);
      findSupport(p.x, p.z, r, p.y - snap, p.y + EPS, p.y, false);
      if (supCol !== null) {
        let ok = true;
        if (supCol === 'terrain') { terrainNormal(p.x, p.z, _n); ok = _n.y >= MAX_SLOPE_COS; if (ok) body.groundNormal.copy(_n); }
        else body.groundNormal.copy(UP);
        if (ok) { p.y = supY; grounded = true; groundCol = supCol; if (v.y < 0) v.y = 0; }
      }
    }

    body.onGround = grounded;
    body.ground = groundCol;
    body.surface = groundCol === 'terrain' ? (terrain && terrain.surfaceAt ? terrain.surfaceAt(p.x, p.z) : 'moss') : groundCol ? groundCol.surface : null;
    if (!grounded) body.groundNormal.copy(UP);
    if (grounded && p.y > startY + 0.05 && wasGround) body.stepped = p.y - startY;

    // remember mover for next step's carry
    if (grounded && groundCol && groundCol.isMover) {
      if (!body._carry) body._carry = { collider: null, pos: new THREE.Vector3() };
      body._carry.collider = groundCol;
      body._carry.pos.copy(groundCol.center);
    } else if (body._carry) body._carry.collider = null;
    return body;
  }

  /** Highest walkable surface (terrain or box top) at (x,z) at or below fromY; -Infinity if none. */
  function groundHeight(x, z, fromY = Infinity) {
    let best = -Infinity;
    gather(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
    for (const c of cand) {
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      if (c.max.y <= fromY + 0.01 && c.max.y > best) best = c.max.y;
    }
    if (terrain) {
      const th = terrain.sample(x, z);
      if (th <= fromY + 0.01 && th > best) best = th;
    }
    return best;
  }

  // ---------------------------------------------------------------- raycast
  /**
   * Ray vs boxes + terrain. dir need not be normalised.
   * opts: { boxes=true, terrain=true, ignore: collider|Set|fn(c)->bool, out } -> hit | null
   * hit = { point, normal, distance, collider } (collider = box, 'terrain'). Pass opts.out
   * (an object with point/normal Vector3s) to avoid allocating in hot paths.
   */
  function raycast(origin, dir, maxDist = 100, opts = {}) {
    _o.copy(origin);
    _d.copy(dir);
    const len = _d.length();
    if (len < 1e-9) return null;
    _d.multiplyScalar(1 / len);
    let best = maxDist, bestCol = null;
    let nAxis = -1, nSign = 0;
    const ignore = opts.ignore;

    if (opts.boxes !== false) {
      stamp++;
      const testBox = (c) => {
        if (!c.enabled) return;
        if (ignore && (ignore === c || (ignore instanceof Set && ignore.has(c)) || (typeof ignore === 'function' && ignore(c)))) return;
        if (_o.x > c.min.x && _o.x < c.max.x && _o.y > c.min.y && _o.y < c.max.y && _o.z > c.min.z && _o.z < c.max.z) return; // starts inside
        let tmin = 0, tmax = best, ax = -1, sg = 0;
        for (let a = 0; a < 3; a++) {
          const o = a === 0 ? _o.x : a === 1 ? _o.y : _o.z;
          const d = a === 0 ? _d.x : a === 1 ? _d.y : _d.z;
          const mn = a === 0 ? c.min.x : a === 1 ? c.min.y : c.min.z;
          const mx = a === 0 ? c.max.x : a === 1 ? c.max.y : c.max.z;
          if (Math.abs(d) < 1e-12) { if (o < mn || o > mx) return; continue; }
          let t1 = (mn - o) / d, t2 = (mx - o) / d, s = -1;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
          if (t1 > tmin) { tmin = t1; ax = a; sg = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return;
        }
        if (ax >= 0 && tmin < best) { best = tmin; bestCol = c; nAxis = ax; nSign = sg; }
      };
      // 2D DDA over hash cells
      let ix = Math.floor(_o.x / CELL), iz = Math.floor(_o.z / CELL);
      const stepX = _d.x > 0 ? 1 : -1, stepZ = _d.z > 0 ? 1 : -1;
      const tdx = Math.abs(_d.x) > 1e-12 ? CELL / Math.abs(_d.x) : Infinity;
      const tdz = Math.abs(_d.z) > 1e-12 ? CELL / Math.abs(_d.z) : Infinity;
      let tmx = Math.abs(_d.x) > 1e-12 ? ((stepX > 0 ? (ix + 1) * CELL - _o.x : _o.x - ix * CELL) / Math.abs(_d.x)) : Infinity;
      let tmz = Math.abs(_d.z) > 1e-12 ? ((stepZ > 0 ? (iz + 1) * CELL - _o.z : _o.z - iz * CELL) / Math.abs(_d.z)) : Infinity;
      let t = 0, guard = 0;
      while (t <= best && guard++ < 2048) {
        const list = cells.get(keyOf(ix, iz));
        if (list) for (let i = 0; i < list.length; i++) { const c = list[i]; if (c._stamp !== stamp) { c._stamp = stamp; testBox(c); } }
        if (tmx < tmz) { t = tmx; tmx += tdx; ix += stepX; } else { t = tmz; tmz += tdz; iz += stepZ; }
      }
      for (const c of big) testBox(c);
      for (const c of movers) testBox(c);
    }

    let terrainHit = false;
    if (opts.terrain !== false && terrain) {
      const h0 = terrain.sample(_o.x, _o.z);
      if (_o.y >= h0) {
        const step = opts.terrainStep ?? 0.5;
        let prevT = 0, tt = step;
        const lim = best;
        while (prevT < lim) {
          if (tt > lim) tt = lim;
          const x = _o.x + _d.x * tt, y = _o.y + _d.y * tt, z = _o.z + _d.z * tt;
          if (y < terrain.sample(x, z)) {
            let a = prevT, b = tt;
            for (let k = 0; k < 10; k++) {
              const m = (a + b) * 0.5;
              if (_o.y + _d.y * m < terrain.sample(_o.x + _d.x * m, _o.z + _d.z * m)) b = m; else a = m;
            }
            best = (a + b) * 0.5; bestCol = 'terrain'; terrainHit = true;
            break;
          }
          if (tt >= lim) break;
          prevT = tt; tt += step;
        }
      }
    }

    if (bestCol === null) return null;
    const out = opts.out || { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, collider: null };
    out.point.copy(_o).addScaledVector(_d, best);
    out.distance = best;
    out.collider = bestCol;
    if (terrainHit) terrainNormal(out.point.x, out.point.z, out.normal);
    else out.normal.set(nAxis === 0 ? nSign : 0, nAxis === 1 ? nSign : 0, nAxis === 2 ? nSign : 0);
    return out;
  }

  /** First collider (or 'terrain') touching the sphere, else null. */
  function sphereHitsWorld(center, radius) {
    gather(center.x - radius, center.z - radius, center.x + radius, center.z + radius);
    const r2 = radius * radius;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      const cx = Math.max(c.min.x, Math.min(center.x, c.max.x));
      const cy = Math.max(c.min.y, Math.min(center.y, c.max.y));
      const cz = Math.max(c.min.z, Math.min(center.z, c.max.z));
      const dx = center.x - cx, dy = center.y - cy, dz = center.z - cz;
      if (dx * dx + dy * dy + dz * dz < r2) return c;
    }
    if (terrain && center.y - radius < terrain.sample(center.x, center.z)) return 'terrain';
    return null;
  }

  const physics = {
    waterLevel: 0,
    terrain: null,
    colliders, movers,
    STEP_UP, MAX_SLOPE_COS,
    addBox, removeCollider, updateCollider, addMover, queryBox,
    setTerrain, terrainHeight,
    terrainNormal: (x, z, out = new THREE.Vector3()) => terrainNormal(x, z, out),
    moveCharacter, groundHeight, raycast, sphereHitsWorld,
    /** Remove everything (colliders, movers, terrain). */
    clear() {
      colliders.length = 0; movers.length = 0; big.length = 0; cells.clear(); terrain = null; physics.terrain = null;
    },
  };
  return physics;
}
