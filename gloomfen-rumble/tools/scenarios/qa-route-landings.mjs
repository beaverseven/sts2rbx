// QA route playtest: bandits waiting at jump landings (island B2, island B3, the cliff top after the updraft)
// and at checkpoints. Each trial starts a fresh run (flow.newRun) and begins on the platform before the jump.
// Two player styles after landing: "passive" keeps moving along the route; "react" waits 0.5 s then fights.
//   node tools/scenario.mjs tools/scenarios/qa-route-landings.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const res = await h.game((g) => {
    const Q = window.__qa, L = window.__lv, ctx = g.ctx, pl = ctx.player;
    const hurtsSince = (m) => Q.log.slice(m).filter((e) => e.n === 'player:hurt');
    const fresh = (x, y, z, yaw) => {
      ctx.flow.newRun(); g.step(2);
      ctx.player.respawnAt([x, y, z], yaw); ctx.cameraRig.snapBehind(); g.step(5);
    };
    const runFor = (tx, tz, steps) => { for (let i = 0; i < steps; i++) { L.aim(tx, tz); g.setInput({ move: [0, 1] }); g.step(1); } g.setInput({}); };
    const trials = {};
    const N = 3;
    // --- B2 from stump 5
    for (const style of ['passive', 'react']) {
      const rows = [];
      for (let k = 0; k < N; k++) {
        fresh(1.0, 2.1, 140.6, 0);
        g.step(30 + k * 20);                 // let the island grunts wander differently each time
        const j = Q.jump({ x: 0, y: 1.5, z: 147 }, { tol: 2.5 });
        const m = Q.mark();
        const near = Q.near('grunt', 4);
        if (style === 'passive') runFor(0, 156, 150); else { g.step(30); Q.fightAll(12, { maxSteps: 600 }); }
        rows.push({ landed: j.landing, gruntWithin4mAtLanding: near.map((n) => `${n.d}m ${n.state}`), hurts: hurtsSince(m).length, hpAfter: pl.hp });
      }
      trials['B2 ' + style] = rows;
    }
    // --- B3 from lily pad 4 -> pad 5 -> B3
    for (const style of ['passive', 'react']) {
      const rows = [];
      for (let k = 0; k < N; k++) {
        fresh(0, 1.5, 156, 0);
        g.step(20 + k * 25);
        for (const [x, z] of [[0, 160.5], [-1.4, 164.0], [0.6, 167.5], [-1.0, 171.0], [0, 174.5]]) Q.jump({ x, y: 0.36, z }, { tol: 1.0 });
        const j = Q.jump({ x: 0, y: 1.25, z: 180.0 }, { tol: 2.2 });
        const m = Q.mark();
        const near = Q.near('grunt', 4);
        if (style === 'passive') runFor(0, 184.6, 90); else { g.step(30); Q.fightAll(12, { maxSteps: 600 }); }
        rows.push({ landed: j.landing, ok: j.ok, gruntWithin4mAtLanding: near.map((n) => `${n.d}m ${n.state}`), hurts: hurtsSince(m).length, hpAfter: pl.hp });
      }
      trials['B3 ' + style] = rows;
    }
    // --- cliff top with the updraft, from island B4
    for (const style of ['passive', 'react']) {
      const rows = [];
      for (let k = 0; k < N; k++) {
        fresh(9, 1.5, 214.0, 0);
        g.step(20 + k * 25);
        Q.walk(9, 215.6, { tol: 0.5 });
        const j = Q.jump({ x: 8, y: 9, z: 225.5 }, { updraft: true, riseTo: 10.6, jumpAt: 6.8, tol: 3, maxSteps: 900 });
        const m = Q.mark();
        const near = Q.near('grunt', 4);
        if (style === 'passive') runFor(0, 239, 150); else { g.step(30); Q.fightAll(12, { maxSteps: 600 }); }
        rows.push({ landed: j.landing, ok: j.ok, gruntWithin4mAtLanding: near.map((n) => `${n.d}m ${n.state}`), hurts: hurtsSince(m).length, hpAfter: pl.hp });
      }
      trials['cliff ' + style] = rows;
    }
    return trials;
  });
  return res;
}
