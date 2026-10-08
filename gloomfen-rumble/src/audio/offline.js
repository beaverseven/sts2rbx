// Offline rendering + level analysis (tests, tuning). Uses the same AudioCore graph as the game.
//
//   await audio.renderOffline({ track: 'glade' })                 // whole loop (+ tail)
//   await audio.renderOffline({ track: 'boss', seconds: 20, solo: 'bass' })
//   await audio.renderOffline({ sfx: 'jump', params: { ... } })
//   await audio.renderOffline({ sfx: ['jump', 'land'], spacing: 1 })  // several, one after another
// Options: startBar (begin the track at this bar), volumes {master, music, sfx} (default all 1 = loudest case), clip (default true; false
// measures the signal before the final soft clipper), kWeight (K-weighting filter before the analysis: loudness),
// sampleRate (44100), keepBuffer (return the AudioBuffer).
// Resolves to { peak, peakDb, rms, rmsDb, activeRmsDb, maxWindowRmsDb, clipped, nan, dc, seconds, notes, buffer? }.
import { AudioCore, compiled } from './core.js';
import { TrackPlayer } from './sequencer.js';

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);

export function analyze(buf) {
  const sr = buf.sampleRate, len = buf.length;
  const chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  let peak = 0, sum = 0, nan = 0, clipped = 0, dcSum = 0;
  const win = Math.max(1, Math.floor(sr * 0.05));
  let activeSum = 0, activeN = 0, maxWin = 0;
  for (let w = 0; w < len; w += win) {
    const end = Math.min(len, w + win);
    let ws = 0;
    for (const d of chs) {
      for (let i = w; i < end; i++) {
        const x = d[i];
        if (x !== x) { nan++; continue; }
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
        if (a >= 0.999) clipped++;
        ws += x * x;
        dcSum += x;
      }
    }
    sum += ws;
    const n = (end - w) * chs.length;
    const wr = Math.sqrt(ws / n);
    if (wr > maxWin) maxWin = wr;
    if (wr > 0.001) { activeSum += ws; activeN += n; } // windows above -60 dBFS
  }
  const total = len * chs.length;
  const rms = Math.sqrt(sum / total);
  return {
    peak: r2(peak * 1000) / 1000, peakDb: r2(db(peak)), rms: Math.round(rms * 1e5) / 1e5, rmsDb: r2(db(rms)),
    activeRmsDb: r2(db(Math.sqrt(activeSum / Math.max(1, activeN)))), activeSec: r2(activeN / chs.length / sr),
    maxWindowRmsDb: r2(db(maxWin)), clipped, nan, dc: Math.round((dcSum / total) * 1e5) / 1e5, seconds: r2(len / sr),
  };
}

export async function renderOffline(opts = {}) {
  const OAC = typeof window !== 'undefined' ? window.OfflineAudioContext || window.webkitOfflineAudioContext : null;
  if (!OAC) throw new Error('OfflineAudioContext unavailable');
  const sr = opts.sampleRate || 44100;
  const volumes = { master: 1, music: 1, sfx: 1, ...(opts.volumes || {}) };
  let seconds = opts.seconds;
  let c = null;
  const sfxList = opts.sfx ? [].concat(opts.sfx) : [];
  const spacing = opts.spacing ?? 2.5;
  if (opts.track) {
    c = compiled(opts.track);
    if (!c) throw new Error('unknown track ' + opts.track);
    if (!seconds) seconds = c.seconds + 2.5;
  }
  if (!seconds) seconds = sfxList.length ? 0.1 + (sfxList.length - 1) * spacing + 4.5 : 1;
  const oac = new OAC(2, Math.ceil(seconds * sr), sr);
  let dest = oac.destination;
  if (opts.kWeight) {
    // approximate ITU-R BS.1770 K-weighting (head shelf + RLB highpass): activeRmsDb then reads ~LUFS
    const shelf = oac.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
    const hp = oac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    shelf.connect(hp); hp.connect(oac.destination);
    dest = shelf;
  }
  const core = new AudioCore(oac, { volumes, clip: opts.clip !== false, dest });
  let notes = 0;
  if (c) {
    const p = new TrackPlayer(core, c, { solo: opts.solo || null, seed: opts.seed ?? 1 });
    if (opts.startBar) p.pos = Math.min(c.total - 1, Math.max(0, Math.round(opts.startBar * c.spb)));
    p.start(0.05, 0);
    const until = opts.musicSeconds ?? Math.min(seconds, c.seconds + 0.05);
    notes = p.schedule(0, until, false, 1e9);
  }
  sfxList.forEach((name, i) => {
    const key = AudioCore.resolve(name);
    if (!key) throw new Error('unknown sfx ' + name);
    core.playSfx(key, 0.1 + i * spacing, { volume: opts.volume ?? 1, pitch: opts.pitch ?? 1, pan: opts.pan || 0, params: opts.params || {} });
  });
  const buf = await oac.startRendering();
  const res = analyze(buf);
  res.notes = notes;
  if (opts.keepBuffer) res.buffer = buf;
  return res;
}
