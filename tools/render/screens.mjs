#!/usr/bin/env node
// Screenshots for review (never references): every web fixture, or one
// component's, in both modes, drawn exactly as web.mjs draws them, into
// screens/<component>/<name>.<light|dark>.png (gitignored).
//
//   node tools/render/screens.mjs [--only <id>] [--out <dir>]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webFixtures } from '../lib/repo.mjs';
import { launch, serve, shoot } from './web.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const only = arg('--only');
const out = resolve(arg('--out') ?? join(REPO, 'screens'));
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
try {
  for (const fx of await webFixtures(REPO)) {
    if (only && fx.component !== only) continue;
    const fixture = JSON.parse(await readFile(join(REPO, fx.path), 'utf8'));
    await mkdir(join(out, fx.component), { recursive: true });
    for (const mode of ['light', 'dark']) {
      const { png, context, errors } = await shoot(browser, origin, fx.path, fixture, mode);
      const path = join(out, fx.component, `${fx.name}.${mode}.png`);
      await writeFile(path, png);
      console.log(`wrote ${path}${errors.length ? `  page errors: ${errors.join(' | ')}` : ''}`);
      await context.close();
    }
  }
  // --loading name: also that fixture's loading state, per mode.
  const loading = arg('--loading');
  if (loading) {
    const fx = (await webFixtures(REPO)).find((f) => f.name === loading && (!only || f.component === only));
    const fixture = JSON.parse(await readFile(join(REPO, fx.path), 'utf8'));
    for (const mode of ['light', 'dark']) {
      const { png, context } = await shoot(browser, origin, fx.path, fixture, mode, '&loading=1');
      const path = join(out, fx.component, `${fx.name}.loading.${mode}.png`);
      await writeFile(path, png);
      console.log(`wrote ${path}`);
      await context.close();
    }
  }
  // --pairs a:b,c:d  also puts two fixtures' screenshots side by side, per mode (for comparing bodies).
  for (const pair of (arg('--pairs') ?? '').split(',').filter(Boolean)) {
    const [a, b] = pair.split(':');
    for (const mode of ['light', 'dark']) {
      const component = only ?? 'body';
      const images = await Promise.all([a, b].map((n) => readFile(join(out, component, `${n}.${mode}.png`))));
      const size = (png) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
      const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: images.reduce((w, png) => w + size(png).width + 2, 0), height: Math.max(...images.map((png) => size(png).height)) } });
      await page.setContent(`<body style="margin:0;display:flex;background:#888">${images.map((png) => `<img style="display:block;margin-right:2px" src="data:image/png;base64,${png.toString('base64')}">`).join('')}</body>`);
      const path = join(out, component, `${a}+${b}.${mode}.png`);
      await writeFile(path, await page.locator('body').screenshot());
      console.log(`wrote ${path}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
