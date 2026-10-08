# Pickups + Score

This area covers glowcaps, bog berries, tonic jars, glowworm cages, lantern checkpoints, the Lantern Gate, and the scoring and combo system.
Everything is procedural: Three.js primitives, vertex colours and a few canvas textures. There are no asset files.

| File | What |
|---|---|
| `src/game/score.js` | `installScore(ctx)` sets `ctx.score`. It holds the scoring and combo rules, the counters, the rank and the snapshot. |
| `src/game/pickups.js` | `installPickups(ctx)` registers the 8 spawn types and sets `ctx.pickups`. |
| `src/dev/pickups.js` | The sandbox. By default it boots the core test arena with every pickup type plus a dev HUD. With `?level=1` it boots the real Gloomfen level instead. |
| `tools/scenarios/pickups-*.mjs` | Scripted playtests (see "How to test"). `pickups-helpers.mjs` installs `window.__pt`. |

## Install

```js
import { installScore } from './game/score.js';
import { installPickups } from './game/pickups.js';
boot({ install: [installAudio, installScore, installUI, installEnemies, installPickups, installMechanisms], buildLevel });
```
The install order between the two does not matter. Totals are registered when entities spawn, and that happens in `buildLevel`, after every installer has run.

## Score (`ctx.score`)

### Rules (ARCHITECTURE.md "Scoring and combo")
* Base points:

  | Event | Points |
  |---|---|
  | Glowcap | 50 |
  | Health berry | 25 |
  | Grunt | 200 |
  | Slinger | 250 |
  | Ironbelly | 400 |
  | Cage freed | 500 |
  | Boss phase 2 and phase 3 | 2000 each |
  | Boss defeated | 5000 |

  These live in the exported `POINTS`.
* An `enemy:killed` uses `payload.points`, or the `POINTS[type]` table when no points are given.
* A kill worth 0 points is not a scoring event. Core's training dummy is one, unless an override is set with `setTypePoints`.
* `boss:phase {phase:1}` marks the start of the fight and is worth nothing. Phases 2 and 3 pay 2000 once each per run. `boss:defeated` pays 5000 once.
* **Chain**: every scoring event within `COMBO_WINDOW` (3.0 s) of the previous one adds 1 to the chain and refills the timer.
* **Multiplier**: it comes from the chain length, counting the event being scored. Chains of 1–4 score ×1, 5–9 ×2, 10–19 ×3, 20–34 ×4, 35–49 ×5 and 50+ ×6 (`MULTIPLIER_STEPS`). Points are multiplied when they are awarded.
* `player:hurt` drains the timer to 0 at once, which ends the combo. `player:died` ends it too and counts a death. The score itself is kept.
* `elapsed` advances only while `ctx.state === 'playing'`, and stops on `level:complete`.

### API
```js
score.points            // the total (core's __game.state() reads it); also score.total
score.chain, score.multiplier, score.timeLeft, score.timeMax (3), score.comboPoints (points of the running chain)
score.bestChain, score.glowcaps, score.glowcapsTotal, score.cagesFreed, score.cagesTotal,
score.kills, score.killsByType {grunt: n, ...}, score.berries, score.deaths, score.elapsed (s),
score.bossDefeated, score.completed
score.award(base, reason, position?, extra?) → points added  // runs the chain/multiplier rules (any source)
score.breakCombo(reason)                     // end the running chain now
score.snapshot()        // JSON-safe: {total, points, chain, multiplier, bestChain, glowcaps, glowcapsTotal, cagesFreed,
                        //  cagesTotal, kills, killsByType, berries, deaths, elapsed, bossDefeated, maxPossible}
score.reset()           // new run: zero every counter (registered totals are kept, see below)
score.computeRank(total, maxPossible) → 'Bronze' | 'Silver' | 'Gold' | 'Glowing'
score.rankInfo(total?, max?) → { rank, ratio, qualified, next, nextAt, maxPossible }
score.maxPossible()     // estimate, see below
score.registerItem(kind, key), score.itemTotal(kind)   // pickups register glowcaps / cages (deduplicated by key)
score.setTypePoints(type, pts | null)        // override enemy:killed points per type (the sandbox uses dummy = 100)
score.multiplierFor(chain)
```
`computeRank` thresholds are 95 % for Glowing, 80 % for Gold and 60 % for Silver. A finished level never drops below Bronze. `rankInfo().qualified` reports the 35 % Bronze threshold (exported as `RANKS`).

**`maxPossible()`** is built from the registered totals, then multiplied by `COMBO_FACTOR` (1.8):
* glowcaps × 50 and cages × 500;
* the points of every enemy spawned so far. A periodic 2 Hz scan picks up level enemies, arena waves and boss minions as they appear. Enemies that despawn without being killed, such as minions that poof when the boss falls, or entities removed by `level.reset()`, are dropped from the count again.
* 9000 for the boss once he has been seen.

Berries are left out, because they can only be taken when Morel is hurt.

A factor of 1.8 means a Glowing rank needs everything collected at an average of about ×1.7, which is expert play. Gold needs everything at about ×1.45. In the real level `maxPossible()` is 56,200 at the start: 159 glowcaps, 8 cages, the initial enemies and the boss. It grows when the courtyard waves arrive.

### Events emitted
| Event | Payload |
|---|---|
| `score:award` | `{ points, base, multiplier, position (Vector3 \| null), reason, chain, total }` + `type` for enemies, `phase` for boss phases. `reason` is one of `'glowcap' 'berry' 'cage' 'enemy' 'bossPhase' 'boss'` |
| `combo:update` | `{ chain, multiplier, timeLeft, timeMax }`. It fires on every award, every combo end and reset, and at about 10 Hz while the timer drains. |
| `combo:end` | `{ chain, total, score, reason }`. `total` is the points earned **by that chain**, `score` is the overall total, and `reason` is one of `'timeout' 'hurt' 'died' 'manual'`. |

**Listens to:** `enemy:killed`, `pickup:glowcap`, `pickup:berry`, `cage:freed`, `boss:start`, `boss:phase`, `boss:defeated`, `player:hurt`, `player:died` and `level:complete`.

## Pickups (spawn types)

All pickups are `team: 'neutral'` and `hittable: false`, except cages. If `pos[1]` is `null` or `undefined`, the pickup is snapped to the ground with `physics.groundHeight`.

| Type | Params | What |
|---|---|---|
| `glowcap` | `pos` | A gem-cut cyan crystal mushroom cap that bobs, spins and glints. A null y hovers it 0.85 m above the ground; a given y is kept. Within 2.2 m it drifts toward Morel at 2.2 to 10 m/s. It is collected when within 0.9 m of Morel's body axis: it shrinks into him, emits `pickup:glowcap {position, points: 50, remaining}` and bursts into sparkles. It is not drawn per entity (see "Instancing"). |
| `glowcapLine` | `from`, `to`, `count` | `count` glowcaps from `from` to `to`, endpoints included. If either y is null, every point drops to the ground. Returns a `glowcapGroup` entity: removing it (for example through `level.reset()`) removes its glowcaps too. |
| `glowcapRing` | `pos`, `radius`, `count`, `phase?` | `count` glowcaps on a circle. A null y drops each one onto the ground. Also returns a group entity. |
| `berry` | `pos`, `yaw?` | Six glossy violet-red bog berries on a cupped leaf, with a stem curl, a soft pink glow and drifting motes. Touching it calls `player.heal(1)` and emits `pickup:berry {position, hp, healed}`, then the berry vanishes. At full health it stays and does a little squash. |
| `tonic` | `kind: 'anvil'\|'updraft'\|'seeker'`, `respawn`, `pos` | A corked glass jar with a fresnel glass shader, glowing liquid, a twine wrap and a paper tag with an icon. It floats and rotates. Anvil holds a tiny iron anvil, updraft has rising swirling bubbles, and seeker has a glowing magenta spiral. Touching it calls `player.setTonic(kind, 20)` and emits `pickup:tonic {kind, position, duration}`. With `respawn: true` the jar reappears 8 s later: motes gather, then it pops in with `tonic:respawn {kind, position}`. Without it, the jar despawns. |
| `cage` | `pos`, `yaw?`, `hanging?`, `rope?` (2.2 m) | A lashed wooden cage with bars, rope lashings, a bandit padlock and a hanging loop. By default it stands on a post with a plank deck. `hanging: true` hangs it from a rope, and then `pos` is the cage's bottom. Inside is a glowworm: a green grub with a glowing tail, a big head with eyes and cheeks, worried brows and glowing antennae. It bobs, wiggles and hops anxiously and watches Morel when he is near. Two hits from any player projectile break it (see below). |
| `checkpoint` | `id`, `pos` (the respawn spot), `yaw` | A carved lantern post with an octagonal turned post, bands, a moon-and-flame rune, a fiddlehead crook arm and a mossy rock foot. The iron lantern hangs from the arm with a little brass bell under it. Morel coming within 2.5 m of `pos` lights it: a warm flame grows, the glass and rune glow, a light pool and a ring of light roll out, embers rise, and the lantern swings. The checkpoint calls `player.setCheckpoint(id, pos, yaw)` and emits `checkpoint:reached {id, position, yaw}` once. |
| `lanternGate` | `pos`, `yaw?`, `id?` ('lanternGate') | Hidden until `boss:defeated`. After 1.6 s it rises out of the ground over 3.4 s with dust and small camera shakes: an arch of twisted roots with hanging moss, five hanging lanterns and glowing root bulbs. Its swirling amber-cyan portal (a shader) then opens over 1.4 s and it emits `gate:open {id, position}`. Walking into the portal emits `level:complete` once. |

### Cages and projectiles
Core's projectile system hurts any alive, `hurt`-able, `hittable !== false` entity whose team is not `'player'`. Neutral projectiles skip neutral entities, and enemy projectiles never hit entities. So `team: 'neutral'` is all a cage needs: player puffs, iron balls and seeker puffs hit it, and bandit mud does not. **No core shim was needed.**

Cage tags are `cage`, `target` and `breakable`. They are deliberately **not** `enemy`, so lock-on, aim assist, arena-cleared counts and the score's enemy registry ignore them. The hit capsule has radius 0.62 and covers the whole cage.

Each hit counts as 1 hit, whatever the damage. The cage wobbles, the worm startles, a bar snaps off, and `cage:hit {entity, position, hits, hitsLeft}` fires. On the second hit:
* planks and bars fly (pooled instanced debris);
* the cage drops `hittable` and its tags;
* a post cage keeps its post and deck, and its collider shrinks to the deck;
* the glowworm cheers with a smile and closed happy eyes, then spirals up with a glow trail and vanishes;
* `cage:freed {position, points: 500, freed, total, entity}` fires, plus `ui:message {text, duration: 3, speaker: 'glowworm'}` with a thank-you line from `GLOWWORM_LINES`. The 8 original lines cycle without repeats.

### Lantern Gate completion
`level:complete { stats, gateId, position }`. `stats` is `score.snapshot()` plus `rank` and `rankRatio`. The gate also sets `ctx.flags.levelComplete = true`, and the score freezes its clock (`score.completed`).

The gate does **not** change the game state. The UI or integration should show the results screen.

### `ctx.pickups`
```js
ctx.pickups.TUNING                  // PICKUP_TUNING (radii, timings, points)
ctx.pickups.stats()                 // { glowcapsLeft, glowcapsCollected, glowcapsDrawn, cagesFreed, cagesTotal }
ctx.pickups.raiseGates(instant?)    // what boss:defeated does (instant: skip the animation)
ctx.pickups.lightCheckpoint(id, silent?)
ctx.pickups.glowcaps / .halos / .debris   // the shared instanced systems
```

### Instancing and draw calls
* **Every glowcap** is drawn by one `InstancedMesh` for the caps, its outline hull, and one instanced billboard mesh for the halos: **3 draw calls for any number**. The instance matrices are written once per rendered frame, with a 120 m cull. With 172 glowcaps on screen the glowcaps cost exactly 3 calls (`pickups-perf`).
* **Every other halo** shares one instanced billboard draw call (`ctx.pickups.halos`): berries, jars, glowworms, lanterns and the gate. Debris is one more instanced call.
* Per instance at close range, counting outline hulls and shadow casters: a berry is 4, a jar 6, a cage 7.5, a checkpoint 8, and the gate 7. In the arena's spawn view, all 11 pickups in sight add 61 calls (225 vs 164).
* There are three LOD tiers per entity: hulls go off first (22–40 m), then small details (40–60 m), then the main meshes (66–90 m, where only the halo is left). Fog hides everything beyond that anyway.
* In the real level, pickups add **8–28 draw calls** at the sampled spots: start 8, glade checkpoint 20, bog cliff 18, fort yard 28 (the densest), pit 12.
* With 172 glowcaps, one fixed step of the whole simulation costs 0.28–0.43 ms. `glowcaps.frame()` plus `halos.frame()` cost about 0.12–0.19 ms per frame in headless SwiftShader. There are no per-frame allocations: payloads are allocated only on events.

## Sandbox
`node tools/build.mjs --entry src/dev/pickups.js --out dist/dev-pickups --dev`, then open `dist/dev-pickups/index.html`.

* **The arena** contains:
  * an 8-cap ground line from the spawn;
  * a floating ring of 8 caps;
  * a rising line of 5 caps;
  * 2 berries and 3 jars;
  * a post cage, and a hanging cage on a little crane;
  * 2 checkpoints (`sandA`, `sandB`);
  * the Lantern Gate at (16, 1, 34);
  * core's 3 straw dummies, worth 100 points each for combo testing (sandbox-only `setTypePoints`).
* **The dev HUD** (sandbox only) shows the score, a combo bar, hearts, counters, floating "+400 ×3" text from `score:award`, toasts from `ui:message`, and a results card on `level:complete`.
* **Keys**:

  | Key | Action |
  |---|---|
  | 1 / 2 / 3 | Tonic |
  | H | Hurt Morel |
  | B | Emit `boss:defeated` |
  | G | God mode |
  | R | Reset score |
  | F | Spawn 150 more glowcaps |
  | N / P | Next / previous checkpoint (in `?level=1` only) |

* **`?level=1`** boots the real Gloomfen level with `installEnemies` and `installMechanisms`.

## How to test
```
node tools/build.mjs --entry src/dev/pickups.js --out dist/dev-pickups --dev
node tools/smoke.mjs --html dist/dev-pickups/index.html --out dist/dev-pickups/smoke.png --w 960 --h 540 --wait 6000
node tools/scenario.mjs tools/scenarios/pickups-score.mjs      --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  # 17 checks
node tools/scenario.mjs tools/scenarios/pickups-items.mjs      --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  #  9 checks
node tools/scenario.mjs tools/scenarios/pickups-cage.mjs       --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  # 10 checks
node tools/scenario.mjs tools/scenarios/pickups-checkpoint.mjs --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  #  7 checks
node tools/scenario.mjs tools/scenarios/pickups-gate.mjs       --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  #  6 checks
node tools/scenario.mjs tools/scenarios/pickups-perf.mjs       --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  #  3 checks
node tools/scenario.mjs tools/scenarios/pickups-level.mjs      --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  #  8 checks (real level)
node tools/scenario.mjs tools/scenarios/pickups-shots.mjs      --html dist/dev-pickups/index.html --shots dist/dev-pickups/shots  # close-ups
```
What the scenarios cover:
* **pickups-score**
  * Walking the 8-cap line scores 50, 50, 50, 50, 100, 100, 100, 100 (600) with chain 8 at ×2.
  * The multiplier steps at chains 5, 10, 20, 35 and 50.
  * `combo:update` fires at about 10 Hz while the timer drains.
  * The combo ends 3 s after the last event (`combo:end` with reason timeout): an event at 2.8 s extends the chain, and one at 3.1 s starts a new chain.
  * Getting hurt ends the combo (reason hurt).
  * Boss and enemy points come from the payload or the table, and the boss phase and defeat are paid once each.
  * The clock stops while paused; deaths are counted; `snapshot` and the rank thresholds are correct.
* **pickups-items**
  * A berry stays at full health; when Morel is hurt it heals 3 → 4 hp and scores 25.
  * Each jar calls `setTonic(kind, 20)`, is gone for 8 s, comes back, and can be drunk again.
* **pickups-cage**
  * Real thrown puffs: the first hits but does not free the cage, the second frees it (`cage:freed`, a thank-you message, 500 points, debris). Later puffs pass through.
  * The hanging cage breaks after 2 hits.
  * Thank-you lines vary, and enemy mud does not hit cages.
* **pickups-checkpoint**
  * Passing at 3.2 m does not light the lantern; within 2.5 m it lights, fires once, and sets the checkpoint.
  * After dying, Morel respawns at the lantern spot.
  * A later checkpoint takes over the respawn point.
* **pickups-gate**
  * The gate is hidden and solid-free before the boss falls.
  * `boss:defeated` makes it wait, rise and open, and its pillars get colliders.
  * Walking in emits `level:complete` once, with correct stats and rank.
* **pickups-perf**: the glowcap and per-instance draw-call budgets above.
* **pickups-level**
  * Every pickup type spawns from the real level data, with no placeholders.
  * The score registers the totals, and every glowcap floats at least 0.3 m above the ground.
  * The gate rises in the pit, and the pickup draw-call share stays within budget.
  * `level.reset()` re-spawns everything without duplicates.

All scenarios run with zero console errors and no warnings. Screenshots are in `dist/dev-pickups/shots/`.

## Contract deviations / additions (precise)
1. `score:award` adds `chain` and `total`, plus `type` (enemies) or `phase` (boss phases). `position` is `null` when the source gave none.
2. In `combo:end {chain, total, score, reason}`, `total` is the points of the chain that ended, not the overall score (that is `score`).
3. New events: `cage:hit {entity, position, hits, hitsLeft}`, `pickup:tonic {kind, position, duration}` and `tonic:respawn {kind, position}`. Existing events gain fields: `pickup:glowcap.remaining`, `pickup:berry.healed`, `cage:freed.entity`, `checkpoint:reached.yaw`, `level:complete.gateId/position`, and `ui:message.speaker` (`'glowworm'`).
4. The Lantern Gate emits the contract's `gate:open {id: 'lanternGate', position}` when its portal has opened.
5. `level:complete.stats` is `score.snapshot()` plus `rank` and `rankRatio`; the snapshot already includes `maxPossible`. The gate also sets `ctx.flags.levelComplete`.
6. A checkpoint entity's `position` is the respawn spot. The post stands `side` m (default 1.7) to Morel's right, or to the left if the right side has no ground within 0.7 m. `side: 0` puts the post on the spot itself, with no collider. Extra entity fields: `checkpointId`, `yaw`, `lit`, `light(silent)` and `postPosition`.
7. Cages: `team: 'neutral'`, tags `cage target breakable` (plus `freed` once freed), and the extra params `hanging`, `rope` and `yaw`. Hits required: `PICKUP_TUNING.cage.hits` (2).
8. `glowcapLine` and `glowcapRing` return a `glowcapGroup` entity that owns its glowcaps. Individual glowcaps are entities tagged `glowcap pickup`, and the `pickup` tag is dropped when they are collected. `glowcapRing` takes an optional `phase`.
9. `ctx.pickups` is added. So are the score extras listed under API: `award`, `breakCombo`, `rankInfo`, `registerItem`, `itemTotal`, `setTypePoints`, `multiplierFor`, `killsByType`, `berries`, `comboPoints`, `timeMax`, `bossDefeated` and `completed`.
10. `computeRank` never returns anything below `'Bronze'`. The 35 % threshold is reported as `rankInfo().qualified`.

## Integration notes
* **main.js**: add `installScore` and `installPickups` to `boot({ install })`. For "play again", call `ctx.level.reset()` and then `ctx.score.reset()`. The gate, cages and jars are re-spawned by the level reset. Glowcap and cage totals are deduplicated by position, so a re-spawn never inflates them.
* **UI / HUD**:
  * floating "+N ×M" text: `score:award` (position, points, multiplier);
  * combo bar: `combo:update` (`timeLeft / timeMax`);
  * combo end: `combo:end`;
  * results screen: on `level:complete`, call `ctx.setState('results')` and `menus.show('results', stats)`. `stats` has `total, rank, elapsed, glowcaps/glowcapsTotal, cagesFreed/cagesTotal, bestChain, kills, deaths, maxPossible`.

  Glowworm thank-you lines and the "Lantern Gate rises" hint arrive as `ui:message`. `src/dev/pickups.js` has a small DOM version of the floating text and results card that can be lifted.
* **Audio** (suggested sounds; every event has a position):

  | Event | Sound |
  |---|---|
  | `pickup:glowcap` | Crystal chime. Pitch it up with `score:award.chain`. |
  | `pickup:berry` | Squishy gulp |
  | `pickup:tonic` | Cork pop and glug |
  | `tonic:respawn` | Soft shimmer |
  | `cage:hit` | Wood crack |
  | `cage:freed` | Splintering burst and a happy chirp |
  | `checkpoint:reached` | Little bell ring |
  | `gate:open` | Rumble, then a swell |
  | `level:complete` | Fanfare |
  | `combo:end` | Optional soft "chain over" tick |

* **Level data** (owned by the level area): two glowcaps sit *inside* cages.
  * `gc(-13.6, 9.3, 54.2)`: cage C1 is at y 8.4 and its floor is at about 8.94.
  * `gc(-20.75, 11.5, 292.25)`: cage C6 is at y 10.6.

  Both can still be collected, because standing next to the cage brings Morel within 0.9 m and the magnet pulls the cap through the bars. They look odd next to the glowworm, though. Move them about 0.9 m above the cage roof (y ≈ cage y + 2.9) or a step to the side. The level data has 159 glowcaps (the target was about 150), which is fine.
* **Hanging cages**: puffs fly level from Morel's hand, about 0.55 m above his feet. Hang the cage bottom no higher than about 1 m above where Morel stands, or expect a jump-throw. None of the current level cages hang.
* **Aim assist and lock-on** (core) only consider `enemy`-tagged entities, so cages are never auto-targeted. If cages should bend puffs, core's `aimAssistTarget` could also scan the `breakable` tag.
* **Boss sandbox**: `src/dev/boss.js` has a tonic-jar shim that only registers when no `tonic` type exists. With `installPickups` installed, the real jar is used. The boss spawns `{type: 'tonic', kind: 'anvil', respawn: true}` and that works unchanged.
* **Points override**: `ctx.score.setTypePoints('dummy', 100)` is a sandbox-only convenience. In the shipped game, dummies (0 points) are not scoring events.
* **Draw calls**: some real-level views exceed the 250-call budget before pickups are counted: about 260 at the glade checkpoint, 290 at the bog cliff and 292 in the fort yard, including level and enemies. Pickups contribute only 18–28 of those, so any trimming has to come from the level and enemy geometry.

* **Integration changes:**
  * `score.setLevelBase(base)` pins `maxPossible()` to the whole level. Integration passes 29,600, so the maximum is 53,280.
  * `score.restore(snapshot)` takes the counters back for the artifact viewer's hot reload.
  * The two glowcaps that sat inside cages C1 and C6 were moved (docs/level.md).
  * Glowcaps within 0.5–1.8 m of the camera now shrink away (`PICKUP_TUNING.glowcap.nearFade`). Otherwise a cap next to the lens (the camera trails Morel down narrow paths such as the pit gorge) filled a third of the screen.

## Known issues
* The glowcap magnet ignores walls. Within 2.2 m a cap can drift through a thin wall toward Morel. This is harmless and only visual.
* Hits on a cage count per projectile, not per damage. A seeker volley where 2 of its 3 puffs land breaks a cage in one throw.
* The checkpoint chooses which side its post stands on by sampling the ground. On narrow ledges it falls back to `side: 0`: the post stands on the respawn spot, and Morel appears inside the post's hull, which looks odd for the 0.35 s pop.
* In headless SwiftShader screenshots the halos and particles look softer and larger than they will on a real GPU.
