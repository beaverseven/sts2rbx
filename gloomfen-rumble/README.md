# Gloomfen Rumble

A 3D browser platformer set in a twilight fairy-tale bog. You play **Morel**, a small
morel-mushroom sprite with a mossy scarf and a dock-leaf parasol. The **Bog Bandits**, squat toads in
burlap cloaks and dented tin-pot helmets, have taken over Gloomfen. Cross the Mossy Glade, hop
through the Sunken Bog, break into the Bandit Fort and face **Chief Gnarlbelly** in his pit. Then
walk into the Lantern Gate.

The whole game is one self-contained HTML file. Every model is built from code, every texture is
drawn on a canvas, and every sound and note of music is synthesized in the browser. There are no
asset files.

## Play

Open `dist/index.html` in a recent desktop or mobile browser: Chrome, Edge, Firefox or Safari from
2023 or later, with WebGL. Click **Start**, or press Enter / Space / gamepad A. Sound starts with
your first click or key press.

| Action | Keyboard + mouse | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrow keys | left stick | left half: floating stick |
| Camera | mouse (click the scene to capture it), Q / E to swing | right stick | drag on the right half |
| Jump, hold in the air to glide | Space | A | Jump button |
| Throw a spore puff (hold to charge) | J or left mouse | X / RB | Throw button |
| Lock on and strafe (hold) | K, Shift or right mouse | LT / LB | Lock button |
| Pause | Esc / P | Start | pause icon |

**How to play**
* **Glowcaps** (cyan crystal mushrooms) are worth 50. Bandits are worth 200 to 400, and freeing a glowworm from its cage is worth 500.
* Every scoring event within 3 seconds of the last one grows your **chain**. Longer chains multiply your points, up to ×6. Getting hurt ends the chain.
* **Tonic jars** last 20 seconds:
  * **Anvil**: iron throws that break iron gates and armour.
  * **Updraft**: hold jump in the air to rise.
  * **Seeker**: three homing puffs per throw.
* You have five hearts. Falling into the bog costs one. Losing all five sends you back to the last lit lantern with your score intact.
* Chief Gnarlbelly only gets hurt while he is dizzy, after his foot gets stuck or he crashes. Once he puts his chest plate on, find the Anvil Tonic he leaves on the arena ring.
* The results screen shows your time, glowcaps, glowworms, best combo and a rank: Bronze, Silver, Gold or Glowing. The rank comes from how much of the level's 53,280-point maximum you reached.

Settings (volumes, camera speed, invert Y, graphics quality) are in the title and pause menus and
are remembered in your browser.

## Build and run (developers)

```
npm install            # three 0.185.1, esbuild, playwright (for the headless tests)
npm run build          # -> dist/index.html (standalone page) and dist/artifact.html (claude.ai artifact format)
npm run dev            # rebuild on change
```
`dist/index.html` works straight from `file://`. `dist/artifact.html` is the same page without
`<html>`, `<head>` and `<body>` wrappers. Its only external requests are the two Google Fonts; offline,
fallback fonts are used. When it runs inside the claude.ai artifact viewer, a republish resumes at your
last checkpoint (`window.claude.hot`).

URL options: `?quality=high|medium|low`, `?state=playing` (skip the title), `?touch=1` (force touch controls).

### Code map
| Path | Area |
|---|---|
| `src/main.js`, `src/game/flow.js` | integration: boot, game-state machine, hot reload ([docs/integration.md](docs/integration.md)) |
| `src/core/*`, `src/game/player.js`, `camera.js`, `projectiles.js` | engine, Morel, camera ([docs/core.md](docs/core.md)) |
| `src/game/level/*` | Gloomfen: terrain, props, water, mechanisms, the route ([docs/level.md](docs/level.md)) |
| `src/game/enemies/*`, `src/game/boss.js` | Bog Bandits and Chief Gnarlbelly ([docs/enemies.md](docs/enemies.md)) |
| `src/game/pickups.js`, `src/game/score.js` | glowcaps, berries, tonics, cages, lanterns, Lantern Gate, combo scoring ([docs/pickups.md](docs/pickups.md)) |
| `src/audio/*` | synthesized sound effects and music ([docs/audio.md](docs/audio.md)) |
| `src/ui/*`, `src/page.html` | HUD, menus, touch controls ([docs/ui.md](docs/ui.md)) |
| `src/dev/*` | per-area sandboxes (not shipped) |
| `ARCHITECTURE.md` | the design brief and the runtime contract between areas |

### Tests
Headless Chromium with SwiftShader, at a 960×540 viewport:
```
node tools/smoke.mjs --html dist/index.html --out dist/integ/smoke.png --w 960 --h 540 --wait 8000
node tools/scenario.mjs tools/scenarios/integ-playthrough.mjs --html dist/index.html --shots dist/integ/shots
node tools/scenario.mjs tools/scenarios/integ-states.mjs      --html dist/index.html --shots dist/integ/shots
node tools/scenario.mjs tools/scenarios/integ-hot.mjs         --html dist/index.html --shots dist/integ/shots
node tools/scenario.mjs tools/scenarios/integ-perf.mjs        --html dist/index.html --shots dist/integ/shots
```
Each area also has its own sandbox and scenarios; see its doc. `window.__game` is the debug API the
scenarios drive: `step`, `teleport`, `gotoCheckpoint`, `give`, `godMode`, `setInput`, `events` and more.

## Originality

Gloomfen Rumble borrows only general genre mechanics from early-2000s 3D platformers: a charged throw,
lock-on strafing, a glide, timed power-ups and combo scoring. Everything else is original to this
project:
* the hero, the enemies and their names;
* the world, the level layout and the story;
* every model, texture, sound effect and piece of music.

It does not use, copy or imitate assets, characters, levels, melodies or sounds from any existing game
or franchise, and is not affiliated with one. Third-party code: three.js (MIT) and, at build time,
esbuild. The fonts Bagel Fat One and Grandstander come from Google Fonts (SIL Open Font License).
