# Core — engine, Morel, camera, projectiles

Everything other areas build on: `boot()`, the fixed-step loop, `ctx`, events,
input, physics, entities, particles, materials, renderer (sky/fog/lights/bloom),
Morel (model + controller), the camera rig, projectiles, the built-in test arena
and `window.__game`.

| File | What |
|---|---|
| `src/core/boot.js` | `boot(options)` → ctx; loop; state glue; `window.__game` |
| `src/core/context.js` | `createContext()`, `FIXED_DT`, silent stubs (audio/score/hud/menus/level) |
| `src/core/events.js` | event bus |
| `src/core/mathx.js` | clamp, lerp, damp, approach, wrapAngle, angleDelta, dampAngle, rand(seed), noise, easings |
| `src/core/input.js` | keyboard/mouse/gamepad/virtual/override → actions |
| `src/core/physics.js` | AABBs in a spatial hash, movers, heightfield, character controller, queries |
| `src/core/entities.js` | `EntityManager`, `Entity` base class, type registry, placeholder rule |
| `src/core/particles.js` | pooled particles, 2 draw calls |
| `src/core/materials.js` | toon ramp, palette, outlines, canvas textures, glow |
| `src/core/renderer.js` | WebGLRenderer, sky dome, fog, lights, shadows, bloom, quality |
| `src/core/testArena.js` | `buildTestArena(ctx)`, `registerDummyType(ctx)`, `arenaHeight(x,z)` |
| `src/game/player.js` | Morel: model, animation, controller, `TUNING` |
| `src/game/camera.js` | third-person rig, `CAMERA_TUNING` |
| `src/game/projectiles.js` | pooled projectiles |
| `src/main.js`, `src/page.html`, `src/dev/core.js` | entry, minimal page, sandbox |

## Boot

```js
import { boot } from './core/boot.js';
const ctx = boot({
  install: [installAudio, installScore, installUI, installEnemies, installPickups, installMechanisms], // run in order
  buildLevel,              // (ctx) => level object; default: buildTestArena
  startState: 'title',     // 'playing' (default) | 'title'
  container: document.getElementById('app'), // default #app
  settings: { sensitivity: 1 },              // optional ctx.settings overrides
});
```

Order inside `boot`: materials → renderer/scene/camera → input → physics →
entities → particles → projectiles → `'dummy'` type → player → cameraRig →
**installers** → `buildLevel(ctx)` → player placed at `level.spawn`, checkpoint =
`level.checkpoints[0]` → `ctx.setState(startState)` → loop → `window.__game`.

URL overrides: `?quality=high|medium|low`, `?state=title|playing`.

### Level object (returned by `buildLevel`)
Missing fields are filled from the stub, so all are optional.
```js
{
  name: 'Gloomfen',
  spawn: { position: [x, y, z], yaw },        // where Morel starts
  checkpoints: [{ id, position: [x,y,z], yaw }], // in progression order (used by __game.checkpoints)
  zone: 'glade',                              // current zone id; __game.state().zone reads it
  update(dt, ctx) {},                         // every fixed step (after entities)
  frame(realDt, ctx) {},                      // every rendered frame, all states (shader time etc.)
}
```
`__game.checkpoints()` also appends live entities tagged `'checkpoint'` (id from
`entity.checkpointId ?? entity.def.id ?? entity.id`) that are not already listed.

### Loop, time, states
* Fixed step `dt = 1/60`, accumulator, max 5 steps per animation frame (excess time dropped), one render per rAF.
* Simulation runs only in `'playing'` and `'dead'` (`ctx.simulating`). In other states a "menu tick" runs once per frame: `input.update` + core's pause toggle, so menus can read `input.pressed(...)` from `frame()` hooks.
* Fixed step order: `input.update` → (pause check) → `time.now += dt; time.frame++` → `entities.update` → `level.update` → `player.update` → `projectiles.update` → `systems[i].update` → `particles.update` → `cameraRig.update` → `entities.flush` → `input.endFrame`.
* Per frame: `systems[i].frame(realDt)` → `level.frame` → `cameraRig.frame` (title/results orbit) → `gfx.frame` (sky, shadow follow, auto-quality) → render.
* `ctx.time = { now, dt, frame, real }`: `now`/`frame` count simulated seconds/steps; `real` is wall-clock seconds since boot (use it for decorative shader time).
* `ctx.setState(s)` changes state and emits `game:state {state, prev}`. Core itself: toggles `playing ⇄ paused` on the `pause` action, pauses when pointer lock is lost or the tab is hidden, goes `playing → dead` when Morel dies and `dead → playing` after the 1.4 s splat (`TUNING.deathTime`; was 1.6 before integration) (auto respawn at checkpoint). Everything else (`title`, `results`) is set by UI/integration.
* `ctx.addSystem({ update?(dt, ctx), frame?(realDt, ctx), order? })` → `remove()`: per-step / per-frame hooks for things that are not entities (score combo timer, HUD, audio listener, water time).

## ctx
Exactly the contract shape plus these **extensions**:
`ctx.gfx` (renderer module, below), `ctx.projectiles`, `ctx.menus` (stub `{show, hide}`),
`ctx.systems` / `ctx.addSystem()`, `ctx.setState()`, `ctx.simulating` (getter),
`ctx.setQuality(q)`, `ctx.time.real`.

Stubs (`isStub: true`) until areas replace the whole object:
`audio {unlock, play, music, setVolumes}`, `score {points, chain, multiplier, timeLeft, reset}`,
`hud {toast, showBossBar}`, `menus {show, hide}`, `level` (see above).
`__game.state()` reads `score.points` (falls back to `score.score` / `score.total`), `score.chain`, `score.multiplier`, `score.timeLeft`.

## Events
`events.on(name, fn) → off()`, `events.once(name, fn)`, `events.off(name, fn)`,
`events.emit(name, payload)`, `events.on('*', (payload, name) => …)` for everything.
Listeners get `(payload, name)`; a throwing listener is logged with `console.error` and the rest still run. Listener lists are copy-on-write (subscribe/unsubscribe inside a handler is safe).

Core emits: all `player:*` events, `projectile:hit`, `tonic:start|warning|end`, `game:state`,
and (test arena dummy) `enemy:hurt` / `enemy:killed` with `type: 'dummy', points: 0`.

Extra fields / extra events (additive, safe to ignore):
* `player:step { position, surface, speed }` — footstep (≈ 2–7 per second while running). Not in the contract; for audio.
* `projectile:hit` adds `deflected` (entity returned `false` from `hurt`) and, for world hits, `collider` (box collider, `'terrain'` or `'water'`).
* `player:charge { level: 0 }` fires once the throw button has been held 0.15 s (when the orb appears), not on every tap; `{ level: 1 }` at full charge.
* Falling in water emits `player:fell` **and** `player:hurt {amount: 1, …}`; the follow-up `player:respawn` has `checkpointId: null` (safe-ground respawn). Death respawn has the checkpoint id.

## Input (`ctx.input`)
Contract API plus extensions.
```js
input.move            // Vector2, x = right, y = forward, |move| ≤ 1
input.look            // Vector2 radians this step (mouse/stick/touch, sensitivity + invertY applied)
input.down(a) / pressed(a) / released(a)
// actions: 'jump' 'throw' 'lock' 'pause' 'confirm' 'back'  + extensions 'camLeft' 'camRight' 'up' 'down' 'left' 'right'
input.setVirtual({ move:{x,y}, look:{x,y} /* pixel drag since last call */, buttons:{ jump, throw, lock, pause } }) // partial updates OK
input.lastDevice      // 'keyboard' | 'gamepad' | 'touch'
input.update(dt) / input.endFrame()  // called by the loop
input.keyDown(code)   // raw KeyboardEvent.code state
input.pressedAny()    // any mapped action pressed this step ("press any key" screens)
input.mouseMode       // 'lock' | 'drag' (fallback after a rejected pointer lock)
input.pointerLocked, input.requestPointerLock() → Promise<bool>, input.exitPointerLock()
input.cancel(action)  // drop a held action without a released edge
input.setOverride(o)  // what __game.setInput uses
```
Bindings: WASD/arrows move; Space jump (+confirm); J / left mouse throw; K / Shift / right mouse lock;
Esc / P pause (Esc also back); Enter confirm; Backspace back; Q / E camera snap.
Gamepad (standard): left stick move, right stick look, A jump/confirm, B back, X / RB / RT throw,
LB / LT lock, Start/Select pause, d-pad up/down/left/right (left/right also camera snap).
Taps shorter than one step are latched, never lost. Mouse buttons only act while the
pointer is locked or in drag mode (the first click on the canvas requests pointer lock and does not throw).
In drag mode a left-drag over 7 px orbits the camera and cancels the throw.

## Physics (`ctx.physics`)
```js
const c = physics.addBox({ min:[x,y,z], max:[x,y,z], surface:'wood', tag:'log', data })   // or { center:[..], size:[..] }
// collider: { id, min:Vector3, max:Vector3, surface, tag, data, enabled:true, isMover }
c.enabled = false                     // temporarily ignore (gates, toppled things)
physics.updateCollider(c)             // after editing a static collider's min/max by hand
physics.removeCollider(c)
const m = physics.addMover(physics.addBox({ center:[0,2,0], size:[3,0.5,3], surface:'wood' }));
m.setPosition(vec3 | x, y, z)         // call every step from your entity's update; m.center, m.half, m.delta
physics.setTerrain({ sample(x,z) → y, normal(x,z) → Vector3, surfaceAt?(x,z) → surface })
physics.waterLevel = 0
physics.moveCharacter(body, dt)
physics.groundHeight(x, z, fromY = Infinity) → y | -Infinity
physics.raycast(origin, dir, maxDist, { boxes, terrain, ignore: collider|Set|fn, out, terrainStep }) → { point, normal, distance, collider } | null
physics.sphereHitsWorld(center, radius) → collider | 'terrain' | null
physics.queryBox(minVec3, maxVec3, out?) → colliders overlapping
physics.terrainHeight(x, z), physics.terrainNormal(x, z, out?)
```
**Character body**: `{ position (feet, Vector3), velocity, radius = 0.35, height = 1, stepHeight = 0.4, noSnap? }`.
`moveCharacter` writes `onGround`, `ground` (collider | `'terrain'` | null), `groundNormal`,
`surface`, `hitCeiling`, `hitWall`, `wallNormal` (if you give the body one), `wallCollider`,
`onSteep`, `stepped` (metres climbed by a step-up this call). The caller applies gravity
to `velocity.y`; landing zeroes it.

Behaviour: vertical cylinder vs AABBs + heightfield; substeps of ≤ 0.12 m (no tunnelling at 40 m/s);
grounded step-up 0.4 m (0.12 m "ledge forgiveness" in the air); slides along walls (velocity
component into the wall is removed); ceiling bump; snaps down slopes/steps while walking;
you keep standing on a box until your centre is more than 0.65 × radius past its edge
(`SUPPORT_FRAC`); terrain steeper than 50° blocks climbing and makes you slide.
Movers carry whoever stands on them: the carry uses the mover's position change since the
body last stood on it, so entity update order does not matter. Jumping off a mover inherits
half its horizontal velocity.
Raycasts ignore boxes that contain the ray origin. `groundHeight` uses the point (no radius).

## Entities (`ctx.entities`)
```js
entities.add(e) / entities.remove(e)       // remove is deferred to the end of the step; dispose(ctx) called once
entities.query(tag) → array                // REUSED array, valid until the next query of that tag; don't keep it
entities.nearest(tag, position, maxDist, filter?)
entities.registerType(name, factory)       // factory(ctx, def) → entity (spawn adds it) or null (factory spawned things itself)
entities.spawn({ type, pos:[x,y,z], yaw, ...params }) → entity | null
entities.clear(), entities.flush(), entities.countByTag(), entities.hasType(name), entities.list
entities.closestAxisPoint(e, p, out)       // point on e's hit capsule axis nearest p
```
Entity shape: contract fields plus optional `height` (hit capsule height, default `2*radius`),
`type` (set from the spawn def), `uid` (assigned), and **`hittable`** — set `false` while an
enemy is dying/knocked down: projectiles pass through it and lock-on / aim assist skip it.
Hit test for projectiles = vertical capsule from `position.y` to `position.y + height`, radius `radius`.
Setting `e.alive = false` despawns it at the end of the step. `entities.add` puts `object3d`
in the scene if it has no parent; removal takes it out.
Unknown types: warns once per type and adds a wireframe magenta marker with a text label (tag `'placeholder'`).

Optional base class: `import { Entity } from '../core/entities.js'` — `new Entity(ctx, { tags, team, radius, height, type, object3d })` gives `position` getter and no-op `update/dispose`.

## Particles (`ctx.particles`)
```js
particles.burst({ position, count = 12, color /* hex | Color | [array] */, speed = 3, spread = 1 /* 0 = along direction, 1 = sphere */,
                  direction = up, life = 0.6, size = 0.3 /* m */, gravity /* m/s² down */, kind: 'puff'|'spark'|'glow',
                  jitter = 0.1, drag, grow /* end size × */, intensity /* colour ×, >1 blooms */, alpha })
particles.spawn(position, velocity, { color, life, size, kind = 'glow', gravity, drag, grow, intensity, alpha }) // one particle (trails)
```
`puff` = soft alpha smoke that grows; `spark` = additive, falls, shrinks; `glow` = additive soft orb.
1500 particles per pool (alpha / additive), oldest overwritten when full. Two draw calls total.
Tip: hoist the options object for per-step `spawn` calls (no allocations).

## Materials (`ctx.materials`)
```js
materials.toon(color, opts)        // NEW MeshToonMaterial with the shared 3-step ramp (safe to mutate)
materials.shared(color, opts)      // cached instance per color+opts (use for merged static geometry; don't mutate)
materials.glow(color, intensity=2.2, opts) // unlit HDR MeshBasicMaterial; intensity > ~1 blooms on 'high'
materials.outline(meshOrObject, thickness = 0.025, color = palette.outline) // inverted hull child(ren); InstancedMesh supported
materials.canvasTexture(w, h, (g2d, w, h) => {...}, { repeat:[u,v], srgb:true, nearest:false })
materials.softDotTexture()         // cached soft round sprite (halos, blob shadows)
materials.palette                  // numbers: skyTop skyMid horizon moss mossDark bark bog glowCyan glowMagenta amber iron outline
                                   // + cream ochre capDark scarf straw burlap mud stone leaf updraft white ink; hyphen aliases ('sky-top')
materials.gradientMap
```
Outline thickness is in the mesh's local units (a 0.5 m scaled mesh gets half). Hulls use
crack-free averaged normals (`outlineNormal` attribute, computed once per geometry). Mark a
mesh `userData.noOutline = true` to skip it when outlining a group.

## Renderer (`ctx.gfx`)
```js
gfx.setQuality('high'|'medium'|'low')  // also ctx.setQuality / __game.setQuality; manual calls disable auto-quality
gfx.quality, gfx.autoQuality
gfx.setFog(color, density)             // zones may tint fog (sky's below-horizon colour follows)
gfx.sun (DirectionalLight, shadows), gfx.hemi, gfx.rim (warm fill), gfx.sky (dome mesh)
gfx.lightDir (to the light), gfx.moonDir, gfx.glowDir (afterglow azimuth), gfx.bloom (UnrealBloomPass | null)
gfx.width, gfx.height, gfx.resize(), gfx.render()
```
* high: DPR ≤ 2, 2048 shadows, bloom (strength 0.45, radius 0.4, threshold 0.95 — only HDR emissive >~1 blooms). medium: DPR ≤ 1.5, 2048, no bloom. low: DPR 1, 1024, no bloom.
* Auto-quality: average frame > 24 ms over 3 s while `playing` → `low`, silently, once.
* ACES filmic, exposure 1.0, sRGB output. `FogExp2(0x2a5a52, 0.0135)`.
* Shadows: three r185 deprecates `PCFSoftShadowMap` (it warns and falls back), so core uses `PCFShadowMap` with `shadow.radius = 3`, which is the soft PCF in this version. The ±24 m shadow frustum follows Morel, snapped to texels. Set `castShadow` / `receiveShadow` on your meshes.

## Player — Morel (`ctx.player`)
```js
player.position, player.velocity, player.yaw, player.hp, player.maxHp
player.state        // 'ground' | 'air' | 'glide' | 'updraft' | 'hurt' | 'dead'  ('hurt' also while sunk in water)
player.tonic        // { kind, remaining, duration } | null
player.setTonic(kind, duration = 20)   // same kind refreshes; another kind ends the old one first; null ends
player.lockTarget, player.locking      // locking = lock button held (strafe), even without a target
player.respawnAt(position, yaw)        // settle onto ground, pop animation; does NOT heal or grant invulnerability
player.teleport(position, yaw?)        // instant, no settle/pop (debug)
player.setCheckpoint(id, position, yaw), player.checkpoint → { id, position, yaw }
player.heal(n) → healed amount, player.damage(n, fromPosition?) → bool (false if invulnerable)
player.hurt(amount, info)              // entity-style alias of damage(amount, info.from)
player.launch(vy)                      // bounce shrooms: sets vy, cancels glide and jump-cut
player.invulnerable                    // god || hurt timer || dead || sunk
player.god                             // godMode
player.charge                          // 0..1 while charging
player.onGround, player.body, player.model, player.radius (0.32), player.height (1.05), player.team 'player', player.tags {'player'}
player.safePosition                    // last safe ground (water respawn point)
```
Morel is **not** in `entities` (enemies use `ctx.player` directly); enemy projectiles hit him via `player.damage`.

`TUNING` (exported from `src/game/player.js`) holds every constant: run 8.5, accel 70/28, jump 11.5,
gravity 32/48, jump cut 55 %, coyote/buffer 0.12, glide fall 2.4 / horizontal 7.5 (fast falls are
caught at 45 m/s²), updraft 6 m/s (capped at 30 m above the last ground), throw cooldown 0.22,
charge 0.9 s, max 3 throws alive, quick puff 1 dmg / 26 m/s / 18 m, ≥50 % charge 2 dmg, full charge
3 dmg / 32 m/s / 26 m, aim-assist cone 25° (bends with 5 rad/s homing and a 35 % initial aim),
lock range 22 m (kept to 30 m), hp 5, invulnerability 1.3 s, knockback 7 + 6 up, hurt stun 0.35 s.

Tonics: **anvil** → `'iron'` balls, 3 dmg (4 charged), `heavy: true`, slight lob;
**updraft** → hold jump in the air after the jump apex to rise at 6 m/s with a spore jet;
**seeker** → each throw fires 3 magenta `'seeker'` puffs fanned ±26°, 1 dmg each (2 charged), each
homing on a different nearby enemy. Events `tonic:start {kind, duration}`, `tonic:warning {kind, remaining: 3|2|1}`, `tonic:end {kind}`.

Water: below `waterLevel + 0.3` while not standing on a box collider → splash, −1 heart,
0.7 s later respawn at the last safe ground (≥ 0.8 m above water, solid 0.75 m around, not a
mover, not a collider tagged `'unsafe'`). Below y = −30 counts as water too. 0 hp → death:
`ctx.state = 'dead'`, splat, 1.4 s, respawn at checkpoint with full hp.

## Camera (`ctx.cameraRig`)
```js
cameraRig.yaw, cameraRig.pitch, cameraRig.distance (7.5), cameraRig.currentDistance, cameraRig.pivot
cameraRig.shake(amount = 0.25 /* m */, duration = 0.35)   // e.g. boss stomp: shake(0.5, 0.5)
cameraRig.snapBehind()                                   // behind Morel at default distance/pitch (teleport/respawn call it)
cameraRig.setView(yaw, pitch, distance)                   // debug/screenshots (distance kept until the next snapBehind; suppresses auto-recentre for ~4.5 s)
```
Yaw convention: camera looks along `(sin yaw, 0, cos yaw)` (yaw 0 = looking +Z), movement input is
relative to it. Pivot 1.15 m above Morel's feet plus a velocity lead; vertical follow ignores small hops.
Pitch clamp −0.3…1.15. Auto-recentre after 1.5 s without camera input, only while pushing forward.
Q/E snap ±45°. Lock-on: swings behind Morel facing the target, frames 30 % toward the target, pulls back up to 11 m.
Collision: 5 rays (centre + offsets) from the pivot; pulls in instantly, eases out; min 0.3 m;
when closer than 1.6 m it rises a little and looks past the pivot so the view stays level.
`CAMERA_TUNING` exported from `src/game/camera.js`. Click on the canvas while playing requests pointer lock.

## Projectiles (`ctx.projectiles`)
```js
projectiles.spawn({ team: 'player'|'enemy'|'neutral', kind: 'puff'|'iron'|'seeker'|'mud', position, velocity,
                    damage = 1, radius = 0.25, life = 2, range = Infinity, gravity = 0 /* m/s² down */,
                    homing: entity|null, homingStrength = 6 /* rad/s-ish */, heavy = false,
                    mesh /* custom Object3D, not pooled */, owner, group, charge }) → record
projectiles.active, projectiles.count(filterFn), projectiles.kill(p, withBurst), projectiles.clear()
```
Each step: homing turn, gravity, substepped move; hits checked first against entities
(player/neutral teams hit alive `hurt`-able, `hittable !== false` entities whose team is not
`'player'` — neutral projectiles skip neutral entities), then the player (enemy/neutral teams), then
the world (`sphereHitsWorld` with 0.8 × radius), then water. `hurt(amount, info)` gets
`info = { kind, heavy, from (spawn point), dir (unit), source (record), charge, team }`.
Entity/world/water hits emit `projectile:hit` and burst; life/range expiry fizzles silently.
At most 128 alive (oldest recycled). Owner entity is never hit by its own projectiles.

## Test arena (`src/core/testArena.js`)
Flat test pad at y = 1 (x −16…34, z −8…44) inside gentle hills, water level 0.
`ctx.level.testPoints`:
* `lanes[h]` for h = 0.2, 0.35, 0.5, 1, 2: `{ start:[x,1,4], box }` — walk +Z into a box of height h at z 8…11.
* stairs 6 × 0.3 m at x 19…22, z 8…14 with a 1.8 m landing; ladder (1.5 m rises) `ladder[]`; glide tower top `towerTop` (y 7, 6 m above the pad), `towerEdge` (walk −Z off it).
* `wall` collider (x −14…−2, z 38…39, 8 m tall), `wallFront` spot; thin `slab` (0.3 m, top y 4) + `slabCenter`.
* `mover` entity (`.collider`, 3×0.5×3 raft, z 12 ↔ 26 at x 27, 3 m/s, 1 s pause), `moverStart`.
* `dummies[]` at (2,1,18), (8,1,24), (−2,1,32); `pool` (−27, 0, 10, r 9), `poolEdge`; steep `mound` (30, −22); `open`.
* checkpoints `start` (0,1,0), `tower`, `far`.
`'dummy'` entity type: straw training dummy, tags `enemy dummy target`, team `enemy`, 3 hp, radius 0.42, height 1.65,
wobbles on hits, topples at 0 hp (`hittable = false`, loses the `enemy` tag) and pops back after 3 s.
Emits `enemy:hurt` / `enemy:killed` (`points: 0`). Sandboxes: `boot()` uses the arena by default.

## Debug API — `window.__game`
Contract: `ctx, start(), step(n), teleport(x,y,z), checkpoints(), gotoCheckpoint(id), state(), give(kind), godMode(on), setInput({move:[x,y], jump, throw, lock} | null)`.
* `step(n)` runs n fixed steps synchronously **and switches the loop to manual mode** (rendering continues every rAF, simulation only advances via `step`). `__game.realtime(true)` goes back to real time. Returns `state()`.
* `setInput` also accepts the other action names (`camLeft`, `pause`, `confirm`, …). Edges are generated between steps, so `setInput({jump:true}); step(1); setInput({}); …` is a tap.
* `teleport(x, y, z, yaw?)` does not settle onto the ground; `gotoCheckpoint` does (and sets the checkpoint).
* `state()` → `{ state, time, frame, player:{pos, vel, yaw, hp, maxHp, state, onGround, tonic, lock, invulnerable, checkpoint}, score, combo:{chain, multiplier, timeLeft}, zone, flags, entities:{tag: count}, projectiles, quality }`.
* Extensions: `realtime(on)`, `render()`, `setQuality(q)`, `setCamera(yaw, pitch, distance)`, `spawn(def)`,
  `events(filter?)` (last 400 events `{t, frame, name, payload}` with JSON-safe payloads; filter = name prefix or fn), `clearEvents()`, `player`, `TUNING`.

## Measured movement (test arena, `tools/scenarios/core-movement.mjs`)
| Move | Result |
|---|---|
| Run speed | 8.50 m/s |
| Full jump (hold) apex | **1.97 m** (air 0.63 s) |
| Tap jump apex | **0.52 m** (air 0.30 s) |
| Running full jump, flat → same height | **5.4 m** |
| Running tap jump | 2.55 m |
| Running jump + glide, flat | 9.2 m (air 1.18 s) |
| Walk off 6 m ledge, no glide | 4.1 m from the edge (0.48 s) |
| Walk off 6 m ledge, glide (opened after coyote) | **16.8 m** (2.2 s) |
| Running jump off 6 m ledge, no glide | 7.8 m |
| Running jump off 6 m ledge + glide | **28.0 m** (3.7 s) |
| Glide ratio | ≈ 3.1 m forward per 1 m of drop (7.5 / 2.4) |
| Updraft | +6 m/s while held, ≥ 8 m in 1.5 s; capped 30 m above last ground |
| Step-up | 0.35 m walks up; 0.5 m and 1.0 m block (need a jump) |
| Highest ledge reachable with a running jump | **2.0 m** (2.1 m fails; apex 1.97 + 0.12 m air ledge-forgiveness). Use ≤ 1.7 m for comfortable platforming |
| Fall | 60 m drop lands cleanly on a 0.3 m slab (terminal 40 m/s) |

Design rules of thumb: gaps ≤ 4.5 m for a plain running jump, ≤ 8 m with a glide from level
ground, a glide covers ~3 m per metre of drop; walkable surfaces must sit ≥ 0.3 m above water
unless they are box colliders (logs/pads), safe-respawn ground ≥ 0.8 m above water.

## Usage examples

### Register an entity type, move it with physics, fire an enemy projectile
(This exact code runs in `tools/scenarios/core-example.mjs`.)
```js
import * as THREE from 'three';
ctx.entities.registerType('grunt', (ctx, def) => {
  const M = ctx.materials;
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), M.toon(0x6f8f3a));
  body.position.y = 0.5; body.castShadow = true;
  M.outline(body, 0.03);
  root.add(body);
  root.position.fromArray(def.pos);
  const e = {
    object3d: root, tags: new Set(['enemy', 'grunt']), alive: true, team: 'enemy',
    radius: 0.5, height: 1.0, hp: def.hp ?? 2, cooldown: 1,
    body: { position: root.position, velocity: new THREE.Vector3(), radius: 0.45, height: 1.0 },
    get position() { return root.position; },
    update(dt, ctx) {
      const b = e.body, p = ctx.player.position;
      const dx = p.x - b.position.x, dz = p.z - b.position.z, d = Math.hypot(dx, dz) || 1;
      const speed = d > 4 ? 3 : 0;
      b.velocity.x = (dx / d) * speed; b.velocity.z = (dz / d) * speed;
      b.velocity.y -= 30 * dt;                       // you own gravity
      ctx.physics.moveCharacter(b, dt);              // walls, steps, slopes, movers, terrain
      root.rotation.y = Math.atan2(dx, dz);
      e.cooldown -= dt;
      if (d < 12 && e.cooldown <= 0) {               // lob mud at Morel
        e.cooldown = 1.5;
        const from = root.position.clone().setY(root.position.y + 0.8);
        const to = p.clone().setY(p.y + 0.5);
        const t = from.distanceTo(to) / 14;
        const vel = to.sub(from).divideScalar(t);
        vel.y += 0.5 * 18 * t;                       // gravity compensation
        ctx.projectiles.spawn({ team: 'enemy', kind: 'mud', position: from, velocity: vel, damage: 1, radius: 0.3, gravity: 18, life: 3, owner: e });
      }
    },
    hurt(amount, info) {                             // return false to deflect (armour)
      e.hp -= amount;
      ctx.events.emit('enemy:hurt', { entity: e, type: 'grunt', amount, hp: e.hp });
      if (e.hp <= 0) {
        ctx.events.emit('enemy:killed', { entity: e, type: 'grunt', position: root.position.clone(), points: 200 });
        ctx.particles.burst({ position: root.position, count: 20, color: [0x6f8f3a, 0xffffff], speed: 4, kind: 'puff' });
        e.alive = false;                             // despawned + dispose() at end of step
      }
      return true;
    },
    dispose() { body.geometry.dispose(); },
  };
  return e;
});
ctx.entities.spawn({ type: 'grunt', pos: [0, 1, 6], hp: 2 });
```

### A per-step system and events
```js
const off = ctx.events.on('enemy:killed', ({ position, points }) => ctx.hud.toast(`+${points}`, 1));
ctx.addSystem({ update(dt, ctx) { /* combo timer */ }, frame(realDt, ctx) { /* HUD tween */ } });
ctx.events.emit('ui:message', { text: 'Hold Space to glide', duration: 3 });
```

### Moving platform with a mover collider
```js
const col = ctx.physics.addMover(ctx.physics.addBox({ center: [0, 2, 10], size: [3, 0.5, 3], surface: 'wood' }));
entity.update = (dt) => { t += dt; mesh.position.set(Math.sin(t) * 4, 2, 10); col.setPosition(mesh.position); };
```

### Scenario test
```js
// tools/scenarios/<area>-thing.mjs ; run: node tools/scenario.mjs tools/scenarios/<area>-thing.mjs --html dist/dev-<area>/index.html --shots dist/dev-<area>/shots
export default async function (page, h) {
  await h.wait(300);
  const r = await h.game((g) => {
    g.godMode(true);
    g.teleport(0, 1, -4, 0);                 // yaw 0 faces +Z
    g.setCamera(0, 0.22, 7.5);               // movement is camera-relative
    g.step(10);
    g.setInput({ move: [0, 1], jump: true }); // hold forward + jump
    g.step(30);
    g.setInput({ throw: true }); g.step(1); g.setInput({}); g.step(30); // tap throw
    g.setInput(null);
    return { state: g.state(), hits: g.events('projectile:hit').length };
  });
  await h.wait(400);                          // let a frame render before the screenshot
  await h.shot('after-jump');
  return r;
}
```

## Sandbox
`src/dev/core.js` boots the test arena and adds a small controls legend (sandbox only) plus
keys **1 / 2 / 3** to drink an Anvil / Updraft / Seeker tonic. Open `dist/dev-core/index.html`
directly (file://). Click the canvas for pointer-lock mouse look (falls back to drag-look).

Performance in the arena at 960×540: 155 draw calls on `high` including the shadow pass and
bloom (141 on `low`), ~94 k triangles; one fixed step (all systems, no render) ≈ 0.14 ms CPU.
Morel is ~26 meshes + outline hulls; only the big shapes cast shadows.

## How to test
```
node tools/build.mjs --entry src/dev/core.js --out dist/dev-core --dev
node tools/smoke.mjs --html dist/dev-core/index.html --out dist/dev-core/smoke.png --w 960 --h 540
node tools/scenario.mjs tools/scenarios/core-movement.mjs --html dist/dev-core/index.html --shots dist/dev-core/shots   # numbers above
node tools/scenario.mjs tools/scenarios/core-physics.mjs  --html dist/dev-core/index.html --shots dist/dev-core/shots   # 15 checks
node tools/scenario.mjs tools/scenarios/core-combat.mjs   --html dist/dev-core/index.html --shots dist/dev-core/shots   # 10 checks
node tools/scenario.mjs tools/scenarios/core-camera.mjs   --html dist/dev-core/index.html --shots dist/dev-core/shots   # 4 checks
node tools/scenario.mjs tools/scenarios/core-states.mjs   --html dist/dev-core/index.html --shots dist/dev-core/shots   # 4 checks, real keyboard
node tools/scenario.mjs tools/scenarios/core-example.mjs  --html dist/dev-core/index.html --shots dist/dev-core/shots   # docs example + placeholder rule
node tools/scenario.mjs tools/scenarios/core-shots.mjs    --html dist/dev-core/index.html --shots dist/dev-core/shots   # screenshots
```
`tools/scenarios/core-helpers.mjs` has a reusable deterministic jump/glide trial (`__t.jump`).
Headless SwiftShader is slow (~100–300 ms per frame, the first frames compile shaders for a few
seconds): use `step()`, and wait on conditions (`page.waitForFunction`) rather than fixed delays
when you drive the real-time loop. Auto-quality drops to `low` after 3 s of real-time play in
headless runs; call `__game.setQuality('high')` before screenshots.

## Contract deviations / additions (precise)
1. `ctx` gains `gfx`, `projectiles`, `menus` (stub), `systems`, `addSystem()`, `setState()`, `simulating`, `setQuality()`, `time.real`. `time.frame` counts fixed steps.
2. Input has extra actions `camLeft camRight up down left right` and methods `keyDown, pressedAny, cancel, setOverride, requestPointerLock, exitPointerLock, mouseMode, pointerLocked`. `setVirtual` look values are pixel deltas (scaled internally); fields are partial updates.
3. `physics.addBox` also accepts `{center, size}`; `addMover(collider)` returns the same collider with `setPosition`, `center`, `half`, `delta`. Extras: `updateCollider`, `queryBox`, `terrainHeight`, `terrainNormal`, `clear`. `groundHeight` returns `-Infinity` when nothing is below. `raycast` takes `opts.out` to avoid allocation; boxes containing the origin are ignored.
4. `entities.query()` returns a reused array. Entities may define `height` and `hittable`. Extras: `flush, countByTag, hasType, closestAxisPoint, list`, `Entity` base class.
5. `particles.spawn()` (single particle) added; `burst` options documented above (`spread` meaning, `direction`, `jitter`, `drag`, `grow`, `intensity`, `alpha`).
6. `materials.shared()`, `glow()`, `softDotTexture()`, `gradientMap`; `toon()` always returns a new material.
7. Player extras: `teleport`, `god`, `charge`, `locking`, `checkpoint`, `safePosition`, `cameraNear`, `hurt()`, `die()`, `resetVisuals()`. `respawnAt` does not heal or grant invulnerability.
8. Events: `player:step` added; `projectile:hit` has `deflected` / `collider`; `player:charge {level:0}` only after a 0.15 s hold; water fall also emits `player:hurt`; its `player:respawn` has `checkpointId: null`.
9. Damage values beyond the brief: ≥ 50 % charge = 2 dmg; charged iron = 4; charged seeker = 2 per puff. Updraft is capped 30 m above the last ground (`TUNING.updraftMaxRise`).
10. Water rule refinement: standing on a **box collider** below `waterLevel + 0.3` is safe (logs/lily pads); only terrain or air triggers the fall.
11. `__game.step` switches the loop to manual stepping; `__game.realtime()` restores it. `teleport` takes an optional yaw.
12. Shadows use `PCFShadowMap` + `radius` (r185 deprecates `PCFSoftShadowMap`).

## Integration notes
* **main.js**: replace with `boot({ startState: 'title', buildLevel, install: [...] })`. Installers run *before* `buildLevel`, so entity types are registered before the level spawns them. `buildLevel` must call `physics.setTerrain(...)`, add colliders, spawn entities and return the level object (spawn + checkpoints in order + `zone`).
* **UI**: core already toggles `playing ⇄ paused` on Esc/P/Start and pauses on pointer-lock loss or hidden tab; listen to `game:state` to show/hide menus. Leave the title with `ctx.setState('playing')`. `'dead'` lasts 1.4 s and core returns to `'playing'` itself. For touch, call `ctx.input.setVirtual(...)`. Menus can read `input.pressed('confirm'|'back'|'up'|'down'|'left'|'right')` from a `frame()` system while not playing. `page.html` is minimal (`#app`, empty `#ui` with `pointer-events: none`), restyle freely but keep `#app` and the two markers.
* **Audio**: replace `ctx.audio` in `installAudio`; core calls `ctx.audio.unlock()` on the first pointer/key/touch. `player:step` gives footsteps with `surface`.
* **Score**: replace `ctx.score`; keep `points`, `chain`, `multiplier`, `timeLeft` fields (read by `__game.state()`); clear the combo on `player:hurt`/`player:died` per the brief.
* **Pickups**: tonic jar → `ctx.player.setTonic(kind)` (20 s default); berry → `ctx.player.heal(1)` then emit `pickup:berry`; checkpoint → `ctx.player.setCheckpoint(id, pos, yaw)` + emit `checkpoint:reached`, and give the entity `checkpointId` (or list checkpoints in `level.checkpoints`) so `__game.checkpoints()` sees it.
* **Level mechanisms**: moving platforms / sinking pads use `physics.addMover(collider).setPosition()` every step; bounce shrooms `ctx.player.launch(power)`; iron gates `collider.enabled = false` or `removeCollider`; thorns `ctx.player.damage(1, hazardPos)`. Tag colliders that must never be a water-respawn point `tag: 'unsafe'`. Fog per zone: `ctx.gfx.setFog(color, density)`.
* **Enemies**: tag `'enemy'`, `team: 'enemy'`, implement `hurt()` (return `false` to deflect; `info.heavy` for Anvil hits), set `hittable = false` during death animations, emit `enemy:*` themselves. Fire with `ctx.projectiles.spawn({ team: 'enemy', kind: 'mud', ... })`. Boss stomps: `ctx.cameraRig.shake(0.5, 0.5)`.
* **Glows**: use `materials.glow(color, 1.5..3)` for anything that should bloom; plain toon colours never bloom.
* The test arena registers a `'dummy'` type and spawns its own raft entity (`'arenaMover'`); it does not register any type the other areas own.

## Integration changes
* `TUNING.deathTime` is 1.4 s (was 1.6): the brief's splat length. The UI curtain is down at 1.1 s.
* Scarf tails: the 6 ribbon segments are one `InstancedMesh` + one instanced outline hull (the tip colour is an
  instance colour on the shared scarf material, so the hurt flash still reaches it). 12 draw calls became 2.
* Camera: the title / results orbit has its own tuning (`CAMERA_TUNING.orbitRate`, `titleDistance`, `titlePitch`,
  `titleShift`). On the title, wide screens aim the view left of Morel so he stands beside the menu panel.
* `src/main.js` is the integration entry now (see docs/integration.md); the test arena stays the sandbox default.
