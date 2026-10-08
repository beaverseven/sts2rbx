// Settings persistence: ctx.settings <-> localStorage (every access wrapped; the game
// works the same without storage, settings then last for the session only).
const KEY = 'gloomfen-rumble.settings.v1';

const clamp = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Validated copy of whatever is stored, or null. */
export function loadStoredSettings() {
  let raw = null;
  try { raw = window.localStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if ('master' in s) out.master = clamp(s.master, 0, 1, 0.8);
  if ('music' in s) out.music = clamp(s.music, 0, 1, 0.6);
  if ('sfx' in s) out.sfx = clamp(s.sfx, 0, 1, 0.9);
  if ('sensitivity' in s) out.sensitivity = clamp(s.sensitivity, 0.3, 2, 1);
  if ('invertY' in s) out.invertY = !!s.invertY;
  if (s.quality === 'high' || s.quality === 'low') out.quality = s.quality;
  return out;
}

/**
 * Save the user-facing settings. `qualityChosen` = the player picked a quality in the
 * menu (otherwise quality is not stored, so core's auto-quality keeps working).
 * Returns true when it was written.
 */
export function storeSettings(settings, qualityChosen) {
  const out = {
    master: settings.master, music: settings.music, sfx: settings.sfx,
    sensitivity: settings.sensitivity, invertY: !!settings.invertY,
  };
  if (qualityChosen) out.quality = settings.quality === 'low' ? 'low' : 'high';
  else {
    const prev = loadStoredSettings();
    if (prev && prev.quality) out.quality = prev.quality;
  }
  try { window.localStorage.setItem(KEY, JSON.stringify(out)); return true; } catch { return false; }
}

/** True if localStorage can be written. */
export function storageWorks() {
  try {
    const k = KEY + '.probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

/** Apply stored settings to ctx (volumes via audio, quality via the renderer). */
export function applyStoredSettings(ctx) {
  const s = loadStoredSettings();
  if (!s) return null;
  for (const k of ['master', 'music', 'sfx', 'sensitivity', 'invertY']) if (k in s) ctx.settings[k] = s[k];
  try { ctx.audio && ctx.audio.setVolumes && ctx.audio.setVolumes({ master: ctx.settings.master, music: ctx.settings.music, sfx: ctx.settings.sfx }); } catch (e) { console.error(e); }
  // a ?quality= URL override (testing) wins over the stored choice
  let urlQuality = false;
  try { urlQuality = new URLSearchParams(location.search).has('quality'); } catch { /* ignore */ }
  if (s.quality && !urlQuality) setQuality(ctx, s.quality);
  return s;
}

export function setQuality(ctx, q) {
  ctx.settings.quality = q;
  if (typeof ctx.setQuality === 'function') ctx.setQuality(q);
  else if (ctx.gfx && typeof ctx.gfx.setQuality === 'function') ctx.gfx.setQuality(q);
}
