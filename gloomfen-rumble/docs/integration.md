# Integration — wiring, game flow, ship build, end-to-end tests

The integration area turns the six areas (core, level, enemies, pickups + score, audio, UI) into the
shipped game: `src/main.js` boots everything, `src/game/flow.js` runs the game-state machine, and
`npm run build` writes the single-file game to `dist/index.html` and `dist/artifact.html`.

| File | What |
|---|---|
| `src/main.js` | boot with every installer, WebGL failure message, artifact-viewer hot-reload hooks |
| `src/game/flow.js` | `installFlow(ctx)` → `ctx.flow`: menu intents, new run, restart from checkpoint, results, level maximum, hot snapshot / restore |
| `tools/scenarios/integ-helpers.mjs` | shared helpers: `__it` (event counts, kills, draw calls, real lock-on fights), `watchConsole`, `waitForGame`, `settledShot` |
| `tools/scenarios/integ-playthrough.mjs` | the end-to-end playthrough of `dist/index.html` (19 checks) |
| `tools/scenarios/integ-states.mjs` | pause / resume / hidden tab / death / restart from checkpoint / quit to title (11 checks) |
| `tools/scenarios/integ-hot.mjs` | `window.claude.hot` snapshot and resume (6 checks) |
| `tools/scenarios/integ-results.mjs` | results screen layout at any viewport |
| `tools/scenarios/integ-perf.mjs` | draw calls + triangles per view with a per-owner breakdown; heap-allocation sampling |
| `tools/scenarios/integ-title.mjs` | title framing at four orbit angles |

## How the game is wired (`src/main.js`)

```js
boot({
  startState: 'title',
  buildLevel,                       // src/game/level/builder.js (spawns every entity itself)
  install: [installScore, installAudio, installUI, installEnemies, installPickups, installMechanisms, installFlow],
});
ctx.flow.levelReady();              // pins the score maximum to the whole level
ctx.flow.restore(hotData);          // artifact viewer: resume at the last checkpoint (no-op otherwise)
window.claude?.hot?.snapshot?.(() => ctx.flow.snapshot());
```

Installer order (they all run before `buildLevel`, so every spawn type exists when the level spawns):

1. **score**, so `score:award` exists before audio's glowcap chime reads it.
2. **audio**, before the UI, so the UI's stored volumes reach the real engine.
3. **UI**: HUD, menus and touch. `wireMenuIntents` from `src/ui/index.js` is *not* used, because the flow replaces it.
4. **enemies, pickups, mechanisms**: the entity types.
5. **flow**: listens to the menu intents and `level:complete`.

Boot is wrapped. If WebGL is missing, the page shows a plain message instead of a blank canvas.

### Artifact viewer hot reload
`main.js` ends with

```js
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
```

`start(data)` runs at most once. When the viewer republishes the page, the snapshot
(`ctx.flow.snapshot()`) is handed back as `data`. Outside the viewer `window.claude` is undefined: the
snapshot registration is skipped and `start({})` boots normally.

The snapshot is JSON-safe:
```js
{ v: 1, state, checkpointId /* null on the title / results */, score: score.snapshot(),
  settings: { master, music, sfx, sensitivity, invertY, quality /* only if picked by hand */ } }
```

`flow.restore(data)` always applies the settings. With a known `checkpointId` it also:
* restores the score counters (`score.restore`);
* puts Morel at that checkpoint and lights its lantern;
* sets the level zone (the music follows it) and starts **paused**. The pause menu's Resume continues from there.

The world itself is fresh: glowcaps and bandits are back.

## Game-state machine (`src/game/flow.js` + core)

```
boot ─► title ──menu:start──► playing ◄───────────────────────────────────────┐
          ▲                     │ ▲  Esc / P / Start, tab hidden,               │
          │                     │ │  pointer-lock loss (core)                   │
          │                     ▼ │  menu:resume, Esc / P (core)                │
          ├──menu:quitTitle─── paused ──menu:restartCheckpoint──────────────────┤
          │                     │                                              │
          │       Morel dies: playing ─► dead (splat, 1.4 s) ─► playing (core) │
          │                     │                                              │
          │   level:complete + 1.2 s of simulation ─► results ──menu:playAgain─┘
          └──────────────────────────────────────── results ──menu:quitTitle
```

Every change goes through `ctx.setState()`, which emits `game:state {state, prev}`.

| State | Simulation | Camera | Music | UI |
|---|---|---|---|---|
| `title` | frozen | slow orbit around Morel at the start area; on wide screens it aims left of him so he stands beside the menu panel | `title` | title menu |
| `playing` | runs | chase camera (`menu:start` cuts to it with `snapBehind`) | zone track; `boss` during the fight; `victory` after it | HUD, touch controls |
| `paused` | frozen | pointer lock released | muffled | pause menu over the dimmed HUD |
| `dead` | runs (Morel's splat, enemies taunt) | — | ducked | "Splat!" card + curtain; core respawns at the checkpoint after 1.4 s with full hearts |
| `results` | frozen | orbit | `victory` | results card: count-up, rank badge, rank meter, stats |

Menu intents (the menus only emit them):

| Intent | Flow |
|---|---|
| `menu:start` | `audio.unlock()` inside the gesture, camera behind Morel, `'playing'` |
| `menu:resume` | `'playing'` |
| `menu:restartCheckpoint` | full hearts, `respawnAt(checkpoint)`, emits `player:respawn {checkpointId}` (the ambush, the boss fight and the pit gate reset on it), `'playing'` |
| `menu:quitTitle` | **new run** prepared behind the title (the title always shows the start area), `'title'` |
| `menu:playAgain` | **new run**, `'playing'` |

**New run** (`flow.newRun()`), in order:
1. Every level entity's `reset()` runs, so mechanisms put their colliders back.
2. **Every** entity is cleared: level spawns, arena waves, boss minions, the boss's tonic jar.
3. Projectiles and enemy effects are cleared, and every `ctx.flags` key is deleted.
4. `level.spawnAll()` runs and the score resets.
5. Morel goes back to the level spawn with full hearts, no tonic and checkpoint `start`.
6. The HUD's per-run state and its toasts are reset.
7. `run:reset {}` is emitted. This new event is how audio forgets the last run's boss and victory music.

`playAgain` was verified to recreate the exact entity set of the first boot: 274 entities, every tag count equal.

**Results**: `level:complete` (the Lantern Gate) starts a 1.2 s timer in *simulation* time, so it
pauses with the game. Then the state becomes `'results'`. The UI shows the stats from `level:complete`.

## Score maximum and ranks
`score.maxPossible()` used to be a running estimate: it grew when the ambush waves and boss minions
appeared, so the rank target drifted during a run. Integration now pins it:
`flow.levelReady()` → `score.setLevelBase(base)`. The base is made of:
* the registered glowcaps (159 × 50) and cages (8 × 500);
* every bandit in the level data, **including the two courtyard waves** (22 grunts, 9 slingers, 5 ironbellies);
* the boss (2 × 2000 phase points + 5000).

That is **29,600** points before the combo. Boss minions and berries are left out as bonus.
`maxPossible = round(base × COMBO_FACTOR 1.8) =` **53,280**.

Ranks (unchanged thresholds): Glowing ≥ 95 %, Gold ≥ 80 %, Silver ≥ 60 %, Bronze below. Finishing
always earns at least Bronze. The boss's 9,000 points almost always land at ×1, so Glowing needs an
average multiplier of about ×2 on everything else: long unbroken chains, which is expert play. Gold
needs everything at about ×1.6, and Silver everything at about ×1.1. The scripted playthrough, which
teleports past most of the level, scores 15,400 = 29 % (Bronze).

The results card shows the rank badge plus a **rank meter**: the score as a share of the maximum, with
Silver / Gold / Glowing marks, e.g. "87 % of 53,280 possible · 4,416 more for Glowing".

## Changes made in other areas (all small, in their style)

| Area | Change | Why |
|---|---|---|
| core `player.js` | `TUNING.deathTime` 1.6 → 1.4 s | the brief's splat length; the curtain is down at 1.1 s |
| core `player.js` | scarf tails: one `InstancedMesh` + instanced hull (tip colour via instance colour) | 12 draw calls → 2, on every frame |
| core `camera.js` | title orbit: 5.2 m, low pitch, aims left of Morel on wide screens (`CAMERA_TUNING.orbitRate/titleDistance/titlePitch/titleShift`) | Morel was small and behind the menu |
| enemies `model.js` + `common.js` | merged LOD meshes per look: **mid** (> 12 m: body + lids + pot as one mesh with one hull, arms and feet still animated) and **far** (> 28 m: the whole toad as one static mesh). `Bandit.setLod(level)`; forced to full detail before the pot or the cauldron fly off as props. The boss opts out (`lod: false`) | bandits cost 14–17 calls each; the fort yard was at 346 calls |
| enemies `boss.js` | any checkpoint respawn during the fight resets it to the phase start (previously only after a death) | "Restart from checkpoint" in the pit soft-locked behind the closed gate |
| level `mechanisms.js` | `arenaLock` resets on any checkpoint respawn while locked | "Restart from checkpoint" left the ambush locked with its gates shut |
| level `data.js` | pit gate `openOn` also `player:respawn`; two glowcaps moved out of cages C1 and C6 | same soft lock; caps were inside the cage colliders |
| level `builder.js` | entity distance culling now includes the boss | he cost 11–22 calls from 400 m away, hidden only by the fog |
| pickups `score.js` | `setLevelBase(base)`, `levelBase`, `restore(snapshot)` | fixed maximum; hot reload |
| audio `audio.js` | listens to `run:reset` | after "Play again" the victory track kept playing |
| UI `menus.js` + `page.html` | results rank meter (`.res-meter`, `rm-*` classes) | show the maximum and the next rank |

## Performance (960×540, quality `high`, one full frame = shadow + main + bloom)

`tools/scenarios/integ-perf.mjs`. Morel costs 35–47 calls, bloom 14 and the sky/particles a few more,
so the core share is about 60–75 calls everywhere.

| View | Draw calls before | after | Triangles |
|---|---|---|---|
| checkpoint `start` | 189 | 133 | 492 k |
| checkpoint `glade` | 225 | 167 | 548 k |
| checkpoint `bog` | 114–299 (bandits nearby) | 185 | 707 k |
| checkpoint `fort` | 130 | 98 | 437 k |
| checkpoint `pit` | 196 | 181 | 541 k |
| glade meadow (first grunts) | 318 | 160 | 587 k |
| bog island B2 | 268 | 200 | 614 k |
| fort bridge | 355 | 149 | 591 k |
| fort outer yard (worst) | 346 | 232 | 778 k |
| fort iron gate | 287 | 197 | 679 k |
| fort back yard | 284 | 189 | 679 k |
| inside the pit (boss) | 162 | 145 | 432 k |

Every measured view is under the 250-call budget. Bandit cost now is:
* up close (< 12 m): 14–17 calls;
* mid range (12–28 m): about 8;
* far (> 28 m): 1–2.

**Allocations.** Heap sampling (CDP, 512-byte interval) over 600 fixed steps and 60 rendered frames of
combat, with bandits, throws and lock-on, measured about 1.1 KB per step. Almost all of it is V8 number
boxing inside three.js's `updateMatrixWorld` and the renderer's uniform uploads. Game code allocates
nothing per step beyond event payloads (footsteps, combo updates), so young-generation GC stays
negligible. The debug API's event log (`__game.events`) summarises every event, a few hundred bytes each.

## How to test

```
npm run build                                                       # dist/index.html + dist/artifact.html
node tools/smoke.mjs --html dist/index.html --out dist/integ/smoke.png --w 960 --h 540 --wait 8000
node tools/scenario.mjs tools/scenarios/integ-playthrough.mjs --html dist/index.html --shots dist/integ/shots   # ~20 min
node tools/scenario.mjs tools/scenarios/integ-states.mjs      --html dist/index.html --shots dist/integ/shots   # ~8 min
node tools/scenario.mjs tools/scenarios/integ-hot.mjs         --html dist/index.html --shots dist/integ/shots
node tools/scenario.mjs tools/scenarios/integ-results.mjs     --html dist/index.html --shots dist/integ/shots --w 400 --h 860
node tools/scenario.mjs tools/scenarios/integ-title.mjs       --html dist/index.html --shots dist/integ/shots
node tools/scenario.mjs tools/scenarios/integ-perf.mjs        --html dist/index.html --shots dist/integ/shots   # PERF_ONLY=calls|alloc
```
For readable stack traces, build an unminified copy with
`node tools/build.mjs --entry src/main.js --out dist/dev-integration --dev`. Area regression runs also
build their sandboxes under `dist/dev-integration/<area>/`.

The playthrough drives the shipped page, in this order:
1. The title renders (title music, the level built, the maximum pinned).
2. The **real Enter key** starts the game and audio unlocks.
3. **Real W and Space keys** run and jump. Scripted input then walks the meadow and jumps the tutorial ledge.
4. Two glade grunts are killed with real lock-on throws.
5. The ridge, the ravine glide and the glade lantern are done on foot.
6. Every checkpoint in order (`start`, `glade`, `bog`, `fort`, `pit`). For each one the scenario checks the zone event and the music, takes a screenshot, records draw calls and runs 3 s of simulation.
7. A perched slinger is killed with real throws.
8. An ironbelly: puffs clang off, then the real Anvil Tonic iron breaks the cauldron and kills him.
9. Chief Gnarlbelly in god mode:
   * he wakes and the pit gate closes;
   * real volleys in the dizzy windows;
   * Morel walks to the boss's Anvil jar to crack the plate;
   * phases 2 and 3, then defeat.
10. The Lantern Gate rises and Morel walks into the portal: `level:complete`, then results 1.2 s later with victory music.
11. Results: sensible numbers and the DOM card.
12. The **real Enter key** on "Play again" resets the whole run, checked against the first boot's entity counts.
13. Zero console errors or warnings.

`integ-states` covers:
* a mouse click on Start;
* the real Esc key pauses (time frozen, pointer lock released) and P resumes;
* a hidden tab pauses, and the Resume button continues;
* death: splat, then respawn at the lit glade lantern with full hearts;
* "Restart from checkpoint" inside the locked ambush and inside the boss fight;
* "Quit to title" prepares a fresh run, and Start begins again.

Headless notes:
* SwiftShader renders at about 2 fps and clamps `realDt` to 0.25 s, so the results count-up and CSS
  transitions lag far behind the game. The scenarios wait for the rank badge, and `settledShot` finishes
  finite CSS animations before each screenshot.
* The scripted boss fight compresses minutes into seconds, so its hint toasts are still on screen when
  the boss falls.

## Known issues
* The boss fight in the playthrough clears summoned minions with direct hits (`hurt(9)`) to keep the
  line of fire open. On the dizzy window where no real puff landed, three scripted homing shots were
  used: one window out of ten in the last run. Everything else uses real thrown projectiles.
* The far-LOD bandit is a static rest pose. Beyond 28 m a walking bandit glides without leg motion,
  which is hard to see at that range in the fog.
* The hot snapshot keeps the score but not the world: glowcaps and bandits behind the restored
  checkpoint come back.
