// QA route playtest: can the slingers perched on tower platforms be hit from the ground at all?
// For each tower slinger: ground spots on rings (6/10/14/18 m, 8 directions), lock on, 3 quick puffs + 1
// fully charged puff; tally what each puff hits. God mode, other bandits removed.
//   node tools/scenario.mjs tools/scenarios/qa-route-towers.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = await h.game((g) => {
    const ctx = g.ctx, pl = ctx.player, Q = window.__qa;
    g.godMode(true);
    const hits = [];
    ctx.events.on('projectile:hit', (p) => { if (p.kind === 'mud') return; const c = p.collider; hits.push(p.target ? 'slinger' : 'world:' + (c ? (typeof c === 'string' ? c : (c.tag || c.surface || 'box')) : '?')); });
    const res = {};
    const only = (window.__towerOnly || null); const process_only = only ? (sp) => Math.abs(sp[2] - only) < 1 : null;
    const slingers = () => ctx.entities.query('slinger').filter((e) => e.alive !== false && e.position.y > 12);
    const list = slingers().map((s) => [s.position.x, s.position.y, s.position.z]).filter((sp) => !process_only || process_only(sp));
    for (const sp of list) {
      const key = sp.map((v) => +v.toFixed(1)).join(',');
      const rows = [];
      let anyHit = 0, spots = 0;
      for (const d of [6, 10, 14, 18]) {
        for (let k = 0; k < 8; k++) {
          ctx.flow.newRun(); g.step(1); g.godMode(true);
          for (const e of ctx.entities.query('bandit')) if (!(e.type === 'slinger' && Math.hypot(e.position.x - sp[0], e.position.z - sp[2]) < 0.5)) e.alive = false;
          g.step(2);
          const s = ctx.entities.query('slinger').find((e) => e.alive !== false && Math.hypot(e.position.x - sp[0], e.position.z - sp[2]) < 0.5);
          const a = k / 8 * Math.PI * 2;
          const x = sp[0] + Math.sin(a) * d, z = sp[2] + Math.cos(a) * d;
          const gy = ctx.level.groundY(x, z, sp[1] - 1.5);
          // only ground the player can stand on near the tower's base level (skip walls / out-of-level)
          if (!(gy > sp[1] - 9) || !(gy < sp[1] - 3.5)) continue;
          pl.respawnAt([x, gy, z], Math.atan2(sp[0] - x, sp[2] - z)); g.setCamera(Math.atan2(sp[0] - x, sp[2] - z), 0.3, 7.5); g.step(3);
          if (Math.hypot(pl.position.x - x, pl.position.z - z) > 0.6) continue;
          spots++;
          hits.length = 0;
          g.setInput({ lock: true }); g.step(2);
          const locked = pl.lockTarget === s;
          for (let t = 0; t < 3; t++) { g.setInput({ lock: true, throw: true }); g.step(1); g.setInput({ lock: true }); g.step(24); }
          g.setInput({ lock: true, throw: true }); g.step(60); g.setInput({ lock: true }); g.step(40);
          g.setInput({}); g.step(2);
          const hitS = hits.filter((x2) => x2 === 'slinger').length;
          if (hitS) anyHit++;
          rows.push({ d, dir: k, at: [+x.toFixed(1), +gy.toFixed(1), +z.toFixed(1)], locked, hits: hits.slice() });
        }
      }
      res[key] = { spotsTried: spots, spotsWithAHit: anyHit, sample: rows.filter((r) => r.d === 10 || r.d === 18).slice(0, 6).map((r) => `${r.d}m dir${r.dir} lock=${r.locked} -> ${r.hits.join('|')}`) };
    }
    return res;
  });
  return out;
}
