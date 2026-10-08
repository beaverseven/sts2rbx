# UI: HUD, menus, touch controls

This area covers everything drawn in the DOM over the 3D canvas: the in-game HUD, the menus (title, controls,
settings, pause and results), the touch controls, the page shell (`src/page.html`) and settings persistence.
It is all original. The leaf-hearts, glowcap, glowworm, tin-pot, morel-cap glyph, vine flourish, splat blob
and rank medallion are inline SVG drawn for this game. There are no image or font files: fonts come from
Google Fonts.

| File | What |
|---|---|
| `src/page.html` | `<title>` (first line), font links, every UI style (tokens, HUD, menus, touch, responsive, reduced motion), `#app` / `#ui` and the `<!--BODY-->` / `<!--BUNDLE-->` markers |
| `src/ui/index.js` | `installUI(ctx)` and `wireMenuIntents(ctx)` (optional default wiring), plus re-export of `MENU_INTENTS` |
| `src/ui/hud.js` | `createHud(ctx, root)`: hearts, score and combo, counters, tonic ring, boss bar, reticle, charge ring, popups, zone card, toasts, vignette and splat |
| `src/ui/menus.js` | `createMenus(ctx, root, hud)`: the menu screens, the navigation stack and the input handling |
| `src/ui/touch.js` | `createTouch(ctx, root)`: floating stick, camera drag, Jump / Throw / Lock buttons and the pause button |
| `src/ui/settings.js` | localStorage load and save (every access in try/catch) and the quality setter |
| `src/ui/icons.js`, `src/ui/dom.js` | SVG markup; small DOM helpers (`el`, cached `setText` / `setClass` / `setAttr`, `animate` with reduced motion) |
| `src/dev/ui.js` | Sandbox with fake-event shortcuts and a dev panel |
| `tools/scenarios/ui-*.mjs` | Screenshots, keyboard and mouse navigation, multi-touch, the real level, and miscellaneous checks |

## Install

```js
import { installUI, wireMenuIntents } from './ui/index.js';
boot({
  startState: 'title', buildLevel,
  install: [installAudio, installScore, installUI, wireMenuIntents /* or your own wiring */, installEnemies, installPickups, installMechanisms],
});
```
`installUI(ctx)`:
* builds all of its DOM inside `#ui` (it creates `#ui` if the page lacks it);
* applies the stored settings: `ctx.settings`, `ctx.audio.setVolumes` and the quality when one was chosen;
* sets `ctx.hud`, `ctx.menus` and `ctx.ui = { root, hud, menus, touch }`;
* follows `game:state`;
* registers one `ctx.addSystem({ order: 1000, frame })` hook, which drives the HUD, the menu input and the touch ring.

Install it after `installAudio` so stored volumes reach the real audio engine. Its order relative to the
other installers does not matter otherwise.

### State to UI mapping (`game:state`)

| State | UI |
|---|---|
| `title` | HUD hidden, title menu shown, per-run HUD state reset (boss bar, combo, tonic, popups) |
| `playing` | Menus hidden, HUD shown, touch controls active |
| `paused` | HUD stays visible (dimmed behind the panel), pause menu shown |
| `dead` | HUD stays visible, the splat card plays (core returns to `playing` after 1.4 s and the curtain lifts) |
| `results` | HUD hidden, results menu shown with the last `level:complete` stats, unless the integration already called `menus.show('results', stats)` |

## API

### `ctx.hud`
```js
hud.toast(text, sec = 3, { kind: 'hint' | 'sign' | 'glowworm' | 'tonic' }?)  // max 2 on screen; same text refreshes
hud.showBossBar(on)                   // the boss calls this; boss:start / boss:defeated also toggle it
hud.zoneCard(name, id, force = false) // what zone:enter calls; force shows the card even for the current zone
hud.splat(on, instant = false)        // what player:died / the respawn calls
hud.setVisible(on), hud.clearToasts(), hud.resetRun()
hud.frame(realDt)                     // called by installUI's system
hud.visible, hud.bossVisible          // getters
```
### `ctx.menus`
```js
menus.show(name, data)   // 'title' | 'controls' | 'settings' | 'pause' | 'results' | 'dead' (= hud.splat(true))
menus.hide()
menus.push(name) / menus.pop() / menus.back() / menus.confirm()
menus.current            // name of the visible screen or null
menus.stack, menus.focusIndex, menus.focusLabel, menus.screens, menus.INTENTS
```
`show('results', data)` takes either the stats or a `{ stats }` payload. These fields are used: `total`
(or `points`), `rank`, `elapsed`, `glowcaps`/`glowcapsTotal`, `cagesFreed`/`cagesTotal`, `bestChain`, `kills`
and `deaths`. With no data it falls back to `ctx.score.snapshot()` and `ctx.score.rankInfo()`.

### Menu intents (the menus never run game logic)

| Event | Emitted by |
|---|---|
| `menu:start` | Title, Start |
| `menu:resume` | Pause, Resume (also Back on the pause screen) |
| `menu:restartCheckpoint` | Pause, Restart from checkpoint |
| `menu:quitTitle` | Pause, Quit to title; Results, Title |
| `menu:playAgain` | Results, Play again |

The payload is always `{}`. The menus also call `ctx.audio.play('menuMove' | 'menuConfirm' | 'menuBack')`
and `play('scoreTick')` during the results count-up.

**`wireMenuIntents(ctx)`** is the default wiring. The sandbox uses it, and so can main.js:
* `menu:start` begins a new run if one was already played, then sets `'playing'`.
* `menu:resume` sets `'playing'`.
* `menu:restartCheckpoint` refills the hearts, calls `player.respawnAt(checkpoint)`, emits `player:respawn {checkpointId}` and sets `'playing'`.
* `menu:quitTitle` sets `'title'`.
* `menu:playAgain` calls `level.reset()` and `score.reset()`, sets the checkpoint to the first one, refills the hearts, ends any tonic, respawns at `level.spawn`, emits `player:respawn` and sets `'playing'`.
* `level:complete` leads to `'results'` 1.2 s later.

### Events the HUD listens to
* `player:hurt` triggers the vignette flash, the heart shake and the wilt of the lost heart.
* `player:died` plays the splat. `player:respawn` with a `checkpointId` lifts the curtain.
* `score:award` feeds the popups and the score target.
* `combo:update` and `combo:end` drive the combo meter, plus an "N-chain +pts" line when a chain of 3 or more ends.
* `pickup:glowcap` and `cage:freed` drive the counters.
* `tonic:start`, `tonic:warning` and `tonic:end` drive the tonic ring. The first time each tonic is drunk, a toast explains it.
* `player:charge` and `player:throw` are a fallback for the charge ring.
* `boss:start`, `boss:phase`, `boss:hurt` and `boss:defeated` drive the boss bar.
* `zone:enter` shows the zone card. If it arrives while not playing, the card is held until play starts.
* `ui:message` becomes a toast. `speaker: 'glowworm'` and `source: 'sign'` get their own icon, and the "Title: text" of signs gets a bold title.
* `checkpoint:reached` shows a toast.
* `level:complete` stores the stats for the results screen.
* `game:state` (see above).

Every frame the HUD also reads these directly, so it is always exact:
* `ctx.player.hp` / `maxHp`, `tonic`, `lockTarget` and `charge`;
* when the real score is installed, `ctx.score.points`, `glowcaps` / `glowcapsTotal` and `cagesFreed` / `cagesTotal`.

## What it looks like

* **Page.** It uses a single dark twilight look. `color-scheme: dark` is set, and `html`, `body` and `#app` have explicit backgrounds. Every colour is a CSS custom property on `:root` taken from the ARCHITECTURE.md palette: `--sky-top`, `--sky-mid`, `--horizon`, `--moss`, `--moss-dark`, `--bark`, `--bog`, `--glow-cyan`, `--glow-magenta`, `--amber`, `--iron` and `--outline`. There are a few named extras: `--cream`, `--ink`, `--ochre`, `--cap-dark` and `--updraft`, shared with core's material palette, plus `--berry` and `--iron-light`. Derived shades are `color-mix()` of those tokens.
* **Fonts.** **Bagel Fat One** is the display face, used for the logo, titles, big numbers and popups. **Grandstander** is the UI face. Fallback stacks are `'Cooper Black', 'Arial Rounded MT Bold', 'Arial Black', ui-rounded, system-ui` and `'Trebuchet MS', Verdana, ui-rounded, system-ui`. Score and timers use `font-variant-numeric: tabular-nums`.
* **HUD.** Top-left holds 5 leaf-hearts, the glowcap and glowworm pills, and the tonic ring:
  * The hearts shake and flash on hurt, the lost heart wilts, and refills pop in one by one. At 1 heart the last heart beats and a soft red edge pulses.
  * The tonic ring is a draining ring in the tonic's colour, with an anvil, chevron or seeker-spiral icon, seconds left, and a blink in the last 3 s.

  Top-right holds the score, which rolls up and snaps down on a reset. Under it is the combo meter: chain count, a draining bar and a ×N badge whose colour changes per tier. The tiers are cream, cyan, updraft green, amber, magenta and an iridescent ×6. The badge pops when the tier rises.

  The boss bar sits at the top centre: a tin-pot icon, "Chief Gnarlbelly", three phase pips, and a magenta bar with 3 segments, a white damage trail and a shake on hits.

  Other HUD elements:
  * **Lock-on reticle.** A spinning amber ring with 4 notches, projected onto `lockTarget` at 55 % of its height.
  * **Charge ring.** It sits inside the reticle when locked, otherwise beside Morel's head. It is cyan, or iron or magenta with those tonics, and pulses at full charge.
  * **Popups.** Pooled "+400 ×3" popups (20 nodes) rise and fade. They grow with the tier and with points of 1000 or more, and stack upward when several land at once.
  * **Zone card.** "Zone N of 4" over the name, with bouncing letters and a vine-and-morel flourish that draws itself. It lasts 2.7 s and hides itself on `animationend`.
  * **Toasts.** Bottom centre, or above the buttons in touch mode.
  * **Hurt.** A red vignette flash.
  * **Death.** A "Splat!" blob card pops in, then a dripping bog-ink curtain drops. On respawn it slides away downward.
* **Title.** The logo is "Gloomfen" in amber over "Rumble" in cream, with layered outline and drop text-shadows, a slight tilt, jittered letters and a magenta under-layer. A morel-cap glyph hops beside "Rumble" and cyan spores drift up. Below are the tagline, the Start / Controls / Settings panel and "An original game. Built with Three.js." The 3D scene orbits behind a soft left-side scrim.
* **Focus.** The focused button turns amber with an indigo outline and shows a small morel cap at its left. Settings rows get an amber border.

## Navigation
* **Keyboard and gamepad** go through `ctx.input`, polled in the frame hook while not simulating:
  * `up` / `down`, or the move stick past 0.55, move the focus. Holding repeats after 0.36 s.
  * `left` / `right` change sliders and toggles, and move between footer buttons.
  * `confirm` activates the focused item. It is Space, Enter or pad A.
  * `back` goes up one level. It is Esc, Backspace or pad B.

  A fresh key press always steps, so two quick taps never merge into one hold. Input is ignored for 180 ms after a screen opens.
* **Esc inside a pause sub-page** (Settings or Controls) returns to the pause menu. A window capture listener stops core seeing that Esc as "unpause". Esc or P on the pause screen itself resumes, which core handles.
* **Mouse.** Hover focuses an item and click activates it. Sliders support dragging.
* **Tab** moves DOM focus, and the menu follows. Enter and Space on a focused button are not also handled natively.
* **Touch.** Tap activates a button. Long panels scroll, and the Back footer sticks to the bottom only when the panel overflows.
* **Results.** The first confirm during the score count-up skips to the end.

## Settings
These settings are shown:
* **Master, Music, Effects** (0–100 %, step 5): writes `ctx.settings` and calls `ctx.audio.setVolumes`.
* **Camera speed** (0.3–2.0×): writes `ctx.settings.sensitivity`, which the input reads every step.
* **Invert camera Y**: writes `ctx.settings.invertY`.
* **Graphics** (High / Low): calls `ctx.setQuality(q)`. This also turns off core's auto-quality. The control shows `gfx.quality`, so it also reflects an automatic drop to low.

Settings are saved to `localStorage['gloomfen-rumble.settings.v1']`. Quality is stored only after the player
picks one, so auto-quality keeps working until then. A `?quality=` URL overrides the stored choice. Every
storage access is wrapped. Without storage the note under the panel says the settings last until the page
is closed.

## Touch
* **When it appears.** On `(pointer: coarse)` at boot, or on the first touch (`touchstart` or a touch `pointerdown`). A real mouse click switches back to desktop. `?touch=1` and `?touch=0` force it on or off. The `#ui.touch-mode` class moves the toasts and the boss bar out of the way.
* **Stick and camera.** A touch on the left half places the floating stick, which has 46 px travel, a 12 % deadzone and a base that follows the finger past the rim. It sends `setVirtual({move})`. A drag on the right half sends `setVirtual({look})` pixel deltas.
* **Buttons.** Jump, Throw and Lock send `setVirtual({buttons})` held states. Throw shows a charge ring from `player.charge`. The pause button latches one `pause` press.
* **Multi-touch.** Every finger is tracked by `pointerId` with pointer capture, so stick, camera and buttons work at the same time. All payload objects are reused, so pointer events do not allocate.
* **Visibility.** Controls show only in `'playing'`. Leaving it releases every virtual input once.

## Sandbox
```
node tools/build.mjs --entry src/dev/ui.js --out dist/dev-ui --dev
```
Open `dist/dev-ui/index.html`. It boots the core test arena with audio, score, UI and the default intents.
* **URL options.**
  * `?level=1` boots the real Gloomfen level with every area.
  * `?state=playing` skips the title.
  * `?dev=0` hides the dev panel.
  * `?touch=1` forces the touch controls.
* **Shortcuts** (not on the title; the backquote key or the DEV button toggles the panel):

  | Key | Fake event |
  |---|---|
  | 1 / 2 / 3 / 4 | Anvil / Updraft / Seeker tonic (6 s) / end the tonic |
  | H / G / X | Hurt / heal / die (splat) |
  | C / V | 6-glowcap combo / 12-kill combo (×3) |
  | F / U | Glowcap / glowworm freed |
  | B / N / M | Boss start / boss hit (3) / boss defeated |
  | Z / T / R | Zone card (cycles) / toast (sign, glowworm, hint) / results with sample stats |
  | L / Y | Toggle lock-on (hold) / step the charge ring |

* **`window.__ui`** gives `{ ctx, fake, SAMPLE_STATS, hud, menus, touch, devPanel(on), levelMode }`. `fake.*` holds every shortcut as a function.

## How to test
```
node tools/build.mjs --entry src/dev/ui.js --out dist/dev-ui --dev
node tools/smoke.mjs --html dist/dev-ui/index.html --out dist/dev-ui/smoke.png --w 960 --h 540 --wait 5000
node tools/scenario.mjs tools/scenarios/ui-shots.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots                  # 21 shots
node tools/scenario.mjs tools/scenarios/ui-shots.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots --w 400 --h 860  # 22 (+ touch)
node tools/scenario.mjs tools/scenarios/ui-shots.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots --w 844 --h 390  # landscape phone
node tools/scenario.mjs tools/scenarios/ui-nav.mjs   --html dist/dev-ui/index.html --shots dist/dev-ui/shots                  # 25 checks, real keys + mouse
node tools/scenario.mjs tools/scenarios/ui-touch.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots --w 400 --h 860  # 11 checks, CDP multi-touch
node tools/scenario.mjs tools/scenarios/ui-misc.mjs  --html dist/dev-ui/index.html --shots dist/dev-ui/shots                  # 15 checks
node tools/scenario.mjs tools/scenarios/ui-level.mjs --html dist/dev-ui/index.html --shots dist/dev-ui/shots                  #  7 checks, real level
```
What the scenarios cover:
* **ui-shots** screenshots every state:
  * title, controls and settings;
  * HUD with a combo; a big combo with a tonic;
  * boss bar with lock-on and the charge ring; phase 2 with a full charge;
  * hurt flash, low hp, heal refill;
  * zone card, toasts, tonic warning;
  * splat card, curtain, respawn;
  * pause, pause/settings, pause/controls;
  * results counting, results final;
  * touch.

  Names are prefixed with the viewport.
* **ui-nav** uses real key presses:
  * title arrows, S and wrap-around;
  * settings: Left/Right on sliders, Enter on a toggle, localStorage contents;
  * Esc back to the title; Space on Start;
  * Esc to pause; pause to Settings, then Esc back to pause (still paused); Backspace resumes;
  * P to pause, then Restart from checkpoint (full hearts); the Esc toggle;
  * results: skip the count-up, Left/Right in the footer, Play again;
  * reload restores the settings;
  * mouse clicks on Controls and Back;
  * a held analog stick steps and repeats.
* **ui-touch** emulates touch over CDP:
  * the first touch enables the layer;
  * stick and Jump held together (Morel runs and jumps); releasing one finger at a time;
  * right-half drag turns the camera;
  * hold Throw to charge, which drives the ring, and release for a charged throw;
  * the pause button; tapping Resume.
* **ui-misc** checks:
  * the contract surface, `toast` and `showBossBar`;
  * heart hurt and heal; counters;
  * boss bar fill, pips and hide;
  * the tonic event fallback; results from `level:complete` stats; quit to title;
  * the cost of `hud.frame`;
  * reduced motion;
  * a `localStorage` that throws.
* **ui-level** runs in the real level:
  * the title over the level; the Mossy Glade card when play starts;
  * real glowcap totals; popups and combo from real pickups;
  * the checkpoint toast; the real boss bar in the pit.

Headless SwiftShader renders at about 2 fps, and compositor-driven CSS transitions and animations start
late there. The shot scenarios therefore seek every finite animation to a fixed time and pause it before each
screenshot, then resume it afterwards. On a real GPU none of this is needed.

**Results:**
* All scenarios pass with **zero console errors or warnings**, at 960×540, 400×860 and 844×390. Smoke tests of the sandbox and of `src/main.js` built with this page are clean too.
* `hud.frame` costs **≈ 0.02 ms** with 12 popups in flight, the reticle, the charge ring, the combo, a tonic and the boss bar.
* Core's `core-states` scenario still passes against a core sandbox built with the new `page.html`.

## Contract deviations / additions
1. `installUI(ctx)` returns `ctx.ui = { root, hud, menus, touch }` and also sets that field.
2. `hud.toast(text, sec, opts)` takes an optional third argument (`kind`). There are also `hud.zoneCard`, `hud.splat`, `hud.setVisible`, `hud.clearToasts`, `hud.resetRun`, `hud.frame`, `hud.visible` and `hud.bossVisible`.
3. `menus.show` also accepts `'controls'` and `'settings'`. `'dead'` maps to the HUD splat card and is not a menu panel. Also added: `push`, `pop`, `back`, `confirm`, `current`, `stack`, `focusIndex`, `focusLabel`, `screens` and `INTENTS`.
4. New events emitted (intents): `menu:start`, `menu:resume`, `menu:restartCheckpoint`, `menu:quitTitle`, `menu:playAgain`. Their payload is `{}`.
5. `wireMenuIntents(ctx)` is optional, and emits `player:respawn {position, checkpointId}` on Restart from checkpoint and on a new run.
6. The settings persistence key is `gloomfen-rumble.settings.v1`. Quality is stored only after an explicit choice.
7. `page.html` loads Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). This is the only external request. Offline, the fallback stacks are used.

## Integration notes
* **main.js:**
  ```js
  import { installUI, wireMenuIntents } from './ui/index.js';
  boot({ startState: 'title', buildLevel, install: [installAudio, installScore, installUI, wireMenuIntents, installEnemies, installPickups, installMechanisms] });
  ```
  Or wire the five `menu:*` intents yourself; the list above says what each should do. `menu:start` should start a fresh run when a run was already played (after Quit to title). `level:complete` should lead to `ctx.setState('results')`. The UI shows the results with the stats from that event, or call `ctx.menus.show('results', stats)` yourself.
* **Pointer lock:** the UI does not request pointer lock. Core's camera does it on the first click on the canvas, and the first time play starts with a mouse, the HUD shows a one-time hint, "Click the scene to steer the camera with your mouse." Calling `ctx.input.requestPointerLock()` from your `menu:start` / `menu:resume` handlers works for mouse clicks, because they run inside the click. Keyboard confirms run from the frame hook, a little after the key event. Core's input switches to drag mode permanently if a lock request is rejected, so think twice before adding that.
* **Boss:** it already calls `ctx.hud.showBossBar(on)`. The bar also reacts to `boss:start` / `boss:defeated` by itself, and is cleared on the title.
* **Zone names:** the card uses `zone:enter.name`. For the ids `glade`, `bog`, `fort` and `pit` it adds "Zone N of 4".
* **Rank:** results show `stats.rank` (from pickups). Without it, `ctx.score.rankInfo()` is used, and Bronze as a last resort.
* **The ship build** must be rebuilt with `npm run build`, so that `dist/index.html` picks up the new `page.html`.

* **Integration changes:**
  * The results card has a rank meter under the score, `.res-meter` (classes `rm-bar`, `rm-fill` and `rm-tick`; the generic `.bar` class collides with the HUD's).
  * The meter shows the score as a share of `stats.maxPossible` with the Silver, Gold and Glowing marks, plus "N more for <next rank>".
  * The game uses integration's own intent wiring (`src/game/flow.js`), not `wireMenuIntents`.

## Known issues
* When many score events fire on the same frame at nearby positions, which only fake bursts do, popups can partly overlap. Real pickups arrive spread out over time and stack cleanly.
* The display face's "0" reads as a rounded "O" at the start of a run (score 0). It is fine once digits appear.
* `color-mix()` and `env(safe-area-inset-*)` need a 2023+ browser: Chrome/Edge 111, Safari 16.2, Firefox 113.
* The pause sub-page Esc interception uses a window capture listener. It stops other window keydown listeners from seeing that one Esc press, which only matters on the pause → Settings/Controls pages.
