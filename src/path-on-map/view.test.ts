import { test } from "node:test";
import assert from "node:assert/strict";
import type { Map as MapLibreMap } from "maplibre-gl";
import { validate } from "../index.ts";
import { theme } from "../theme.ts";
import { drawPaths } from "./draw.ts";
import { FLAT_MAX_KM, framedDiagonalKm, MEASURES, plainStyle, type LonLat } from "./model.ts";

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

/** The pitch drawPaths puts the host's map at. */
function drawnPitch(points: LonLat[], options: Record<string, unknown> = {}) {
  const t = theme("ava", "light");
  const style = plainStyle(t);
  const layers = [...style.layers];
  const sources = new Map<string, unknown>();
  const container = { querySelector: () => null, clientWidth: 640, clientHeight: 400, ownerDocument: {}, appendChild: () => {} };
  let pitch: number | undefined;
  const map = {
    getStyle: () => ({ ...style, layers: [...layers] }),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => void sources.set(id, s),
    removeSource: (id: string) => void sources.delete(id),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (l: (typeof layers)[number]) => void layers.push(l),
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    getContainer: () => container,
    jumpTo: (c: { pitch: number }) => void (pitch = c.pitch),
  } as unknown as MapLibreMap;
  drawPaths(map, { paths: [{ label: "route", points }], options }, { theme: t });
  return pitch;
}

test("path-on-map: with no view, a short route is drawn from straight above and a long one tilted", () => {
  assert.ok(framedDiagonalKm(walk, null) < 2, "the walk is short");
  assert.ok(framedDiagonalKm(intercity, null) > 50, "the drive is long");
  assert.equal(resolved(spec(walk)), "2d");
  assert.equal(resolved(spec(intercity)), "3d");
  assert.equal(resolved(spec(walk, { view: "auto" })), "2d");
  assert.equal(drawnPitch(walk), 0);
  assert.equal(drawnPitch(intercity), MEASURES.pitch3d);
});

test("path-on-map: an explicit view wins over the route's length", () => {
  assert.equal(resolved(spec(walk, { view: "3d" })), "3d");
  assert.equal(resolved(spec(intercity, { view: "2d" })), "2d");
  assert.equal(drawnPitch(walk, { view: "3d" }), MEASURES.pitch3d);
  assert.equal(drawnPitch(intercity, { view: "2d" }), 0);
});

test("path-on-map: auto measures what is framed, and the threshold is FLAT_MAX_KM corner to corner", () => {
  // Due north from Union Station: 1° of latitude is 111.2 km, so the span is d km at d / 111.2°.
  const north = (km: number): LonLat[] => [[-79.38, 43.6], [-79.38, 43.6 + km / 111.195]];
  assert.ok(Math.abs(framedDiagonalKm(north(10), null) - 10) < 0.01);
  assert.equal(resolved(spec(north(FLAT_MAX_KM - 0.05))), "2d");
  assert.equal(resolved(spec(north(FLAT_MAX_KM + 0.05))), "3d");
  // A short route framed in wide bounds is framed wide: tilted.
  assert.equal(resolved(spec(walk, { bounds: [-80.5, 43.4, -79.3, 43.8] })), "3d");
});
