// Chief Gnarlbelly — boss of Gnarlbelly's Pit. A huge toad (3x a grunt) in a dented
// crown-pot with an iron chest plate and a log for a club.
//
// Fight (24 hp, 8 per phase). He only takes damage while DIZZY (stars + glowing belly);
// every other hit boings off (hurt() returns false).
//   dormant on his throne -> Morel within 18 m: roar, boss:start, boss:phase 1, hud.showBossBar(true)
//   phase 1: stomp shockwaves (jump them) + log slams with ground cracks when Morel is close.
//            After every third stomp his foot gets stuck -> dizzy 3 s.
//   phase 2: + mud barrages (landing markers), summons grunts, and pulls his chest plate down over
//            his belly: puffs clang off until an iron ball (Anvil Tonic, jar spawned on the arena ring)
//            cracks it off (armor:break).
//   phase 3: enraged (red tint, steam): faster stomps and belly-slide charges across the arena;
//            crashing into the edge leaves him dizzy.
//   0 hp: boss:defeated + big spore explosion, he puffs up, deflates like a balloon and flops flat.
// A dizzy window ends early once it has taken 4 damage (so each phase needs at least two windows).
// If Morel dies the fight resets to the start of the current phase on his respawn.
import * as THREE from 'three';
import { Bandit, tauntPose } from './enemies/common.js';
import { part, merge, TEMPLATES as T } from './enemies/model.js';
import { getModelKit } from './enemies/model.js';
import { clamp, clamp01, lerp, damp, angleDelta, easeOutCubic } from '../core/mathx.js';

export const BOSS_LOOK = {
  id: 'boss', seed: 21, scale: 3, lod: false,     // (lod: the arena fight is always close; no merged LOD meshes)
  W: 0.62, H: 0.52, D: 0.56, bodyY: 0.62,
  skin: 0x728c36, skinDark: 0x47591f, belly: 0xecc888, eye: 0xffb43a,
  eyeR: 0.15, eyeSpread: 0.4, eyePop: 0.06, mouthLat: 0.03, mouthR: 0.011, mouthSpan: 1.3, noseScale: 0.75,
  legScale: 1.12, footScale: 1.1, armR: 0.1, armLen: 0.27, handR: 0.11,
  potR: 0.25, potH: 0.2, potTilt: [-0.1, 0.35, 0.1], potColor: 0x9a8a74, potSink: 0.03, potFwd: 0.04, potDent: 0.7,
  crown: true,
  cloak: { color: 0xd06a58, top: 0.66, bottom: 0.62, cover: Math.PI * 1.15, flare: 0.14, jag: 0.6, topCover: 0.8 },
  weapon: 'log', chestPlate: true, plateY: [-0.4, -0.06], plateSpan: 1.3, bellyGlow: true, glowColor: 0xff8a3a,
  outline: 0.009, warts: 34, wartScale: 0.8,
};

export const BOSS_TUNING = {
  maxHp: 24, phaseStart: [24, 16, 8], phaseFloor: [16, 8, 0],
  wakeRange: 18,
  walk: [3.0, 3.4, 4.4],
  stompWindup: [0.8, 0.68, 0.46], stompRecover: [0.5, 0.42, 0.3],
  ringSpeed: [9, 10, 12], ringMax: 26, ringWidth: 0.6, ringHeight: 0.85, stompHitRadius: 3.0,
  clubRange: 6.5, clubCooldown: 4, clubWindup: 0.9, clubReach: 5.0, clubHitRadius: 2.4, clubRecover: 0.8,
  dizzyTime: 3.0, dizzyCap: 4,
  barrage: { count: 5, spread: 3.4, gravity: 18, windup: 0.6, interval: 0.1, radius: 0.42 },
  slide: { windup: 0.9, speed: 15, maxTime: 2.6, steer: 0.9 },
  summonFirst: 3, summonMore: 2, minionLeashPad: 2.5,
};

const CFG = {
  type: 'boss', look: BOSS_LOOK, hp: 24, points: 0,
  hitRadius: 1.9, hitHeight: 4.0, bodyRadius: 1.5, bodyHeight: 3.6,
  walkSpeed: 3.0, runSpeed: 4.4, accel: 14, turnRate: 3,
  noticeRange: 0, loseRange: 60, leash: 19, patrol: 0, eyeHeight: 3.2, maxDrop: 2.0,
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _vel = new THREE.Vector3();
const SPORES = [0x5ef2e0, 0xff5fb2, 0xffc35a, 0xc8fff0, 0x9ef06a];
const DUST = { color: 0xc09a62, life: 0.6, size: 0.7, kind: 'puff', gravity: -0.4, drag: 2.5, alpha: 0.8 };
const STEAM = { color: 0xffe8e0, life: 0.6, size: 0.45, kind: 'puff', gravity: -1, drag: 1.5, alpha: 0.5 };

class Gnarlbelly extends Bandit {
  constructor(ctx, def) {
    const arena = def.arena || {};
    const center = arena.center || [0, 2, 395];
    const radius = arena.radius ?? 22;
    const pos = def.pos || [0, 2, 402];
    const yaw = def.yaw ?? Math.atan2(center[0] - pos[0], center[2] - pos[2]);
    super(ctx, { ...def, pos, yaw, patrol: 0, leash: radius - 2.6, leashCenter: center, noticeRange: 0, aggro: false, dropIn: false }, CFG);
    this.T = BOSS_TUNING;
    this.arenaCenter = new THREE.Vector3().fromArray(center);
    this.arenaRadius = radius;
    this.maxHp = this.T.maxHp;
    this.hp = this.maxHp;
    this.phase = 0;
    this.fightOn = false;
    this.defeated = false;
    this.plateState = 'chest';
    this.plateAnim = 0;
    this.stompCount = 0;
    this.stompFoot = 1;
    this.seqIdx = 0;
    this.clubCd = 0;
    this.windowDmg = 0;
    this.flinchT = 0;
    this.footRaise = 0;
    this.dizzyKind = 'stuck';
    this.jiggle = 0;
    this.sit = 1;
    this.enrage = 0;
    this.minions = [];
    this.jar = null;
    this.pendingReset = false;
    this.snoreT = 0.5;
    this.steamT = 0;
    this.stats = { stomps: 0, clubs: 0, barrages: 0, slides: 0, dizzy: 0, summoned: 0, deflected: 0, resets: 0 };
    this.buildExtras();
    this.throne = def.throne === false ? null : buildThrone(ctx, this.home, this.homeYaw);
    this.offs = [
      ctx.events.on('player:died', () => { if (this.fightOn && !this.defeated) this.pendingReset = true; }),
      // a checkpoint respawn (after a death, or the pause menu's "Restart from checkpoint") resets the
      // fight to the start of the current phase; water-fall respawns (checkpointId null) do not
      ctx.events.on('player:respawn', (p) => {
        if (!p || p.checkpointId === null || p.checkpointId === undefined) return;
        if (this.pendingReset || (this.fightOn && !this.defeated && this.state !== 'waiting')) this.resetToPhaseStart();
      }),
    ];
    this.setState('dormant');
  }

  buildExtras() {
    const M = this.ctx.materials, m = this.model, fx = this.fx;
    // dizzy stars circling over his head
    this.stars = new THREE.Group();
    const ht = m.dims.headTop;
    this.stars.position.set(ht[0], ht[1] + 0.32, ht[2]);
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.textures.star, transparent: true, depthWrite: false, fog: false }));
      const a = (k / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.36, Math.sin(a * 2) * 0.04, Math.sin(a) * 0.36);
      s.scale.setScalar(0.16);
      this.stars.add(s);
    }
    this.stars.visible = false;
    m.inner.add(this.stars);
    // glowing gem on the crown pot
    this.gemMat = M.glow(0xffc35a, 2.2);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), this.gemMat);
    gem.position.set(0, BOSS_LOOK.potH * 0.55, BOSS_LOOK.potR * 0.97);
    m.helmet.add(gem);
    this.gem = gem;
    this.plateBase = m.platePivot.position.clone();
  }

  // ------------------------------------------------------------------ helpers
  get ph() { return Math.max(0, this.phase - 1); }
  engage() { this.setState('approach', 1); }
  thinkCommon() { return false; }
  lose() { /* the boss never gives up */ }
  aliveMinions() { this.minions = this.minions.filter((e) => e.alive && !e.dying); return this.minions.length; }
  emitHud(on) { try { this.ctx.hud.showBossBar?.(on); } catch { /* hud stub */ } }

  head(out) {
    const p = this.position;
    return out.set(p.x, p.y + 3.6, p.z);
  }
  mouth(out) {
    const p = this.position;
    return out.set(p.x + Math.sin(this.yaw) * 1.7, p.y + 1.95, p.z + Math.cos(this.yaw) * 1.7);
  }

  // ------------------------------------------------------------------ brain
  think(dt) {
    const T = this.T, P = this.P, pl = this.ctx.player;
    this.clubCd -= dt;
    if (this.flinchT > 0) this.flinchT -= dt;
    this.jiggle = Math.max(0, this.jiggle - dt * 3);
    this.footRaise = damp(this.footRaise, 0, 10, dt);
    const busy = this.state === 'phaseShift' || this.state === 'dormant' || this.state === 'waiting' || this.state === 'celebrate' || this.state === 'resume';
    if (this.fightOn && !busy && !this.playerTargetable()) { this.setState('celebrate'); this.stars.visible = false; }
    switch (this.state) {
      case 'dormant': {
        P.lid = 0; P.squash = 1 + Math.sin(this.stateT * 1.3) * 0.05; P.lean = -0.14;
        P.mouth = 0.1 + Math.max(0, Math.sin(this.stateT * 1.3)) * 0.25;
        P.armLx = -0.55; P.armRx = -2.35; P.armLz = 0.25; P.armRz = -0.35; P.lambda = 4;
        this.face(this.homeYaw, 2);
        this.snoreT -= dt;
        if (this.snoreT <= 0) {
          this.snoreT = 1.6;
          this.head(_v); _v.x += 0.6;
          this.fx.floater('z', { position: _v, velocity: _v2.set(0.35, 0.9, 0.1), life: 1.7, size: 0.9, spin: 0.4 });
          this.fx.sfx('bossSnore', this.position, 0.5);
        }
        if (this.playerTargetable() && this.pdist < T.wakeRange) this.wake();
        return;
      }
      case 'wake': {
        const t = this.stateT;
        P.lid = t < 0.35 ? 0.5 : 1.05; P.lidTilt = 0.4;
        P.lean = t < 0.6 ? 0 : -0.35; P.squash = t < 0.6 ? 1 : 1.1;
        P.armLz = 1.2; P.armRz = -1.2; P.armLx = -1.0; P.armRx = -2.4;
        P.mouth = t > 0.6 && t < 1.8 ? 1 : 0; P.lambda = 8;
        this.face(this.pyaw, 2.5);
        if (!this.roared && t >= 0.6) {
          this.roared = true;
          this.roar(0.5);
          this.phase = 1;
          this.ctx.events.emit('boss:start', { maxHp: this.maxHp, hp: this.hp, phase: 1 });
          this.ctx.events.emit('boss:phase', { phase: 1 });
          this.emitHud(true);
        }
        if (t >= 2.0) this.setState('approach', 0.8);
        return;
      }
      case 'celebrate': {
        // Morel is down: belly-slap victory dance until he is back
        this.face(this.homeYaw, 2);
        tauntPose(P, this.stateT * 0.7);
        if (this.playerTargetable() && this.stateT > 0.8 && !this.pendingReset) this.setState('approach', 0.8);
        return;
      }
      case 'waiting': {
        // back by the throne after a reset, gloating until Morel comes close again
        this.face(this.playerTargetable() ? this.pyaw : this.homeYaw, 2);
        P.lid = 0.6; P.lidTilt = 0.3; P.armLx = -0.9; P.armRx = -0.9; P.armLz = -0.3; P.armRz = 0.3; // arms folded on the belly
        if (Math.floor(this.stateT / 4) % 2 === 1) tauntPose(P, this.stateT * 0.7);
        if (this.playerTargetable() && this.pdist < T.wakeRange) this.setState('resume');
        return;
      }
      case 'resume': {
        const t = this.stateT;
        this.face(this.pyaw, 3);
        P.lid = 1.05; P.lidTilt = 0.4; P.mouth = t > 0.3 && t < 1.2 ? 1 : 0; P.lean = -0.3; P.armLz = 1.2; P.armRz = -1.2;
        if (!this.roared && t >= 0.3) {
          this.roared = true;
          this.roar(0.4);
          this.ctx.events.emit('boss:start', { maxHp: this.maxHp, hp: this.hp, phase: this.phase, resumed: true });
          this.emitHud(true);
          if (this.phase === 2) this.ensureJar();
        }
        if (t >= 1.4) this.setState(this.phase === 2 ? 'summon' : 'approach', 0.6);
        return;
      }
      case 'approach': {
        P.lid = 0.85; P.lidTilt = 0.38;
        if (this.pdist > 5.5) this.moveToward(pl.position.x, pl.position.z, T.walk[this.ph]);
        else this.face(this.pyaw, 3);
        if (this.stateT >= this.stateDur || this.pdist < 6) this.nextAction();
        return;
      }
      case 'stompWindup': {
        const W = T.stompWindup[this.ph];
        const k = clamp01(this.stateT / W);
        this.face(this.pyaw, 1.8);
        P.lean = -0.12 * k; P.roll = -0.24 * this.stompFoot * k; P.squash = 1 + 0.05 * k;
        P.armLz = 0.9 + 0.4 * k; P.armRz = -(0.9 + 0.4 * k); P.armLx = -0.8 * k; P.armRx = -0.6 * k;
        P.lid = 1.05; P.lidTilt = 0.4; P.mouth = 0.3; P.lambda = 10;
        this.footRaise = k;
        if (this.stateT >= W) this.doStomp();
        return;
      }
      case 'stomp': {
        P.squash = 0.88; P.lean = 0.08; P.roll = 0.1 * this.stompFoot; P.lid = 1.05; P.lidTilt = 0.4; P.mouth = 0.5; P.lambda = 30;
        P.armLz = 1.1; P.armRz = -1.1;
        if (this.stateT >= T.stompRecover[this.ph]) {
          if (this.phase < 3 && this.stompCount >= 3) { this.stompCount = 0; this.enterDizzy('stuck'); }
          else this.setState('approach', 0.6 + this.rng() * 0.8);
        }
        return;
      }
      case 'clubWindup': {
        const k = clamp01(this.stateT / T.clubWindup);
        this.face(this.pyaw, 1.4);
        P.armRx = -2.95; P.armRz = -0.25; P.armLz = 0.9; P.armLx = -0.6;
        P.lean = -0.25 * k; P.twist = -0.2 * k; P.squash = 1 + 0.06 * k; P.lid = 1.05; P.lidTilt = 0.45; P.mouth = 0.35; P.lambda = 8;
        if (this.stateT >= T.clubWindup) { this.setState('clubSlam'); this.slammed = false; }
        return;
      }
      case 'clubSlam': {
        P.armRx = -0.12; P.armRz = -0.1; P.lean = 0.4; P.squash = 0.9; P.twist = 0.15; P.lid = 1.05; P.mouth = 0.8; P.lambda = 50;
        if (!this.slammed && this.stateT >= 0.07) { this.slammed = true; this.resolveClub(); }
        if (this.stateT >= 0.25) this.setState('clubRecover');
        return;
      }
      case 'clubRecover': {
        const tug = Math.sin(this.stateT * 18) * 0.08;
        P.armRx = -0.15 + tug; P.lean = 0.32; P.squash = 0.95; P.lid = 0.6; P.mouth = 0.3;
        if (this.stateT >= T.clubRecover) this.setState('approach', 0.5 + this.rng() * 0.6);
        return;
      }
      case 'barrage': {
        const B = T.barrage, t = this.stateT;
        this.face(this.pyaw, 3);
        if (t < B.windup) {
          const k = t / B.windup;
          P.lean = -0.35 * k; P.squash = 1 + 0.12 * k; P.mouth = 0; P.armLz = 1.0; P.armRz = -1.0; P.lid = 1.05; P.lidTilt = 0.3;
        } else {
          P.lean = 0.18; P.squash = 0.94; P.mouth = 1; P.armLz = 0.8; P.armRz = -0.8; P.lid = 1.05; P.lambda = 25;
          while (this.spits < B.count && t >= B.windup + this.spits * B.interval) this.spit(this.spits++);
        }
        if (t >= B.windup + B.count * B.interval + 0.55) this.setState('approach', 0.6);
        return;
      }
      case 'summon': {
        this.face(this.pyaw, 2);
        tauntPose(P, this.stateT * 0.8);
        P.mouth = 0.8;
        if (!this.summoned && this.stateT >= 0.8) {
          this.summoned = true;
          this.spawnMinions(this.stats.summoned === 0 ? T.summonFirst : T.summonMore);
        }
        if (this.stateT >= 1.6) this.setState('approach', 0.8);
        return;
      }
      case 'slideWindup': {
        const k = clamp01(this.stateT / T.slide.windup);
        this.face(this.pyaw, 3);
        P.squash = 1 - 0.22 * k; P.lean = 0.45 * k; P.armLz = 1.3; P.armRz = -1.3; P.armLx = 0.6; P.armRx = 0.6;
        P.lid = 1.05; P.lidTilt = 0.5; P.mouth = 0.2; P.lambda = 10;
        if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) this.dust(3, 2.5, 0.6);
        if (this.stateT >= T.slide.windup) {
          this.slideX = Math.sin(this.yaw); this.slideZ = Math.cos(this.yaw);
          this.slideHit = false;
          this.stats.slides++;
          this.fx.sfx('bossSlide', this.position, 1);
          this.setState('slide');
        }
        return;
      }
      case 'slide': {
        const S = T.slide, t = this.stateT;
        P.lean = 1.25; P.squash = 0.92; P.armLx = -2.7; P.armRx = -2.7; P.armLz = 0.3; P.armRz = -0.3; P.lid = 1.05; P.lidTilt = 0.5; P.mouth = 0.7; P.lambda = 12;
        if (t < 0.45 && this.playerTargetable()) {
          // a little homing at the start of the charge
          const want = Math.atan2(this.pdx, this.pdz), cur = Math.atan2(this.slideX, this.slideZ);
          const a = cur + clamp(angleDelta(cur, want), -S.steer * dt, S.steer * dt);
          this.slideX = Math.sin(a); this.slideZ = Math.cos(a);
        }
        this.wantX = this.slideX * S.speed; this.wantZ = this.slideZ * S.speed;
        this.face(Math.atan2(this.slideX, this.slideZ), 8);
        this.accelBoost = 6;
        if (Math.floor(t * 20) !== Math.floor((t - dt) * 20)) this.dust(3, 2, 0.7);
        // contact damage
        if (!this.slideHit && this.playerTargetable() && this.pdist < this.body.radius + 0.75 && this.pdy < 3.5 && this.pdy > -1) {
          this.slideHit = true;
          pl.damage(1, this.position);
        }
        const out = Math.hypot(this.position.x - this.arenaCenter.x, this.position.z - this.arenaCenter.z);
        if ((t > 0.25 && (out > this.arenaRadius - 3.4 || this.blockedT > 0.05)) || t > S.maxTime) this.crash();
        return;
      }
      case 'crash': {
        P.lean = -0.6; P.squash = 1.12; P.lid = 0; P.mouth = 0.8; P.armLz = 1.4; P.armRz = -1.4; P.lambda = 14;
        if (this.stateT >= 0.6) this.enterDizzy('crash');
        return;
      }
      case 'dizzy': {
        const t = this.stateT;
        P.roll = Math.sin(t * 3.2) * 0.16; P.twist = Math.sin(t * 2.1) * 0.15;
        P.lean = this.dizzyKind === 'stuck' ? 0.22 : -0.22;
        P.lid = 0.3 + Math.sin(t * 5) * 0.1; P.lidTilt = -0.25; P.mouth = 0.3;
        P.armLz = 1.25; P.armRz = -1.25; P.armLx = Math.sin(t * 3) * 0.5; P.armRx = -Math.sin(t * 3) * 0.5;
        P.squash = 0.96 + Math.sin(t * 6) * 0.02; P.lambda = 8;
        if (t >= T.dizzyTime) this.endDizzy(false);
        return;
      }
      case 'recover': {
        const t = this.stateT;
        P.twist = Math.sin(t * 24) * 0.22 * (1 - clamp01(t / 0.6)); P.lid = 1.05; P.lidTilt = 0.5; P.mouth = 0.4; P.lean = -0.1;
        this.face(this.pyaw, 2);
        if (t >= 0.9) {
          if (this.phase === 2 && this.aliveMinions() < 2) this.setState('summon');
          else this.setState('approach', 0.5);
          this.summoned = false;
        }
        return;
      }
      case 'flinch': {
        P.lean = -0.4; P.roll = 0.15; P.lid = 1.05; P.mouth = 0.7; P.armLz = 1.2; P.armRz = -1.2; P.lambda = 18;
        if (this.stateT >= this.stateDur) this.setState('approach', 0.6);
        return;
      }
      case 'phaseShift': {
        this.updatePhaseShift(dt);
        return;
      }
      default:
        this.setState('approach', 1);
    }
  }

  wake() {
    if (this.state !== 'dormant') return;
    this.fightOn = true;
    this.roared = false;
    this.setState('wake');
  }

  roar(shake) {
    this.fx.sfx('bossRoar', this.position, 1);
    if (this.ctx.cameraRig) this.ctx.cameraRig.shake(shake, 0.9);
    this.mouth(_v);
    this.ctx.particles.burst({ position: _v, count: 16, color: [0xffffff, 0xd8e8e0], speed: 7, spread: 0.4, direction: _v2.set(Math.sin(this.yaw), 0.3, Math.cos(this.yaw)), life: 0.6, size: 0.5, kind: 'puff', alpha: 0.45 });
    this.head(_v);
    this.fx.floater('anger', { position: _v.set(_v.x + 1.2, _v.y + 0.3, _v.z), life: 1.0, size: 1.1 });
  }

  nextAction() {
    const T = this.T;
    this.summoned = false;
    const close = this.pdist < T.clubRange && this.clubCd <= 0 && Math.abs(this.pdy) < 2;
    let act = 'stomp';
    if (this.phase === 2) act = ['stomp', 'barrage', 'stomp', 'barrage', 'stomp'][this.seqIdx % 5];
    else if (this.phase === 3) act = ['stomp', 'stomp', 'slide', 'barrage', 'stomp', 'slide'][this.seqIdx % 6];
    if (close && act !== 'slide') { this.clubCd = T.clubCooldown; this.stats.clubs++; this.setState('clubWindup'); this.glint(); return; }
    this.seqIdx++;
    if (act === 'stomp') { this.stompFoot = -this.stompFoot; this.setState('stompWindup'); }
    else if (act === 'barrage') { this.spits = 0; this.stats.barrages++; this.setState('barrage'); this.fx.sfx('bossInhale', this.position, 1); }
    else { this.setState('slideWindup'); this.fx.sfx('bossCharge', this.position, 1); }
  }

  /** Ground dust around the feet (hoisted options: called every few steps). */
  dust(n, speed, size) {
    const p = this.position;
    DUST.size = size;
    for (let k = 0; k < n; k++) {
      const a = this.rng() * Math.PI * 2;
      _v.set(p.x + Math.sin(a) * 1.2, p.y + 0.2, p.z + Math.cos(a) * 1.2);
      this.ctx.particles.spawn(_v, _v2.set(Math.sin(a) * speed, 0.8 + this.rng(), Math.cos(a) * speed), DUST);
    }
  }

  glint() {
    const p = this.position;
    _v.set(p.x - Math.sin(this.yaw) * 1.0, p.y + 6.5, p.z - Math.cos(this.yaw) * 1.0);
    this.ctx.particles.burst({ position: _v, count: 10, color: [0xffffff, 0xffe9a0], speed: 2.5, life: 0.35, size: 0.3, kind: 'glow', intensity: 2.2 });
  }

  doStomp() {
    const T = this.T, pl = this.ctx.player, ph = this.ph;
    const p = this.position;
    this.stompCount++;
    this.stats.stomps++;
    this.fx.shockwave({ position: p, speed: T.ringSpeed[ph], maxRadius: T.ringMax, width: T.ringWidth, damage: 1, owner: this, height: T.ringHeight, startRadius: 1.6 });
    const fs = this.stompFoot * 1.5;
    _v.set(p.x + Math.cos(this.yaw) * fs, p.y, p.z - Math.sin(this.yaw) * fs);
    this.fx.decal('crack', _v, { size: 3.4, life: 3.5 });
    this.ctx.particles.burst({ position: _v, count: 30, color: [0xb08850, 0xd8c098, 0x8a6a40], speed: 6, spread: 0.6, life: 0.7, size: 0.8, kind: 'puff' });
    this.fx.sfx('bossStomp', p, 1);
    if (this.ctx.cameraRig) this.ctx.cameraRig.shake(0.5 * clamp(1.2 - this.pdist / 30, 0.3, 1), 0.5);
    if (this.playerTargetable() && this.pdist < T.stompHitRadius && Math.abs(this.pdy) < 1.5) pl.damage(1, p);
    this.setState('stomp');
  }

  resolveClub() {
    const T = this.T, pl = this.ctx.player, p = this.position;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const f of [0.55, 0.78, 1.0]) {
      _v.set(p.x + fx * T.clubReach * f, p.y, p.z + fz * T.clubReach * f);
      this.fx.decal('crack', _v, { size: 2 + f * 1.4, life: 3.5 });
    }
    _v.set(p.x + fx * T.clubReach, p.y, p.z + fz * T.clubReach);
    this.ctx.particles.burst({ position: _v, count: 28, color: [0xb08850, 0xd8c098, 0x6a4a30], speed: 6, spread: 0.55, life: 0.7, size: 0.7, kind: 'puff' });
    this.ctx.particles.burst({ position: _v, count: 12, color: [0x6a4a30, 0x3a2a1a], speed: 8, spread: 0.4, life: 0.8, size: 0.18, gravity: 20, kind: 'puff' });
    this.fx.shockwave({ position: _v, speed: 8, maxRadius: 6.5, width: 0.45, damage: 1, owner: this, height: 0.6, startRadius: 1.0 });
    this.fx.sfx('bossClubSlam', _v, 1);
    if (this.ctx.cameraRig) this.ctx.cameraRig.shake(0.35, 0.4);
    if (this.playerTargetable() && Math.hypot(pl.position.x - _v.x, pl.position.z - _v.z) < T.clubHitRadius && Math.abs(pl.position.y - _v.y) < 1.5) pl.damage(1, _v);
  }

  spit(i) {
    const B = this.T.barrage, pl = this.ctx.player, ph = this.ctx.physics;
    const from = this.mouth(_v);
    const pv = pl.velocity;
    let t = clamp(0.95 + this.pdist * 0.03, 1.0, 1.6);
    let tx = pl.position.x + pv.x * t, tz = pl.position.z + pv.z * t;
    t = clamp(0.95 + Math.hypot(tx - from.x, tz - from.z) * 0.03, 1.0, 1.6);
    tx = pl.position.x + pv.x * t; tz = pl.position.z + pv.z * t;
    if (i > 0) {
      const a = (i / (B.count - 1)) * Math.PI * 2 + this.rng() * 0.8;
      const r = B.spread * (0.55 + this.rng() * 0.45);
      tx += Math.cos(a) * r; tz += Math.sin(a) * r;
    }
    // keep shots inside the arena
    const dx = tx - this.arenaCenter.x, dz = tz - this.arenaCenter.z, dd = Math.hypot(dx, dz), lim = this.arenaRadius - 1;
    if (dd > lim) { tx = this.arenaCenter.x + (dx / dd) * lim; tz = this.arenaCenter.z + (dz / dd) * lim; }
    let ty = pl.position.y;
    const gh = ph.groundHeight(tx, tz, pl.position.y + 2);
    if (gh > -Infinity && Math.abs(gh - pl.position.y) < 4) ty = gh;
    _v2.set(tx, ty, tz);
    this.fx.decal('marker', _v2, { size: 2.0, life: t });
    ty += 0.35;
    _vel.set((tx - from.x) / t, (ty - from.y) / t + 0.5 * B.gravity * t, (tz - from.z) / t);
    this.ctx.projectiles.spawn({ team: 'enemy', kind: 'mud', position: from, velocity: _vel, damage: 1, radius: B.radius, gravity: B.gravity, life: t + 1.5, owner: this });
    this.fx.sfx('bossSpit', from, 0.8);
  }

  spawnMinions(n) {
    const T = this.T, c = this.arenaCenter, R = this.arenaRadius - 3;
    const base = Math.atan2(this.ctx.player.position.x - c.x, this.ctx.player.position.z - c.z);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * 0.75 + (this.rng() - 0.5) * 0.2;
      const x = c.x + Math.sin(a) * R, z = c.z + Math.cos(a) * R;
      const e = this.ctx.entities.spawn({
        type: 'grunt', pos: [x, c.y, z], yaw: a + Math.PI, aggro: true, dropIn: true, patrol: 0,
        leashCenter: [c.x, c.y, c.z], leash: this.arenaRadius - T.minionLeashPad, summoned: true,
      });
      if (e) { this.minions.push(e); this.stats.summoned++; }
    }
    this.fx.sfx('bossSummon', this.position, 1);
  }

  /** Anvil Tonic jar on the arena ring, on the far side from the boss. */
  ensureJar() {
    if (this.jar && this.jar.alive) return;
    const c = this.arenaCenter;
    const a = Math.atan2(this.position.x - c.x, this.position.z - c.z) + Math.PI;
    const R = this.arenaRadius - 3.5;
    this.jar = this.ctx.entities.spawn({ type: 'tonic', kind: 'anvil', respawn: true, pos: [c.x + Math.sin(a) * R, c.y, c.z + Math.cos(a) * R] });
  }

  crash() {
    const v = this.body.velocity;
    v.set(-this.slideX * 5, 6, -this.slideZ * 5);
    this.body.onGround = false;
    this.accelBoost = 0;
    this.fx.sfx('bossCrash', this.position, 1);
    if (this.ctx.cameraRig) this.ctx.cameraRig.shake(0.5, 0.5);
    this.head(_v);
    this.ctx.particles.burst({ position: _v, count: 16, color: [0xfff1a0, 0xffffff], speed: 4, life: 0.6, size: 0.25, kind: 'glow' });
    this.ctx.particles.burst({ position: this.position, count: 24, color: [0xb08850, 0xd8c098], speed: 5, spread: 0.6, life: 0.7, size: 0.8, kind: 'puff' });
    this.setState('crash');
  }

  enterDizzy(kind) {
    this.dizzyKind = kind;
    this.windowDmg = 0;
    this.stats.dizzy++;
    this.stars.visible = true;
    this.fx.sfx('bossDizzy', this.position, 1);
    this.setState('dizzy');
  }

  endDizzy(early) {
    this.stars.visible = false;
    if (early) this.roar(0.25);
    this.setState('recover');
  }

  // ------------------------------------------------------------------ damage
  hurt(amount, info = {}) {
    if (!this.alive || this.dying) return false;
    if (this.state === 'dormant') { this.wake(); this.boing(); return false; }
    if (!this.fightOn || this.state === 'wake' || this.state === 'waiting' || this.state === 'resume' || this.state === 'phaseShift' || this.state === 'celebrate') { this.boing(); return false; }
    const iron = info.kind === 'iron' || info.heavy;
    if (this.plateState === 'belly') {
      if (iron) { this.breakPlate(info); return true; }
      this.clang();
      return false;
    }
    if (this.state !== 'dizzy') { this.boing(); return false; }
    const floor = this.T.phaseFloor[this.ph];
    const dmg = Math.min(amount, this.hp - floor);
    if (dmg <= 0) return false;
    this.hp -= dmg;
    this.windowDmg += dmg;
    this.flash = 1;
    this.flinchT = 0.35;
    this.jiggle = 1;
    this.ctx.events.emit('boss:hurt', { hp: this.hp, maxHp: this.maxHp });
    this.fx.sfx('bossHurt', this.position, 1);
    _v.copy(this.position); _v.y += 2;
    this.ctx.particles.burst({ position: _v, count: 16 + dmg * 6, color: SPORES, speed: 5, life: 0.6, size: 0.22, kind: 'glow' });
    if (this.hp <= 0) this.defeat(info);
    else if (this.hp <= floor) this.shiftPhase();
    else if (this.windowDmg >= this.T.dizzyCap) this.endDizzy(true);
    return true;
  }

  boing() {
    this.jiggle = 1;
    this.stats.deflected++;
    this.fx.sfx('bossBoing', this.position, 0.8);
  }

  clang() {
    this.stats.deflected++;
    this.flash = 0.3;
    this.fx.sfx('clang', this.position, 1);
  }

  breakPlate(info) {
    this.plateState = 'broken';
    const m = this.model;
    _v.copy(this.position); _v.y += 1.6;
    this.ctx.events.emit('armor:break', { entity: this, position: _v.clone() });
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.fx.prop(m.plate, {
      clone: true, velocity: new THREE.Vector3(fwd.x * 4 + (info.dir ? info.dir.x * 2 : 0), 7, fwd.z * 4 + (info.dir ? info.dir.z * 2 : 0)),
      spin: new THREE.Vector3(5, 2, 3), life: 3.5, radius: 0.5, bounce: 0.3, sound: 'cauldronClang',
    });
    m.plate.visible = false;
    this.ctx.particles.burst({ position: _v, count: 34, color: [0xffc35a, 0xff8a3a, 0xffffff], speed: 8, life: 0.55, size: 0.16, kind: 'spark' });
    this.ctx.particles.burst({ position: _v, count: 12, color: [0x8a97a6, 0x5d6670], speed: 4, life: 0.7, size: 0.6, kind: 'puff' });
    if (this.ctx.cameraRig) this.ctx.cameraRig.shake(0.3, 0.35);
    this.flash = 1;
    if (this.state === 'dizzy') this.flinchT = 0.5;
    else if (this.state !== 'slide' && this.state !== 'phaseShift') this.setState('flinch', 0.8);
  }

  shiftPhase() {
    this.stars.visible = false;
    this.phase++;
    this.stompCount = 0;
    this.seqIdx = 0;
    this.ctx.events.emit('boss:phase', { phase: this.phase });
    this.shiftDone = { roar: false, plate: false, jar: false };
    this.setState('phaseShift');
  }

  updatePhaseShift(_dt) {
    const P = this.P, t = this.stateT, S = this.shiftDone;
    this.face(this.pyaw, 2);
    if (t < 0.6) { P.lean = -0.4; P.lid = 1.05; P.mouth = 0.6; P.armLz = 1.3; P.armRz = -1.3; P.roll = Math.sin(t * 20) * 0.08; }
    else { P.lean = -0.3; P.squash = 1.1; P.mouth = t < 1.6 ? 1 : 0.2; P.lid = 1.05; P.lidTilt = 0.5; P.armLx = -2.2; P.armRx = -2.6; P.armLz = 1.1; P.armRz = -1.1; }
    if (!S.roar && t >= 0.6) { S.roar = true; this.roar(0.6); }
    if (this.phase === 2) {
      // pulls the chest plate down over his belly, and an Anvil Tonic appears on the ring
      if (t >= 1.0) this.plateAnim = clamp01((t - 1.0) / 0.7);
      if (!S.plate && t >= 1.7) { S.plate = true; this.plateState = 'belly'; this.fx.sfx('clang', this.position, 1); }
      if (!S.jar && t >= 1.3) {
        S.jar = true;
        this.ensureJar();
        this.ctx.events.emit('ui:message', { text: 'His belly plate bounces puffs — crack it with an Anvil Tonic!', duration: 4 });
      }
    } else if (this.phase === 3) {
      this.enrage = clamp01((t - 0.6) / 0.8);
      if (!S.plate && t >= 0.8) { S.plate = true; this.ctx.events.emit('ui:message', { text: 'Gnarlbelly is furious!', duration: 2.5 }); }
    }
    if (t >= 2.4) {
      if (this.phase === 2) { this.summoned = false; this.setState('summon'); }
      else this.setState('approach', 0.5);
    }
  }

  /** Player died mid-fight: back to the start of the current phase when he respawns. */
  resetToPhaseStart() {
    this.pendingReset = false;
    this.stats.resets++;
    const T = this.T;
    this.hp = T.phaseStart[this.ph];
    this.windowDmg = 0; this.stompCount = 0; this.seqIdx = 0; this.clubCd = 0;
    this.stars.visible = false;
    this.footRaise = 0;
    if (this.phase === 2) { this.plateState = 'belly'; this.plateAnim = 1; this.model.plate.visible = true; }
    for (const e of this.minions) if (e.alive && !e.dying) this.poofAway(e);
    this.minions.length = 0;
    for (const w of this.fx.waves) if (w.owner === this) { w.active = false; w.group.visible = false; }
    this.position.copy(this.home);
    this.body.velocity.set(0, 0, 0);
    this.yaw = this.faceYaw = this.homeYaw;
    this.roared = false;
    this.emitHud(false);
    this.setState('waiting');
  }

  poofAway(e) {
    _v.copy(e.position); _v.y += 0.8;
    this.ctx.particles.burst({ position: _v, count: 14, color: [0xd8c098, 0xffffff], speed: 3, life: 0.5, size: 0.4, kind: 'puff' });
    e.alive = false;
  }

  // ------------------------------------------------------------------ defeat
  defeat() {
    if (this.dying) return;
    this.defeated = true;
    this.dying = true;
    this.dieT = 0;
    this.hittable = false;
    this.tags.delete('enemy');
    this.stars.visible = false;
    this.state = 'defeated';
    const p = this.position;
    this.ctx.events.emit('boss:defeated', { position: p.clone() });
    this.emitHud(false);
    _v.copy(p); _v.y += 2.2;
    this.ctx.particles.burst({ position: _v, count: 140, color: SPORES, speed: 9, life: 1.4, size: 0.35, kind: 'glow', intensity: 2.4 });
    this.ctx.particles.burst({ position: _v, count: 50, color: [0xf3e6c8, 0xd8c098, 0x9ef06a], speed: 6, life: 1.2, size: 1.1, kind: 'puff' });
    if (this.ctx.cameraRig) this.ctx.cameraRig.shake(0.6, 0.8);
    this.fx.sfx('bossDefeated', p, 1);
    for (const e of this.minions) if (e.alive && !e.dying) this.poofAway(e);
    for (const w of this.fx.waves) if (w.owner === this) { w.active = false; w.group.visible = false; }
    this.model.mouthOpen.visible = true;
  }

  /** Puff up, zip around deflating like a balloon, flop flat, poof. */
  updateDying(dt) {
    this.dieT += dt;
    const t = this.dieT, m = this.model, S = BOSS_LOOK.scale;
    const lidOpen = -0.6;
    m.lidL.rotation.x = m.lidR.rotation.x = lidOpen;
    m.footL.position.y = m.footR.position.y = 0.05;
    if (t < 0.8) {
      // inflate, quivering
      const k = t / 0.8;
      const s = S * (1 + 0.22 * k);
      m.rig.scale.set(s, s, s);
      m.pivot.rotation.set(Math.sin(t * 40) * 0.05, 0, Math.sin(t * 33) * 0.06);
      m.mouthOpen.scale.y = 0.02;
      this.flash = 0.4;
    } else if (t < 3.2) {
      // deflating balloon: zips around, spinning, shrinking, sputtering air
      const k = (t - 0.8) / 2.4;
      const s = S * lerp(1.22, 0.42, easeOutCubic(k));
      m.rig.scale.set(s, s * (1 + Math.sin(t * 30) * 0.05), s);
      m.rig.position.set(Math.sin(k * 11) * 3.2 * (1 - k), Math.sin(k * Math.PI) * 6.5, Math.cos(k * 8) * 3.2 * (1 - k));
      m.rig.rotation.y += dt * (10 + k * 12);
      m.rig.rotation.x = Math.sin(t * 9) * 0.6;
      m.armL.rotation.z = 1.4 + Math.sin(t * 25) * 0.5; m.armR.rotation.z = -1.4 - Math.sin(t * 25) * 0.5;
      m.mouthOpen.scale.y = 0.13;
      this.puffT = (this.puffT || 0) - dt;
      if (this.puffT <= 0) {
        this.puffT = 0.04;
        _v.copy(this.position).add(m.rig.position); _v.y += 1.2 * (s / S);
        this.ctx.particles.burst({ position: _v, count: 2, color: [0xffffff, 0xe8fff8], speed: 3, life: 0.5, size: 0.5, kind: 'puff', alpha: 0.6 });
      }
      if (!this.whee) { this.whee = true; this.fx.sfx('bossDeflate', this.position, 1); }
    } else if (t < 3.6) {
      // flop down flat as a pancake
      const k = (t - 3.2) / 0.4;
      m.rig.position.set(m.rig.position.x * (1 - k), m.rig.position.y * (1 - k), m.rig.position.z * (1 - k));
      m.rig.rotation.x = damp(m.rig.rotation.x, 0, 12, dt);
      m.rig.scale.set(S * lerp(0.42, 1.0, k), S * lerp(0.42, 0.12, k), S * lerp(0.42, 1.0, k));
    } else {
      if (!this.flopped) {
        this.flopped = true;
        m.rig.position.set(0, 0, 0);
        m.rig.rotation.x = 0;
        m.rig.scale.set(S, S * 0.12, S);
        this.fx.sfx('bossPlop', this.position, 1);
        this.ctx.particles.burst({ position: this.position, count: 30, color: [0xb08850, 0xd8c098], speed: 5, spread: 0.6, life: 0.7, size: 0.9, kind: 'puff' });
        this.fx.prop(m.helmet, { velocity: new THREE.Vector3(2.5, 7, 1.5), spin: new THREE.Vector3(6, 12, 4), life: 4, radius: 0.5, sound: 'potClatter' });
        if (this.ctx.cameraRig) this.ctx.cameraRig.shake(0.25, 0.3);
      }
      // little twitches, then a final poof of spores
      m.rig.scale.y = S * (0.12 + Math.max(0, Math.sin(t * 7)) * 0.015);
      if (t >= 6.2 && !this.poofed) {
        this.poofed = true;
        _v.copy(this.position); _v.y += 0.6;
        this.ctx.particles.burst({ position: _v, count: 60, color: SPORES, speed: 5, life: 1.0, size: 0.3, kind: 'glow' });
        this.ctx.particles.burst({ position: _v, count: 26, color: [0xf3e6c8, 0x9ef06a], speed: 4, life: 0.9, size: 0.9, kind: 'puff' });
        m.rig.visible = false;
      }
      if (t >= 6.4) this.alive = false;
    }
    this.updateLook(dt);
  }

  // ------------------------------------------------------------------ visuals
  locomote(dt) {
    if (this.state === 'dormant' || this.state === 'waiting') { this.wantX = this.wantZ = 0; }
    const acc = this.cfg.accel;
    if (this.accelBoost) this.cfg.accel = acc * this.accelBoost;
    super.locomote(dt);
    this.cfg.accel = acc;
    if (this.state !== 'slide') this.accelBoost = 0;
  }

  animateExtra(dt) {
    const m = this.model, t = this.ctx.time.now;
    // raised / stuck foot
    const foot = this.stompFoot > 0 ? m.footL : m.footR;
    if (this.footRaise > 0.01) { foot.position.y = this.footRaise * 0.55; foot.position.z += this.footRaise * 0.12; }
    if (this.state === 'dizzy' && this.dizzyKind === 'stuck') foot.position.y = -0.07 + Math.abs(Math.sin(this.stateT * 6)) * 0.03;
    // sitting on the sack pile while dormant
    this.sit = damp(this.sit, this.state === 'dormant' ? 1 : 0, 6, dt);
    m.rig.position.y = this.sit * 0.5;
    // belly jiggle on deflected hits
    if (this.jiggle > 0) m.pivot.scale.x *= 1 + Math.sin(this.jiggle * 30) * 0.04 * this.jiggle;
    if (this.flinchT > 0) m.pivot.rotation.x -= this.flinchT * 0.5;
    // dizzy stars + glowing belly (the weak spot)
    if (this.stars.visible) {
      this.stars.rotation.y += dt * 4;
      this.stars.position.y = m.dims.headTop[1] + 0.32 + Math.sin(t * 5) * 0.03;
    }
    const glow = m.bellyGlow;
    const want = this.state === 'dizzy' && this.plateState !== 'belly' ? 0.62 + Math.sin(t * 8) * 0.25 : 0;
    glow.material.opacity = damp(glow.material.opacity, want, 10, dt);
    glow.visible = glow.material.opacity > 0.01;
    // chest plate slides down over the belly in phase 2
    const pa = this.plateAnim;
    m.platePivot.position.set(this.plateBase.x, this.plateBase.y - pa * BOSS_LOOK.H * 0.36, this.plateBase.z + pa * 0.035);
    m.platePivot.scale.set(1 + pa * 0.1, 1 + pa * 0.12, 1 + pa * 0.1);
    // enraged: red tint, steaming nostrils, angry gem
    if (this.enrage > 0) {
      m.material.color.setRGB(1, 1 - 0.2 * this.enrage, 1 - 0.24 * this.enrage);
      this.steamT -= dt;
      if (this.steamT <= 0 && !this.dying) {
        this.steamT = 0.35;
        this.mouth(_v); _v.y += 0.35;
        for (let k = 0; k < 2; k++) this.ctx.particles.spawn(_v, _v2.set((this.rng() - 0.5) * 0.6, 1.4, (this.rng() - 0.5) * 0.6), STEAM);
      }
      this.gemMat.color.setRGB(2.6, 0.6 + Math.sin(t * 6) * 0.3, 0.5);
    }
  }

  dispose(ctx) {
    for (const off of this.offs) off();
    if (this.throne) {
      ctx.scene.remove(this.throne.group);
      for (const c of this.throne.colliders) ctx.physics.removeCollider(c);
    }
  }

  debug() {
    return {
      ...super.debug(), phase: this.phase, maxHp: this.maxHp, plate: this.plateState, fightOn: this.fightOn,
      windowDmg: this.windowDmg, minions: this.aliveMinions(), defeated: this.defeated, stats: { ...this.stats },
    };
  }
}

// ---------------------------------------------------------------------------
// Throne: a backrest of bound logs with a red banner, two stumps, a pile of sacks.
function buildThrone(ctx, home, yaw) {
  const kit = getModelKit(ctx);
  const ps = [];
  const logs = [[-2.1, 3.8], [-1.05, 4.6], [0, 5.3], [1.05, 4.6], [2.1, 3.8]];
  for (const [x, h] of logs) {
    ps.push(part(T.cyl, 'bark', 0xffffff, { pos: [x, h / 2, -2.4], scl: [0.48, h, 0.48] }));
    ps.push(part(T.cone, 'bark', 0xe0d0c0, { pos: [x, h + 0.3, -2.4], scl: [0.48, 0.6, 0.48] }));
  }
  ps.push(part(T.cyl, 'bark', 0xd8c8b0, { pos: [0, 3.0, -2.0], rot: [0, 0, Math.PI / 2], scl: [0.3, 5.2, 0.3] }));
  ps.push(part(T.cyl, 'bark', 0xd8c8b0, { pos: [0, 1.0, -2.0], rot: [0, 0, Math.PI / 2], scl: [0.28, 5.0, 0.28] }));
  for (const y of [1.0, 3.0]) for (const x of [-1.6, 1.6]) ps.push(part(new THREE.TorusGeometry(1, 0.25, 5, 10), 'cloth', 0x8a6a40, { pos: [x, y, -2.0], rot: [0, Math.PI / 2, 0], scl: [0.34, 0.34, 0.34] }));
  // banner with a toad-face emblem made of shapes
  ps.push(part(T.box, 'cloth', 0x8e3b2e, { pos: [0, 2.0, -1.78], scl: [1.7, 1.9, 0.06] }));
  ps.push(part(T.cone, 'cloth', 0x8e3b2e, { pos: [-0.5, 0.87, -1.78], rot: [Math.PI, 0, 0], scl: [0.35, 0.4, 0.04] }));
  ps.push(part(T.cone, 'cloth', 0x8e3b2e, { pos: [0.5, 0.87, -1.78], rot: [Math.PI, 0, 0], scl: [0.35, 0.4, 0.04] }));
  ps.push(part(T.sphere, 'brass', 0xffffff, { pos: [0, 2.0, -1.73], scl: [0.55, 0.42, 0.03] }));
  ps.push(part(T.sphere, 'plain', 0x2a1418, { pos: [-0.22, 2.28, -1.7], scl: [0.12, 0.1, 0.03] }));
  ps.push(part(T.sphere, 'plain', 0x2a1418, { pos: [0.22, 2.28, -1.7], scl: [0.12, 0.1, 0.03] }));
  ps.push(part(T.box, 'plain', 0x2a1418, { pos: [0, 1.9, -1.7], scl: [0.6, 0.05, 0.03] }));
  // armrest stumps with snail-shell ornaments
  for (const sx of [-1, 1]) {
    ps.push(part(T.cyl, 'bark', 0xffffff, { pos: [sx * 2.6, 0.8, -0.5], scl: [0.65, 1.6, 0.65] }));
    ps.push(part(T.cyl, 'wood', 0xe8d0a0, { pos: [sx * 2.6, 1.61, -0.5], scl: [0.6, 0.04, 0.6] }));
    ps.push(part(T.sphere, 'brass', 0xffffff, { pos: [sx * 2.6, 1.85, -0.5], scl: [0.32, 0.26, 0.3] }));
  }
  // sack pile he sits on
  for (const [x, y, z, s] of [[-0.9, 0.35, -0.3, 0.8], [0.9, 0.35, -0.3, 0.8], [0, 0.4, -0.9, 0.9], [0, 0.8, -0.5, 0.65]]) {
    ps.push(part(T.sphere, 'burlap', 0xffffff, { pos: [x, y, z], scl: [s, s * 0.55, s * 0.75] }));
  }
  const geo = merge(ps);
  const mesh = new THREE.Mesh(geo, ctx.materials.toon(0xffffff, { map: kit.atlas, vertexColors: true, side: THREE.DoubleSide }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  ctx.materials.outline(mesh, 0.035);
  const group = new THREE.Group();
  group.name = 'boss-throne';
  group.add(mesh);
  group.position.copy(home);
  group.rotation.y = yaw;
  ctx.scene.add(group);
  // colliders (axis-aligned bounds of the rotated local boxes)
  const colliders = [];
  const box = (cx, cz, sx, sz, h) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const wx = home.x + cx * c + cz * s, wz = home.z - cx * s + cz * c;
    const ex = Math.abs(sx * c) + Math.abs(sz * s), ez = Math.abs(sx * s) + Math.abs(sz * c);
    colliders.push(ctx.physics.addBox({ min: [wx - ex / 2, home.y, wz - ez / 2], max: [wx + ex / 2, home.y + h, wz + ez / 2], surface: 'wood', tag: 'throne' }));
  };
  box(0, -2.4, 5.4, 1.0, 4.5);
  box(-2.6, -0.5, 1.3, 1.3, 1.6);
  box(2.6, -0.5, 1.3, 1.3, 1.6);
  return { group, colliders };
}

/** Factory registered as the 'boss' spawn type. def: { pos, yaw?, arena?: { center, radius }, throne? } */
export function createBoss(ctx, def) {
  return new Gnarlbelly(ctx, def);
}
export { Gnarlbelly };
