// Small DOM helpers shared by the HUD, menus and touch layer.

/** Create an element: el('div', 'cls a', { role: 'button' }, [children | text]) */
export function el(tag, cls, attrs, children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  if (children) for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

/** Parse an SVG/HTML snippet into a single element. */
export function frag(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

const NF = new Intl.NumberFormat('en-US');
/** 12450 -> "12,450" */
export const fmtInt = (n) => NF.format(Math.round(n));

/** seconds -> "m:ss" (or "h:mm:ss") */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Write textContent only when it changed (HUD hot path). */
export function setText(node, value) {
  const s = String(value);
  if (node.__t !== s) { node.__t = s; node.textContent = s; }
}

/** Toggle a class only when it changed. */
export function setClass(node, cls, on) {
  on = !!on;
  const key = '__c_' + cls;
  if (node[key] !== on) { node[key] = on; node.classList.toggle(cls, on); }
}

/** Set an attribute only when it changed. */
export function setAttr(node, name, value) {
  const key = '__a_' + name;
  const s = String(value);
  if (node[key] !== s) { node[key] = s; node.setAttribute(name, s); }
}

const reducedMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const reducedMotion = () => reducedMQ.matches;

/**
 * One-shot Web Animation. With reduced motion the keyframes are replaced by
 * `reducedFrames` (default: skip entirely). Returns the Animation or null.
 */
export function animate(node, frames, opts, reducedFrames = null) {
  if (!node || !node.animate) return null;
  if (reducedMotion()) {
    if (!reducedFrames) return null;
    frames = reducedFrames;
  }
  try { return node.animate(frames, opts); } catch { return null; }
}

/** Restart a CSS animation that is driven by a class. */
export function restartClass(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth; // reflow so the animation restarts (rare events only)
  node.classList.add(cls);
  node['__c_' + cls] = true; // keep setClass's cache in sync
}

/** Split text into <span style="--i:n"> letters (spaces kept). */
export function letters(text, extra) {
  const out = [];
  let i = 0;
  for (const ch of text) {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.setProperty('--i', String(i));
    if (extra) extra(s, i, ch);
    out.push(s);
    i++;
  }
  return out;
}

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
