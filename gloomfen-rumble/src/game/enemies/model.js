// Bog Bandit models: one canvas texture atlas (warty skin, burlap, tin, wood, bark,
// cloth, brass) + a parametric toad builder. Every part of a bandit uses ONE
// per-enemy toon material (atlas map * vertex colours), and all static parts are
// merged, so a grunt is ~8 meshes. Geometry is built once per look and shared.
//
//   const m = buildToad(ctx, LOOK)   // LOOK: see GRUNT_LOOK in grunt.js for the fields
//   m.root (feet, yaw) > m.rig (scale, death spin) > m.pivot (lean/squash) > parts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rand, smoothstep, lerp } from '../../core/mathx.js';

// ---------------------------------------------------------------------------
// Texture atlas
// ---------------------------------------------------------------------------
const AT = 512;
// [x, y, w, h] in canvas pixels (canvas y down)
export const REGIONS = {
  skin: [0, 0, 256, 256],
  burlap: [256, 0, 256, 256],
  iron: [0, 256, 192, 128],
  wood: [192, 256, 192, 128],
  belly: [384, 256, 128, 128],
  plain: [0, 384, 64, 64],
  bark: [64, 384, 192, 128],
  cloth: [256, 384, 128, 128],
  brass: [384, 384, 128, 128],
};

function drawAtlas(g) {
  const r = rand(4242);
  const clipRegion = (name, fn) => {
    const [x, y, w, h] = REGIONS[name];
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.translate(x, y);
    fn(w, h);
    g.restore();
  };
  const wrapDraw = (w, fn) => { for (const ox of [-w, 0, w]) fn(ox); };
  const blob = (cx, cy, rad, color) => {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  };

  // warty skin: bright base (tinted by vertex colour), dark mottles, raised warts
  clipRegion('skin', (w, h) => {
    g.fillStyle = '#efefe6'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 46; k++) {
      const cx = r() * w, cy = r() * h, rad = 10 + r() * 30, a = 0.1 + r() * 0.16;
      wrapDraw(w, (ox) => blob(cx + ox, cy, rad, `rgba(30,44,12,${a})`));
    }
    for (let k = 0; k < 150; k++) {
      const cx = r() * w, cy = r() * h, rad = 1.6 + r() * 4.2;
      wrapDraw(w, (ox) => {
        g.fillStyle = 'rgba(28,36,10,0.32)'; g.beginPath(); g.arc(cx + ox + 0.8, cy + 1, rad * 1.25, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,226,0.55)'; g.beginPath(); g.arc(cx + ox, cy, rad, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(cx + ox - rad * 0.3, cy - rad * 0.3, rad * 0.4, 0, 7); g.fill();
      });
    }
  });

  // belly: pale, soft speckles and throat folds
  clipRegion('belly', (w, h) => {
    g.fillStyle = '#f4f2e8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,100,60,0.16)'; g.lineWidth = 2;
    for (let k = 0; k < 7; k++) { const y = 10 + k * 17; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 5, w * 0.7, y + 5, w, y); g.stroke(); }
    for (let k = 0; k < 60; k++) {
      g.fillStyle = `rgba(110,96,50,${0.1 + r() * 0.15})`;
      g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 2.5, 0, 7); g.fill();
    }
  });

  // burlap: woven sackcloth, darker patches, a stitched patch, frayed edges
  clipRegion('burlap', (w, h) => {
    g.fillStyle = '#b39463'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const odd = ((x + y) >> 2) & 1;
        const v = odd ? 18 : -14;
        g.fillStyle = `rgba(${v > 0 ? '255,240,200' : '60,40,20'},${Math.abs(v) / 100 + r() * 0.08})`;
        g.fillRect(x, y, odd ? 4 : 3, odd ? 3 : 4);
      }
    }
    for (let k = 0; k < 10; k++) blob(r() * w, r() * h, 14 + r() * 26, `rgba(70,46,20,${0.15 + r() * 0.15})`);
    // stitched patch
    const px = 150, py = 60, pw = 56, ph = 46;
    g.fillStyle = '#8f7445'; g.fillRect(px, py, pw, ph);
    g.strokeStyle = 'rgba(40,26,12,0.8)'; g.lineWidth = 2;
    for (let k = 0; k < pw; k += 8) { g.beginPath(); g.moveTo(px + k, py - 3); g.lineTo(px + k + 4, py + 3); g.stroke(); g.beginPath(); g.moveTo(px + k, py + ph - 3); g.lineTo(px + k + 4, py + ph + 3); g.stroke(); }
    for (let k = 0; k < ph; k += 8) { g.beginPath(); g.moveTo(px - 3, py + k); g.lineTo(px + 3, py + k + 4); g.stroke(); g.beginPath(); g.moveTo(px + pw - 3, py + k); g.lineTo(px + pw + 3, py + k + 4); g.stroke(); }
    // frayed top/bottom bands
    g.fillStyle = 'rgba(60,38,16,0.35)'; g.fillRect(0, 0, w, 8); g.fillRect(0, h - 10, w, 10);
  });

  // tin / iron: brushed metal, dents, rust freckles, scratches
  clipRegion('iron', (w, h) => {
    g.fillStyle = '#a9b4c0'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,50,60'},${r() * 0.12})`; g.fillRect(0, y, w, 1); }
    for (let k = 0; k < 12; k++) blob(r() * w, r() * h, 8 + r() * 18, `rgba(40,48,60,${0.2 + r() * 0.2})`);
    for (let k = 0; k < 26; k++) blob(r() * w, r() * h, 2 + r() * 9, `rgba(150,82,36,${0.35 + r() * 0.35})`);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < 18; k++) { const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 10); g.stroke(); }
  });

  // planed wood (club shafts)
  clipRegion('wood', (w, h) => {
    g.fillStyle = '#9a6a3a'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 22; k++) {
      const y0 = r() * h;
      g.strokeStyle = `rgba(60,34,14,${0.2 + r() * 0.25})`; g.lineWidth = 1 + r() * 2;
      g.beginPath(); g.moveTo(0, y0);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.05 + k) * 4);
      g.stroke();
    }
    for (let k = 0; k < 3; k++) { const x = r() * w, y = r() * h; g.fillStyle = 'rgba(50,28,10,0.6)'; g.beginPath(); g.ellipse(x, y, 6, 3, 0, 0, 7); g.fill(); }
  });

  // rough bark (the boss's log club, throne)
  clipRegion('bark', (w, h) => {
    g.fillStyle = '#6a4a30'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6 + r() * 6) {
      g.fillStyle = `rgba(${r() < 0.5 ? '30,18,8' : '150,110,70'},${0.25 + r() * 0.3})`;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 12) g.lineTo(x + Math.sin(y * 0.12 + x) * 2.5, y);
      g.lineTo(x + 3, h); g.lineTo(x + 3, 0); g.fill();
    }
    for (let k = 0; k < 8; k++) blob(r() * w, r() * h, 6 + r() * 12, 'rgba(90,140,60,0.35)'); // moss
  });

  // plain woven cloth (sashes, scarves; tinted)
  clipRegion('cloth', (w, h) => {
    g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 3) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, 0, 1, h); }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, h * 0.2, w, 5); g.fillRect(0, h * 0.75, w, 5);
  });

  // brass (clasps, crown)
  clipRegion('brass', (w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#ffe08a'); grd.addColorStop(0.5, '#d6a03c'); grd.addColorStop(1, '#8a5a1c');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 10; k++) blob(r() * w, r() * h, 4 + r() * 10, 'rgba(255,255,220,0.35)');
  });

  clipRegion('plain', (w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Color();
const KEEP = new Set(['position', 'normal', 'uv', 'color']);

/** Remap a geometry's 0..1 UVs into an atlas region. uvScale <= 1 zooms in (no wrapping: atlas regions do not tile). */
function remapUV(geo, region, uvScale = [1, 1]) {
  const [x, y, w, h] = REGIONS[region];
  const pad = 3;
  const u0 = (x + pad) / AT, u1 = (x + w - pad) / AT;
  const v0 = 1 - (y + h - pad) / AT, v1 = 1 - (y + pad) / AT;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = Math.min(1, Math.max(0, uv.getX(i) * uvScale[0]));
    const v = Math.min(1, Math.max(0, uv.getY(i) * uvScale[1]));
    uv.setXY(i, lerp(u0, u1, u), lerp(v0, v1, v));
  }
}

function setColor(geo, color, colorFn) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    if (colorFn) colorFn(i, _c.set(color));
    arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/**
 * Clone a template geometry, transform it, map it to an atlas region and colour it.
 * o: { pos, rot, scl, uv: [su,sv], colorFn(i, color) }
 */
function part(geo, region, color, o = {}) {
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
  g.clearGroups();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  remapUV(g, region, o.uv);
  setColor(g, color, o.colorFn ? (i, c) => o.colorFn(i, c, g) : null);
  const pos = o.pos || [0, 0, 0], rot = o.rot || [0, 0, 0], scl = o.scl || [1, 1, 1];
  _m4.compose(_t.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], o.order || 'XYZ')), _s.set(scl[0], scl[1], scl[2]));
  g.applyMatrix4(_m4);
  return g;
}

function merge(parts) {
  const indexed = parts.every((p) => p.index);
  const list = indexed ? parts : parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(list, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// template primitives (unit-sized)
const T = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  sphereMid: new THREE.SphereGeometry(1, 10, 8),
  sphereHi: new THREE.SphereGeometry(1, 26, 18),
  sphereLo: new THREE.SphereGeometry(1, 7, 5),
  wart: new THREE.SphereGeometry(1, 5, 4),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
  cone: new THREE.ConeGeometry(1, 1, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
};

/** Toad body shape: deform a unit-sphere direction (pear-shaped, flat crown, belly pushed forward). */
function bodyDeform(x, y, z, out) {
  const low = smoothstep(0.25, -0.7, y);
  const k = 1 + 0.13 * low;
  let yy = y > 0 ? y * 0.88 : y;
  if (yy < -0.74) yy = -0.74 + (yy + 0.74) * 0.35;
  const zz = z * k + 0.1 * Math.max(0, z) * smoothstep(0.35, -0.5, y);
  return out.set(x * k, yy, zz);
}

// ---------------------------------------------------------------------------
// Toad geometry (built once per look)
// ---------------------------------------------------------------------------
function buildGeometries(L) {
  const W = L.W, H = L.H, D = L.D, BY = L.bodyY;
  const skin = new THREE.Color(L.skin), skinDark = new THREE.Color(L.skinDark), belly = new THREE.Color(L.belly);
  const r = rand(L.seed || 7);
  const tmp = new THREE.Vector3();
  const surf = (dx, dy, dz, out = new THREE.Vector3()) => {
    tmp.set(dx, dy, dz).normalize();
    bodyDeform(tmp.x, tmp.y, tmp.z, out);
    return out.set(out.x * W, out.y * H + BY, out.z * D);
  };
  const G = { dims: {} };

  // --- body (skin + belly gradient) + warts + thighs + eyes + mouth line + cloak
  const parts = [];
  const bodyGeo = T.sphereHi.clone();
  {
    const p = bodyGeo.attributes.position;
    const unit = [];
    for (let i = 0; i < p.count; i++) {
      unit.push([p.getX(i), p.getY(i), p.getZ(i)]);
      bodyDeform(p.getX(i), p.getY(i), p.getZ(i), tmp);
      p.setXYZ(i, tmp.x * W, tmp.y * H + BY, tmp.z * D);
    }
    bodyGeo.computeVertexNormals();
    parts.push(part(bodyGeo, 'skin', 0xffffff, {
            colorFn: (i, c) => {
        const [x, y, z] = unit[i];
        const back = smoothstep(-0.1, 0.9, y * 0.7 - z * 0.6);
        c.copy(skin).lerp(skinDark, back * 0.75);
        const bw = smoothstep(0.15, 0.6, z) * smoothstep(0.3, -0.15, y) * smoothstep(-0.95, -0.6, y);
        c.lerp(belly, bw);
      },
    }));
    // the belly region gets its own fine texture via a second, slightly larger shell over the front
    const shell = new THREE.SphereGeometry(1, 22, 14, Math.PI * 0.5 - 1.0, 2.0, Math.PI * 0.52, Math.PI * 0.4);
    const sp = shell.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      bodyDeform(sp.getX(i), sp.getY(i), sp.getZ(i), tmp);
      sp.setXYZ(i, tmp.x * W * 1.012, tmp.y * H * 1.012 + BY, tmp.z * D * 1.012);
    }
    shell.computeVertexNormals();
    // SphereGeometry's x is -cos(phi): flip so phi range centred on +z
    parts.push(part(shell, 'belly', belly, {
      // fade into the skin colour toward the sides so the shell edge does not show
      colorFn: (i, c) => {
        const uy = (sp.getY(i) - BY) / H;
        const w = smoothstep(0.25, 0.5, sp.getZ(i) / D) * smoothstep(-0.04, -0.3, uy) * smoothstep(-0.98, -0.78, uy);
        c.copy(skin).lerp(belly, Math.min(1, w * 1.25));
      },
    }));
    shell.dispose();
  }
  // warts on the back and crown
  for (let k = 0; k < (L.warts ?? 18); k++) {
    const a = r() * Math.PI * 2, el = 0.15 + r() * 0.75;
    const dx = Math.cos(a) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(a) * Math.cos(el) * 0.9 - 0.35;
    const p = surf(dx, dy, dz);
    const s = (0.022 + r() * 0.024) * (L.wartScale || 1);
    parts.push(part(T.wart, 'skin', r() < 0.5 ? skinDark : skin.clone().lerp(belly, 0.25), { pos: [p.x, p.y - s * 0.3, p.z], scl: [s, s * 0.8, s] }));
  }
  // thighs
  for (const sx of [-1, 1]) {
    parts.push(part(T.sphereMid, 'skin', skinDark, { pos: [sx * W * 0.66, 0.24 * L.legScale, -0.03], scl: [0.17 * L.legScale, 0.14 * L.legScale, 0.19 * L.legScale] }));
  }
  // eyes: golden sclera, horizontal-oval pupil, glint
  const eyeR = L.eyeR;
  const eyes = [];
  for (const sx of [-1, 1]) {
    const p = surf(sx * L.eyeSpread, 0.86, 0.5);
    const n = tmp.copy(p).sub(_t.set(0, BY, 0)).normalize();
    const c = p.clone().addScaledVector(n, eyeR * (L.eyePop ?? 0.12));
    c.y += eyeR * 0.12;
    eyes.push(c);
    const outward = sx * 0.28;
    parts.push(part(T.sphere, 'plain', L.eye, { pos: [c.x, c.y, c.z], scl: [eyeR, eyeR, eyeR] }));
    // pupil (front of the eye, turned slightly outward)
    const fx = Math.sin(outward), fz = Math.cos(outward);
    parts.push(part(T.sphereLo, 'plain', 0x15101c, { pos: [c.x + fx * eyeR * 0.84, c.y - eyeR * 0.2, c.z + fz * eyeR * 0.84], rot: [0, outward, 0], scl: [eyeR * 0.6, eyeR * 0.34, eyeR * 0.22] }));
    parts.push(part(T.wart, 'plain', 0xffffff, { pos: [c.x + fx * eyeR * 0.92 - sx * eyeR * 0.2, c.y - eyeR * 0.08, c.z + fz * eyeR * 0.9], scl: [eyeR * 0.13, eyeR * 0.13, eyeR * 0.09] }));
  }
  // very wide mouth line, corners curled slightly up
  {
    const pts = [];
    const span = L.mouthSpan ?? 1.2;
    for (let k = 0; k <= 16; k++) {
      const th = -span + (2 * span * k) / 16;
      const t = th / span;
      const lat = L.mouthLat + 0.07 * t * t * t * t - 0.012;
      const p = surf(Math.sin(th) * Math.cos(lat), Math.sin(lat), Math.cos(th) * Math.cos(lat));
      const n = tmp.copy(p).sub(_t.set(0, BY, 0)).normalize();
      p.addScaledVector(n, 0.006);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 22, L.mouthR, 4, false);
    parts.push(part(tube, 'plain', 0x2a1418));
    tube.dispose();
    const mid = surf(0, Math.sin(L.mouthLat), Math.cos(L.mouthLat));
    G.dims.mouth = [0, mid.y, mid.z];
    // nostrils
    for (const sx of [-1, 1]) {
      const np = surf(sx * 0.09, Math.sin(L.mouthLat + 0.2), Math.cos(L.mouthLat + 0.2));
      parts.push(part(T.wart, 'plain', 0x2a1418, { pos: [np.x, np.y, np.z], scl: [0.016 * L.noseScale, 0.012 * L.noseScale, 0.012 * L.noseScale] }));
    }
  }
  // cloak (burlap shoulder cape, open at the front, narrower at the shoulders, jagged hem)
  if (L.cloak) {
    const C = L.cloak;
    const cover = C.cover ?? Math.PI * 1.36;
    const segs = 26, hs = 7;
    const g = new THREE.CylinderGeometry(1, 1, 1, segs, hs, true, Math.PI - cover / 2, cover);
    const p = g.attributes.position;
    const yTop = BY + H * C.top, yBot = BY - H * C.bottom;
    const rAt = (yAbs) => {
      const yy = (yAbs - BY) / H;
      const uy = yy > 0 ? Math.min(0.99, yy / 0.88) : Math.max(-0.99, yy);
      const k = Math.sqrt(1 - uy * uy) * (1 + 0.13 * smoothstep(0.25, -0.7, uy));
      return k;
    };
    const flare = C.flare ?? 0.1;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const t = 0.5 - y; // 0 top .. 1 bottom
      let th = Math.atan2(x, z);
      if (th < 0) th += Math.PI * 2;
      // narrower at the shoulders, full width at the hem
      const th2 = Math.PI + (th - Math.PI) * lerp(C.topCover ?? 0.72, 1, Math.pow(t, 0.7));
      let yy = lerp(yTop, yBot, t);
      // hug the body (plus a little slack), flaring toward the hem, with soft folds
      const k = (rAt(yy) + 0.07 + flare * t * t + 0.06 * t) * (1 + Math.sin(th2 * 7 + 1) * 0.035 * t);
      if (t > 0.99) {
        const idx = Math.round(((th - (Math.PI - cover / 2)) / cover) * segs);
        yy += (idx % 2 ? 0.075 : -0.02) * (C.jag ?? 1) * (0.7 + 0.6 * ((idx * 7919) % 5) / 5);
      }
      p.setXYZ(i, Math.sin(th2) * k * W, yy, Math.cos(th2) * k * D);
    }
    g.computeVertexNormals();
    parts.push(part(g, 'burlap', C.color));
    g.dispose();
  }
  // belt + satchel (slinger)
  if (L.satchel) {
    const beltY = BY - H * 0.38;
    const k = 1.08;
    const belt = new THREE.TorusGeometry(1, 0.03, 6, 30);
    belt.rotateX(Math.PI / 2);
    const bp = belt.attributes.position;
    for (let i = 0; i < bp.count; i++) bp.setXYZ(i, bp.getX(i) * W * k * 1.06, bp.getY(i) + beltY, bp.getZ(i) * D * k * 1.1);
    belt.computeVertexNormals();
    parts.push(part(belt, 'cloth', 0x4a3420));
    belt.dispose();
    const sx = -W * 1.02, sz = 0.12;
    parts.push(part(T.sphere, 'burlap', 0xc8b088, { pos: [sx, beltY - 0.1, sz], scl: [0.12, 0.15, 0.15], uv: [0.5, 0.5] }));
    for (let k2 = 0; k2 < 3; k2++) parts.push(part(T.sphereLo, 'plain', 0x5a3e24, { pos: [sx + (k2 - 1) * 0.05, beltY + 0.03, sz + (k2 % 2) * 0.04 - 0.02], scl: [0.055, 0.05, 0.055] }));
    parts.push(part(T.box, 'cloth', 0x6b4a2a, { pos: [sx + 0.02, beltY - 0.02, sz + 0.14], rot: [0.2, 0, 0], scl: [0.15, 0.1, 0.02] }));
  }
  // sash (boss)
  if (L.sash) {
    const g = new THREE.TorusGeometry(1, 0.07, 6, 34);
    g.rotateX(Math.PI / 2); g.rotateZ(0.45);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * W * 1.04, p.getY(i) * H * 0.95 + BY + 0.02, p.getZ(i) * D * 1.08);
    g.computeVertexNormals();
    parts.push(part(g, 'cloth', L.sash));
    g.dispose();
  }
  // necklace of snail shells (boss)
  if (L.necklace) {
    for (let k = 0; k < 7; k++) {
      const a = -1.0 + (k / 6) * 2.0;
      const p = surf(Math.sin(a), 0.32 - Math.abs(a) * 0.12, Math.cos(a));
      parts.push(part(T.sphere, k % 2 ? 'brass' : 'plain', k % 2 ? 0xffffff : 0xe8d8b8, { pos: [p.x, p.y, p.z + 0.01], scl: [0.04, 0.04, 0.03] }));
    }
  }
  G.body = merge(parts);
  G.dims.eyes = eyes.map((v) => v.toArray());
  G.dims.headTop = surf(0, 1, L.potFwd ?? -0.02).toArray();

  // --- lid (upper hemisphere + dark lash rim); pivot at the eye centre
  {
    const lr = eyeR * 1.13;
    const cap = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const rim = new THREE.TorusGeometry(1, 0.06, 4, 16);
    rim.rotateX(Math.PI / 2);
    G.lid = merge([
      part(cap, 'skin', skinDark.clone().lerp(skin, 0.4), { scl: [lr, lr, lr], uv: [0.3, 0.3] }),
      part(rim, 'plain', 0x2a1a1c, { scl: [lr * 0.99, lr, lr * 0.99] }),
    ]);
    cap.dispose(); rim.dispose();
  }

  // --- foot (pivot at the ankle base)
  {
    const fs = L.footScale;
    G.foot = merge([
      part(T.sphere, 'skin', skinDark, { pos: [0, 0.06 * fs, 0.04 * fs], scl: [0.15 * fs, 0.075 * fs, 0.2 * fs] }),
      part(T.sphereLo, 'skin', skinDark, { pos: [-0.08 * fs, 0.04 * fs, 0.21 * fs], scl: [0.055 * fs, 0.042 * fs, 0.07 * fs] }),
      part(T.sphereLo, 'skin', skinDark, { pos: [0.08 * fs, 0.04 * fs, 0.21 * fs], scl: [0.055 * fs, 0.042 * fs, 0.07 * fs] }),
      part(T.sphereLo, 'skin', skinDark, { pos: [0, 0.042 * fs, 0.24 * fs], scl: [0.058 * fs, 0.044 * fs, 0.075 * fs] }),
      part(T.sphereMid, 'skin', skin, { pos: [0, 0.14 * fs, -0.02 * fs], scl: [0.09 * fs, 0.1 * fs, 0.09 * fs] }),
    ]);
  }

  // --- arms (pivot at the shoulder); right arm may carry a weapon
  const armParts = (withWeapon) => {
    const ar = L.armR, al = L.armLen, hr = L.handR;
    const ps = [
      part(T.sphereMid, 'skin', skin, { scl: [ar * 1.3, ar * 1.3, ar * 1.3] }),
      part(T.cyl, 'skin', skin, { pos: [0, -al / 2, 0], scl: [ar, al, ar] }),
      part(T.sphereMid, 'skin', skin.clone().lerp(belly, 0.15), { pos: [0, -al - hr * 0.4, 0.02], scl: [hr, hr * 0.85, hr * 1.1] }),
      part(T.sphereLo, 'skin', skinDark, { pos: [-hr * 0.45, -al - hr * 1.05, hr * 0.5], scl: [hr * 0.36, hr * 0.36, hr * 0.42] }),
      part(T.sphereLo, 'skin', skinDark, { pos: [hr * 0.45, -al - hr * 1.05, hr * 0.5], scl: [hr * 0.36, hr * 0.36, hr * 0.42] }),
      part(T.sphereLo, 'skin', skinDark, { pos: [0, -al - hr * 1.15, hr * 0.62], scl: [hr * 0.36, hr * 0.36, hr * 0.42] }),
    ];
    if (withWeapon === 'club') ps.push(...clubParts(L, [0, -al - hr * 0.4, 0.04], 2.09, 1));
    if (withWeapon === 'log') ps.push(...logParts(L, [0, -al - hr * 0.4, 0.04], 2.09));
    return merge(ps);
  };
  G.armL = armParts(null);
  G.armR = armParts(L.weapon === 'club' || L.weapon === 'log' ? L.weapon : null);

  // --- helmet: dented tin pot with a saucepan handle sticking out (origin = rim centre)
  G.helmet = helmetGeometry(L, r);

  // --- open mouth (shown when croaking / yawning / roaring): dark gape + tongue
  G.mouthOpen = merge([
    part(T.sphere, 'plain', 0x3a1218, { scl: [W * 0.5, 1, 0.16 * L.noseScale] }),
    part(T.sphere, 'plain', 0xd8667a, { pos: [0, -0.45, 0.05 * L.noseScale], scl: [W * 0.25, 0.4, 0.1 * L.noseScale] }),
  ]);

  // --- sling (slinger): rope + leather pouch + mud ball; origin at the hand, hangs along -y
  if (L.weapon === 'sling') {
    G.sling = merge([
      part(T.cyl, 'cloth', 0x8a6a40, { pos: [0, -0.17, 0], scl: [0.013, 0.34, 0.013] }),
      part(T.sphere, 'cloth', 0x5a3a20, { pos: [0, -0.36, 0], scl: [0.08, 0.05, 0.08] }),
      part(T.sphere, 'plain', 0x5a3e24, { pos: [0, -0.33, 0], scl: [0.07, 0.07, 0.07] }),
    ]);
  }

  // --- riveted iron cauldron around the belly (two halves that crack apart)
  if (L.cauldron) G.cauldron = cauldronGeometry(L, r);

  // --- boss chest plate (front lathe patch with rivets)
  if (L.chestPlate) G.plate = plateGeometry(L);

  // --- boss belly glow shell (additive overlay)
  if (L.bellyGlow) {
    const g = new THREE.SphereGeometry(1, 22, 14, Math.PI * 0.5 - 1.05, 2.1, Math.PI * 0.56, Math.PI * 0.38);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      bodyDeform(p.getX(i), p.getY(i), p.getZ(i), tmp);
      p.setXYZ(i, tmp.x * W * 1.035, tmp.y * H * 1.03 + BY, tmp.z * D * 1.04);
    }
    g.computeVertexNormals();
    G.bellyGlow = g;
  }

  G.dims.shoulder = [W * 0.97, BY + H * 0.05, 0.05];
  G.dims.foot = [W * 0.52, 0, 0.06];
  return G;
}

function clubParts(L, at, tilt, s) {
  // club along +y from the grip, then rotated so it points forward-down from the hand
  const ps = [
    part(T.cyl, 'wood', 0xffffff, { pos: [0, 0.1 * s, 0], scl: [0.042 * s, 0.42 * s, 0.042 * s] }),
    part(new THREE.CylinderGeometry(1, 0.55, 1, 9), 'wood', 0xe8dcc8, { pos: [0, 0.5 * s, 0], scl: [0.12 * s, 0.42 * s, 0.12 * s] }),
    part(T.sphere, 'wood', 0xe8dcc8, { pos: [0, 0.71 * s, 0], scl: [0.12 * s, 0.06 * s, 0.12 * s] }),
    part(new THREE.TorusGeometry(1, 0.35, 5, 10), 'burlap', 0xffffff, { pos: [0, -0.02 * s, 0], rot: [Math.PI / 2, 0, 0], scl: [0.05 * s, 0.05 * s, 0.05 * s] }),
    part(new THREE.TorusGeometry(1, 0.35, 5, 10), 'burlap', 0xffffff, { pos: [0, 0.07 * s, 0], rot: [Math.PI / 2, 0, 0], scl: [0.05 * s, 0.05 * s, 0.05 * s] }),
  ];
  for (let k = 0; k < 6; k++) {
    const a = k * 2.1, y = 0.42 + (k % 3) * 0.1;
    const rr = 0.1 + (y - 0.29) * 0.05;
    ps.push(part(T.cone, 'iron', 0xffffff, { pos: [Math.sin(a) * rr * s, y * s, Math.cos(a) * rr * s], rot: [Math.cos(a) * Math.PI / 2, 0, -Math.sin(a) * Math.PI / 2], scl: [0.02 * s, 0.08 * s, 0.02 * s] }));
  }
  return reorient(ps, at, tilt);
}

function logParts(L, at, tilt) {
  // a whole tree trunk: bark, iron bands, stubby branch and spikes
  const ps = [
    part(new THREE.CylinderGeometry(1, 0.62, 1, 12, 3), 'bark', 0xffffff, { pos: [0, 0.55, 0], scl: [0.2, 1.3, 0.2] }),
    part(T.sphere, 'bark', 0xd8c8b0, { pos: [0, 1.2, 0], scl: [0.2, 0.07, 0.2] }),
    part(T.cyl, 'wood', 0xffffff, { pos: [0, -0.05, 0], scl: [0.07, 0.35, 0.07] }),
    part(new THREE.TorusGeometry(1, 0.18, 5, 14), 'iron', 0xc0c8d0, { pos: [0, 0.75, 0], rot: [Math.PI / 2, 0, 0], scl: [0.185, 0.185, 0.185] }),
    part(new THREE.TorusGeometry(1, 0.18, 5, 14), 'iron', 0xc0c8d0, { pos: [0, 1.05, 0], rot: [Math.PI / 2, 0, 0], scl: [0.198, 0.198, 0.198] }),
    part(T.cyl, 'bark', 0xffffff, { pos: [0.16, 0.5, 0], rot: [0, 0, -1.0], scl: [0.04, 0.22, 0.04] }),
    part(T.sphere, 'skin', 0x6f9a3a, { pos: [0.24, 0.58, 0], scl: [0.07, 0.05, 0.07] }), // tuft of moss
  ];
  for (let k = 0; k < 7; k++) {
    const a = k * 1.7, y = 0.8 + (k % 3) * 0.13;
    const rr = 0.19;
    ps.push(part(T.cone, 'iron', 0xffffff, { pos: [Math.sin(a) * rr, y, Math.cos(a) * rr], rot: [Math.cos(a) * Math.PI / 2, 0, -Math.sin(a) * Math.PI / 2], scl: [0.03, 0.12, 0.03] }));
  }
  return reorient(ps, at, tilt);
}

/** Rotate a weapon (built along +y) about x by `tilt` and move it to `at`. */
function reorient(ps, at, tilt) {
  _m4.compose(_t.set(at[0], at[1], at[2]), _q.setFromEuler(_e.set(tilt, 0, 0)), _s.set(1, 1, 1));
  for (const p of ps) p.applyMatrix4(_m4);
  return ps;
}

function helmetGeometry(L, r) {
  const R = L.potR, Hh = L.potH;
  const pot = new THREE.CylinderGeometry(R * 0.9, R, Hh, 20, 3, false);
  pot.translate(0, Hh / 2, 0);
  // dents
  const p = pot.attributes.position;
  const dents = [];
  for (let k = 0; k < 4; k++) dents.push([r() * Math.PI * 2, r() * Hh, 0.025 + r() * 0.03]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rad = Math.hypot(x, z);
    if (rad < R * 0.5) { // top cap: a shallow dent
      p.setY(i, y - 0.02 * (1 - rad / (R * 0.5)) * (L.potDent ?? 1));
      continue;
    }
    const a = Math.atan2(x, z);
    let push = 0;
    for (const [da, dy, dd] of dents) {
      const dA = Math.atan2(Math.sin(a - da), Math.cos(a - da));
      const f = Math.exp(-(dA * dA) / 0.12 - ((y - dy) * (y - dy)) / 0.006);
      push += dd * f;
    }
    const k = 1 - (push * (L.potDent ?? 1)) / rad;
    p.setXYZ(i, x * k, y, z * k);
  }
  pot.computeVertexNormals();
  const ps = [part(pot, 'iron', L.potColor ?? 0xffffff)];
  pot.dispose();
  const rim = new THREE.TorusGeometry(R, 0.024 * (R / 0.28), 6, 24);
  ps.push(part(rim, 'iron', 0xd8e0e8, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.01, 0] }));
  rim.dispose();
  // saucepan handle sticking out sideways, with a hanging hole
  const hl = R * 1.45;
  ps.push(part(T.box, 'iron', 0xc8d0d8, { pos: [-(R + hl / 2 - 0.03), 0.05, 0], rot: [0, 0, -0.22], scl: [hl, 0.028 * (R / 0.28), 0.06 * (R / 0.28)] }));
  const hole = new THREE.TorusGeometry(0.03 * (R / 0.28), 0.011 * (R / 0.28), 5, 10);
  ps.push(part(hole, 'plain', 0x3a3f48, { pos: [-(R + hl - 0.06), 0.05 + Math.sin(0.22) * hl * 0.5, 0], rot: [Math.PI / 2, 0, 0] }));
  hole.dispose();
  if (L.crown) {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      ps.push(part(T.cone, 'brass', 0xffffff, { pos: [Math.sin(a) * R * 0.86, Hh + 0.07, Math.cos(a) * R * 0.86], rot: [Math.cos(a) * -0.18, 0, Math.sin(a) * 0.18], scl: [0.05, 0.16, 0.05] }));
    }
    const band = new THREE.TorusGeometry(R * 0.95, 0.03, 5, 26);
    ps.push(part(band, 'brass', 0xffffff, { rot: [Math.PI / 2, 0, 0], pos: [0, Hh * 0.75, 0] }));
    band.dispose();
  }
  return merge(ps);
}

function cauldronGeometry(L, r) {
  const W = L.W, H = L.H, D = L.D, BY = L.bodyY;
  const y0 = BY - H * 0.62, y1 = BY + H * 0.22;
  const prof = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const y = lerp(y0, y1, t);
    const bulge = Math.sin(t * Math.PI);
    prof.push(new THREE.Vector2(W * (1.06 + 0.12 * bulge), y));
  }
  const halves = [];
  for (const side of [0, 1]) {
    const phi0 = side ? Math.PI : 0;
    const shell = new THREE.LatheGeometry(prof, 14, phi0, Math.PI);
    const sp = shell.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setZ(i, sp.getZ(i) * (D / W) * 1.02);
    shell.computeVertexNormals();
    const ps = [part(shell, 'iron', 0x8c8986)];
    shell.dispose();
    for (const [y, rr] of [[y0, W * 1.06], [y1, W * 1.06]]) {
      const rim = new THREE.TorusGeometry(1, 0.045, 6, 16, Math.PI);
      // torus arc lies in XY from +x; lay it flat (XZ) and turn it to cover this half
      rim.rotateX(Math.PI / 2);
      rim.rotateY(side ? -Math.PI / 2 : Math.PI / 2);
      const rp = rim.attributes.position;
      for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * rr, rp.getY(i) * 0.9, rp.getZ(i) * rr * (D / W) * 1.02);
      rim.computeVertexNormals();
      ps.push(part(rim, 'iron', 0x4e5056, { pos: [0, y, 0] }));
      rim.dispose();
    }
    // rivets in two rows
    for (const row of [0.3, 0.7]) {
      const y = lerp(y0, y1, row);
      const rr = W * (1.06 + 0.12 * Math.sin(row * Math.PI)) + 0.012;
      for (let k = 0; k < 7; k++) {
        const a = phi0 + ((k + 0.5) / 7) * Math.PI;
        ps.push(part(T.sphereLo, 'iron', 0xd0ccc4, { pos: [Math.sin(a) * rr, y, Math.cos(a) * rr * (D / W) * 1.02], scl: [0.032, 0.032, 0.032] }));
      }
    }
    // side loop handle
    const sx = side ? -1 : 1;
    const loop = new THREE.TorusGeometry(0.09, 0.022, 5, 12);
    ps.push(part(loop, 'iron', 0x4e5056, { pos: [sx * (W * 1.2), lerp(y0, y1, 0.55), 0], rot: [0, Math.PI / 2, 0] }));
    loop.dispose();
    halves.push(merge(ps));
  }
  void r;
  return halves;
}

function plateGeometry(L) {
  const W = L.W, H = L.H, D = L.D, BY = L.bodyY;
  const py = L.plateY || [-0.42, -0.04];
  const y0 = BY + H * py[0], y1 = BY + H * py[1];
  const prof = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6, y = lerp(y0, y1, t);
    const uy = (y - BY) / H;
    const u = uy > 0 ? uy / 0.88 : uy;
    const ring = Math.sqrt(Math.max(0.05, 1 - u * u)) * (1 + 0.13 * smoothstep(0.25, -0.7, uy));
    prof.push(new THREE.Vector2(W * ring * 1.08 + 0.02, y));
  }
  const span = L.plateSpan ?? 1.35;
  const g = new THREE.LatheGeometry(prof, 12, -span / 2, span);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (D / W) * 1.14);
  g.computeVertexNormals();
  const ps = [part(g, 'iron', 0x8c96a2)];
  g.dispose();
  // rivets along the border
  for (let k = 0; k <= 8; k++) {
    const a = -span / 2 + (k / 8) * span;
    for (const t of [0.08, 0.92]) {
      const y = lerp(y0, y1, t);
      const pr = prof[Math.round(t * 6)].x + 0.012;
      ps.push(part(T.sphereLo, 'iron', 0xe8eef4, { pos: [Math.sin(a) * pr, y, Math.cos(a) * pr * (D / W) * 1.14], scl: [0.022, 0.022, 0.022] }));
    }
  }
  // embossed crest: two crossed bars
  const cy = lerp(y0, y1, 0.5), cr = prof[3].x * (D / W) * 1.14 + 0.015;
  ps.push(part(T.box, 'iron', 0xc8d0d8, { pos: [0, cy, cr], rot: [0, 0, 0.7], scl: [0.26, 0.035, 0.02] }));
  ps.push(part(T.box, 'iron', 0xc8d0d8, { pos: [0, cy, cr], rot: [0, 0, -0.7], scl: [0.26, 0.035, 0.02] }));
  return merge(ps);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
const kitCache = new WeakMap();

/** Per-ctx shared resources (atlas texture, geometry cache). */
export function getModelKit(ctx) {
  let k = kitCache.get(ctx);
  if (!k) {
    const atlas = ctx.materials.canvasTexture(AT, AT, drawAtlas);
    atlas.anisotropy = 4;
    k = { atlas, geos: new Map() };
    kitCache.set(ctx, k);
  }
  return k;
}

/**
 * Build a toad bandit. Returns refs to every animated part:
 * { root, rig, pivot, inner, bodyMesh, lidL, lidR, armL, armR, footL, footR, helmet, helmetPivot,
 *   mouthOpen, sling?, slingPivot?, cauldron?: [L, R], plate?, bellyGlow?, material, hulls, dims }
 */
export function buildToad(ctx, L) {
  const M = ctx.materials;
  const kit = getModelKit(ctx);
  let G = kit.geos.get(L.id);
  if (!G) {
    G = buildGeometries(L);
    kit.geos.set(L.id, G);
  }
  const mat = M.toon(0xffffff, { map: kit.atlas, vertexColors: true, side: THREE.DoubleSide });
  const ot = L.outline ?? 0.022;
  const hulls = [], hullsSmall = [];
  const outline = (mesh, t = ot, small = false) => { const h = M.outline(mesh, t); (small ? hullsSmall : hulls).push(h); return h; };
  const mesh = (geo, parent, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group(); root.name = L.id;
  const rig = new THREE.Group(); rig.scale.setScalar(L.scale || 1); root.add(rig);
  const PIV = 0.2;
  const pivot = new THREE.Group(); pivot.position.y = PIV; rig.add(pivot);
  const inner = new THREE.Group(); inner.position.y = -PIV; pivot.add(inner);

  const bodyMesh = mesh(G.body, inner, true);
  outline(bodyMesh);

  // lids
  const lids = G.dims.eyes.map((e, i) => {
    const lid = mesh(G.lid, inner);
    lid.position.set(e[0], e[1], e[2]);
    lid.rotation.order = 'YXZ';
    lid.rotation.y = (i === 0 ? -1 : 1) * 0.28;
    return lid;
  });

  // arms
  const sh = G.dims.shoulder;
  const armL = mesh(G.armL, inner, false);
  armL.position.set(sh[0], sh[1], sh[2]);
  const armR = mesh(G.armR, inner, L.weapon === 'log' || L.weapon === 'club');
  armR.position.set(-sh[0], sh[1], sh[2]);
  outline(armL, ot * 0.8, true); outline(armR, ot * 0.8, L.weapon !== 'log');

  // feet (children of the rig: they stay planted while the body leans)
  const fd = G.dims.foot;
  const footL = mesh(G.foot, rig); footL.position.set(fd[0], 0, fd[2]); footL.rotation.y = 0.35;
  const footR = mesh(G.foot, rig); footR.position.set(-fd[0], 0, fd[2]); footR.rotation.y = -0.35;
  outline(footL, ot * 0.8, true); outline(footR, ot * 0.8, true);

  // helmet pivot sits on the crown
  const ht = G.dims.headTop;
  const helmetPivot = new THREE.Group();
  helmetPivot.position.set(ht[0], ht[1] - (L.potSink ?? 0.06), ht[2]);
  helmetPivot.rotation.set(L.potTilt?.[0] ?? -0.25, L.potTilt?.[1] ?? 0.6, L.potTilt?.[2] ?? 0.12);
  inner.add(helmetPivot);
  const helmet = mesh(G.helmet, helmetPivot, true);
  outline(helmet, ot * 0.8);

  // open mouth (hidden until used)
  const mouthOpen = mesh(G.mouthOpen, inner);
  const md = G.dims.mouth;
  mouthOpen.position.set(md[0], md[1] - 0.012, md[2] - 0.05 * (L.noseScale || 1));
  mouthOpen.scale.y = 0.001;
  mouthOpen.visible = false;

  const out = {
    root, rig, pivot, inner, bodyMesh, lidL: lids[0], lidR: lids[1], armL, armR, footL, footR,
    helmet, helmetPivot, mouthOpen, material: mat, hulls, hullsSmall, dims: G.dims, look: L,
    footBase: [fd[0], fd[2]],
  };

  if (G.sling) {
    const slingPivot = new THREE.Group();
    slingPivot.position.set(0, -L.armLen - L.handR * 0.4, 0.02);
    slingPivot.rotation.order = 'YXZ';
    armR.add(slingPivot);
    out.sling = mesh(G.sling, slingPivot);
    out.slingPivot = slingPivot;
  }
  if (G.cauldron) {
    out.cauldron = G.cauldron.map((g) => { const m = mesh(g, inner, true); outline(m, ot * 0.8); return m; });
  }
  if (G.plate) {
    const platePivot = new THREE.Group(); inner.add(platePivot);
    out.plate = mesh(G.plate, platePivot, true);
    outline(out.plate, ot * 0.8);
    out.platePivot = platePivot;
  }
  if (G.bellyGlow) {
    const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(L.glowColor ?? 0xffc35a).multiplyScalar(2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(G.bellyGlow, gm);
    glow.visible = false;
    inner.add(glow);
    out.bellyGlow = glow;
  }
  if (L.lod !== false) out.lod = buildLods(ctx, out, G, mat, ot);
  return out;
}

// ---------------------------------------------------------------------------
// Distance LOD (integration performance pass). A bandit up close is ~8 meshes + outline hulls +
// shadow casters (14-17 draw calls). Two merged rest-pose meshes, built once per look and shared:
//   mid: body + lids + pot (+ cauldron while armoured) as ONE mesh with one hull; arms and feet stay
//        separate and keep animating (walk cycle, club swing, sling spin read fine at this range)
//   far: the whole toad (arms, feet, weapon / sling included) as ONE static mesh, no hull
// Bandit.updateLook() picks the level by camera distance (see setLod in common.js).
// ---------------------------------------------------------------------------
const _lodInv = new THREE.Matrix4();
const _lodM = new THREE.Matrix4();
function bakeParts(meshes, frame) {
  frame.updateMatrixWorld(true);
  _lodInv.copy(frame.matrixWorld).invert();
  const parts = [];
  for (const m of meshes) {
    if (!m) continue;
    m.updateMatrixWorld(true);
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(_lodM.multiplyMatrices(_lodInv, m.matrixWorld));
    parts.push(g);
  }
  return merge(parts);
}

function buildLods(ctx, m, G, mat, ot) {
  if (!G.lod) {
    // rest pose (POSE_DEFAULT in common.js): sleepy lids, arms hanging out a little
    const save = [m.lidL.rotation.x, m.lidR.rotation.x, m.armL.rotation.clone(), m.armR.rotation.clone()];
    m.lidL.rotation.x = m.lidR.rotation.x = -0.22;
    m.armL.rotation.set(0.1, 0, 0.42); m.armR.rotation.set(0.1, 0, -0.42);
    m.root.updateMatrixWorld(true);
    const mid = [m.bodyMesh, m.lidL, m.lidR, m.helmet];
    const far = [...mid, m.armL, m.armR, m.sling, m.footL, m.footR];
    const armour = m.cauldron || [];
    G.lod = {
      mid: bakeParts(mid, m.inner), far: bakeParts(far, m.inner),
      midArmour: armour.length ? bakeParts([...mid, ...armour], m.inner) : null,
      farArmour: armour.length ? bakeParts([...far, ...armour], m.inner) : null,
    };
    m.lidL.rotation.x = save[0]; m.lidR.rotation.x = save[1]; m.armL.rotation.copy(save[2]); m.armR.rotation.copy(save[3]);
  }
  const M = ctx.materials;
  const make = (geo, hull) => {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.visible = false;
    m.inner.add(mesh);
    if (hull) m.hulls.push(M.outline(mesh, ot));
    return mesh;
  };
  return {
    level: 0,
    mid: make(G.lod.mid, true), far: make(G.lod.far, false),
    midArmour: make(G.lod.midArmour, true), farArmour: make(G.lod.farArmour, false),
  };
}

// Low-level helpers for other enemy props (the boss's throne): part(template, region, colour, opts), merge(parts), T templates.
export { part, merge, T as TEMPLATES };
