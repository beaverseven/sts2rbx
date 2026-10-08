// Grunt checks: notices Morel, chases, telegraphed swing hits him; the swing can be dodged;
// 3 quick puffs or 1 charged puff kill a grunt (200 points).
//   node tools/scenario.mjs tools/scenarios/enemies-grunt.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots
import { installEnemyHelpers } from './enemies-helpers.mjs';

export default async function (page, h) {
  await h.wait(300);
  await installEnemyHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  await h.game((g) => g.setQuality('high'));

  // --- 1. notice -> alert -> chase -> wind-up (screenshot) -> hit
  const r1 = await h.game((g) => {
    const et = window.__et;
    et.clear(); g.clearEvents(); g.setInput(null); g.godMode(false);
    const pl = g.ctx.player; pl.hp = pl.maxHp;
    g.teleport(0, 1, -4, 0); g.setCamera(0, 0.25, 7.5);
    const grunt = et.lastGrunt = et.spawn({ type: 'grunt', pos: [0, 1, 7], yaw: Math.PI, patrol: 0 });
    g.step(2);
    const tAlert = et.until(() => et.count('enemy:alert') > 0, 120);
    const alert = g.events('enemy:alert')[0];
    const startDist = grunt.pdist;
    const tWindup = et.until(() => grunt.state === 'windup', 400);
    const distAtWindup = +grunt.pdist.toFixed(2);
    g.step(17);
    const p = grunt.position;
    et.cam([p.x + 2.6, p.y + 1.4, p.z - 1.2], [p.x - 0.3, p.y + 1.0, p.z - 0.6]);
    return { tAlert, alertPayload: alert && alert.payload, startDist: +startDist.toFixed(2), tWindup, distAtWindup, state: grunt.state };
  });
  await h.wait(450);
  await h.shot('grunt-windup');
  const r1b = await h.game((g) => {
    const et = window.__et, grunt = et.lastGrunt;
    const tSwing = et.until(() => grunt.state === 'swing' && grunt.stateT > 0.09, 60);
    const p = grunt.position;
    et.cam([p.x + 2.6, p.y + 1.4, p.z - 1.2], [p.x - 0.3, p.y + 0.9, p.z - 0.6]);
    return { tSwing, hurt: g.events('player:hurt').map((e) => e.payload) };
  });
  await h.wait(450);
  await h.shot('grunt-swing');
  check('grunt notices Morel (enemy:alert with entity + type)', r1.tAlert >= 0 && r1.alertPayload && r1.alertPayload.type === 'grunt' && r1.alertPayload.entity === 'grunt', r1);
  check('grunt chases and winds up in reach', r1.tWindup > 0 && r1.distAtWindup < 2.0 && r1.startDist > 9, r1);
  check('the swing hits Morel for 1', r1b.hurt.length === 1 && r1b.hurt[0].amount === 1 && r1b.hurt[0].hp === 4, r1b);

  // --- 2. the wind-up is a fair telegraph: backing off during it dodges the swing
  const r2 = await h.game((g) => {
    const et = window.__et;
    et.clear(); g.clearEvents(); g.setInput(null);
    const pl = g.ctx.player; pl.hp = pl.maxHp;
    g.step(90); // let the invulnerability from the last hit run out
    g.teleport(0, 1, 2, 0); g.setCamera(0, 0.25, 7.5);
    const grunt = et.spawn({ type: 'grunt', pos: [0, 1, 6], yaw: Math.PI, patrol: 0, aggro: true });
    const tWindup = et.until(() => grunt.state === 'windup', 400);
    // react within ~0.15 s: run straight back
    g.step(9);
    g.setInput({ move: [0, -1] });
    et.until(() => grunt.state === 'recover', 60);
    g.setInput(null);
    return { tWindup, hurt: et.count('player:hurt'), dist: +grunt.pdist.toFixed(2) };
  });
  check('backing off during the wind-up dodges the swing', r2.tWindup > 0 && r2.hurt === 0, r2);

  // --- 3. three quick puffs kill a grunt
  const r3 = await h.game((g) => {
    const et = window.__et;
    et.clear(); g.clearEvents(); g.setInput(null); g.godMode(true);
    g.teleport(0, 1, 0, 0); g.setCamera(0, 0.25, 7.5);
    const grunt = et.spawn({ type: 'grunt', pos: [0, 1, 7], yaw: Math.PI, patrol: 0, noticeRange: 0 });
    g.step(5);
    for (let k = 0; k < 3; k++) { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(17); }
    et.until(() => !grunt.alive, 60);
    return {
      throws: et.count('player:throw'),
      hurt: g.events('enemy:hurt').map((e) => [e.payload.type, e.payload.amount, e.payload.hp]),
      killed: g.events('enemy:killed').map((e) => e.payload),
      alive: grunt.alive,
    };
  });
  check('3 quick puffs kill a grunt (2x enemy:hurt, then enemy:killed 200)', r3.throws === 3 && r3.hurt.length === 2 && r3.killed.length === 1 && r3.killed[0].type === 'grunt' && r3.killed[0].points === 200 && !r3.alive, r3);

  // --- 4. one charged puff kills a grunt (death screenshot: spin up + pot clatters away)
  const r4 = await h.game((g) => {
    const et = window.__et;
    et.clear(); g.clearEvents(); g.setInput(null);
    g.teleport(0, 1, 0, 0); g.setCamera(0, 0.25, 7.5);
    const grunt = et.lastGrunt = et.spawn({ type: 'grunt', pos: [0, 1, 7], yaw: Math.PI, patrol: 0, noticeRange: 0 });
    g.step(5);
    g.setInput({ throw: true }); g.step(58); g.setInput({});
    const t = et.until(() => grunt.dying, 40);
    g.step(14);
    const p = grunt.position;
    et.cam([p.x + 3.2, p.y + 1.6, p.z - 3.2], [p.x, p.y + 1.3, p.z]);
    return { t, hits: g.events('projectile:hit').map((e) => [e.payload.target, e.payload.damage]), killed: g.events('enemy:killed').map((e) => e.payload.type), hurt: et.count('enemy:hurt') };
  });
  await h.wait(450);
  await h.shot('grunt-death');
  check('one charged puff (3 dmg) kills a grunt', r4.hits.length === 1 && r4.hits[0][1] === 3 && r4.killed.length === 1 && r4.hurt === 0, r4);
  const r5 = await h.game((g) => { g.step(30); return { props: g.ctx.enemies.fx.props.length, bandits: g.ctx.enemies.list().length }; });
  check('tin pot clatters away as a short-lived prop; grunt despawned', r5.props >= 1 && r5.bandits === 0, r5);
  await h.game((g) => { g.step(200); });
  const r6 = await h.game((g) => ({ props: g.ctx.enemies.fx.props.length }));
  check('props clean themselves up', r6.props === 0, r6);
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}
