// Shared helpers for core scenarios. installHelpers(page) defines window.__t in the page:
//   __t.jump(opts)  scripted jump/glide trial measured with __game.step (deterministic)
export async function installHelpers(page) {
  await page.evaluate(() => {
    const g = window.__game;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    window.__t = {
      /**
       * opts: { start:[x,y,z], yaw, move:[x,y], runSteps (steps of running before the jump/edge),
       *         jump: 'none'|'tap'|'hold'|'holdGlide'|'edge'|'edgeGlide', glideAfterAir (air steps before holding jump) }
       */
      jump(o) {
        g.setInput(null);
        g.teleport(o.start[0], o.start[1], o.start[2], o.yaw ?? 0);
        g.ctx.cameraRig.setView(o.yaw ?? 0, 0.22, 7.5);
        g.step(10);
        const p = g.ctx.player;
        const startY = p.position.y;
        let i = 0, takeoff = null, landing = null, maxY = startY, airSteps = 0, jumpStep = -1, released = false;
        const mv = o.move || [0, 0];
        for (i = 0; i < 900; i++) {
          const inp = { move: mv, jump: false };
          const air = !p.onGround;
          if (takeoff) airSteps++;
          switch (o.jump) {
            case 'tap': inp.jump = i === (o.runSteps || 0); break;
            case 'hold': inp.jump = i >= (o.runSteps || 0) && (!takeoff || (p.velocity.y > 0 && !released)); break;
            case 'holdGlide': inp.jump = i >= (o.runSteps || 0); break;
            case 'edge': inp.jump = air && airSteps <= 2 && !released && airSteps > 0 ? true : false; break;
            case 'edgeGlide': inp.jump = takeoff ? true : false; break;
            case 'walkGlide': inp.jump = takeoff && airSteps > (o.glideAfterAir || 12); break;
            default: inp.jump = false;
          }
          if (takeoff && p.velocity.y <= 0 && o.jump === 'hold') released = true;
          g.setInput(inp);
          g.step(1);
          if (!takeoff && !p.onGround) { takeoff = [p.position.x, p.position.y, p.position.z]; jumpStep = i; }
          if (takeoff) maxY = Math.max(maxY, p.position.y);
          if (takeoff && p.onGround && airSteps > 1) { landing = [p.position.x, p.position.y, p.position.z]; break; }
        }
        g.setInput(null);
        const dist = takeoff && landing ? Math.hypot(landing[0] - takeoff[0], landing[2] - takeoff[2]) : null;
        return {
          rise: r3(maxY - startY), dist: dist && r3(dist), airTime: r3(airSteps / 60),
          takeoff: takeoff && takeoff.map(r3), landing: landing && landing.map(r3), jumpStep,
        };
      },
    };
  });
}
