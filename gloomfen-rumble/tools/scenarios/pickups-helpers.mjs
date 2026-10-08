// Shared helpers for pickups scenarios: installs window.__pt in the page.
//   import { installHelpers } from './pickups-helpers.mjs';  await installHelpers(page);
// __pt.portrait(eye, target)  pause the game, hide Morel, place the camera (for close-ups)
// __pt.resume()               back to 'playing' with Morel visible and the camera rig in control
// __pt.find(type, i)          i-th live entity of a type (spawn order)
// __pt.calls()                draw calls of one full render (shadow + main + bloom passes)
// __pt.walkTo(x, z, maxSteps) steer Morel with setInput until within 0.4 m (returns steps used)
export async function installHelpers(page) {
  await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx;
    window.__pt = {
      portrait(eye, target, keepMorel = false) {
        ctx.setState('paused');
        if (!keepMorel) g.player.model.visual.visible = false;
        const c = ctx.camera;
        c.position.set(eye[0], eye[1], eye[2]);
        c.lookAt(target[0], target[1], target[2]);
        c.updateMatrixWorld();
      },
      resume() {
        g.player.model.visual.visible = true;
        ctx.setState('playing');
      },
      find(type, i = 0) { return ctx.entities.list.filter((e) => e.type === type && e.alive)[i] || null; },
      calls() {
        const ri = ctx.renderer.info;
        const auto = ri.autoReset;
        ri.autoReset = false; ri.reset();
        g.render();
        const n = ri.render.calls, tris = ri.render.triangles;
        ri.reset(); ri.autoReset = auto;
        return { calls: n, triangles: tris };
      },
      walkTo(x, z, maxSteps = 600) {
        const p = g.player.position;
        for (let s = 0; s < maxSteps; s += 2) {
          const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
          if (d < 0.4) { g.setInput({}); return s; }
          // camera-relative input: with camera yaw cy, forward = (sin cy, cos cy), right = (-cos cy, sin cy)
          const cy = ctx.cameraRig.yaw;
          const fx = Math.sin(cy), fz = Math.cos(cy), rx = -Math.cos(cy), rz = Math.sin(cy);
          const k = Math.min(1, d / 1.5);
          g.setInput({ move: [((dx * rx + dz * rz) / d) * k, ((dx * fx + dz * fz) / d) * k] });
          g.step(2);
        }
        g.setInput({});
        return -1;
      },
    };
  });
}
