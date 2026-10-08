// EntityManager + type registry for level spawns.
//
// An entity is any object with:
//   { object3d, tags:Set<string>, alive:true, radius, team:'player'|'enemy'|'neutral',
//     update(dt, ctx), dispose(ctx), hurt?(amount, info) -> boolean, position (getter -> object3d.position) }
// Optional: height (hit capsule height, default 2*radius), type, uid (assigned).
//
// Despawn with entities.remove(e) or by setting e.alive = false; removal is deferred
// to the end of the step and dispose(ctx) is called exactly once.
import * as THREE from 'three';

/**
 * Convenience base class (optional). Usage:
 *   class Grunt extends Entity { constructor(ctx, def) { super(ctx, { tags:['enemy','grunt'], team:'enemy', radius:0.6 }); ... } update(dt, ctx) {...} }
 */
export class Entity {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.object3d = opts.object3d || new THREE.Group();
    this.tags = new Set(opts.tags || []);
    this.alive = true;
    this.radius = opts.radius ?? 0.5;
    this.height = opts.height ?? this.radius * 2;
    this.team = opts.team || 'neutral';
    this.type = opts.type || null;
  }
  get position() { return this.object3d.position; }
  update(_dt, _ctx) {}
  dispose(_ctx) {}
}

export function createEntities(ctx) {
  const list = [];
  const types = new Map();
  const warned = new Set();
  const queries = new Map(); // tag -> reused result array
  const pending = [];        // deferred removals
  let nextUid = 1;
  let placeholderMat = null;
  const _v = new THREE.Vector3();

  function posOf(e) { return e.position || e.object3d.position; }

  function add(e) {
    if (!e || list.includes(e)) return e;
    if (e.alive === undefined) e.alive = true;
    if (!e.tags) e.tags = new Set();
    if (e.uid === undefined) e.uid = nextUid++;
    if (e.object3d && !e.object3d.parent && ctx.scene) ctx.scene.add(e.object3d);
    list.push(e);
    return e;
  }

  function remove(e) {
    if (!e) return;
    e.alive = false;
    if (!pending.includes(e)) pending.push(e);
  }

  function destroy(e) {
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    if (e.object3d && e.object3d.parent) e.object3d.parent.remove(e.object3d);
    if (!e._disposed) {
      e._disposed = true;
      try { e.dispose && e.dispose(ctx); } catch (err) { console.error('[entities] dispose failed', err); }
    }
  }

  /** Apply deferred removals (called by the loop after every step). */
  function flush() {
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].alive && !pending.includes(list[i])) pending.push(list[i]);
    while (pending.length) destroy(pending.pop());
  }

  function update(dt) {
    const n = list.length; // entities added during the loop start updating next step
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (!e || !e.alive || !e.update) continue;
      e.update(dt, ctx);
    }
    flush();
  }

  /** Live entities carrying `tag`. Returns a reused array (valid until the next query of that tag). */
  function query(tag) {
    let out = queries.get(tag);
    if (!out) { out = []; queries.set(tag, out); }
    out.length = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive && e.tags.has(tag)) out.push(e);
    }
    return out;
  }

  /** Nearest live entity with `tag` within maxDist of position (optional filter(e) -> bool). */
  function nearest(tag, position, maxDist = Infinity, filter = null) {
    let best = null, bestD = maxDist * maxDist;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || !e.tags.has(tag)) continue;
      const d = posOf(e).distanceToSquared(position);
      if (d > bestD) continue;
      if (filter && !filter(e)) continue;
      best = e; bestD = d;
    }
    return best;
  }

  function registerType(name, factory) {
    types.set(name, factory);
  }

  /** spawnDef = { type, pos:[x,y,z], yaw?, ...params } -> entity | null */
  function spawn(def) {
    const factory = types.get(def.type);
    if (!factory) return spawnPlaceholder(def);
    const e = factory(ctx, def);
    if (e && typeof e === 'object' && e.object3d) {
      if (!e.type) e.type = def.type;
      add(e);
      return e;
    }
    return e || null;
  }

  function spawnPlaceholder(def) {
    if (!warned.has(def.type)) {
      warned.add(def.type);
      console.warn(`[entities] no factory registered for type "${def.type}" — adding a placeholder marker`);
    }
    if (!placeholderMat) placeholderMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), placeholderMat);
    m.position.y = 0.6;
    g.add(m);
    const label = makeLabel(def.type);
    label.position.y = 1.3;
    g.add(label);
    const p = def.pos || [0, 0, 0];
    g.position.set(p[0], p[1], p[2]);
    const e = {
      type: def.type, def, object3d: g, tags: new Set(['placeholder']), alive: true, radius: 0.4, team: 'neutral',
      get position() { return g.position; },
      update(dt) { m.rotation.y += dt * 1.5; },
      dispose() { m.geometry.dispose(); label.material.map.dispose(); label.material.dispose(); },
    };
    return add(e);
  }

  function makeLabel(text) {
    const tex = ctx.materials.canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = 'rgba(20,10,30,0.75)'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff9df0'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(text), w / 2, h / 2);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    s.scale.set(1.6, 0.4, 1);
    return s;
  }

  function clear() {
    for (const e of list.slice()) { e.alive = false; destroy(e); }
    pending.length = 0;
  }

  /** Count live entities per tag (debug). */
  function countByTag() {
    const out = {};
    for (const e of list) if (e.alive) for (const t of e.tags) out[t] = (out[t] || 0) + 1;
    return out;
  }

  return {
    list, types,
    add, remove, update, flush, query, nearest, registerType, spawn, clear, countByTag,
    hasType: (name) => types.has(name),
    /** Hit-capsule centre helper: point on the entity's vertical axis closest to p. */
    closestAxisPoint(e, p, out = _v) {
      const pos = posOf(e);
      const h = e.height ?? (e.radius || 0.5) * 2;
      const y = Math.max(pos.y, Math.min(p.y, pos.y + h));
      return out.set(pos.x, y, pos.z);
    },
  };
}
