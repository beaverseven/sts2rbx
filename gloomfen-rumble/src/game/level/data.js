// Gloomfen — the one long level. Pure data (no three.js / DOM) so tools can import it.
// Progress runs along +Z. Bog water at y = 0. Four zones:
//   glade (z -15..110)  bog (110..250)  fort (250..360)  pit (360..430)
//
// Sections:
//   TERRAIN     heightfield features (terrain.js composes them in order)
//   STRUCTURES  static colliders + their visuals (props.js builds each `kind`)
//   SPAWNS      entity spawn defs (ctx.entities.spawn); pos[1] === null -> snapped to the ground
//   ZONES, CHECKPOINTS, ROUTE (main-route spine for paths/decor exclusion/docs)
//
// Movement numbers this layout is built against (docs/core.md): running jump 5.4 m flat,
// max ledge 2.0 m (comfortable <= 1.7), running jump + glide 9.2 m flat, glide ~3.1 m per
// metre of drop, step-up 0.35 m, bounce launch v -> rise v^2/64 m.
// Note on terrain islands: a circle of radius r with edge e stays walkable (>= 0.3 m above
// water) out to about r + 0.42 e, safe-respawn ground (>= 0.8 m) to about r + 0.3 e.
import { fbm } from './terrain.js';

const P = (name, pts, o = {}) => ({ name, shape: 'path', pts, ...o });
const RECT = (name, x0, z0, x1, z1, y, o = {}) => ({ name, shape: 'rect', x0, z0, x1, z1, y, ...o });
const CIRC = (name, x, z, r, y, o = {}) => ({ name, shape: 'circle', x, z, r, y, ...o });

export const WATER_LEVEL = 0;

// ---------------------------------------------------------------------------
// Key coordinates (other areas rely on PIT; the rest keeps data consistent)
// ---------------------------------------------------------------------------
export const PIT = { x: 0, y: 2, z: 395, r: 22, wallInner: 22.05, wallOuter: 23.2, wallTop: 7.4, entranceZ: 373, gateZ: 372.4, gapHalf: 3.2 };
export const FORT_Y = 7;

// Sunken Bog main route (all z values derive from these)
export const BOG = {
  stumps: [[1.0, 123.0, 1.15, 1.9], [-1.5, 127.4, 1.1, 2.3], [1.0, 131.8, 1.15, 1.9], [-1.2, 136.2, 1.1, 2.5], [1.0, 140.6, 1.15, 2.1]], // x, z, r, top
  b2z: 151,                                   // island B2 (y 1.5), rx 7.2 rz 6.2
  pads: [[0, 160.5], [-1.4, 164.0], [0.6, 167.5], [-1.0, 171.0], [0, 174.5]],   // sinking lily pads, top 0.36 (must be > 0.3: core counts
  //   an airborne Morel below waterLevel + 0.3 as fallen in, so lower landing surfaces are unreliable)
  b3z: 181.5,                                 // island B3 (y 1.25), r 3.7
  raftA: [[0, 0.42, 188.6], [0, 0.42, 197.0]],
  stumpT: [0, 201.0, 1.9, 1.3],               // wide stump platform
  raftB: [[-1.2, 0.42, 205.3], [7.0, 0.42, 205.3]],
  b4: [9, 214.6],                             // island B4 (y 1.5) at the cliff foot, rx 5.2 rz 6
  raftC: [[10.2, 0.42, 153], [14.8, 0.42, 153]], // optional, to island E1 (cage C4)
};

// ---------------------------------------------------------------------------
// TERRAIN
// ---------------------------------------------------------------------------
export const TERRAIN = {
  grid: { x0: -72, x1: 72, z0: -48, z1: 472, cell: 1 },
  // Everything outside the carved playable areas is high boundary country that keeps
  // rising toward the grid edge (so the mesh edge is never visible from the route).
  base(x, z) {
    const side = Math.max(0, Math.abs(x) - 24);
    const ends = Math.max(0, -16 - z) + Math.max(0, z - 426);
    return 14.5 + side * 0.34 + ends * 0.4 + 8 * (fbm(x * 0.021 + 5.3, z * 0.021 - 1.7) - 0.45);
  },
  baseRough: 2.4,
  features: [
    // ---------------- GLADE ----------------
    P('meadow', [[0, -13, 3, 12], [1, 4, 3, 17], [-1, 18, 3, 15.5], [0, 26.5, 3, 9]], { edge: 6, rough: 0.16 }),
    CIRC('startPond', -15.5, -5, 3.2, -1.4, { edge: 2.2, rough: 0.3 }),
    // fern meadow sits 1.2 m higher; the step is hidden inside the stone ledge (z 28.8..31.6)
    P('fernMeadow', [[0, 30, 4.2, 8.5], [-2, 40, 4.2, 16], [0, 51, 4.2, 16.5], [1, 59, 4.2, 12]], { edge: 6, rough: 0.16, clip: { zmin: 29.7, edge: 0.4 } }),
    P('ridge', [[1, 58, 4.2, 11], [0, 66, 5.3, 10], [0, 75, 6.5, 11]], { edge: 6, rough: 0.12, clip: { zmin: 57 } }),
    P('landing', [[0, 85, 5, 13], [2, 95, 5, 15.5], [0, 105, 5, 12]], { edge: 6, rough: 0.16, clip: { zmin: 80, edge: 0.3 } }),
    // the ravine: ~10 m glide gap (flat edge z~75 -> landing z~85), landing 1.5 m lower
    RECT('ravine', -26, 76.2, 26, 83.8, -2.4, { edge: 1.25, rough: 0.5 }),
    P('shore', [[0, 103, 5, 11], [0, 112, 3.1, 12.5], [0, 119, 1.4, 13]], { edge: 5, rough: 0.14, clip: { zmin: 103 } }),

    // ---------------- BOG ----------------
    RECT('bogWater', -46, 121, 46, 222, -1.7, { edge: 2.6, rough: 0.45 }),
    CIRC('islandB2', 0, BOG.b2z, 7, 1.5, { rx: 7.2, rz: 6.2, edge: 2.1, rough: 0.12 }),
    CIRC('islandB2w', -6.5, BOG.b2z - 2.5, 3.8, 1.5, { edge: 2.0, rough: 0.12 }),
    CIRC('islandB3', 0, BOG.b3z, 3.7, 1.25, { edge: 2.8, rough: 0.08 }),
    CIRC('islandB4', BOG.b4[0], BOG.b4[1], 5, 1.5, { rx: 5.2, rz: 6, edge: 2.6, rough: 0.1 }),
    CIRC('islandE1', 23.5, BOG.b2z + 3, 5.2, 1.8, { edge: 2.2, rough: 0.15 }),
    CIRC('islandW1', -23, 133, 5.5, 1.7, { edge: 2.4, rough: 0.25 }),
    CIRC('islandW2', -25, 193, 6, 1.9, { edge: 2.4, rough: 0.25 }),
    CIRC('islandE2', 27, 199, 5, 1.7, { edge: 2.4, rough: 0.25 }),
    CIRC('islandW3', -17, 170, 2.6, 1.3, { edge: 1.6, rough: 0.15 }),
    CIRC('islandE3', 18, 133, 2.8, 1.4, { edge: 1.6, rough: 0.15 }),
    // cliff (y 1.5 -> 9 at z ~219.4..222) and the plateau above it
    RECT('plateau', -31, 222, 31, 247, 9, { edge: 2.6, rough: 0.14 }),
    P('plateauDown', [[0, 244, 9, 14], [0, 257, 7, 13]], { edge: 5, rough: 0.1, clip: { zmin: 244 } }),

    // ---------------- FORT (y 7) ----------------
    RECT('moat', -38, 258.6, 38, 267.2, -2.4, { edge: 1.4, rough: 0.5 }),
    RECT('fortOuter', -30.3, 262, 30.3, 306, FORT_Y, { edge: 4, rough: 0.08, paint: 'dirt', paintAmount: 0.92, clip: { zmin: 268.1, edge: 0.4 } }),
    RECT('fortInner', -15.5, 300, 15.5, 346, FORT_Y, { edge: 4, rough: 0.08, paint: 'dirt', paintAmount: 0.92 }),

    // ---------------- PIT ----------------
    CIRC('pitRim', 0, 395, 27.5, 7.2, { edge: 4, rough: 0.15 }),
    P('gorge', [[0, 346, 7, 4.2], [0, 353, 7, 4.6], [0, 365, 4, 4.2], [0, 375, 2, 3.9]], { edge: 2.4, rough: 0.08, paint: 'dirt', paintAmount: 0.6, clip: { zmin: 345 } }),
    // flat floor r 23 (the stone wall's colliders stand on its rim, inner faces at r ~22.1)
    CIRC('pitFloor', 0, 395, 23.0, 2, { edge: 1.0, rough: 0, paint: 'dirt', paintAmount: 0.8, paintEdge: 0.5 }),

    // ---------------- worn footpath (paint only) ----------------
    P('pathGlade', [[0, -6, 0, 1.2], [1, 8, 0, 1.4], [0, 22, 0, 1.4], [0, 28, 0, 1.2]], { op: 'paint', paint: 'dirt', edge: 1.4, paintAmount: 0.85 }),
    P('pathGlade2', [[0, 32, 0, 1.2], [-2, 42, 0, 1.4], [0, 52, 0, 1.3], [1, 62, 0, 1.3], [0, 74.4, 0, 1.2]], { op: 'paint', paint: 'dirt', edge: 1.4, paintAmount: 0.85 }),
    P('pathLanding', [[0, 86, 0, 1.2], [1, 96, 0, 1.4], [0, 108, 0, 1.3], [0, 119, 0, 1.6]], { op: 'paint', paint: 'dirt', edge: 1.4, paintAmount: 0.85 }),
    P('pathPlateau', [[3, 222.5, 0, 1.3], [0, 232, 0, 1.4], [0, 245, 0, 1.4], [0, 256, 0, 1.6]], { op: 'paint', paint: 'dirt', edge: 1.4, paintAmount: 0.85 }),
    CIRC('pitSand', 0, 395, 13, 0, { op: 'paint', paint: 'sand', edge: 6, paintAmount: 0.55 }),
    { name: 'pitRing', shape: 'ring', x: 0, z: 395, r0: 8.6, r1: 9.6, y: 0, op: 'paint', paint: 'stone', edge: 0.4, paintAmount: 0.9 },
    { name: 'pitRing2', shape: 'ring', x: 0, z: 395, r0: 20.2, r1: 21.6, y: 0, op: 'paint', paint: 'stone', edge: 0.5, paintAmount: 0.75 },
  ],
};

// ---------------------------------------------------------------------------
// STRUCTURES — static colliders + visuals. y values are absolute.
// ---------------------------------------------------------------------------
// stump / pillar collider = inscribed square (half = r * 0.72)
const stump = (x, z, r, top, o = {}) => ({ kind: 'stump', x, z, r, top, ...o });

export const STRUCTURES = [
  // --- glade
  { kind: 'rockLedge', min: [-10, 0, 28.8], max: [10, 4.2, 31.6] },                 // tutorial jump (1.2 m)
  { kind: 'stoneStep', min: [-9.6, 3.4, 47.2], max: [-7.4, 5.6, 49.4] },            // optional climb to cage C1
  { kind: 'stoneStep', min: [-12.2, 3.4, 49.6], max: [-10.0, 7.0, 51.8] },
  { kind: 'pillar', x: -13.6, z: 54.2, r: 1.5, top: 8.4, base: 3.4 },              // cage C1
  { kind: 'brokenBridge', x: -6.5, z0: 75.0, z1: 85.0, y0: 6.5, y1: 5.0 },          // decor: "the bridge is out"
  { kind: 'pillar', x: 15.6, z: 95.5, r: 1.6, top: 9.6, base: 4.4 },               // cage C2 (bounce shroom BS3)
  { kind: 'waterfall', from: [-25, -7.5], to: [-16.5, -5.2], width: 3.0 },
  { kind: 'waterfall', from: [33.5, 80], to: [24.5, 80], width: 2.6 },

  // --- bog: stepping stumps (main route)
  ...BOG.stumps.map(([x, z, r, top]) => stump(x, z, r, top)),
  // slinger perches (tall stumps in the water)
  stump(9.0, 134.0, 1.35, 4.0, { tall: true }),
  stump(-9.5, 166.5, 1.35, 3.6, { tall: true }),
  // optional pillar with cage C3 (bounce shroom BS1 on island B2)
  { kind: 'pillar', x: -10.4, z: BOG.b2z + 4.6, r: 1.5, top: 7.2, base: -1.5 },
  // stump platform between raft A and raft B
  stump(BOG.stumpT[0], BOG.stumpT[1], BOG.stumpT[2], BOG.stumpT[3], { wide: true }),
  // bog watchtower (landmark beacon) on the plateau, platform y 17, open on the +x side
  { kind: 'tower', x: -7, z: 229, y: 9, height: 8, size: 3.4, beacon: true, roof: 3.2, open: 'px' },

  // --- fort: moat bridge (rope railings), walls, gatehouse, towers, crates
  { kind: 'bridge', x: 0, z0: 255.4, z1: 269.7, y: 7.15, width: 4.4 },
  { kind: 'palisade', from: [-34, 270.2], to: [-3.4, 270.2], y: FORT_Y, height: 5 },
  { kind: 'palisade', from: [3.4, 270.2], to: [34, 270.2], y: FORT_Y, height: 5 },
  { kind: 'gatePosts', x: 0, z: 270.2, y: FORT_Y, half: 3.4, height: 6.6, doors: 'open' },
  { kind: 'palisade', from: [-30.8, 270.8], to: [-30.8, 304], y: FORT_Y, height: 5 },
  { kind: 'palisade', from: [30.8, 270.8], to: [30.8, 304], y: FORT_Y, height: 5 },
  // inner wall with the iron-gate gatehouse (passage x -3..3, z 304..308)
  { kind: 'palisade', from: [-34, 305.2], to: [-4.6, 305.2], y: FORT_Y, height: 5.5, thick: 2.4 },
  { kind: 'palisade', from: [4.6, 305.2], to: [34, 305.2], y: FORT_Y, height: 5.5, thick: 2.4 },
  { kind: 'gatehouse', x: 0, z0: 304.0, z1: 308.0, y: FORT_Y, half: 3.0, height: 7 },
  // courtyard sides + exit wall, back yard, back wall
  { kind: 'palisade', from: [-16.0, 306.4], to: [-16.0, 347.1], y: FORT_Y, height: 5 },
  { kind: 'palisade', from: [16.0, 306.4], to: [16.0, 347.1], y: FORT_Y, height: 5 },
  { kind: 'palisade', from: [-15.5, 332.6], to: [-3.4, 332.6], y: FORT_Y, height: 5 },
  { kind: 'palisade', from: [3.4, 332.6], to: [15.5, 332.6], y: FORT_Y, height: 5 },
  { kind: 'gatePosts', x: 0, z: 332.6, y: FORT_Y, half: 3.4, height: 6.2, doors: 'none' },
  { kind: 'palisade', from: [-15.5, 346.6], to: [-3.8, 346.6], y: FORT_Y, height: 5 },
  { kind: 'palisade', from: [3.8, 346.6], to: [15.5, 346.6], y: FORT_Y, height: 5 },
  { kind: 'gatePosts', x: 0, z: 346.6, y: FORT_Y, half: 3.8, height: 6.6, doors: 'beam' },
  { kind: 'tower', x: -10, z: 274.5, y: FORT_Y, height: 5.5, size: 3.2, roof: 2.6 },
  { kind: 'tower', x: 10, z: 274.5, y: FORT_Y, height: 5.5, size: 3.2, roof: 2.6 },
  { kind: 'tower', x: -12.4, z: 342.2, y: FORT_Y, height: 5.5, size: 3.0, roof: 2.4 },
  { kind: 'tower', x: 12.4, z: 342.2, y: FORT_Y, height: 5.5, size: 3.0, roof: 2.4 },
  // crate piles (1.2 m crates; layout = [dx, dz, stackHeight]) — C6, C7, slinger perches, cover
  { kind: 'crates', x: -22, z: 291, y: FORT_Y, layout: [[0, 0, 1], [1.25, 0, 1], [0, 1.25, 2], [1.25, 1.25, 3]] },
  { kind: 'crates', x: 12.4, z: 312.4, y: FORT_Y, layout: [[0, 0, 1], [-1.25, 0, 2], [-1.25, 1.25, 3]] },
  { kind: 'crates', x: -11.5, z: 327.5, y: FORT_Y, layout: [[0, 0, 2], [1.25, 0, 1]] },
  { kind: 'crates', x: 11.5, z: 327.5, y: FORT_Y, layout: [[0, 0, 2], [-1.25, 0, 1]] },
  { kind: 'crates', x: -6, z: 316, y: FORT_Y, layout: [[0, 0, 1]] },
  { kind: 'crates', x: 5.5, z: 319.5, y: FORT_Y, layout: [[0, 0, 2]] },
  { kind: 'crates', x: 18, z: 279, y: FORT_Y, layout: [[0, 0, 1], [1.25, 0, 2], [0, 1.25, 1]] },
  // back-yard hut (cage C8 on its flat roof, reached via crates)
  { kind: 'hut', x: -11.5, z: 337.8, y: FORT_Y, w: 5, d: 3.4, h: 3.0 },
  { kind: 'crates', x: -7.6, z: 336.4, y: FORT_Y, layout: [[0, 0, 1], [0, 1.25, 2]] },
  { kind: 'tent', x: -20, z: 280, y: FORT_Y, yaw: 0.4 },
  { kind: 'tent', x: 22, z: 293, y: FORT_Y, yaw: -0.6 },
  { kind: 'campfire', x: 12, z: 285, y: FORT_Y },
  { kind: 'trophyPile', x: -9, z: 301.4, y: FORT_Y },
  { kind: 'trophyPile', x: 8.5, z: 330.6, y: FORT_Y, small: true },

  // --- pit
  { kind: 'pitWall', x: PIT.x, z: PIT.z, r: PIT.wallInner, thick: PIT.wallOuter - PIT.wallInner, y: PIT.y, top: PIT.wallTop, gapHalf: PIT.gapHalf },
  // the chief's trophy totem on a dais behind the back wall (the boss area builds his seat inside the pit)
  { kind: 'chiefTotem', x: 0, z: 420.2, y: 7.2 },
  // bandit clutter (barrels + sacks)
  { kind: 'barrels', x: -26.5, z: 276, y: FORT_Y, n: 3 }, { kind: 'barrels', x: 26, z: 277.5, y: FORT_Y, n: 2 },
  { kind: 'barrels', x: -26, z: 300.5, y: FORT_Y, n: 3 }, { kind: 'barrels', x: 25.5, z: 300, y: FORT_Y, n: 2 },
  { kind: 'barrels', x: -13.2, z: 319, y: FORT_Y, n: 2 }, { kind: 'barrels', x: 13.4, z: 321, y: FORT_Y, n: 2 },
  { kind: 'barrels', x: 13.2, z: 336.5, y: FORT_Y, n: 3 }, { kind: 'barrels', x: -4.2, z: 254.2, y: 7.35, n: 0, sacks: 3 },
];

// ---------------------------------------------------------------------------
// Decorative hero props (no colliders). Procedural scatter adds the rest.
// ---------------------------------------------------------------------------
export const LANTERNS = [
  [-2.6, -1], [2.8, 12], [-2.8, 27], [2.6, 33.5], [-3.0, 58], [2.8, 73.6], [-2.8, 86.4], [3.2, 100.5], [-3, 112],
  [3.0, 118.0], [2.8, BOG.b2z - 5.2], [-2.4, BOG.b2z + 5.2], [-2.4, BOG.b3z - 1.6], [2.4, BOG.b3z + 2.0],
  [6.2, 211.0], [3.6, 224.5], [-3, 238], [3.2, 254.2],
];
export const TORCHES = [
  // fort gate, yard, gatehouse, courtyard, back gate, gorge
  [-4.8, 268.9], [4.8, 268.9], [-4.4, 302.8], [4.4, 302.8], [-14.6, 310.5], [14.6, 310.5], [-14.6, 330.6], [14.6, 330.6],
  [-5.0, 345.3], [5.0, 345.3], [-3.6, 357.5], [3.5, 363.5], [-3.3, 369.5], [3.3, 369.5],
];
// banners on poles [x, z, yaw]
export const BANNERS = [
  [-6.0, 268.6, 0], [6.0, 268.6, 0], [-5.2, 302.9, 0], [5.2, 302.9, 0], [-14.8, 322, Math.PI / 2], [14.8, 322, -Math.PI / 2],
  [-7.5, 420.8, Math.PI], [7.5, 420.8, Math.PI], [-24, 290, Math.PI / 2], [24, 284, -Math.PI / 2],
];
export const PIT_TORCHES = 10;

// ---------------------------------------------------------------------------
// ROUTE — main-route spine (x, z). Used for decor exclusion and documentation.
// ---------------------------------------------------------------------------
export const ROUTE = [
  [0, 2], [0, 28], [0, 32], [-2, 42], [0, 52], [1, 62], [0, 75], [0, 85], [1, 96], [0, 108], [0, 119],
  ...BOG.stumps.map(([x, z]) => [x, z]), [0, 145], [0, BOG.b2z + 6],
  ...BOG.pads, [0, BOG.b3z], [0, 188.6], [0, 197], [0, 201], [-1.2, 205.3], [7, 205.3], [9, 210], [9, 219],
  [3, 223], [0, 240], [0, 256], [0, 270], [0, 304], [0, 308], [0, 332], [0, 346], [0, 373], [0, 395],
];

// ---------------------------------------------------------------------------
// CHECKPOINTS (in order). y is resolved to the ground at build time.
// ---------------------------------------------------------------------------
export const CHECKPOINTS = [
  { id: 'start', position: [0, 3, 2], yaw: 0 },
  { id: 'glade', position: [0, 5, 100], yaw: 0 },
  { id: 'bog', position: [0, 9, 239], yaw: 0 },
  { id: 'fort', position: [0, 7, 352], yaw: 0 },
  { id: 'pit', position: [0, 3.6, 366], yaw: 0 },
];

// ---------------------------------------------------------------------------
// ZONES
// ---------------------------------------------------------------------------
export const ZONES = [
  { id: 'glade', name: 'Mossy Glade', z0: -60, z1: 110, fog: 0x2a5a52, density: 0.0115 },
  { id: 'bog', name: 'Sunken Bog', z0: 110, z1: 250, fog: 0x24544c, density: 0.0135 },
  { id: 'fort', name: 'Bandit Fort', z0: 250, z1: 360, fog: 0x34484a, density: 0.0125 },
  { id: 'pit', name: "Gnarlbelly's Pit", z0: 360, z1: 480, fog: 0x42363c, density: 0.0115 },
];

// ---------------------------------------------------------------------------
// SPAWNS
// ---------------------------------------------------------------------------
const G = null; // "snap to ground" marker for pos[1]
const gc = (x, y, z) => ({ type: 'glowcap', pos: [x, y, z] });
const line = (from, to, count) => ({ type: 'glowcapLine', pos: from.slice(), from, to, count });
const ring = (x, y, z, radius, count) => ({ type: 'glowcapRing', pos: [x, y, z], radius, count });
const grunt = (x, y, z, yaw = Math.PI, o = {}) => ({ type: 'grunt', pos: [x, y, z], yaw, ...o });
const slinger = (x, y, z, yaw = Math.PI, o = {}) => ({ type: 'slinger', pos: [x, y, z], yaw, patrol: 0, ...o }); // perched: stand guard
const ironbelly = (x, y, z, yaw = Math.PI, o = {}) => ({ type: 'ironbelly', pos: [x, y, z], yaw, ...o });
const WAVE = { aggro: true, dropIn: true };              // ambush grunts leap in already alerted
const ISLAND = { patrol: 2, leash: 7 };                  // bog-island grunts stay near their island

// Glowcap y values are the floating centre (~0.9 m above walkable ground).
const GLOWCAPS = [
  // glade (52)
  line([0, 3.9, 8], [0.6, 3.9, 23], 6),
  ring(-15.5, 1.2, -5, 2.0, 5),                                  // hovering over the start pond (glide/jump for them)
  line([-1, 5.1, 34.5], [-5, 5.1, 43.5], 5),
  ring(6, 5.2, 47, 2.4, 6),
  gc(-8.5, 6.5, 48.3), gc(-11.1, 7.9, 50.7), gc(-12.75, 9.3, 53.35), // steps to cage C1 (last one on the pillar corner, not inside the cage)
  line([1, 5.4, 61], [0, 7.4, 73.5], 6),
  line([0, 8.4, 76.6], [0, 6.6, 84.2], 5),                       // glide arc over the ravine
  ring(15.6, 12.4, 95.5, 2.0, 6),                                 // above cage C2 (bounce)
  line([0, 5.9, 88], [1.5, 5.9, 104], 6),
  line([0, 4.6, 108.5], [0, 2.5, 117.5], 4),
  line([-8, 5.1, 36], [-12, 5.1, 40], 3),
  // bog (52)
  ...BOG.stumps.map(([x, z, , top]) => gc(x, top + 0.9, z)),
  ring(0, 2.4, BOG.b2z + 0.4, 3.2, 8),
  ...BOG.pads.map(([x, z]) => gc(x, 1.3, z)),
  ring(0, 2.15, BOG.b3z, 2.2, 4),
  line([0, 1.6, 189.5], [0, 1.6, 196], 4),
  line([10.4, 1.45, 153], [14.6, 1.45, 153], 3),
  ring(23.5, 2.7, BOG.b2z + 3, 2.2, 6),
  ring(9, 17, 219, 3, 8),                                         // updraft reward high above the cliff
  line([3, 9.9, 225], [0, 9.9, 237], 5),
  ring(-2.0, 10.2, 233, 1.6, 6),
  line([0, 9.6, 244.5], [0, 7.95, 254.5], 4),
  // fort (46)
  line([0, 8.1, 257], [0, 8.1, 268.5], 5),
  ring(12, 8.0, 285, 2.8, 6),
  line([-4, 7.9, 274], [-4, 7.9, 290], 5),
  gc(-22, 9.1, 291), gc(-22, 10.3, 292.25), gc(-22, 12.0, 292.25),   // the last one: a jump above the top step (the cage fills its crate)
  ring(0, 7.9, 320, 4, 8),
  line([-3, 7.9, 336], [3, 7.9, 343], 4),
  line([0, 7.9, 348.5], [0, 7.9, 352.5], 2),
  line([0, 7.5, 355.5], [0, 4.85, 364], 3),
  ring(0, 8.0, 311.5, 1.5, 4),
  line([-12, 7.9, 300], [-20, 7.9, 300], 4),
  gc(-7.6, 9.1, 336.4), gc(-7.6, 10.3, 337.65),
];

export const SPAWNS = [
  // ------------------------------------------------ checkpoints (pickups area)
  { type: 'checkpoint', id: 'glade', pos: [0, G, 100], yaw: 0 },
  { type: 'checkpoint', id: 'bog', pos: [0, G, 239], yaw: 0 },
  { type: 'checkpoint', id: 'fort', pos: [0, G, 352], yaw: 0 },
  { type: 'checkpoint', id: 'pit', pos: [0, G, 366], yaw: 0 },

  // ------------------------------------------------ zone triggers (level area)
  ...ZONES.map((z) => ({ type: 'zoneTrigger', id: z.id, name: z.name, pos: [0, 0, (z.z0 + z.z1) / 2], bounds: { min: [-90, -60, z.z0], max: [90, 140, z.z1] } })),

  // ------------------------------------------------ tutorial + hint signs
  { type: 'sign', pos: [-3.4, G, 7], yaw: -0.35, title: 'Welcome to Gloomfen!', text: 'Move: WASD / left stick\nLook: mouse / right stick\nQ / E swing the camera' },
  { type: 'sign', pos: [3.4, G, 24.5], yaw: 0.3, title: 'Jump', text: 'Space / A to jump.\nHold it longer to jump higher\nonto that mossy ledge!' },
  { type: 'sign', pos: [-3.6, G, 35.5], yaw: -0.3, title: 'Spore puffs', text: 'J / left click / X to throw.\nHold to charge a bigger,\nharder-hitting puff!' },
  { type: 'sign', pos: [4.2, G, 49.5], yaw: 0.35, title: 'Lock on', text: 'Hold K / Shift / right click\nor LT to lock on, then strafe\naround a bandit.' },
  { type: 'sign', pos: [3.6, G, 71.2], yaw: 0.25, title: 'Glide', text: 'The bridge is out!\nJump, then HOLD jump to open\nyour leaf and glide across.' },
  { type: 'sign', pos: [-3.2, G, BOG.b2z + 4.4], yaw: -0.3, title: 'Lily pads', text: 'Lily pads sink under you.\nKeep hopping!' },
  { type: 'sign', pos: [12.4, G, BOG.b4[1] - 1.6], yaw: 0.6, title: 'Updraft Tonic', text: 'Drink the green tonic, jump,\nthen HOLD jump in mid-air\nto ride the spores up!' },
  { type: 'sign', pos: [-5.0, G, 298.6], yaw: -0.35, title: 'Iron gate', text: 'Puffs just bounce off iron.\nDrink an Anvil Tonic and\nhurl iron at the gate!' },
  { type: 'sign', pos: [-3.0, G, 359.5], yaw: -0.3, title: "Gnarlbelly's Pit", text: 'The Chief waits below.\nOnce the gate drops,\nthere is no way out!' },

  // ------------------------------------------------ mechanisms (level area)
  // bounce shrooms: rise = power^2 / 64 above the cap (cap top ~0.85 m above its base)
  { type: 'bounceShroom', pos: [-5.6, G, BOG.b2z + 0.6], power: 20 },   // BS1 -> cage C3 pillar (top 7.2)
  { type: 'bounceShroom', pos: [-3.2, G, 229.2], power: 23.5 },          // BS2 -> watchtower platform (y 17)
  { type: 'bounceShroom', pos: [11.6, G, 93.4], power: 19.5 },           // BS3 -> cage C2 pillar (top 9.6)
  // sinking lily pads (top 0.36 above water)
  ...BOG.pads.map(([x, z]) => ({ type: 'sinkingPad', pos: [x, 0.36, z], radius: 1.25 })),
  // moving log rafts
  { type: 'movingPlatform', pos: BOG.raftA[0].slice(), size: [3.0, 0.5, 3.2], path: BOG.raftA, speed: 2.6, pause: 1.0, style: 'raft' },
  { type: 'movingPlatform', pos: BOG.raftB[0].slice(), size: [3.2, 0.5, 3.0], path: BOG.raftB, speed: 2.4, pause: 1.0, style: 'raft' },
  { type: 'movingPlatform', pos: BOG.raftC[0].slice(), size: [3.0, 0.5, 2.8], path: BOG.raftC, speed: 2.0, pause: 1.2, style: 'raft' },
  // thorns
  { type: 'hazard', kind: 'thorns', pos: [8.5, G, 41.5], size: [3.2, 1.0, 2.4] },
  { type: 'hazard', kind: 'thorns', pos: [-9.0, G, 103.0], size: [3.0, 1.0, 3.0] },
  { type: 'hazard', kind: 'thorns', pos: [10.5, G, 236.5], size: [3.0, 1.0, 2.2] },
  { type: 'hazard', kind: 'thorns', pos: [17.0, G, 287.5], size: [3.6, 1.0, 2.0] },
  { type: 'hazard', kind: 'thorns', pos: [-3.1, G, 362.5], size: [1.4, 1.0, 2.4] },
  // fort iron gate + courtyard ambush + pit portcullis
  { type: 'ironGate', id: 'fortGate', pos: [0, FORT_Y, 304.35], size: [6.0, 5.0, 0.5], flag: 'gateFortOpen' },
  {
    type: 'arenaLock', id: 'courtyard', pos: [0, FORT_Y, 320],
    bounds: { min: [-15, 5, 310], max: [15, 15, 331] },
    gates: [{ pos: [0, FORT_Y, 307.6], size: [6.0, 5.0, 0.5] }, { pos: [0, FORT_Y, 332.6], size: [6.8, 5.0, 0.5] }],
    waves: [
      [grunt(-9, FORT_Y, 326, Math.PI, WAVE), grunt(9, FORT_Y, 326, Math.PI, WAVE), grunt(0, FORT_Y, 329, Math.PI, WAVE)],
      [grunt(-10, FORT_Y, 314, 0.8, WAVE), grunt(10, FORT_Y, 314, -0.8, WAVE), slinger(-11.5, FORT_Y + 2.4, 327.5, Math.PI, { aggro: true }), slinger(11.5, FORT_Y + 2.4, 327.5, Math.PI, { aggro: true })],
    ],
  },
  { type: 'eventGate', id: 'pitGate', pos: [0, PIT.y, PIT.gateZ], size: [6.4, 5.4, 0.5], closeOn: 'boss:start', openOn: ['boss:defeated', 'player:died', 'player:respawn'], startOpen: true },

  // ------------------------------------------------ pickups (pickups area)
  ...GLOWCAPS,
  { type: 'cage', pos: [-13.6, 8.4, 54.2] },               // C1 glade pillar (stone steps)
  { type: 'cage', pos: [15.6, 9.6, 95.5] },                // C2 glade pillar (bounce shroom BS3)
  { type: 'cage', pos: [-10.4, 7.2, BOG.b2z + 4.6] },      // C3 bog pillar (bounce shroom BS1)
  { type: 'cage', pos: [24.6, G, BOG.b2z + 4] },           // C4 side island E1 (raft C)
  { type: 'cage', pos: [-7.8, 17.0, 229.8] },              // C5 watchtower platform (updraft / BS2)
  { type: 'cage', pos: [-20.75, 10.6, 292.25] },           // C6 crate pile, outer yard
  { type: 'cage', pos: [11.15, 10.6, 313.65] },            // C7 crate pile, courtyard corner
  { type: 'cage', pos: [-11.5, 10.0, 337.8] },             // C8 hut roof, back yard
  { type: 'berry', pos: [9, G, 52] },
  { type: 'berry', pos: [3.5, G, BOG.b2z - 2] },
  { type: 'berry', pos: [2.5, G, 226.5] },
  { type: 'berry', pos: [-14, G, 299] },
  { type: 'berry', pos: [0, G, 340] },
  { type: 'berry', pos: [3, G, 356] },
  { type: 'berry', pos: [-14, PIT.y, 388] },
  { type: 'berry', pos: [14, PIT.y, 388] },
  { type: 'tonic', kind: 'updraft', respawn: true, pos: [BOG.b4[0], G, BOG.b4[1] + 1.2] },
  { type: 'tonic', kind: 'anvil', respawn: true, pos: [6, G, 297] },
  { type: 'tonic', kind: 'seeker', respawn: true, pos: [0, G, 320] },
  { type: 'tonic', kind: 'anvil', respawn: true, pos: [5.5, G, 338.5] },

  // ------------------------------------------------ enemies (enemies area)
  // glade: 5 grunts
  grunt(-4, G, 43), grunt(5, G, 46.5), grunt(-2, G, 56), grunt(-5, G, 93), grunt(6, G, 98.5),
  // bog: 6 grunts, 3 slingers
  grunt(-3, G, BOG.b2z - 2, Math.PI, ISLAND), grunt(3.5, G, BOG.b2z + 3, Math.PI, ISLAND), grunt(0.5, G, BOG.b3z + 1, Math.PI, { patrol: 1, leash: 4 }),
  slinger(9.0, 4.0, 134.0, -1.9), slinger(-9.5, 3.6, 166.5, 1.9),
  grunt(-6, G, 233.5), grunt(5, G, 236.5), grunt(-2.5, G, 246),
  slinger(-6.3, 17.0, 228.2, Math.PI),
  // fort outer yard: 4 grunts, 2 slingers, 3 ironbellies
  grunt(-12, G, 281), grunt(12, G, 280), grunt(-6, G, 292), grunt(14, G, 296),
  slinger(-10, FORT_Y + 5.5, 274.5, Math.PI), slinger(10, FORT_Y + 5.5, 274.5, Math.PI),
  ironbelly(-10, G, 297), ironbelly(10, G, 300.5), ironbelly(-16, G, 285),
  // courtyard waves (arenaLock above): 5 grunts, 2 slingers
  // back yard + gorge: 2 grunts, 2 slingers, 2 ironbellies
  grunt(3.5, G, 342.5), grunt(0, G, 357.5),
  slinger(-12.4, FORT_Y + 5.5, 342.2, Math.PI), slinger(12.4, FORT_Y + 5.5, 342.2, Math.PI),
  ironbelly(-6.5, G, 341), ironbelly(7.5, G, 344.5),

  // ------------------------------------------------ the pit (boss area + pickups)
  { type: 'boss', pos: [0, PIT.y, 402], yaw: Math.PI, arena: { center: [PIT.x, PIT.y, PIT.z], radius: PIT.r } },
  { type: 'lanternGate', pos: [0, PIT.y, 414] },
];

// Content summary (checked by tools/scenarios/level-content.mjs)
export const CONTENT_TARGETS = { glowcaps: 150, cages: 8, berries: 8, grunts: 22, slingers: 9, ironbellies: 5 };
