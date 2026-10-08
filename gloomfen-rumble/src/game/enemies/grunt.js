// Grunt (3 hp, 200 pts): patrols, notices Morel within ~13 m with line of sight,
// chases, and swings a nail-studded club in a slow, clearly telegraphed overhead
// arc (0.45 s wind-up), then needs a moment to pull it out of the dirt.
import * as THREE from 'three';
import { Bandit } from './common.js';
import { angleDelta, clamp01 } from '../../core/mathx.js';

export const GRUNT_LOOK = {
  id: 'grunt', seed: 3, scale: 1,
  W: 0.56, H: 0.46, D: 0.5, bodyY: 0.6,
  skin: 0x86a040, skinDark: 0x55702c, belly: 0xe6d494, eye: 0xf4cf52,
  eyeR: 0.165, eyeSpread: 0.42, mouthLat: 0.04, mouthR: 0.017, mouthSpan: 1.22, noseScale: 1,
  legScale: 1, footScale: 1, armR: 0.092, armLen: 0.27, handR: 0.1,
  potR: 0.29, potH: 0.26, potTilt: [-0.12, -0.7, 0.14], potColor: 0xa4aeba, potSink: 0.02, potFwd: 0.06,
  cloak: { color: 0xffffff, top: 0.62, bottom: 0.72, cover: Math.PI * 1.3, flare: 0.1 },
  hoodScale: 1, weapon: 'club', outline: 0.022,
};

const CFG = {
  type: 'grunt', look: GRUNT_LOOK, hp: 3, points: 200,
  hitRadius: 0.6, hitHeight: 1.3, bodyRadius: 0.45, bodyHeight: 1.15,
  walkSpeed: 1.6, runSpeed: 4.2, accel: 20, turnRate: 8,
  noticeRange: 13, loseRange: 20, leash: 14, patrol: 4, eyeHeight: 1.0,
};
export const GRUNT_TUNING = {
  attackRange: 1.9,  // start the wind-up when Morel is this close (centre to centre)
  reach: 2.05,       // swing hits Morel within this distance + his radius...
  arc: 1.15,         // ...and within this angle of the grunt's facing (rad)
  windup: 0.45, swing: 0.18, recover: 0.7, damage: 1,
};

const _v = new THREE.Vector3();
let swooshGeo = null, swooshTex = null;

export class Grunt extends Bandit {
  constructor(ctx, def) {
    super(ctx, def, CFG);
    this.T = GRUNT_TUNING;
    this.hitLanded = false;
    this.swung = false;
    // swoosh arc for the swing (vertical, in front of the right shoulder)
    if (!swooshGeo) {
      swooshGeo = new THREE.RingGeometry(0.7, 1.3, 24, 1, -0.45, 2.5).rotateY(-Math.PI / 2);
      swooshTex = ctx.materials.canvasTexture(64, 64, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.66, 'rgba(0,0,0,0)');
        grd.addColorStop(0.86, 'rgba(255,236,200,1)'); grd.addColorStop(0.93, 'rgba(120,100,80,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
      }, { srgb: false });
    }
    const mat = new THREE.MeshBasicMaterial({ map: swooshTex, color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.swoosh = new THREE.Mesh(swooshGeo, mat);
    const sh = this.model.dims.shoulder;
    this.swoosh.position.set(-sh[0], sh[1], sh[2]);
    this.swoosh.visible = false;
    this.model.inner.add(this.swoosh);
    this.watchT = 0;
  }

  engage() {
    if (!this.playerTargetable()) { this.lose(); return; }
    this.setState('chase');
  }

  think(dt) {
    const T = this.T, P = this.P, pl = this.ctx.player;
    switch (this.state) {
      case 'chase': {
        if (!this.playerTargetable()) { this.taunt(1.6); return; }
        if (this.playerLost()) { this.lose(); return; }
        P.lid = 0.85; P.lidTilt = 0.28; P.lean = 0.12;
        P.armRx = -0.5; // club held ready
        const facing = Math.abs(angleDelta(this.yaw, this.pyaw));
        if (this.pdist < T.attackRange && this.pdy > -0.8 && this.pdy < 1.3 && facing < 0.6) {
          this.startWindup();
          return;
        }
        if (this.pdist > 1.45) this.moveToward(pl.position.x, pl.position.z, this.cfg.runSpeed);
        else this.face(this.pyaw, 10);
        if (this.blockedT > 0.6 || (this.pdy > 1.3 && this.pdist < 3)) { this.setState('watch'); this.watchT = 0; }
        return;
      }
      case 'watch': {
        // Morel is out of reach (ledge, water, leash): glare, taunt now and then
        if (!this.playerTargetable()) { this.taunt(1.6); return; }
        if (this.playerLost()) { this.lose(); return; }
        this.face(this.pyaw, 6);
        P.lid = 0.7; P.lidTilt = 0.3;
        this.watchT += dt;
        if (this.pdist < T.attackRange + 0.1 && this.pdy < 1.3 && this.pdy > -0.8) { this.startWindup(); return; }
        if (this.watchT > 0.6) {
          this.watchT = 0;
          // reachable again? (step toward Morel is safe and inside the leash, roughly level)
          const nx = this.pdx / (this.pdist || 1), nz = this.pdz / (this.pdist || 1);
          const look = this.body.radius + 0.6;
          const x = this.position.x + nx * look, z = this.position.z + nz * look;
          if (Math.abs(this.pdy) < 1.0 && this.safeAt(x, z) && this.inLeash(x, z)) { this.blockedT = 0; this.setState('chase'); return; }
          if (this.rng() < 0.35) this.taunt(1.2);
        }
        return;
      }
      case 'windup': {
        // telegraph: club raised high, lean back, slow tracking
        this.face(this.pyaw, 2.6);
        const k = clamp01(this.stateT / T.windup);
        P.armRx = -2.85; P.armRz = -0.15; P.armLx = -0.7; P.armLz = 0.6;
        P.lean = -0.22 * k; P.squash = 1 + 0.07 * k; P.lid = 1.05; P.lidTilt = 0.35; P.mouth = 0.25;
        P.twist = -0.15 * k; P.lambda = 16;
        if (this.stateT >= T.windup) { this.setState('swing'); this.swung = false; }
        return;
      }
      case 'swing': {
        P.armRx = -0.12; P.armRz = -0.1; P.armLx = 0.3; P.lean = 0.38; P.squash = 0.9; P.twist = 0.12;
        P.lid = 1.05; P.lidTilt = 0.35; P.mouth = 0.7; P.lambda = 60;
        if (!this.swung && this.stateT >= 0.07) { this.swung = true; this.resolveSwing(); }
        if (this.stateT >= T.swing) this.setState('recover');
        return;
      }
      case 'recover': {
        // club stuck in the dirt: tug, pant — the punish window
        const tug = Math.sin(this.stateT * 22) * 0.1;
        P.armRx = -0.15 + tug; P.lean = 0.3; P.squash = 0.95; P.lid = 0.45; P.mouth = 0.25 + Math.abs(tug) * 2;
        if (this.stateT >= T.recover) {
          if (this.hitLanded && this.playerTargetable()) this.taunt(1.1);
          else this.setState('chase');
          this.hitLanded = false;
        }
        return;
      }
      default:
        this.setState('idle', 1);
    }
  }

  startWindup() {
    this.setState('windup');
    this.hitLanded = false;
    this.fx.sfx('clubWindup', this.position, 0.7);
    _v.set(this.position.x - Math.sin(this.yaw) * 0.25, this.position.y + 2.0, this.position.z - Math.cos(this.yaw) * 0.25);
    this.ctx.particles.burst({ position: _v, count: 6, color: [0xffffff, 0xffe9a0], speed: 1.5, life: 0.3, size: 0.12, kind: 'glow', intensity: 2 });
  }

  resolveSwing() {
    const T = this.T, pl = this.ctx.player;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const impact = _v.set(this.position.x + fx * 1.25, this.position.y, this.position.z + fz * 1.25);
    this.fx.sfx('clubSlam', impact, 0.8);
    this.ctx.particles.burst({ position: impact, count: 12, color: [0xb08850, 0xd8c098], speed: 3, spread: 0.6, life: 0.5, size: 0.35, kind: 'puff' });
    this.fx.decal('crack', impact, { size: 1.0, life: 2.5 });
    const facing = Math.abs(angleDelta(this.yaw, this.pyaw));
    if (this.playerTargetable() && this.pdist < T.reach + (pl.radius || 0.3) && facing < T.arc && this.pdy > -0.8 && this.pdy < 1.4) {
      if (pl.damage(T.damage, this.position)) this.hitLanded = true;
    }
    if (this.pdist < 6 && this.ctx.cameraRig) this.ctx.cameraRig.shake(0.08, 0.2);
  }

  animateExtra(dt) {
    // swoosh arc during the swing
    const s = this.swoosh;
    if (this.state === 'swing' || (this.state === 'recover' && this.stateT < 0.12)) {
      const t = this.state === 'swing' ? this.stateT : this.T.swing + this.stateT;
      s.visible = true;
      s.material.opacity = Math.max(0, 1 - t / 0.3) * 0.6;
      s.scale.setScalar(0.95 + t * 0.5);
    } else if (s.visible) s.visible = false;
    void dt;
  }

  onDie() { this.swoosh.visible = false; }
}
