#!/usr/bin/env node
// The web package's reference renderer and conformance runner (CONFORMANCE.md, "The web package").
//
//   node tools/render/web.mjs [--only <id>]            render every web fixture, write references + the lock
//   node tools/render/web.mjs --verify [--only <id>]   render and compare with the references; write nothing
//
// Each web fixture (components/<id>/web/<name>.json) is drawn in both modes by
// tools/render/web.html with the built package (`npm run build` first), in
// headless Chromium at the fixture's width and scale 2, fully offline (only
// this repository is served; every other request is refused), and the stage is
// screenshotted. The comparator is render.mjs's diffInPage: one judge for
// every platform.
//
// Text rendering differs between systems, so references are rendered, and
// verified, in one pinned image: mcr.microsoft.com/playwright:v1.63.0-noble
// (CI's container; locally: tools/render/in-container.sh).
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webFixtures, webReferencePaths, DEFAULT_TOLERANCE } from '../lib/repo.mjs';
import { diffInPage } from './render.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json' };

export function serve(root = REPO) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://x');
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(resolve(root) + sep)) throw new Error('outside');
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Chromium for references: software GL (deterministic), no GPU, no network. */
export async function launch() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization', '--font-render-hinting=none'] });
}

/** Draw one fixture in one mode and screenshot it. */
export async function shoot(browser, origin, fixturePath, fixture, mode, extra = '') {
  const context = await browser.newContext({ viewport: { width: fixture.size.width, height: 900 }, deviceScaleFactor: fixture.scale, colorScheme: mode, reducedMotion: 'reduce' });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/tools/render/web.html?fixture=${encodeURIComponent(fixturePath)}&mode=${mode}${extra}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error, null, { timeout: 60_000 });
  const error = await page.evaluate(() => document.documentElement.dataset.error);
  if (error) throw new Error(`${fixturePath} (${mode}): ${error}`);
  const png = await page.locator('#stage').screenshot({ animations: 'disabled', caret: 'hide' });
  return { png, page, context, errors };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const verify = process.argv.includes('--verify');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  const lockPath = join(REPO, 'REFERENCES.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.web ??= { renderer: {}, images: {} };
  let failed = 0, gl = null;
  await mkdir(join(REPO, '.tmp'), { recursive: true });
  try {
    for (const fx of await webFixtures(REPO)) {
      if (only && fx.component !== only) continue;
      const fixture = JSON.parse(await readFile(join(REPO, fx.path), 'utf8'));
      const refs = webReferencePaths(fx);
      for (const mode of ['light', 'dark']) {
        const { png, page, context, errors } = await shoot(browser, origin, fx.path, fixture, mode);
        gl ??= await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return c ? c.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : c.RENDERER) : 'no webgl2'; });
        const target = refs[mode];
        if (verify) {
          const expected = await readFile(join(REPO, target)).catch(() => null);
          if (!expected) { failed++; console.log(`FAIL ${target}  no reference`); await context.close(); continue; }
          const tolerance = { ...DEFAULT_TOLERANCE, ...(fixture.tolerance || {}) };
          const d = await diffInPage(page, png.toString('base64'), expected.toString('base64'), tolerance, fixture.masks || [], fixture.scale);
          const over = d.sizeMismatch || d.ratio > tolerance.maxDiffRatio || d.cluster > tolerance.maxCluster;
          if (over) { failed++; await writeFile(join(REPO, '.tmp', target.replaceAll('/', '__')), png); }
          console.log(`${over ? 'FAIL' : 'ok  '} ${target}  ${d.sizeMismatch ? `size ${d.sizeMismatch}` : `${(d.ratio * 100).toFixed(3)}% differ (limit ${(tolerance.maxDiffRatio * 100).toFixed(2)}%), largest region ${d.cluster.toFixed(1)} pt² (limit ${tolerance.maxCluster})`}`);
        } else {
          await writeFile(join(REPO, target), png);
          lock.web.images[target] = sha256(png);
          console.log(`wrote ${target}  ${png.length} bytes`);
        }
        if (errors.length) console.warn(`  page errors: ${errors.join(' | ')}`);
        await context.close();
      }
    }
    if (!verify) {
      lock.web.renderer = {
        tool: 'tools/render/web.mjs',
        implementation: 'this repository\'s web package (dist/, built from src/ at the same commit)',
        browser: `chromium ${browser.version()} headless`,
        gl,
        image: 'mcr.microsoft.com/playwright:v1.63.0-noble',
        host: `${process.platform}-${process.arch}`,
        note: 'Proposed references: rendered offline in the pinned image; they become canonical when Sami approves them (CONFORMANCE.md).',
      };
      lock.web.images = Object.fromEntries(Object.entries(lock.web.images).sort(([a], [b]) => a.localeCompare(b)));
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) { console.error(`${failed} render(s) over tolerance; the renders are in .tmp/`); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error.stack || error); process.exit(1); });
