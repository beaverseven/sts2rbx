// Shared helpers for enemies scenarios. installEnemyHelpers(page) defines window.__et:
//   __et.clear()                       remove every bandit/boss + effects
//   __et.spawn(def)                    spawn and return the entity (flushes)
//   __et.until(pred, max)              step one fixed update at a time until pred() -> steps or -1
//   __et.faceTo(x, z)                  yaw from Morel to (x, z)
//   __et.cam(pos, target)              place the render camera by hand (manual step mode keeps it)
//   __et.count(name)                   number of logged events named `name`
export async function installEnemyHelpers(page) {
  await page.evaluate(() => {
    const g = window.__game;
    const ctx = g.ctx;
    window.__et = {
      clear() {
        for (const e of ctx.entities.list) if (e.tags.has('bandit') || e.tags.has('boss')) e.alive = false;
        ctx.entities.flush();
        ctx.enemies.fx.clearAll();
        ctx.projectiles.clear();
      },
      spawn(def) { const e = ctx.entities.spawn(def); ctx.entities.flush(); return e; },
      until(pred, max = 600) {
        for (let i = 0; i < max; i++) { if (pred()) return i; g.step(1); }
        return pred() ? max : -1;
      },
      faceTo(x, z) { const p = ctx.player.position; return Math.atan2(x - p.x, z - p.z); },
      cam(pos, target) { ctx.camera.position.set(pos[0], pos[1], pos[2]); ctx.camera.lookAt(target[0], target[1], target[2]); },
      count(name) { return g.events(name).filter((e) => e.name === name).length; },
    };
  });
}
