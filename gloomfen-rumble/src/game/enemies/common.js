// Shared Bog Bandit behaviour. `Bandit` is the entity base class used by the grunt,
// slinger and ironbelly:
//   - perception: notice range + front cone + physics line of sight (throttled raycast)
//   - guarded locomotion: physics.moveCharacter, gravity, separation from other bandits,
//     a ground probe ahead that refuses to walk off ledges or into bog water, a leash
//   - common states: spawn, idle (scratch / yawn), patrol, alert ('!' + croak), return ('?'),
//     taunt (belly slap), stagger, knockback (flail), dying (spin up + spore poof + pot clatter)
//   - procedural animation from a target pose (lean, squash, arms, lids, mouth, walk cycle)
// Subclasses implement engage() (enter combat) and think(dt) (their own combat states).
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, dampAngle, angleDelta, rand, easeOutCubic } from '../../core/mathx.js';
import { buildToad } from './model.js';
import { getFx } from './fx.js';

export { buildToad, getFx };

export const GRAVITY = 30;
const LOD_OUTLINE_DIST2 = 34 * 34;
const LOD_SMALL_DIST2 = 16 * 16;
// merged-mesh LOD (model.js buildLods): beyond MID the body, lids and pot are one mesh; beyond FAR
// the whole toad is one static mesh. A little hysteresis keeps bandits on the boundary from flickering.
const LOD_MID_DIST = 12, LOD_FAR_DIST = 28, LOD_HYST = 1.5;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const RAY_HIT = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, collider: null };
const RAY_OPTS = { out: RAY_HIT, terrainStep: 0.6 };
const SPORE_COLORS = [0x5ef2e0, 0xc8fff0, 0x9ef06a];
let seedCounter = 11;

/** Shared defaults; each subclass passes its own cfg overrides. */
export const BANDIT_DEFAULTS = {
  hitRadius: 0.6, hitHeight: 1.3, bodyRadius: 0.45, bodyHeight: 1.15,
  walkSpeed: 1.6, runSpeed: 4.0, accel: 18, turnRate: 7,
  noticeRange: 13, loseRange: 20, leash: 14, patrol: 4, eyeHeight: 1.0, maxDrop: 0.5,
  hp: 3, points: 200,
};

export class Bandit {
  /**
   * def: spawn def { pos, yaw, hp, leash, leashCenter, patrol (radius, 0 = guard post), path ([[x,y,z]...]),
   *                  aggro (start alerted), dropIn (fall in with a poof), noticeRange, points }
   */
  constructor(ctx, def, cfg) {
    this.ctx = ctx;
    this.def = def;
    this.cfg = cfg = { ...BANDIT_DEFAULTS, ...cfg };
    this.fx = getFx(ctx);
    this.type = cfg.type;
    this.tags = new Set(['enemy', 'bandit', cfg.type]);
    this.team = 'enemy';
    this.alive = true;
    this.hittable = true;
    this.radius = cfg.hitRadius;
    this.height = cfg.hitHeight;
    this.maxHp = def.hp ?? cfg.hp;
    this.hp = this.maxHp;
    this.points = def.points ?? cfg.points;
    this.rng = rand(seedCounter++ * 7919);

    this.model = buildToad(ctx, cfg.look);
    this.object3d = this.model.root;
    this.object3d.userData.entity = this;
    const p = def.pos || [0, 0, 0];
    this.object3d.position.set(p[0], p[1], p[2]);
    const gy = ctx.physics.groundHeight(p[0], p[2], p[1] + 1);
    if (gy > -Infinity && gy > p[1] - 3) this.object3d.position.y = gy;
    this.yaw = def.yaw ?? 0;
    this.faceYaw = this.yaw;
    this.object3d.rotation.y = this.yaw;

    this.home = this.object3d.position.clone();
    this.homeYaw = this.yaw;
    this.leashCenter = def.leashCenter ? new THREE.Vector3().fromArray(def.leashCenter) : this.home.clone();
    this.leash = def.leash ?? cfg.leash;
    this.patrolRadius = def.patrol ?? cfg.patrol;
    this.path = def.path ? def.path.map((q) => new THREE.Vector3().fromArray(q)) : null;
    this.pathIdx = 0;
    this.noticeRange = def.noticeRange ?? cfg.noticeRange;
    this.waypoint = new THREE.Vector3().copy(this.home);

    this.body = {
      position: this.object3d.position, velocity: new THREE.Vector3(),
      radius: cfg.bodyRadius, height: cfg.bodyHeight, stepHeight: 0.35, onGround: false,
    };
    this.lastSafe = this.home.clone();
    this.safeT = 0;
    this.wantX = 0; this.wantZ = 0;
    this.turnRate = cfg.turnRate;
    this.blocked = false; this.blockedT = 0;

    // perception
    this.seeT = this.rng() * 0.2;
    this.sees = false;
    this.lostT = 0;
    this.aware = false;
    this.pdx = 0; this.pdz = 0; this.pdy = 0; this.pdist = 99; this.pyaw = 0;
    this.pendingAlert = -1;

    // animation
    this.P = makePose();
    this.A = makePose();
    this.walkPhase = this.rng() * 6;
    this.blinkT = 1 + this.rng() * 3;
    this.flash = 0;
    this.idleAct = null; this.idleActT = 0; this.idleNext = 2 + this.rng() * 4;
    this.hop = 0;

    this.dying = false;
    this.dieT = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.stateDur = 1 + this.rng() * 2;
    if (def.dropIn) {
      this.object3d.position.y += 4;
      this.body.velocity.y = -2;
      this.setState('spawn');
      this.fx.floater('alert', { follow: this.object3d, offset: _v.set(0, this.cfg.hitHeight + 0.7, 0), life: 0.9, size: 0.7 });
    } else if (def.aggro) {
      this.aware = true;
      this.setState('alert', 0.45);
    }
  }

  get position() { return this.object3d.position; }

  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.stateDur = dur; }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.stateT += dt;
    if (this.dying) { this.updateDying(dt); return; }
    this.perceive(dt);
    this.wantX = 0; this.wantZ = 0;
    resetPose(this.P);
    if (!this.thinkCommon(dt)) this.think(dt);
    this.locomote(dt);
    this.animate(dt);
    this.updateLook(dt);
  }

  // ------------------------------------------------------------------ perception
  get player() { return this.ctx.player; }
  playerTargetable() {
    const pl = this.ctx.player;
    return pl && pl.state !== 'dead' && pl.visible !== false;
  }
  perceive(dt) {
    const pl = this.ctx.player, pos = this.position;
    this.pdx = pl.position.x - pos.x;
    this.pdz = pl.position.z - pos.z;
    this.pdy = pl.position.y - pos.y;
    this.pdist = Math.hypot(this.pdx, this.pdz);
    this.pyaw = Math.atan2(this.pdx, this.pdz);
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.2;
      this.sees = this.computeSees();
    }
    if (this.sees) this.lostT = 0; else this.lostT += dt;
  }
  computeSees() {
    if (!this.playerTargetable()) return false;
    const range = this.aware ? this.cfg.loseRange : this.noticeRange;
    if (this.pdist > range || Math.abs(this.pdy) > 6) return false;
    if (!this.aware) {
      const ang = Math.abs(angleDelta(this.yaw, this.pyaw));
      if (ang > 1.9 && this.pdist > range * 0.45) return false;
    }
    return this.lineOfSight();
  }
  lineOfSight() {
    const pl = this.ctx.player;
    _v.copy(this.position); _v.y += this.cfg.eyeHeight;
    _dir.set(pl.position.x - _v.x, pl.position.y + 0.6 - _v.y, pl.position.z - _v.z);
    const d = _dir.length();
    if (d < 0.5) return true;
    const hit = this.ctx.physics.raycast(_v, _dir, d, RAY_OPTS);
    return !hit || hit.distance >= d - 0.3;
  }
  /** Is a point inside the leash circle? */
  inLeash(x, z, margin = 0) {
    return Math.hypot(x - this.leashCenter.x, z - this.leashCenter.z) <= this.leash + margin;
  }
  /** Morel has escaped: too far from the leash, or hidden for a while. */
  playerLost() {
    if (!this.playerTargetable()) return true;
    if (this.lostT > 3) return true;
    const pl = this.ctx.player.position;
    return !this.inLeash(pl.x, pl.z, this.cfg.giveUp ?? 6);
  }

  // ------------------------------------------------------------------ common states
  thinkCommon(dt) {
    const c = this.cfg;
    switch (this.state) {
      case 'spawn': {
        this.P.lid = 1; this.P.armLz = 1.2; this.P.armRz = -1.2; this.P.squash = 1.1;
        if (this.body.onGround && this.stateT > 0.1) {
          this.ctx.particles.burst({ position: this.position, count: 14, color: [0xb08850, 0xd8c098], speed: 3, spread: 0.6, life: 0.5, size: 0.4, kind: 'puff' });
          this.aware = true;
          this.setState('alert', 0.35);
        }
        return true;
      }
      case 'idle': {
        this.idleBehaviour(dt);
        if (this.checkNotice()) return true;
        if (this.stateT > this.stateDur && !this.idleAct) {
          if (this.pickWaypoint()) this.setState('patrol', 6);
          else this.setState('idle', 2 + this.rng() * 3);
        }
        return true;
      }
      case 'patrol': {
        if (this.checkNotice()) return true;
        const dx = this.waypoint.x - this.position.x, dz = this.waypoint.z - this.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.35 || this.stateT > this.stateDur || this.blockedT > 0.4) {
          this.setState('idle', 1.5 + this.rng() * 3);
          return true;
        }
        this.moveToward(this.waypoint.x, this.waypoint.z, c.walkSpeed);
        return true;
      }
      case 'alert': {
        if (this.stateT === dt) this.onAlert();
        this.face(this.pyaw, 10);
        this.P.lid = 1.05; this.P.mouth = this.stateT < 0.35 ? 0.85 : 0; this.P.squash = 1.08;
        this.P.armLz = 0.9; this.P.armRz = -0.9; this.P.lean = -0.15;
        if (this.stateT > (this.stateDur || 0.6)) this.engage();
        return true;
      }
      case 'return': {
        if (this.stateT > 1.2 && this.checkNotice()) return true;
        const dx = this.home.x - this.position.x, dz = this.home.z - this.position.z;
        if (Math.hypot(dx, dz) < 0.5 || this.stateT > 20 || (this.blockedT > 1.5 && this.stateT > 2)) {
          this.aware = false;
          this.faceYaw = this.homeYaw;
          this.setState('idle', 1 + this.rng() * 2);
          return true;
        }
        this.moveToward(this.home.x, this.home.z, c.walkSpeed * 1.25);
        return true;
      }
      case 'taunt': {
        this.face(this.pyaw, 5);
        tauntPose(this.P, this.stateT);
        if (this.stateT > 0.1 && Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) {
          this.fx.sfx('bellySlap', this.position, 0.6);
        }
        if (this.stateT > (this.stateDur || 1.2)) {
          if (this.sees && !this.playerLost()) this.engage();
          else this.lose();
        }
        return true;
      }
      case 'stagger': {
        this.P.lean = -0.4; this.P.lid = 1.05; this.P.mouth = 0.55; this.P.armLz = 1.1; this.P.armRz = -1.1;
        this.P.roll = this.staggerRoll; this.P.lambda = 18;
        if (this.stateT > this.stateDur) this.engage();
        return true;
      }
      case 'knockback': {
        const t = this.stateT;
        this.P.lean = -0.55; this.P.lid = 1.05; this.P.mouth = 0.85;
        this.P.armLx = -1.6 + Math.sin(t * 26) * 1.4; this.P.armRx = -1.6 + Math.sin(t * 26 + Math.PI) * 1.4;
        this.P.armLz = 1.2; this.P.armRz = -1.2; this.P.lambda = 25;
        if (this.body.onGround && t > 0.25) {
          const v = this.body.velocity;
          v.x = damp(v.x, 0, 8, dt); v.z = damp(v.z, 0, 8, dt);
          if (t > this.stateDur) this.setState('stagger', 0.3);
        }
        return true;
      }
    }
    return false;
  }

  /** Called once when entering 'alert': '!' pop, croak, hop, wake friends. */
  onAlert() {
    this.aware = true;
    this.fx.floater('alert', { follow: this.object3d, offset: _v.set(0, this.cfg.hitHeight + 0.55, 0), life: 1.0, size: 0.75 });
    if (this.body.onGround) this.body.velocity.y = 4.2;
    this.ctx.events.emit('enemy:alert', { entity: this, type: this.type });
    // nearby pals wake up a moment later
    const list = this.ctx.entities.query('bandit');
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === this || e.dying || e.aware || !(e instanceof Bandit)) continue;
      if (e.position.distanceTo(this.position) < 8) e.pendingAlert = 0.25 + e.rng() * 0.35;
    }
  }

  checkNotice() {
    if (this.pendingAlert >= 0) {
      this.pendingAlert -= this.ctx.time.dt;
      if (this.pendingAlert < 0 && this.playerTargetable()) { this.setState('alert', 0.6); return true; }
    }
    if (this.sees) { this.setState('alert', 0.6); return true; }
    return false;
  }

  /** Give up the chase: '?' and walk home. */
  lose() {
    this.fx.floater('question', { follow: this.object3d, offset: _v.set(0, this.cfg.hitHeight + 0.55, 0), life: 1.1, size: 0.65 });
    this.aware = false;
    this.setState('return');
  }

  /** Taunt when Morel is out of reach / just got hit / died. */
  taunt(dur = 1.3) { this.setState('taunt', dur); }

  pickWaypoint() {
    if (this.path && this.path.length) {
      this.pathIdx = (this.pathIdx + 1) % this.path.length;
      this.waypoint.copy(this.path[this.pathIdx]);
      return true;
    }
    if (this.patrolRadius <= 0.2) return false;
    for (let k = 0; k < 6; k++) {
      const a = this.rng() * Math.PI * 2, d = this.patrolRadius * (0.35 + this.rng() * 0.65);
      const x = this.home.x + Math.sin(a) * d, z = this.home.z + Math.cos(a) * d;
      if (this.safeAt(x, z)) { this.waypoint.set(x, this.home.y, z); return true; }
    }
    return false;
  }

  idleBehaviour(dt) {
    const P = this.P;
    P.lid = 0.55;
    if (!this.idleAct) {
      this.idleNext -= dt;
      if (this.idleNext <= 0) {
        this.idleAct = this.rng() < 0.5 ? 'scratch' : 'yawn';
        this.idleActT = 0;
        if (this.idleAct === 'yawn') this.fx.sfx('yawn', this.position, 0.5);
      }
      // slow look-around
      this.faceYaw = this.homeYaw + Math.sin(this.stateT * 0.5 + this.walkPhase) * 0.5;
      this.turnRate = 1.5;
      return;
    }
    this.idleActT += dt;
    const t = this.idleActT;
    if (this.idleAct === 'scratch') {
      // reach up and scratch under the pot
      P.armLx = -2.55; P.armLz = -0.2 + Math.sin(t * 28) * 0.18; P.helmetZ = Math.sin(t * 28) * 0.06;
      P.lid = 0.3; P.roll = 0.1; P.lean = -0.05;
      if (t > 1.3) this.endIdleAct();
    } else {
      // big yawn and stretch
      const k = Math.sin(clamp01(t / 1.7) * Math.PI);
      P.mouth = k; P.lid = lerp(0.5, 0.0, k); P.lean = -0.3 * k;
      P.armLx = -2.2 * k; P.armRx = -2.2 * k; P.armLz = 0.35 + 0.5 * k; P.armRz = -0.35 - 0.5 * k;
      P.squash = 1 + 0.08 * k;
      if (t > 1.8) this.endIdleAct();
    }
  }
  endIdleAct() { this.idleAct = null; this.idleNext = 3 + this.rng() * 5; }

  // ------------------------------------------------------------------ movement helpers
  face(yaw, rate = this.cfg.turnRate) { this.faceYaw = yaw; this.turnRate = rate; }
  moveToward(x, z, speed, faceIt = true) {
    const dx = x - this.position.x, dz = z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    this.wantX = (dx / d) * speed; this.wantZ = (dz / d) * speed;
    if (faceIt) this.face(Math.atan2(dx, dz));
  }
  moveDir(dx, dz, speed) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    this.wantX = (dx / d) * speed; this.wantZ = (dz / d) * speed;
  }

  /** Can a bandit stand at (x, z)? Not water, and roughly level with fromY (within 0.8 m). */
  safeAt(x, z, fromY = this.position.y) {
    const ph = this.ctx.physics;
    const gh = ph.groundHeight(x, z, fromY + 0.45);
    return gh > -Infinity && gh >= fromY - 0.8 && gh >= ph.waterLevel + 0.3;
  }

  /**
   * Probe ahead of a horizontal velocity; zero it if the step would be unsafe. Returns true if blocked.
   * Near probe (just past the body): at most cfg.maxDrop lower. Far probe: at most 0.6 m below the near
   * one (a walkable slope, not a ledge). Both must be above water + 0.3.
   */
  guard(v) {
    const sp = Math.hypot(v.x, v.z);
    if (sp < 0.05) return false;
    const nx = v.x / sp, nz = v.z / sp;
    const ph = this.ctx.physics, x = this.position.x, z = this.position.z, y = this.position.y;
    const d1 = this.body.radius + 0.18, d2 = this.body.radius + 0.4 + sp * 0.1;
    const minY = ph.waterLevel + 0.3;
    const g1 = ph.groundHeight(x + nx * d1, z + nz * d1, y + 0.45);
    let ok = g1 > -Infinity && g1 >= y - this.cfg.maxDrop && g1 >= minY;
    if (ok) {
      const g2 = ph.groundHeight(x + nx * d2, z + nz * d2, y + 0.45);
      ok = g2 > -Infinity && g2 >= g1 - 0.6 && g2 >= minY;
    }
    if (ok) return false;
    v.x = 0; v.z = 0;
    return true;
  }

  locomote(dt) {
    const b = this.body, v = b.velocity, c = this.cfg, pos = this.position;
    let tx = this.wantX, tz = this.wantZ;
    const control = this.state !== 'knockback' && this.state !== 'spawn';

    // keep the leash: drop any outward component once outside
    if (control && (tx || tz) && !this.inLeash(pos.x + tx * 0.25, pos.z + tz * 0.25)) {
      const ox = pos.x - this.leashCenter.x, oz = pos.z - this.leashCenter.z;
      const ol = Math.hypot(ox, oz) || 1;
      const out = (tx * ox + tz * oz) / ol;
      if (out > 0) { tx -= (out * ox) / ol; tz -= (out * oz) / ol; this.leashBlocked = true; }
    } else this.leashBlocked = false;

    // separation from other bandits (and the boss)
    const list = this.ctx.entities.query('bandit');
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === this || e.dying) continue;
      const ep = e.position;
      const dx = pos.x - ep.x, dz = pos.z - ep.z;
      const min = b.radius + (e.body ? e.body.radius : 0.5) + 0.15;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), k = ((min - d) / min) * 4;
        tx += (dx / d) * k; tz += (dz / d) * k;
      }
    }

    if (control) {
      const acc = (b.onGround ? c.accel : c.accel * 0.3) * dt;
      v.x += clamp(tx - v.x, -acc, acc);
      v.z += clamp(tz - v.z, -acc, acc);
    }
    const blocked = this.guard(v);
    this.blocked = blocked || (this.leashBlocked && Math.hypot(this.wantX, this.wantZ) > 0.1);
    if (this.blocked) this.blockedT += dt; else this.blockedT = Math.max(0, this.blockedT - dt * 2);

    v.y -= GRAVITY * dt;
    this.ctx.physics.moveCharacter(b, dt);

    // turn toward faceYaw
    this.yaw = dampAngle(this.yaw, this.faceYaw, this.turnRate, dt);
    this.object3d.rotation.y = this.yaw;

    // remember safe ground; rescue from water / the void (should never happen)
    const ph = this.ctx.physics;
    if (b.onGround) {
      this.safeT -= dt;
      if (this.safeT <= 0 && pos.y >= ph.waterLevel + 0.3) { this.safeT = 0.5; this.lastSafe.copy(pos); }
    }
    const onBox = b.onGround && b.ground && b.ground !== 'terrain';
    if ((pos.y < ph.waterLevel + 0.1 && !onBox) || pos.y < -30) {
      this.ctx.particles.burst({ position: _v.set(pos.x, ph.waterLevel + 0.1, pos.z), count: 16, color: [0x2c5a48, 0x9cc8b0], speed: 4, spread: 0.45, life: 0.6, size: 0.3, gravity: 12, kind: 'puff' });
      this.fx.sfx('splash', pos, 0.7);
      pos.copy(this.lastSafe);
      v.set(0, 0, 0);
      this.rescues = (this.rescues || 0) + 1;
    }
  }

  // ------------------------------------------------------------------ damage
  /** Entity contract. Returns false when deflected. */
  hurt(amount, info = {}) {
    if (!this.alive || this.dying || this.hittable === false) return false;
    if (this.deflect(amount, info)) return false;
    this.hp -= amount;
    this.flash = 1;
    const pos = this.position;
    this.ctx.particles.burst({ position: _v.set(pos.x, pos.y + this.height * 0.6, pos.z), count: 10 + amount * 4, color: [this.cfg.look.skin, 0xf3e6c8, 0x5ef2e0], speed: 4, life: 0.5, size: 0.14, gravity: 8, kind: 'puff' });
    if (this.hp <= 0) { this.hp = 0; this.die(info); return true; }
    this.ctx.events.emit('enemy:hurt', { entity: this, type: this.type, amount, hp: this.hp });
    this.aware = true;
    this.lostT = 0;
    this.idleAct = null;
    const heavy = info.heavy || (info.charge ?? 0) >= 0.5 || amount >= 2;
    if (heavy) this.knockback(info.dir, info.heavy ? 7.5 : 5.5);
    else { this.staggerRoll = (this.rng() - 0.5) * 0.5; this.setState('stagger', 0.38); }
    this.onHurt(amount, info);
    return true;
  }
  /** Override to deflect hits (armour). Return true = deflected. */
  deflect(_amount, _info) { return false; }
  onHurt(_amount, _info) {}

  knockback(dir, speed) {
    const v = this.body.velocity;
    if (dir && (dir.x || dir.z)) _v.set(dir.x, 0, dir.z).normalize();
    else _v.set(-this.pdx, 0, -this.pdz).normalize();
    v.x = _v.x * speed; v.z = _v.z * speed; v.y = 4.5;
    this.body.onGround = false;
    this.setState('knockback', 0.45);
  }

  die(info = {}) {
    if (this.dying) return;
    this.setLod(0);              // the real pot must be visible before it clatters away
    this.dying = true;
    this.dieT = 0;
    this.hittable = false;
    this.tags.delete('enemy');
    const pos = this.position;
    this.ctx.events.emit('enemy:killed', { entity: this, type: this.type, position: pos.clone(), points: this.points });
    // the tin pot clatters away
    const d = info.dir && (info.dir.x || info.dir.z) ? _dir.set(info.dir.x, 0, info.dir.z).normalize() : _dir.set(-this.pdx, 0, -this.pdz).normalize();
    const s = this.cfg.look.scale || 1;
    this.fx.prop(this.model.helmet, {
      velocity: _v2.set(d.x * 2.6 + (this.rng() - 0.5) * 1.5, 7, d.z * 2.6 + (this.rng() - 0.5) * 1.5),
      spin: _v.set(9 * (this.rng() - 0.5), 14, 12 * (this.rng() - 0.5)), life: 2.6, radius: 0.14 * s, sound: 'potClatter',
    });
    this.model.mouthOpen.visible = true;
    this.onDie(info);
  }
  onDie(_info) {}

  updateDying(dt) {
    this.dieT += dt;
    const t = this.dieT, m = this.model;
    const k = easeOutCubic(clamp01(t / 0.55));
    m.rig.position.y = k * 1.5;
    m.rig.rotation.y += dt * (10 + t * 34);
    m.rig.rotation.z = Math.sin(t * 9) * 0.25;
    const s = (this.cfg.look.scale || 1) * (t < 0.3 ? 1 + t * 0.4 : Math.max(0.05, 1.12 - (t - 0.3) * 3.2));
    m.rig.scale.set(s, s * (t < 0.3 ? 1 + t * 0.6 : 1), s);
    m.mouthOpen.scale.y = 0.12;
    m.lidL.rotation.x = m.lidR.rotation.x = -0.6;
    m.armL.rotation.z = 1.4 + Math.sin(t * 30) * 0.4; m.armR.rotation.z = -1.4 - Math.sin(t * 30) * 0.4;
    this.flash = Math.max(this.flash, 0.22);
    this.updateLook(dt);
    if (t >= 0.5 && !this.poofed) {
      this.poofed = true;
      _v.copy(this.position); _v.y += 1.5 + this.height * 0.4;
      this.ctx.particles.burst({ position: _v, count: 34, color: SPORE_COLORS, speed: 5.5, life: 0.9, size: 0.2, kind: 'glow', intensity: 2.2 });
      this.ctx.particles.burst({ position: _v, count: 18, color: [this.cfg.look.skin, this.cfg.look.cloak ? this.cfg.look.cloak.color : 0xb39463, 0xe8dcc0], speed: 3.5, life: 0.8, size: 0.45, kind: 'puff' });
      m.rig.visible = false;
    }
    if (t >= 0.62) this.alive = false;
  }

  // ------------------------------------------------------------------ animation
  animate(dt) {
    const P = this.P, A = this.A, m = this.model, b = this.body;
    const lam = P.lambda;
    for (const k of POSE_KEYS) A[k] = damp(A[k], P[k], lam, dt);

    // walk cycle from actual ground speed
    const hs = Math.hypot(b.velocity.x, b.velocity.z);
    const stride = b.onGround ? clamp(hs / this.cfg.runSpeed, 0, 1) : 0;
    this.walkPhase += hs * dt * (5.2 / Math.max(0.5, this.cfg.look.scale || 1));
    const ph = this.walkPhase;
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    const fb = m.footBase;
    m.footL.position.set(fb[0], Math.max(0, sL) * 0.11 * stride, fb[1] + Math.cos(ph) * 0.13 * stride);
    m.footR.position.set(-fb[0], Math.max(0, sR) * 0.11 * stride, fb[1] + Math.cos(ph + Math.PI) * 0.13 * stride);
    if (!b.onGround && this.state !== 'spawn') { m.footL.position.y = 0.06; m.footR.position.y = 0.06; }

    // blink
    this.blinkT -= dt;
    let lid = A.lid;
    if (this.blinkT < 0) { lid = Math.min(lid, 0.02); if (this.blinkT < -0.12) this.blinkT = 2 + this.rng() * 4; }

    // hop squash (landing)
    const breathe = Math.sin(this.stateT * 2.4 + ph * 0.1) * 0.015;
    const sq = A.squash + breathe;
    const bob = Math.abs(Math.sin(ph)) * 0.05 * stride + A.bob;
    m.pivot.position.y = 0.2 + bob;
    m.pivot.rotation.set(A.lean + stride * 0.18, A.twist, A.roll + Math.sin(ph) * 0.09 * stride);
    m.pivot.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    m.armL.rotation.set(A.armLx + Math.sin(ph) * 0.55 * stride, 0, A.armLz);
    m.armR.rotation.set(A.armRx + Math.sin(ph + Math.PI) * 0.55 * stride, 0, A.armRz);

    // 0 closed .. 0.62 sleepy (lid edge just over the pupil) .. 1 wide open
    const lidAngle = lid < 0.62 ? lerp(1.45, -0.22, clamp01(lid / 0.62)) : lerp(-0.22, -0.85, clamp01((lid - 0.62) / 0.43));
    m.lidL.rotation.x = lidAngle; m.lidR.rotation.x = lidAngle;
    m.lidL.rotation.z = -A.lidTilt; m.lidR.rotation.z = A.lidTilt;

    const mo = A.mouth;
    m.mouthOpen.visible = mo > 0.04;
    m.mouthOpen.scale.y = Math.max(0.001, mo * 0.13);

    m.helmetPivot.rotation.z = (this.cfg.look.potTilt?.[2] ?? 0.12) + A.helmetZ;
    m.helmetPivot.rotation.x = (this.cfg.look.potTilt?.[0] ?? -0.25) + A.helmetX + (b.onGround ? 0 : -0.1);
    this.animateExtra(dt);
  }
  /** Subclass hook for weapon-specific bits (sling spin, swoosh...). */
  animateExtra(_dt) {}

  /** Hurt flash + outline LOD. */
  updateLook(dt) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      const f = this.flash * this.flash;
      this.model.material.emissive.setRGB(f * 0.6, f * 0.48, f * 0.36);
    }
    const cam = this.ctx.camera;
    if (cam) {
      // outline LOD: body/helmet hulls to 34 m, small parts (arms, feet) to 16 m (scaled for big models)
      const s = this.cfg.look.scale || 1;
      const d2 = cam.position.distanceToSquared(this.position) / (s * s);
      const near = d2 < LOD_OUTLINE_DIST2, close = d2 < LOD_SMALL_DIST2;
      if (near !== this._hullsOn) { this._hullsOn = near; for (const h of this.model.hulls) h.visible = near; }
      if (close !== this._smallOn) { this._smallOn = close; for (const h of this.model.hullsSmall) h.visible = close; }
      const lod = this.model.lod;
      if (lod) {
        let want = 0;
        if (!this.dying) {
          const d = Math.sqrt(d2), h = lod.level > 0 ? -LOD_HYST : 0, hf = lod.level > 1 ? -LOD_HYST : 0;
          want = d > LOD_FAR_DIST + hf ? 2 : d > LOD_MID_DIST + h ? 1 : 0;
        }
        if (want !== lod.level || !!this.armored !== lod.armoured) this.setLod(want);
      }
    }
  }

  /**
   * 0 = every part, 1 = merged body/lids/pot + animated arms and feet, 2 = one static mesh.
   * Parts that can fly off as props (pot, cauldron) are only hidden, never detached, so setLod(0)
   * before spawning such a prop shows them again.
   */
  setLod(level) {
    const m = this.model, lod = m.lod;
    if (!lod) return;
    const armoured = !!this.armored && !!lod.midArmour;
    lod.level = level; lod.armoured = !!this.armored;
    const full = level === 0, limbs = level < 2;
    m.bodyMesh.visible = full; m.lidL.visible = full; m.lidR.visible = full; m.helmet.visible = full;
    if (this.armored && m.cauldron) for (const c of m.cauldron) c.visible = full;
    m.armL.visible = limbs; m.armR.visible = limbs; m.footL.visible = limbs; m.footR.visible = limbs;
    lod.mid.visible = level === 1 && !armoured;
    lod.far.visible = level === 2 && !armoured;
    if (lod.midArmour) { lod.midArmour.visible = level === 1 && armoured; lod.farArmour.visible = level === 2 && armoured; }
  }

  dispose() {}

  // ------------------------------------------------------------------ debug
  /** JSON-safe snapshot for scenarios. */
  debug() {
    const p = this.position;
    return { type: this.type, state: this.state, hp: this.hp, pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], aware: this.aware, sees: this.sees, dying: this.dying };
  }
}

// ---------------------------------------------------------------------------
// Pose helpers
// ---------------------------------------------------------------------------
const POSE_DEFAULT = {
  lean: 0, roll: 0, twist: 0, squash: 1, bob: 0,
  armLx: 0.1, armLz: 0.42, armRx: 0.1, armRz: -0.42,
  lid: 0.62, lidTilt: 0, mouth: 0, helmetX: 0, helmetZ: 0,
};
const POSE_KEYS = Object.keys(POSE_DEFAULT);
function makePose() { return { ...POSE_DEFAULT, lambda: 12 }; }
function resetPose(P) { for (const k of POSE_KEYS) P[k] = POSE_DEFAULT[k]; P.lambda = 12; }
export { POSE_KEYS, resetPose };

/** Belly-slap taunt: arms alternate slapping the belly, belly jiggles, smug croak. */
export function tauntPose(P, t) {
  const s = Math.sin(t * 19);
  P.armLx = -0.95 + s * 0.35; P.armRx = -0.95 - s * 0.35;
  P.armLz = -0.45; P.armRz = 0.45;
  P.squash = 1 + Math.abs(s) * 0.05;
  P.lean = -0.18; P.mouth = 0.55 + s * 0.2; P.lid = 0.35; P.lidTilt = -0.2;
  P.lambda = 30;
}

/** Helper for subclasses: horizontal distance between two vectors. */
export function hdist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
