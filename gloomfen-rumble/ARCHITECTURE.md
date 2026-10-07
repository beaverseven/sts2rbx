# Gloomfen Rumble — design and architecture contract

An original 3D browser platformer. It borrows *genre mechanics* from early-2000s
3D platformers (charged throw, lock-on strafing, glide, timed power-up tonics,
combo-multiplier scoring) but every character, name, place, level layout, sound
and piece of music is original. **Never use names, characters, level layouts,
art or music from Rayman or any other existing game.**

Everything is procedural: geometry is built from Three.js primitives, textures
are drawn on canvases, audio is synthesized with WebAudio. There are no asset
files. The game ships as a single self-contained HTML file.

## The game

**Hero — Morel.** A small morel-mushroom sprite, about 1.1 m tall. Tall conical
honeycomb cap (amber/ochre with darker pits), pale cream stalk body, big dark
eyes with white glints, a short mossy-green scarf whose ends trail behind,
stubby attached arms and legs (no floating hands), and a large dock leaf he
carries as a parasol. Animations are procedural (squash/stretch, bob, lean).

**World — Gloomfen.** A twilight fairy-tale bog: deep indigo-to-teal sky with a
warm amber horizon, a big pale moon, drifting fireflies, glowing magenta and
cyan mushrooms, twisted trees, dark green bog water, hanging moss, lanterns.

**Enemies — the Bog Bandits.** Squat toad goons in burlap cloaks and dented
tin-pot helmets, comically clumsy, croaking taunts. Led by **Chief
Gnarlbelly**, a huge toad in a rusty iron pot-armour riding nothing — he stomps.

**Win condition.** Reach the end of the one long level (four zones), defeat
Chief Gnarlbelly, walk into the Lantern Gate. Results screen shows score, time,
glowcaps, glowworms freed, rank.

### Controls

| Action | Keyboard + mouse | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | left stick | left virtual stick |
| Camera | mouse drag (or pointer lock), Q/E rotate | right stick | drag on right half |
| Jump / glide (hold in air) | Space | A | Jump button |
| Throw (hold to charge) | J or left mouse | X / RB | Throw button |
| Lock-on strafe (hold) | K, Shift or right mouse | LT / LB | Lock button |
| Pause | Esc / P | Start | pause icon |

### Player feel (tunable constants live in `src/game/player.js` `TUNING`)

- Run 8.5 m/s, ground accel 70 m/s², air accel 28 m/s², facing turns smoothly.
- Jump: v0 = 11.5 m/s, gravity 32 rising / 48 falling; releasing jump early cuts
  upward velocity by 55% (variable height). Coyote time 0.12 s, jump buffer 0.12 s.
- Glide: hold jump while falling → leaf parasol opens; fall speed capped at
  2.4 m/s, horizontal max 7.5 m/s. Unlimited duration.
- Throw: tap = quick puff (1 dmg, 26 m/s, 18 m range). Hold up to 0.9 s to charge
  (orb grows over Morel's hand); full charge = 3 dmg, 32 m/s, 26 m range, bigger
  hit radius. 0.22 s cooldown. Max 3 puffs alive. Soft aim assist: puffs bend toward
  the nearest enemy within a 25° cone. While locked on, puffs home on the target.
- Lock-on (hold): picks the nearest `enemy`-tagged entity in front within 22 m;
  Morel faces it and strafes; camera frames both; reticle on target.
- Health: 5 hearts. Hit → 1.3 s invulnerability (blink) + knockback.
  Falling into bog water (below `physics.waterLevel` + 0.3) → 1 heart and respawn at
  the last safe ground position. 0 hearts → death splat → respawn at the last
  checkpoint with full hearts; combo is lost; score kept. Infinite lives.

### Tonics (power-up jars), 20 s each, HUD shows a draining ring

- **Anvil Tonic** (iron blue-grey): puffs become iron balls: 3 dmg, heavy
  knockback, breaks `ironGate`s and Ironbelly armour.
- **Updraft Tonic** (spring green): holding jump in the air makes Morel rise at
  6 m/s (spore jet under him) instead of gliding.
- **Seeker Tonic** (magenta): every throw fires 3 small homing puffs.

### Scoring and combo

- Glowcap (gem) 50 · Grunt 200 · Slinger 250 · Ironbelly 400 · cage freed 500 ·
  boss phase 2000 · boss defeated 5000 · health berry 25.
- Every scoring event within 3.0 s of the previous one extends the chain and
  refills the timer. Multiplier by chain length: 1–4 ×1, 5–9 ×2, 10–19 ×3,
  20–34 ×4, 35–49 ×5, 50+ ×6. Points are multiplied when awarded; floating
  "+400 ×3" text pops at the event position. Getting hurt drains the timer to 0.
- Rank on the results screen from total score thresholds (set by integration once
  the level's maximum is known).

### The level (one continuous level, progress runs along +Z)

Bog water plane at y = 0. Ground mostly y = 1..8. Path meanders within x ∈ [-45, 45].

1. **Mossy Glade** (z 0–110) — start meadow, tutorial signposts, glowcap trails,
   first grunts, two glowworm cages, a ravine that needs a glide, checkpoint.
2. **Sunken Bog** (z 110–250) — stepping stumps, sinking lily pads, moving log
   platforms, bounce shrooms, slingers on stumps, an Updraft Tonic jar at the foot
   of a cliff the main route climbs (the jar respawns), checkpoint.
3. **Bandit Fort** (z 250–360) — palisade walls, watchtowers with slingers,
   Ironbellies, an iron gate opened with an Anvil Tonic (jar respawns), an ambush
   courtyard that locks until its wave is cleared (Seeker Tonic on offer), checkpoint.
4. **Gnarlbelly's Pit** (z 360–430) — round arena, boss fight, then the Lantern
   Gate appears; entering it completes the level.

## Code layout and ownership

```
src/
  main.js              boot, game-state machine, fixed-step loop, debug API   [core, then integration]
  page.html            title, fonts, CSS, DOM overlay markup, <!--BODY-->/<!--BUNDLE--> [core minimal, then ui]
  core/
    context.js         createContext() → ctx                                   [core]
    events.js          tiny event bus                                          [core]
    mathx.js           clamp, lerp, damp, approach, wrapAngle, rand(seeded)    [core]
    renderer.js        WebGLRenderer, scene, lights, shadows, sky, fog, resize, quality [core]
    materials.js       toon gradient, palette, outline helper, canvas textures [core]
    input.js           unified actions from keyboard/mouse/gamepad/virtual     [core]
    physics.js         static AABBs, heightfield terrain, kinematic movers, water, queries [core]
    entities.js        EntityManager + type registry for level spawns          [core]
    particles.js       pooled particle bursts                                  [core]
  game/
    player.js          Morel model + controller + throwing + lock-on           [core]
    camera.js          third-person camera rig with collision                  [core]
    projectiles.js     generic projectile system (puffs, mud balls, iron balls) [core]
    enemies/*.js       grunt, slinger, ironbelly, shared AI helpers            [enemies]
    boss.js            Chief Gnarlbelly                                        [enemies]
    pickups.js         glowcap, berry, tonic jar, cage, checkpoint, lanternGate [pickups]
    score.js           combo + score                                           [pickups]
    level/terrain.js   heightfield generation + terrain mesh                   [level]
    level/data.js      the level: zones, colliders, spawns                     [level]
    level/builder.js   builds meshes/colliders/spawns from data                [level]
    level/props.js     trees, rocks, palisades, towers, signs, lanterns...     [level]
    level/water.js     animated bog water shader                               [level]
    level/mechanisms.js movingPlatform, sinkingPad, bounceShroom, ironGate, arenaLock, hazard [level]
  audio/
    audio.js           WebAudio engine, sfx synths, music sequencer, event wiring [audio]
  ui/
    hud.js, menus.js, touch.js                                                 [ui]
  dev/                 per-agent sandbox entries (not shipped)                 [each agent its own file]
docs/                  per-area notes: docs/<area>.md                          [each agent its own file]
tools/                 build.mjs, smoke.mjs, scenario.mjs                      [shared, do not break]
```

Rule: **only edit files your area owns.** If you need something from another
area, code against the contract below; if the contract is missing something,
add a small, clearly marked shim in your own file and note it in `docs/<area>.md`
under "Integration notes" for the integrator.

## Runtime contract

### Units and axes
Metres, seconds, radians. +Y up. Level progress runs along +Z. Yaw 0 faces +Z.
Fixed simulation step `dt = 1/60`; render once per animation frame.

### `ctx` (created in `core/context.js`, passed to everything)
```js
ctx = {
  THREE,
  renderer, scene, camera,           // THREE objects (camera: PerspectiveCamera)
  events,                            // bus: on(name, fn) → off(), once, emit(name, payload)
  input,                             // see Input
  physics,                           // see Physics
  entities,                          // see Entities
  particles,                         // see Particles
  materials,                         // see Materials
  audio,                             // set by audio area; core installs a silent stub with the same API
  player, cameraRig,                 // set by core
  score, hud, level,                 // set by their areas (stubs until then)
  time: { now: 0, dt: 1/60, frame: 0 },   // `now` = simulation seconds while playing
  state: 'boot',                     // 'title' | 'playing' | 'paused' | 'dead' | 'results'
  settings: { sensitivity: 1, invertY: false, master: 0.8, music: 0.6, sfx: 0.9, quality: 'high' },
  flags: {},                         // free-form progress flags (e.g. flags.gateFortOpen)
}
```

### Events (names and payloads are the contract)
| Event | Payload |
|---|---|
| `player:jump` | `{ position }` |
| `player:land` | `{ position, impact }` (impact = downward speed) |
| `player:glide` | `{ on: boolean }` |
| `player:throw` | `{ position, charge, kind }` (kind: `'puff' \| 'iron' \| 'seeker'`) |
| `player:charge` | `{ level }` (0..1, emitted when charging starts and at full) |
| `player:hurt` | `{ amount, hp, maxHp, position }` |
| `player:fell` | `{ position }` (fell in water) |
| `player:died` | `{ position }` |
| `player:respawn` | `{ position, checkpointId }` |
| `projectile:hit` | `{ position, target, damage, kind }` (target may be null = world) |
| `enemy:alert` | `{ entity, type }` |
| `enemy:hurt` | `{ entity, type, amount, hp }` |
| `enemy:killed` | `{ entity, type, position, points }` |
| `armor:break` | `{ entity, position }` |
| `pickup:glowcap` | `{ position, points }` |
| `pickup:berry` | `{ position, hp }` |
| `tonic:start` | `{ kind, duration }` |
| `tonic:warning` | `{ kind, remaining }` (last 3 s, once per second) |
| `tonic:end` | `{ kind }` |
| `cage:freed` | `{ position, points, freed, total }` |
| `checkpoint:reached` | `{ id, position }` |
| `zone:enter` | `{ id, name }` |
| `gate:open` | `{ id, position }` |
| `arena:lock` / `arena:clear` | `{ id }` |
| `boss:start` | `{ maxHp }` |
| `boss:phase` | `{ phase }` (1..3) |
| `boss:hurt` | `{ hp, maxHp }` |
| `boss:defeated` | `{ position }` |
| `score:award` | `{ points, base, multiplier, position, reason }` |
| `combo:update` | `{ chain, multiplier, timeLeft, timeMax }` |
| `combo:end` | `{ chain, total }` |
| `level:complete` | `{ stats }` |
| `game:state` | `{ state, prev }` |
| `ui:message` | `{ text, duration }` (toast / tutorial hint) |

Score area listens to `enemy:killed`, `pickup:glowcap`, `cage:freed`, `boss:*`
and emits `score:award`/`combo:*`. Audio and HUD only *listen*.

### Input (`ctx.input`)
```js
input.move        // THREE.Vector2, x = right, y = forward, length ≤ 1 (camera-relative is the player's job)
input.look        // THREE.Vector2, camera yaw/pitch delta this frame (radians, already scaled)
input.down(action) / input.pressed(action) / input.released(action)
                  // actions: 'jump' 'throw' 'lock' 'pause' 'confirm' 'back'
input.setVirtual({ move: {x,y}, look: {x,y}, buttons: { jump, throw, lock, pause } })  // touch layer
input.lastDevice  // 'keyboard' | 'gamepad' | 'touch'
input.endFrame()  // called by the loop after each fixed update (clears pressed/released edges)
```

### Physics (`ctx.physics`)
```js
physics.addBox({ min:[x,y,z], max:[x,y,z], surface:'moss'|'wood'|'stone'|'mud'|'iron', tag, data }) → collider
physics.removeCollider(collider)
physics.addMover(collider)                 // kinematic: set collider.min/max each step via mover.setPosition(center)
physics.setTerrain({ sample(x,z) → height, normal(x,z) → Vector3 }) // floor-only heightfield
physics.waterLevel                         // number (0)
physics.moveCharacter(body, dt)            // body: { position, velocity, radius, height, onGround,
                                           //   ground: collider|'terrain'|null, groundNormal, hitCeiling, hitWall }
physics.groundHeight(x, z, fromY)          // highest walkable surface below fromY (terrain or box top)
physics.raycast(origin, dir, maxDist, opts) → { point, normal, distance, collider } | null
physics.sphereHitsWorld(center, radius)   → collider|'terrain'|null
```
Character collision: vertical cylinder vs AABBs + terrain, step-up 0.4 m,
carried by movers it stands on, slides along walls.

### Entities (`ctx.entities`)
```js
// An entity is any object with:
//   { object3d, tags:Set<string>, alive:true, radius, team:'player'|'enemy'|'neutral',
//     update(dt, ctx), dispose(ctx), hurt?(amount, info) → boolean, position getter → object3d.position }
entities.add(entity) / entities.remove(entity)
entities.query(tag) → array
entities.nearest(tag, position, maxDist, filter?) → entity|null
entities.registerType(name, factory)        // factory(ctx, spawnDef) → entity
entities.spawn(spawnDef)                     // spawnDef = { type, pos:[x,y,z], yaw?, ...params }
entities.clear()
```
`entities.spawn()` with a type nobody has registered yet must not throw: it warns
once per type and adds a small labelled placeholder marker, so areas can be
built and tested before the others exist.
`hurt(amount, info)` info = `{ kind, heavy:boolean, from:Vector3, dir:Vector3, source }`.
Return `false` if the hit was deflected (e.g. armour), `true` if it landed.

Registered spawn types (the level data uses exactly these names):
- enemies area: `grunt`, `slinger`, `ironbelly`, `boss`
- pickups area: `glowcap` (`{pos}`), `glowcapLine` (`{from, to, count}`), `glowcapRing`
  (`{pos, radius, count}`), `berry`, `tonic` (`{kind:'anvil'|'updraft'|'seeker', respawn:true}`),
  `cage`, `checkpoint` (`{id}`), `lanternGate` (hidden until `boss:defeated`)
- level area: `movingPlatform` (`{size:[x,y,z], path:[[x,y,z],...], speed, pause}`),
  `sinkingPad` (`{radius}`), `bounceShroom` (`{power}`), `ironGate` (`{id, size}`),
  `arenaLock` (`{id, bounds, gates:[...], waves:[[spawnDef...]...]}`), `sign` (`{text}`),
  `zoneTrigger` (`{id, name, bounds}`), `hazard` (`{kind:'thorns', size}`)

### Player (`ctx.player`, core)
```js
player.position, player.velocity, player.yaw, player.hp, player.maxHp
player.state       // 'ground' | 'air' | 'glide' | 'updraft' | 'hurt' | 'dead'
player.tonic       // { kind, remaining, duration } | null
player.setTonic(kind, duration)  // core implements all tonic effects (iron throws, updraft rise, seeker
                                 // triple homing) and emits tonic:start / tonic:warning / tonic:end.
                                 // The pickups area only owns the jar entity that calls this.
player.lockTarget  // entity | null
player.respawnAt(position, yaw)
player.setCheckpoint(id, position, yaw)
player.heal(n), player.damage(n, fromPosition)
player.launch(vy)  // bounce shrooms etc.
player.invulnerable // boolean
```

### Projectiles (`ctx.projectiles`, core)
```js
projectiles.spawn({ team, kind, position, velocity, damage, radius, life, gravity=0,
                    homing: entity|null, homingStrength, heavy:false, mesh? })
```
On hitting an entity of the opposite team with `hurt`, calls `hurt()` and emits
`projectile:hit`. Enemies use `team:'enemy'`; it damages the player via
`player.damage()`.

### Particles (`ctx.particles`)
`particles.burst({ position, count, color, speed, spread, life, size, gravity, kind:'spark'|'puff'|'glow' })`

### Materials (`ctx.materials`)
`materials.toon(color, opts)` → MeshToonMaterial with the shared 3-step gradient,
`materials.outline(mesh, thickness, color)` adds an inverted-hull outline,
`materials.palette` named colours, `materials.canvasTexture(w, h, drawFn)`.

### Audio (`ctx.audio`)
```js
audio.unlock()                    // call on first user gesture
audio.play(name, { volume, pitch, position })   // position: Vector3 → simple distance/pan
audio.music(trackName | null)     // 'title' | 'glade' | 'bog' | 'fort' | 'boss' | 'victory' | null
audio.setVolumes({ master, music, sfx })
```
The audio area wires itself to events in `installAudio(ctx)`.

### UI (`ctx.hud`)
`installUI(ctx)` builds HUD + menus from the DOM in `page.html`, listens to
events, and exposes `hud.toast(text, sec)`, `hud.showBossBar(on)`,
`menus.show('title'|'pause'|'dead'|'results', data)`.

### Debug API (for automated playtests) — `window.__game`
```js
__game.ctx
__game.start()                    // skip title, begin play
__game.step(n)                    // run n fixed updates synchronously (no render)
__game.teleport(x, y, z)
__game.checkpoints()              // [{id, position}] in order
__game.gotoCheckpoint(id)
__game.state()                    // { state, player:{pos,hp,state,tonic}, score, combo, zone, flags, entities:{counts by tag} }
__game.give(kind)                 // give a tonic
__game.godMode(on)
__game.setInput({ move:[x,y], jump, throw, lock })  // override input (null to release)
```

## Visual direction

Toon-shaded low-poly. Shared 3-step gradient map; inverted-hull outlines in deep
indigo (#1a1530) on characters and key props. Twilight palette:

| token | hex | use |
|---|---|---|
| sky-top | #1b1f4a | zenith |
| sky-mid | #2c6d74 | mid sky, fog tint |
| horizon | #f2a65a | sunset band |
| moss | #7fae4e | grass, moss tops |
| moss-dark | #3f6b3a | shadows, foliage |
| bark | #5a3e2b | trees, planks |
| bog | #1f3b33 | water |
| glow-cyan | #5ef2e0 | spore puffs, glowcaps |
| glow-magenta | #ff5fb2 | mushrooms, seeker |
| amber | #ffc35a | lanterns, Morel's cap highlights |
| iron | #8a97a6 | tin pots, gates, anvil |

Fog: `FogExp2` tinted between sky-mid and moss-dark. Shadows: one directional
moonlight with a soft shadow map following the player. Bloom on `quality: 'high'`.

## Performance budget
60 fps on a mid laptop iGPU at 1080p. < 250 draw calls: merge static level
geometry per material (`BufferGeometryUtils.mergeGeometries`), `InstancedMesh`
for grass, glowcaps, rocks, fireflies. Pool particles and projectiles. No
per-frame allocations in hot loops.

## Testing
- `npm run build` → `dist/index.html`. Sandboxes: `node tools/build.mjs --entry src/dev/<you>.js --out dist/dev-<you> --dev`.
- `node tools/smoke.mjs --html <page> --out <png>` — console errors + screenshot.
- `node tools/scenario.mjs <scenario.mjs> --html <page>` — scripted playtest via `window.__game`.
- Headless Chromium renders with SwiftShader (slow): keep test viewports small (960×540).
- Never write to another agent's `dist/dev-*` directory. Do not run `git` commands.
