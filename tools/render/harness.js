// The web reference renderer's page: draws one fixture, in one theme, with
// the zegadb/zega web implementation served at `/`, and marks the document
// ready when the frame is final. render.mjs screenshots #stage.
//
//   /__ref/harness.html?fixture=<path under /__repo/>&theme=light|dark
//
// Each adapter maps a fixture (a view spec plus its result) onto the web
// implementation's own entry point, and nothing else: no styling, no
// geometry, no colour decisions live here.
import { applyTheme } from '/theme.js';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const fixturePath = params.get('fixture');
const stage = document.getElementById('stage');

const frames = (n) => new Promise((resolve) => {
  const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});
const mapIdle = (map) => new Promise((resolve) => {
  if (map.loaded() && !map.isMoving()) resolve();
  else map.once('idle', resolve);
});

const ADAPTERS = {
  // The graph-component canvas (browser/components/canvas.js) with a memory
  // store: load the spec against the result, wait for the surface to settle.
  async 'path-on-map'(fixture, result) {
    const { createCanvas } = await import('/components/canvas.js');
    const { memoryStore } = await import('/components/storage.js');
    const canvas = createCanvas(stage, { theme, store: memoryStore(), onError: (error) => { throw error; } });
    await canvas.ready;
    await canvas.load(fixture.spec, result);
    await canvas.idle();
    await frames(3);
    await canvas.idle();
  },

  // The explorer's globe (browser/globe.js + arcs.js). Not yet on the
  // component canvas: the adapter turns the fixture's groups and rows into
  // the globe's places and relationships, and its settings (the contract's
  // defaults under the spec's values) into the globe's camera and settings.
  async 'globe-arcs'(fixture, result, contract) {
    const { spec } = fixture;
    const settings = (declared, given = {}) => Object.fromEntries(Object.entries(declared).map(([k, d]) => [k, Object.hasOwn(given, k) ? given[k] : d.default]));
    const options = settings(contract.options, spec.options);
    const surface = settings(contract.surfaceParams, spec.surface);
    localStorage.setItem('zega.browser.globe', JSON.stringify({ lift: options.lift, spin: options.spin, edges: options.edges }));
    const { renderGlobe } = await import('/globe.js');
    const pick = (value, path) => (path === '.' ? value : path.split('.').reduce((v, key) => (v == null ? v : v[key]), value));
    const places = new Map();
    const place = (at) => {
      const key = `${at.lon},${at.lat}`;
      if (!places.has(key)) places.set(key, { node: { id: `p${places.size}` }, lat: at.lat, lon: at.lon });
      return places.get(key).node.id;
    };
    const focus = new Set();
    const rels = [];
    for (const group of pick(result, spec.binding.groups)) {
      const from = place(pick(group, spec.binding.from));
      const focused = spec.binding.focus !== undefined && pick(group, spec.binding.focus) === true;
      for (const row of pick(group, spec.binding.rows)) {
        const rel = { id: `r${rels.length}`, from, to: place(pick(row, spec.binding.to)) };
        if (focused) focus.add(rel.id);
        rels.push(rel);
      }
    }
    const [lon, lat] = surface.center;
    const camera = { center: { lon, lat }, zoom: surface.zoom, tilt: surface.tilt };
    renderGlobe(stage, { countries: new Map(), codes: new Map(), places: [...places.values()], rels, focus: focus.size ? focus : null },
      camera, theme, () => {}, () => {});
    await stage._outlines;
    const map = stage._map;
    // The planet fit converges over a few renders; wait until two idles in a row leave the camera unchanged.
    let last = '';
    for (let i = 0; i < 20; i++) {
      await mapIdle(map);
      await frames(4);
      const now = JSON.stringify([map.getZoom(), map.getPadding(), map.getCenter()]);
      if (now === last) break;
      last = now;
    }
  },
};

try {
  const fixture = await (await fetch(`/__repo/${fixturePath}`)).json();
  applyTheme(theme);
  const size = fixture.size;
  stage.style.width = `${size.width}px`;
  stage.style.height = `${size.height}px`;
  const base = new URL(`/__repo/${fixturePath}`, location.href);
  const result = fixture.result ?? await (await fetch(new URL(fixture.resultFile, base))).json();
  const adapter = ADAPTERS[fixture.component];
  if (!adapter) throw new Error(`no web adapter for component ${fixture.component}`);
  const contract = await (await fetch(`/__repo/components/${fixture.component}/${fixture.component}.contract.json`)).json();
  await adapter(fixture, result, contract);
  document.documentElement.dataset.ready = 'true';
} catch (error) {
  document.documentElement.dataset.error = String(error?.stack || error);
  console.error(error);
}
