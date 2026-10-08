# Enemies — the Bog Bandits and Chief Gnarlbelly

Squat toad goons in burlap cloaks and dented tin-pot helmets, and their chief.
Everything is built from Three.js primitives on one canvas texture atlas; no asset files.

| File | What |
|---|---|
| `src/game/enemies/index.js` | `installEnemies(ctx)`: registers `grunt` `slinger` `ironbelly` `boss`; `ctx.enemies` |
| `src/game/enemies/model.js` | texture atlas (warty skin, burlap, tin, wood, bark, cloth, brass) + `buildToad(ctx, look)` |
| `src/game/enemies/fx.js` | pooled effects: shockwave rings, clattering props, ground decals, pop-up symbols, `sfx()` |
| `src/game/enemies/common.js` | `Bandit` base class: perception, guarded locomotion, leash, common states, hurt/death, animation |
| `src/game/enemies/grunt.js` | Grunt (`GRUNT_LOOK`, `GRUNT_TUNING`) |
| `src/game/enemies/slinger.js` | Slinger (`SLINGER_LOOK`, `SLINGER_TUNING`) |
| `src/game/enemies/ironbelly.js` | Ironbelly (`IRONBELLY_LOOK`, `IRONBELLY_TUNING`) |
| `src/game/boss.js` | Chief Gnarlbelly + his throne (`BOSS_LOOK`, `BOSS_TUNING`, `createBoss`) |
| `src/dev/enemies.js` | sandbox: core test arena + 3 grunts, 2 slingers, 2 ironbellies |
| `src/dev/boss.js` | sandbox: a simple Gnarlbelly's Pit + the boss (and a sandbox-only tonic jar shim) |
| `tools/scenarios/enemies-*.mjs` | scripted playtests (below) |

## Install

```js
import { installEnemies } from './game/enemies/index.js';
boot({ install: [installAudio, installScore, installUI, installEnemies, installPickups, installMechanisms], buildLevel });
```
`installEnemies(ctx)` registers the four spawn types, creates the effect system (one
`ctx.addSystem({update})`, so effects pause with the game) and sets **`ctx.enemies`** (extension):

```js
ctx.enemies.fx        // effects API (below)
ctx.enemies.list()    // live bandits + boss
ctx.enemies.boss()    // the boss entity or null
```

## Spawn defs

All types: `{ type, pos:[x,y,z], yaw? }` plus optional:

| param | default | meaning |
|---|---|---|
| `patrol` | grunt 4, slinger 3, ironbelly 3 | wander radius around the spawn point; `0` = stands guard |
| `path` | — | `[[x,y,z], ...]` patrol waypoints instead of random wandering |
| `leash` | grunt 14, slinger 14, ironbelly 12 | max distance from `leashCenter` they will follow Morel |
| `leashCenter` | spawn point | `[x,y,z]` |
| `noticeRange` | grunt 13, slinger 16, ironbelly 11 | sight range (front cone ±110°; any direction within 45 % of it); needs line of sight |
| `aggro` | false | start alerted (arena waves) |
| `dropIn` | false | fall in from 4 m with a '!' and a dust poof (boss summons) |
| `hp`, `points` | per type | overrides |
| `armored` (ironbelly) | true | `false` = spawns without his cauldron |

The spawn point is settled onto the ground below `pos` (up to 3 m down). Put bandits on ground at
least 0.3 m above the water level.

Boss: `{ type:'boss', pos:[0,2,402], arena?:{ center:[0,2,395], radius:22 }, throne?:true, yaw? }`
(defaults as shown; `yaw` defaults to facing the arena centre). The throne (bound logs, banner,
stumps, sack pile + 3 box colliders) is built behind `pos`; pass `throne:false` if the level builds its own.

## Entity shape (contract + extras)

Every bandit: `tags` `enemy`, `bandit`, its type (ironbelly also `armored` until broken; boss: `boss`),
`team: 'enemy'`, `radius`/`height` = hit capsule (grunt 0.6/1.3, slinger 0.52/1.35, ironbelly 0.82/1.35,
boss 1.9/4.0), `hittable`, `hp`, `maxHp`, `points`, `state`, `body` (physics body),
`hurt(amount, info) → boolean` (false = deflected), `debug()` (JSON-safe snapshot for scenarios).
While dying they lose the `enemy` tag and `hittable` is false (lock-on and projectiles ignore them).

## Behaviour

Shared (`Bandit`):
* **Perception**: notice range + front cone + `physics.raycast` line of sight (every 0.2 s). Once aware
  they keep tracking to `loseRange` (20–24 m) and give up after 3 s without sight or when Morel is more
  than `leash + giveUp` from their post (grunt/ironbelly +6 m, slinger +12 m): '?' pop, walk home.
* **Alert**: '!' speech burst + hop + croak, emits `enemy:alert {entity, type}`; bandits within 8 m who
  have not noticed yet follow 0.25–0.6 s later.
* **Movement**: `physics.moveCharacter` (gravity 30, step-up 0.35), separation from other bandits.
  **Ground guard** every step: a near probe just past the body may be at most 0.5 m lower, a far probe
  at most 0.6 m below that (slopes OK, ledges not), and both must be ≥ `waterLevel + 0.3`; otherwise the
  horizontal velocity is zeroed. This applies to walking, backing off, belly-flop hops and knockback
  (they teeter at edges). A safety net teleports a bandit back to its last safe spot if it ever ends up
  in water (never triggered in tests). Leash: the outward component of movement is dropped outside it.
* **Idle**: breathing, blinking, slow look-around, scratching under the pot, big yawns.
  **Taunt**: belly-slap (Morel out of reach, a hit landed, or Morel died).
* **Hurt**: emits `enemy:hurt {entity, type, amount, hp}`, flash, spore flecks; a quick puff staggers
  (interrupts wind-ups), a ≥ 50 % charged / ≥ 2 dmg / heavy hit knocks back with flailing arms.
* **Death**: emits `enemy:killed {entity, type, position, points}` once, spins up 1.5 m while shrinking,
  poofs into spores (0.5 s); the tin pot clatters away as a short-lived physics prop (bounces, fades).

| | Grunt | Slinger | Ironbelly |
|---|---|---|---|
| hp / points | 3 / 200 | 2 / 250 | 4 after armour / 400 |
| speeds (walk/run) | 1.6 / 4.2 | 1.7 / 3.4 | 1.2 / 2.4 |
| attack | overhead club slam: 0.45 s wind-up (club raised high, tracking at 2.6 rad/s), 0.18 s swing (swoosh arc, crack decal), hits within 2.05 m + Morel radius and ±66°, 1 dmg; 0.7 s recovery with the club stuck in the dirt | keeps 8–14 m, strafes (flips every 1.4–3.2 s or when blocked), backs off when close; 0.65 s sling spin over the head (whirl ring) then lobs a mud ball (gravity 20, 0.7–1.35 s flight) at Morel's predicted position (lead factor 0.8–1.05, ±0.6 m error), 1 dmg, every 1.5–2.3 s | approaches to 6 m, 0.5 s crouch, hop (vy 8.2), lands belly-first: shockwave ring (7.5 m/s to 7.5 m, 1 dmg unless Morel is airborne when it passes) + 1 dmg if landing on him; lies flat 1 s, gets up 0.55 s, 1.3 s cooldown |
| special | — | — | cauldron: every non-iron hit clangs off (`hurt` → false, sparks, small shove, no events/points). `info.kind === 'iron'` or `info.heavy` cracks it in two halves that tumble away (`armor:break {entity, position}`); that hit does no hp damage |

Measured (scenarios): a grunt 11 m away alerts at once, reaches wind-up range in ~2.9 s; backing off
during the wind-up dodges the swing; 3 quick puffs or 1 charged puff kill a grunt; slinger mud lands on
average **0.9 m** from a full-speed runner (6/8 direct hits, 2 near misses of ~2 m) vs ~8.7 m without
lead; 4 puffs (any kind) clang off an armoured ironbelly, one Anvil iron ball breaks it, 4 puffs then kill it.

## Chief Gnarlbelly (boss)

Three times a grunt: dented crown-pot with brass spikes and a glowing gem, red burlap cape, iron chest
plate, huge belly, a whole tree trunk with iron bands as a club. 24 hp = 8 per phase.

* **Dormant** on his throne (snoring, 'z' floaters, club on his shoulder). Morel within 18 m (or any hit):
  stands, roars (camera shake), emits `boss:start {maxHp:24, hp:24, phase:1}`, `boss:phase {phase:1}`,
  calls `ctx.hud.showBossBar?.(true)`.
* **Only dizzy = vulnerable.** Outside the dizzy window every hit boings off (`hurt` → false).
  A dizzy window lasts 3 s (stars circle his head, his belly glows orange) and ends early once it has
  taken 4 damage, so each phase needs at least two windows. Damage never skips a phase (clamped).
* **Phase 1**: walks at Morel; stomps (0.8 s foot-raise wind-up, shockwave 9 m/s to 26 m, 1 dmg unless
  airborne, 1 dmg within 3 m); log slams when Morel is within 6.5 m (0.9 s wind-up, ground cracks along
  the line, a small shockwave at the impact, 1 dmg within 2.4 m; 4 s cooldown).
  **After every third stomp his foot gets stuck → dizzy.**
* **Phase 2** (`boss:phase {phase:2}`): roars, pulls the chest plate down over his belly, spawns an
  Anvil Tonic jar on the arena ring on the far side (`entities.spawn({type:'tonic', kind:'anvil', respawn:true, pos})`,
  respawned on resume if gone), shows `ui:message` "His belly plate bounces puffs — crack it with an
  Anvil Tonic!", summons 3 grunts (drop in on the ring near Morel; 2 more after each dizzy window if
  fewer than 2 remain). Adds **mud barrages** (rears back, spits 5 mud balls: one at Morel's predicted
  position, four scattered around it, each with a glowing landing marker). Stomps 0.68 s / 10 m/s.
  While the plate is on, everything except iron clangs off — even when dizzy. An iron ball cracks it off
  (`armor:break {entity: boss, position}`; works any time) and the dizzy windows hurt again.
* **Phase 3** (`boss:phase {phase:3}`, `ui:message` "Gnarlbelly is furious!"): red tint, steaming,
  faster stomps (0.46 s / 12 m/s), walk 4.4 m/s, and **belly-slide charges**: 0.9 s crouch, slides at
  15 m/s (slight homing for 0.45 s, 1 dmg on contact) until he hits the arena edge or an obstacle →
  bounces, crashes → dizzy. Pattern: stomp, stomp, slide, barrage, stomp, slide.
* **Defeat** (0 hp): `boss:defeated {position}` at once, huge spore explosion, `showBossBar?.(false)`,
  summoned grunts poof (no points). He puffs up, zips around deflating like a balloon (2.4 s), flops
  flat as a pancake (crown pot clatters off), twitches, and poofs away 6.4 s after the killing hit.
* **Morel dies** mid-fight: the boss does a belly-slap victory dance; on the death respawn
  (`player:respawn` with a checkpoint id) the fight resets to the **start of the current phase** (hp
  24/16/8, plate back on in phase 2, minions removed, his shockwaves cleared, back at the throne,
  `showBossBar?.(false)`). When Morel comes within 18 m again he roars and resumes:
  `boss:start {maxHp, hp, phase, resumed:true}` + `showBossBar?.(true)` (no new `boss:phase`).
  Water-fall respawns (`checkpointId: null`) do not reset.

## Effects (`ctx.enemies.fx`)
```js
fx.shockwave({ position, speed=8, maxRadius=10, width=0.5, damage=1, owner, height=0.6, startRadius=0.4 })
fx.prop(object3d, { velocity, spin, life=3, radius=0.15, bounce=0.42, clone=false, sound='clatter' })
fx.decal('crack'|'splat'|'marker', position, { size, life, rotation })   // snapped to the ground
fx.floater('alert'|'question'|'z'|'star'|'anger', { follow, offset, position, velocity, life, size, spin })
fx.sfx(name, position, volume)    // ctx.audio.play wrapper that never throws
fx.clearAll()
```
Mud balls that hit the world leave a mud splat decal (listens to `projectile:hit`, kind `'mud'`).

## Events emitted
Contract: `enemy:alert`, `enemy:hurt`, `enemy:killed`, `armor:break`, `boss:start`, `boss:phase`,
`boss:hurt {hp, maxHp}` (every damaging hit), `boss:defeated`, `ui:message`. Nothing else.
Deflected hits emit nothing (core's `projectile:hit` already carries `deflected: true`).

### Sound names played directly (`ctx.audio.play(name, {position, volume})`)
Contract events cover alert croaks, hurts, deaths, armour breaks and boss start/phase/hurt/defeat.
These moments have no event, so the enemies call the audio API with these names (unknown names should
be ignored by the audio area):
`yawn`, `bellySlap`, `clubWindup`, `clubSlam`, `slingSpin`, `slingThrow`, `ironbellyGrunt`, `bellyFlop`,
`clang` (armour deflect), `cauldronClang` (falling armour), `potClatter`, `clatter`, `splash`,
`bossSnore`, `bossRoar`, `bossStomp`, `bossClubSlam`, `bossInhale`, `bossSpit`, `bossSummon`,
`bossCharge`, `bossSlide`, `bossCrash`, `bossDizzy`, `bossHurt`, `bossBoing`, `bossDeflate`,
`bossPlop`, `bossDefeated`.

## Models (`buildToad`)
`buildToad(ctx, LOOK)` → `{ root, rig, pivot, inner, bodyMesh, lidL, lidR, armL, armR, footL, footR,
helmet, helmetPivot, mouthOpen, sling?, slingPivot?, cauldron?:[L,R], plate?, platePivot?, bellyGlow?,
material, hulls, hullsSmall, dims }`. Static parts (body, belly, warts, eyes, mouth line, cloak, satchel)
are merged into one geometry; every part of one enemy shares ONE toon material (atlas × vertex colours),
so a hurt flash is one `emissive` change. Geometry is built once per look and shared. Look fields are
listed in `GRUNT_LOOK` (body radii W/H/D, colours, eye size, pot size/tilt, cloak, weapon `'club'|'sling'|'log'`,
`satchel`, `cauldron`, `chestPlate`, `bellyGlow`, `scale`, `outline`).

## Performance
Per bandit ≈ 7.4 k triangles of geometry (grunt: body 3.6 k, arms 1.6 k, feet 1.1 k, lids 0.6 k,
helmet 0.6 k), ~13.5 k drawn including outline hulls and shadows. Draw calls: at most 17 up close
(8 meshes + 6 outline hulls + 3 shadow casters), ~10 on average in the sandbox overview thanks to the
outline LOD: body/helmet hulls off beyond 34 m, arm/foot hulls beyond 16 m (×scale for the boss).
Core test arena at 960×540, high quality: 148 draw calls without bandits, 212–221 with all 7 sandbox
bandits in view. One fixed step with 7 active bandits ≈ 0.4 ms (whole simulation). Effects are pooled
(6 shockwaves, 20 decals, 16 floaters); props are a handful of meshes reparented from the enemy.
Line-of-sight raycasts are throttled to 5 Hz per bandit, and only within notice range.

## How to test
```
node tools/build.mjs --entry src/dev/enemies.js --out dist/dev-enemies --dev
node tools/build.mjs --entry src/dev/boss.js    --out dist/dev-boss    --dev
node tools/smoke.mjs --html dist/dev-enemies/index.html --out dist/dev-enemies/smoke.png --w 960 --h 540
node tools/smoke.mjs --html dist/dev-boss/index.html    --out dist/dev-boss/smoke.png    --w 960 --h 540
node tools/scenario.mjs tools/scenarios/enemies-grunt.mjs     --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots  # 8 checks
node tools/scenario.mjs tools/scenarios/enemies-slinger.mjs   --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots  # 4 checks
node tools/scenario.mjs tools/scenarios/enemies-ironbelly.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots  # 5 checks
node tools/scenario.mjs tools/scenarios/enemies-guard.mjs     --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots  # 6 checks
node tools/scenario.mjs tools/scenarios/enemies-boss.mjs      --html dist/dev-boss/index.html    --shots dist/dev-boss/shots     # 11 checks, full fight
node tools/scenario.mjs tools/scenarios/enemies-portraits.mjs --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots  # close-ups
node tools/scenario.mjs tools/scenarios/enemies-boss-shots.mjs --html dist/dev-boss/index.html   --shots dist/dev-boss/shots     # boss poses
node tools/scenario.mjs tools/scenarios/enemies-perf.mjs      --html dist/dev-enemies/index.html --shots dist/dev-enemies/shots  # draw calls, step cost
```
`tools/scenarios/enemies-helpers.mjs` installs `window.__et` (clear, spawn, until, cam, count) for scenarios.
Each scenario takes 30–90 s in headless SwiftShader.

Sandbox keys: enemies — 1/2/3 tonics, **R** respawn all bandits, **G** god mode. Boss — 1/2/3 tonics,
**G** god mode, **V** make the boss dizzy (debug). The boss sandbox has a tiny boss bar of its own.

### Merged distance LOD (added during integration)
`buildToad` also builds two merged rest-pose meshes per look (`model.lod`, cached with the look's geometry):
**mid** = body + lids + pot (+ cauldron while armoured) in one mesh with one outline hull, while arms and feet keep
animating; **far** = the whole toad (arms, feet, weapon, sling) in one static mesh. `Bandit.updateLook()` picks the
level by camera distance: full < 12 m, mid 12–28 m, far > 28 m (1.5 m hysteresis). `setLod(0)` is forced before the
pot (death) or the cauldron halves (armour break) fly off as props. A bandit now costs about 14–17 calls up close,
~8 at mid range and 1–2 far. With all areas installed, the fort outer yard went from 346 to 232 calls. The boss opts
out (`BOSS_LOOK.lod = false`).

## Contract deviations / additions (precise)
1. `ctx.enemies` (`fx`, `list()`, `boss()`) is added to ctx by `installEnemies`.
2. `boss:start` payload is `{ maxHp, hp, phase }`, plus `resumed: true` when the fight restarts after
   Morel's death (then `hp` is the phase-start hp, not `maxHp`).
3. `boss:phase {phase}` is emitted at the start of **each** phase, including phase 1 right after `boss:start`.
   Phase 2 and 3 events mean the previous phase was completed.
4. The boss also emits `ui:message {text, duration}` hints at the phase 2 and 3 starts, and spawns a
   `'tonic'` entity (pickups area) and `'grunt'` entities.
5. Enemies call `ctx.audio.play(name, …)` directly for the sounds listed above (no new events).
6. The boss is not an `enemy:killed` source (no points from that event); his points belong to the
   `boss:*` events. Summoned grunts do emit `enemy:killed` (200) when Morel kills them.
7. Entities expose `debug()`, `state`, `hp`/`maxHp`, `body`; the boss also `phase`, `plateState`,
   `minions`, `jar`, `stats`, `enterDizzy(kind)` (sandbox key V).

## Integration notes
* **main.js**: include `installEnemies` in `boot({ install: [...] })` (before `buildLevel`).
* **Level**: spawn `{type:'grunt'|'slinger'|'ironbelly', pos, yaw, patrol?, path?, leash?, aggro?}`.
  Put slingers on stumps/towers with `patrol: 0`; they will not step off (the guard blocks any drop
  > 0.5 m and anything below water + 0.3) but they do walk down stairs and gentle slopes. Arena waves:
  `aggro: true` (and optionally `dropIn: true`); dying bandits drop the `enemy` tag at once, so
  `query('enemy')` / `countByTag().enemy` is a reliable "wave cleared" test, as is counting `enemy:killed`.
  Boss: `{type:'boss', pos:[0,2,402]}`; keep the pit floor (radius 22 around (0,2,395)) flat and free of
  colliders taller than 0.35 m inside radius ~19 (he slides across it); the throne sits at z ≈ 403.5–405
  behind him. Pass `throne:false` if you build your own (keep z > 404 clear then).
* **Pickups**: the boss spawns `{type:'tonic', kind:'anvil', respawn:true, pos}` on the arena ring
  (radius 18.5 from the centre) at the phase-2 start. The jar must call `player.setTonic('anvil')`.
  `src/dev/boss.js` contains a clearly marked sandbox-only shim of this jar; it is not shipped.
* **Score**: `enemy:killed.points` is 200 / 250 / 400. For "boss phase 2000" award on `boss:phase` with
  `phase >= 2` (and a final 5000 on `boss:defeated`), because `boss:phase {phase:1}` fires at the start
  of the fight. A resumed fight does not re-emit `boss:phase`.
* **HUD**: `boss:start {maxHp, hp}` (use `hp ?? maxHp` to fill), `boss:hurt {hp, maxHp}`;
  the boss calls `ctx.hud.showBossBar?.(on)` on start/resume (true), reset/defeat (false).
  `ui:message` toasts are emitted for phase 2/3 hints.
* **Audio**: implement the sound names listed above if wanted; `enemy:alert` = croak, `enemy:hurt` =
  squelch, `enemy:killed` = spore poof, `armor:break` = big metal crack, `boss:*` for music/stingers.
* **Camera**: boss stomps call `cameraRig.shake(≤0.5, 0.5)`, roars 0.4–0.6, slams 0.35.

* **Integration change:** the boss now also resets to the phase start on any checkpoint `player:respawn`
  while the fight is on (not only after a death), because the pause menu's "Restart from checkpoint" uses it.

## Known issues
* Bandits do not path-find: when the direct line to Morel is blocked by a wall or a drop they stop,
  glare and taunt (or give up after 3 s without sight). Level layouts should give melee bandits open
  ground to chase on.
* The ground guard is conservative: very steep downhill terrain (> ~40°) stops a chasing bandit.
* The ironbelly's belly-flop hop has no arc prediction against walls; if he hops into a wall he just
  lands in front of it.
* In headless SwiftShader screenshots particles look softer/larger than in a real GPU run.
* The boss sandbox pit is a simple test stage; the level area builds the real Gnarlbelly's Pit.
