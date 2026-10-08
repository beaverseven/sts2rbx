// QA: is there ANY standable surface (ground, crates, walls, roofs) within 24 m of a fort tower slinger
// with a clear straight line from Morel's hand to the slinger's body? (sampled every 0.75 m)
//   node tools/scenario.mjs tools/scenarios/qa-combat-towergrid2.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';

export default async function (page) {
  await bootPlaying(page);
  await installQA(page);
  return await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, THREE = ctx.THREE;
    const towers = ctx.entities.query('slinger').filter((e) => e.position.y > 11 && e.position.z > 260).slice();
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    const res = [];
    for (const s of towers) {
      const r = { pos: [s.position.x, s.position.y, s.position.z], surfaces: 0, clear: [], eyeClear: 0 };
      for (let x = s.position.x - 24; x <= s.position.x + 24; x += 0.75) {
        for (let z = s.position.z - 24; z <= s.position.z + 24; z += 0.75) {
          const gy = ctx.physics.groundHeight(x, z, 40);
          if (!(gy > 0.5) || Math.hypot(x - s.position.x, z - s.position.z) < 1.5) continue;
          if (Math.abs(gy - s.position.y) < 0.2 && Math.hypot(x - s.position.x, z - s.position.z) < 3) continue; // its own platform
          r.surfaces++;
          o.set(x, gy + 0.55, z);
          d.set(s.position.x, s.position.y + s.height * 0.5, s.position.z).sub(o);
          const dist = d.length();
          const hit = ctx.physics.raycast(o, d.normalize(), dist);
          if (!hit || hit.distance >= dist - 0.6) r.clear.push([+x.toFixed(2), +gy.toFixed(2), +z.toFixed(2)]);
        }
      }
      r.clearCount = r.clear.length; r.clear = r.clear.slice(0, 12);
      // the slinger's own platform: how high is the parapet around it?
      const up = ctx.physics.groundHeight(s.position.x, s.position.z, 40);
      const ring = [];
      for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4; ring.push(+ctx.physics.groundHeight(s.position.x + Math.sin(ang) * 1.8, s.position.z + Math.cos(ang) * 1.8, 40).toFixed(2)); }
      r.platformTop = +up.toFixed(2); r.ringTops = ring;
      res.push(r);
    }
    return res;
  });
}
