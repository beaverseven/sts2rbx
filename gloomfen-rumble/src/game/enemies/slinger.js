// Slinger (2 hp, 250 pts): wiry lookout with a sling and a satchel of mud. Keeps
// 8-14 m from Morel, strafes, and lobs arcing mud balls with lead prediction after
// a visible over-the-head sling spin.
import * as THREE from 'three';
import { Bandit } from './common.js';
import { clamp, clamp01 } from '../../core/mathx.js';

export const SLINGER_LOOK = {
  id: 'slinger', seed: 5, scale: 1,
  W: 0.42, H: 0.54, D: 0.4, bodyY: 0.74,
  skin: 0xa9a548, skinDark: 0x6c6a2a, belly: 0xece0a8, eye: 0xf6dd6a,
  eyeR: 0.15, eyeSpread: 0.44, mouthLat: 0.06, mouthR: 0.015, mouthSpan: 1.15, noseScale: 0.9,
  legScale: 1.12, footScale: 0.9, armR: 0.068, armLen: 0.34, handR: 0.088,
  potR: 0.25, potH: 0.28, potTilt: [-0.12, -2.2, -0.18], potDent: 1.4, potColor: 0xb0b6bc,
  cloak: { color: 0xc9d2a0, top: 0.6, bottom: 0.82, cover: Math.PI * 1.22, flare: 0.04, jag: 1.4 },
  hoodScale: 0.9, weapon: 'sling', satchel: true, outline: 0.02,
};

const CFG = {
  type: 'slinger', look: SLINGER_LOOK, hp: 2, points: 250,
  hitRadius: 0.52, hitHeight: 1.35, bodyRadius: 0.4, bodyHeight: 1.2,
  walkSpeed: 1.7, runSpeed: 3.4, accel: 16, turnRate: 9,
  noticeRange: 16, loseRange: 24, leash: 14, patrol: 3, eyeHeight: 1.1,
  giveUp: 12, // keeps engaging while Morel is within leash + 12 m of its post (it shoots from range)
};
export const SLINGER_TUNING = {
  near: 8, far: 14,       // preferred distance band
  maxThrow: 19, minThrow: 2.5,
  windup: 0.65, throwTime: 0.3, cooldown: [1.5, 2.3],
  strafe: 2.2, retreat: 3.2, approach: 2.6,
  gravity: 20, damage: 1, radius: 0.32,
  lead: [0.8, 1.05],      // lead factor range per throw (0 = aim at Morel, 1 = exact prediction)
  spread: 0.6,            // random aim error (m)
};

const _from = new THREE.Vector3();
let whirlGeo = null;
const WHIRL_PUFF = { color: 0xd8c098, life: 0.25, size: 0.18, kind: 'puff', alpha: 0.5 };
const _vel = new THREE.Vector3();

export class Slinger extends Bandit {
  constructor(ctx, def) {
    super(ctx, def, CFG);
    this.T = SLINGER_TUNING;
    this.strafeDir = this.rng() < 0.5 ? -1 : 1;
    this.strafeT = 1 + this.rng() * 2;
    this.throwCd = 0.8 + this.rng() * 0.6;
    this.thrown = false;
    this.slingSpin = 0;
    this.slingRate = 0;
    this.shots = 0;
    // faint whirl ring above the head while the sling spins (telegraph)
    if (!whirlGeo) whirlGeo = new THREE.TorusGeometry(0.36, 0.035, 4, 28).rotateX(Math.PI / 2);
    this.whirl = new THREE.Mesh(whirlGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const sh = this.model.dims.shoulder;
    this.whirl.position.set(-sh[0] * 0.8, sh[1] + SLINGER_LOOK.armLen + 0.22, 0.02);
    this.whirl.visible = false;
    this.model.inner.add(this.whirl);
  }

  engage() {
    if (!this.playerTargetable()) { this.lose(); return; }
    this.setState('combat');
  }

  think(dt) {
    const T = this.T, P = this.P;
    this.throwCd -= dt;
    switch (this.state) {
      case 'combat': {
        if (!this.playerTargetable()) { this.taunt(1.6); return; }
        if (this.playerLost()) { this.lose(); return; }
        this.face(this.pyaw, 9);
        P.lid = 0.8; P.lidTilt = 0.18; P.armRx = -0.3;
        // radial: keep the band; tangential: strafe, flipping now and then or when blocked
        const d = this.pdist || 1;
        const rx = this.pdx / d, rz = this.pdz / d;
        let radial = 0;
        if (d > T.far) radial = T.approach;
        else if (d < T.near) radial = -T.retreat * (d < 4 ? 1.3 : 1);
        this.strafeT -= dt;
        if (this.strafeT <= 0 || this.blockedT > 0.3) {
          this.strafeDir *= -1; this.strafeT = 1.4 + this.rng() * 1.8; this.blockedT = 0;
        }
        const tang = radial < -0.1 ? T.strafe * 0.4 : T.strafe;
        this.moveDir(rx * radial - rz * tang * this.strafeDir, rz * radial + rx * tang * this.strafeDir, Math.min(T.retreat * 1.3, Math.hypot(radial, tang)));
        if (this.throwCd <= 0 && this.sees && d <= T.maxThrow && d >= T.minThrow && Math.abs(this.pdy) < 5) {
          this.setState('windup');
          this.fx.sfx('slingSpin', this.position, 0.6);
        }
        return;
      }
      case 'windup': {
        this.face(this.pyaw, 9);
        // slow sidestep while spinning
        const d = this.pdist || 1;
        this.moveDir(-this.pdz / d * this.strafeDir, this.pdx / d * this.strafeDir, 0.7);
        P.armRx = -2.95; P.armRz = -0.25; P.armLx = -0.4; P.armLz = 0.7;
        P.lean = -0.1; P.lid = 1; P.lidTilt = 0.25; P.squash = 1.04;
        if (this.stateT >= T.windup) { this.setState('throw'); this.thrown = false; }
        return;
      }
      case 'throw': {
        this.face(this.pyaw, 9);
        P.armRx = -1.0; P.armRz = -0.1; P.lean = 0.25; P.lid = 1; P.lidTilt = 0.25; P.mouth = 0.4; P.lambda = 40;
        if (!this.thrown && this.stateT >= 0.05) { this.thrown = true; this.fire(); }
        if (this.stateT >= T.throwTime) {
          this.throwCd = T.cooldown[0] + this.rng() * (T.cooldown[1] - T.cooldown[0]);
          this.setState('combat');
        }
        return;
      }
      default:
        this.setState('idle', 1);
    }
  }

  /** Lob a mud ball at where Morel will be (lead prediction + a little error). */
  fire() {
    const T = this.T, pl = this.ctx.player, ph = this.ctx.physics;
    const fy = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    _from.set(this.position.x + fy * 0.35, this.position.y + 1.75, this.position.z + fz * 0.35);
    const pv = pl.velocity;
    const flight = (dist) => clamp(0.6 + dist * 0.045, 0.7, 1.35);
    let t = flight(this.pdist), tx = pl.position.x, tz = pl.position.z;
    const lead = T.lead[0] + this.rng() * (T.lead[1] - T.lead[0]);
    for (let it = 0; it < 3; it++) {
      let lx = pv.x * t * lead, lz = pv.z * t * lead;
      const ll = Math.hypot(lx, lz);
      if (ll > 12) { lx *= 12 / ll; lz *= 12 / ll; }
      tx = pl.position.x + lx; tz = pl.position.z + lz;
      t = flight(Math.hypot(tx - _from.x, tz - _from.z));
    }
    const err = T.spread * this.rng();
    const ea = this.rng() * Math.PI * 2;
    tx += Math.cos(ea) * err; tz += Math.sin(ea) * err;
    // land on the ground under the predicted point (Morel may be mid-jump)
    let ty = pl.position.y;
    const gh = ph.groundHeight(tx, tz, pl.position.y + 1.5);
    if (gh > -Infinity && pl.position.y - gh < 4 && gh > ph.waterLevel) ty = pl.onGround ? Math.max(gh, pl.position.y - 0.5) : gh;
    ty += 0.4;
    _vel.set((tx - _from.x) / t, (ty - _from.y) / t + 0.5 * T.gravity * t, (tz - _from.z) / t);
    this.ctx.projectiles.spawn({
      team: 'enemy', kind: 'mud', position: _from, velocity: _vel, damage: T.damage, radius: T.radius,
      gravity: T.gravity, life: t + 1.5, owner: this,
    });
    this.shots++;
    this.lastShot = { t, target: [tx, ty, tz], lead, from: [_from.x, _from.y, _from.z], pv: [pv.x, pv.z] };
    this.fx.sfx('slingThrow', this.position, 0.7);
  }

  animateExtra(dt) {
    const m = this.model, piv = m.slingPivot;
    if (!piv) return;
    const w = this.whirl;
    if (this.state === 'windup') {
      w.visible = true;
      w.material.opacity = Math.min(0.55, this.stateT * 1.5);
      w.rotation.y += dt * 14;
      w.scale.setScalar(0.85 + Math.min(1, this.stateT * 2) * 0.25);
    } else if (w.visible) {
      w.material.opacity -= dt * 4;
      if (w.material.opacity <= 0) w.visible = false;
    }
    if (this.state === 'windup') {
      this.slingRate = Math.min(26, this.slingRate + dt * 60);
      this.slingSpin += this.slingRate * dt;
      piv.rotation.set(1.2, this.slingSpin, 0);
      // whirl trail
      if (Math.floor(this.slingSpin * 1.6) !== Math.floor((this.slingSpin - this.slingRate * dt) * 1.6)) {
        _from.set(this.position.x, this.position.y + 1.8, this.position.z);
        this.ctx.particles.spawn(_from, _vel.set(0, 0.6, 0), WHIRL_PUFF);
      }
    } else if (this.state === 'throw') {
      this.slingRate = 0;
      const k = clamp01(this.stateT / 0.2);
      piv.rotation.set(1.2 + k * 1.6, this.slingSpin, 0);
    } else {
      // hang roughly down regardless of the arm angle, with a lazy sway
      this.slingRate = 0;
      const sway = Math.sin(this.stateT * 2.1 + this.walkPhase) * 0.25;
      piv.rotation.set(-this.A.armRx + sway, 0, -this.A.armRz);
    }
  }
}
