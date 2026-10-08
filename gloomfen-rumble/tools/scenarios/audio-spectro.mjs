// Spectrograms of the music and the sfx (renders offline, draws STFTs on canvases, screenshots).
// A way to *look* at the synthesis: pitch contours, envelopes, rhythm, frequency balance.
//   node tools/scenario.mjs tools/scenarios/audio-spectro.mjs --html dist/dev-audio/lab/index.html --shots dist/dev-audio/shots
// Writes shots/spectro-music.png (first 12 s of each track) and shots/spectro-sfx-*.png.
import { resolve } from 'node:path';

const DRAW = `
window.__spec = function (buf, w, h, label, opts = {}) {
  const N = 2048, hop = opts.hop || 512, sr = buf.sampleRate;
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  const len = buf.length, frames = Math.max(1, Math.floor((len - N) / hop));
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  const bits = Math.log2(N), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let k = 0; k < bits; k++) r |= ((i >> k) & 1) << (bits - 1 - k); rev[i] = r; }
  const fmin = opts.fmin || 40, fmax = opts.fmax || 12000;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h + 16;
  const g = cv.getContext('2d'); const img = g.createImageData(w, h);
  const col = (v) => { // v 0..1: indigo -> teal -> amber -> white
    const s = [[13,15,34],[27,31,74],[44,109,116],[127,174,78],[242,166,90],[255,240,210]];
    const x = Math.max(0, Math.min(0.9999, v)) * (s.length - 1), i = Math.floor(x), f = x - i;
    return s[i].map((c, k) => c + (s[i + 1][k] - c) * f);
  };
  const colMax = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    const fr = Math.floor(x / w * frames), off = fr * hop;
    for (let i = 0; i < N; i++) { const j = rev[i]; const s = off + i < len ? (a[off + i] + b[off + i]) * 0.5 * win[i] : 0; re[j] = s; im[j] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = -2 * Math.PI / size;
      for (let st = 0; st < N; st += size) for (let k = 0; k < half; k++) {
        const c = Math.cos(step * k), s = Math.sin(step * k), i1 = st + k, i2 = i1 + half;
        const tr = re[i2] * c - im[i2] * s, ti = re[i2] * s + im[i2] * c;
        re[i2] = re[i1] - tr; im[i2] = im[i1] - ti; re[i1] += tr; im[i1] += ti;
      }
    }
    for (let y = 0; y < h; y++) {
      const f = fmin * Math.pow(fmax / fmin, 1 - y / (h - 1));
      const bin = Math.min(N / 2 - 1, Math.max(1, Math.round(f / sr * N)));
      const mag = Math.hypot(re[bin], im[bin]) / (N / 4);
      const db = 20 * Math.log10(mag + 1e-9);
      const v = (db + 95) / 85;
      const [r, gg, bb] = col(v);
      const p = (y * w + x) * 4; img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = bb; img.data[p + 3] = 255;
    }
  }
  g.fillStyle = '#0d0f22'; g.fillRect(0, 0, w, h + 16);
  g.putImageData(img, 0, 16);
  g.fillStyle = '#f3e6c8'; g.font = '11px monospace'; g.fillText(label, 4, 12);
  g.fillStyle = 'rgba(243,230,200,.5)';
  for (const f of [100, 1000, 10000]) { const y = 16 + (1 - Math.log(f / fmin) / Math.log(fmax / fmin)) * (h - 1); g.fillRect(0, y, 6, 1); g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), 8, y + 4); }
  // envelope (peak per column) on top as a thin amber line
  g.strokeStyle = 'rgba(255,195,90,.9)'; g.beginPath();
  for (let x = 0; x < w; x++) {
    const s0 = Math.floor(x / w * len), s1 = Math.floor((x + 1) / w * len); let pk = 0;
    for (let i = s0; i < s1; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; }
    const y = 16 + h - pk * h; x ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  return cv;
};`;

export default async function (page, h) {
  await page.waitForFunction(() => window.__audio || (window.__game && window.__game.ctx.audio));
  page.setDefaultTimeout(600000);
  await page.addScriptTag({ content: DRAW });
  await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.cssText = 'margin:0;background:#0d0f22;overflow:visible;height:auto'; document.documentElement.style.cssText = 'height:auto;overflow:visible'; });
  const tracks = await page.evaluate(async () => {
    const a = window.__audio || window.__game.ctx.audio;
    const out = [];
    const box = document.createElement('div'); box.id = 'music'; box.style.cssText = 'width:960px;display:flex;flex-direction:column;gap:4px;padding:4px';
    document.body.appendChild(box);
    for (const t of a.tracks) {
      const r = await a.renderOffline({ track: t, clip: false, seconds: 12, keepBuffer: true });
      box.appendChild(window.__spec(r.buffer, 952, 200, `${t}  first 12 s  peak ${r.peakDb} dB  rms ${r.activeRmsDb} dB`));
      out.push(t);
    }
    return out;
  });
  const shots = [];
  const musicShot = resolve(h.shotsDir, 'spectro-music.png');
  await page.locator('#music').screenshot({ path: musicShot });
  shots.push(musicShot);
  const names = await page.evaluate(() => (window.__audio || window.__game.ctx.audio).names);
  const per = 30;
  for (let k = 0; k * per < names.length; k++) {
    await page.evaluate(async ([list, id]) => {
      const a = window.__audio || window.__game.ctx.audio;
      document.getElementById('music')?.remove();
      document.querySelectorAll('.sfxsheet').forEach((e) => e.remove());
      const box = document.createElement('div'); box.id = id; box.className = 'sfxsheet';
      box.style.cssText = 'width:960px;display:grid;grid-template-columns:repeat(5,188px);gap:4px;padding:4px';
      document.body.appendChild(box);
      const variants = { land: { impact: 28 }, throw: { kind: 'puff', charge: 1 }, step: { surface: 'wood' }, glowcap: { step: 4 }, tonicStart: { kind: 'updraft' }, zoneEnter: { zone: 'glade' } };
      for (const n of list) {
        const r = await a.renderOffline({ sfx: n, clip: false, seconds: 2.6, params: variants[n] || {}, keepBuffer: true });
        box.appendChild(window.__spec(r.buffer, 188, 110, `${n} ${r.peakDb}`, { hop: 256, fmin: 30, fmax: 16000 }));
      }
    }, [names.slice(k * per, (k + 1) * per), 'sfx' + k]);
    const p = resolve(h.shotsDir, `spectro-sfx-${k + 1}.png`);
    await page.locator('#sfx' + k).screenshot({ path: p });
    shots.push(p);
  }
  return { tracks, sfx: names.length, shots };
}
