// Glowworm cages: two hits from player projectiles break them; cage:freed, thanks message, 500 points.
//   node tools/scenario.mjs tools/scenarios/pickups-cage.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  await h.game((g) => { g.setQuality('high'); g.godMode(true); g.ctx.score.reset(); });

  const throwOnce = async () => h.game((g) => {
    g.setInput({ throw: true }); g.step(2); g.setInput({}); g.step(24);
    const cage = window.__pt.find('cage', 0);
    return { hits: cage.hits, freed: cage.freed, hittable: cage.hittable };
  });

  // Morel 3.4 m in front of the post cage, facing it
  await h.game((g) => { g.teleport(-6, 1, 7.6, 0); g.setCamera(0.5, 0.25, 6); g.step(20); g.clearEvents(); });
  const first = await throwOnce();
  const ev1 = await h.game((g) => ({
    hit: g.events('projectile:hit').map((e) => e.payload.target), cageHit: g.events('cage:hit').map((e) => e.payload), freed: g.events('cage:freed').length,
  }));
  check('first puff hits the cage (projectile:hit target cage, cage:hit {hits 1, hitsLeft 1}), not freed yet', first.hits === 1 && !first.freed && ev1.hit.includes('cage') && ev1.cageHit.length === 1 && ev1.cageHit[0].hitsLeft === 1 && ev1.freed === 0, { first, ev1 });

  await h.game((g) => { g.setInput({ throw: true }); g.step(2); g.setInput({}); g.step(5); });
  await h.game(() => window.__pt.portrait([-3.6, 2.6, 8.6], [-6, 1.9, 11]));
  await h.wait(500);
  await h.shot('cage-break');
  await h.game((g) => { window.__pt.resume(); g.step(19); });
  const second = await h.game((g) => {
    const cage = window.__pt.find('cage', 0);
    return {
      hits: cage.hits, freed: cage.freed, hittable: cage.hittable, tags: [...cage.tags],
      freedEv: g.events('cage:freed').map((e) => e.payload),
      msgs: g.events('ui:message').map((e) => e.payload),
      awards: g.events('score:award').map((e) => [e.payload.reason, e.payload.points]),
      score: g.ctx.score.cagesFreed, debris: g.ctx.pickups.debris.count,
    };
  });
  check('second hit frees the glowworm: cage:freed {points 500, freed 1, total 2}', second.freed && second.freedEv.length === 1 && second.freedEv[0].points === 500 && second.freedEv[0].freed === 1 && second.freedEv[0].total === 2, second.freedEv);
  check('freed cage is no longer hittable / targetable', second.hittable === false && !second.tags.includes('target'), second.tags);
  check('the glowworm says thanks (ui:message)', second.msgs.length >= 1 && typeof second.msgs[0].text === 'string' && second.msgs[0].text.length > 5, second.msgs);
  check('cage scores 500 and counts in score.cagesFreed', second.awards.some(([r, p]) => r === 'cage' && p === 500) && second.score === 1, second.awards);
  check('planks fly (debris pieces alive)', second.debris >= 10, second.debris);

  await h.game((g) => { g.step(40); window.__pt.portrait([-3.2, 3.2, 7.8], [-6, 3.0, 11]); });
  await h.wait(500);
  await h.shot('cage-worm-spiral');
  await h.game((g) => { window.__pt.resume(); });

  // a third puff passes through the freed cage
  const third = await h.game((g) => {
    g.clearEvents();
    g.setInput({ throw: true }); g.step(2); g.setInput({}); g.step(30);
    return g.events('projectile:hit').map((e) => e.payload.target);
  });
  check('a puff no longer hits the freed cage', !third.includes('cage'), third);

  // hanging cage: two puffs fired by the projectile system (team player)
  const hanging = await h.game((g) => {
    const THREE = g.ctx.THREE;
    const cage = window.__pt.find('cage', 1);
    g.clearEvents();
    const fire = () => {
      g.ctx.projectiles.spawn({ team: 'player', kind: 'puff', position: new THREE.Vector3(14, 3.2, 12.5), velocity: new THREE.Vector3(0, 0, 26), damage: 1, radius: 0.25, life: 1 });
      g.step(20);
    };
    fire();
    const h1 = cage.hits;
    fire();
    g.step(30);
    const msgs = g.events('ui:message').map((e) => e.payload.text);
    return { hanging: cage.hanging, h1, hits: cage.hits, freed: cage.freed, ev: g.events('cage:freed').map((e) => e.payload), msgs };
  });
  check('hanging cage breaks after 2 hits: cage:freed {freed 2, total 2}', hanging.hanging && hanging.h1 === 1 && hanging.freed && hanging.ev.length === 1 && hanging.ev[0].freed === 2 && hanging.ev[0].total === 2, hanging);
  const msgA = second.msgs[0] && second.msgs[0].text;
  check('thank-you lines vary between glowworms', hanging.msgs.length >= 1 && hanging.msgs[0] !== msgA, { a: msgA, b: hanging.msgs[0] });

  // enemy projectiles never break cages
  const enemyShot = await h.game((g) => {
    const THREE = g.ctx.THREE;
    g.ctx.entities.spawn({ type: 'cage', pos: [10, null, -6] }); g.ctx.entities.flush();
    const cage = window.__pt.find('cage', 2);
    g.ctx.projectiles.spawn({ team: 'enemy', kind: 'mud', position: new THREE.Vector3(10, 1.9, -9), velocity: new THREE.Vector3(0, 0, 20), damage: 1, radius: 0.3, life: 1 });
    g.step(30);
    return { hits: cage.hits };
  });
  check('enemy mud balls do not hit cages', enemyShot.hits === 0, enemyShot);

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
