// QA: from which yard spots can a fort tower slinger see Morel, and can a puff reach it?
// Samples a grid of standing spots (teleport, settle) and runs the slinger's own LOS test plus a straight
// raycast from Morel's throwing hand to the slinger's body centre. Then fires real charged throws from the
// best-looking spot to confirm.
//   node tools/scenario.mjs tools/scenarios/qa-combat-towergrid.mjs --html dist/index.html --shots dist/qa-combat
import { bootPlaying, installQA } from './qa-combat-helpers.mjs';

export default async function (page) {
  await bootPlaying(page);
  await installQA(page);
  return await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, qa = window.__qa, THREE = ctx.THREE, pl = ctx.player;
    g.gotoCheckpoint('fort'); g.step(2);
    for (const e of ctx.enemies.list()) if (e.type !== 'slinger') e.alive = false;
    g.step(2);
    const towers = ctx.entities.query('slinger').filter((e) => e.position.y > 11).slice();
    const res = {};
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const s of towers) {
      const key = `${s.position.x},${s.position.z}`;
      const r = res[key] = { pos: [s.position.x, s.position.y, s.position.z], spots: 0, seen: 0, puffClear: 0, both: 0, bestSpot: null };
      for (let x = s.position.x - 18; x <= s.position.x + 18; x += 1.5) {
        for (let z = s.position.z - 18; z <= s.position.z + 18; z += 1.5) {
          const gy = ctx.physics.groundHeight(x, z, 9);
          if (!(gy > 6.5 && gy < 7.6)) continue;            // yard floor only
          if (Math.hypot(x - s.position.x, z - s.position.z) < 2) continue;
          pl.teleport([x, gy, z]);
          r.spots++;
          s.perceive(0);
          const sees = s.lineOfSight() && s.pdist <= 16 && Math.abs(s.pdy) <= 6;
          o.set(x, gy + 0.55, z);
          d.set(s.position.x, s.position.y + s.height * 0.5, s.position.z).sub(o);
          const dist = d.length();
          const hit = ctx.physics.raycast(o, d.normalize(), dist);
          const clear = !hit || hit.distance >= dist - 0.6;
          if (sees) r.seen++;
          if (clear) r.puffClear++;
          if (clear && sees) { r.both++; if (!r.bestSpot) r.bestSpot = [x, gy, z]; }
          if (clear && !r.anyClear) r.anyClear = [x, gy, z];
        }
      }
    }
    // real throws from the first spot with a clear line (if any)
    const s = towers[0], key = `${s.position.x},${s.position.z}`;
    const spot = res[key].anyClear;
    let real = null;
    if (spot) {
      pl.respawnAt(spot, Math.atan2(s.position.x - spot[0], s.position.z - spot[2]));
      g.step(2);
      const hits = [];
      const off = ctx.events.on('projectile:hit', (p) => { if (p.kind !== 'mud') hits.push(p.target ? p.target.type : (p.collider && p.collider.tag) || 'world'); });
      ctx.cameraRig.setView(Math.atan2(s.position.x - spot[0], s.position.z - spot[2]), 0.3, 7.5);
      g.setInput({ lock: true }); g.step(1);
      const lt = pl.lockTarget;
      for (let k = 0; k < 4; k++) { g.setInput({ lock: true, throw: true }); g.step(58); g.setInput({ lock: true }); g.step(25); }
      off(); g.setInput({}); g.step(2);
      real = { spot, lock: lt && lt.type, lockIsTower: lt === s, hits, slingerHp: s.hp, alive: s.alive && !s.dying };
    }
    return { towers: res, real };
  });
}
