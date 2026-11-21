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
import { components, webFixtures, webReferencePaths, DEFAULT_TOLERANCE } from '../lib/repo.mjs';
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

/**
 * The body's runtime, in a real page: twenty stills hold no WebGL context and all stay drawn; a body
 * mounted hidden waits and then draws at its size; a resize re-lays the picture and the labels; an
 * interactive body asks for no frames while idle; a cancelled mount leaves nothing behind. Returns
 * the problems found.
 */
export async function bodyRuntime(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(`${origin}/tools/render/web.html?fixture=none`);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(['the runtime checks did not finish in 3 minutes (a mount never resolved)']), 180_000).unref());
  const problems = await Promise.race([timeout, page.evaluate(async () => {
    const out = [];
    const { drawBody } = await import('/dist/body/draw.js');
    const { theme } = await import('/dist/index.js');
    const { validate } = await import('/dist/body/index.js');
    const t = theme('ava', 'light');
    document.body.innerHTML = '';
    const spec = (options = {}) => validate({ component: 'body', data: { highlight: [{ region: 'liver' }, { region: 'gallbladder', role: 'related' }] }, options }).view;
    const box = (w, h) => { const el = document.createElement('div'); el.dataset.zcHost = 'ava'; el.style.cssText = `width:${w}px;height:${h}px;display:inline-block`; document.body.appendChild(el); return el; };
    const asset = (b, layer) => (layer ? `/packages/body-za/assets/${layer}/${b}.glb` : `/assets/body/${b}.glb`);
    const litIn = (canvas) => { const g = canvas.getContext('2d'); const d = g.getImageData(0, 0, canvas.width, canvas.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x66) + Math.abs(d[i + 1] - 0x46) + Math.abs(d[i + 2] - 0xee) < 90) n++; return n; };
    // Each check runs on its own: one that throws or hangs (20 s) is reported, and the next still runs.
    const within = (promise, ms = 20000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms))]);
    const step = async (name, fn) => { try { await fn(); } catch (e) { out.push(`${name}: ${e.message}`); } document.body.innerHTML = ''; };
    const v = spec();
    await step('twenty stills', async () => {
      const stills = [];
      for (let i = 0; i < 20; i++) { const s = spec(); stills.push(await within(drawBody(box(160, 160), s.data, s.options, { theme: t, asset, reducedMotion: true }))); }
      const pictures = [...document.querySelectorAll('canvas.zc-body-canvas')];
      if (pictures.length !== 20) out.push(`20 stills made ${pictures.length} pictures`);
      // A plain 2D picture per still: a WebGL canvas would hold one of the browser's ~16 contexts.
      const flat = pictures.filter((c) => c.getContext('2d') !== null);
      if (flat.length !== pictures.length) out.push(`${pictures.length - flat.length} of 20 stills kept a WebGL canvas (and its context)`);
      const blank = flat.filter((c) => litIn(c) < 20).length;
      if (blank) out.push(`${blank} of 20 stills are blank`);
      for (const h of stills) h.dispose();
      if (document.querySelectorAll('.zc-body').length) out.push('dispose left a body behind');
    });
    await step('hidden mount and resize', async () => {
      const hidden = box(358, 380); hidden.style.display = 'none';
      const pending = drawBody(hidden, v.data, v.options, { theme: t, asset, reducedMotion: true });
      await new Promise((r) => setTimeout(r, 300));
      hidden.style.display = 'inline-block';
      const h2 = await within(pending);
      const pic = hidden.querySelector('canvas');
      if (!pic || pic.clientWidth !== 358) out.push(`hidden mount drew at ${pic?.clientWidth} px`);
      if ([...hidden.querySelectorAll('.zc-body-lines circle, svg circle')].some((c) => !Number.isFinite(Number(c.getAttribute('cx'))))) out.push('hidden mount: a leader at NaN');
      hidden.style.width = '640px'; hidden.style.height = '600px';
      await new Promise((r) => setTimeout(r, 300));
      const stage = (hidden.querySelector('.zc-body-stage') ?? hidden).getBoundingClientRect();
      if (Math.abs(hidden.querySelector('canvas').getBoundingClientRect().width - 640) > 1) out.push('resize: the picture kept its old width');
      for (const l of hidden.querySelectorAll('.zc-body-label')) { const r = l.getBoundingClientRect(); if (r.right > stage.right + 1 || r.bottom > stage.bottom + 1) { out.push('resize: a label left the picture'); break; } }
      h2.dispose();
    });
    await step('interactive idle', async () => {
      const vi = spec({ mode: 'interactive' });
      const h3 = await within(drawBody(box(400, 400), vi.data, vi.options, { theme: t, asset, reducedMotion: true }));
      await new Promise((r) => setTimeout(r, 500));
      let frames = 0; const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = (f) => { frames++; return raf(f); };
      await new Promise((r) => setTimeout(r, 600));
      window.requestAnimationFrame = raf;
      if (frames > 2) out.push(`interactive idle asked for ${frames} frames in 0.6 s`);
      h3.dispose();
    });
    await step('cancelled mount', async () => {
      const ac = new AbortController();
      const el = box(200, 200);
      const p = drawBody(el, v.data, v.options, { theme: t, asset, reducedMotion: true, signal: ac.signal });
      ac.abort();
      try { const h = await within(p); h.dispose?.(); out.push('a cancelled mount resolved'); } catch (e) { if (e.name !== 'AbortError') out.push(`a cancelled mount threw ${e.name}: ${e.message}`); }
      if (el.children.length) out.push('a cancelled mount left elements behind');
    });
    await step('every body and layer draws', async () => {
      for (const body of ['man', 'woman', 'boy', 'girl']) {
        for (const [layer, region] of [['muscles', 'deltoid'], ['nerves', 'spinal-cord']]) {
          const s = validate({ component: 'body', data: { highlight: [{ region }] }, options: { body, labels: false } }).view; // framed on the region; a child's spinal cord is a few pixels wide at 200
          const el = box(320, 320);
          const h = await within(drawBody(el, s.data, s.options, { theme: t, asset, reducedMotion: true }));
          const lit = litIn(el.querySelector('canvas'));
          if (lit < 20) out.push(`${body} ${layer}: nothing lit (${lit} pixels)`);
          if (!/Z-Anatomy/.test(el.querySelector('.zc-body-credit').textContent)) out.push(`${body} ${layer}: the credit leaves out Z-Anatomy`);
          h.dispose();
        }
      }
    });
    await step('layers load only when drawn', async () => {
      const seen = [], real = window.fetch;
      window.fetch = (url, init) => { seen.push(String(url)); return real(url, init); };
      try {
        const el = box(200, 200);
        const h = await within(drawBody(el, v.data, v.options, { theme: t, asset, reducedMotion: true }));
        if (seen.some((u) => u.includes('/body-za/'))) out.push(`an organs picture fetched a share-alike layer: ${seen.join(', ')}`);
        if (/Z-Anatomy/.test(el.querySelector('.zc-body-credit').textContent)) out.push('an organs picture credits Z-Anatomy');
        h.dispose();
      } finally { window.fetch = real; }
    });
    await step('a related muscle shows whole, not its edge', async () => {
      // The man's muscles from the front, three ways: the quadriceps not lit, lit as the focus (solid), lit as
      // related (a veil). The veil must change about as much of the picture as the solid colour does: drawn
      // under the layer's rest, only the outer edge of the thigh changed (0.59 of it; 0.93 drawn over).
      const pixels = async (highlight) => {
        const s = validate({ component: 'body', data: { highlight }, options: { body: 'man', frame: 'body', view: 'front', labels: false } }).view;
        const el = box(320, 320);
        const h = await within(drawBody(el, s.data, s.options, { theme: t, asset, reducedMotion: true }));
        const c = el.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice();
        h.dispose(); el.remove();
        return d;
      };
      const base = await pixels([{ region: 'deltoid', side: 'left' }]);
      const changed = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - base[i]) + Math.abs(d[i + 1] - base[i + 1]) + Math.abs(d[i + 2] - base[i + 2]) > 24) n++; return n; };
      const solid = changed(await pixels([{ region: 'deltoid', side: 'left' }, { region: 'quadriceps' }]));
      const veil = changed(await pixels([{ region: 'deltoid', side: 'left' }, { region: 'quadriceps', role: 'related' }]));
      if (solid < 200) out.push(`the lit quadriceps changed only ${solid} pixels`);
      else if (veil < 0.8 * solid) out.push(`a related quadriceps shows ${veil} of the ${solid} pixels a lit one does: drawn under the rest`);
    });
    await step('failed load', async () => {
      const bad = box(200, 200);
      try { await within(drawBody(bad, v.data, v.options, { theme: t, asset: () => '/assets/body/none.glb', reducedMotion: true })); out.push('a failed load resolved'); } catch { /* expected */ }
      const status = bad.querySelector('[role=status]');
      if (!status || status.getAttribute('aria-label') === 'Loading the body') out.push('the failure kept the loading label');
      if (bad.querySelector('canvas')) out.push('the failure left a canvas');
    });
    return out;
  })]);
  await context.close();
  return problems;
}

/**
 * A draft's smoke check, in the page that drew it: something lit in the focus colour (or pain's, if
 * nothing is the focus) on the screenshot, and every visible label inside the stage. Returns a
 * problem, or null.
 */
export async function smoke(page, png, fixture, mode) {
  const roles = (fixture.spec.data.highlight ?? []).map((h) => h.role ?? 'focus');
  return page.evaluate(async ({ png, roles, mode, host }) => {
    const { theme } = await import('/dist/index.js');
    const t = theme(host, mode);
    const want = roles.includes('focus') ? t.accent : roles.includes('pain') ? t.down : t.soft;
    const rgb = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16));
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < 90) lit++;
    if (lit < 200) return `only ${lit} pixels near ${want}: nothing lit`;
    const stage = document.querySelector('.zc-body-stage')?.getBoundingClientRect();
    if (!stage) return 'no stage';
    for (const el of document.querySelectorAll('.zc-body-label:not([hidden]), .zc-body-key:not([hidden])')) {
      const r = el.getBoundingClientRect();
      if (r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1) return `a label is off the stage (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})`;
    }
    for (const el of document.querySelectorAll('.zc-body-lines circle')) if (el.getAttribute('visibility') !== 'hidden' && [el.getAttribute('cx'), el.getAttribute('cy')].some((v) => !Number.isFinite(Number(v)))) return 'a leader has no position';
    return null;
  }, { png: png.toString('base64'), roles, mode, host: fixture.host });
}

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
    // A draft has no references yet (tools/check.mjs asks for none), but it is still drawn: every one of
    // its fixtures must draw without an error, light something in its focus colour, and keep its labels on screen.
    const drafts = new Set((await components(REPO)).filter((c) => c.status === 'draft').map((c) => c.id));
    for (const fx of await webFixtures(REPO)) {
      if (only && fx.component !== only) continue;
      if (drafts.has(fx.component)) {
        if (!verify) { console.log(`skip ${fx.path}  (draft: no reference)`); continue; }
        const fixture = JSON.parse(await readFile(join(REPO, fx.path), 'utf8'));
        for (const mode of ['light', 'dark']) {
          let problem = null;
          try {
            const { png, page, context, errors } = await shoot(browser, origin, fx.path, fixture, mode);
            problem = errors.length ? `page errors: ${errors.join(' | ')}` : await smoke(page, png, fixture, mode);
            await context.close();
          } catch (error) { problem = String(error.message || error).split('\n')[0]; }
          if (problem) failed++;
          console.log(`${problem ? 'FAIL' : 'ok  '} ${fx.path} (${mode}, draft smoke)${problem ? `  ${problem}` : ''}`);
        }
        continue;
      }
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
    if (verify && (!only || only === 'body')) {
      const problems = await bodyRuntime(browser, origin);
      for (const p of problems) console.log(`FAIL body runtime: ${p}`);
      if (!problems.length) console.log('ok   body runtime (stills hold no context, hidden mount, resize, idle, cancel, failure)');
      failed += problems.length;
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
