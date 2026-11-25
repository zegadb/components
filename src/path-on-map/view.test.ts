import { test } from "node:test";
import assert from "node:assert/strict";
import type { Map as MapLibreMap } from "maplibre-gl";
import { validate } from "../index.ts";
import { theme } from "../theme.ts";
import { creditHtml, ESA_WORLDCOVER_2021 } from "../basemaps.ts";
import { IMAGERY_LAYERS, IMAGERY_MAX_ZOOM, MAP_TYPE_STATE } from "../imagery.ts";
import { CAP_NOTE_MS, COMPACT_CREDIT_BELOW, drawPaths, IMAGERY_CAP_WORDS, IMAGERY_CREDIT_WORDS, MAP_TYPE_TOGGLE_WORDS, VIEW_TOGGLE_WORDS, type DrawContext } from "./draw.ts";
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
  id = "";
  textContent = "";
  innerHTML = "";
  hidden = false;
  title = "";
  type = "";
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, ((e?: unknown) => void)[]>();
  readonly tagName: string;
  readonly ownerDocument: unknown;
  constructor(tagName: string, ownerDocument: unknown) { this.tagName = tagName; this.ownerDocument = ownerDocument; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  appendChild(c: FakeElement) { c.parent = this; this.children.push(c); return c; }
  append(...cs: FakeElement[]) { for (const c of cs) this.appendChild(c); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  addEventListener(type: string, fn: (e?: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (e?: unknown) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  /** Fires `type` at this element's listeners, as the browser would. */
  dispatch(type: string, e: unknown = {}) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  listening(type: string) { return (this.listeners.get(type) ?? []).length; }
  click() { this.dispatch("click"); }
  querySelector() { return null; }
  get style() { return { setProperty() {} }; }
  /** Every element under this one with the class `cls`. */
  find(cls: string): FakeElement[] { return this.children.flatMap((c) => [...(c.className === cls ? [c] : []), ...c.find(cls)]); }
}

/** A MapLibre map's part drawPaths touches, recording the camera and the buildings' opacity. */
function fakeMap({ interactive = true, basemap = true, imagery = false } = {}) {
  const t = theme("ava", "light");
  const style = plainStyle(t);
  const layers = [...style.layers, ...(imagery ? Object.values(IMAGERY_LAYERS).map((id) => ({ id, type: "raster" as const, source: id, layout: { visibility: "none" } })) : [])] as (typeof style.layers)[number][];
  /** What the map shows: each imagery layer's visibility, and the style's global state. */
  const shown = { visibility: new Map<string, string>(), state: new Map<string, unknown>() };
  const sources = new Map<string, unknown>(basemap ? [["basemap", {}]] : []);
  const doc = { createElement: (tag: string) => new FakeElement(tag, doc) };
  const container = Object.assign(new FakeElement("div", doc), { clientWidth: 640, clientHeight: 400 });
  /** MapLibre's resize listeners: `resize(width)` is the map's container changing size. */
  const resized: (() => void)[] = [];
  const resize = (width: number) => { container.clientWidth = width; for (const fn of [...resized]) fn(); };
  const paint = new Map<string, unknown>();
  const camera = { pitch: undefined as number | undefined, eased: 0, jumped: 0, centreOrZoomMoved: false, fetched: 0, zoom: 10, maxZoom: 17 };
  const once = new Map<string, (() => void)[]>();
  /** The end of an eased move: MapLibre's moveend. */
  const settle = () => { const fns = once.get("moveend") ?? []; once.delete("moveend"); for (const fn of fns) fn(); };
  const map = {
    getStyle: () => ({ ...style, layers: [...layers], ...(imagery ? { metadata: { [IMAGERY_MAX_ZOOM]: ESA_WORLDCOVER_2021.maxViewZoom } } : {}) }),
    getZoom: () => camera.zoom,
    getMaxZoom: () => camera.maxZoom,
    setMaxZoom: (z: number) => { camera.maxZoom = z; camera.zoom = Math.min(camera.zoom, z); },
    once: (type: string, fn: () => void) => void once.set(type, [...(once.get(type) ?? []), fn]),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => { camera.fetched++; sources.set(id, s); },
    removeSource: (id: string) => void sources.delete(id),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (l: (typeof layers)[number] & { paint?: Record<string, unknown> }) => {
      layers.push(l);
      // A layer added anew is drawn as its own layout says (visible unless it says none).
      shown.visibility.delete(l.id);
      if (l.id === PATH_LAYERS.buildings) paint.set("buildings", l.paint?.["fill-extrusion-opacity"]);
    },
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    setPaintProperty: (id: string, k: string, v: unknown) => { if (id === PATH_LAYERS.buildings && k === "fill-extrusion-opacity") paint.set("buildings", v); },
    setLayoutProperty: (id: string, k: string, v: string) => { if (k === "visibility") shown.visibility.set(id, v); },
    setGlobalStateProperty: (k: string, v: unknown) => void shown.state.set(k, v),
    getContainer: () => container,
    on: (type: string, fn: () => void) => { if (type === "resize") resized.push(fn); },
    off: (type: string, fn: () => void) => { if (type === "resize") resized.splice(resized.indexOf(fn), 1); },
    dragPan: { isEnabled: () => interactive },
    jumpTo: (c: { pitch?: number; center?: unknown; zoom?: unknown }) => { camera.jumped++; if (c.pitch !== undefined) camera.pitch = c.pitch; if (camera.jumped > 1 && (c.center || c.zoom !== undefined)) camera.centreOrZoomMoved = true; },
    easeTo: (c: { pitch?: number; center?: unknown; zoom?: number; duration?: number }) => { camera.eased++; if (c.pitch !== undefined) camera.pitch = c.pitch; if (c.zoom !== undefined) camera.zoom = c.zoom; if (c.center || c.zoom !== undefined) camera.centreOrZoomMoved = true; },
  } as unknown as MapLibreMap;
  const draw = (points: LonLat[], options: Record<string, unknown> = {}, context: Partial<DrawContext> = {}) => drawPaths(map, { paths: [{ label: "route", points }], options }, { theme: t, ...context });
  const toggle = () => container.find("zc-view-toggle")[0];
  const pressed = () => toggle()?.children.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const button = (word: "2D" | "3D") => toggle()!.children.find((b) => b.textContent === word)!;
  const typeToggle = () => container.find("zc-map-type-toggle")[0];
  const typeButton = (word: string) => typeToggle()!.children.find((b) => b.textContent === word)!;
  const typePressed = () => typeToggle()?.children.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const credit = () => container.find("zc-imagery-credit")[0];
  /** Whether the imagery is on the map: every imagery layer visible and the state saying so (both or neither). */
  const satellite = () => {
    const visible = Object.values(IMAGERY_LAYERS).map((id) => shown.visibility.get(id) === "visible");
    const state = shown.state.get(MAP_TYPE_STATE) === "satellite";
    assert.ok(visible.every((v) => v === state), `layers ${visible} agree with the state ${String(shown.state.get(MAP_TYPE_STATE))}`);
    return state;
  };
  const creditText = () => credit()?.find("zc-imagery-credit-text")[0]?.innerHTML;
  const creditButton = () => credit()!.find("zc-imagery-credit-toggle")[0]!;
  const note = () => container.find("zc-imagery-cap-note")[0];
  /** Whether the extruded buildings are drawn: the layer not hidden, and standing (opacity over 0). */
  const buildingsDrawn = () => shown.visibility.get(PATH_LAYERS.buildings) !== "none" && Number(paint.get("buildings")) > 0;
  return { map, container, paint, camera, settle, note, buildingsDrawn, draw, toggle, pressed, button, typeToggle, typeButton, typePressed, credit, creditText, creditButton, satellite, resize, resized };
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

test("path-on-map: Map | Satellite beside 2D | 3D shows the imagery and its credit, and takes both away", () => {
  const m = fakeMap({ imagery: true });
  const drawn = m.draw(walk, {}, { reducedMotion: false });
  const controls = m.container.find("zc-map-controls")[0]!;
  assert.deepEqual(controls.children.map((c) => c.className), ["zc-map-type-toggle", "zc-view-toggle"], "one box of controls: Map | Satellite, then 2D | 3D");
  assert.equal(m.typeToggle()!.getAttribute("role"), "group");
  assert.equal(m.typeToggle()!.getAttribute("aria-label"), MAP_TYPE_TOGGLE_WORDS.en.group);
  assert.deepEqual(m.typeToggle()!.children.map((b) => [b.tagName, b.type, b.textContent]), [["button", "button", "Map"], ["button", "button", "Satellite"]]);
  // Opens on the street map: no imagery, no credit.
  assert.deepEqual(m.typePressed(), ["Map"]);
  assert.equal(m.satellite(), false);
  assert.equal(m.credit()!.hidden, true);
  assert.equal(drawn.mapType, "map");
  const fetched = m.camera.fetched;
  const jumped = m.camera.jumped;

  m.typeButton("Satellite").click();
  assert.deepEqual(m.typePressed(), ["Satellite"]);
  assert.equal(m.satellite(), true);
  assert.equal(m.credit()!.hidden, false, "the credit shows with the imagery");
  assert.equal(m.creditText(), creditHtml(ESA_WORLDCOVER_2021.credit.en));
  assert.equal(m.credit()!.dataset.compact, "false", "a 640-px map: the full line");
  assert.match(m.creditText()!, /© ESA WorldCover project 2021<\/a> \/ contains modified Copernicus Sentinel data/);
  assert.equal(drawn.mapType, "satellite");
  assert.deepEqual(m.pressed(), ["3D"], "the view is not touched");

  m.typeButton("Map").click();
  assert.equal(m.satellite(), false);
  assert.equal(m.credit()!.hidden, true, "and goes with it");
  assert.equal(m.camera.fetched, fetched, "no source is added again");
  assert.equal(m.camera.jumped + m.camera.eased, jumped, "the camera stays");

  // The host switches it too (drawn.setMapType), the buttons following.
  drawn.setMapType("satellite");
  assert.deepEqual(m.typePressed(), ["Satellite"]);
  assert.equal(m.satellite(), true);
  assert.equal(m.credit()!.hidden, false);
});

test("path-on-map: mapType satellite opens on the imagery; a redraw keeps the type switched to; no imagery, no switch", () => {
  assert.equal((validate(spec(walk)) as { view: { paths: { options: { mapType: string } } } }).view.paths.options.mapType, "map", "the default");
  const m = fakeMap({ imagery: true });
  m.draw(walk, { mapType: "satellite" });
  assert.equal(m.satellite(), true);
  assert.deepEqual(m.typePressed(), ["Satellite"]);
  assert.equal(m.credit()!.hidden, false);
  m.typeButton("Map").click();
  const again = m.draw(walk, { mapType: "satellite" }, { frame: false });
  assert.equal(again.mapType, "map", "a theme change keeps the reader's choice");
  assert.equal(m.satellite(), false);
  assert.equal(m.container.find("zc-map-type-toggle").length, 1, "one switch, not one per draw");
  assert.equal(m.container.find("zc-imagery-credit").length, 1);

  // A basemap without imagery: no switch, no credit, and mapType satellite draws the street map.
  const plain = fakeMap();
  const d = plain.draw(walk, { mapType: "satellite" });
  assert.equal(plain.typeToggle(), undefined);
  assert.equal(plain.credit(), undefined);
  assert.equal(d.mapType, "map");
  assert.ok(plain.toggle(), "the 2D | 3D switch is still there");

  // A still has neither; a host with its own controls places mapTypeToggle and says the credit.
  const still = fakeMap({ imagery: true, interactive: false });
  still.draw(walk, { mapType: "satellite" });
  assert.equal(still.typeToggle(), undefined);
  assert.equal(still.credit(), undefined);
  assert.equal(still.satellite(), true, "but shows the imagery it was asked for");

  const fr = fakeMap({ imagery: true });
  fr.draw(walk, {}, { locale: "fr" });
  assert.equal(fr.typeToggle()!.getAttribute("aria-label"), "Type de carte");
  assert.deepEqual(fr.typeToggle()!.children.map((b) => [b.textContent, b.title]), [["Carte", MAP_TYPE_TOGGLE_WORDS.fr.hint.map], ["Satellite", MAP_TYPE_TOGGLE_WORDS.fr.hint.satellite]]);
  assert.equal(fr.creditText(), creditHtml(ESA_WORLDCOVER_2021.credit.fr));
  assert.equal(fr.creditButton().getAttribute("aria-label"), IMAGERY_CREDIT_WORDS.fr.button);
});

test("path-on-map: on a narrow map the imagery credit is an ⓘ button that opens the full line; wide, the full line", () => {
  const m = fakeMap({ imagery: true });
  m.resize(358);
  m.draw(walk, { mapType: "satellite" });
  const box = m.credit()!;
  assert.equal(box.hidden, false);
  assert.equal(box.dataset.compact, "true", `under ${COMPACT_CREDIT_BELOW} px: compact`);
  assert.equal(box.dataset.open, "false", "closed: only the button (the line is hidden by components.css)");
  const b = m.creditButton();
  assert.deepEqual([b.tagName, b.type, b.textContent], ["button", "button", "ⓘ"], "a native button: focusable, Enter and Space press it");
  assert.equal(b.getAttribute("aria-label"), IMAGERY_CREDIT_WORDS.en.button);
  assert.equal(b.getAttribute("aria-controls"), box.find("zc-imagery-credit-text")[0]!.id);
  assert.equal(b.getAttribute("aria-expanded"), "false");
  assert.equal(m.creditText(), creditHtml(ESA_WORLDCOVER_2021.credit.en), "the full credit is there to open");
  b.click();
  assert.equal(box.dataset.open, "true");
  assert.equal(b.getAttribute("aria-expanded"), "true");
  b.click();
  assert.equal(box.dataset.open, "false");
  // A phone turned (the map resized): the full line; and back.
  m.resize(800);
  assert.equal(box.dataset.compact, "false");
  m.resize(390);
  assert.equal(box.dataset.compact, "true");
  // Drawn again: one listener, not one per draw; taken off with the drawing.
  m.draw(walk, { mapType: "satellite" }, { frame: false });
  assert.equal(m.resized.length, 1);
  m.draw(walk).remove();
  assert.equal(m.resized.length, 0);
});

test("path-on-map: satellite caps the map's zoom at the imagery's crisp limit; the map gives the old max back", () => {
  const cap = ESA_WORLDCOVER_2021.maxViewZoom;
  const m = fakeMap({ imagery: true });
  m.camera.zoom = 15.2;
  m.draw(walk, {}, { frame: false });
  assert.equal(m.camera.maxZoom, 17, "the street map: the map's own max zoom");
  m.typeButton("Satellite").click();
  assert.equal(m.camera.zoom, cap, "closer than the cap: eased out to it");
  assert.equal(m.camera.maxZoom, 17, "capped once the ease ends");
  m.settle();
  assert.equal(m.camera.maxZoom, cap);
  m.typeButton("Map").click();
  assert.equal(m.camera.maxZoom, 17, "back to the street map: the old max zoom");
  assert.equal(m.camera.zoom, cap, "and the camera where it was");
  // Already within the cap: capped at once, no move.
  const n = fakeMap({ imagery: true });
  n.camera.zoom = 11;
  n.draw(walk, { mapType: "satellite" }, { frame: false });
  assert.equal(n.camera.maxZoom, cap);
  assert.equal(n.camera.eased, 0);
  // Switched back to Map mid-ease: the cap never lands.
  const o = fakeMap({ imagery: true });
  o.camera.zoom = 16;
  o.draw(walk, {}, { frame: false });
  o.typeButton("Satellite").click();
  o.typeButton("Map").click();
  o.settle();
  assert.equal(o.camera.maxZoom, 17);
  // No imagery: the max zoom is never touched.
  const plain = fakeMap();
  plain.draw(walk, { mapType: "satellite" }, { frame: false });
  assert.equal(plain.camera.maxZoom, 17);
});

test("path-on-map: zooming past the satellite cap says so, politely, with a one-tap Map; then it fades", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cap = ESA_WORLDCOVER_2021.maxViewZoom;
  const m = fakeMap({ imagery: true });
  m.camera.zoom = 12;
  m.draw(walk, { mapType: "satellite" }, { frame: false });
  const note = m.note()!;
  assert.equal(note.getAttribute("role"), "status");
  assert.equal(note.getAttribute("aria-live"), "polite");
  assert.equal(note.dataset.shown, "false");
  const text = () => note.find("zc-imagery-cap-note-text")[0]!.textContent;
  const action = () => note.find("zc-imagery-cap-note-map")[0]!;
  // Below the cap a zoom in is a zoom in: no note.
  m.container.dispatch("wheel", { deltaY: -100 });
  assert.equal(note.dataset.shown, "false");
  m.camera.zoom = cap;
  m.container.dispatch("wheel", { deltaY: 100 });
  assert.equal(note.dataset.shown, "false", "zooming out is never past the cap");
  for (const [type, e] of [["wheel", { deltaY: -100 }], ["keydown", { key: "+" }], ["keydown", { key: "=" }], ["dblclick", {}]] as const) {
    m.container.dispatch(type, e);
    assert.equal(note.dataset.shown, "true", `${type} ${JSON.stringify(e)} at the cap`);
    assert.equal(text(), IMAGERY_CAP_WORDS.en.note);
    assert.deepEqual([action().tagName, action().type, action().textContent, action().hidden], ["button", "button", "Map", false]);
    t.mock.timers.tick(CAP_NOTE_MS);
    assert.equal(note.dataset.shown, "false", "faded");
    assert.equal(text(), "", "and emptied, so the next one is announced again");
  }
  // A gesture the map doesn't zoom with (Ava's chat has no scroll zoom) is no try.
  const scroll = { on: false };
  (m.map as unknown as { scrollZoom: { isEnabled(): boolean } }).scrollZoom = { isEnabled: () => scroll.on };
  m.container.dispatch("wheel", { deltaY: -100 });
  assert.equal(note.dataset.shown, "false", "no scroll zoom: a wheel is not a zoom");
  scroll.on = true;
  // A pinch out at the cap.
  const touches = (d: number) => ({ touches: [{ clientX: 0, clientY: 0 }, { clientX: d, clientY: 0 }] });
  m.container.dispatch("touchstart", touches(100));
  m.container.dispatch("touchmove", touches(150));
  assert.equal(note.dataset.shown, "true", "pinch");
  // Map, from the note: the street map, its button pressed, the old max zoom back, the note gone.
  action().click();
  assert.equal(m.satellite(), false);
  assert.deepEqual(m.typePressed(), ["Map"]);
  assert.equal(m.camera.maxZoom, 17);
  assert.equal(note.dataset.shown, "false");
  // On the street map at the same zoom: no note.
  m.container.dispatch("wheel", { deltaY: -100 });
  assert.equal(note.dataset.shown, "false");
  // French; and drawn again, one set of listeners; removed with the drawing.
  const fr = fakeMap({ imagery: true });
  fr.camera.zoom = cap;
  fr.draw(walk, { mapType: "satellite" }, { frame: false, locale: "fr" });
  fr.container.dispatch("keydown", { key: "+" });
  assert.equal(fr.note()!.find("zc-imagery-cap-note-text")[0]!.textContent, "Le détail satellite s’arrête ici");
  assert.equal(fr.note()!.find("zc-imagery-cap-note-map")[0]!.textContent, "Carte");
  fr.draw(walk, { mapType: "satellite" }, { frame: false });
  assert.equal(fr.container.listening("wheel"), 1);
  fr.draw(walk).remove();
  assert.equal(fr.container.listening("wheel"), 0);
  assert.equal(fr.note(), undefined);
});

test("path-on-map: satellite keeps the tilt but draws no extruded buildings; Map brings them back", () => {
  const m = fakeMap({ imagery: true });
  m.draw(walk, { view: "3d" }, { reducedMotion: true });
  assert.equal(m.camera.pitch, MEASURES.pitch3d);
  assert.equal(m.buildingsDrawn(), true, "3D on the street map: the buildings stand");
  m.typeButton("Satellite").click();
  assert.equal(m.buildingsDrawn(), false, "3D satellite: no grey boxes over the photograph");
  assert.equal(m.camera.pitch, MEASURES.pitch3d, "the tilt stays");
  // The 2D | 3D switch still tilts, and the buildings stay away while the imagery shows.
  m.button("2D").click();
  assert.equal(m.camera.pitch, 0);
  m.button("3D").click();
  assert.equal(m.camera.pitch, MEASURES.pitch3d);
  assert.equal(m.buildingsDrawn(), false);
  m.typeButton("Map").click();
  assert.equal(m.buildingsDrawn(), true, "the street map draws them again");
  // Opened on satellite: never drawn; a redraw that keeps the camera keeps them away.
  const n = fakeMap({ imagery: true });
  n.draw(walk, { view: "3d", mapType: "satellite" }, { reducedMotion: true });
  assert.equal(n.buildingsDrawn(), false);
  n.draw(walk, { view: "3d", mapType: "satellite" }, { frame: false });
  assert.equal(n.buildingsDrawn(), false);
  // No imagery: the buildings are the map's own business, as before.
  const plain = fakeMap();
  plain.draw(walk, { view: "3d", mapType: "satellite" });
  assert.equal(plain.buildingsDrawn(), true);
});
