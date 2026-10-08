# Audio — engine, synthesized sfx, procedural music

Everything you hear in Gloomfen Rumble is synthesized at runtime with WebAudio: no samples and
no asset files. All melodies and arrangements are original compositions.

| File | What |
|---|---|
| `src/audio/audio.js` | `installAudio(ctx)`, `createAudio(ctx?)`: lifecycle/unlock, `play`/`music`/`setVolumes`, spatial pan, the 25 ms scheduler, event wiring, music state machine, ducking, glide/charge loops |
| `src/audio/core.js` | `AudioCore`: bus graph (master/music/sfx, compressor, soft clipper, two reverbs), sfx voices, continuous loops, music crossfader. Works on any `BaseAudioContext` |
| `src/audio/sfx.js` | 74 sfx recipes + aliases, builder helpers (`tone`, `nz`, `bell`, `croak`) |
| `src/audio/instruments.js` | music voices: banjo/harp (Karplus-Strong), tuba, horn, marimba, kalimba, glock, accordion, clarinet + 11 drums |
| `src/audio/sequencer.js` | track compiler (mini notation → step table) + `TrackPlayer` (lookahead scheduling, catch-up after stalls) |
| `src/audio/tracks.js` | the six tracks (`title glade bog fort boss victory`) |
| `src/audio/synth.js` | noise buffers, procedural reverb impulse, KS pluck renderer, soft-clip curve, envelope helpers |
| `src/audio/offline.js` | `renderOffline()` + `analyze()`: offline renders through the real graph, peak/RMS stats (tests) |
| `src/audio/lab.js` | dev-only page entry: the engine without the 3D scene (fast offline tests) |
| `src/dev/audio.js` | sandbox: test arena + audio + audition panel |
| `tools/scenarios/audio-*.mjs` | levels, mix, spectrograms, wiring, hidden tab, fallback |

## Install

```js
import { installAudio } from './audio/audio.js';
boot({ startState: 'title', buildLevel, install: [installAudio, installScore, installUI, installEnemies, installPickups, installMechanisms] });
```
`installAudio(ctx)` replaces `ctx.audio` and subscribes to every game event itself. Nobody else
has to call it, except for sounds with no event (menus, enemy one-offs), which use `ctx.audio.play(name)`.

## API (`ctx.audio`)

Contract:
```js
audio.unlock()                                 // create/resume the AudioContext (call from a user gesture)
audio.play(name, { volume, pitch, position })  // -> handle { name, end, stop(fade) } | null; unknown names are ignored
audio.music(track | null)                      // 'title' | 'glade' | 'bog' | 'fort' | 'boss' | 'victory'; 1.5 s crossfade
audio.setVolumes({ master, music, sfx })       // 0..1, any subset; also written into ctx.settings
```
`position` may be a `Vector3` or `[x, y, z]`. Extra keys in the options object are recipe parameters
(e.g. `play('throw', { kind: 'iron', charge: 1 })`, `play('step', { surface: 'wood' })`).

Extensions:
```js
audio.duck(level = 0.4, seconds = 2)  // temporarily lower the music
audio.stopAll()                        // dispose music players + loops now
audio.state                            // 'none' (not created yet) | 'disabled' | AudioContext.state
audio.track                            // requested track or null
audio.players                          // [{ name, gain, fading, pos }] live music players
audio.names / audio.aliases / audio.tracks
audio.trackInfo(name)                  // { bpm, beats, bars, loopBars, seconds, loopSeconds, parts, firstBar }
audio.stats                            // played/dropped/unknown counters, recent[64], scheduler stats, errors
audio.renderOffline(opts)              // Promise<{ peakDb, rmsDb, activeRmsDb, ... }> (tests, see offline.js)
audio.context / audio.core             // the AudioContext / AudioCore (null until unlocked)
audio.unlock(true)                     // tests only: skip the user-activation check
```
`createAudio(ctx = null)` builds an engine without wiring it to events (the lab page uses it with no ctx).

### Never throws
* No `AudioContext` constructor, a constructor that throws (policy), a context that stays
  suspended or whose `resume()` rejects: every call is a silent no-op (`state` reports `'disabled'`
  / `'suspended'`, `stats.reason` says why). Every public method and every event handler is wrapped;
  internal failures are counted in `stats.errors` / `stats.lastError`, never logged or thrown.
* **No context before a gesture.** The context is created lazily inside `unlock()`, and only once
  `navigator.userActivation.hasBeenActive` is true, so browsers never print the "AudioContext was not
  allowed to start" warning. Core calls `unlock()` on pointer/key/touch. The audio area also adds its
  own capture listeners as a fallback (`pointerdown pointerup mousedown keydown touchstart touchend click`;
  `touchend` matters on mobile, where `touchstart` does not count as activation). They are removed once
  the context runs.
* Music requested before the unlock (e.g. `'title'` at boot) starts as soon as the context runs.

## Event wiring

| Event | Sound / music |
|---|---|
| `player:jump` | `jump` (springy boing) |
| `player:land {impact}` | `land`, louder/lower with impact (ignored below 1.5 m/s) |
| `player:glide {on}` | `glideOpen` (leaf flaps + whoosh); `glideClose` when released in mid-air. The **wind loop** runs while `player.state` is `glide` (speed-dependent) or `updraft` (brighter jet) |
| `player:charge {level}` | level 0 starts the **charge hum loop** (pitch follows `player.charge`, one octave); level 1 → `chargeFull` ping. The hum stops when the charge ends |
| `player:throw {kind, charge}` | `throw`: puff whoosh / heavy iron whoosh + ring / triple seeker zips; charged throws add a low "fwoom" |
| `player:step {surface, speed}` | `step` for moss / mud / wood / stone / iron (quiet) |
| `player:hurt` | `hurt` (Morel's "ow" squeak). Skipped at 0 hp (`died` covers it) and for water falls (`splash` covers it) |
| `player:fell` | `splash` |
| `player:died` | `died` (splat + sagging muted-horn "bwaa-aah"); music ducks to 55 % while `dead` |
| `player:respawn` | `respawn` pop; a checkpoint respawn during the boss fight resets the music (the fight resets) |
| `projectile:hit` | deflected → `deflect` clink (skipped if the enemy just played `clang`/`bossBoing`); iron → `ironHit`; puff on an entity → `puffHit`; on the world → `puffPoof`, on an iron collider → `deflect`; into water → `plop`; mud → `mudSplat` |
| `enemy:alert` | `alert` (rising croak "huh?") |
| `enemy:hurt` | `enemyHurt` croak (`thwack` for the straw dummy) |
| `enemy:killed` | `enemyKilled` pop + squeak (`clatter` for the dummy) |
| `armor:break` | `armorBreak` metal crash |
| `pickup:glowcap` | `glowcap` chime whose pitch climbs the G-major scale with the combo chain (two octaves, then it sparkles in the top one). The chain comes from `score:award` (reason `'glowcap'`), whichever order score and audio were installed in; without a real score object a 3 s internal chain is used |
| `score:award` with multiplier ≥ 3 | `scoreTick` (coin-like, throttled to one per 90 ms) |
| `pickup:berry` | `berry` (squelch + sparkle) |
| `pickup:tonic` *(pickups extra)* | `tonicDrink` (cork pop + two gulps) |
| `tonic:start {kind}` | `tonicStart`: anvil = metallic arpeggio + anvil ting; updraft = rising whistle + breeze; seeker = fast sparkly arpeggio |
| `tonic:warning {remaining}` | `tonicWarn` tick-tock, higher each second |
| `tonic:end` | `tonicEnd` (descending) |
| `tonic:respawn` *(pickups extra)* | `tonicRespawn` shimmer |
| `cage:hit` *(pickups extra)* | `cageHit` (wood knock + startled squeak) |
| `cage:freed` | `cageFreed` (wood crack + glowworm chirp + chime) |
| `checkpoint:reached` | `checkpoint` bell (two strikes) |
| `zone:enter {id}` | `zoneEnter` soft horn (per-zone notes; not again for the same zone within 30 s; only while playing) + music |
| `gate:open` | `gateOpen` iron grind; the Lantern Gate (`id` contains "lantern") → `lanternRise` swell |
| `gate:close` | `gateClose` slam |
| `arena:lock` / `arena:clear` | `arenaLock` (boom + brass stab) / `arenaClear` (fanfare sting) |
| `level:bounce` | `bounce` (bounce shroom) |
| `boss:start` | music → `boss`; `bossRoar` (the boss usually plays it himself, the duplicate is dropped) |
| `boss:phase {phase ≥ 2}` | music ducks briefly under his roar |
| `boss:hurt` | `bossHurt` (deduped with the boss's own call) |
| `boss:defeated` | `bossDefeated` pop; the boss music fades under his deflating raspberry (`bossDeflate`, played by the boss); **4.2 s later the `victory` track starts with its fanfare** |
| `level:complete` | `levelComplete` jingle, music ducked for 2.4 s |
| `ui:message` | `hint` (soft blip, throttled) |
| `game:state` | music + mix (below) |

### Music state machine
`desired()` is re-evaluated on `game:state`, `zone:enter`, `boss:*` and checkpoint respawns:

| Condition (first match) | Track |
|---|---|
| state `title` | `title` |
| state `results` | `victory` |
| boss fight active (`boss:start` … `boss:defeated` / death respawn) | `boss` |
| after `boss:defeated` | silence for 4.2 s, then `victory` |
| zone `glade` / `bog` / `fort` | same name |
| zone `pit` (before the boss wakes) | silence: the fort music fades out for a moment of tension |
| any other zone / no level (sandboxes) | `glade` |

Mix by state: `paused` → music at 42 % through an 850 Hz lowpass ("muffled"), loops muted;
`dead` → music 55 %, 2.6 kHz lowpass; `playing` → full. Hidden tab → music muted (gain 0 in 30 ms),
loops muted; visible → back over ~1 s.
An explicit `audio.music(x)` call holds until the next relevant event.

## Sound names

Use these with `ctx.audio.play(name, opts)`. Unknown names are ignored (counted in `stats.unknown`).

* **Morel:** `jump`, `land {impact}`, `glideOpen`, `glideClose`, `throw {kind:'puff'|'iron'|'seeker', charge}`,
  `chargeFull`, `hurt`, `died`, `respawn`, `step {surface:'moss'|'mud'|'wood'|'stone'|'iron'}`
* **Projectiles:** `puffHit`, `puffPoof`, `ironHit`, `deflect`, `mudSplat`, `splash`, `plop`
* **Bandits** (the enemies area calls most of these directly): `alert`, `enemyHurt`, `enemyKilled`, `thwack`,
  `armorBreak`, `clang`, `cauldronClang`, `potClatter`, `clatter`, `clubWindup`, `clubSlam`, `slingSpin`,
  `slingThrow`, `ironbellyGrunt`, `bellyFlop`, `bellySlap`, `yawn`
* **Chief Gnarlbelly:** `bossSnore`, `bossRoar`, `bossStomp`, `shockwave`, `bossClubSlam`, `bossInhale`, `bossSpit`,
  `bossSummon`, `bossCharge`, `bossSlide`, `bossCrash`, `bossDizzy`, `bossHurt`, `bossBoing`, `bossDeflate`,
  `bossPlop`, `bossDefeated`
* **Pickups / world:** `glowcap {step}`, `berry`, `tonicDrink`, `tonicStart {kind}`, `tonicWarn {remaining}`, `tonicEnd`,
  `tonicRespawn`, `cageHit`, `cageFreed`, `checkpoint`, `zoneEnter {zone}`, `scoreTick {multiplier}`, `levelComplete`,
  `bounce`, `gateOpen`, `gateClose`, `arenaLock`, `arenaClear`, `lanternRise`, `hint`
* **Menus:** `menuMove`, `menuConfirm`, `menuBack`
* **Aliases:** `stomp`→`bossStomp`, `bossStart`/`roar`→`bossRoar`, `fanfare`→`levelComplete`, `pop`→`puffHit`,
  `clink`→`deflect`, `croak`→`enemyHurt`, `coin`→`scoreTick`, `bell`→`checkpoint`, `horn`→`zoneEnter`,
  `menuSelect`→`menuConfirm`, `menuCancel`→`menuBack`, `click`→`menuMove`

Every play gets a small random pitch (± `vary`, 2–10 %) and volume (± 8 %) variation. Per sound: a minimum
gap (duplicate calls inside it are dropped: this is what dedupes the boss's own calls against the events),
a maximum of simultaneous voices, and 40 voices in total.

### Spatial
With `position`, distance is measured from the nearer of the camera and Morel (so sounds next to Morel
are full volume although the camera is 7.5 m behind), and it uses inverse-distance rolloff past each sound's
`ref` distance (7 m by default, 10–30 m for big sounds). It fades to silence at `max(45 m, 7 × ref)` and
anything beyond that is not played at all. Pan comes from the camera's right axis (±0.8, centred
when closer than 3 m), and far sounds get more reverb. Morel's own sounds are played unpositioned (centre).

## Music

| Track | Feel | Key / meter / tempo | Loop | Form | Instruments |
|---|---|---|---|---|---|
| `title` | whimsical waltz | F major, 3/4, 144 bpm | 32 bars, 40.0 s | A A' B(minor) A'' | clarinet tune, accordion "pah-pah", tuba on 1, music-box glock (B), harp arpeggios, woodblock tick-tock |
| `glade` | bouncy swing | G major, 4/4, 112 bpm, swing 0.55 | 32 bars, 68.6 s | A A' B(bridge) A'' | marimba tune, banjo rolls, two-feel tuba (walking in B), accordion chops, clarinet countermelody/bridge, kick + brushes + shaker |
| `bog` | murky | D minor, 4/4, 84 bpm | 32 bars, 91.4 s | A B A' B' | low clarinet, dark accordion pad, kalimba water plinks / doubling, harp, frog croaks, droplets, soft kick |
| `fort` | comic bandit march | G minor, 4/4, 112 bpm | 32 bars, 68.6 s | A A' B(tuba struts) A'' | staccato clarinet (+ marimba doubling), oom-pah tuba, accordion off-beats, marching snare, tin-pot backbeat |
| `boss` | fast and tense | E minor (flat 2nd), 4/4, 150 bpm | 32 bars, 51.2 s | A(ostinato) B(melody) C(breakdown) B' | tuba ostinato, syncopated accordion stabs, brassy horn melody, clarinet, marimba 16ths, timpani boom, kick/snare/hats |
| `victory` | fanfare → gentle loop | C major, 4/4, 100 bpm | 3-bar fanfare intro, then 16 bars, 38.4 s | I → L L' | horn + glock fanfare with snare roll, then kalimba tune, harp arpeggios, soft accordion pad, tuba, brushes |

**Instruments.** Banjo and harp are Karplus-Strong strings, rendered in JS once per note into cached
`AudioBuffer`s. The engine pre-renders each track's notes, 3 per tick, starting with the requested track.
Tuba is saw + triangle through a lowpass whose envelope gives a brassy "blat", with a pitch scoop at the start.
Horn is two detuned saws through an opening lowpass. Marimba is a sine plus its tuned 4th partial, and
kalimba is a sine plus an inharmonic tine overtone. Glock uses bar-mode partials. Accordion is detuned saws
plus a sub-octave square; the part bus adds a reed peak and a wheeze + bellows tremolo (5.6 Hz + 0.27 Hz).
Clarinet is a square through a tracking lowpass, with delayed vibrato and a breathy onset. Drums: soft kick,
snare, brush, hat, shaker, two woodblocks, frog (chopped square through a throat formant), water drop,
tin pot and timpani boom.

**Scheduler.** A `setInterval` runs every 25 ms and schedules every step that starts within 0.12 s of
`AudioContext.currentTime`, with ±4 ms humanized timing and ±6 % velocity. If a tick finds the next
step already in the past (tab hidden, main thread stalled), it **jumps the position forward in one go**,
counted in `stats.music.skipped` / `catchUps`. It never stacks the missed notes. While the tab is hidden
the steps advance muted (`stats.music.muted`). `music(x)` crossfades over 1.5 s with linear ramps. A track
that is still fading out is revived rather than restarted, and a fully faded player is disposed (buses
disconnected, LFOs stopped).

**Notation** (to add or edit tracks; see the header of `tracks.js`). Track-level `bpm beats sub swing
verb gain`, per-part `inst gain send gate vel tight`. One chord symbol per bar
(`'Gm7'`, `'F/C'`, `'A7,D7'` splits the bar). Melodies are `'A4:3 Bb4:1 | C5:4 -:2'`, where the duration
is in steps and `|` bar lines are **checked**. Bass/chord/arp parts are patterns over the chords
(`'R-..5-A-'`, `'..x.x.'`, `'15853585'`), drums are lanes (`{ k: 'x...x...', b: '..x...x.' }`), and
sections can inherit (`from`). `compileTrack()` returns `warnings` for bad tokens or wrong bar lengths.
All six tracks compile with none.

## Mixing

```
track parts -> track gain -> hidden-mute -> duck -> lowpass -> music vol (×0.56 trim) -\
music reverb (2.4 s procedural IR) ---------^                                            +-> master -> compressor -> ×0.5 -> soft clip -> out
voices -> [stereo pan] -> sfx in -> sfx vol --------------------------------------------/
voices -> reverb send -> sfx reverb (1.5 s IR) -> sfx vol;   loops -> loop bus (muted unless playing) -> sfx in
```
* Volumes: slider `v` → gain `v^1.5`. Defaults (`ctx.settings`) master 0.8, music 0.6, sfx 0.9.
  `setVolumes` and direct edits of `ctx.settings.master|music|sfx` both apply. Edits are polled every 25 ms.
* Compressor (gentle): threshold −16 dB, knee 12, ratio 2.5, attack 8 ms, release 250 ms.
* The final soft clipper is linear below −3 dBFS and approaches 0.99 asymptotically. Output can never reach
  0 dBFS, even with every slider at 1 and a boss stomp over the boss music.

### Measured levels (`audio-levels.mjs`, offline renders through the real graph)
Whole loops rendered at 44.1 kHz. "Max volumes" means every slider at 1, measured before the soft clipper.
"Game" means the default settings (0.8 / 0.6 / 0.9), measured at the real output.

| Track | Max volumes: peak | Max volumes: RMS (active) | Game: peak | Game: RMS | Notes per loop |
|---|---|---|---|---|---|
| title | −1.78 dBFS | −16.73 dBFS | −12.75 | −26.04 | 537 |
| glade | −0.82 | −17.10 | −8.54 | −26.95 | 929 |
| bog | −1.95 | −16.35 | −11.24 | −25.69 | 757 |
| fort | −1.32 | −17.37 | −11.07 | −26.64 | 832 |
| boss | −1.92 | −16.47 | −9.17 | −26.32 | 1347 |
| victory | −1.87 | −17.99 | −9.62 | −26.22 | 486 |

* Nothing clips: every track and every sfx stays below 0 dBFS even before the soft clipper at max volumes.
  No NaNs, |DC| < 0.001.
* The tracks sit within 1.7 dB of each other (active RMS −16.4 … −18.0 dBFS at max volumes).
* At the default settings the music (RMS ≈ −26 dBFS) sits well under the action sounds: jump −11.2,
  throw −11.9, puff hit −9.1, enemy croak −14.7, boss stomp −6.9 dBFS peak.
* The sfx peak between −21 dBFS (sling whirr, the quietest by design) and about −2.5 dBFS (boss crash /
  club slam / defeat, armour break) at max volumes. Subtle ticks (`scoreTick`, `hint`, `menuMove`) are
  −16…−19 dBFS. Sounds with random parts (armour break pings, debris) vary about ±1 dB between renders.
* Part balance by perceived loudness (`audio-mix.mjs`, every part solo, K-weighted ≈ LUFS, max volumes):
  leads −17.5…−19, bass ≈ 2 LU under the lead (−19.4…−21.1), accompaniment (banjo, harp, kalimba plinks,
  accordion, stabs, arps) −23…−27, percussion −23…−27. The glade's marimba lead has the highest crest
  factor, so that track has its own output trim (`gain: 0.86`).

## Sandbox

`node tools/build.mjs --entry src/dev/audio.js --out dist/dev-audio --dev`, then open `dist/dev-audio/index.html`.
The test arena (play it normally: jumps, glides, throws at the dummies, the bog pool) plus a panel with
**every sfx** (variants for land/throw/tonic/horn/steps, the glowcap chain, the boss defeat sequence, a
left→right pan sweep and a 5→40 m distance test), **every track** + stop, volume sliders, an **Events**
group that emits real game events (zones, boss start/hurt/defeat, game states, tonics, a glowcap chain),
a live output meter and scheduler stats. Click any button to start audio. `` ` `` toggles the panel,
1/2/3 drink a tonic. Panel buttons never take keyboard focus, so Space/WASD keep driving Morel.

## How to test
```
node tools/build.mjs --entry src/dev/audio.js   --out dist/dev-audio     --dev
node tools/build.mjs --entry src/audio/lab.js   --out dist/dev-audio/lab --dev
node tools/smoke.mjs --html dist/dev-audio/index.html     --out dist/dev-audio/smoke.png     --w 960 --h 540
node tools/smoke.mjs --html dist/dev-audio/lab/index.html --out dist/dev-audio/lab/smoke.png --w 960 --h 540
node tools/scenario.mjs tools/scenarios/audio-wiring.mjs   --html dist/dev-audio/index.html     --shots dist/dev-audio/shots  # 34 checks, ~2 min
node tools/scenario.mjs tools/scenarios/audio-hidden.mjs   --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots  # 10 checks
node tools/scenario.mjs tools/scenarios/audio-fallback.mjs --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots  # 4 checks
node tools/scenario.mjs tools/scenarios/audio-levels.mjs   --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots  # 29 checks, ~6 min
node tools/scenario.mjs tools/scenarios/audio-mix.mjs      --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots  # per-part RMS (tuning)
node tools/scenario.mjs tools/scenarios/audio-spectro.mjs  --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots  # spectrogram PNGs
```
The offline scenarios use the lab page (the engine without the 3D scene). In the full sandbox, SwiftShader
rendering competes for CPU and they run several times slower. `audio-spectro` writes
`shots/spectro-music.png` (first 12 s of each track) and `shots/spectro-sfx-{1,2,3}.png`. It is the way to
*look* at pitch contours, envelopes and rhythm in a headless environment.

## Contract deviations / additions (precise)
1. `ctx.audio` has the four contract methods plus `duck, stopAll, state, track, players, names, aliases, tracks,
   trackInfo, stats, renderOffline, context, core, hidden, isStub:false` and a private `_internal` (tests).
   `play()` returns a handle `{ name, end, stop(fade) }` or `null`. `unlock(force)` accepts `true` to skip the
   user-activation check (tests only).
2. `play()` options carry recipe parameters besides `volume / pitch / position` (`kind`, `charge`, `impact`,
   `surface`, `step`, `remaining`, `zone`, `multiplier`).
3. `setVolumes()` writes the values back into `ctx.settings`. The engine also picks up direct `ctx.settings` edits.
4. Extra events consumed (all optional): `player:step`, `pickup:tonic`, `tonic:respawn`, `cage:hit`, `gate:open/close`,
   `arena:lock/clear`, `level:bounce`, `ui:message`, `combo`-related `score:award {chain, multiplier, reason}`.
5. Extra exports: `createAudio(ctx?)` (`audio.js`); `AudioCore`, `compiled`, `volumeGain`, `MUSIC_TRIM` (`core.js`);
   `SFX`, `SFX_NAMES`, `ALIASES`, `glowcapMidi` (`sfx.js`); `TRACKS`, `TRACK_NAMES` (`tracks.js`);
   `compileTrack`, `TrackPlayer`, `parseChord`, `notesUsed` (`sequencer.js`); `renderOffline`, `analyze` (`offline.js`).

## Integration notes
* **main.js**: put `installAudio` in `install` (any position; first is fine). Nothing else to wire. Core
  already calls `ctx.audio.unlock()` on the first pointer/key/touch.
* **UI**: play `menuMove` / `menuConfirm` / `menuBack` from the menus. Volume sliders can call
  `ctx.audio.setVolumes({ master|music|sfx })` or just write `ctx.settings.*`; both work. The title and results
  music follow `game:state`, so the UI does not need to call `music()` (it may, e.g. `music(null)` for a silent
  screen; that holds until the next state/zone event). There is no mute setting in the contract: use `master: 0`.
* **Enemies**: every name they call directly exists (verified against `docs/enemies.md`). Duplicates between their
  direct calls and the contract events (`bossRoar`/`boss:start`, `bossHurt`/`boss:hurt`, `bossDefeated`) are
  dropped by the per-sound gap.
* **Pickups / score**: nothing to do. The glowcap pitch reads the chain from `score:award`; install order does not matter.
* **Level**: zone ids `glade | bog | fort | pit` drive the music. Entering the pit fades the music out until
  `boss:start`. A pit checkpoint respawn during the fight resets to silence until the boss resumes (`boss:start` again).
* **Verified with the real areas**: a temporary build with the real level, enemies, pickups, score and mechanisms
  (since deleted, so nothing extra ships) went checkpoint by checkpoint: glade → bog → fort crossfades, the pit
  went silent, then the boss woke and the boss track started. There were no unknown sound names and no audio errors.

* **Integration change:** `run:reset {}` (emitted by the game flow on Play again / Quit to title) clears the boss,
  post-boss and zone music state, so a new run starts with the glade track instead of the last run's victory loop.

## Known issues
* Subjective quality was judged from spectrograms and level measurements only; no human has listened to it in
  this environment. All levels, tempos and timbres are constants in `tracks.js` / `sfx.js` /
  `instruments.js` and easy to tune by ear in the sandbox.
* With `__game.step(n)` (manual stepping), every event in one synchronous batch lands on the same audio-clock
  instant, so per-sound gaps drop repeats (e.g. only one footstep or one tonic warning tick per batch). Real-time
  play spaces them normally.
* Continuous loops (glide wind, charge hum) are driven from render frames. If frames stall (headless shader
  compilation), they start late. The loop bus is muted while not `playing`, so they never leak into menus.
* Chrome does not update `AudioParam.value` on idle nodes. Read `audio._internal.mix` for the current mix targets.
* The offline level scenario takes ~6 min in headless Chromium (≈ 6× faster than real time, ~360 s of music twice + 74 sfx twice).
