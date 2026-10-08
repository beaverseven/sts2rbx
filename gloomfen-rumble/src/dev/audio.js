// Audio sandbox: the core test arena + installAudio + an audition panel (sandbox only).
//   node tools/build.mjs --entry src/dev/audio.js --out dist/dev-audio --dev
// Every sfx and track has a button; the "Events" group emits real game events so the wiring
// (music per zone/state, boss flow) can be heard. Play the arena normally to hear the
// event-driven sounds (jump, glide, throw at the dummies, fall in the pool...).
// ` (backquote) toggles the panel; 1/2/3 drink a tonic.
import { boot } from '../core/boot.js';
import { installAudio, createAudio } from '../audio/audio.js';

const ctx = boot({ startState: 'playing', install: [installAudio] });
const audio = ctx.audio;
window.__audioLib = { createAudio, installAudio }; // for scenarios (fallback / no-AudioContext checks)

// ---------------------------------------------------------------------------
// panel
const css = document.createElement('style');
css.textContent = `
#ap{position:fixed;right:8px;top:8px;bottom:8px;width:318px;overflow:auto;z-index:10;pointer-events:auto;
  background:rgba(26,21,48,.86);border:1px solid rgba(255,195,90,.25);border-radius:10px;padding:8px 10px 12px;
  color:#f3e6c8;font:12px/1.35 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);scrollbar-width:thin}
#ap.ap-hide{display:none}
#ap h1{font:600 15px Georgia,serif;margin:2px 0 6px;color:#ffc35a;letter-spacing:.03em}
#ap h2{font:600 11px system-ui;margin:10px 0 4px;color:#5ef2e0;text-transform:uppercase;letter-spacing:.08em}
#ap .ap-row{display:flex;flex-wrap:wrap;gap:3px}
#ap button{all:unset;cursor:pointer;padding:3px 7px;border-radius:6px;background:rgba(127,174,78,.18);
  border:1px solid rgba(127,174,78,.35);color:#f3e6c8;font-size:11.5px;white-space:nowrap}
#ap button:hover{background:rgba(127,174,78,.38)}
#ap button.ap-trk{background:rgba(255,95,178,.16);border-color:rgba(255,95,178,.4)}
#ap button.ap-trk.ap-on{background:rgba(255,95,178,.55);color:#fff}
#ap button.ap-ev{background:rgba(94,242,224,.12);border-color:rgba(94,242,224,.35)}
#ap label{display:flex;align-items:center;gap:6px;margin:2px 0}
#ap label span{width:44px}
#ap input[type=range]{flex:1;accent-color:#ffc35a}
#ap .ap-stat{font:11px/1.4 ui-monospace,monospace;color:#d8cba8;white-space:pre;margin-top:4px;opacity:1}
#ap .ap-meter{height:7px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin:4px 0 2px}
#ap .ap-meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7fae4e,#ffc35a 75%,#ff5f5f)}
#aphint{position:fixed;left:12px;bottom:10px;padding:6px 10px;border-radius:8px;background:rgba(26,21,48,.55);
  color:#f3e6c8;font:12px/1.5 system-ui,sans-serif;pointer-events:none;white-space:nowrap}
`;
document.head.appendChild(css);
const panel = document.createElement('div');
panel.id = 'ap';
document.body.appendChild(panel);
const hint = document.createElement('div');
hint.id = 'aphint';
hint.textContent = 'Click a button to start audio · WASD/Space/J/K play the arena · ` panel · 1/2/3 tonics';
document.body.appendChild(hint);

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const section = (title) => { panel.appendChild(el('h2', null, title)); const r = el('div', 'ap-row'); panel.appendChild(r); return r; };
function button(row, label, fn, cls) {
  const b = el('button', cls, label);
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault()); // never take keyboard focus from the game
  b.addEventListener('click', () => { audio.unlock(); fn(b); });
  row.appendChild(b);
  return b;
}

panel.appendChild(el('h1', null, 'Gloomfen audio sandbox'));
const meter = el('div', 'ap-meter'); meter.appendChild(el('i'));
panel.appendChild(meter);
const stat = el('div', 'ap-stat', 'audio: waiting for a click…');
panel.appendChild(stat);

// volumes
panel.appendChild(el('h2', null, 'Volume'));
for (const k of ['master', 'music', 'sfx']) {
  const lab = el('label'); lab.appendChild(el('span', null, k));
  const r = document.createElement('input');
  r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.01; r.value = ctx.settings[k]; r.tabIndex = -1;
  r.addEventListener('input', () => { audio.unlock(); audio.setVolumes({ [k]: Number(r.value) }); });
  lab.appendChild(r);
  panel.appendChild(lab);
}

// music
const trackRow = section('Music');
const trackButtons = {};
for (const name of audio.tracks) trackButtons[name] = button(trackRow, name, () => audio.music(name), 'ap-trk');
button(trackRow, '■ stop', () => audio.music(null), 'ap-trk');

// sfx
const P = (name, opts) => () => audio.play(name, opts);
const seq = (list, gap) => () => list.forEach((f, i) => setTimeout(f, i * gap * 1000));
const groups = {
  Morel: [
    ['jump', P('jump')], ['land soft', P('land', { impact: 4, volume: 0.6 })], ['land hard', P('land', { impact: 28 })],
    ['glide open', P('glideOpen')], ['glide close', P('glideClose')],
    ['throw', P('throw', { kind: 'puff', charge: 0 })], ['throw charged', P('throw', { kind: 'puff', charge: 1 })],
    ['throw iron', P('throw', { kind: 'iron', charge: 0 })], ['throw seeker', P('throw', { kind: 'seeker', charge: 0 })],
    ['charge full', P('chargeFull')], ['hurt', P('hurt')], ['died', P('died')], ['respawn', P('respawn')], ['splash', P('splash')],
    ['steps', seq(['moss', 'mud', 'wood', 'stone', 'iron'].flatMap((s) => [P('step', { surface: s }), P('step', { surface: s })]), 0.28)],
  ],
  Loops: [
    ['glide wind 2 s', () => { const c = audio.core; if (!c) return; const l = c.startLoop('glide'); l.set(7, false); setTimeout(() => c.stopLoop('glide'), 2000); }],
    ['updraft jet 2 s', () => { const c = audio.core; if (!c) return; const l = c.startLoop('glide'); l.set(0, true); setTimeout(() => c.stopLoop('glide'), 2000); }],
    ['charge hum', () => {
      const c = audio.core; if (!c) return; const l = c.startLoop('charge'); let k = 0;
      const id = setInterval(() => { k = Math.min(1, k + 0.05); l.set(k); if (k >= 1) { clearInterval(id); audio.play('chargeFull'); setTimeout(() => { c.stopLoop('charge'); audio.play('throw', { kind: 'puff', charge: 1 }); }, 500); } }, 40);
    }],
  ],
  Hits: [
    ['puff hit', P('puffHit')], ['puff poof', P('puffPoof')], ['iron hit', P('ironHit')], ['deflect', P('deflect')],
    ['clang', P('clang')], ['mud splat', P('mudSplat')], ['plop', P('plop')],
  ],
  Bandits: [
    ['alert “huh?”', P('alert')], ['hurt croak', P('enemyHurt')], ['killed', P('enemyKilled')], ['dummy thwack', P('thwack')],
    ['armour break', P('armorBreak')], ['cauldron clang', P('cauldronClang')], ['pot clatter', P('potClatter')], ['clatter', P('clatter')],
    ['club windup', P('clubWindup')], ['club slam', P('clubSlam')], ['sling spin', P('slingSpin')], ['sling throw', P('slingThrow')],
    ['ironbelly grunt', P('ironbellyGrunt')], ['belly flop', P('bellyFlop')], ['belly slap', P('bellySlap')], ['yawn', P('yawn')],
  ],
  'Chief Gnarlbelly': [
    ['snore', P('bossSnore')], ['roar', P('bossRoar')], ['stomp', P('bossStomp')], ['shockwave', P('shockwave')],
    ['club slam', P('bossClubSlam')], ['inhale', P('bossInhale')], ['spit', P('bossSpit')], ['summon', P('bossSummon')],
    ['charge', P('bossCharge')], ['slide', P('bossSlide')], ['crash', P('bossCrash')], ['dizzy', P('bossDizzy')],
    ['hurt', P('bossHurt')], ['boing', P('bossBoing')], ['deflate', P('bossDeflate')], ['plop', P('bossPlop')], ['defeated', P('bossDefeated')],
    ['defeat sequence', seq([P('bossDefeated'), () => {}, P('bossDeflate'), () => {}, () => {}, () => {}, () => {}, P('bossPlop')], 0.45)],
  ],
  Pickups: [
    ['glowcap chain ×12', seq(Array.from({ length: 12 }, (_, i) => P('glowcap', { step: i })), 0.16)],
    ['berry', P('berry')], ['tonic anvil', P('tonicStart', { kind: 'anvil' })], ['tonic updraft', P('tonicStart', { kind: 'updraft' })],
    ['tonic seeker', P('tonicStart', { kind: 'seeker' })], ['tonic warning', seq([3, 2, 1].map((r) => P('tonicWarn', { remaining: r })), 1)],
    ['tonic drink', P('tonicDrink')], ['tonic end', P('tonicEnd')], ['jar respawn', P('tonicRespawn')],
    ['cage hit', P('cageHit')], ['cage freed', P('cageFreed')], ['checkpoint', P('checkpoint')],
    ['score ticks', seq([3, 3, 4, 5, 6].map((m) => P('scoreTick', { multiplier: m })), 0.15)], ['level complete', P('levelComplete')],
  ],
  World: [
    ['horn glade', P('zoneEnter', { zone: 'glade' })], ['horn bog', P('zoneEnter', { zone: 'bog' })], ['horn fort', P('zoneEnter', { zone: 'fort' })],
    ['horn pit', P('zoneEnter', { zone: 'pit' })], ['bounce shroom', P('bounce')], ['gate open', P('gateOpen')], ['gate close', P('gateClose')],
    ['arena lock', P('arenaLock')], ['arena clear', P('arenaClear')], ['lantern gate', P('lanternRise')], ['hint', P('hint')],
    ['pan left→right', () => {
      const cam = ctx.camera, e = cam.matrixWorld.elements, p = ctx.player.position;
      [-1, -0.5, 0, 0.5, 1].forEach((k, i) => setTimeout(() => audio.play('alert', { position: [p.x + e[0] * k * 9, p.y + 1, p.z + e[2] * k * 9] }), i * 450));
    }],
    ['distance 5→40 m', () => {
      const cam = ctx.camera, e = cam.matrixWorld.elements, p = ctx.player.position;
      [5, 12, 22, 40].forEach((dd, i) => setTimeout(() => audio.play('clang', { position: [p.x - e[8] * dd, p.y + 1, p.z - e[10] * dd] }), i * 600));
    }],
  ],
  Menu: [['move', P('menuMove')], ['confirm', P('menuConfirm')], ['back', P('menuBack')]],
};
for (const g of Object.keys(groups)) { const row = section(g); for (const [label, fn] of groups[g]) button(row, label, fn); }

// events (exercise the real wiring)
const E = (name, payload) => () => ctx.events.emit(name, payload);
const evRow = section('Events (wiring)');
const events = [
  ['zone glade', E('zone:enter', { id: 'glade', name: 'Mossy Glade' })], ['zone bog', E('zone:enter', { id: 'bog', name: 'Sunken Bog' })],
  ['zone fort', E('zone:enter', { id: 'fort', name: 'Bandit Fort' })], ['zone pit', E('zone:enter', { id: 'pit', name: "Gnarlbelly's Pit" })],
  ['boss:start', E('boss:start', { maxHp: 24, hp: 24, phase: 1 })], ['boss:hurt', E('boss:hurt', { hp: 20, maxHp: 24 })],
  ['boss:defeated', () => ctx.events.emit('boss:defeated', { position: ctx.player.position.clone() })],
  ['level:complete', E('level:complete', { stats: {} })],
  ['state title', () => ctx.setState('title')], ['state playing', () => ctx.setState('playing')],
  ['state paused', () => ctx.setState('paused')], ['state results', () => ctx.setState('results')],
  ['drink anvil', () => ctx.player.setTonic('anvil')], ['drink updraft', () => ctx.player.setTonic('updraft')], ['drink seeker', () => ctx.player.setTonic('seeker')],
  ['glowcaps ×6', seq(Array.from({ length: 6 }, () => E('pickup:glowcap', { position: ctx.player.position.clone(), points: 50 })), 0.2)],
];
for (const [label, fn] of events) button(evRow, label, fn, 'ap-ev');

// keys
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') panel.classList.toggle('ap-hide');
  const kind = { Digit1: 'anvil', Digit2: 'updraft', Digit3: 'seeker' }[e.code];
  if (kind) ctx.player.setTonic(kind);
});

// live status + output meter (sandbox only: an analyser tapped after the master chain)
let analyser = null, buf = null, statT = 0;
ctx.addSystem({
  frame(dt) {
    const core = audio.core;
    if (core && !analyser) {
      analyser = core.ac.createAnalyser();
      analyser.fftSize = 1024;
      (core.clip || core.comp).connect(analyser);
      buf = new Float32Array(analyser.fftSize);
    }
    if (analyser) {
      analyser.getFloatTimeDomainData(buf);
      let pk = 0;
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; }
      meter.firstChild.style.width = `${Math.min(100, pk * 100).toFixed(0)}%`;
    }
    for (const n of Object.keys(trackButtons)) trackButtons[n].classList.toggle('ap-on', audio.track === n);
    if ((statT -= dt) > 0) return;
    statT = 0.25;
    const s = audio.stats;
    const pl = audio.players.map((p) => `${p.name}${p.fading ? '↓' : ''} ${(p.gain * 100).toFixed(0)}%`).join(', ') || '—';
    stat.textContent =
      `ctx ${audio.state} · game ${ctx.state} · zone ${ctx.level.zone ?? '—'}\n` +
      `track ${audio.track ?? '—'} · players ${pl}\n` +
      `voices ${core ? core.liveVoices(core.ac.currentTime) : 0} · notes ${s.notes} · max/tick ${s.maxNotesPerTick}\n` +
      `skipped ${s.music.skipped} · muted ${s.music.muted} · dropped ${s.dropped} · errors ${s.errors}`;
  },
});
