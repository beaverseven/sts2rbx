// QA combat helpers (playtester lens: combat, enemies, boss — no god mode, real inputs only).
// installQA(page) defines window.__qa in the page:
//   __qa.hits              every landed hit on Morel: { t, hp, src, phase, bossState, pos }
//   __qa.count(name)       event counts since install
//   __qa.bot               a scripted "good human" fighter: dodges telegraphed attacks it can see
//                          (shockwave rings, mud landing markers, club wind-ups, belly slides),
//                          locks on with the real lock button, throws with the real throw button.
//   __qa.run(opts)         run the bot for opts.steps fixed steps or until opts.until() is true
// Damage sources are classified by the object passed to player.damage (reference identity):
// shockwave centre -> 'wave:<owner>', projectile position -> 'mud:<owner>', entity position ->
// '<type>:<state>', else 'other' (boss club slam uses a temp vector, thorns use their patch point).
import { waitForGame } from './integ-helpers.mjs';

export async function bootPlaying(page) {
  await waitForGame(page, 'title');
  await page.evaluate(() => { const g = window.__game; g.start(); g.step(2); });
}

export async function installQA(page) {
  await page.evaluate(() => {
    const g = window.__game, ctx = g.ctx, pl = ctx.player, THREE = ctx.THREE;
    const fx = ctx.enemies.fx;
    const r2 = (v) => Math.round(v * 100) / 100;
    const counts = {};
    const evlog = [];
    ctx.events.on('*', (p, n) => {
      counts[n] = (counts[n] || 0) + 1;
      if (/^(boss:|player:died|player:respawn|armor:break|enemy:killed|pickup:|tonic:start|tonic:end|gate:|arena:)/.test(n)) {
        evlog.push({ t: r2(ctx.time.now), n, p: n === 'boss:hurt' ? p.hp : n === 'boss:phase' ? p.phase : n === 'enemy:killed' ? p.type : n === 'player:respawn' ? p.checkpointId : n === 'tonic:start' || n === 'pickup:tonic' ? p.kind : undefined });
      }
    });
    const qa = window.__qa = { hits: [], counts, evlog, notes: [] };
    qa.count = (n) => counts[n] || 0;
    const boss = () => ctx.enemies.boss();

    // ---------------------------------------------------------------- damage instrumentation
    const origDamage = pl.damage;
    pl.damage = function (n, from) {
      const hp0 = pl.hp;
      let src = 'other';
      if (from) {
        const w = fx.waves.find((x) => x.center === from);
        const pr = ctx.projectiles.active.find((x) => x.position === from);
        const en = ctx.entities.list.find((x) => x.object3d && x.object3d.position === from);
        if (w) src = 'wave:' + (w.owner ? w.owner.type : '?') + (w.owner && w.owner.type === 'boss' ? (w.maxRadius > 10 ? '-stomp' : '-club') : '');
        else if (pr) src = 'mud:' + (pr.owner ? pr.owner.type : '?');
        else if (en) src = en.type + ':' + en.state;
      }
      const b = boss();
      const ok = origDamage.call(this, n, from);
      if (ok) {
        const p = pl.position;
        qa.hits.push({ t: r2(ctx.time.now), hp: pl.hp, hp0, src, phase: b ? b.phase : null, bossState: b ? b.state : null, bossDist: b ? r2(Math.hypot(b.position.x - p.x, b.position.z - p.z)) : null, pos: [r2(p.x), r2(p.y), r2(p.z)], from: from ? [r2(from.x), r2(from.y), r2(from.z)] : null, onGround: pl.onGround, pstate: pl.state });
      }
      return ok;
    };
    ctx.events.on('player:fell', () => qa.hits.push({ t: r2(ctx.time.now), src: 'water', hp: pl.hp }));

    // ---------------------------------------------------------------- the bot
    const _a = new THREE.Vector3();
    const DIRS = [];
    for (let k = 0; k < 16; k++) DIRS.push([Math.sin((k / 16) * Math.PI * 2), Math.cos((k / 16) * Math.PI * 2)]);
    DIRS.push([0, 0]);

    function toCam(dx, dz) {
      const yaw = ctx.cameraRig.yaw;
      // forward (sin, cos), right (-cos, sin)
      return [dx * -Math.cos(yaw) + dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
    }
    function mudLandings(groundY) {
      const out = [];
      for (const p of ctx.projectiles.active) {
        if (!p.alive || p.team !== 'enemy') continue;
        if (p.age < (bot.react || 0)) continue;        // a human needs a moment to notice the marker
        const gy = groundY != null ? groundY : Math.max(ctx.physics.groundHeight(p.position.x, p.position.z, p.position.y), pl.position.y);
        const v = p.velocity, gr = p.gravity || 0;
        const h = p.position.y - (gy + 0.4);
        let t;
        if (gr > 0) t = (v.y + Math.sqrt(Math.max(0, v.y * v.y + 2 * gr * h))) / gr;
        else t = 0.5;
        out.push({ x: p.position.x + v.x * t, z: p.position.z + v.z * t, t, p });
      }
      return out;
    }

    let seed = 12345;
    const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const bot = qa.bot = {
      rand, seed(sd) { seed = sd; }, react: 0, jumpThr: null,
      jumpHold: 0, charging: false, chargeSteps: 0, tapCd: 0, lockWant: null, lockPhase: 0, side: 1, sideT: 0,
      goal: null, mode: '', arena: { x: 0, z: 395, r: 18.3 }, pref: 9.5, log: [],
      dodgeJumps: 0, throws: 0, charged: 0,
    };

    /** Threat-scored movement: returns [dx, dz] world direction (unit or zero). */
    function chooseMove(o) {
      const P = pl.position;
      const speed = (pl.locking ? 7 : 8.5) * (bot.charging ? 0.8 : 1);
      const muds = mudLandings(o.groundY);
      const b = o.boss;
      let best = null, bestS = Infinity;
      for (const [dx, dz] of DIRS) {
        let s = 0;
        const px = (t) => P.x + dx * speed * Math.min(t, 0.9), pz = (t) => P.z + dz * speed * Math.min(t, 0.9);
        // mud landing markers
        for (const m of muds) {
          const d = Math.hypot(px(m.t) - m.x, pz(m.t) - m.z);
          if (d < 2.4) s += (2.4 - d) * 30;
        }
        const qx = px(0.35), qz = pz(0.35);
        // stay in the arena / area
        if (o.area) {
          const dd = Math.hypot(qx - o.area.x, qz - o.area.z);
          if (dd > o.area.r) s += (dd - o.area.r) * 25;
        }
        if (o.avoidPts) for (const a of o.avoidPts) { const d = Math.hypot(qx - a.x, qz - a.z); if (d < a.r) s += (a.r - d) * (a.w || 20); }
        if (b && b.stateT >= (bot.react || 0)) {
          const bx = b.position.x, bz = b.position.z;
          const db = Math.hypot(qx - bx, qz - bz);
          const fwx = Math.sin(b.yaw), fwz = Math.cos(b.yaw);
          if (b.state === 'stompWindup' || b.state === 'stomp') { if (db < 5) s += (5 - db) * 40; }
          if (b.state === 'clubWindup' || b.state === 'clubSlam') {
            const cx = bx + fwx * 5, cz = bz + fwz * 5;
            const dc = Math.hypot(qx - cx, qz - cz);
            if (dc < 4.2) s += (4.2 - dc) * 40;
            if (db < 4) s += (4 - db) * 30;
          }
          if (b.state === 'slideWindup' || (b.state === 'slide' && b.stateT < 1.2)) {
            const sx = b.state === 'slide' ? b.slideX : fwx, sz = b.state === 'slide' ? b.slideZ : fwz;
            const t = 0.5;
            const rx = qx - bx, rz = qz - bz;
            const along = rx * sx + rz * sz;
            const lat = Math.abs(rx * sz - rz * sx);
            if (along > -2 && lat < 4.2) s += (4.2 - lat) * 45;
            void t;
          }
          if (o.pref != null && b.state !== 'dizzy') s += Math.abs(db - o.pref) * 1.2;
          if (b.state === 'dizzy' && db < 4) s += (4 - db) * 5;
        }
        // grunts winding up / minions
        for (const e of o.enemies || []) {
          if (!e.alive || e.dying) continue;
          const ex = e.position.x, ez = e.position.z;
          const de = Math.hypot(qx - ex, qz - ez);
          if (e.type === 'grunt') {
            const seen = e.stateT >= (bot.react || 0);
            const danger = (e.state === 'windup' || e.state === 'swing') && seen ? 3.4 : e.state === 'chase' || e.state === 'windup' ? 2.6 : 1.5;
            if (de < danger) s += (danger - de) * (e.state === 'windup' ? 40 : 12);
          } else if (e.type === 'ironbelly') {
            const danger = e.state === 'crouch' || e.state === 'leap' ? 4 : 2.5;
            if (de < danger) s += (danger - de) * 25;
          }
        }
        if (o.keep && o.keep.e && o.keep.e.alive) {
          const dk = Math.hypot(qx - o.keep.e.position.x, qz - o.keep.e.position.z);
          if (dk < o.keep.min) s += (o.keep.min - dk) * 6; else if (dk > o.keep.max) s += (dk - o.keep.max) * 1.5;
        }
        if (o.safeGround && (dx || dz)) {
          // a human does not run off ledges or into the bog while fighting
          for (const f of [0.5, 1.2]) {
            const sx = P.x + dx * f, sz = P.z + dz * f;
            const gy = ctx.physics.groundHeight(sx, sz, P.y + 0.6);
            if (!(gy > ctx.physics.waterLevel + 0.45) || gy < P.y - 1.2) { s += 60 / f; break; }
          }
        }
        if (o.goal) {
          const gx = o.goal.x - P.x, gz = o.goal.z - P.z, gl = Math.hypot(gx, gz) || 1;
          s -= (dx * gx + dz * gz) / gl * (o.goalW ?? 6);
        }
        if (o.circle && b) {
          const rx = P.x - b.position.x, rz = P.z - b.position.z, rl = Math.hypot(rx, rz) || 1;
          const tx = -rz / rl * bot.side, tz = rx / rl * bot.side;
          s -= (dx * tx + dz * tz) * 1.0;
        }
        if (dx === 0 && dz === 0) s -= 0.3; // mild preference to stand still when nothing matters
        if (s < bestS) { bestS = s; best = [dx, dz]; }
      }
      return best;
    }

    /** Jump over approaching shockwave rings (they only hurt a grounded Morel). */
    function wantJump() {
      if (bot.jumpHold > 0) { bot.jumpHold--; return true; }
      if (!pl.onGround) return false;
      const P = pl.position, pr = pl.radius || 0.32;
      for (const w of fx.waves) {
        if (!w.active) continue;
        if (Math.abs(P.y - w.center.y) > 0.9) continue;
        const d = Math.hypot(P.x - w.center.x, P.z - w.center.z);
        const lead = d - pr - (w.radius + w.width * 0.35);
        if (lead < -0.05 && d >= w.prev - w.width - pr && !bot.jumpThr) return startJump(); // already inside the band
        if (w._qaAge === undefined || w.age < w._qaAge) w._qaThr = bot.jumpThr ? bot.jumpThr[0] + bot.rand() * (bot.jumpThr[1] - bot.jumpThr[0]) : 0.1; // new ring
        w._qaAge = w.age;
        const thr = w._qaThr;
        if (lead >= -0.05 && lead / w.speed < thr && d < w.maxRadius + 1) return startJump();
      }
      return false;
    }
    function startJump() { bot.jumpHold = 20; bot.dodgeJumps++; return true; }

    /** One fixed step of play. o: { boss, enemies, target (entity|null), quick (tap puffs), precharge, goal, pref, area, circle } */
    qa.act = function (o) {
      const inp = { move: [0, 0] };
      // ---- lock-on: point the camera at the wanted target and press the real lock button
      let want = o.target && o.target.alive && o.target.hittable !== false ? o.target : null;
      if (o.lockAny) {
        // play it like a human: aim the camera roughly at the nearest bandit, press lock, take what the game picks
        want = null;
        if (pl.locking && pl.lockTarget) { inp.lock = true; want = pl.lockTarget; }
        else if (pl.locking) inp.lock = false;
        else if (o.aimAt) {
          const yaw = Math.atan2(o.aimAt.position.x - pl.position.x, o.aimAt.position.z - pl.position.z);
          ctx.cameraRig.setView(yaw, 0.3, 7.5);
          inp.lock = true;
        }
      } else if (want) {
        if (pl.lockTarget === want && pl.locking) inp.lock = true;
        else if (bot.lockPhase === 0 && pl.locking) { inp.lock = false; bot.lockPhase = 1; }
        else {
          const yaw = Math.atan2(want.position.x - pl.position.x, want.position.z - pl.position.z);
          ctx.cameraRig.setView(yaw, 0.3, 7.5);
          inp.lock = true; bot.lockPhase = 0;
        }
      } else if (o.holdLock && pl.locking) inp.lock = true;
      // ---- throwing (o.fire: 'charge' | 'quick' | 'hold' | 'none')
      const locked = want && pl.lockTarget === want;
      if (bot.tapCd > 0) bot.tapCd--;
      if (bot.charging) {
        bot.chargeSteps++;
        if (bot.chargeSteps > 3 && pl.charge === 0) { bot.charging = false; } // charge was cancelled by a hit
      }
      const fire = o.fire || 'none';
      const release = () => { inp.throw = false; bot.charging = false; bot.throws++; if (pl.charge >= 1) bot.charged++; bot.tapCd = 8; };
      const press = () => { inp.throw = true; bot.charging = true; bot.chargeSteps = 0; };
      if (fire === 'hold') { if (bot.charging) inp.throw = true; else if (bot.tapCd <= 0) press(); }
      else if (fire === 'charge' && (locked || o.noLockNeeded)) {
        if (bot.charging) { if (pl.charge >= (o.releaseAt ?? 1)) release(); else inp.throw = true; }
        else if (bot.tapCd <= 0) press();
      } else if (fire === 'quick' && (locked || o.noLockNeeded)) {
        if (bot.charging) release();
        else if (bot.tapCd <= 0) { inp.throw = true; bot.tapCd = 14; bot.throws++; }
      } else if (bot.charging) inp.throw = true;   // keep holding a charge until there is something to hit
      // ---- movement
      const mv = chooseMove(o);
      if (mv) {
        const [mx, my] = toCam(mv[0], mv[1]);
        inp.move = [mx, my];
      }
      inp.jump = o.noJump ? false : wantJump();
      g.setInput(inp);
      g.step(1);
    };

    // ---------------------------------------------------------------- regular encounters
    const _o = new THREE.Vector3(), _d = new THREE.Vector3();
    qa.los = function (e) {
      _o.set(pl.position.x, pl.position.y + 0.7, pl.position.z);
      _d.set(e.position.x, e.position.y + (e.height || 1.2) * 0.5, e.position.z).sub(_o);
      const dist = _d.length();
      const hit = ctx.physics.raycast(_o, _d.normalize(), dist);
      return !hit || hit.distance >= dist - 0.4;
    };
    qa.watch = new Map(); // per-enemy movement diagnostics
    function watchEnemies(list) {
      for (const e of list) {
        let w = qa.watch.get(e);
        if (!w) { w = { type: e.type, home: [r2(e.home.x), r2(e.home.y), r2(e.home.z)], minY: e.position.y, maxDrop: 0, flips: 0, lastYaw: e.yaw, lastDYaw: 0, rescues: 0, stuckSteps: 0, states: {} }; qa.watch.set(e, w); }
        w.maxDrop = Math.max(w.maxDrop, e.home.y - e.position.y);
        w.minY = Math.min(w.minY, e.position.y);
        const dy = e.yaw - w.lastYaw;
        if (Math.abs(dy) > 0.02 && Math.sign(dy) !== Math.sign(w.lastDYaw) && Math.abs(w.lastDYaw) > 0.02) w.flips++;
        if (Math.abs(dy) > 0.02) w.lastDYaw = dy;
        w.lastYaw = e.yaw;
        w.rescues = e.rescues || 0;
        if (e.blocked) w.stuckSteps++;
        w.states[e.state] = (w.states[e.state] || 0) + 1;
      }
    }
    /**
     * Fight what o.enemies() returns until all are dead (or maxSteps). o: { enemies, area, maxSteps, jars:[{x,z}],
     * heal (hp to fetch a berry), keepNear, keepFar, lockMode:'game'|'pick', safeGround, until }
     */
    qa.encounter = function (o) {
      const log = { steps: 0, picks: [], oddPicks: [], hits0: qa.hits.length, deaths: 0, kills: 0, jar: 0, done: false };
      const k0 = qa.count('enemy:killed');
      let lastLock = null;
      for (let i = 0; i < (o.maxSteps || 3600); i++) {
        if (o.until && o.until()) break;
        const all = o.enemies().filter((e) => e.alive && !e.dying && e.hittable !== false);
        watchEnemies(o.enemies().filter((e) => e.alive && !e.dying));
        if (!all.length) { log.done = true; break; }
        if (pl.state === 'dead' || pl.visible === false) { const wasDead = pl.state === 'dead'; g.setInput({}); g.step(1); log.steps++; if (wasDead && pl.state !== 'dead') log.deaths++; continue; }
        const P = pl.position;
        const anvil = pl.tonic && pl.tonic.kind === 'anvil';
        // a human aims at the nearest bandit he can actually see (LOS refreshed every 10 steps)
        if (i % 10 === 0) for (const e of all) e._qaLos = qa.los(e);
        let near = null, nd = 1e9;
        for (const e of all) { if (e._qaIgnore > ctx.time.now) continue; const d = Math.hypot(e.position.x - P.x, e.position.z - P.z) + (e._qaLos === false ? 25 : 0); if (d < nd) { nd = d; near = e; } }
        if (!near) near = all[0];
        nd = Math.hypot(near.position.x - P.x, near.position.z - P.z);
        // locked on something that cannot be hit (no line of sight) for 1.5 s: let go and look elsewhere
        if (pl.lockTarget && pl.lockTarget._qaLos === false) { log.noLosSteps = (log.noLosSteps || 0) + 1; if ((pl._qaNoLos = (pl._qaNoLos || 0) + 1) > 90) { pl.lockTarget._qaIgnore = ctx.time.now + 6; pl._qaNoLos = 0; log.unlocks = (log.unlocks || 0) + 1; g.setInput({}); g.step(1); continue; } } else pl._qaNoLos = 0;
        const act = { enemies: all, area: o.area, safeGround: o.safeGround !== false, fire: 'none', lockAny: o.lockMode !== 'pick', aimAt: near, target: near, groundY: null };
        if (o.lockMode === 'pick') act.target = (o.pick && o.pick(all)) || near;
        const tgt = o.lockMode === 'pick' ? act.target : pl.lockTarget;
        // lock bookkeeping: which target did the game pick, compared with the nearest one?
        if (pl.lockTarget && pl.lockTarget !== lastLock) {
          const lt = pl.lockTarget, dl = Math.hypot(lt.position.x - P.x, lt.position.z - P.z);
          const rec = { t: r2(ctx.time.now), type: lt.type, d: r2(dl), los: qa.los(lt), nearest: near.type, nd: r2(nd), nearLos: qa.los(near), dy: r2(lt.position.y - P.y) };
          log.picks.push(rec);
          if ((lt !== near && dl > nd + 4) || !rec.los) log.oddPicks.push(rec);
        }
        lastLock = pl.lockTarget;
        // armoured and no iron: fetch an Anvil jar if there is one
        const armoured = tgt && tgt.armored;
        if (armoured && !anvil && o.jars && o.jars.length) {
          let jb = null, jd = 1e9;
          for (const j of o.jars) { const d = Math.hypot(j.x - P.x, j.z - P.z); if (d < jd) { jd = d; jb = j; } }
          act.goal = jb; act.goalW = 10; log.jarTrip = (log.jarTrip || 0) + 1;
        } else if (tgt) {
          const d = Math.hypot(tgt.position.x - P.x, tgt.position.z - P.z);
          act.keep = { e: tgt, min: tgt.type === 'ironbelly' ? 7.5 : tgt.type === 'grunt' ? 5 : 6, max: tgt.type === 'slinger' ? 13 : 10 };
          if (pl.lockTarget === tgt || o.lockMode === 'pick') act.fire = armoured && !anvil ? 'none' : d > 7 && !anvil ? 'charge' : 'quick';
          if (armoured && !anvil && !(o.jars && o.jars.length)) act.fire = 'quick'; // nothing else to do: keep throwing (clang)
        }
        if (!tgt && !act.goal) {
          // nothing locked: walk toward the nearest bandit we can see (aggro them, get into lock range)
          act.goal = { x: near.position.x, z: near.position.z }; act.goalW = 4;
          act.keep = { e: near, min: 6, max: 12 };
        }
        if (pl.hp <= (o.heal ?? 0)) {
          let best = null, bd = 1e9;
          for (const e of ctx.entities.query('berry')) { const d = Math.hypot(e.position.x - P.x, e.position.z - P.z); if (d < bd) { bd = d; best = e; } }
          if (best && bd < 25) { act.goal = { x: best.position.x, z: best.position.z }; act.goalW = 9; }
        }
        qa.act(act);
        log.steps++;
      }
      g.setInput({}); g.step(1);
      log.kills = qa.count('enemy:killed') - k0;
      log.hits = qa.hits.slice(log.hits0).map((x) => [x.t, x.src, x.hp]);
      log.left = o.enemies().filter((e) => e.alive && !e.dying).map((e) => ({ type: e.type, state: e.state, hp: e.hp, pos: [r2(e.position.x), r2(e.position.y), r2(e.position.z)] }));
      return log;
    };
    qa.watchReport = function () {
      const out = [];
      for (const [, w] of qa.watch) out.push({ type: w.type, home: w.home, maxDrop: r2(w.maxDrop), minY: r2(w.minY), flips: w.flips, rescues: w.rescues, blockedSteps: w.stuckSteps, states: w.states });
      return out;
    };

    qa.boss = boss;
    qa.r2 = r2;
  });
}
