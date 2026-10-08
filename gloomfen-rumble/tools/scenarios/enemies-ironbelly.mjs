// Ironbelly checks: puffs (quick and charged) clang off the cauldron (deflected, no hurt/killed),
// an Anvil Tonic iron ball breaks it (armor:break), then he is vulnerable (400 points);
// the belly-flop shockwave hurts grounded Morel and is cleared by a jump.
//   node tools/scenario.mjs tools/scenarios/enemies-ironbelly.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots
import { installEnemyHelpers } from './enemies-helpers.mjs';

export default async function (page, h) {
  await h.wait(300);
  await installEnemyHelpers(page);
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); h.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
  await h.game((g) => g.setQuality('high'));

  // --- 1. puffs deflect
  const r1 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null); g.godMode(true); ctx.player.setTonic(null);
    g.teleport(0, 1, 0, 0); g.setCamera(0, 0.25, 7.5);
    const ib = et.ib = et.spawn({ type: 'ironbelly', pos: [0, 1, 7], yaw: Math.PI, patrol: 0, noticeRange: 0 });
    g.step(5);
    for (let k = 0; k < 3; k++) { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(17); }
    g.setInput({ throw: true }); g.step(58); g.setInput({}); g.step(30); // charged
    return {
      hits: g.events('projectile:hit').map((e) => [e.payload.target, e.payload.kind, e.payload.deflected]),
      hurt: et.count('enemy:hurt'), killed: et.count('enemy:killed'), armor: et.count('armor:break'), hp: ib.hp, armored: ib.armored,
    };
  });
  check('quick + charged puffs clang off the cauldron (deflected, no hurt/killed/points)', r1.hits.length === 4 && r1.hits.every((x) => x[0] === 'ironbelly' && x[2] === true) && r1.hurt === 0 && r1.killed === 0 && r1.armor === 0 && r1.hp === 4 && r1.armored, r1);

  // --- 2. an iron ball breaks the cauldron
  const r2 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, ib = et.ib;
    g.clearEvents();
    g.teleport(0, 1, 0, 0); g.step(5);
    g.give('anvil');
    g.setInput({ throw: true }); g.step(1); g.setInput({});
    const t = et.until(() => et.count('armor:break') > 0, 60);
    g.step(9);
    const p = ib.position;
    et.cam([p.x + 3.6, p.y + 1.8, p.z - 3.4], [p.x, p.y + 0.7, p.z]);
    return { t, hits: g.events('projectile:hit').map((e) => [e.payload.target, e.payload.kind, e.payload.deflected]), armor: g.events('armor:break').map((e) => e.payload), armored: ib.armored, hp: ib.hp, hurt: et.count('enemy:hurt'), props: ctx.enemies.fx.props.length };
  });
  await h.wait(450);
  await h.shot('ironbelly-armor-break');
  check('an iron ball (Anvil Tonic) cracks the cauldron off: armor:break, still 4 hp', r2.t >= 0 && r2.armor.length === 1 && r2.armor[0].entity === 'ironbelly' && !r2.armored && r2.hp === 4 && r2.props >= 2, r2);

  // --- 3. now plain puffs hurt him; 4 hp -> enemy:killed 400
  const r3 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx, ib = et.ib;
    g.clearEvents(); ctx.player.setTonic(null);
    g.step(60);
    let n = 0;
    while (ib.alive && !ib.dying && n < 10) {
      g.teleport(ib.position.x, 1, ib.position.z - 6, 0);
      g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(20); n++;
    }
    g.step(40);
    return { throws: n, hurt: g.events('enemy:hurt').map((e) => e.payload.hp), killed: g.events('enemy:killed').map((e) => e.payload) };
  });
  check('after the break puffs land: 4 puffs kill him, enemy:killed 400', r3.throws === 4 && r3.hurt.join() === '3,2,1' && r3.killed.length === 1 && r3.killed[0].points === 400 && r3.killed[0].type === 'ironbelly', r3);

  // --- 4. belly-flop shockwave: grounded Morel gets hit
  const r4 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null); g.godMode(false);
    ctx.player.hp = ctx.player.maxHp; g.step(90);
    g.teleport(0, 1, 2, 0); g.setCamera(0, 0.25, 7.5);
    const ib = et.ib = et.spawn({ type: 'ironbelly', pos: [0, 1, 7.5], yaw: Math.PI, patrol: 0, aggro: true });
    const tFlop = et.until(() => ib.flops > 0, 400);
    const p = ib.position;
    g.step(18);
    et.cam([p.x + 6.5, p.y + 3.2, p.z - 6.5], [p.x, p.y + 0.3, p.z - 1.5]);
    return { tFlop, wave: ctx.enemies.fx.waves.filter((w) => w.active).map((w) => +w.radius.toFixed(2)) };
  });
  await h.wait(450);
  await h.shot('ironbelly-shockwave');
  const r4b = await h.game((g) => {
    const et = window.__et;
    et.until(() => !g.ctx.enemies.fx.waves.some((w) => w.active), 120);
    return { hurt: g.events('player:hurt').map((e) => e.payload.amount), hp: g.ctx.player.hp };
  });
  check('belly-flop shockwave hits grounded Morel (1 dmg)', r4.tFlop > 0 && r4b.hurt.length === 1 && r4b.hurt[0] === 1, { ...r4, ...r4b });

  // --- 5. jumping over the ring avoids it
  const r5 = await h.game((g) => {
    const et = window.__et, ctx = g.ctx;
    et.clear(); g.clearEvents(); g.setInput(null);
    ctx.player.hp = ctx.player.maxHp; g.step(100);
    g.teleport(0, 1, 1, 0);
    const ib = et.spawn({ type: 'ironbelly', pos: [0, 1, 7.5], yaw: Math.PI, patrol: 0, aggro: true });
    et.until(() => ib.flops > 0, 400);
    const w = ctx.enemies.fx.waves.find((x) => x.active);
    const pz = ctx.player.position;
    const dist = () => Math.hypot(pz.x - w.center.x, pz.z - w.center.z);
    const lead = et.until(() => w.radius > dist() - 2.0, 120);
    g.setInput({ jump: true });
    et.until(() => !w.active || w.radius > dist() + 1.5, 120);
    const airborneWhenPassed = !ctx.player.onGround;
    g.setInput(null); g.step(60);
    return { lead, airborneWhenPassed, hurt: et.count('player:hurt'), hp: ctx.player.hp };
  });
  check('jumping over the shockwave avoids damage', r5.hurt === 0 && r5.hp === 5, r5);
  await h.game((g) => g.godMode(true));
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}
