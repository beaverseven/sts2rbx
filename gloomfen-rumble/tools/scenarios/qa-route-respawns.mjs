// QA route playtest: what a death respawn at each checkpoint looks like when the nearby bandits are still alive
// (the player ran past them, lit the lantern, then died). Fresh run per checkpoint; Morel walks up to the
// lantern from the route side, then dies; after the 1.4 s splat we watch 4 s of a player who is just getting
// their bearings (no input), and screenshot the respawn view.
//   node tools/scenario.mjs tools/scenarios/qa-route-respawns.mjs --html dist/index.html --shots dist/qa-route
import { bootQA, qshot } from './qa-route-helpers.mjs';

export default async function (page, h) {
  await bootQA(page, h);
  const out = {};
  const cps = [
    // id, approach start (x, z) on the route before the lantern, lantern (x, z)
    ['glade', [0, 89], [0, 100]],
    ['bog', [6, 226], [0, 239]],
    ['fort', [0, 343], [0, 352]],
    ['pit', [0, 356], [0, 366]],
  ];
  for (const [id, from, to] of cps) {
    out[id] = await h.game((g, a) => {
      const Q = window.__qa, ctx = g.ctx, pl = ctx.player;
      ctx.flow.newRun(); g.step(2);
      const y = ctx.level.groundY(a.from[0], a.from[1], 40);
      pl.respawnAt([a.from[0], y, a.from[1]], 0); ctx.cameraRig.snapBehind(); g.step(5);
      if (a.id === 'pit' || a.id === 'fort') { ctx.flags.gateFortOpen = true; }
      const w = Q.walk(a.to[0], a.to[1], { tol: 0.6, aim: false });
      const cpOk = pl.checkpoint.id;
      g.step(60);                                      // a second at the lantern: bandits notice
      const before = Q.near('bandit', 14);
      pl.damage(pl.hp, null);                          // dies (e.g. the bandits got him)
      for (let i = 0; i < 240 && ctx.state !== 'playing'; i++) g.step(1);
      for (let i = 0; i < 200 && (ctx.state !== 'playing' || pl.state === 'dead'); i++) g.step(1);
      const m = Q.mark();
      const atRespawn = { pos: Q.pos(), hp: pl.hp, bandits: Q.near('bandit', 14) };
      let firstHurt = null;
      for (let i = 0; i < 240; i++) { g.step(1); if (firstHurt === null && Q.since(m, 'player:hurt').length) firstHurt = +(i / 60).toFixed(2); }
      return { walk: w.ok, checkpoint: cpOk, beforeDeath: before, atRespawn, hurtsIn4s: Q.since(m, 'player:hurt').length, firstHurtAfter_s: firstHurt, hpAfter4s: pl.hp, state: ctx.state };
    }, { id, from, to });
    // respawn view: die again, screenshot right after the respawn pop
    await h.game((g) => {
      const ctx = g.ctx, pl = ctx.player;
      if (ctx.state === 'playing' && pl.state !== 'dead') pl.damage(pl.hp, null);
      for (let i = 0; i < 240 && ctx.state !== 'playing'; i++) g.step(1);
      g.step(20);
    });
    await qshot(page, h, `respawn-${id}`);
  }
  return out;
}
