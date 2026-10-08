// Runs the docs/core.md example code (a toy enemy type) inside the page to prove it works,
// and checks the unknown-type placeholder rule.
//   node tools/scenario.mjs tools/scenarios/core-example.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots
export default async function (page, h) {
  await h.wait(300);
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  const r = await page.evaluate(() => {
    const g = window.__game;
    const ctx = g.ctx;
    const THREE = ctx.THREE;
    // ---- example from docs/core.md: "Registering an entity type" ----------------
    ctx.entities.registerType('toyGrunt', (ctx, def) => {
      const M = ctx.materials;
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), M.toon(0x6f8f3a));
      body.position.y = 0.5; body.castShadow = true;
      M.outline(body, 0.03);
      root.add(body);
      root.position.fromArray(def.pos);
      const e = {
        object3d: root, tags: new Set(['enemy', 'grunt']), alive: true, team: 'enemy',
        radius: 0.5, height: 1.0, hp: def.hp ?? 2,
        body: { position: root.position, velocity: new THREE.Vector3(), radius: 0.45, height: 1.0 },
        cooldown: 1,
        get position() { return root.position; },
        update(dt, ctx) {
          const b = e.body, p = ctx.player.position;
          // walk toward the player, with gravity, using the shared character physics
          const dx = p.x - b.position.x, dz = p.z - b.position.z, d = Math.hypot(dx, dz) || 1;
          const speed = d > 4 ? 3 : 0;
          b.velocity.x = (dx / d) * speed; b.velocity.z = (dz / d) * speed;
          b.velocity.y -= 30 * dt;
          ctx.physics.moveCharacter(b, dt);
          root.rotation.y = Math.atan2(dx, dz);
          // lob a mud ball every 1.5 s when close
          e.cooldown -= dt;
          if (d < 12 && e.cooldown <= 0) {
            e.cooldown = 1.5;
            const from = root.position.clone().setY(root.position.y + 0.8);
            const to = p.clone().setY(p.y + 0.5);
            const t = from.distanceTo(to) / 14;                  // flight time at ~14 m/s
            const vel = to.sub(from).divideScalar(t);            // straight line...
            vel.y += 0.5 * 18 * t;                               // ...plus gravity compensation
            ctx.projectiles.spawn({ team: 'enemy', kind: 'mud', position: from, velocity: vel, damage: 1, radius: 0.3, gravity: 18, life: 3, owner: e });
          }
        },
        hurt(amount, info) {
          e.hp -= amount;
          ctx.events.emit('enemy:hurt', { entity: e, type: 'toyGrunt', amount, hp: e.hp });
          if (e.hp <= 0) {
            ctx.events.emit('enemy:killed', { entity: e, type: 'toyGrunt', position: root.position.clone(), points: 200 });
            ctx.particles.burst({ position: root.position, count: 20, color: [0x6f8f3a, 0xffffff], speed: 4, kind: 'puff' });
            e.alive = false;                                     // removed + disposed at end of step
          }
          return true;
        },
        dispose() { body.geometry.dispose(); },
      };
      return e;
    });
    // ---- spawning ------------------------------------------------------------
    g.clearEvents();
    g.setInput(null); g.godMode(false); ctx.player.hp = 5;
    g.teleport(0, 1, -4, 0); g.step(5);
    ctx.entities.spawn({ type: 'toyGrunt', pos: [0, 1, 6], hp: 2 });
    g.step(150);
    const hurtByMud = g.events('player:hurt').length;
    const mudHits = g.events('projectile:hit').filter((e) => e.payload.kind === 'mud' && e.payload.target === 'player').length;
    // kill it with two puffs
    for (let k = 0; k < 4; k++) { g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(20); }
    const killed = g.events('enemy:killed').filter((e) => e.payload.type === 'toyGrunt').length;
    // placeholder rule
    ctx.entities.spawn({ type: 'notRegisteredYet', pos: [3, 1, 0] });
    ctx.entities.spawn({ type: 'notRegisteredYet', pos: [4, 1, 0] });
    g.step(2);
    return { hurtByMud, mudHits, killed, placeholders: ctx.entities.query('placeholder').length, counts: g.state().entities };
  });
  await h.wait(300);
  const placeholderWarnings = warnings.filter((w) => w.includes('notRegisteredYet')).length;
  h.log(JSON.stringify({ ...r, placeholderWarnings }));
  const ok = r.hurtByMud >= 1 && r.mudHits >= 1 && r.killed === 1 && r.placeholders === 2 && placeholderWarnings === 1;
  h.log(ok ? 'PASS docs example + placeholder rule' : 'FAIL docs example + placeholder rule');
  return { ok, ...r, placeholderWarnings };
}
