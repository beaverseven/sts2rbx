// Bundles a JS entry and splices it into src/page.html.
//   node tools/build.mjs                       -> src/main.js into dist/
//   node tools/build.mjs --entry src/dev/x.js --out dist/dev-x   (sandbox builds; agents use their own --out)
//   add --dev for an unminified bundle (readable stack traces), --watch to rebuild on change
// Outputs in the out dir:
//   index.html    - full standalone document (open directly with file://)
//   artifact.html - same page without <html>/<head>/<body> wrappers (claude.ai artifact format)
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const watch = argv.includes('--watch');
const dev = argv.includes('--dev');
const entry = resolve(root, arg('--entry', 'src/main.js'));
const outDir = resolve(root, arg('--out', 'dist'));
const pagePath = resolve(root, arg('--page', 'src/page.html'));

function splice(js) {
  const page = readFileSync(pagePath, 'utf8');
  const [headPart, bodyPart] = page.split('<!--BODY-->');
  if (bodyPart === undefined) throw new Error('page.html must contain a <!--BODY--> marker');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const script = `<script>\n${safeJs}\n</script>`;
  const body = bodyPart.replace('<!--BUNDLE-->', () => script);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'artifact.html'), `${headPart.trim()}\n${body.trim()}\n`);
  writeFileSync(
    resolve(outDir, 'index.html'),
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${headPart.trim()}\n</head>\n<body>\n${body.trim()}\n</body>\n</html>\n`
  );
  const kb = (Buffer.byteLength(script) / 1024).toFixed(0);
  console.log(`[build] ${entry.replace(root + '/', '')} -> ${outDir.replace(root + '/', '')}/index.html (script ${kb} KB)`);
}

const options = {
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !dev,
  sourcemap: false,
  write: false,
  logLevel: 'warning',
  legalComments: 'none',
};

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'splice', setup(b) { b.onEnd((r) => { if (!r.errors.length) splice(r.outputFiles[0].text); }); } }],
  });
  await ctx.watch();
  console.log('[build] watching ...');
} else {
  const result = await esbuild.build(options);
  splice(result.outputFiles[0].text);
}
