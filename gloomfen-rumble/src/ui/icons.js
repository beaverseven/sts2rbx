// Inline SVG icons, all original and drawn for Gloomfen Rumble. Colours come from
// CSS classes (page.html), so every fill/stroke uses a palette token.
import { hash01 } from './dom.js';

/** Leaf-heart: a heart with a midrib + veins and a sprouting leaf. */
export const HEART = `<svg viewBox="0 0 36 34" aria-hidden="true">
  <path class="hs" d="M18.4 10 C 18 6.2 20.2 2.4 26.4 1.4 C 26.2 5.4 23.6 9 18.4 10 Z"/>
  <path class="hb" d="M18 32 C 7.5 25.2 2.4 19 3.2 12.2 C 3.9 6.6 11.4 4.2 18 10.6 C 24.6 4.2 32.1 6.6 32.8 12.2 C 33.6 19 28.5 25.2 18 32 Z"/>
  <path class="hv" d="M18 12.8 C 18.3 18 18.2 23 18 28.4 M18 17.2 C 15.8 15.6 13.6 14.6 10.8 14.2 M18 17.2 C 20.2 15.6 22.4 14.6 25.2 14.2 M18 22.2 C 15.8 21 13.8 20.2 11.6 20 M18 22.2 C 20.2 21 22.2 20.2 24.4 20"/>
  <ellipse class="hl" cx="9.8" cy="12.2" rx="3.4" ry="1.9" transform="rotate(-34 9.8 12.2)"/>
</svg>`;

/** Glowcap: a faceted crystal mushroom cap. */
export const GLOWCAP = `<svg class="ic ic-glowcap" viewBox="0 0 28 28" aria-hidden="true">
  <circle class="g" cx="14" cy="13" r="12.5"/>
  <path class="s" d="M10.8 16.5 L 17.2 16.5 L 18 24.5 Q 14 26 10 24.5 Z"/>
  <path class="c" d="M2.8 17 C 2.8 9 8 3.4 14 3.4 C 20 3.4 25.2 9 25.2 17 Q 14 20 2.8 17 Z"/>
  <path class="f" d="M14 4 L 10.4 17.6 M14 4 L 17.6 17.6 M5.4 10.6 Q 14 13.2 22.6 10.6"/>
</svg>`;

/** Glowworm: a curled grub with a glowing tail and antennae. */
export const WORM = `<svg class="ic ic-worm" viewBox="0 0 28 28" aria-hidden="true">
  <circle class="halo" cx="6" cy="20.5" r="6.4"/>
  <circle class="tail" cx="6" cy="20.5" r="3.6"/>
  <circle class="seg" cx="10.2" cy="15.6" r="4"/>
  <circle class="seg" cx="14.9" cy="12.6" r="4.3"/>
  <path class="ant" d="M20.4 7.2 C 20.3 4.8 21.5 3.3 23.3 2.9 M22.6 7.8 C 23.6 6 25.1 5.3 26.6 5.6"/>
  <circle class="bulb" cx="23.3" cy="2.9" r="1.4"/><circle class="bulb" cx="26.6" cy="5.6" r="1.4"/>
  <circle class="head" cx="20.6" cy="11.8" r="5"/>
  <circle class="eye" cx="22.4" cy="10.8" r="1.25"/>
</svg>`;

/** Morel: the hero's cap glyph (honeycomb cone, stalk, scarf, eyes). Used by the logo, buttons, joystick. */
export function morelGlyph(cls = '') {
  const pits = [
    [26, 15, 2.3, 3.8, 10], [34, 15, 2.3, 3.8, -10],
    [21.2, 26, 2.7, 4.4, 8], [30, 25.4, 2.7, 4.6, 0], [38.8, 26, 2.7, 4.4, -8],
    [17.6, 38, 2.6, 4.6, 6], [25.8, 37.6, 2.8, 4.8, 2], [34.2, 37.6, 2.8, 4.8, -2], [42.4, 38, 2.6, 4.6, -6],
    [21.6, 48.6, 2.8, 3.6, 4], [30, 49.2, 2.9, 3.8, 0], [38.4, 48.6, 2.8, 3.6, -4],
  ].map(([x, y, rx, ry, r]) => `<ellipse class="pit" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${x} ${y})"/>`).join('');
  return `<svg class="ic ic-morel ${cls}" viewBox="0 0 60 84" aria-hidden="true">
    <path class="stalk" d="M21 52 C 21.5 62 20 71 17 79 Q 30 83 43 79 C 40 71 38.5 62 39 52 Z"/>
    <path class="scarf" d="M17.4 55 Q 30 61 42.6 55 L 43 61.4 Q 30 67 17 61.4 Z M39.6 59.6 Q 48.4 60.4 53.6 66.6 Q 46 67.6 40.2 64 Z"/>
    <ellipse class="eye" cx="25.6" cy="70" rx="2.4" ry="3.3"/><ellipse class="eye" cx="34.4" cy="70" rx="2.4" ry="3.3"/>
    <circle class="glint" cx="26.4" cy="68.7" r=".95"/><circle class="glint" cx="35.2" cy="68.7" r=".95"/>
    <path class="cap" d="M30 3 C 38 8.5 46.5 26 47.5 44 C 48 52.5 41 57.5 30 57.5 C 19 57.5 12 52.5 12.5 44 C 13.5 26 22 8.5 30 3 Z"/>
    ${pits}
  </svg>`;
}

/** Tonic icons (24x24), coloured by currentColor. */
export const TONIC_ICONS = {
  anvil: `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M2.6 7 H 16.6 C 16.8 9.8 18.8 11.2 22 11.2 V 13 H 16.4 L 14 16.2 H 17 V 20 H 5.6 V 16.2 H 8.6 L 6.2 13 H 5 C 3.6 13 2.6 12 2.6 10.6 Z"/></svg>`,
  updraft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="line" d="M5.5 13.5 L 12 7 L 18.5 13.5 M5.5 20 L 12 13.5 L 18.5 20"/><circle class="fill" cx="12" cy="3" r="2"/></svg>`,
  seeker: (() => {
    let g = '';
    for (let k = 0; k < 3; k++) {
      g += `<g transform="rotate(${k * 120} 12 12)"><path class="line" d="M12 3.8 A 8.2 8.2 0 0 0 4.9 7.9"/><circle class="fill" cx="12" cy="3.8" r="2.5"/></g>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${g}<circle class="fill" cx="12" cy="12" r="1.9"/></svg>`;
  })(),
};
export const TONIC_NAMES = { anvil: 'Anvil', updraft: 'Updraft', seeker: 'Seeker' };

/** Chief Gnarlbelly's tin-pot toad face (boss bar). */
export const POT = `<svg class="ic ic-pot" viewBox="0 0 28 28" aria-hidden="true">
  <path class="face" d="M3 17 C 3 12 8 10.5 14 10.5 C 20 10.5 25 12 25 17 C 25 22.6 20 25.6 14 25.6 C 8 25.6 3 22.6 3 17 Z"/>
  <circle class="eye" cx="9" cy="15.2" r="2.6"/><circle class="eye" cx="19" cy="15.2" r="2.6"/>
  <path class="dent" d="M8.4 20.8 Q 14 23.8 19.6 20.8"/>
  <path class="pot" d="M5.2 11 C 5.2 5.2 9 2.4 14 2.4 C 19 2.4 22.8 5.2 22.8 11 Z"/>
  <rect class="rim" x="3" y="9.8" width="22" height="3.2" rx="1.6"/>
  <path class="dent" d="M10 5 Q 11.6 6.6 10.6 8.2"/>
</svg>`;

export const SIGN = `<svg class="ic ic-sign" viewBox="0 0 26 26" aria-hidden="true">
  <rect class="post" x="11.5" y="10" width="3" height="15" rx="1"/>
  <path class="board" d="M2.5 3.5 H 20.5 L 24.2 8.2 L 20.5 12.9 H 2.5 Z"/>
  <path class="ln" d="M6 6.9 H 17 M6 9.7 H 13.6"/>
</svg>`;

export const SPARK = `<svg class="ic ic-spark" viewBox="0 0 26 26" aria-hidden="true"><path class="st" d="M13 2 C 14 9 17 12 24 13 C 17 14 14 17 13 24 C 12 17 9 14 2 13 C 9 12 12 9 13 2 Z"/></svg>`;

/** Zone-card flourish: two curling vines with leaves and glowing buds around a tiny morel cap. */
export const FLOURISH = (() => {
  const leaf = (x, y, r, s = 1) => `<path class="leaf" transform="translate(${x} ${y}) rotate(${r}) scale(${s})" d="M0 0 C 3 -6 11 -7 15 -1 C 10 3.6 4 3.6 0 0 Z"/>`;
  const half = `
    <path class="vine" pathLength="1" d="M212 30 C 196 30 188 20 172 22 C 154 24 150 39 132 38 C 116 37 115 23 126 22 C 134 21 135 31 128 31.5"/>
    <path class="vine" pathLength="1" d="M150 34 C 128 47 96 30 70 34 C 50 37 38 29 26 27 C 16 25.5 12 33 19 34.5"/>
    ${leaf(186, 23, -150, 0.95)}${leaf(160, 25, 160, 0.8)}${leaf(102, 34, 200, 0.9)}${leaf(70, 34, -20, 0.8)}${leaf(46, 33, 170, 0.7)}
    <circle class="bud" cx="128" cy="31.5" r="3.2"/><circle class="bud" cx="19" cy="34.5" r="3"/><circle class="bud" cx="88" cy="28" r="2.2"/>`;
  return `<svg class="zc-flourish" viewBox="0 0 460 54" aria-hidden="true">
    <g>${half}</g>
    <g transform="translate(460 0) scale(-1 1)">${half}</g>
    <g class="capgrp">
      <path class="capg" d="M230 7 C 236 11 240.5 21 240.5 31 C 240.5 36.5 236.5 40 230 40 C 223.5 40 219.5 36.5 219.5 31 C 219.5 21 224 11 230 7 Z"/>
      <ellipse class="pit" cx="227" cy="18" rx="1.6" ry="2.8"/><ellipse class="pit" cx="233" cy="18" rx="1.6" ry="2.8"/>
      <ellipse class="pit" cx="224.6" cy="28" rx="1.8" ry="3"/><ellipse class="pit" cx="230" cy="27.6" rx="1.8" ry="3.1"/><ellipse class="pit" cx="235.4" cy="28" rx="1.8" ry="3"/>
      <ellipse class="pit" cx="227" cy="36" rx="1.8" ry="2"/><ellipse class="pit" cx="233" cy="36" rx="1.8" ry="2"/>
    </g>
  </svg>`;
})();

/** An irregular splat blob with droplets and spores, deterministic. */
export const SPLAT = (() => {
  const cx = 200, cy = 125, n = 15;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const lobe = i % 2 === 0;
    const r = lobe ? 96 + hash01(i + 3) * 26 : 72 + hash01(i + 40) * 10;
    pts.push([cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 0.92]);
  }
  // valleys (odd indices) are the on-curve points, lobes (even indices) the controls
  let d = '';
  const mids = [];
  for (let i = 1; i < pts.length; i += 2) mids.push(pts[i]);
  for (let k = 0; k < mids.length; k++) {
    const a = mids[k], b = mids[(k + 1) % mids.length], c = pts[(k * 2 + 2) % pts.length];
    if (k === 0) d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)} `;
    d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)} `;
  }
  d += 'Z';
  let drops = '';
  for (let i = 0; i < 7; i++) {
    const a = hash01(i + 90) * Math.PI * 2;
    const r = 150 + hash01(i + 120) * 38;
    drops += `<circle class="drop" cx="${(cx + Math.cos(a) * r * 1.22).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.66).toFixed(1)}" r="${(5 + hash01(i + 7) * 8).toFixed(1)}"/>`;
  }
  let spores = '';
  for (let i = 0; i < 16; i++) {
    const a = hash01(i + 300) * Math.PI * 2;
    const r = 30 + hash01(i + 333) * 70;
    spores += `<circle class="spore" cx="${(cx + Math.cos(a) * r * 1.5).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.85).toFixed(1)}" r="${(2 + hash01(i + 9) * 3).toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 400 250" aria-hidden="true">${drops}<path class="blob" d="${d}"/>${spores}</svg>`;
})();

/** Drippy bottom edge of the death curtain. */
export const DRIPS = (() => {
  let d = 'M0 0 H 1000 V 6 ';
  const n = 26;
  for (let i = n; i >= 0; i--) {
    const x = (i / n) * 1000;
    const len = 6 + hash01(i + 11) * 30;
    const w = 12 + hash01(i + 5) * 16;
    d += `L ${(x + w / 2).toFixed(1)} 6 C ${(x + w / 2).toFixed(1)} ${(len * 0.7).toFixed(1)} ${(x + w * 0.35).toFixed(1)} ${len.toFixed(1)} ${x.toFixed(1)} ${len.toFixed(1)} C ${(x - w * 0.35).toFixed(1)} ${len.toFixed(1)} ${(x - w / 2).toFixed(1)} ${(len * 0.7).toFixed(1)} ${(x - w / 2).toFixed(1)} 6 `;
  }
  d += 'L 0 6 Z';
  return `<svg class="drips" viewBox="0 0 1000 41" preserveAspectRatio="none" aria-hidden="true"><path class="drip" d="${d}"/></svg>`;
})();

/** Scalloped rank medallion. */
export const BADGE = (() => {
  const n = 18, cx = 100, cy = 100;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * 84, cy + Math.sin(a0) * 84];
    const c = [cx + Math.cos(a1) * 104, cy + Math.sin(a1) * 104];
    const p2 = [cx + Math.cos(a2) * 84, cy + Math.sin(a2) * 84];
    if (i === 0) d += `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} `;
    d += `Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  d += 'Z';
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><path class="scal" d="${d}"/><circle class="inner" cx="100" cy="100" r="70"/><circle class="ring" cx="100" cy="100" r="62"/></svg>`;
})();

/** Touch button icons. */
export const TOUCH_ICONS = {
  jump: `<svg class="tic" viewBox="0 0 24 24" aria-hidden="true"><path class="ln" d="M5 12.5 L 12 5.5 L 19 12.5 M5 19 L 12 12 L 19 19"/></svg>`,
  throw: `<svg class="tic" viewBox="0 0 24 24" aria-hidden="true"><circle class="fl" cx="14.5" cy="11" r="5"/><circle class="fl" cx="9" cy="14" r="3.6"/><circle class="fl" cx="17" cy="16.4" r="3"/><path class="ln" d="M2.5 8 H 6.5 M1.5 12.5 H 4 M3 17 H 5.4"/></svg>`,
  lock: `<svg class="tic" viewBox="0 0 24 24" aria-hidden="true"><circle class="ln" cx="12" cy="12" r="7"/><path class="ln" d="M12 1.8 V 6 M12 18 V 22.2 M1.8 12 H 6 M18 12 H 22.2"/><circle class="fl" cx="12" cy="12" r="2.2"/></svg>`,
  pause: `<svg viewBox="0 0 18 18" aria-hidden="true"><rect class="fl" x="3" y="2" width="4.4" height="14" rx="2"/><rect class="fl" x="10.6" y="2" width="4.4" height="14" rx="2"/></svg>`,
};
