// Performance of the shipped build (dist/index.html), quality 'high', 960x540:
//   * draw calls + triangles of one full frame (shadow + main + bloom) at every checkpoint and at the
//     busiest spots of the route, with a breakdown by owner (entity type / level / Morel / post)
//   * per-frame allocations: heap sampling (CDP) over 600 fixed steps + 60 rendered frames of play
//     with bandits fighting, reported by allocating function
//   node tools/scenario.mjs tools/scenarios/integ-perf.mjs --html dist/index.html --shots dist/integ/shots
//   PERF_ONLY=calls|alloc limits the run.
import { installIntegHelpers, watchConsole, waitForGame } from './integ-helpers.mjs';

const VIEWS = [
  // [label, checkpoint | [x, y, z], yaw, pitch]
  ['cp-start', 'start'], ['cp-glade', 'glade'], ['cp-bog', 'bog'], ['cp-fort', 'fort'], ['cp-pit', 'pit'],
  ['glade-meadow', [0, null, 32], 0, 0.25],
  ['bog-island-b2', [0, null, 146], 0, 0.25],
  ['bog-cliff-b4', [8.5, null, 212], 0, 0.25],
  ['fort-bridge', [0, null, 262], 0, 0.22],
  ['fort-yard', [0, null, 282], 0, 0.25],
  ['fort-gate', [0, null, 299], 0, 0.25],
  ['fort-backyard', [0, null, 336], 0, 0.25],
  ['pit-inside', [0, null, 384], 0, 0.25],
];

export default async function (page, h) {
  const consoleLog = watchConsole(page);
  const only = process.env.PERF_ONLY || '';
  await waitForGame(page, 'title');
  await installIntegHelpers(page);
  await page.keyboard.press('Enter');
  await waitForGame(page, 'playing', 20000);
  const out = { views: [], alloc: null };

  // per-owner draw-call accounting (wraps renderBufferDirect for the measuring frame only)
  await h.game((g) => {
    const ctx = g.ctx, r = ctx.renderer;
    const orig = r.renderBufferDirect.bind(r);
    window.__perf = {
      on: false, tally: {},
      owners: null,
      buildOwners() {
        const m = new Map();
        for (const e of ctx.entities.list) if (e.object3d) m.set(e.object3d, e.type || 'entity');
        m.set(ctx.player.object3d, 'morel');
        window.__perf.owners = m;
      },
      ownerOf(o) {
        const m = window.__perf.owners;
        let n = o;
        while (n) {
          if (m.has(n)) return m.get(n);
          if (n.parent === ctx.scene || !n.parent) return n.name ? `scene:${n.name}` : `scene:${n.type}`;
          n = n.parent;
        }
        return 'post';
      },
    };
    r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const P = window.__perf;
      if (P.on) {
        const k = scene && scene.isScene && scene !== ctx.scene ? 'post' : P.ownerOf(object);
        P.tally[k] = (P.tally[k] || 0) + 1;
      }
      return orig(camera, scene, geometry, material, object, group);
    };
  });

  if (!only || only === 'calls') {
    for (const [label, where, yaw = 0, pitch = 0.22] of VIEWS) {
      await h.game((g, a) => {
        const [where2, yaw2, pitch2] = a;
        g.godMode(true);
        g.ctx.player.heal(5);
        if (typeof where2 === 'string') g.gotoCheckpoint(where2);
        else { const y = g.ctx.level.groundY(where2[0], where2[2], 60); g.teleport(where2[0], y, where2[2], yaw2); g.setCamera(yaw2, pitch2, 7.5); }
        g.step(90);                                // enemies notice, LODs settle
        g.setQuality('high');
      }, [where, yaw, pitch]);
      await h.wait(1000);                          // a few real frames: per-frame LOD / culling hooks run
      const r = await h.game(() => {
        const P = window.__perf;
        P.buildOwners(); P.tally = {}; P.on = true;
        const dc = window.__it.drawCalls();
        P.on = false;
        const by = Object.entries(P.tally).sort((a, b) => b[1] - a[1]);
        const ents = window.__game.ctx.entities.countByTag();
        return { ...dc, by, bandits: ents.bandit || 0 };
      });
      out.views.push({ label, calls: r.calls, tris: r.tris, bandits: r.bandits, by: Object.fromEntries(r.by.slice(0, 12)) });
      h.log(label, r.calls, 'calls', r.tris, 'tris', JSON.stringify(r.by.slice(0, 10)));
      if (/^cp-/.test(label)) await h.shot(`40-perf-${label}`);
    }
  }

  if (!only || only === 'alloc') {
    // allocation sampling over steady-state play: fixed steps + renders, bandits fighting near Morel
    await h.game((g) => { g.godMode(true); g.gotoCheckpoint('glade'); g.teleport(0, 4.3, 40, 0); g.setCamera(0, 0.25, 7.5); g.step(120); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    // warm up (shader compiles, pools fill), then sample
    await h.game((g) => { for (let i = 0; i < 20; i++) { g.step(5); g.render(); } });
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512 });
    const steps = await h.game((g) => {
      const t0 = performance.now();
      let k = 0;
      for (let i = 0; i < 60; i++) {
        g.setInput({ move: [Math.sin(i * 0.3) * 0.6, 0.6], throw: i % 7 === 0, lock: i % 20 < 10 });
        g.step(10); k += 10;
        g.ctx.systems.forEach((s) => s.frame && s.frame(1 / 60, g.ctx));
        g.ctx.level.frame(1 / 60, g.ctx);
        g.render();
      }
      g.setInput({});
      return { steps: k, ms: Math.round(performance.now() - t0) };
    });
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    // flatten: self size per function (url:line)
    const self = new Map();
    let total = 0;
    const name = (f) => `${f.functionName || '(anon)'}:${f.lineNumber}`;
    const walk = (n, path) => {
      const f = n.callFrame;
      const here = [...path, name(f)].slice(-4);
      const key = here.join(' < ');
      if (n.selfSize) { self.set(key, (self.get(key) || 0) + n.selfSize); total += n.selfSize; }
      for (const c of n.children || []) walk(c, here);
    };
    walk(profile.head, []);
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k.split(' < ').reverse().join(' < '), Math.round(v / 1024)]);
    out.alloc = { ...steps, sampledKB: Math.round(total / 1024), perStepBytes: Math.round(total / steps.steps), top };
    h.log('alloc', JSON.stringify(out.alloc, null, 1));
  }
  const errors = consoleLog.filter((l) => !/GPU stall due to ReadPixels/.test(l));
  out.errors = errors.slice(0, 10);
  return out;
}
