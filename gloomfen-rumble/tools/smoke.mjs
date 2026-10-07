// Headless smoke test: loads a built page in Chromium (SwiftShader WebGL),
// reports console errors and writes a screenshot.
//   node tools/smoke.mjs [--html dist/index.html] [--out shot.png] [--wait 2500] [--w 1280 --h 720]
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, f) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : f; };
const html = resolve(root, arg('--html', 'dist/index.html'));
const out = resolve(root, arg('--out', 'dist/smoke.png'));
const wait = Number(arg('--wait', 2500));
const browser = await chromium.launch({ args: CHROME_ARGS() });
const page = await browser.newPage({ viewport: { width: Number(arg('--w', 1280)), height: Number(arg('--h', 720)) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto('file://' + html);
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log(JSON.stringify({ screenshot: out, errors }, null, 2));
await browser.close();
function CHROME_ARGS() {
  return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
}
