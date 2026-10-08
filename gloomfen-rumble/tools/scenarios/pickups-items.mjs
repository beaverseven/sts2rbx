// Berries heal (and stay when Morel is at full health); every tonic jar calls setTonic and respawns after 8 s.
//   node tools/scenario.mjs tools/scenarios/pickups-items.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots
import { installHelpers } from './pickups-helpers.mjs';

export default async function (page, h) {
  await page.waitForFunction(() => window.__game && window.__game.ctx.time.frame >= 0);
  await installHelpers(page);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  // berry at full health: stays
  const full = await h.game((g) => {
    g.godMode(true);
    const b = window.__pt.find('berry', 0);
    const p = b.position;
    g.clearEvents();
    g.teleport(p.x, p.y, p.z - 2.5, 0); g.setCamera(0, 0.3, 7.5); g.step(3);
    window.__pt.walkTo(p.x, p.z, 300);
    g.step(20);
    return { alive: b.alive, hp: g.player.hp, events: g.events('pickup:berry').length, dist: Math.hypot(g.player.position.x - p.x, g.player.position.z - p.z) };
  });
  check('berry stays when Morel is at full health', full.alive && full.events === 0 && full.hp === 5 && full.dist < 0.6, full);

  // hurt, then walk into it: heals 1, pickup:berry, berry gone, 25 points
  const heal = await h.game((g) => {
    const sc = g.ctx.score;
    const pl = g.player;
    pl.hp = 3;
    const b = window.__pt.find('berry', 0);
    const p = b.position.clone();
    g.teleport(p.x, p.y, p.z - 2.5, 0); g.setCamera(0, 0.3, 7.5); g.step(3);
    sc.reset(); g.clearEvents();
    window.__pt.walkTo(p.x, p.z, 300);
    g.step(5);
    const ev = g.events('pickup:berry').map((e) => e.payload);
    return { alive: b.alive, hp: pl.hp, ev, points: sc.points, berries: sc.berries };
  });
  check('berry heals 1 heart (3 -> 4), emits pickup:berry {hp: 4} and disappears', !heal.alive && heal.hp === 4 && heal.ev.length === 1 && heal.ev[0].hp === 4, heal);
  check('berry scores 25 points', heal.points === 25 && heal.berries === 1, heal.points);
  await h.game((g) => { g.player.hp = g.player.maxHp; });

  // tonic jars: anvil, updraft, seeker
  const tonics = await h.game((g) => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const jar = window.__pt.find('tonic', i);
      const p = jar.position;
      g.player.setTonic(null);
      g.clearEvents();
      g.teleport(p.x, p.y, p.z - 2.2, 0); g.setCamera(0, 0.3, 7.5); g.step(2);
      window.__pt.walkTo(p.x, p.z, 300);
      g.step(2);
      const got = g.player.tonic ? { kind: g.player.tonic.kind, duration: g.player.tonic.duration } : null;
      const avail1 = jar.available;
      const starts = g.events('tonic:start').map((e) => e.payload.kind);
      const picks = g.events('pickup:tonic').map((e) => e.payload.kind);
      // step away, wait 7.5 s: still empty; at 8 s: back
      g.teleport(p.x + 4, p.y, p.z - 4, 0); g.step(2);
      g.step(450);
      const avail2 = jar.available;
      g.step(40);
      const avail3 = jar.available;
      const respawns = g.events('tonic:respawn').filter((e) => e.payload.kind === jar.kind).length;
      // drink it again
      g.player.setTonic(null);
      g.teleport(p.x, p.y, p.z - 2.2, 0); g.step(2);
      window.__pt.walkTo(p.x, p.z, 300); g.step(2);
      out.push({ jarKind: jar.kind, got, avail1, avail2, avail3, respawns, starts, picks, again: g.player.tonic ? g.player.tonic.kind : null });
    }
    return out;
  });
  for (const t of tonics) {
    check(`${t.jarKind} jar calls setTonic('${t.jarKind}', 20) (tonic:start ${t.jarKind})`, t.got && t.got.kind === t.jarKind && t.got.duration === 20 && t.starts.includes(t.jarKind) && t.picks[0] === t.jarKind, t);
    check(`${t.jarKind} jar is gone for 8 s, then reappears (tonic:respawn) and can be drunk again`, !t.avail1 && !t.avail2 && t.avail3 && t.respawns === 1 && t.again === t.jarKind, t);
  }
  await h.game((g) => { g.teleport(-6.5, 1, 2.0, 0); g.setCamera(0, 0.25, 6); g.step(30); });
  await h.wait(500);
  await h.shot('items-tonics-respawning');

  const failed = checks.filter((c) => !c.ok);
  return { passed: checks.length - failed.length, total: checks.length, failed, checks: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`) };
}
