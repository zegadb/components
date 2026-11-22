import { test } from "node:test";
import assert from "node:assert/strict";
import { latest, normalizePropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import { layers } from "@protomaps/basemaps";
import { AVA_BASEMAP, BASEMAP_SOURCE, basemapFlavor, basemapStyle, creditHtml, ESA_WORLDCOVER_2021, IMAGERY_LAYERS, IMAGERY_SOURCES, MAP_TYPE_STATE, OVER_IMAGERY, withImagery } from "./basemap.ts";
import { theme } from "./theme.ts";

test("ava's basemap reads ava's tiles host, and only it", () => {
  for (const mode of ["light", "dark"] as const) {
    const s = basemapStyle("ava", mode);
    const source = s.sources[BASEMAP_SOURCE];
    assert.ok(source && source.type === "vector");
    assert.deepEqual(source.tiles, ["https://tiles.addis.gg/world/{z}/{x}/{y}.mvt"]);
    assert.equal(source.maxzoom, 15);
    assert.equal(s.glyphs, "https://tiles.addis.gg/fonts/{fontstack}/{range}.pbf");
    assert.equal(s.sprite, `https://tiles.addis.gg/sprites/v4/${mode}`);
    // Every URL in the style is on the one origin a host's CSP allows.
    const urls = JSON.stringify(s).match(/https?:\/\/[^"/]+/g) ?? [];
    assert.ok(urls.length >= 3);
    for (const u of urls) assert.equal(u, AVA_BASEMAP.origin);
  }
});

test("the street map is drawn: land, water, roads and labels, all from the basemap source", () => {
  const s = basemapStyle("ava", "light");
  const ids = s.layers.map((l) => l.id);
  for (const id of ["background", "water", "roads_minor", "roads_highway", "places_locality"]) assert.ok(ids.includes(id), `${id} in ${ids.join(",")}`);
  for (const l of s.layers) if (l.type !== "background" && l.type !== "raster") assert.equal((l as { source: string }).source, BASEMAP_SOURCE, l.id);
  // Labels in the page's language.
  assert.match(JSON.stringify(basemapStyle("ava", "light", "fr").layers.find((l) => l.id === "places_locality")), /name:fr/);
});

test("in the Quiet palette, light and dark: the ground is ava's theme's, the water its own blue", () => {
  for (const mode of ["light", "dark"] as const) {
    const s = basemapStyle("ava", mode);
    const bg = s.layers.find((l) => l.type === "background");
    assert.equal((bg?.paint as Record<string, unknown>)["background-color"], theme("ava", mode).ground);
    const water = s.layers.find((l) => l.id === "water");
    assert.equal((water?.paint as Record<string, unknown>)["fill-color"], AVA_BASEMAP.palette[mode].water);
  }
  assert.notEqual(AVA_BASEMAP.palette.light.water, AVA_BASEMAP.palette.dark.water);
});

test("the credit: Protomaps and OpenStreetMap's copyright page, no edit link", () => {
  assert.equal(
    creditHtml(AVA_BASEMAP.credit.en),
    '<a href="https://protomaps.com" rel="noreferrer">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap contributors</a>',
  );
  for (const parts of Object.values(AVA_BASEMAP.credit)) for (const p of parts) if (typeof p !== "string") assert.doesNotMatch(p.href, /edit|fixthemap/i);
});

/**
 * A paint property's value on the drawn map: MapLibre's own expression evaluator, at a zoom, with
 * the map type the switch set (the style's global state).
 */
function paintAt(layerId: string, property: string, zoom: number, mapType: "map" | "satellite", mode: "light" | "dark" = "light"): string | number {
  const layer = basemapStyle("ava", mode).layers.find((l) => l.id === layerId) as { type: string; paint?: Record<string, unknown> };
  const spec = (latest as unknown as Record<string, Record<string, unknown>>)[`paint_${layer.type}`]![property];
  const value = layer.paint?.[property] ?? (spec as { default: unknown }).default;
  const e = normalizePropertyExpression(value as never, "paint", spec as never, { [MAP_TYPE_STATE]: mapType });
  const out = e.evaluate({ zoom, globalState: { [MAP_TYPE_STATE]: mapType } } as never, { type: 2, properties: { kind: "major_road", min_zoom: 0 } } as never) as unknown;
  return typeof out === "number" ? out : String(out).replace(/\s/g, "");
}
const rgba = (s: string) => s.replace(/\s/g, "");

test("satellite: the imagery is ava's tiles host's, the base everywhere to z10 and the detail over Canada to z13", () => {
  const s = basemapStyle("ava", "light", "en", "satellite");
  const base = s.sources[IMAGERY_SOURCES.base];
  const detail = s.sources[IMAGERY_SOURCES.detail];
  assert.ok(base && base.type === "raster" && detail && detail.type === "raster");
  assert.deepEqual(base.tiles, ["https://tiles.addis.gg/satellite/{z}/{x}/{y}.webp"]);
  assert.deepEqual(detail.tiles, base.tiles, "one archive, read at two depths");
  assert.equal(base.tileSize, 256);
  assert.equal(base.maxzoom, 10);
  assert.deepEqual([detail.minzoom, detail.maxzoom], [11, 13]);
  assert.deepEqual(detail.bounds, [-141.01, 41.67, -52.61, 83.12], "Canada's box: no detail tile is asked for outside it");
  for (const u of JSON.stringify(s).match(/https?:\/\/[^"/]+/g) ?? []) assert.equal(u, AVA_BASEMAP.origin);
});

test("satellite: the imagery is under every road and name, over the land; hidden (nothing fetched) on the street map", () => {
  for (const mapType of ["map", "satellite"] as const) {
    const s = basemapStyle("ava", "dark", "en", mapType);
    const ids = s.layers.map((l) => l.id);
    const at = ids.indexOf(IMAGERY_LAYERS.base);
    assert.equal(ids[at + 1], IMAGERY_LAYERS.detail, "the detail over the base");
    assert.ok(at > ids.indexOf("earth") && at > ids.indexOf("landcover"));
    s.layers.forEach((l, n) => { if (l.type === "line" || l.type === "symbol") assert.ok(n > at, `${l.id} over the imagery`); });
    for (const id of Object.values(IMAGERY_LAYERS)) assert.equal((s.layers.find((l) => l.id === id)!.layout as { visibility: string }).visibility, mapType === "satellite" ? "visible" : "none");
    assert.deepEqual(s.state, { [MAP_TYPE_STATE]: { default: mapType } });
  }
});

test("satellite: roads white and names white on dark over the imagery; water cleared; the street map again past the fade", () => {
  const { from, to } = ESA_WORLDCOVER_2021.fade;
  for (const mode of ["light", "dark"] as const) {
    // On the street map nothing changed, at any zoom.
    for (const zoom of [8, 12, 16]) {
      assert.equal(paintAt("water", "fill-opacity", zoom, "map", mode), 1);
      assert.equal(paintAt("roads_highway", "line-color", zoom, "map", mode), paintAt("roads_highway", "line-color", 18, "satellite", mode));
    }
    assert.notEqual(paintAt("roads_highway", "line-color", 12, "map", mode), rgba(OVER_IMAGERY.bigRoad));
    // Over the imagery, below the fade.
    assert.equal(paintAt("roads_highway", "line-color", 12, "satellite", mode), rgba(OVER_IMAGERY.bigRoad));
    assert.equal(paintAt("places_locality", "text-color", 12, "satellite", mode), "rgba(255,255,255,1)");
    assert.equal(paintAt("places_locality", "text-halo-color", 12, "satellite", mode), rgba(OVER_IMAGERY.halo));
    assert.equal(paintAt("water", "fill-opacity", 12, "satellite", mode), 0);
    assert.equal(paintAt(IMAGERY_LAYERS.base, "raster-opacity", 12, "satellite", mode), 1);
    // Halfway through the fade, halfway there; past it, the street map.
    assert.equal(paintAt(IMAGERY_LAYERS.detail, "raster-opacity", (from + to) / 2, "satellite", mode), 0.5);
    assert.equal(paintAt("water", "fill-opacity", (from + to) / 2, "satellite", mode), 0.5);
    assert.equal(paintAt(IMAGERY_LAYERS.base, "raster-opacity", to, "satellite", mode), 0);
    assert.equal(paintAt("water", "fill-opacity", to, "satellite", mode), 1);
    assert.equal(paintAt("places_locality", "text-color", to + 1, "satellite", mode), paintAt("places_locality", "text-color", to + 1, "map", mode));
  }
});

test("satellite in a host's own style (withImagery): its layers on top stay as they are, and adding it twice adds it once", () => {
  // A host's street map without imagery (as ava-web's mapStyle builds it), and a marker of its own on top.
  const street = { version: 8 as const, sources: { [BASEMAP_SOURCE]: { type: "vector" as const, tiles: [AVA_BASEMAP.tiles] } }, layers: layers(BASEMAP_SOURCE, basemapFlavor(AVA_BASEMAP, "light"), { lang: "en" }) };
  assert.equal(street.layers.filter((l) => l.type === "raster").length, 0);
  const marker = { id: "place", type: "circle" as const, source: "place", paint: { "circle-color": "#5B4BDB" } };
  const own = { ...street, sources: { ...street.sources, place: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } }, layers: [...street.layers, marker] };
  const s = withImagery(own, ESA_WORLDCOVER_2021, "satellite");
  assert.deepEqual(s.layers.at(-1), marker);
  assert.equal(s.layers.filter((l) => l.type === "raster").length, 2);
  assert.equal(withImagery(s, ESA_WORLDCOVER_2021, "satellite").layers.filter((l) => l.type === "raster").length, 2);
  assert.equal(basemapStyle("ava", "light", "en", "satellite").layers.length, s.layers.length - 1);
});
