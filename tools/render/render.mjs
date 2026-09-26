#!/usr/bin/env node
// The web reference renderer and the web conformance runner (CONFORMANCE.md).
//
//   node tools/render/render.mjs --zega <zegadb/zega checkout> [--only <id>] [--verify]
//   node tools/render/render.mjs --zega <zegadb/zega checkout> --compare <dir> [--only <id>]
//
// For every fixture of every non-draft component, in both themes, it serves
// the checkout's browser/ (the web implementation) next to this repository,
// opens tools/render/harness.html in headless Chromium at the fixture's size
// and scale, fully offline (tiles, fonts and sprites come from the checkout's
// test fixtures; any other host is refused), and screenshots the stage.
//
// Without --verify it writes the reference PNGs and REFERENCES.lock.json
// (what rendered them, and each PNG's SHA-256). With --verify it writes
// nothing: each render is compared with the committed reference under the
// fixture's tolerance, and the run exits 1 if any fixture is over it.
//
// With --compare it renders nothing: another platform's renders, laid out
// under <dir> at the references' own paths (<dir>/components/<id>/...png),
// are compared with the same function and tolerance. Every platform is judged
// by this one comparator.
//
// Playwright is resolved from the zega checkout (browser/node_modules), so
// this repository has no dependencies.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures, referencePaths, DEFAULT_TOLERANCE } from '../lib/repo.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));

function args(argv) {
  const out = { verify: false, compare: null, only: null, zega: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--verify') out.verify = true;
    else if (argv[i] === '--compare') out.compare = resolve(argv[++i]);
    else if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--zega') out.zega = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.zega) throw new Error('--zega <path to a zegadb/zega checkout> is required');
  return out;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.pmtiles': 'application/octet-stream', '.geojson': 'application/json',
  '.zql': 'text/plain', '.csv': 'text/csv', '.ttf': 'font/ttf', '.pbf': 'application/x-protobuf' };

/** A static server: `/__ref/` this folder, `/__repo/` this repository, everything else the checkout's browser/. Byte ranges honoured (pmtiles). */
function serve(browserRoot) {
  const mounts = [['/__ref/', HERE], ['/__repo/', REPO], ['/', browserRoot]];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://x');
      const [prefix, root] = mounts.find(([p]) => url.pathname.startsWith(p));
      const path = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
      if (!(path + sep).startsWith(resolve(root) + sep) && path !== resolve(root)) throw Object.assign(new Error('outside'), { status: 403 });
      const body = await readFile(path);
      const headers = { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
        response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` });
        return response.end(body.subarray(start, end + 1));
      }
      response.writeHead(200, headers);
      response.end(body);
    } catch (error) {
      response.writeHead(error.status || 404);
      response.end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** tiles.zega.dev from the checkout's committed test fixtures; every other outside host refused. */
async function offline(context, browserRoot, origin) {
  const fixtureRoot = join(browserRoot, 'tests/fixtures');
  const archive = await readFile(join(fixtureRoot, 'cities.pmtiles'));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname !== 'tiles.zega.dev') return route.abort();
    if (url.pathname !== '/cities.pmtiles') {
      try {
        const type = url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.png') ? 'image/png' : 'application/x-protobuf';
        return route.fulfill({ body: await readFile(join(fixtureRoot, decodeURIComponent(url.pathname))), contentType: type });
      } catch { return route.fulfill({ status: 404 }); }
    }
    const range = /bytes=(\d+)-(\d+)/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ body: archive, contentType: 'application/octet-stream' });
    const start = Number(range[1]), end = Math.min(Number(range[2]), archive.length - 1);
    return route.fulfill({ status: 206, body: archive.subarray(start, end + 1), headers: {
      'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${archive.length}`, 'access-control-allow-origin': '*' } });
  });
}

/**
 * Compare two PNGs (base64) inside the page: pixelmatch's YIQ colour
 * distance, `threshold` 0–1, over the pixels outside `masks` (pt, scaled).
 * Returns the ratio of differing pixels and the largest connected differing
 * region, in square points.
 */
function diffInPage(page, actual, expected, tolerance, masks, scale) {
  return page.evaluate(async ({ actual, expected, threshold, masks, scale }) => {
    const pixels = async (b64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [a, b] = await Promise.all([pixels(actual), pixels(expected)]);
    if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] };
    const masked = (x, y) => masks.some((m) => x >= m.x * scale && x < (m.x + m.width) * scale && y >= m.y * scale && y < (m.y + m.height) * scale);
    const blend = (c, alpha) => 255 + (c - 255) * alpha;
    const yiq = (r, g, b) => [r * 0.29889531 + g * 0.58662247 + b * 0.11448223, r * 0.59597799 - g * 0.2741761 - b * 0.32180189, r * 0.21147017 - g * 0.52261711 + b * 0.31114694];
    const maxDelta = 35215 * threshold * threshold;
    const diff = new Uint8Array(a.width * a.height);
    let differing = 0, counted = 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (masked(x, y)) continue;
        counted++;
        const i = (y * a.width + x) * 4;
        const p = yiq(blend(a.data[i], a.data[i + 3] / 255), blend(a.data[i + 1], a.data[i + 3] / 255), blend(a.data[i + 2], a.data[i + 3] / 255));
        const q = yiq(blend(b.data[i], b.data[i + 3] / 255), blend(b.data[i + 1], b.data[i + 3] / 255), blend(b.data[i + 2], b.data[i + 3] / 255));
        const [dy, di, dq] = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        if (0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq > maxDelta) { differing++; diff[y * a.width + x] = 1; }
      }
    }
    // The largest 8-connected region of differing pixels: a moved, missing or
    // resized part is one connected region, however small its share of the frame.
    let cluster = 0;
    const stack = [];
    for (let start = 0; start < diff.length; start++) {
      if (diff[start] !== 1) continue;
      let size = 0;
      diff[start] = 2;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop();
        size++;
        const x = i % a.width, y = (i - x) / a.width;
        for (let dy2 = -1; dy2 <= 1; dy2++) for (let dx2 = -1; dx2 <= 1; dx2++) {
          const nx = x + dx2, ny = y + dy2;
          if (nx < 0 || ny < 0 || nx >= a.width || ny >= a.height) continue;
          const j = ny * a.width + nx;
          if (diff[j] === 1) { diff[j] = 2; stack.push(j); }
        }
      }
      if (size > cluster) cluster = size;
    }
    return { ratio: differing / counted, differing, counted, cluster: cluster / (scale * scale) };
  }, { actual, expected, threshold: tolerance.threshold, masks, scale });
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (dir, ...rest) => execFileSync('git', ['-C', dir, ...rest], { encoding: 'utf8' }).trim();

async function main() {
  const opts = args(process.argv.slice(2));
  const zega = resolve(opts.zega);
  const browserRoot = join(zega, 'browser');
  await stat(join(browserRoot, 'components/canvas.js'));
  const require = createRequire(join(browserRoot, 'package.json'));
  const { chromium } = require('@playwright/test');
  const server = await serve(browserRoot);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const lockPath = join(REPO, 'REFERENCES.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{"images":{}}'));
  let failed = 0, renderer = null;
  const judging = opts.verify || opts.compare;
  try {
    for (const fx of await fixtures(REPO)) {
      if (fx.draft || (opts.only && fx.component !== opts.only)) continue;
      const fixture = JSON.parse(await readFile(join(REPO, fx.path), 'utf8'));
      const refs = referencePaths(fx);
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({
          viewport: { width: fixture.size.width, height: fixture.size.height },
          deviceScaleFactor: fixture.scale,
          reducedMotion: 'no-preference',
          colorScheme: theme,
        });
        await offline(context, browserRoot, origin);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const target = refs[theme];
        let png;
        if (opts.compare) {
          await page.goto('about:blank'); // the comparator needs only a document
          png = await readFile(join(opts.compare, target)).catch(() => null);
          if (!png) { failed++; console.log(`FAIL ${target}  no render at ${join(opts.compare, target)}`); await context.close(); continue; }
        } else {
          await page.goto(`${origin}/__ref/harness.html?fixture=${encodeURIComponent(fx.path)}&theme=${theme}`);
          await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error, null, { timeout: 60_000 });
          const error = await page.evaluate(() => document.documentElement.dataset.error);
          if (error) throw new Error(`${fx.path} (${theme}): ${error}`);
          png = await page.locator('#stage').screenshot({ animations: 'disabled', caret: 'hide' });
          renderer ??= await page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl2');
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'no webgl2';
          });
        }
        if (judging) {
          const expected = await readFile(join(REPO, target));
          const tolerance = { ...DEFAULT_TOLERANCE, ...(fixture.tolerance || {}) };
          const d = await diffInPage(page, png.toString('base64'), expected.toString('base64'), tolerance, fixture.masks || [], fixture.scale);
          const over = d.sizeMismatch || d.ratio > tolerance.maxDiffRatio || d.cluster > tolerance.maxCluster;
          if (over) failed++;
          console.log(`${over ? 'FAIL' : 'ok  '} ${target}  ${d.sizeMismatch ? `size ${d.sizeMismatch}` : `${(d.ratio * 100).toFixed(3)}% differ (limit ${(tolerance.maxDiffRatio * 100).toFixed(2)}%), largest region ${d.cluster.toFixed(1)} pt² (limit ${tolerance.maxCluster})`}`);
          if (over) await writeFile(join(REPO, '.tmp', target.replaceAll('/', '__')), png);
        } else {
          await writeFile(join(REPO, target), png);
          lock.images[target] = sha256(png);
          console.log(`wrote ${target}  ${png.length} bytes`);
        }
        if (errors.length && !opts.compare) console.warn(`  page errors: ${errors.join(' | ')}`);
        await context.close();
      }
    }
    if (!judging) {
      lock.renderer = {
        tool: 'tools/render/render.mjs',
        implementation: `zegadb/zega@${git(zega, 'rev-parse', 'HEAD')}`,
        browser: `chromium ${browser.version()} headless`,
        gl: renderer,
        host: `${process.platform}-${process.arch}`,
        note: 'Rendered offline from the implementation checkout; reviewed and approved by Sami (CONFORMANCE.md).',
      };
      lock.images = Object.fromEntries(Object.entries(lock.images).sort(([a], [b]) => a.localeCompare(b)));
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) {
    console.error(`${failed} render(s) over tolerance; the renders are in .tmp/`);
    process.exit(1);
  }
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
