// Ironbelly (armour, then 4 hp; 400 pts): a wide bandit wearing a riveted iron
// cauldron round his belly. Ordinary puffs clang off it (no damage, no points,
// hurt() returns false). An iron ball (Anvil Tonic: info.kind 'iron' / info.heavy)
// cracks the cauldron in two (armor:break) and from then on he is vulnerable.
// Attack: crouch, hop, belly-flop -> an expanding ground shockwave (jump it).
import * as THREE from 'three';
import { Bandit } from './common.js';
import { clamp, clamp01 } from '../../core/mathx.js';

export const IRONBELLY_LOOK = {
  id: 'ironbelly', seed: 9, scale: 1,
  W: 0.72, H: 0.5, D: 0.64, bodyY: 0.66,
  skin: 0x5f8550, skinDark: 0x3b5833, belly: 0xdcc890, eye: 0xf0c048,
  eyeR: 0.165, eyeSpread: 0.38, mouthLat: 0.16, mouthR: 0.019, mouthSpan: 1.25, noseScale: 1.1,
  legScale: 1.15, footScale: 1.15, armR: 0.11, armLen: 0.26, handR: 0.125,
  potR: 0.31, potH: 0.22, potTilt: [-0.2, 0.15, -0.08], potDent: 0.8, potSink: 0.07, potColor: 0x9aa2ac,
  cloak: { color: 0xa89878, top: 0.62, bottom: 0.05, cover: Math.PI * 1.25, flare: 0.08, jag: 0.8 },
  hoodScale: 1.1, weapon: null, cauldron: true, outline: 0.024, warts: 24,
};

const CFG = {
  type: 'ironbelly', look: IRONBELLY_LOOK, hp: 4, points: 400,
  hitRadius: 0.82, hitHeight: 1.35, bodyRadius: 0.62, bodyHeight: 1.2,
  walkSpeed: 1.2, runSpeed: 2.4, accel: 10, turnRate: 4,
  noticeRange: 11, loseRange: 18, leash: 12, patrol: 3, eyeHeight: 1.05,
};
export const IRONBELLY_TUNING = {
  flopRange: 6.0, crouch: 0.5, leapVy: 8.2, maxLeapSpeed: 4.5,
  down: 1.0, getup: 0.55, cooldown: 1.3,
  wave: { speed: 7.5, maxRadius: 7.5, width: 0.5, damage: 1 },
  slamRadius: 1.7, // landing directly on Morel
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Ironbelly extends Bandit {
  constructor(ctx, def) {
    super(ctx, def, CFG);
    this.T = IRONBELLY_TUNING;
    this.armored = def.armored !== false;
    if (this.armored) this.tags.add('armored');
    else this.dropArmorInstantly();
    this.cd = 0.5;
    this.clangT = 0;
    this.flops = 0;
  }

  engage() {
    if (!this.playerTargetable()) { this.lose(); return; }
    this.setState('approach');
  }

  think(dt) {
    const T = this.T, P = this.P, pl = this.ctx.player;
    this.cd -= dt;
    switch (this.state) {
      case 'approach': {
        if (!this.playerTargetable()) { this.taunt(1.8); return; }
        if (this.playerLost()) { this.lose(); return; }
        P.lid = 0.75; P.lidTilt = 0.25; P.armLz = 0.55; P.armRz = -0.55;
        if (this.cd <= 0 && this.pdist < T.flopRange && this.sees && Math.abs(this.pdy) < 1.3) {
          this.setState('crouch');
          this.fx.sfx('ironbellyGrunt', this.position, 0.8);
          return;
        }
        if (this.pdist > 2.2) this.moveToward(pl.position.x, pl.position.z, this.cfg.runSpeed);
        else this.face(this.pyaw, 6);
        if (this.blockedT > 1.2) { this.blockedT = 0; this.taunt(1.4); }
        return;
      }
      case 'crouch': {
        this.face(this.pyaw, 5);
        const k = clamp01(this.stateT / T.crouch);
        P.squash = 1 - 0.28 * k; P.lean = 0.1; P.armLz = 1.3; P.armRz = -1.3; P.armLx = -0.6; P.armRx = -0.6;
        P.lid = 1.05; P.lidTilt = 0.35; P.mouth = 0.3; P.lambda = 14;
        if (this.stateT >= T.crouch) this.leap();
        return;
      }
      case 'leap': {
        const k = clamp01(this.stateT / 0.45);
        P.lean = 1.35 * k; P.squash = 1.08; P.armLz = 1.45; P.armRz = -1.45; P.armLx = -1.2; P.armRx = -1.2;
        P.lid = 1.05; P.mouth = 0.8; P.lambda = 10;
        if (this.body.onGround && this.stateT > 0.12) this.flop();
        return;
      }
      case 'down': {
        // flat on his belly, paddling to get up
        const s = Math.sin(this.stateT * 9);
        P.lean = 1.38; P.squash = 0.86 + Math.abs(s) * 0.03; P.armLz = 1.4; P.armRz = -1.4;
        P.armLx = -1.3 + s * 0.4; P.armRx = -1.3 - s * 0.4; P.lid = 0.3; P.mouth = 0.2; P.lambda = 20;
        if (this.stateT >= T.down) this.setState('getup');
        return;
      }
      case 'getup': {
        P.lean = 0.5; P.squash = 1.05; P.armLx = -0.4; P.armRx = -0.4; P.lid = 0.5; P.lambda = 9;
        if (this.stateT >= T.getup) { this.cd = T.cooldown; this.setState('approach'); }
        return;
      }
      default:
        this.setState('idle', 1);
    }
  }

  leap() {
    const T = this.T, v = this.body.velocity;
    const air = (2 * T.leapVy) / 30;
    const sp = clamp((this.pdist - 1.0) / air, 0, T.maxLeapSpeed);
    const d = this.pdist || 1;
    v.set((this.pdx / d) * sp, T.leapVy, (this.pdz / d) * sp);
    this.body.onGround = false;
    this.setState('leap');
    this.ctx.particles.burst({ position: this.position, count: 10, color: [0xb08850, 0xd8c098], speed: 2.5, spread: 0.5, life: 0.45, size: 0.4, kind: 'puff' });
  }

  flop() {
    const T = this.T, pl = this.ctx.player;
    this.flops++;
    const pos = this.position;
    const fx = Math.sin(this.yaw) * 0.5, fz = Math.cos(this.yaw) * 0.5;
    _v.set(pos.x + fx, pos.y, pos.z + fz);
    this.fx.shockwave({ position: _v, speed: T.wave.speed, maxRadius: T.wave.maxRadius, width: T.wave.width, damage: T.wave.damage, owner: this, height: 0.55 });
    this.fx.decal('crack', _v, { size: 2.2, life: 3 });
    this.fx.sfx('bellyFlop', _v, 1);
    this.ctx.particles.burst({ position: _v, count: 22, color: [0xb08850, 0xd8c098, 0x8a6a40], speed: 4.5, spread: 0.55, life: 0.6, size: 0.5, kind: 'puff' });
    if (this.pdist < 14 && this.ctx.cameraRig) this.ctx.cameraRig.shake(0.3 * clamp(1 - this.pdist / 14, 0.15, 1), 0.35);
    // squashed Morel if he was right under the belly
    if (this.playerTargetable() && Math.hypot(pl.position.x - _v.x, pl.position.z - _v.z) < T.slamRadius && Math.abs(this.pdy) < 1.2) pl.damage(1, _v);
    this.body.velocity.x = 0; this.body.velocity.z = 0;
    this.setState('down');
  }

  // ------------------------------------------------------------------ armour
  hurt(amount, info = {}) {
    if (!this.alive || this.dying || this.hittable === false) return false;
    if (this.armored) {
      if (info.kind === 'iron' || info.heavy) { this.breakArmor(info); return true; }
      this.clang(info);
      return false;
    }
    return super.hurt(amount, info);
  }

  clang(info) {
    this.fx.sfx('clang', this.position, 0.9);
    this.flash = 0.35;
    // small shove along the hit
    if (info.dir) { this.body.velocity.x += info.dir.x * 1.8; this.body.velocity.z += info.dir.z * 1.8; }
    this.clangT = 0.25;
    this.ctx.particles.burst({ position: _v.set(this.position.x, this.position.y + 0.55, this.position.z), count: 8, color: [0xffe0a0, 0xffffff], speed: 5, life: 0.25, size: 0.09, kind: 'spark' });
    if (!this.aware && this.state !== 'alert') this.setState('alert', 0.6);
  }

  breakArmor(info) {
    this.setLod(0);              // show the real cauldron halves before they tumble away
    this.armored = false;
    this.tags.delete('armored');
    const pos = this.position;
    _v.set(pos.x, pos.y + 0.6, pos.z);
    this.ctx.events.emit('armor:break', { entity: this, position: _v.clone() });
    // the cauldron splits and both halves tumble away sideways
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const halves = this.model.cauldron;
    for (let i = 0; i < halves.length; i++) {
      const s = i === 0 ? 1 : -1;
      this.fx.prop(halves[i], {
        velocity: _v2.set(rx * s * 3.2 + (info.dir ? info.dir.x * 1.5 : 0), 5.5, rz * s * 3.2 + (info.dir ? info.dir.z * 1.5 : 0)),
        spin: new THREE.Vector3(4 * s, 3, 7 * s), life: 3, radius: 0.3, bounce: 0.35, sound: 'cauldronClang',
      });
    }
    this.ctx.particles.burst({ position: _v, count: 26, color: [0xffc35a, 0xff8a3a, 0xffffff], speed: 7, life: 0.5, size: 0.12, kind: 'spark' });
    this.ctx.particles.burst({ position: _v, count: 10, color: [0x8a97a6, 0x5d6670], speed: 3.5, life: 0.6, size: 0.35, kind: 'puff' });
    if (this.ctx.cameraRig && this.pdist < 14) this.ctx.cameraRig.shake(0.18, 0.3);
    this.flash = 1;
    this.aware = true;
    this.staggerRoll = 0;
    this.setState('stagger', 0.75);
  }

  dropArmorInstantly() {
    this.armored = false;
    this.tags.delete('armored');
    for (const h of this.model.cauldron || []) h.visible = false;
  }

  animateExtra(dt) {
    if (this.clangT > 0) {
      this.clangT -= dt;
      // the cauldron rings: quick shiver
      this.model.pivot.rotation.z += Math.sin(this.clangT * 90) * 0.04;
    }
  }

  debug() { return { ...super.debug(), armored: this.armored, flops: this.flops }; }
}
