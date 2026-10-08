// Music sequencer: compiles track definitions (see tracks.js for the notation) into a flat
// step table, and plays it with a lookahead scheduler on the AudioContext clock.
//
//   const c = compileTrack(def)            // { steps:[[ev...]|null], total, loopStart, stepDur, ... }
//   const p = new TrackPlayer(core, c)     // owns a gain + per-part buses into core.musicIn
//   p.start(t, fadeSec); p.schedule(now, horizon) -> notes scheduled; p.fadeOut(t, sec); p.dispose()
//
// The player never schedules a step whose time has already passed: after a stall (hidden tab,
// blocked main thread) it jumps its position forward in one go, so no burst of stacked notes.
import { INSTRUMENTS, KIT, PART_FX } from './instruments.js';
import { noteToMidi, rng } from './synth.js';

// ---------------------------------------------------------------------------
// Chords
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m6: [0, 3, 7, 9],
  '6': [0, 4, 7, 9], dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8],
  sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], '9': [0, 4, 7, 10, 14], '7b9': [0, 4, 7, 10, 13],
};
const pcOf = (s) => (PC[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12;
const chordCache = new Map();
export function parseChord(sym) {
  let c = chordCache.get(sym);
  if (c) return c;
  const m = /^([A-G][#b]?)([a-z0-9]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m || !(m[2] in QUALITY)) throw new Error(`bad chord '${sym}'`);
  const root = pcOf(m[1]);
  c = { sym, root, tones: QUALITY[m[2]], bass: m[3] ? pcOf(m[3]) : root };
  chordCache.set(sym, c);
  return c;
}
const inRange = (pc, lo) => lo + ((pc - lo) % 12 + 12) % 12; // lowest midi >= lo with pitch class pc

// ---------------------------------------------------------------------------
// Compile
const clean = (s) => s.replace(/[\s|]/g, '');

function parseNotes(str, spb, bars, warn, tr = 0) {
  const out = [];
  let step = 0, dur = 1;
  const barStrs = str.split('|');
  barStrs.forEach((bs, bi) => {
    const start = step;
    for (const tk of bs.trim().split(/\s+/).filter(Boolean)) {
      const m = /^([A-G][#b]?\d|-)(?::(\d+))?([!?]?)$/.exec(tk);
      if (!m) { warn(`bad token '${tk}'`); continue; }
      if (m[2]) dur = +m[2];
      if (m[1] !== '-') out.push({ step, midi: noteToMidi(m[1]) + tr, dur, vel: m[3] === '!' ? 1 : m[3] === '?' ? 0.55 : 0.8 });
      step += dur;
    }
    if (barStrs.length > 1 && step - start !== spb) warn(`bar ${bi + 1} has ${step - start} steps, expected ${spb}`);
  });
  if (step !== spb * bars) warn(`notes cover ${step} steps, section has ${spb * bars}`);
  return out;
}

function bassNote(ch, tok, lo, next) {
  const root = inRange(ch.root, lo);
  const t = ch.tones;
  switch (tok) {
    case 'R': return inRange(ch.bass, lo);
    case '3': return root + t[1];
    case '5': return root + t[2];
    case '6': return root + 9;
    case '7': return root + (t[3] !== undefined && t[3] < 12 ? t[3] : 10);
    case 'O': return root + 12;
    case 'L': return root - 5;
    case 'b': return root + 1;
    case '4': return root + 5;
    case 'A': { const n = inRange(next.root, lo); return n - 1 >= lo ? n - 1 : n + 1; }
    default: return null;
  }
}
function arpNote(ch, tok, lo) {
  const root = inRange(ch.root, lo), t = ch.tones;
  switch (tok) {
    case '1': return root;
    case '3': return root + t[1];
    case '5': return root + t[2];
    case '7': return root + (t[3] !== undefined ? t[3] : 12);
    case '8': return root + 12;
    case '9': return root + 12 + t[1];
    case '0': return root + 12 + t[2];
    default: return null;
  }
}
function voicing(ch, center) {
  const lo = center - 6;
  const out = [];
  for (const iv of ch.tones) out.push(inRange((ch.root + iv) % 12, lo));
  return out.sort((a, b) => a - b);
}

/**
 * Compile a track definition into a step table.
 * Returns { name, bpm, sub, beats, spb, stepDur, swing, total, loopStart, steps, parts, seconds, loopSeconds, warnings }.
 */
export function compileTrack(def) {
  const warnings = [];
  const spb = def.beats * def.sub;
  const order = [...(def.intro || []), ...def.form];
  const resolved = {};
  const resolve = (name) => {
    if (resolved[name]) return resolved[name];
    const s = def.sections[name];
    if (!s) throw new Error(`${def.name}: unknown section ${name}`);
    let r = s;
    if (s.from) {
      const base = resolve(s.from);
      const play = { ...base.play };
      for (const k of Object.keys(s.play || {})) { if (s.play[k] === null) delete play[k]; else play[k] = s.play[k]; }
      r = { ...base, ...s, play };
    }
    resolved[name] = r;
    return r;
  };

  const steps = [];
  let offset = 0;
  order.forEach((secName, si) => {
    const sec = resolve(secName);
    const warn = (msg) => warnings.push(`${def.name}/${secName}: ${msg}`);
    const barChords = sec.chords.trim().split(/\s+/).map((b) => b.split(','));
    const bars = sec.bars || barChords.length;
    const n = bars * spb;
    // chord at every step of the section
    const chordAt = new Array(n);
    let prev = null;
    for (let b = 0; b < bars; b++) {
      const list = barChords[b % barChords.length];
      for (let k = 0; k < list.length; k++) {
        const sym = list[k] === '%' ? prev.sym : list[k];
        const ch = parseChord(sym);
        prev = ch;
        const from = b * spb + Math.round((k * spb) / list.length), to = b * spb + Math.round(((k + 1) * spb) / list.length);
        for (let s = from; s < to; s++) chordAt[s] = ch;
      }
    }
    // the chord right after this section (for approach notes)
    const nextSec = order[si + 1] !== undefined ? resolve(order[si + 1]) : resolve(order[(def.intro || []).length]);
    const nextFirst = parseChord(nextSec.chords.trim().split(/\s+/)[0].split(',')[0]);
    const nextChordAfterBar = (b) => (b + 1 < bars ? chordAt[(b + 1) * spb] : nextFirst);

    const push = (step, ev) => {
      const i = offset + step;
      (steps[i] || (steps[i] = [])).push(ev);
    };
    for (const partName of Object.keys(sec.play || {})) {
      const spec = sec.play[partName];
      if (!spec) continue;
      const part = def.parts[partName];
      if (!part) { warn(`no part '${partName}' in parts`); continue; }
      const inst = spec.inst || part.inst;
      const baseVel = spec.vel ?? part.vel ?? 0.8;
      const tr = spec.tr || 0;
      if (spec.notes) {
        for (const e of parseNotes(spec.notes, spb, bars, warn, tr)) push(e.step, { part: partName, inst, midi: e.midi, dur: e.dur, vel: e.vel * baseVel / 0.8 });
        continue;
      }
      if (partName === 'drums' || spec.lanes) {
        const lanes = spec.lanes || spec;
        for (const lane of Object.keys(lanes)) {
          if (lane === 'vel') continue;
          const instName = KIT[lane];
          if (!instName) { warn(`unknown drum lane '${lane}'`); continue; }
          const pat = clean(lanes[lane]);
          for (let s = 0; s < n; s++) {
            const c = pat[s % pat.length];
            const v = c === 'X' ? 1 : c === 'x' ? 0.78 : c === 'o' ? 0.48 : 0;
            if (v) push(s, { part: partName, inst: instName, midi: 0, dur: 1, vel: v * baseVel / 0.8 });
          }
        }
        continue;
      }
      const kind = spec.pat ? 'bass' : spec.chord ? 'chord' : spec.arp ? 'arp' : null;
      if (!kind) { warn(`part '${partName}' has nothing to play`); continue; }
      const pat = clean(spec.pat || spec.chord || spec.arp);
      let last = null;
      for (let s = 0; s < n; s++) {
        const c = pat[s % pat.length];
        if (c === '-') { if (last) for (const e of last) e.dur++; continue; }
        if (c === '.') { last = null; continue; }
        const ch = chordAt[s];
        if (kind === 'chord') {
          const v = (c === 'X' ? 1 : c === 'o' ? 0.6 : 0.8) * baseVel / 0.8;
          last = voicing(ch, spec.center || 60).map((m) => ({ part: partName, inst, midi: m + tr, dur: 1, vel: v }));
        } else {
          const midi = kind === 'bass' ? bassNote(ch, c, spec.lo || 36, nextChordAfterBar(Math.floor(s / spb))) : arpNote(ch, c, spec.lo || 55);
          if (midi === null) { warn(`bad ${kind} token '${c}'`); last = null; continue; }
          last = [{ part: partName, inst, midi: midi + tr, dur: 1, vel: baseVel }];
        }
        for (const e of last) push(s, e);
      }
    }
    offset += n;
  });
  for (let i = 0; i < offset; i++) if (!steps[i]) steps[i] = null;
  for (const pn of Object.keys(def.parts)) if (!INSTRUMENTS[def.parts[pn].inst] && pn !== 'drums') warnings.push(`${def.name}: part ${pn} has unknown instrument`);
  const stepDur = 60 / def.bpm / def.sub;
  const loopStart = (def.intro || []).reduce((a, s) => a + (resolve(s).bars || resolve(s).chords.trim().split(/\s+/).length) * spb, 0);
  return {
    name: def.name, bpm: def.bpm, sub: def.sub, beats: def.beats, spb, stepDur, swing: def.swing || 0,
    total: offset, loopStart, steps, parts: def.parts, verb: def.verb ?? 1, gain: def.gain ?? 1,
    seconds: offset * stepDur, loopSeconds: (offset - loopStart) * stepDur, warnings, def,
  };
}

/** Distinct (instrument, midi) pairs used by a compiled track — for pre-rendering plucked strings. */
export function notesUsed(compiled, instSet) {
  const seen = new Set(), out = [];
  for (const st of compiled.steps) {
    if (!st) continue;
    for (const e of st) {
      if (!instSet.has(e.inst)) continue;
      const k = e.inst + e.midi;
      if (!seen.has(k)) { seen.add(k); out.push([e.inst, e.midi]); }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player
let seedCounter = 1;
export class TrackPlayer {
  constructor(core, compiled, opts = {}) {
    const ac = core.ac;
    this.core = core;
    this.c = compiled;
    this.name = compiled.name;
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(opts.dest || core.musicIn);
    this.verb = ac.createGain();
    this.verb.gain.value = compiled.verb;
    this.verb.connect(opts.verbDest || core.musicVerb);
    this.buses = {};
    this.fx = [];
    this.solo = opts.solo || null;
    for (const name of Object.keys(compiled.parts)) {
      const p = compiled.parts[name];
      const bus = ac.createGain();
      bus.gain.value = this.solo && this.solo !== name ? 0 : (p.gain ?? 0.5);
      bus.connect(this.out);
      if (p.send) { const s = ac.createGain(); s.gain.value = p.send; bus.connect(s); s.connect(this.verb); this.fx.push({ nodes: [s], lfos: [] }); }
      let input = bus;
      const fxName = p.fx || p.inst;
      if (PART_FX[fxName]) { const fx = PART_FX[fxName](ac, bus); input = fx.input; this.fx.push(fx); for (const l of fx.lfos) l.start(); }
      this.buses[name] = { input, bus };
    }
    this.pos = 0;
    this.nextTime = 0;
    this.rand = rng(opts.seed ?? seedCounter++ * 977);
    this.stats = { notes: 0, skipped: 0, maxPerCall: 0 };
    this.stopAt = Infinity;
    this.disposed = false;
  }

  start(t, fade = 0) {
    this.nextTime = t;
    const g = this.out.gain, level = this.c.gain;
    g.cancelScheduledValues(t);
    if (fade > 0) { g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(level, t + fade); }
    else g.setValueAtTime(level, t);
  }

  /** Fade the whole track to `v` (0..1, relative to the track's own level) over `sec` starting at t. */
  fadeTo(v, t, sec) {
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v * this.c.gain, t + sec);
  }

  fadeOut(t, sec) { this.fadeTo(0, t, sec); this.stopAt = t + sec + 0.05; }
  revive(t, sec) { this.fadeTo(1, t, sec); this.stopAt = Infinity; }

  offsetFor(pos) {
    const c = this.c;
    if (!c.swing) return 0;
    const beat = c.stepDur * c.sub;
    if (c.sub === 2) return pos % 2 === 1 ? c.swing * beat / 6 : 0;
    if (c.sub === 4) { const k = pos % 4; return k === 2 ? c.swing * beat / 6 : k === 0 ? 0 : c.swing * beat / 12; }
    return 0;
  }

  advance(n) {
    const c = this.c;
    let p = this.pos + n;
    if (p >= c.total) { const len = c.total - c.loopStart; p = c.loopStart + ((p - c.loopStart) % len); }
    this.pos = p;
  }

  /**
   * Schedule every step that starts before `horizon`. Steps already in the past (relative to
   * `now`) are skipped in one jump. `mute` advances without scheduling (hidden tab).
   * Returns the number of notes scheduled.
   */
  schedule(now, horizon, mute = false, maxSteps = 64) {
    if (this.disposed) return 0;
    const c = this.c, dur = c.stepDur;
    if (this.nextTime < now - 0.02) {
      const missed = Math.ceil((now - this.nextTime) / dur);
      this.advance(missed);
      this.nextTime += missed * dur;
      this.stats.skipped += missed;
      const S = this.core.musicStats;
      if (S) { S.skipped += missed; S.catchUps++; if (missed > S.maxSkip) S.maxSkip = missed; }
    }
    let notes = 0, k = 0;
    const end = Math.min(horizon, this.stopAt);
    while (this.nextTime < end && k < maxSteps) {
      if (!mute) notes += this.playStep(this.pos, this.nextTime + this.offsetFor(this.pos), now);
      else { this.stats.skipped++; if (this.core.musicStats) this.core.musicStats.muted++; }
      this.advance(1);
      this.nextTime += dur;
      k++;
    }
    this.stats.notes += notes;
    if (notes > this.stats.maxPerCall) this.stats.maxPerCall = notes;
    return notes;
  }

  playStep(pos, t, now) {
    const evs = this.c.steps[pos];
    if (!evs) return 0;
    const dur = this.c.stepDur;
    let n = 0;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      const bus = this.buses[e.part];
      if (!bus) continue;
      if (this.solo && this.solo !== e.part) continue;
      const p = this.c.parts[e.part];
      const fn = INSTRUMENTS[e.inst];
      if (!fn) continue;
      const jitter = p.tight ? 0 : (this.rand() - 0.5) * 0.008;
      const at = Math.max(now + 0.002, t + jitter);
      const vel = e.vel * (0.94 + this.rand() * 0.12);
      fn(this.core, bus.input, at, e.midi, e.dur * dur * (p.gate ?? 0.92), vel);
      n++;
    }
    return n;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const fx of this.fx) {
      for (const l of fx.lfos) { try { l.stop(); } catch { /* not started */ } l.disconnect(); }
      for (const nd of fx.nodes) nd.disconnect();
    }
    for (const k of Object.keys(this.buses)) this.buses[k].bus.disconnect();
    this.out.disconnect();
    this.verb.disconnect();
  }
}
