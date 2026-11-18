// The web conformance harness's page: draws one web fixture, in one mode,
// with the built package (dist/), exactly as a host does (validate, render,
// toDom; for a map, the host's MapLibre and drawChecked), and marks the
// document ready when the frame is final. web.mjs screenshots #stage.
//
//   /tools/render/web.html?fixture=<path from the repo root>&mode=light|dark[&hover=<0–1>]
import { validate, render, theme, toDom, attachHover, pathOnMap } from '/dist/index.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'dark' ? 'dark' : 'light';
const stage = document.getElementById('stage');
const root = document.documentElement;
const frames = (n) => new Promise((resolve) => { const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });

async function main() {
  const path = params.get('fixture');
  const fixture = await (await fetch(`/${path}`)).json();
  const spec = structuredClone(fixture.spec);
  if (fixture.dataFile) spec.data = await (await fetch(`/${path.replace(/[^/]+$/, '')}${fixture.dataFile}`)).json();
  root.dataset.theme = mode;
  const t = theme(fixture.host, mode);
  document.body.style.background = t.ground;
  stage.dataset.zcHost = fixture.host;
  stage.style.width = `${fixture.size.width}px`;
  await document.fonts.load(`12px ${t.font.ui}`);
  await document.fonts.load(`600 12px ${t.font.ui}`);
  const checked = validate(spec);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const drawn = render(checked.view, { width: fixture.size.width, theme: t, id: 'fx' });
  if ('body' in drawn) {
    const { drawBody } = await import('/dist/body/draw.js');
    const box = document.createElement('div');
    box.style.height = `${drawn.height}px`;
    stage.appendChild(box);
    // &loading=1: the real loading state, drawBody waiting on a mesh that never comes (review screenshots only).
    if (params.get('loading')) {
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, init) => (String(url).includes('/never/') ? new Promise(() => {}) : realFetch(url, init));
      drawBody(box, checked.view.data, checked.view.options, { theme: t, asset: (body) => `/never/${body}.glb`, locale: fixture.locale ?? 'en', reducedMotion: true });
      await frames(3);
      root.dataset.ready = '1';
      return;
    }
    await drawBody(box, checked.view.data, checked.view.options, { theme: t, asset: (body) => `/assets/body/${body}.glb`,locale: fixture.locale ?? 'en', reducedMotion: true });
    await frames(3);
  } else if ('map' in drawn) {
    const { default: maplibregl } = await import('/node_modules/maplibre-gl/dist/maplibre-gl.mjs').then((m) => ({ default: m.default ?? m }));
    maplibregl.setWorkerUrl('/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
    const { drawChecked } = await import('/dist/path-on-map/draw.js');
    const box = document.createElement('div');
    box.className = 'map';
    box.style.height = `${drawn.height}px`;
    stage.appendChild(box);
    const map = new maplibregl.Map({ container: box, style: pathOnMap.plainStyle(t), interactive: false, attributionControl: false, fadeDuration: 0, maxPitch: 70, preserveDrawingBuffer: true });
    await new Promise((resolve) => map.once('load', resolve));
    drawChecked(map, checked.view.paths, { theme: t, Marker: maplibregl.Marker });
    await new Promise((resolve) => map.once('idle', resolve));
    await frames(3);
  } else {
    const svg = toDom(drawn.svg, document);
    stage.appendChild(svg);
    const at = params.get('hover');
    if (at !== null && drawn.hover) {
      attachHover(svg, drawn.hover, t);
      const box = svg.getBoundingClientRect();
      const col = drawn.hover.columns[Math.round(Number(at) * (drawn.hover.columns.length - 1))];
      svg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + col.x, clientY: box.top + drawn.hover.plot.y + 10, bubbles: true }));
    }
    await frames(2);
  }
  root.dataset.ready = '1';
}

main().catch((error) => { root.dataset.error = String(error?.stack || error); });
