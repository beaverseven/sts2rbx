# Level — Gloomfen (terrain, props, water, mechanisms, the route)

The one long level: four zones along +Z, bog water at y = 0, everything procedural.
`buildLevel(ctx)` builds the terrain, static colliders, merged prop geometry, water,
waterfalls, grass, fireflies and landmark glows, then spawns every entity in `data.js`.
It also registers the level's own entity types.

| File | What |
|---|---|
| `src/game/level/data.js` | **the level**: terrain features, structures, spawns, zones, checkpoints, route spine (pure data, node-importable) |
| `src/game/level/terrain.js` | heightfield composition → 1 m grid, exact triangle sampling for physics, chunked vertex-coloured mesh, water depth/foam texture |
| `src/game/level/props.js` | textures, per-chunk/per-material **batcher** + `mergeParts`, every structure builder, decor (trees, rocks, mushrooms, reeds, lily pads, ferns, logs), grass, glow points, backdrop |
| `src/game/level/water.js` | bog water shader, waterfall ribbons |
| `src/game/level/mechanisms.js` | entity types: movingPlatform, sinkingPad, bounceShroom, ironGate, eventGate, arenaLock, sign, zoneTrigger, hazard |
| `src/game/level/builder.js` | `buildLevel(ctx, opts)` → level object; decor scatter; per-zone fog; distance culling; ambient life |
| `src/dev/level.js` | sandbox (level only; other areas' types show as placeholders) + toast / zone banner / draw-call overlay |
| `tools/scenarios/level-*.mjs` | tour (screenshots + draw calls), route proof, continuous playthrough, mechanisms, map, helpers |

## API

```js
import { buildLevel } from './game/level/builder.js';
import { installMechanisms } from './game/level/mechanisms.js';
boot({ buildLevel, install: [/* ... */, installMechanisms] });   // installMechanisms is optional: buildLevel registers missing types itself
```

### `buildLevel(ctx, opts = {}) → level`
`opts.spawn = false` skips `spawnAll()` (by default buildLevel spawns everything itself).
Build time ≈ 1.3 s (terrain 0.2 s, props 0.8 s) in headless Chromium.

```js
level = {
  isStub: false, name: 'Gloomfen',
  spawn: { position: [0, 2.96, 2], yaw: 0 },          // = checkpoints[0] ('start')
  checkpoints: [{ id, position:[x,y,z], yaw }],         // start, glade, bog, fort, pit (y snapped to ground)
  zones: [{ id, name, bounds:{min,max}, fog, density }],// glade, bog, fort, pit
  bounds: { min:[-62,-60,-40], max:[62,220,462] },     // safety clamp (see update)
  zone: 'glade',                                        // current zone id (zoneTrigger keeps it updated)
  spawnAll(),   // spawns every SPAWNS def (pos[1] === null -> ground height); returns the spawned list
  reset(),      // mechanisms reset, all spawned entities re-created, level flags cleared, zone = 'glade'
  dispose(),    // removes meshes, colliders, terrain, entities, listeners; disposes GPU resources
  update(dt),   // fixed step: boundary clamp
  frame(realDt),// per frame: water/grass/cloth/points time, per-zone fog blend, distance culling, ambient life
  // extras
  heightfield,  // { sample(x,z), normal(x,z,out), surfaceAt(x,z), paintAt(x,z), grid }
  water,        // { addRipple(x, z, strength), mesh, uniforms }
  data,         // the data.js module
  spawned,      // entities created by spawnAll
  groundY(x, z, fromY = 200), // highest walkable surface (terrain or collider top)
  entityCullDistance: 105,      // see "Entity distance culling"; 0 disables
  stats,        // build stats: decor counts, collider count, grass tufts, fireflies, timings
}
```

### Entity types (`installMechanisms(ctx)` registers them; all team `'neutral'`, no `hurt()`)

| type | params | behaviour / events |
|---|---|---|
| `movingPlatform` | `size:[x,y,z], path:[[x,y,z],...], speed=2.5, pause=1, style:'raft'` | log raft; `physics.addMover` collider follows a ping-pong along the path (eased ends, gentle bob). Carries Morel. Leaves ripples. `e.collider` |
| `sinkingPad` | `radius=1.2`, `pos` = pad **top** (must be > 0.3, see notes) | lily pad mover tagged `'unsafe'`. Stood on: 0.35 s wobble → sinks (0.42 m/s, accelerating) → collider off at top < −0.26 (Morel drops in) → hidden 2.2 s → rises (0.9 s). `e.state`: idle/loaded/sinking/hidden/rising |
| `bounceShroom` | `power=18` | cap collider top 0.85 m above `pos`; landing on it calls `player.launch(power)` (rise ≈ power²/64 m above the cap), squash anim, glow burst. Emits **`level:bounce {position, power}`** |
| `ironGate` | `id, size:[w,h,d], flag='gateOpen_<id>'` | iron portcullis (collider). An `'iron'` projectile hitting its collider, or `ctx.flags[flag]` becoming true, opens it: sinks into the ground, sets the flag, emits **`gate:open {id, position}`**. Other projectiles clang off with sparks and a `ui:message` hint (once per 10 s). `e.open()`, `e.isOpen`, `e.reset()` |
| `eventGate` | `id, size, closeOn:'event', openOn:['event',...], startOpen=true, style='wood'` | **new** — spiked gate driven by events. The pit entrance uses `closeOn:'boss:start', openOn:['boss:defeated','player:died']`. Emits `gate:close` / `gate:open {id, position}` |
| `arenaLock` | `id, bounds:{min,max}, gates:[{pos,size,style?}], waves:[[spawnDef...],...]` | idle → Morel inside bounds → gates rise, **`arena:lock {id}`**, after 0.6 s wave 1 spawns via `ctx.entities.spawn` (defs get `arena: id`). Wave defeated (every entity `alive === false`, or `dead === true`, or `hp <= 0 && hittable === false`) → 1.2 s → next wave. Last wave → gates open, flag `arenaClear_<id>`, **`arena:clear {id}`** + `ui:message`. Morel dies inside → on his checkpoint respawn the arena resets (wave entities removed, gates open, idle). Extra events: `arena:wave {id, wave, count}`, `arena:reset {id}` |
| `sign` | `title, text` (`\n` = board line break), `toast?`, `duration=5`, `yaw` | wooden signpost with a canvas-text board (reads while walking toward `yaw`; yaw 0 = walking +Z). Morel within 3.4 m → `ui:message {text: 'Title: text', duration, source:'sign'}` once; re-arms beyond 7 m |
| `zoneTrigger` | `id, name, bounds:{min,max}` | emits **`zone:enter {id, name}`** once per entry (also at boot for the start zone); sets `ctx.level.zone` |
| `hazard` | `kind:'thorns', size:[x,y,z]` | bramble patch; touching it: `player.damage(1, nearestPatchPoint)` (knockback away, then the usual invulnerability) |

`sign` and `hazard` defs from `data.js` are spawned with `baked: true`: their meshes are merged into the
static batch, and the entity keeps only the text face / the trigger. Spawning them from code without
`baked` builds their own meshes.

### Level-side behaviour
* **Per-zone fog** (`ZONES[].fog/density`) blended over ±12 m at each boundary via `ctx.gfx.setFog`.
* **Updraft snuff**: entering the fort zone with the Updraft Tonic active ends it (`player.setTonic(null)`)
  with a `ui:message`, so leftover updraft cannot float Morel over the palisades past the iron gate and
  the ambush. Anvil/Seeker are unaffected.
* **Bounds clamp** at x = ±62, z −40…462 (on the high boundary country; never reached on foot).
* **Entity distance culling** (safety net for every area): each frame, entities farther than
  `level.entityCullDistance` (default 105 m, beyond which the fog hides them) get `object3d.visible = false`.
  Only entities hidden by this pass are shown again, so entities' own visibility logic is untouched.
  The boss (`tag 'boss'`) and entities with `noCull: true` are skipped; set the distance to 0 to disable.
* Ambient life: random ripple rings on the bog near the camera, embers from fires and torches, waterfall spray,
  fireflies and spore motes (GPU-animated points), wind on grass and banners.

### Flags set
`ctx.flags.gateFortOpen` (iron gate), `ctx.flags.arenaClear_courtyard` (ambush beaten).

## The route (coordinates; +Z is forward, x = 0 is the spine)

Movement numbers from docs/core.md: running jump 5.4 m flat; max ledge 2.0 m; running jump + glide 9.2 m flat;
glide ≈ 3.1 m per metre of drop. "Measured" = `tools/scenarios/level-route.mjs` (scripted input, deterministic).

### 1. Mossy Glade (z −15 … 110), ground y 3 → 4.2 → 6.5 → 5
| Where | Coordinates | Needs | Measured |
|---|---|---|---|
| Spawn / checkpoint `start` | (0, 2.96, 2), yaw 0 | — | — |
| Tutorial ledge (stone blocks across the neck) | z 28.8–31.6, top y 4.2 (1.2 m step) | jump | running jump from z 27.8: apex 5.05, lands (0, 4.29, 31.0); walking is blocked at z 28.5 |
| Fern meadow (first grunts, thorns at (8.5, 41.5)) | z 32–60, y 4.2 | — | — |
| Ridge ramp | z 58 → 75, y 4.2 → 6.5 | — | — |
| **Ravine** (broken bridge; water below) | takeoff edge z 75.1 (y 5.66), landing edge z 85.1 (y 4.98): **10.0 m gap**, 0.7 m lower | **jump + glide** | without glide: falls in at z 82.6 (+1 heart, back on the ridge). With glide: takeoff z 74.5, lands z 87.8 (2.7 m spare) |
| Checkpoint `glade` | (0, 4.89, 100) | — | — |
| Shore ramp | z 103 → 119, y 5 → 1.4 | — | — |

### 2. Sunken Bog (z 110 … 250), water y 0, islands y 1.2–1.5
| Where | Coordinates | Needs | Measured |
|---|---|---|---|
| Shore edge → stump 1 | shore walkable to z 119.1; stump 1 (1.0, 123.0) top 1.9 (gap 3.1 m, +1 m) | jump | takeoff z 117.6 → lands z 122.8 |
| Stumps 2–5 | (−1.5,127.4) 2.3 · (1,131.8) 1.9 · (−1.2,136.2) 2.5 · (1,140.6) 2.1; edge gaps ≈ 2.8 m | jumps | all land (takeoff at the stump edge) |
| → island B2 | walkable from z 144.1 (y 0.6–1.5) | jump | lands (0.2, 1.5, 146.1) |
| Island B2 (bounce shroom BS1, slinger stump at (9, 134), sign) | centre (0, 151), rx 7.2 rz 6.2, y 1.5 | — | — |
| **Sinking lily pads** ×5 | (0,160.5) (−1.4,164) (0.6,167.5) (−1,171) (0,174.5), top y 0.36, edge gaps ≈ 1.6–1.8 m | quick hops | all 5 + island B3 land; standing still → sinks → falls in |
| Island B3 | (0, 181.5) r 3.7, y 1.25 (walkable z 177.1–186.1) | jump from pad 5 | lands (0, 1.26, 179.1) |
| **Raft A** (z-shuttle) | (0, 0.42, 188.6) ↔ (0, 0.42, 197.0), 2.6 m/s, 1 s pause; top y 0.67 | timed hop on/off | boards at z 189.5, rides to 197.8, hops to stump T |
| Stump T | (0, 201.0) r 1.9, top 1.3 | jump | lands z 201.9 |
| **Raft B** (x-shuttle) | (−1.2, 0.42, 205.3) ↔ (7.0, 0.42, 205.3), 2.4 m/s | timed hop on/off | boards at x −1.2, hops to B4 at (8.4, 1.5, 211.2) |
| Island B4 + **Updraft Tonic** jar (respawns) | jar (9, 1.5, 215.8); cliff face z 219.4–222 (y 1.5 → 9, 7.5 m) | **Updraft Tonic** | plain jump peaks 3.7 and falls back; with updraft: apex 11.2, lands on the plateau (8.0, 9.0, 225.4) |
| Plateau: lit watchtower (beacon, slinger, cage C5, BS2) | tower (−7, 229), platform y 17 | — | — |
| Checkpoint `bog` | (0, 8.99, 239) | — | — |

### 3. Bandit Fort (z 250 … 360), ground y 7
| Where | Coordinates | Needs | Measured |
|---|---|---|---|
| Plateau descent → moat | z 244 → 257, y 9 → 7; moat water z 258.3–267.4 | — | — |
| Rope-railed bridge into the front gate | x ±2.2, z 255.4–269.7, top 7.15 | walk | walked z 251 → 280 without falling |
| Outer yard (2 towers w/ slingers, 4 grunts, 3 ironbellies, tents, campfire, crates, trophy pile) | x ±30, z 270–304 | — | — |
| **Anvil Tonic** jar (respawns) → **iron gate** | jar (6, 7, 297); gate (0, 7, 304.35) 6 × 5 m | **Anvil Tonic** throw | walking is blocked at z 303.8; one iron throw opens it (`gate:open fortGate`) |
| **Ambush courtyard** (`arenaLock`, Seeker Tonic jar at (0, 7, 320)) | bounds x ±15, z 310–331; gates z 307.6 and 332.6 | clear 2 waves (3 grunts; 2 grunts + 2 slingers on crate stacks) | lock / waves / clear / reset-on-death all verified |
| Back yard (2 tower slingers, 2 ironbellies, 2nd Anvil jar at (5.5, 7, 338.5), hut + cage C8) | z 333–346 | — | — |
| Checkpoint `fort` (outside the back gate) | (0, 7.04, 352) | — | — |

### 4. Gnarlbelly's Pit (z 360 … 430)
| Where | Coordinates |
|---|---|
| Gorge down from the fort | z 346 → 375, y 7 → 2, width ≈ 8 m |
| Checkpoint `pit` | (0, 3.82, 366) (6 m before the gate) |
| Pit entrance + `eventGate` `pitGate` | gap \|x\| < 3.2 at z ≈ 371.8–373.0, gate at z 372.4 (closes on `boss:start`) |
| Pit floor | **flat y = 2, radius 22** around (0, 2, 395); stone wall to y 7.4 (inner face r 22.05, AABB ring — diagonal corners reach r ≈ 21.9) |
| Boss / Lantern Gate | `boss` (0, 2, 402) yaw π · `lanternGate` (0, 2, 414) |
| Berries | (−14, 2, 388), (14, 2, 388) |
| Chief's trophy totem (dais behind the back wall: stacked tin pots, glowing crown pot, torches, banners) | (0, 8.6, 420.2), rim y 7.2, not reachable. The Chief's **seat** is the boss area's throne at z ≈ 403.5–405 (boss default `throne: true`); floor bones keep clear of it |

Continuous run (`level-playthrough.mjs`): spawn → pit centre (0, 2, 395) with no teleports in **82 simulated
seconds**, 0 falls. Jars are simulated with `give()`, and the courtyard placeholder waves are despawned.

### Optional content
| | Where / how |
|---|---|
| Cage C1 | glade pillar (−13.6, 8.4, 54.2) via two stone steps (1.4 m each) |
| Cage C2 | glade pillar (15.6, 9.6, 95.5) via bounce shroom BS3 (11.6, 93.4), power 19.5 |
| Cage C3 | bog pillar (−10.4, 7.2, 155.6) via bounce shroom BS1 (−5.6, 151.6), power 20 |
| Cage C4 | island E1 (24.6, 155) via raft C (10.2 ↔ 14.8, z 153) |
| Cage C5 | watchtower platform (−7.8, 17, 229.8) via bounce shroom BS2 (−3.2, 229.2), power 23.5, or leftover updraft |
| Cage C6 / C7 | crate stairs (1.2 m steps) at (−20.75, 10.6, 292.25) / (11.15, 10.6, 313.65) |
| Cage C8 | back-yard hut roof (−11.5, 10.0, 337.8) via crates |
| Glowcap extras | ring over the start pond, glide arc over the ravine, ring 17 m above the cliff (updraft), rings above the bounce pillars |

The bounce-shroom reaches are verified in `level-mechanisms.mjs` (BS1 → y 7.2, BS3 → y 9.6, BS2 → y 17).

### Content totals (data.js)
159 glowcaps (glade 55, bog 58, fort 46) · 8 cages · 8 berries (6 on the route + 2 in the pit) ·
22 grunts (5 of them in the courtyard waves) · 9 slingers (2 in the waves) · 5 ironbellies (outer yard 3, back yard 2) ·
tonic jars: updraft ×1, anvil ×2, seeker ×1 (all `respawn: true`) · 9 signs · 3 bounce shrooms · 5 sinking pads ·
3 rafts · 5 thorn patches · 4 checkpoints (+ `start`) · 4 zone triggers.

## Art / rendering

* **Terrain**: 145 × 521 grid (1 m), 150 k triangles in 11 chunks of 48 m. Vertex colours give moss on flat ground,
  mud near and under water, a worn dirt path (paint), rock with strata bands on steep slopes, and heather on the high country.
  There is a grass-stroke detail texture. Physics samples the same triangles (`sample`/`normal`), so there are no visual/physics mismatches.
* **Static props**: everything is baked by the batcher into one mesh per (48 m chunk × material).
  Materials: `toon` (vertex colours, outlined, casts), `flat` (small details, no outline/shadow), `glow` (HDR
  vertex colours normalised to luminance ≈ 1.5 so magenta blooms like cyan), `wood` / `stone` / `crate`
  (canvas textures), `cloth` (banner emblem: a dented tin pot over crossed ladles, wind sway in the vertex shader).
* **Decor scatter** (seeded): ≈140 twisted trees (layered canopy blobs, hanging moss, glowing shelf fungi), ≈220 rocks
  incl. cliff boulders, ≈50 mushroom clusters plus 9 hero clumps, reeds on the shores (≈80 clumps), ≈120 lily pads,
  ferns, fallen logs. Trees keep 6.5 m off the route spine. They also stay out of spots where their canopy would sit in
  front of higher walkable ground (camera-in-foliage).
* **Water**: one opaque plane, depth-tinted from a baked depth texture. It has animated ripple normals, shore foam lines,
  foam rings around stumps and posts, a fresnel tint toward the fog colour, a distance-limited moon glint and ripple rings.
* **Glow points** (3 draw calls): halos for lanterns, torches, fires and mushrooms; **landmark beacons** with ~1/6 fog (watchtower
  fire, fort haze, the pit's glow column); fireflies and spore motes animated in the vertex shader.
* **Grass**: ≈3.6 k instanced 5-blade tufts with vertex-shader wind, chunked per 48 m.
* **Backdrop**: three unlit silhouette rings (hills + spiky treelines), fading into the fog colour at the base.
* **Culling**: chunks beyond 150–190 m (fog), grass beyond 70 m, outline hulls beyond 70 m, level entities beyond 90 m.

### Draw calls (`tools/scenarios/level-tour.mjs`, 960×540, quality `high`, one full frame = shadow + main + bloom)
"level" = with other areas' placeholder markers hidden (they are not distance-culled). This includes core's
Morel (47 incl. outlines + shadow), bloom (14), sky/particles/shadow setup (16): **77 calls are core's**, measured by
hiding every level object at the glade checkpoint.

| View | full frame, placeholders hidden | level's own (minus core 77) | triangles |
|---|---|---|---|
| checkpoint `start` (0, 3, 2) | 126 | 49 | 434 k |
| checkpoint `glade` (0, 4.9, 100) | 140 | 63 | 459 k |
| checkpoint `bog` (0, 9, 239) | 139 | 62 | 542 k |
| checkpoint `fort` (0, 7, 352) | 126 | 49 | 436 k |
| checkpoint `pit` (0, 3.8, 366) | 121 | 44 | 424 k |
| tutorial ledge / ravine | 133 / 133 | 56 / 56 | 470 k / 487 k |
| stumps / island B2 / lily pads / rafts | 145 / 149 / 147 / 141 | 68 / 72 / 70 / 64 | 470–493 k |
| cliff / plateau tower | 143 / 144 | 66 / 67 | 508 k / 531 k |
| fort approach / yard / iron gate / courtyard / back yard | 142 / 147 / 140 / 145 / 138 | 61–70 | 504–560 k |
| inside the pit / near the back wall | 117 / 111 | 40 / 34 | 344 k / 302 k |
| worst view found (island B2 looking toward the plateau) | 156 | 79 | 471 k |

With the sandbox placeholders visible (2 calls per spawn def; beyond 105 m the level's entity culling hides them) the
checkpoint totals are 115–198 calls. That says little about the real pickups and enemies.

**With the real enemies area installed** (integration check, all 30 bandits spawned, placeholders for pickups hidden):
fort outer yard 329, island B2 253, inside the pit with the Chief 153. Each bandit costs about 14 calls (meshes, outlines,
shadow), and the fort's bandits are within 105 m even when they're behind walls. To reach < 200 there, the enemies area
needs LOD: drop outline hulls beyond ~30 m and shadow casting beyond ~25 m, or merge the bandit body meshes.

## How to test
```
node tools/build.mjs --entry src/dev/level.js --out dist/dev-level --dev
node tools/smoke.mjs --html dist/dev-level/index.html --out dist/dev-level/smoke.png --w 960 --h 540 --wait 6000
node tools/scenario.mjs tools/scenarios/level-route.mjs       --html dist/dev-level/index.html --shots dist/dev-level/shots  # 29 checks
node tools/scenario.mjs tools/scenarios/level-mechanisms.mjs  --html dist/dev-level/index.html --shots dist/dev-level/shots  # 20 checks
node tools/scenario.mjs tools/scenarios/level-playthrough.mjs --html dist/dev-level/index.html --shots dist/dev-level/shots  # spawn -> pit, no teleports
node tools/scenario.mjs tools/scenarios/level-tour.mjs        --html dist/dev-level/index.html --shots dist/dev-level/shots  # 28 screenshots + draw calls (TOUR=a,b to limit)
node tools/scenarios/level-map.mjs dist/dev-level/map.png 2     # node only: top-down layout map + glowcap height check
```
Sandbox keys: 1/2/3 drink Anvil/Updraft/Seeker, N/B next/previous checkpoint. The overlay shows position, zone and
draw calls per frame. Expected console output: one `[entities] no factory registered` warning per type
owned by other areas (checkpoint, glowcap*, cage, berry, tonic, grunt, slinger, ironbelly, boss, lanternGate). No errors.

## Contract deviations / additions (precise)
1. `buildLevel(ctx, opts)` returns the contract fields `{zones, checkpoints, bounds, spawnAll, reset, dispose}` plus
   core's `{spawn, zone, update, frame}` and the extras `{isStub:false, name, heightfield, water, data, spawned, groundY, stats}`.
   buildLevel **calls `spawnAll()` itself** (`opts.spawn = false` to skip).
2. New entity type **`eventGate`** (pit entrance portcullis). New events: `gate:close {id, position}`,
   `arena:wave {id, wave, count}`, `arena:reset {id}`, `level:bounce {position, power}`. `ui:message` from signs carries `source:'sign'`.
3. `ironGate` takes `flag` (default `gateOpen_<id>`; the fort gate uses `gateFortOpen`). `arenaLock` gates are
   `[{pos, size, style?}]`, it sets flag `arenaClear_<id>`, and wave spawn defs get `arena: <id>`.
4. `sign` takes `title` + `text` (the toast is `"title: text"`); `sign` / `hazard` accept `baked`.
   `movingPlatform` takes `style`; `sinkingPad` `pos[1]` is the pad top.
5. Spawn defs reach other areas with resolved numbers: `pos[1] === null` in data.js is replaced by the ground height.
   Glowcap `pos`/`from`/`to` y is the **floating centre** (≈ 0.9 m above walkable ground). `glowcapLine` defs also carry `pos` (= `from`).
6. Content beyond the brief: a second Anvil Tonic jar in the back yard (for its two ironbellies); 8 berries (6 + 2 in the pit); 159 glowcaps.
7. Level-side rules: the Updraft Tonic is snuffed on entering the fort zone; a bounds clamp at x ±62 / z −40…462;
   entity distance culling for all areas (`level.entityCullDistance`, default 105 m).
8. The pit's "crude throne" is the boss area's own throne (boss default). The level builds a chief's trophy totem on a dais
   behind the back wall instead of a second seat.

## Integration notes
* **main.js**: `import { buildLevel } from './game/level/builder.js'` and `import { installMechanisms } from './game/level/mechanisms.js'`; then
  `boot({ startState: 'title', buildLevel, install: [installAudio, installScore, installUI, installEnemies, installPickups, installMechanisms] })`.
* **UI**: the level talks to the player through `ui:message` (9 signs, iron-gate hint, ambush cleared, updraft snuffed). Show these as toasts.
  `zone:enter {id, name}` is good for a zone-name banner (the sandbox draws one).
* **Audio**: `zone:enter` ids `glade|bog|fort|pit` match the music track names. SFX hooks: `gate:open`, `gate:close`, `arena:lock`,
  `arena:clear`, `level:bounce`. Terrain `surfaceAt` returns `moss|mud|stone`; colliders give `wood|stone|iron|moss`.
* **Pickups**: checkpoint defs are `{type:'checkpoint', id, pos, yaw}` for glade/bog/fort/pit (`start` lives only in
  `level.checkpoints`). Tonic jars all have `respawn: true`. Cages sit on box tops (pillars, crates, a hut roof, a tower platform):
  use `pos` as-is and don't re-snap to terrain.
* **Enemies** (verified with the real enemies area: slingers stay on every perch, no bandit walks into the bog,
  and real kills drive the ambush to `arena:clear`):
  * Spawn options used by data.js: slingers `patrol: 0` (stand guard on perches); bog-island grunts
    `{patrol: 2, leash: 7}` (B3: `{patrol: 1, leash: 4}`); ambush waves `{aggro: true, dropIn: true}` (wave slingers `aggro` only);
    boss `{arena: {center: [0,2,395], radius: 22}}` with its own throne (default).
  * Wave enemies must end with `alive = false` (or `dead = true`, or `hp <= 0 && hittable === false`) for the ambush to progress.
    Courtyard waves deliberately contain **no ironbellies**: the Seeker jar there replaces any Anvil.
  * Slinger perches are box tops: stumps in the water (9, 4.0, 134) and (−9.5, 3.6, 166.5), tower platforms at y 12.5 (fort) / 17 (bog),
    and crate stacks at y 9.4 in the courtyard. Slingers should not walk.
  * Bog grunts stand on small islands surrounded by water. Keep them leashed near their spawn.
* **Boss**: the pit floor is flat y = 2, r 22 around (0, 395), with **no colliders on the floor** (bones are decor). The wall is a ring of 0.7 m AABBs, so `moveCharacter` works against it.
  The entrance gate closes on **`boss:start`**, so emit it when the fight begins (with Morel inside, past z ≈ 374). It reopens on
  `boss:defeated` or `player:died`. The trophy totem on the rim (0, 8.6, 420.2) is decor only. If you pass
  `throne: false` the pit has no seat for the Chief.
* **Draw calls**: the level + Morel + bloom costs 115–150 calls. Pickups and enemies should instance and/or distance-cull
  (beyond ~90 m the fog hides them) to stay under 200.
* `ctx.level.water.addRipple(x, z, strength)` is available for splashes (enemy knocked into the bog, etc.).

* **Integration changes:**
  * the entity distance culling also covers the boss (he cost 11–22 draw calls from the start area);
  * `arenaLock` resets on any checkpoint `player:respawn` while locked, so "Restart from checkpoint" cannot leave the gates shut;
  * the pit gate's `openOn` includes `player:respawn` for the same reason;
  * two glowcaps were moved out of cages: C1's to the pillar corner `(-12.75, 9.3, 53.35)`, and C6's to a jump above the top crate step `(-22, 12.0, 292.25)`.

## Known issues
* Core counts an **airborne** Morel below `waterLevel + 0.3` as fallen in, even when he is about to land on a box below that height.
  So every landing surface over water sits above 0.3 m: lily pad tops are 0.36, raft tops 0.67.
* Trees on the high boundary country can still put foliage in front of the camera if Morel is lifted there with an updraft.
* The updraft jar sits 3.6 m in front of the cliff foot; the climb works from anywhere on island B4.
* The sandbox's placeholder markers are not culled, so totals with placeholders visible reach ~330 calls. That is not representative.
