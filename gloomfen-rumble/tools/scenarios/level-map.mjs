// Top-down layout map of the level heightfield (node only, no browser).
//   node tools/scenarios/level-map.mjs [out.png] [pxPerMetre]
// Colours: water blue (by depth), ground green->grey by height with hillshade, steep = dark,
// structures (white outlines), spawns (dots), route (orange). Two halves side by side: z -48..212 | 212..472.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { TERRAIN, STRUCTURES, SPAWNS, ROUTE, BOG } from '../../src/game/level/data.js';
import { createHeightfield } from '../../src/game/level/terrain.js';

const out = process.argv[2] || 'dist/dev-level/map.png';
const S = Number(process.argv[3] || 2);
const t0 = Date.now();
const hf = createHeightfield(TERRAIN);
const tBuild = Date.now() - t0;
const { x0, x1, z0, z1 } = hf.grid;
const half = (z1 - z0) / 2;
const W = Math.round((x1 - x0) * S) * 2 + 8, H = Math.round(half * S);
const img = new Uint8Array(W * H * 3);
const put = (px, py, r, g, b) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const i = (py * W + px) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; };
const toPx = (x, z) => { const panel = z < z0 + half ? 0 : 1; const zz = z - z0 - panel * half; return [Math.round((x - x0) * S) + panel * (Math.round((x1 - x0) * S) + 8), H - 1 - Math.round(zz * S)]; };
const n = { x: 0, y: 1, z: 0 };
for (let panel = 0; panel < 2; panel++) {
  for (let py = 0; py < H; py++) for (let qx = 0; qx < Math.round((x1 - x0) * S); qx++) {
    const x = x0 + qx / S, z = z0 + panel * half + (H - 1 - py) / S;
    const h = hf.sample(x, z); hf.normal(x, z, n);
    let r, g, b;
    if (h < 0) { const d = Math.min(1, -h / 2.5); r = 30 - 15 * d; g = 80 - 40 * d; b = 120 - 30 * d; }
    else {
      const t = Math.min(1, h / 16);
      r = 70 + 110 * t; g = 130 + 60 * t; b = 60 + 110 * t;
      const shade = 0.55 + 0.45 * Math.max(0, n.x * -0.5 + n.y * 0.7 + n.z * 0.5);
      r *= shade; g *= shade; b *= shade;
      if (n.y < 0.643) { r *= 0.45; g *= 0.4; b *= 0.45; }
      if (h < 0.3) { r = 110; g = 90; b = 60; }
      // contour every 1 m
      if (Math.abs(h - Math.round(h)) < 0.04 * (1 + (1 - n.y) * 6)) { r *= 0.85; g *= 0.85; b *= 0.85; }
    }
    put(qx + panel * (Math.round((x1 - x0) * S) + 8), py, r, g, b);
  }
}
const rectO = (ax, az, bx, bz, c) => { for (let x = ax; x <= bx; x += 0.5 / S) { put(...toPx(x, az), ...c); put(...toPx(x, bz), ...c); } for (let z = az; z <= bz; z += 0.5 / S) { put(...toPx(ax, z), ...c); put(...toPx(bx, z), ...c); } };
const dot = (x, z, c, r = 1) => { const [px, py] = toPx(x, z); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) put(px + dx, py + dy, ...c); };
// route
for (let i = 0; i < ROUTE.length - 1; i++) { const [ax, az] = ROUTE[i], [bx, bz] = ROUTE[i + 1]; const L = Math.hypot(bx - ax, bz - az); for (let t = 0; t <= L; t += 0.3) dot(ax + (bx - ax) * t / L, az + (bz - az) * t / L, [255, 150, 40], 0); }
for (const s of STRUCTURES) {
  const W2 = [255, 255, 255];
  if (s.min) rectO(s.min[0], s.min[2], s.max[0], s.max[2], W2);
  else if (s.kind === 'stump' || s.kind === 'pillar') { const h2 = s.r * 0.72; rectO(s.x - h2, s.z - h2, s.x + h2, s.z + h2, W2); }
  else if (s.kind === 'palisade') { const [ax, az] = s.from, [bx, bz] = s.to; const th = (s.thick || 1) / 2; rectO(Math.min(ax, bx) - th, Math.min(az, bz) - th, Math.max(ax, bx) + th, Math.max(az, bz) + th, [230, 200, 150]); }
  else if (s.kind === 'tower') { rectO(s.x - s.size / 2, s.z - s.size / 2, s.x + s.size / 2, s.z + s.size / 2, [255, 220, 120]); }
  else if (s.kind === 'crates') for (const [dx, dz] of s.layout) rectO(s.x + dx - 0.6, s.z + dz - 0.6, s.x + dx + 0.6, s.z + dz + 0.6, [200, 160, 100]);
  else if (s.kind === 'bridge') rectO(s.x - s.width / 2, s.z0, s.x + s.width / 2, s.z1, [220, 180, 120]);
  else if (s.x !== undefined && s.z !== undefined) dot(s.x, s.z, [255, 255, 255], 2);
}
const colors = { grunt: [255, 60, 60], slinger: [255, 120, 200], ironbelly: [160, 160, 255], glowcap: [90, 255, 240], glowcapLine: [90, 255, 240], glowcapRing: [90, 255, 240], cage: [255, 255, 0], berry: [255, 0, 120], tonic: [120, 255, 120], checkpoint: [255, 255, 255], sinkingPad: [100, 200, 60], movingPlatform: [200, 140, 60], bounceShroom: [255, 80, 255], sign: [255, 200, 120], hazard: [120, 0, 120], boss: [255, 0, 0], lanternGate: [255, 200, 0] };
const glow = [];
for (const s of SPAWNS) {
  const c = colors[s.type]; if (!c) continue;
  if (s.type === 'glowcapLine') { for (let k = 0; k < s.count; k++) { const t = s.count > 1 ? k / (s.count - 1) : 0; glow.push([s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t, s.from[2] + (s.to[2] - s.from[2]) * t]); } continue; }
  if (s.type === 'glowcapRing') { for (let k = 0; k < s.count; k++) { const a = k / s.count * Math.PI * 2; glow.push([s.pos[0] + Math.cos(a) * s.radius, s.pos[1], s.pos[2] + Math.sin(a) * s.radius]); } continue; }
  if (s.type === 'glowcap') { glow.push(s.pos); continue; }
  if (s.type === 'movingPlatform') { for (const p of s.path) dot(p[0], p[2], c, 2); continue; }
  dot(s.pos[0], s.pos[2], c, s.type === 'checkpoint' ? 3 : 1);
}
for (const g of glow) dot(g[0], g[2], [90, 255, 240], 0);
// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = img[y * W * 3 + x]; }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
// glowcap height check
const gh = (x, z) => hf.sample(x, z);
const bad = glow.filter(([x, y, z]) => { const d = y - gh(x, z); return d < 0.4; }).map((g) => [g, +(g[1] - gh(g[0], g[2])).toFixed(2)]);
console.log(JSON.stringify({ out, size: [W, H], heightfieldMs: tBuild, glowcaps: glow.length, glowcapsBelowGround: bad }));
