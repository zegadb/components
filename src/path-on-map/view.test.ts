import { test } from "node:test";
import assert from "node:assert/strict";
import type { Map as MapLibreMap } from "maplibre-gl";
import { validate } from "../index.ts";
import { theme } from "../theme.ts";
import { drawPaths, VIEW_TOGGLE_WORDS, type DrawContext } from "./draw.ts";
import { FLAT_MAX_KM, framedDiagonalKm, MEASURES, PATH_LAYERS, plainStyle, type LonLat } from "./model.ts";

// A walk in downtown Toronto (Union Station to City Hall, about 1 km) and a drive to Kitchener
// (about 90 km corner to corner): a short route and a long one.
const walk: LonLat[] = [[-79.3806, 43.6453], [-79.3797, 43.6478], [-79.3826, 43.6524]];
const intercity: LonLat[] = [[-79.3806, 43.6453], [-79.548, 43.618], [-79.69, 43.65], [-80.0, 43.48], [-80.49, 43.45]];
const spec = (points: LonLat[], options: Record<string, unknown> = {}) => ({ component: "path-on-map", data: { paths: [{ label: "route", points }] }, options });

/** The camera validate() resolves to: the view's own options, and the paths the renderer is handed. */
function resolved(s: unknown) {
  const v = validate(s);
  if (!v.ok || v.view.component !== "path-on-map") throw new Error(JSON.stringify(v));
  assert.equal(v.view.options.view, v.view.paths.options.view, "the view and the paths it draws carry the same camera");
  return v.view.paths.options.view;
}

/** Just enough DOM for the switch: elements with attributes, children, click listeners. */
class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  private readonly attrs = new Map<string, string>();
  private readonly clicks: (() => void)[] = [];
  readonly tagName: string;
  readonly ownerDocument: unknown;
  constructor(tagName: string, ownerDocument: unknown) { this.tagName = tagName; this.ownerDocument = ownerDocument; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  appendChild(c: FakeElement) { c.parent = this; this.children.push(c); return c; }
  append(...cs: FakeElement[]) { for (const c of cs) this.appendChild(c); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  addEventListener(type: string, fn: () => void) { if (type === "click") this.clicks.push(fn); }
  click() { for (const fn of this.clicks) fn(); }
  querySelector() { return null; }
  get style() { return { setProperty() {} }; }
  /** Every element under this one with the class `cls`. */
  find(cls: string): FakeElement[] { return this.children.flatMap((c) => [...(c.className === cls ? [c] : []), ...c.find(cls)]); }
}

/** A MapLibre map's part drawPaths touches, recording the camera and the buildings' opacity. */
function fakeMap({ interactive = true, basemap = true } = {}) {
  const t = theme("ava", "light");
  const style = plainStyle(t);
  const layers = [...style.layers];
  const sources = new Map<string, unknown>(basemap ? [["basemap", {}]] : []);
  const doc = { createElement: (tag: string) => new FakeElement(tag, doc) };
  const container = Object.assign(new FakeElement("div", doc), { clientWidth: 640, clientHeight: 400 });
  const paint = new Map<string, unknown>();
  const camera = { pitch: undefined as number | undefined, eased: 0, jumped: 0, centreOrZoomMoved: false, fetched: 0 };
  const map = {
    getStyle: () => ({ ...style, layers: [...layers] }),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => { camera.fetched++; sources.set(id, s); },
    removeSource: (id: string) => void sources.delete(id),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (l: (typeof layers)[number] & { paint?: Record<string, unknown> }) => {
      layers.push(l);
      if (l.id === PATH_LAYERS.buildings) paint.set("buildings", l.paint?.["fill-extrusion-opacity"]);
    },
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    setPaintProperty: (id: string, k: string, v: unknown) => { if (id === PATH_LAYERS.buildings && k === "fill-extrusion-opacity") paint.set("buildings", v); },
    getContainer: () => container,
    dragPan: { isEnabled: () => interactive },
    jumpTo: (c: { pitch?: number; center?: unknown; zoom?: unknown }) => { camera.jumped++; if (c.pitch !== undefined) camera.pitch = c.pitch; if (camera.jumped > 1 && (c.center || c.zoom !== undefined)) camera.centreOrZoomMoved = true; },
    easeTo: (c: { pitch?: number; center?: unknown; zoom?: unknown; duration?: number }) => { camera.eased++; camera.pitch = c.pitch; if (c.center || c.zoom !== undefined) camera.centreOrZoomMoved = true; },
  } as unknown as MapLibreMap;
  const draw = (points: LonLat[], options: Record<string, unknown> = {}, context: Partial<DrawContext> = {}) => drawPaths(map, { paths: [{ label: "route", points }], options }, { theme: t, ...context });
  const toggle = () => container.find("zc-view-toggle")[0];
  const pressed = () => toggle()?.children.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const button = (word: "2D" | "3D") => toggle()!.children.find((b) => b.textContent === word)!;
  return { map, container, paint, camera, draw, toggle, pressed, button };
}

/** The pitch drawPaths puts the host's map at. */
function drawnPitch(points: LonLat[], options: Record<string, unknown> = {}) {
  const m = fakeMap();
  m.draw(points, options);
  return m.camera.pitch;
}

test("path-on-map: with no view, every map opens in 3D, a short route as a long one", () => {
  assert.ok(framedDiagonalKm(walk, null) < 2, "the walk is short");
  assert.ok(framedDiagonalKm(intercity, null) > 50, "the drive is long");
  assert.equal(resolved(spec(walk)), "3d");
  assert.equal(resolved(spec(intercity)), "3d");
  assert.equal(drawnPitch(walk), MEASURES.pitch3d);
  assert.equal(drawnPitch(intercity), MEASURES.pitch3d);
  // And the buildings stand.
  const m = fakeMap();
  m.draw(walk);
  assert.equal(m.paint.get("buildings"), MEASURES.buildingsOpacity);
});

test("path-on-map: an explicit view wins, and 2d lays the buildings flat", () => {
  assert.equal(resolved(spec(walk, { view: "2d" })), "2d");
  assert.equal(resolved(spec(intercity, { view: "3d" })), "3d");
  assert.equal(drawnPitch(walk, { view: "2d" }), 0);
  assert.equal(drawnPitch(intercity, { view: "2d" }), 0);
  const m = fakeMap();
  m.draw(walk, { view: "2d" });
  assert.equal(m.paint.get("buildings"), 0, "from above, no building leans over the streets' names");
  const n = fakeMap();
  n.draw(walk, { view: "3d", showBuildings: false });
  assert.equal(n.paint.get("buildings"), 0, "showBuildings: false keeps them flat in 3d too");
});

test("path-on-map: auto is still accepted: a short route flat, a long one tilted, at FLAT_MAX_KM corner to corner", () => {
  assert.equal(resolved(spec(walk, { view: "auto" })), "2d");
  assert.equal(resolved(spec(intercity, { view: "auto" })), "3d");
  // Due north from Union Station: 1° of latitude is 111.2 km, so the span is d km at d / 111.2°.
  const north = (km: number): LonLat[] => [[-79.38, 43.6], [-79.38, 43.6 + km / 111.195]];
  assert.ok(Math.abs(framedDiagonalKm(north(10), null) - 10) < 0.01);
  assert.equal(resolved(spec(north(FLAT_MAX_KM - 0.05), { view: "auto" })), "2d");
  assert.equal(resolved(spec(north(FLAT_MAX_KM + 0.05), { view: "auto" })), "3d");
  // A short route framed in wide bounds is framed wide: tilted.
  assert.equal(resolved(spec(walk, { view: "auto", bounds: [-80.5, 43.4, -79.3, 43.8] })), "3d");
});

test("path-on-map: the 2D | 3D switch flips the pitch, the buildings and aria-pressed, keeping centre and zoom", () => {
  const m = fakeMap();
  const drawn = m.draw(walk, {}, { reducedMotion: false });
  assert.ok(m.toggle(), "an interactive map gets the switch");
  assert.equal(m.toggle()!.getAttribute("role"), "group");
  assert.equal(m.toggle()!.getAttribute("aria-label"), VIEW_TOGGLE_WORDS.en.group);
  assert.deepEqual(m.toggle()!.children.map((b) => [b.tagName, b.type, b.textContent]), [["button", "button", "2D"], ["button", "button", "3D"]], "two native buttons: focusable, Enter and Space press them");
  assert.deepEqual(m.pressed(), ["3D"]);
  const fetched = m.camera.fetched;

  m.button("2D").click();
  assert.deepEqual(m.pressed(), ["2D"]);
  assert.equal(m.button("3D").getAttribute("aria-pressed"), "false");
  assert.equal(m.camera.pitch, 0);
  assert.equal(m.camera.eased, 1, "the pitch eases");
  assert.equal(m.paint.get("buildings"), 0);
  assert.equal(drawn.view, "2d");

  m.button("2D").click();
  assert.equal(m.camera.eased, 1, "pressing the view shown does nothing");

  m.button("3D").click();
  assert.deepEqual(m.pressed(), ["3D"]);
  assert.equal(m.camera.pitch, MEASURES.pitch3d);
  assert.equal(m.paint.get("buildings"), MEASURES.buildingsOpacity);
  assert.equal(m.camera.centreOrZoomMoved, false, "the centre and zoom stay");
  assert.equal(m.camera.fetched, fetched, "nothing is fetched again");

  // With reduced motion it jumps; and the host can switch it (drawn.setView), the buttons following.
  const r = fakeMap();
  const d = r.draw(walk, {}, { reducedMotion: true });
  d.setView("2d");
  assert.equal(r.camera.eased, 0);
  assert.equal(r.camera.pitch, 0);
  assert.deepEqual(r.pressed(), ["2D"]);
});

test("path-on-map: a redraw that keeps the camera keeps the view switched to; drawing anew starts on the paths' own", () => {
  const m = fakeMap();
  m.draw(walk);
  m.button("2D").click();
  // A theme change or the plain fallback: a new style, the paths drawn again with frame: false.
  const again = m.draw(walk, {}, { frame: false });
  assert.equal(again.view, "2d");
  assert.deepEqual(m.pressed(), ["2D"]);
  assert.equal(m.paint.get("buildings"), 0);
  assert.equal(m.container.find("zc-view-toggle").length, 1, "one switch, not one per draw");
  const fresh = m.draw(walk);
  assert.equal(fresh.view, "3d");
  assert.deepEqual(m.pressed(), ["3D"]);
});

test("path-on-map: a still map has no switch, and a host can place its own", () => {
  const still = fakeMap({ interactive: false });
  still.draw(walk);
  assert.equal(still.toggle(), undefined, "interactive: false (a still) draws no controls");
  assert.equal(still.camera.pitch, MEASURES.pitch3d, "but opens in 3D");
  const host = fakeMap();
  host.draw(walk, {}, { controls: false });
  assert.equal(host.toggle(), undefined, "controls: false leaves the switch to the host");
  const forced = fakeMap({ interactive: false });
  forced.draw(walk, {}, { controls: true });
  assert.ok(forced.toggle());
  const fr = fakeMap();
  fr.draw(walk, {}, { locale: "fr" });
  assert.equal(fr.toggle()!.getAttribute("aria-label"), "Vue de la carte");
  assert.deepEqual(fr.toggle()!.children.map((b) => b.textContent), ["2D", "3D"]);
  assert.equal(fr.button("2D").title, VIEW_TOGGLE_WORDS.fr["2d"]);
});
