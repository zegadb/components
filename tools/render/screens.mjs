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
} finally {
  await browser.close();
  server.close();
}
