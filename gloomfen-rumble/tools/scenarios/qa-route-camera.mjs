// QA route playtest: the chase camera along the whole route spine. At points every ~3 m along data.ROUTE,
// Morel stands facing the next route point; after the camera settles (default chase view, no camera input)
// we record the collision pull-in distance and what (if anything) sits between the lens and Morel
// (THREE.Raycaster against the rendered scene, Morel/particles/sky excluded). Then 8 orbit yaws per point
// for the tightest pull-in. Screenshots of the worst default views go to dist/qa-route/cam-*.png.
//   node tools/scenario.mjs tools/scenarios/qa-route-camera.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const res = await h.game((g) => {
    const ctx = g.ctx, pl = ctx.player, THREE = ctx.THREE;
    g.godMode(true);
    for (const e of ctx.entities.query('bandit')) e.alive = false; g.step(2);
    const route = ctx.level.data.ROUTE;
    const pts = [];
    for (let i = 0; i < route.length - 1; i++) {
      const [x0, z0] = route[i], [x1, z1] = route[i + 1];
      const d = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(d / 3));
      for (let k = 0; k < n; k++) pts.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n, Math.atan2(x1 - x0, z1 - z0)]);
    }
    const rc = new THREE.Raycaster();
    const owner = (o) => {
      for (let p = o; p; p = p.parent) {
        if (p === pl.model || p === pl.object3d || (pl.model && pl.model.visual === p)) return 'morel';
        for (const e of ctx.entities.list) if (e.object3d === p) return 'entity:' + (e.type || '?');
      }
      return null;
    };
    const rows = [];
    for (const [x, z, yaw] of pts) {
      const y = ctx.level.groundY(x, z, 60);
      if (!(y > 0.3)) continue;                       // water: skip (pads / rafts)
      pl.respawnAt([x, y, z], yaw); ctx.cameraRig.snapBehind(); g.step(20);
      ctx.scene.updateMatrixWorld();
      const cam = ctx.camera.position.clone();
      const target = pl.position.clone(); target.y += 0.6;
      const dir = target.clone().sub(cam); const dist = dir.length(); dir.normalize();
      rc.set(cam, dir); rc.far = dist - 0.35; rc.near = 0.05;
      const hitsRaw = rc.intersectObjects(ctx.scene.children, true);
      const hits = [];
      for (const hh of hitsRaw) {
        const o = hh.object;
        if (!o.visible || o.isPoints || o.isSprite || o.isLine) continue;
        const ow = owner(o);
        if (ow === 'morel') continue;
        let vis = true; for (let p = o; p; p = p.parent) if (p.visible === false) { vis = false; break; }
        if (!vis) continue;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && (m.side === THREE.BackSide)) continue;  // outline hulls
        if (m && m.transparent && m.opacity < 0.2) continue;
        hits.push({ what: ow || o.name || (o.isInstancedMesh ? 'instanced' : (m && m.type) || 'mesh'), d: +hh.distance.toFixed(2) });
        if (hits.length >= 3) break;
      }
      let minOrbit = 99, minYaw = null;
      for (let k = 0; k < 8; k++) {
        const yy = yaw + k * Math.PI / 4;
        ctx.cameraRig.setView(yy, 0.222, 7.5); g.step(4);
        if (ctx.cameraRig.currentDistance < minOrbit) { minOrbit = ctx.cameraRig.currentDistance; minYaw = k; }
      }
      ctx.cameraRig.snapBehind(); g.step(2);
      rows.push({ at: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], yaw: +yaw.toFixed(2), behind: +dist.toFixed(2), block: hits, minOrbit: +minOrbit.toFixed(2), minYaw });
    }
    return rows;
  });
  const blocked = res.filter((r) => r.block.length || r.behind < 4);
  const tight = res.filter((r) => r.minOrbit < 1.2);
  // screenshots of the worst default views (up to 8)
  const worst = blocked.slice().sort((a, b) => (a.block[0] ? a.block[0].d : 9) - (b.block[0] ? b.block[0].d : 9)).slice(0, 8);
  for (const w of worst) {
    await h.game((g, a) => { const pl = g.ctx.player; pl.respawnAt(a.at, a.yaw); g.ctx.cameraRig.snapBehind(); g.step(20); }, w);
    await qshot(page, h, `cam-${w.at[0]}_${w.at[2]}`, 1000);
  }
  return { points: res.length, blockedDefaultView: blocked, tightOrbit: tight.map((r) => `${r.at.join(',')} minOrbit ${r.minOrbit} (yaw+${r.minYaw}x45)`) };
}
