// Scripted playtest runner. Loads a built page and runs a scenario module against it.
//   node tools/scenario.mjs <scenario.mjs> [--html dist/index.html] [--w 960 --h 540] [--shots <dir>]
// A scenario module exports:  export default async function (page, h) { ... }
// where h = { shot(name), wait(ms), hold(code, ms), tap(code), game(fn, arg), log(...), errors, shotsDir }
//   h.game(fn, arg) runs fn(window.__game, arg) in the page and returns its JSON-able result.
//   Key codes are KeyboardEvent.code values ('KeyW', 'Space', 'KeyJ', 'ShiftLeft', 'Escape', ...).
// Prints a JSON report with the scenario's return value, console errors and screenshot paths.
import { chromium } from 'playwright';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, f) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : f; };
const scenarioPath = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
if (!scenarioPath) { console.error('usage: node tools/scenario.mjs <scenario.mjs> [--html ...]'); process.exit(2); }
const html = resolve(root, arg('--html', 'dist/index.html'));
const shotsDir = resolve(root, arg('--shots', 'dist/shots'));
mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(arg('--w', 960)), height: Number(arg('--h', 540)) } });
const errors = [];
const shots = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
await page.goto('file://' + html);
const h = {
  errors, shotsDir,
  wait: (ms) => page.waitForTimeout(ms),
  async shot(name) { const p = resolve(shotsDir, `${name}.png`); await page.screenshot({ path: p }); shots.push(p); return p; },
  async hold(code, ms) { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); },
  async tap(code) { await page.keyboard.press(code); },
  game: (fn, a) => page.evaluate(([src, a2]) => (0, eval)(`(${src})`)(window.__game, a2), [fn.toString(), a]),
  log: (...a) => console.log('[scenario]', ...a),
};
let result, failed = null;
try {
  const mod = await import(pathToFileURL(isAbsolute(scenarioPath) ? scenarioPath : resolve(process.cwd(), scenarioPath)).href);
  result = await mod.default(page, h);
} catch (e) { failed = String(e && e.stack || e); }
console.log(JSON.stringify({ result, failed, errors, shots }, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
