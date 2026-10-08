// Third-person orbit camera rig: mouse/stick orbit with clamps, gentle auto-recentre,
// Q/E snap rotation, lock-on framing, collision pull-in, shake, pointer lock handling.
import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp } from '../core/mathx.js';

export const CAMERA_TUNING = {
  distance: 7.5,
  pivotHeight: 1.15,     // look-at height above Morel's feet
  pitch: 0.222,          // default elevation (camera ~2.8 m above feet at 7.5 m)
  pitchMin: -0.3, pitchMax: 1.15,
  minDistance: 0.3,      // only reached when geometry forces it (back against a wall)
  closeRise: 0.3,        // lift per metre of pull-in below 1.6 m so we look over Morel's cap
  recentreDelay: 1.5, recentreRate: 1.0,
  snapAngle: Math.PI / 4,
  lead: 0.14, maxLead: 1.3,
  lockMaxDistance: 11,
  collisionPad: 0.28,
  // title / results orbit (simulation frozen)
  orbitRate: 0.12,        // rad/s
  titleDistance: 5.2, titlePitch: 0.1,
  titleShift: 1.7,        // m: on wide screens the title aims left of Morel so he stands beside the menu
};

export function createCameraRig(ctx) {
  const C = CAMERA_TUNING;
  const cam = ctx.camera;
  const { input, physics } = ctx;

  const pivot = new THREE.Vector3();
  const lead = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const upv = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, collider: null };
  const rayOpts = { out: hit, terrainStep: 0.4 };

  let refY = 0;              // vertical reference (ground level) so small hops don't bob the camera
  let snapYaw = null;
  let noInputT = 0;
  let curDist = C.distance;
  let shakeAmp = 0, shakeTime = 0, shakeTotal = 1, shakeT = 0;
  let wasLocking = false;
  let initialised = false;
  let frameShift = 0;        // title framing: metres along the camera's right axis the view aims past Morel

  const rig = {
    yaw: 0,
    pitch: C.pitch,
    distance: C.distance,
    pivot,
    /** Current collision-limited distance. */
    get currentDistance() { return curDist; },

    /** Screen shake. amount ~ metres of offset (0.1 light .. 0.6 boss stomp), duration seconds. */
    shake(amount = 0.25, duration = 0.35) {
      if (amount >= shakeAmp * (shakeTime / shakeTotal)) { shakeAmp = amount; shakeTotal = Math.max(0.01, duration); shakeTime = duration; }
    },

    /** Put the camera straight behind Morel at the default distance/pitch (after spawns/teleports). */
    snapBehind() {
      const p = ctx.player;
      rig.yaw = p ? p.yaw : 0;
      rig.pitch = C.pitch;
      rig.distance = C.distance;
      rig._wantDist = C.distance;
      snapYaw = null;
      curDist = rig.distance;
      if (p) { refY = p.position.y; computePivotTarget(pivot); }
      lead.set(0, 0, 0);
      place(1e9);
      initialised = true;
    },

    /** Debug/screenshots: set orientation directly. */
    setView(yaw, pitch = rig.pitch, distance = rig.distance) {
      rig.yaw = yaw; rig.pitch = clamp(pitch, C.pitchMin, C.pitchMax); rig.distance = distance; curDist = distance; rig._wantDist = distance;
      snapYaw = null; noInputT = -3;
      place(1e9);
    },

    /** Fixed-step update while the simulation runs. */
    update(dt) {
      const p = ctx.player;
      if (!p) return;
      if (!initialised) rig.snapBehind();
      const playing = ctx.state === 'playing';

      // --- input
      const look = input.look;
      if (playing && (look.x !== 0 || look.y !== 0)) {
        rig.yaw -= look.x;
        rig.pitch = clamp(rig.pitch + look.y, C.pitchMin, C.pitchMax);
        noInputT = 0; snapYaw = null;
      } else noInputT += dt;
      if (playing && input.pressed('camLeft')) { snapYaw = (snapYaw ?? rig.yaw) + C.snapAngle; noInputT = 0; }
      if (playing && input.pressed('camRight')) { snapYaw = (snapYaw ?? rig.yaw) - C.snapAngle; noInputT = 0; }
      if (snapYaw !== null) {
        rig.yaw = dampAngle(rig.yaw, snapYaw, 14, dt);
        if (Math.abs(angleDelta(rig.yaw, snapYaw)) < 0.002) { rig.yaw = snapYaw; snapYaw = null; }
      }

      // --- lock-on framing / recentre
      const target = p.lockTarget && p.lockTarget.alive ? p.lockTarget : null;
      let wantDist = rig.distance;
      if (target) {
        const tp = target.position || target.object3d.position;
        const yawTo = Math.atan2(tp.x - p.position.x, tp.z - p.position.z);
        rig.yaw = dampAngle(rig.yaw, yawTo, 5, dt);
        rig.pitch = damp(rig.pitch, 0.32, 3, dt);
        const sep = Math.hypot(tp.x - p.position.x, tp.z - p.position.z);
        wantDist = clamp(rig.distance + sep * 0.22, rig.distance, C.lockMaxDistance);
        snapYaw = null; noInputT = 0;
      } else if (p.locking) {
        // lock with nothing to target: swing behind Morel (Z-target style) and hold
        if (!wasLocking) snapYaw = p.yaw;
        noInputT = 0;
      } else if (noInputT > C.recentreDelay && snapYaw === null) {
        const v = p.velocity;
        const hs = Math.hypot(v.x, v.z);
        // only while pushing (partly) forward: recentring during pure sideways input would spin Morel in circles
        if (hs > 1.5 && (input.move.y > 0.2 || !playing)) {
          const moveYaw = Math.atan2(v.x, v.z);
          const d = angleDelta(rig.yaw, moveYaw);
          // don't whip around when running toward the camera
          if (Math.abs(d) < 2.2) {
            const rate = C.recentreRate * clamp01(hs / 8.5) * (1 - Math.abs(d) / 3.2);
            rig.yaw += d * (1 - Math.exp(-rate * dt));
          }
        }
        rig.pitch = damp(rig.pitch, C.pitch, 0.8, dt);
      }
      wasLocking = p.locking;

      // --- pivot follow
      computePivotTarget(tmp);
      if (target) {
        const tp = target.position || target.object3d.position;
        tmp2.set(tp.x, tp.y + (target.height ?? 1) * 0.5, tp.z);
        tmp.lerp(tmp2, 0.3);
      }
      const vLambda = p.onGround ? 12 : 5;
      pivot.x = damp(pivot.x, tmp.x, 14, dt);
      pivot.z = damp(pivot.z, tmp.z, 14, dt);
      pivot.y = damp(pivot.y, tmp.y, vLambda, dt);
      rig._wantDist = wantDist;
      place(dt);
    },

    /** Every rendered frame: title/results orbit while the simulation is stopped. */
    frame(realDt) {
      if (ctx.simulating) { frameShift = 0; return; }
      if (ctx.state === 'title' || ctx.state === 'results') {
        if (!initialised && ctx.player) rig.snapBehind();
        const title = ctx.state === 'title';
        rig.yaw += realDt * C.orbitRate;
        rig.pitch = damp(rig.pitch, title ? C.titlePitch : 0.18, 1, realDt);
        rig._wantDist = title ? C.titleDistance : rig.distance + 1.5;
        // title on a wide screen: aim left of Morel so he stands beside the menu panel, not behind it
        const aspect = cam.aspect || 1;
        const want = title && aspect > 1.25 ? -C.titleShift * Math.min(1, (aspect - 1.25) / 0.45) : 0;
        frameShift = damp(frameShift, want, 2, realDt);
        place(realDt);
      }
    },
  };

  function computePivotTarget(out) {
    const p = ctx.player;
    const pos = p.position;
    if (p.onGround || pos.y < refY) refY = pos.y;
    else if (p.state === 'updraft' && pos.y > refY + 0.8) refY = pos.y - 0.8;
    else if (pos.y > refY + 2.5) refY = pos.y - 2.5;
    const y = refY + (pos.y - refY) * 0.4;
    const v = p.velocity;
    tmp2.set(v.x * C.lead, 0, v.z * C.lead);
    if (tmp2.length() > C.maxLead) tmp2.setLength(C.maxLead);
    lead.lerp(tmp2, 0.06);
    return out.set(pos.x + lead.x, y + C.pivotHeight, pos.z + lead.z);
  }

  /** Position the camera from pivot/yaw/pitch with collision. dt=1e9 snaps smoothing. */
  function place(dt) {
    const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
    viewDir.set(Math.sin(rig.yaw) * cp, -sp, Math.cos(rig.yaw) * cp); // camera -> pivot
    right.set(-Math.cos(rig.yaw), 0, Math.sin(rig.yaw));
    upv.crossVectors(right, viewDir).normalize();
    const want = rig._wantDist ?? rig.distance;

    // thick ray: centre + 4 offsets, from pivot back toward the camera
    let allowed = want;
    tmp.copy(viewDir).negate();
    for (let k = 0; k < 5; k++) {
      const ox = k === 1 ? 0.32 : k === 2 ? -0.32 : 0;
      const oy = k === 3 ? 0.24 : k === 4 ? -0.24 : 0;
      tmp2.copy(pivot).addScaledVector(right, ox).addScaledVector(upv, oy);
      const h = physics.raycast(tmp2, tmp, want + C.collisionPad, rayOpts);
      if (h) allowed = Math.min(allowed, h.distance - C.collisionPad);
    }
    allowed = Math.max(C.minDistance, allowed);
    if (allowed < curDist || dt >= 1e8) curDist = allowed;
    else curDist = damp(curDist, allowed, 2.5, dt);

    desired.copy(pivot).addScaledVector(viewDir, -curDist);
    if (curDist < 1.6) desired.y += (1.6 - curDist) * C.closeRise;
    if (ctx.player) ctx.player.cameraNear = curDist < 0.22;
    // never under terrain or water
    const th = physics.terrainHeight(desired.x, desired.z);
    if (desired.y < th + 0.45) desired.y = th + 0.45;
    if (desired.y < physics.waterLevel + 0.3) desired.y = physics.waterLevel + 0.3;
    cam.position.copy(desired);

    // shake; when pulled in close, aim past the pivot so the view stays level instead of staring down
    lookAt.copy(pivot);
    if (frameShift !== 0) lookAt.addScaledVector(right, frameShift);
    if (curDist < 2.5) lookAt.addScaledVector(viewDir, 2.5 - curDist);
    if (shakeTime > 0 && dt < 1e8) {
      shakeTime = Math.max(0, shakeTime - dt);
      shakeT += dt;
      const k = shakeAmp * Math.pow(shakeTime / shakeTotal, 2);
      const sx = (Math.sin(shakeT * 61.3) + Math.sin(shakeT * 37.1) * 0.5) * k;
      const sy = (Math.sin(shakeT * 53.7 + 1.3) + Math.sin(shakeT * 29.9) * 0.5) * k;
      cam.position.addScaledVector(right, sx).addScaledVector(upv, sy);
      lookAt.addScaledVector(right, sx * 0.5).addScaledVector(upv, sy * 0.5);
    }
    cam.lookAt(lookAt);
  }

  // pointer lock on canvas click while playing (graceful drag fallback lives in input)
  const canvas = ctx.renderer.domElement;
  canvas.addEventListener('click', (e) => {
    if (ctx.state !== 'playing' || input.mouseMode !== 'lock' || input.pointerLocked) return;
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    if (input.lastDevice === 'touch') return;
    input.requestPointerLock();
  });
  ctx.events.on('game:state', ({ state }) => { if (state !== 'playing' && state !== 'dead') input.exitPointerLock(); });

  return rig;
}
