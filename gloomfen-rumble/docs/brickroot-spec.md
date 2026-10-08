# Brickroot — dig and build (feature spec)

Gloomfen Rumble gains a block-digging and block-building system. Morel finds the
**Rootwright's Trowel**, digs blocks out of voxel ground, carries them in a
hotbar, and places them anywhere in the level to build bridges, stairs, walls
and towers. A new optional area, **Brickroot Hollow**, is made entirely of
diggable blocks, with caves, ore and secrets.

The system is original. Use no names, characters, creatures, block textures,
item art, sounds or UI layouts from Minecraft or any other game. Block art is
bog-themed and painted procedurally in our own palette. There is no crafting
table and there are no hostile mobs spawned at night: this is a building
mechanic inside a platformer, not a survival game.

## Player-facing design

### The trowel
- A `trowel` pickup sits beside the first tutorial signs at the start area, so
  every player finds it in the first minute. Picking it up shows a toast:
  "Rootwright's Trowel! Press B to dig and build." It also pre-loads the hotbar
  with 12 driftwood blocks, so the player can try placing right away.
- Before the trowel is found, B does nothing except show a hint toast.
- New runs (Play again / Quit to title) start without the trowel.

### Build mode (toggle)
| Action | Keyboard + mouse | Gamepad | Touch |
|---|---|---|---|
| Enter / leave build mode | B | Y (button 3) | Build button |
| Dig the targeted block | J / left mouse (hold = keep digging) | X / RB / RT | Dig button |
| Place the selected block | K / right mouse | LT / LB | Place button |
| Select block | 1–7, mouse wheel | D-pad left/right | tap a hotbar slot |

In build mode:
- The camera moves to an over-the-shoulder view (right shoulder, ~4.6 m back)
  and a crosshair appears at screen centre.
- The camera ray picks the first solid voxel or world surface within 7 m of
  Morel. A crisp outline box hugs the targeted voxel. A translucent ghost of
  the selected block shows where it will be placed: tinted moss-green when the
  spot is valid, berry-red when it isn't.
- Morel can still walk, jump and glide. Throwing and lock-on are off. Shift and
  K are reused, so leaving build mode restores them.
- Pausing, dying, entering a boss or ambush lock, or getting hurt hard (2+
  damage) drops Morel out of build mode.

### Digging
- Each dig swing takes 0.28 s and plays a quick trowel-chop animation. Hits
  needed per block come from its hardness. Crack stages (3 overlay textures)
  show progress, and switching targets resets it.
- When a block breaks, it bursts into particles and a small cube chunk flies
  into Morel, adding +1 to that block type. The stack cap is 99 per type.
- While the **Anvil Tonic** is active, every block breaks in one hit. Anvil iron
  balls also smash the first block they hit, outside build mode too.
- Only voxel blocks can be dug. The hand-built level (heightfield terrain,
  props, palisades, the pit) can't be dug, but blocks can be placed on it.

### Placing
- A block goes in the empty cell next to the targeted face, or on top of the
  targeted ground/prop surface, snapped to the global 1 m grid.
- It's invalid if the cell overlaps Morel or any entity's collision cylinder,
  is outside the level bounds, is above y = 64, or is inside a no-build volume.
  An invalid placement shows the red ghost and a short "bonk" sound.
- No-build volumes are the inside of Gnarlbelly's Pit and the ambush courtyard
  while it's locked (the toast reads "The bandits' grudge-magic smothers your
  trowel here."), plus a 1.2 m radius around checkpoints and tonic jars so they
  can't be buried.
- Placed blocks are real collision for Morel, bandits, projectiles and the
  camera. Players can wall off a slinger's mud, bridge the bog or stair up to
  the fort walls. Shortcuts are intended, but nothing may softlock the game.
  For example, if Morel boxes himself in completely, he can still dig out.

### Block types (ids 1–7)
| id | name | look (procedural 16×16 pixel art, nearest filtering) | hardness (hits) | surface | points when dug |
|---|---|---|---|---|---|
| 1 | Mossturf | rounded moss-cushion top with tiny sprouts, peat sides with a ragged moss fringe | 1 | moss | 0 |
| 2 | Peat | dark fibrous brown with root threads and a few pale grit specks | 1 | mud | 0 |
| 3 | Bogstone | grey-green rounded cobbles, dark mortar, lichen dots in amber | 3 | stone | 0 |
| 4 | Driftwood | weathered silver-brown planks running diagonally, knot holes, rope lashing | 2 | wood | 0 |
| 5 | Reedthatch | woven golden reed basket-weave | 1 | wood | 0 |
| 6 | Glowshard | cyan crystal facets with a bright core; emissive, so it blooms | 2 | stone | 100 |
| 7 | Bog-iron | near-black stone with rust-orange nodules and a dull iron sheen | 4 | iron | 75 |

Glowshard and bog-iron points go through the normal combo system
(`score:award` with reason `'mine'`). They're bonus points: leave them out of
`score.maxPossible()`.

### Brickroot Hollow (new optional area)
- A voxel valley about 48 × 48 m across and 28 m deep, reached by a signposted
  side path (a hollow-log tunnel through the ridge) off the **Mossy Glade**,
  before the glade checkpoint. The level designer picks the exact spot, using
  the space outside the current x ±45 route corridor and widening the bounds
  clamp locally. It must be hidden behind terrain so it doesn't cost draw calls
  from the main route.
- Seeded, deterministic generation:
  - **Surface:** mossturf hills, reedthatch patches, driftwood stumps and logs,
    and a few glowing mushrooms (reuse the level's prop builders).
  - **Underground:** peat layers over bogstone, with noise-carved caves.
  - **Deeper down:** glowshard veins that light the caves, and bog-iron near
    the bottom.
- Rewards:
  - About 20 glowcaps inside caves.
  - One glowworm cage (cage 9) at the bottom of the deepest cave. The cage
    total changes from 8 to 9, and score/HUD totals already come from
    registered cages.
  - A floating sky islet about 22 m above the valley floor with a glowcap ring
    and a berry. It's reachable only by building a tower (or with an Updraft
    Tonic, which the Hollow doesn't offer).
- Two grunts patrol the surface. They must path on voxel ground: their
  `physics.groundHeight` probes have to see voxels.
- A sign at the entrance reads "Brickroot Hollow — dig deep, build high."

### Rubble mounds
Eight small diggable voxel piles (6–14 blocks each, with mixed turf, peat,
bogstone and driftwood) are spread along the main route. Each zone gets at
least one. Builders can restock without returning to the Hollow.

## Engine design (`src/game/voxel/*`)

| File | What |
|---|---|
| `blocks.js` | block registry: id, name, hardness, surface, points, emissive, atlas tiles (top/side/bottom) |
| `textures.js` | seeded canvas painter → one atlas texture (8×4 tiles of 16 px, nearest, no mipmaps or with padded tiles so there's no bleeding) + 3 crack overlay tiles |
| `world.js` | sparse chunked storage: 16³ `Uint8Array` chunks in a `Map` keyed by chunk coords; `get/set(x,y,z)`, `isSolid`, DDA voxel raycast (Amanatides & Woo), dirty-chunk set, change log for resets |
| `mesher.js` | per-chunk face-culled mesh (greedy meshing optional) with per-vertex ambient occlusion baked into vertex colours, atlas UVs, a shared toon material, and emissive faces in a second geometry group with an emissive material. Remeshes at most 2 dirty chunks per rendered frame (nearest first). Uses frustum + distance culling. |
| `physicsProvider.js` | plugs voxels into `ctx.physics` (below) |
| `build.js` | build-mode controller: toggle, targeting, ghost/outline meshes, dig timing, cracks, placement validation, inventory, events |
| `hollow.js` | Brickroot Hollow generator + rubble mounds + sky islet (deterministic seeded noise) |
| `index.js` | `installVoxels(ctx)` → `ctx.voxels`; registers the `trowel` spawn type; listens for run resets |

### Core hooks (small, additive changes to `src/core/physics.js`)
`physics.addProvider(provider)` → remove(). A provider supplies extra solid
boxes and raycast/sphere hits:
```js
provider = {
  gather(minx, miny, minz, maxx, maxy, maxz, out),   // push pooled pseudo-colliders {min,max,surface,tag:'voxel',data:{x,y,z,block},enabled:true,isMover:false}
  raycast(origin, dir, maxDist) → { point, normal, distance, collider } | null,
  sphere(center, radius) → collider | null,
}
```
`gather()` in physics appends provider boxes for the query box. Callers that
only have an xz rect pass a y range: `moveCharacter` uses the body's swept
vertical span, and `groundHeight` uses `[-Infinity, fromY]`. Merge vertical
runs of solid voxels in a column into one box so a character query returns a
few dozen boxes at most. `raycast` and `sphereHitsWorld` also consult
providers and return the nearest hit. Pseudo-colliders come from a pool and
are only valid until the next query. Nothing may keep a reference to them,
so `body.ground` gets a stable sentinel `{ tag: 'voxel', surface }` instead.

### Events
| Event | Payload |
|---|---|
| `trowel:found` | `{ position }` |
| `build:mode` | `{ on }` |
| `voxel:select` | `{ slot, block, count }` |
| `voxel:dig` | `{ position, block, hitsLeft }` |
| `voxel:break` | `{ position, block, points }` |
| `voxel:place` | `{ position, block }` |
| `voxel:denied` | `{ reason: 'occupied' \| 'nobuild' \| 'bounds' \| 'empty' \| 'height' }` |
| `voxel:inventory` | `{ counts: { [blockId]: n } }` |

### `ctx.voxels`
```js
voxels.world                // get/set/isSolid/raycast
voxels.inventory            // { counts, selected, has(id), add(id,n), take(id) }
voxels.hasTrowel, voxels.buildMode
voxels.setBuildMode(on), voxels.give(id, n), voxels.reset()   // reset = regenerate the Hollow + mounds, clear placed blocks, clear inventory and trowel
voxels.snapshot() / voxels.restore(data)                      // placed/dug deltas (capped at 4,000 edits) for the artifact hot reload
```

### Integration
- `installVoxels` runs after the mechanisms installer and before flow. The
  level builder calls `ctx.voxels.generate(levelData)` (or flow does it after
  `buildLevel`), and `flow.newRun()` calls `voxels.reset()`.
- Deaths and checkpoint respawns keep the world edits and inventory. A new run
  resets them.
- The hot snapshot includes `voxels.snapshot()` when it's under the cap.
- `__game` gains `voxels`, `giveBlocks(id, n)`, `giveTrowel()`.

### HUD and audio
- The hotbar is a bottom-centre strip of 7 slots. Each slot shows a mini
  isometric cube drawn from the atlas onto a small canvas, plus a count badge.
  The selected slot is raised and outlined in amber. Empty types are dimmed.
  It shows only once the trowel is found, and grows slightly in build mode.
- Crosshair: a small four-leaf reticle. There's also a "BUILD" pill near the
  hearts, a crack-progress arc around the crosshair while digging, and a toast
  when a placement is denied.
- Touch: Build toggle; in build mode the Throw/Lock buttons relabel to Dig and
  Place, the hotbar is tappable, and the crosshair stays at screen centre
  (aiming by camera drag).
- SFX (synthesized):
  - dig, per material: soft crunch for turf/peat, woody tock for driftwood and
    reedthatch, stony chink for bogstone, glassy ting for glowshard, dull clank
    for bog-iron
  - break: crumble + material layer
  - place: thunk
  - select: tick
  - build mode on/off: two-note whoosh
  - denied: bonk
  - trowel found: jingle

## Performance budget
- The Hollow is 3 × 3 × 2 chunks of 16³. Even at the worst view it should stay
  at ≤ 60 voxel draw calls, and the rest of the route stays under the existing
  250-call budget.
- Remeshing a chunk takes < 4 ms on a mid laptop. Dig and place feel instant
  because the edited chunk remeshes the same frame, and neighbour chunks
  remesh only when the edit sits on a border.
- Physics provider queries make no per-step allocations.

## Testing
- Sandbox: `src/dev/voxels.js` boots the test arena plus a voxel hill, a voxel
  tower and a rubble mound.
- Scenarios (`tools/scenarios/voxel-*.mjs`) must cover:
  - collision: walk into, stand on, step-up onto 0.4 m, and jump onto 1 m blocks
  - walking off a dug hole
  - no tunnelling at 40 m/s
  - camera collision with blocks
  - enemies walking on voxel ground and not walking off dug holes
  - projectiles stopping on blocks, and iron balls breaking them
  - digging hardness and anvil one-hits
  - placement validity (occupied, no-build, bounds, height)
  - inventory caps
  - reset on a new run
  - the cage in the Hollow freed
  - the sky islet reachable by building
  - draw calls in the Hollow
  - zero console errors
- Existing integ suites (`integ-playthrough`, `integ-states`, `integ-hot`,
  `integ-perf`) must stay green.
